import { after, NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  getApproval,
  updateApprovalStatus,
  requestRevision,
  resubmitApproval,
  addApprovalComment,
} from "@/lib/orchestration/service/approval";
import { enqueueWakeup, executeHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";
import { materializeApprovedHireAgent } from "@/lib/orchestration/service/company-agent-provisioning";
import { switchAgentProvider } from "@/lib/orchestration/service/provider-switch";
import { triggerTaskExecution } from "@/lib/orchestration/execution";
import { moveTask } from "@/lib/orchestration/service";
import { resolveTaskExecutionEngine } from "@/lib/orchestration/service/shared";
import { normalizeTaskModelLane } from "@/lib/orchestration/task-model-routing";

export const dynamic = "force-dynamic";

async function triggerImmediateHeartbeatRun(runId: string) {
  try {
    const result = await executeHeartbeatRun(runId);
    if (result.status === "failed") {
      console.warn("[approval] immediate heartbeat execution failed:", result.error);
    }
  } catch (error) {
    console.warn("[approval] immediate heartbeat execution failed (non-fatal):", error);
  }
}

function resolveTaskCompanyId(taskId: string, db = getOrchestrationDb()): string | null {
  const row = db
    .prepare(
      `SELECT COALESCE(t.company_id, p.company_id) AS company_id
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?
       LIMIT 1`,
    )
    .get(taskId) as { company_id: string | null } | undefined;
  return row?.company_id ?? null;
}

function triggerImmediateRunIfAllowed(taskId: string, runId: string | undefined, db = getOrchestrationDb()): void {
  if (!runId) return;
  const companyId = resolveTaskCompanyId(taskId, db);
  if (!companyId || !canAutonomouslyExecuteCompany(companyId, db)) return;
  after(async () => {
    await triggerImmediateHeartbeatRun(runId);
  });
}

async function resumeApprovedProtectedHeartbeat(input: {
  approvalId: string;
  companyId: string;
  taskId: string;
  taskStatus: string;
  agentId: string;
  executionEngine: "hiverunner" | "symphony" | "manual";
  modelLane: "default" | "fast" | "mini" | "deep";
}): Promise<{
  attempted: boolean;
  queued?: boolean;
  status?: string;
  runId?: string;
  reason?: string;
}> {
  const wake = enqueueWakeup({
    agentId: input.agentId,
    companyId: input.companyId,
    source: "api",
    reason: `protected_runtime_approval:${input.approvalId}`,
    payload: {
      taskId: input.taskId,
      taskStatus: input.taskStatus,
      assigneeAgentId: input.agentId,
      executionEngine: input.executionEngine,
      modelLane: input.modelLane,
      approvedProtectedRuntimeApprovalId: input.approvalId,
    },
    idempotencyKey: `protected-runtime-approval-resume:${input.approvalId}`,
  });
  triggerImmediateRunIfAllowed(input.taskId, wake.heartbeatRunId);
  return {
    attempted: true,
    queued: wake.status !== "coalesced",
    status: wake.status === "coalesced" ? "coalesced" : "queued",
    runId: wake.heartbeatRunId,
    reason: `protected_runtime_approval:${input.approvalId}`,
  };
}

async function resumeApprovedProtectedRuntimeTask(input: {
  approvalId: string;
  companyId: string;
  linkedTaskId: string | null;
  payload: Record<string, unknown>;
  actorUserId: string;
}): Promise<{
  attempted: boolean;
  queued?: boolean;
  status?: string;
  runId?: string;
  reason?: string;
  skippedReason?: string;
}> {
  if (!input.linkedTaskId) {
    return { attempted: false, skippedReason: "approval_has_no_task" };
  }

  const db = getOrchestrationDb();
  const task = db
    .prepare(
      `SELECT
         t.id,
         t.status,
         t.assignee_agent_id,
         t.archived_at,
         t.execution_engine,
         t.model_lane,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE t.id = ?
       LIMIT 1`,
    )
    .get(input.linkedTaskId) as
      | {
          id: string;
          status: string;
          assignee_agent_id: string | null;
          archived_at: string | null;
          execution_engine: "hiverunner" | "symphony" | "manual" | null;
          model_lane: "default" | "fast" | "mini" | "deep" | null;
          project_settings_json: string | null;
          company_settings_json: string | null;
        }
      | undefined;

  if (!task || task.archived_at) {
    return { attempted: false, skippedReason: "task_not_active" };
  }

  const approvedAgentId = typeof input.payload.agentId === "string" ? input.payload.agentId : null;
  if (approvedAgentId && task.assignee_agent_id !== approvedAgentId) {
    return { attempted: false, skippedReason: "approval_agent_no_longer_assigned" };
  }

  if (task.status === "done" || task.status === "cancelled") {
    return { attempted: false, skippedReason: `task_is_${task.status}` };
  }

  if (task.status !== "in_progress") {
    moveTask({
      taskId: task.id,
      status: "in-progress",
      actorUserId: input.actorUserId,
    });
  }

  const executionEngine = resolveTaskExecutionEngine({
    taskExecutionEngine: task.execution_engine,
    projectSettingsJson: task.project_settings_json,
    companySettingsJson: task.company_settings_json,
  }).engine;
  const modelLane = normalizeTaskModelLane(task.model_lane ?? "default");

  const provider = typeof input.payload.provider === "string" ? input.payload.provider : null;
  if (provider === "codex" && approvedAgentId) {
    return resumeApprovedProtectedHeartbeat({
      approvalId: input.approvalId,
      companyId: input.companyId,
      taskId: task.id,
      taskStatus: "in_progress",
      agentId: approvedAgentId,
      executionEngine,
      modelLane,
    });
  }

  const execution = await triggerTaskExecution({
    taskId: task.id,
    forceFreshSession: true,
    reason: `protected_runtime_approval:${input.approvalId}`,
    idempotencyKey: `protected-runtime-approval-resume:${input.approvalId}`,
  });
  triggerImmediateRunIfAllowed(task.id, execution.runId, db);
  return {
    attempted: true,
    queued: execution.queued,
    status: execution.status,
    runId: execution.runId,
    reason: execution.reason,
  };
}

const commentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  authorUserId: z.string().trim().min(1).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(getApproval(id));
  } catch (error) {
    return handleRouteError(error, "approval:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "approve") return handleApprove(id, body);
    if (action === "reject") return handleReject(id, body);
    if (action === "request_revision") return handleRequestRevision(id, body);
    if (action === "resubmit") return handleResubmit(id, body);
    if (action === "comment") return handleComment(id, body);

    return errorResponse(400, "invalid_action", "Action must be approve, reject, request_revision, resubmit, or comment");
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid payload", error.flatten());
    }
    return handleRouteError(error, "approval:post");
  }
}

