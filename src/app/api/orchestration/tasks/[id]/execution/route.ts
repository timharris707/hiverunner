import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import { cancelTaskExecution, pollTaskExecutionStatus, triggerTaskExecution } from "@/lib/orchestration/execution";
import { cancelTaskExecutionSchema } from "@/lib/orchestration/contracts";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { executeHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";
import { getTask, moveTask } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().trim().min(1),
});
const runTaskExecutionSchema = z.object({
  actorUserId: z.string().trim().min(1).max(100).optional(),
  forceFreshSession: z.boolean().optional().default(true),
  reason: z.string().trim().min(1).max(200).optional(),
});

function resolveTaskCompanyId(taskId: string): string | null {
  const db = getOrchestrationDb();
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

function triggerImmediateRunIfAllowed(taskId: string, runId: string | undefined): void {
  if (!runId) return;
  const companyId = resolveTaskCompanyId(taskId);
  if (!companyId || !canAutonomouslyExecuteCompany(companyId)) return;
  try {
    after(async () => {
      try {
        await executeHeartbeatRun(runId);
      } catch (error) {
        console.warn("[task-execution:post] immediate heartbeat execution failed:", error);
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("outside a request scope")) {
      console.warn("[task-execution:post] immediate heartbeat scheduling failed:", error);
    }
  }
}

function moveTaskToInProgress(input: {
  taskId: string;
  actorUserId?: string;
}) {
  try {
    return moveTask({
      taskId: input.taskId,
      status: "in-progress",
      actorUserId: input.actorUserId,
    });
  } catch (error) {
    if (!(error instanceof OrchestrationApiError) || error.code !== "invalid_transition") {
      throw error;
    }
    moveTask({
      taskId: input.taskId,
      status: "to-do",
      actorUserId: input.actorUserId,
    });
    return moveTask({
      taskId: input.taskId,
      status: "in-progress",
      actorUserId: input.actorUserId,
    });
  }
}

function prepareTaskForExecution(input: {
  taskId: string;
  actorUserId?: string;
}) {
  const current = getTask(input.taskId).task;
  if (current.status === "review") {
    return {
      task: current,
      transition: {
        from: "review" as const,
        to: "review" as const,
        statusChanged: false,
      },
    };
  }

  return moveTaskToInProgress(input);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const result = await pollTaskExecutionStatus(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid task id", error.flatten());
    }
    return handleRouteError(error, "task-execution:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const parsed = runTaskExecutionSchema.parse(await req.json().catch(() => ({})));
    const moved = prepareTaskForExecution({
      taskId: id,
      actorUserId: parsed.actorUserId ?? "ui-run-now",
    });
    const execution = await triggerTaskExecution({
      taskId: moved.task.id,
      forceFreshSession: parsed.forceFreshSession,
      reason: parsed.reason ?? "ui_run_now",
      idempotencyKey: parsed.forceFreshSession
        ? undefined
        : `mc-task-run-now:${moved.task.id}:${moved.task.updated}`,
    });
    triggerImmediateRunIfAllowed(moved.task.id, execution.runId);
    return NextResponse.json({ task: moved.task, transition: moved.transition, execution });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid task execution run payload", error.flatten());
    }
    return handleRouteError(error, "task-execution:post");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const parsed = cancelTaskExecutionSchema.parse(await req.json());
    const result = await cancelTaskExecution({
      taskId: id,
      actorUserId: parsed.actorUserId,
      note: parsed.note,
      targetStatus: parsed.targetStatus,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid task execution cancel payload", error.flatten());
    }
    return handleRouteError(error, "task-execution:patch");
  }
}