async function handleApprove(approvalId: string, body: Record<string, unknown>) {
  const db = getOrchestrationDb();
  const { approval } = getApproval(approvalId);

  if (approval.status !== "pending" && approval.status !== "revision_requested") {
    return errorResponse(400, "not_actionable", `Approval is already ${approval.status}`);
  }

  const result = updateApprovalStatus({
    approvalId,
    status: "approved",
    decidedByUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
    decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : undefined,
  });
  let providerSwitch: ReturnType<typeof switchAgentProvider> | null = null;
  let protectedRuntimeResume: Awaited<ReturnType<typeof resumeApprovedProtectedRuntimeTask>> | null = null;

  if (approval.type === "hire_agent") {
    materializeApprovedHireAgent({
      approvalCompanyId: approval.companyId,
      requestedByAgentId: approval.requestedByAgentId,
      payload: approval.payload,
      db,
    });
  }

  if (approval.type === "provider_switch") {
    const agentId = typeof approval.payload.agentId === "string" ? approval.payload.agentId : "";
    const targetProvider = typeof approval.payload.targetProvider === "string"
      ? approval.payload.targetProvider
      : "";
    const stateChanges = typeof approval.payload.stateChanges === "object" && approval.payload.stateChanges !== null && !Array.isArray(approval.payload.stateChanges)
      ? approval.payload.stateChanges as Record<string, unknown>
      : {};
    const targetModel = typeof stateChanges.newModel === "string" ? stateChanges.newModel : null;
    if (agentId && targetProvider) {
      providerSwitch = switchAgentProvider(agentId, targetProvider, undefined, {
        requireApproval: false,
        approvedByApprovalId: approvalId,
        actorUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
        targetModel,
      });
    }
  }

  if (approval.type === "protected_runtime_command") {
    protectedRuntimeResume = await resumeApprovedProtectedRuntimeTask({
      approvalId,
      companyId: approval.companyId,
      linkedTaskId: approval.linkedTaskId,
      payload: approval.payload,
      actorUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
    });
  }

  // Approval feedback loop: queue wakeup for the requesting agent so they can act on the decision
  if (approval.requestedByAgentId && approval.type !== "protected_runtime_command") {
    try {
      const wake = enqueueWakeup({
        agentId: approval.requestedByAgentId,
        companyId: approval.companyId,
        source: "explicit",
        reason: `Approval ${approvalId} was approved (${approval.type})`,
        payload: {
          approvalId,
          approvalType: approval.type,
          approvalStatus: "approved",
          decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
          taskId: approval.linkedTaskId ?? undefined,
        },
        idempotencyKey: `approval-feedback:${approvalId}:approved`,
      }, db);
      if (
        (wake.status === "queued" || wake.status === "coalesced") &&
        wake.heartbeatRunId &&
        canAutonomouslyExecuteCompany(approval.companyId)
      ) {
        after(async () => {
          await triggerImmediateHeartbeatRun(wake.heartbeatRunId!);
        });
      }
    } catch (wakeErr) {
      console.error("[approval] feedback wakeup failed:", wakeErr instanceof Error ? wakeErr.message : String(wakeErr));
    }
  }

  return NextResponse.json({ ...result, providerSwitch, protectedRuntimeResume });
}

function handleReject(approvalId: string, body: Record<string, unknown>) {
  const db = getOrchestrationDb();
  const { approval } = getApproval(approvalId);

  if (approval.status !== "pending" && approval.status !== "revision_requested") {
    return errorResponse(400, "not_actionable", `Approval is already ${approval.status}`);
  }

  const result = updateApprovalStatus({
    approvalId,
    status: "rejected",
    decidedByUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
    decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : undefined,
  });

  if (approval.type === "hire_agent") {
    const agentId = typeof approval.payload.agentId === "string" ? approval.payload.agentId : null;
    if (agentId) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE agents SET status = 'offline', archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(now, now, agentId);
    }
  }

  // Approval feedback loop: queue wakeup for the requesting agent so they can adjust
  if (approval.requestedByAgentId) {
    try {
      const wake = enqueueWakeup({
        agentId: approval.requestedByAgentId,
        companyId: approval.companyId,
        source: "explicit",
        reason: `Approval ${approvalId} was rejected (${approval.type})`,
        payload: {
          approvalId,
          approvalType: approval.type,
          approvalStatus: "rejected",
          decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
        },
        idempotencyKey: `approval-feedback:${approvalId}:rejected`,
      }, db);
      if (
        (wake.status === "queued" || wake.status === "coalesced") &&
        wake.heartbeatRunId &&
        canAutonomouslyExecuteCompany(approval.companyId)
      ) {
        after(async () => {
          await triggerImmediateHeartbeatRun(wake.heartbeatRunId!);
        });
      }
    } catch (wakeErr) {
      console.error("[approval] feedback wakeup failed:", wakeErr instanceof Error ? wakeErr.message : String(wakeErr));
    }
  }

  return NextResponse.json(result);
}

function handleRequestRevision(approvalId: string, body: Record<string, unknown>) {
  const result = requestRevision({
    approvalId,
    decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : undefined,
    decidedByUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
  });
  return NextResponse.json(result);
}

function handleResubmit(approvalId: string, body: Record<string, unknown>) {
  const payload = typeof body.payload === "object" && body.payload !== null
    ? body.payload as Record<string, unknown>
    : undefined;
  const result = resubmitApproval({ approvalId, payload });
  return NextResponse.json(result);
}

function handleComment(approvalId: string, body: Record<string, unknown>) {
  const parsed = commentSchema.parse(body);
  const { approval } = getApproval(approvalId);
  const result = addApprovalComment({
    approvalId,
    companyId: approval.companyId,
    body: parsed.body,
    authorUserId: parsed.authorUserId ?? "operator",
  });
  return NextResponse.json(result, { status: 201 });
}
