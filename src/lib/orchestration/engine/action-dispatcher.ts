import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OPENCLAW_BIN, callGateway } from "@/lib/orchestration/execution/adapters";
import { materializeApprovedHireAgent, stagePendingHireAgent } from "@/lib/orchestration/service/company-agent-provisioning";
import { createApproval } from "@/lib/orchestration/service/approval";
import { shouldAutoApproveNewHires } from "@/lib/orchestration/service/hiring-governance";
import { reconcileTaskHierarchy, refreshAgentLoad, resolveTaskExecutionEngine, resolveTaskExecutionRouting } from "@/lib/orchestration/service/shared";
import { sanitizeAgentCommentLinks } from "@/lib/orchestration/comment-link-verification";
import { submitCompanyReviewDecision } from "@/lib/orchestration/review-decision";
import { createGoalCompletionProposal, createSprintPlanDrafts, recordGoalContractEvidence } from "@/lib/orchestration/company-service";
import { maybeAutoCompleteSprintForTaskDone } from "@/lib/orchestration/service/task";
import { recordExplicitSkillUse } from "@/lib/orchestration/skill-effectiveness";
import { normalizeTaskModelLane } from "@/lib/orchestration/task-model-routing";
import { assertExecutableAgentRuntime, isExecutableAgentRuntime, runtimeProviderLabel } from "@/lib/orchestration/runtime-readiness";
import type { TaskExecutionEngine, TaskModelLane, TaskPriority, TaskType } from "@/lib/orchestration/types";
import { resolveExecutionRoute } from "@/lib/orchestration/execution-route-resolver";
import { getTaskRefForActionKey, mergeExecutionRunMetadata, parseJson, resetNoopCounterForActionTask } from "@/lib/orchestration/engine/persistence";
import { enqueueWakeup, wakeTargetFromJson, type EnqueueWakeupResult } from "@/lib/orchestration/engine/wakeup-queue";
import type { ExecutionRunProvider } from "@/lib/orchestration/engine/heartbeat-manager";
import {
  buildMemoryUtilizationReceiptMetadataPatch,
  type MemoryReceiptAction,
  validateMemoryReceiptActionFields,
} from "@/lib/orchestration/memory-utilization-receipts";
import { PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";
import {
  normalizeCreateTaskExecutionEngine,
  taskExecutionPolicyForWakeup,
} from "@/lib/orchestration/engine/execution-router";
import {
  applyStatusTransition,
  getLatestReviewSubmissionAuthor,
  isPlanningDraftLifecycleTask,
  learningReviewTargetHasDecision,
  planningTaskHasSprintDraft,
  taskLabelsInclude,
} from "@/lib/orchestration/engine/status-transitions";
import {
  applyReviewDecision,
  autoRouteReviewHandoff,
  safeJsonStringArray,
} from "@/lib/orchestration/engine/review-handler";
import { resolveHiveRunnerWorkspaceRoot, resolveOpenClawDir } from "@/lib/workspaces/root";
export { safeJsonStringArray } from "@/lib/orchestration/engine/review-handler";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME?.trim() || resolveOpenClawDir();

const CANONICAL_TASK_TYPES = new Set<string>([
  "feature",
  "bug",
  "maintenance",
  "research",
  "infrastructure",
  "directive",
  "epic",
  "spike",
  "docs",
  "infra",
  "refactor",
  "review",
  "qa",
  "release",
]);

export type SessionGetMessage = {
  role?: string;
  content?: string | Array<{ type?: string; text?: string; name?: string; arguments?: Record<string, unknown> }>;
};

type SessionListEntry = {
  key?: string;
  sessionId?: string;
  status?: string | null;
  startedAt?: number | string | null;
  endedAt?: number | string | null;
};

function sessionPollIntervalMs(): number {
  const configured = Number(process.env.ORCHESTRATION_OPENCLAW_SESSION_POLL_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 2_000;
}

function sessionCompletionTimeoutMs(): number {
  const configured = Number(process.env.ORCHESTRATION_OPENCLAW_SESSION_COMPLETION_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 540_000;
}

function isTerminalSessionStatus(status: string | undefined): boolean {
  return status === "done" || status === "completed" || status === "failed" || status === "error" || status === "cancelled";
}

function isActiveSessionStatus(status: string | undefined): boolean {
  return status === "running" || status === "started";
}

/* ── Post-Execution Output Import & HiveRunner Action Execution ── */

export type McAction =
  | {
      action: "create_task";
      title: string;
      description?: string;
      priority?: string;
      type?: string;
      assignee?: string;
      project?: string;
      parent?: string;
      labels?: string[];
      executionEngine?: TaskExecutionEngine;
      modelLane?: TaskModelLane;
      status?: string;
      // G4 — chained decomposition. Array of task_keys (e.g. ["WEA-283"]) that
      // must be `done` before the sweeper will wake this task. Unresolved keys
      // are dropped silently with observability stamped into the created
      // task_event metadata. Cross-project deps are dropped.
      dependsOn?: string[];
    }
  | {
      action: "hire_agent";
      name: string;
      role: string;
      capabilities?: string;
      reason?: string;
      runtimeProvider?: string;
      provider?: string;
      adapterType?: string;
      model?: string;
    }
  | { action: "report"; summary: string }
  | { action: "update_task"; taskKey: string; status?: string; assignee?: string; comment?: string }
  | { action: "add_comment"; taskKey: string; body: string; source?: string }
  | { action: "use_skill"; skill: string; taskKey?: string; note?: string }
  | MemoryReceiptAction
  | {
      action: "review_candidate";
      targetType: "memory" | "skill";
      targetId: string;
      decision: "approve" | "reject";
      note?: string;
      confidence?: number;
    }
  // G5 — register a deliverable on a task. `uri` is required (file://, http(s)://,
  // or any scheme the renderer is prepared to handle). `kind` is one of
  // 'html' | 'pdf' | 'image' | 'file' | 'url'. `sha256` is optional but
  // recommended; G2's no-op resubmission detection uses it to compare the
  // artifact across rework cycles.
  | { action: "register_artifact"; taskKey: string; uri: string; kind?: string; sha256?: string }
  | {
      action: "propose_sprint_plan";
      companyGoalId: string;
      planMode?: boolean;
      sprint?: {
        name: string;
        objective: string;
        owner?: string | null;
        startDate?: string;
        endDate?: string | null;
        defaultExecutionEngine?: TaskExecutionEngine | null;
        defaultModelLane?: TaskModelLane | null;
        successCriteria?: string[];
        validationChecks?: string[];
        outOfScope?: string[];
      };
      tasks?: Array<{
        id?: string;
        title: string;
        description?: string;
        assignee?: string | null;
        priority?: string;
        type?: string;
        executionEngine?: TaskExecutionEngine | null;
        modelLane?: TaskModelLane | null;
        dependsOn?: string[];
        validation?: string;
      }>;
      sprints?: Array<{
        sequenceNumber?: number;
        name: string;
        objective: string;
        owner?: string | null;
        startDate?: string;
        endDate?: string | null;
        defaultExecutionEngine?: TaskExecutionEngine | null;
        defaultModelLane?: TaskModelLane | null;
        successCriteria?: string[];
        validationChecks?: string[];
        outOfScope?: string[];
        tasks: Array<{
          id?: string;
          title: string;
          description?: string;
          assignee?: string | null;
          priority?: string;
          type?: string;
          executionEngine?: TaskExecutionEngine | null;
          modelLane?: TaskModelLane | null;
          dependsOn?: string[];
          validation?: string;
        }>;
      }>;
    }
  | {
      action: "record_validation_evidence" | "record_success_evidence";
      itemId: string;
      status?: "proposed" | "failed";
      resultText?: string;
      commandExitCode?: number;
      artifactUri?: string;
    }
  | {
      action: "mark_goal_complete";
      companyGoalId: string;
      reason: string;
    }
  | {
      action: "propose_memory";
      body: string;
      type?: string;
      tags?: string[];
      category?: string;
      target_source_file?: string;
      provenance?: {
        task_key?: string;
        run_id?: string;
        agent?: string;
      };
    };

export type McActionExecutionOutcome =
  | { kind: "created_task"; taskId: string }
  | { kind: "created_approval"; approvalId: string }
  | { kind: "hired_agent"; agentId: string }
  | { kind: "reported" }
  | { kind: "updated_task"; taskId?: string; dependentAutostartDeferred?: boolean }
  | { kind: "added_comment" }
  | { kind: "recorded_skill_use"; inserted: boolean }
  | { kind: "recorded_memory_receipt"; claimCount: number }
  | { kind: "reviewed_candidate" }
  | { kind: "registered_artifact" }
  | { kind: "proposed_sprint_plan"; draftId: string; closedPlanningTask?: boolean }
  | { kind: "proposed_goal_completion"; draftId: string }
  | { kind: "recorded_goal_evidence" }
  | { kind: "proposed_memory"; candidateId: string; routedTo: string | null }
  | { kind: "skipped_duplicate" }
  | { kind: "failed"; reason: string };

export type ExecuteMcActionInput = {
  agentId: string;
  agentName: string;
  companyId: string;
  taskKey: string;
  runId: string;
  executionRunId?: string | null;
  source?: string;
  deferDependentAutoStart?: boolean;
};

function getFocusedTaskKey(
  db: Database.Database,
  focusedTaskId: string,
): string | null {
  const row = db
    .prepare("SELECT task_key FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(focusedTaskId) as { task_key: string | null } | undefined;
  return row?.task_key ?? null;
}

function isFocusedTaskAction(input: {
  db: Database.Database;
  focusedTaskId: string;
  actionTaskKey: string;
}): boolean {
  const trimmed = input.actionTaskKey.trim();
  if (!trimmed) return false;
  if (trimmed === input.focusedTaskId) return true;
  return trimmed === getFocusedTaskKey(input.db, input.focusedTaskId);
}

export function hasOpenChildTasks(
  db: Database.Database,
  parentTaskId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE parent_task_id = ?
         AND archived_at IS NULL
         AND status NOT IN ('done', 'cancelled')`,
    )
    .get(parentTaskId) as { count: number } | undefined;
  return (row?.count ?? 0) > 0;
}

export function focusedTaskClosureDeferralReason(input: {
  action: Extract<McAction, { action: "update_task" }>;
  allActions: McAction[];
  focusedTaskId: string;
  db: Database.Database;
}): "hire_only_delegation" | "child_tasks_created" | "open_child_tasks" | null {
  const normalizedStatus = input.action.status?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (!["review", "done", "blocked"].includes(normalizedStatus)) return null;
  const isFocusedTarget = isFocusedTaskAction({
    db: input.db,
    focusedTaskId: input.focusedTaskId,
    actionTaskKey: input.action.taskKey,
  });
  const targetTask = isFocusedTarget
    ? { id: input.focusedTaskId, taskKey: getFocusedTaskKey(input.db, input.focusedTaskId) }
    : getTaskRefForActionKey(input.db, input.action.taskKey);
  if (!targetTask) return null;
  const hasHire = input.allActions.some((candidate) => candidate.action === "hire_agent");
  const hasTargetCreateTask = input.allActions.some((candidate) => {
    if (candidate.action !== "create_task") return false;
    const parentKey = candidate.parent?.trim();
    if (isFocusedTarget && !parentKey) return true;
    return Boolean(parentKey && targetTask.taskKey && parentKey === targetTask.taskKey);
  });
  if (isFocusedTarget && hasHire && !hasTargetCreateTask) return "hire_only_delegation";
  if (hasTargetCreateTask) return "child_tasks_created";
  if (hasOpenChildTasks(input.db, targetTask.id)) return "open_child_tasks";
  return null;
}

export function shouldDeferDependentAutoStartForAction(input: {
  action: Extract<McAction, { action: "update_task" }>;
  allActions: McAction[];
  focusedTaskId: string;
  db: Database.Database;
}): boolean {
  const normalizedStatus = input.action.status?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (normalizedStatus !== "done") return false;
  const focusedTaskKey = getFocusedTaskKey(input.db, input.focusedTaskId);
  if (!focusedTaskKey || input.action.taskKey?.trim() !== focusedTaskKey) return false;

  return input.allActions.some((candidate) => {
    if (candidate.action !== "create_task") return false;
    const parentKey = candidate.parent?.trim();
    if (!parentKey || parentKey === focusedTaskKey) return false;
    const dependsOnKeys = candidate.dependsOn?.map((key) => key.trim()).filter(Boolean) ?? [];
    return dependsOnKeys.includes(focusedTaskKey);
  });
}

export function enqueueHireOnlyDelegationContinuation(input: {
  agentId: string;
  companyId: string;
  runId: string;
  db: Database.Database;
}): void {
  try {
    enqueueWakeup({
      agentId: input.agentId,
      companyId: input.companyId,
      source: "explicit",
      reason: "hire_only_delegation_requires_worker_tasks",
      payload: {
        previousRunId: input.runId,
        instruction: "You hired agents but did not create scoped worker tasks. Create the missing tasks before closing the directive.",
      },
      idempotencyKey: `hire-only-delegation:${input.runId}`,
    }, input.db);
  } catch (error) {
    console.warn(
      `[engine:delegation] failed to queue hire-only continuation for ${input.agentId}:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function closureDeferralMessage(reason: "hire_only_delegation" | "child_tasks_created" | "open_child_tasks"): string {
  if (reason === "hire_only_delegation") return "hire-only delegation must create worker tasks first";
  if (reason === "child_tasks_created") return "newly created child tasks must finish before the parent directive closes";
  return "open child tasks must finish before the parent directive closes";
}

export async function executeImportedContractAction(input: {
  action: Extract<McAction, { action: "propose_sprint_plan" | "record_validation_evidence" | "record_success_evidence" | "mark_goal_complete" }>;
  executeInput: ExecuteMcActionInput;
  db: Database.Database;
}): Promise<{ ok: true; detail: string } | { ok: false; reason: string }> {
  const outcome = await executeMcAction(input.action, input.executeInput, input.db);
  if (outcome.kind === "failed") {
    return { ok: false, reason: outcome.reason };
  }
  if (outcome.kind === "proposed_sprint_plan") {
    return { ok: true, detail: `Proposed sprint plan draft ${outcome.draftId}` };
  }
  if (outcome.kind === "proposed_goal_completion") {
    return { ok: true, detail: `Proposed goal completion ${outcome.draftId}` };
  }
  if (outcome.kind === "recorded_goal_evidence") {
    const itemId = input.action.action === "record_validation_evidence" || input.action.action === "record_success_evidence" ? input.action.itemId : "";
    return { ok: true, detail: `Recorded goal-contract evidence ${itemId}` };
  }
  return { ok: false, reason: `unexpected_outcome:${outcome.kind}` };
}

export async function executeMcAction(
  action: McAction,
  input: ExecuteMcActionInput,
  db: Database.Database,
): Promise<McActionExecutionOutcome> {
  try {
    switch (action.action) {
      case "create_task": {
        const taskId = await executeCreateTask(action, input, db);
        return taskId
          ? { kind: "created_task", taskId }
          : { kind: "skipped_duplicate" };
      }
      case "hire_agent": {
        const hireResult = executeHireAgent(action, input, db);
        if (!hireResult) return { kind: "skipped_duplicate" };
        if (hireResult.startsWith(AUTO_APPROVED_HIRE_PREFIX)) {
          return { kind: "hired_agent", agentId: hireResult.slice(AUTO_APPROVED_HIRE_PREFIX.length) };
        }
        return { kind: "created_approval", approvalId: hireResult };
      }
      case "report": {
        importCommentOnTask(
          input.taskKey,
          input.agentId,
          `**CEO Report:** ${action.summary}`.slice(0, 9000),
          "status_update",
          input.runId,
          db,
          input.source,
        );
        return { kind: "reported" };
      }
      case "update_task": {
        const updated = executeUpdateTask(action, input, db);
        if (!updated.taskFound) return { kind: "failed", reason: "task_not_found" };
        if (updated.statusRequested && !updated.statusApplied) {
          return {
            kind: "failed",
            reason: `status_transition_rejected:${updated.statusRejectedReason ?? "unknown"}`,
          };
        }
        if (updated.assigneeRequested && updated.assigneeRejectedReason) {
          return {
            kind: "failed",
            reason: `assignee_rejected:${updated.assigneeRejectedReason}`,
          };
        }
        return {
          kind: "updated_task",
          taskId: updated.taskId,
          dependentAutostartDeferred: updated.dependentAutostartDeferred,
        };
      }
      case "add_comment": {
        const added = executeAddComment(action, input, db);
        return added
          ? { kind: "added_comment" }
          : { kind: "failed", reason: "task_not_found" };
      }
      case "use_skill": {
        const result = executeUseSkill(action, input);
        return { kind: "recorded_skill_use", inserted: result.inserted };
      }
      case "memory_receipt": {
        const result = executeMemoryReceipt(action, input, db);
        return result.runFound
          ? { kind: "recorded_memory_receipt", claimCount: result.claimCount }
          : { kind: "failed", reason: "execution_run_not_found" };
      }
      case "review_candidate": {
        executeReviewCandidate(action, input);
        return { kind: "reviewed_candidate" };
      }
      case "register_artifact": {
        const result = executeRegisterArtifact(action, input, db);
        return result.taskFound
          ? { kind: "registered_artifact" }
          : { kind: "failed", reason: "task_not_found" };
      }
      case "propose_sprint_plan": {
        const planningTask = getTaskRefForActionKey(db, input.taskKey);
        if (!planningTask) return { kind: "failed", reason: "planning_task_not_found" };
        const sprints = action.sprints?.length
          ? action.sprints
          : action.sprint && action.tasks?.length
            ? [{ sequenceNumber: 1, ...action.sprint, tasks: action.tasks }]
            : [];
        if (sprints.length === 0) return { kind: "failed", reason: "empty_sprint_plan" };
        const result = createSprintPlanDrafts({
          companyIdOrSlug: input.companyId,
          companyGoalId: action.companyGoalId,
          planningTaskId: planningTask.id,
          proposedByAgentId: input.agentId,
          drafts: sprints.map((sprint, sprintIndex) => ({
            sequenceNumber: sprint.sequenceNumber ?? sprintIndex + 1,
            sprint: {
              name: sprint.name,
              objective: sprint.objective,
              owner: sprint.owner ?? null,
              startDate: sprint.startDate,
              endDate: sprint.endDate ?? null,
              defaultExecutionEngine: sprint.defaultExecutionEngine ?? null,
              defaultModelLane: sprint.defaultModelLane ?? null,
              successCriteria: sprint.successCriteria ?? [],
              validationChecks: sprint.validationChecks ?? [],
              outOfScope: sprint.outOfScope ?? [],
            },
            tasks: sprint.tasks.map((task, index) => ({
              id: task.id ?? `s${sprint.sequenceNumber ?? sprintIndex + 1}-task-${index + 1}`,
              title: task.title,
              description: task.description,
              assignee: task.assignee ?? null,
              priority: task.priority as TaskPriority | undefined,
              type: task.type as TaskType | undefined,
              executionEngine: task.executionEngine ?? null,
              modelLane: task.modelLane ?? null,
              dependsOn: task.dependsOn ?? [],
              validation: task.validation,
            })),
          })),
        });
        const draftId = result.drafts[0]?.id ?? result.proposalGroupId;
        const closedPlanningTask = closePlanningTaskAfterSprintDraftProposed({
          db,
          taskId: planningTask.id,
          agentId: input.agentId,
          runId: input.runId,
          draftId,
          proposalGroupId: result.proposalGroupId,
          draftCount: result.drafts.length,
          taskCount: result.drafts.reduce((sum, draft) => sum + draft.tasks.length, 0),
          firstSequenceNumber: Math.min(...result.drafts.map((draft) => draft.sequenceNumber)),
        });
        return { kind: "proposed_sprint_plan", draftId, closedPlanningTask };
      }
      case "record_validation_evidence":
      case "record_success_evidence": {
        recordGoalContractEvidence({
          companyIdOrSlug: input.companyId,
          itemId: action.itemId,
          status: action.status ?? "proposed",
          resultText: action.resultText,
          commandExitCode: action.commandExitCode,
          artifactUri: action.artifactUri,
          actorAgentId: input.agentId,
        });
        return { kind: "recorded_goal_evidence" };
      }
      case "mark_goal_complete": {
        const planningTask = getTaskRefForActionKey(db, input.taskKey);
        if (!planningTask) return { kind: "failed", reason: "planning_task_not_found" };
        const result = createGoalCompletionProposal({
          companyIdOrSlug: input.companyId,
          companyGoalId: action.companyGoalId,
          planningTaskId: planningTask.id,
          proposedByAgentId: input.agentId,
          reason: action.reason,
        });
        return { kind: "proposed_goal_completion", draftId: result.draft.id };
      }
      case "propose_memory": {
        const result = executeProposeMemory(action, input, db);
        return result;
      }
      default: {
        const unknown = action as Record<string, unknown>;
        return { kind: "failed", reason: `unknown_action:${String(unknown.action)}` };
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "failed", reason };
  }
}

// Routing table per ins-120-phase3-decisions.md Decision B.
// Unknown categories fall back to the operator and are accepted, not rejected.
const MEMORY_ROUTING_TABLE: Record<string, string> = {
  legal: "Castor",
  financial: "Frank",
  implementation: "Ralph",
  general: PUBLIC_HUMAN_LABEL,
  workflow: PUBLIC_HUMAN_LABEL,
};

// Paths an agent may name as target_source_file. Must be absolute, normalized.
// Any path that does not start with one of these prefixes is rejected.
function getMemoryAllowedSourceFilePrefixes(): string[] {
  return [
    resolveHiveRunnerWorkspaceRoot(),
    path.resolve(process.env.HOME?.trim() || os.homedir(), "wiki"),
  ];
}

function isAllowedSourceFilePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return getMemoryAllowedSourceFilePrefixes().some((prefix) => resolved.startsWith(prefix + path.sep) || resolved === prefix);
}

function resolveMemoryRoutingTarget(category: string | undefined): { target: string; known: boolean } {
  if (!category) return { target: PUBLIC_HUMAN_LABEL, known: false };
  const lower = category.toLowerCase();
  const found = MEMORY_ROUTING_TABLE[lower];
  if (found !== undefined) return { target: found, known: true };
  return { target: PUBLIC_HUMAN_LABEL, known: false };
}

export function executeProposeMemory(
  action: Extract<McAction, { action: "propose_memory" }>,
  input: ExecuteMcActionInput,
  db: Database.Database,
): McActionExecutionOutcome {
  // Edge case 1: Defensive malformed-payload guard. body must be non-blank.
  // (parse-time validateActionFields catches most type errors; this catches whitespace-only bodies
  //  that slip through as truthy strings.)
  const trimmedBody = action.body?.trim();
  if (!trimmedBody) {
    return { kind: "failed", reason: "malformed_payload: body is required and cannot be blank" };
  }

  // Edge case 3: Agent must be in roster for this company.
  const agentRow = db
    .prepare(`SELECT id FROM agents WHERE company_id = ? AND name = ? AND archived_at IS NULL LIMIT 1`)
    .get(input.companyId, input.agentName) as { id: string } | undefined;
  if (!agentRow) {
    return { kind: "failed", reason: `agent_not_in_roster: '${input.agentName}' is not an active agent in this company` };
  }

  // Resolve source_task_id from provenance.task_key (fallback to executing task).
  const provenanceTaskKey = action.provenance?.task_key ?? input.taskKey;
  const sourceTask = getTaskRefForActionKey(db, provenanceTaskKey);

  // Edge case 2: Duplicate pending proposal — same body + source_task_id already in pending state.
  // Decision: reject (return skipped_duplicate). Identical pending proposals from the same task are
  // almost certainly re-runs or duplicate heartbeats, not genuinely different proposals.
  if (sourceTask?.id) {
    const dup = db
      .prepare(
        `SELECT id FROM memory_candidates
         WHERE body = ? AND source_task_id = ? AND company_id = ? AND status = 'pending'
         LIMIT 1`,
      )
      .get(trimmedBody, sourceTask.id, input.companyId) as { id: string } | undefined;
    if (dup) {
      console.warn(
        `[propose_memory] duplicate pending candidate skipped: body matches existing candidate ${dup.id} for task ${sourceTask.id}`,
      );
      return { kind: "skipped_duplicate" };
    }
  }

  // Edge case 4: Unknown category — default to the operator and log a warning.
  const { target: routingTarget, known: knownCategory } = resolveMemoryRoutingTarget(action.category);
  if (action.category && !knownCategory) {
    console.warn(
      `[propose_memory] unknown category '${action.category}' from agent ${input.agentName}; defaulting routing target to ${PUBLIC_HUMAN_LABEL}`,
    );
  }

  // Edge case 5: target_source_file must be within an allowed directory if provided.
  if (action.target_source_file) {
    if (!isAllowedSourceFilePath(action.target_source_file)) {
      return {
        kind: "failed",
        reason: `target_source_file_path_not_allowed: '${action.target_source_file}' is outside the permitted directories`,
      };
    }
  }

  // Resolve source_run_id from provenance.run_id (fallback to executing run).
  // Validate against execution_runs; store NULL if the run doesn't exist (avoids FK violation in tests/edge cases).
  const rawRunId = action.provenance?.run_id ?? input.runId;
  const resolvedRunRow = rawRunId
    ? (db.prepare("SELECT id FROM execution_runs WHERE id = ? LIMIT 1").get(rawRunId) as { id: string } | undefined)
    : undefined;
  const sourceRunId = resolvedRunRow?.id ?? null;

  // Phase 3: query propose_memory_policies for a matching row (role × category).
  // With an empty table this always returns null, ensuring all candidates land as pending.
  const policyRow = db
    .prepare(
      `SELECT mode FROM propose_memory_policies
       WHERE (role = ? OR role = '*')
         AND (category = ? OR category = '*')
       ORDER BY
         CASE WHEN role = '*' THEN 1 ELSE 0 END,
         CASE WHEN category = '*' THEN 1 ELSE 0 END
       LIMIT 1`,
    )
    .get(input.agentName, action.category ?? "*") as { mode: string } | undefined;

  let resolvedMode = policyRow?.mode ?? "pending";

  // Phase 3 guard: mode='auto_approve' must NOT activate while propose_memory_policies is empty.
  // If a policy row somehow delivers auto_approve, treat it as pending and warn.
  // TODO: Remove this guard when a policy-settings UI ships and auto_approve exemptions
  //       are intentionally activated for specific role×category pairs (Phase 4+).
  if (resolvedMode === "auto_approve") {
    console.warn(
      `[propose_memory] auto_approve policy matched for agent=${input.agentName} category=${action.category ?? ""}; ` +
        "treating as pending per Phase 3 guard. Remove guard when policy-settings UI ships.",
    );
    resolvedMode = "pending";
  }

  const candidateId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO memory_candidates
       (id, company_id, body, type, tags, category, status, proposed_by_agent,
        source_task_id, source_run_id, proposed_at, routing_target, scope, target_source_file)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'role_project', ?)`,
  ).run(
    candidateId,
    input.companyId,
    trimmedBody,
    action.type ?? null,
    action.tags?.length ? JSON.stringify(action.tags) : null,
    action.category ?? null,
    input.agentName,
    sourceTask?.id ?? null,
    sourceRunId,
    now,
    routingTarget,
    action.target_source_file ?? null,
  );

  return { kind: "proposed_memory", candidateId, routedTo: routingTarget };
}

export function executeReviewCandidate(
  action: Extract<McAction, { action: "review_candidate" }>,
  input: ExecuteMcActionInput,
) {
  const result = submitCompanyReviewDecision(input.companyId, {
    targetType: action.targetType,
    targetId: action.targetId,
    decision: action.decision,
    reviewerAgentId: input.agentId,
    note: action.note,
    confidence: action.confidence,
    source: "agent",
  });
  closeLearningReviewTaskAfterDecision(input, getOrchestrationDb());
  return result;
}

export function executeUseSkill(
  action: Extract<McAction, { action: "use_skill" }>,
  input: ExecuteMcActionInput,
) {
  return recordExplicitSkillUse({
    companyIdOrSlug: input.companyId,
    skillIdOrSlugOrName: action.skill,
    agentId: input.agentId,
    taskIdOrKey: action.taskKey || input.taskKey,
    heartbeatRunId: input.runId,
    source: "agent",
    note: action.note,
  });
}

export function executeMemoryReceipt(
  action: Extract<McAction, { action: "memory_receipt" }>,
  input: ExecuteMcActionInput,
  db: Database.Database,
): { runFound: boolean; claimCount: number } {
  const executionRunId = input.executionRunId?.trim() || input.runId;
  const row = db
    .prepare("SELECT metadata_json FROM execution_runs WHERE id = ? LIMIT 1")
    .get(executionRunId) as { metadata_json: string | null } | undefined;
  if (!row) return { runFound: false, claimCount: 0 };

  const metadata = parseJson(row.metadata_json);
  const taskKey = action.taskKey?.trim() || getFocusedTaskKey(db, input.taskKey) || input.taskKey || null;
  const { patch, claimCount } = buildMemoryUtilizationReceiptMetadataPatch({
    action,
    metadata,
    executionRunId,
    heartbeatRunId: input.runId,
    taskKey,
    agentId: input.agentId,
    agentName: input.agentName,
    recordedAt: new Date().toISOString(),
    receiptId: randomUUID(),
  });
  mergeExecutionRunMetadata(db, executionRunId, patch);
  return { runFound: true, claimCount };
}

function closeLearningReviewTaskAfterDecision(
  input: ExecuteMcActionInput,
  db: Database.Database,
): boolean {
  const taskRef = getTaskRefForActionKey(db, input.taskKey);
  if (!taskRef) return false;
  if (!learningReviewTargetHasDecision(db, taskRef.id)) return false;

  const task = db
    .prepare(
      `SELECT id, project_id, parent_task_id, sprint_id, status
       FROM tasks
       WHERE id = ?
         AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(taskRef.id) as
      | { id: string; project_id: string; parent_task_id: string | null; sprint_id: string | null; status: string }
      | undefined;
  if (!task || task.status === "done" || task.status === "cancelled") return false;

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE tasks
       SET status = 'done',
           blocked_reason = NULL,
           updated_at = ?
     WHERE id = ?`,
  ).run(now, task.id);
  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'done', ?, ?)`,
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    task.status,
    JSON.stringify({ source: "engine_review_candidate_auto_close", runId: input.runId }),
    now,
  );

  if (task.parent_task_id || task.sprint_id) {
    reconcileTaskHierarchy(db, {
      touchedParentTaskIds: [task.parent_task_id],
      touchedSprintIds: [task.sprint_id],
      now,
    });
  }
  return true;
}

function resolveHireRuntimeDefaults(
  action: Extract<McAction, { action: "hire_agent" }>,
  input: { agentId: string; companyId: string },
  db: Database.Database,
): { runtimeProvider?: string; model?: string } {
  const explicitRuntimeProvider =
    typeof action.runtimeProvider === "string" && action.runtimeProvider.trim()
      ? action.runtimeProvider.trim()
      : typeof action.provider === "string" && action.provider.trim()
        ? action.provider.trim()
        : typeof action.adapterType === "string" && action.adapterType.trim()
          ? action.adapterType.trim()
          : "";
  const explicitModel = typeof action.model === "string" && action.model.trim() ? action.model.trim() : "";
  if (explicitRuntimeProvider || explicitModel) {
    return {
      ...(explicitRuntimeProvider ? { runtimeProvider: explicitRuntimeProvider } : {}),
      ...(explicitModel ? { model: explicitModel } : {}),
    };
  }

  const requester = db
    .prepare(
      `SELECT adapter_type, model
       FROM agents a
       WHERE id = ?
         AND company_id = ?
         AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.agentId, input.companyId) as { adapter_type: string | null; model: string | null } | undefined;
  const inheritedProvider = requester?.adapter_type?.trim();
  if (!inheritedProvider || inheritedProvider === "manual") {
    return {};
  }

  return {
    runtimeProvider: inheritedProvider,
    ...(requester?.model?.trim() ? { model: requester.model.trim() } : {}),
  };
}

const VALID_ACTION_TYPES = new Set([
  "create_task",
  "hire_agent",
  "report",
  "update_task",
  "add_comment",
  "use_skill",
  "memory_receipt",
  "review_candidate",
  "register_artifact",
  "propose_sprint_plan",
  "record_validation_evidence",
  "record_success_evidence",
  "mark_goal_complete",
  "propose_memory",
]);


export function emitRunEvent(
  runId: string,
  agentId: string,
  eventType: string,
  detail: string,
  db: Database.Database,
): void {
  try {
    db.prepare(
      `INSERT INTO heartbeat_run_events (id, run_id, agent_id, event_type, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), runId, agentId, eventType, detail, new Date().toISOString());
  } catch {
    // Non-fatal — event emission should never break the run
  }
}

export function getActionTarget(action: McAction): string {
  switch (action.action) {
    case "create_task": return (action.title ?? "").slice(0, 50);
    case "hire_agent": return `${action.name} (${action.role})`;
    case "report": return (action.summary ?? "").slice(0, 50);
    case "update_task": return action.taskKey ?? "";
    case "add_comment": return action.taskKey ?? "";
    case "use_skill": return action.skill ?? "";
    case "memory_receipt": return action.taskKey ?? "";
    case "review_candidate": return `${action.targetType}:${action.targetId}`;
    case "register_artifact": return action.taskKey ?? "";
    case "propose_sprint_plan": return action.companyGoalId ?? "";
    case "mark_goal_complete": return action.companyGoalId ?? "";
    case "record_validation_evidence":
    case "record_success_evidence": return action.itemId ?? "";
    case "propose_memory": return (action.category ?? "general") + ":" + action.body.slice(0, 40);
    default: return "";
  }
}

export function actionFingerprint(action: McAction): string {
  switch (action.action) {
    case "create_task":
      return `create_task:${action.title?.toLowerCase().trim()}`;
    case "hire_agent":
      return `hire_agent:${action.name?.toLowerCase().trim()}:${action.role?.toLowerCase().trim()}`;
    case "report":
      return `report:${action.summary?.slice(0, 50).toLowerCase().trim()}`;
    case "update_task":
      return `update_task:${action.taskKey}:${action.status ?? ""}:${action.comment?.slice(0, 30) ?? ""}`;
    case "add_comment":
      return `add_comment:${action.taskKey}:${action.body?.slice(0, 30)}`;
    case "use_skill":
      return `use_skill:${action.taskKey ?? ""}:${action.skill}:${action.note?.slice(0, 30) ?? ""}`;
    case "memory_receipt":
      return `memory_receipt:${action.taskKey ?? ""}:${JSON.stringify({
        used: action.used ?? [],
        ignored: action.ignored ?? [],
        irrelevant: action.irrelevant ?? [],
      }).slice(0, 160)}`;
    case "review_candidate":
      return `review_candidate:${action.targetType}:${action.targetId}:${action.decision}:${action.note?.slice(0, 30) ?? ""}`;
    case "register_artifact":
      return `register_artifact:${action.taskKey}:${action.uri}`;
    case "propose_sprint_plan":
      return `propose_sprint_plan:${action.companyGoalId}:${(action.sprints?.map((sprint) => `${sprint.sequenceNumber ?? ""}:${sprint.name}`).join("|") ?? action.sprint?.name ?? "").toLowerCase().trim()}`;
    case "mark_goal_complete":
      return `mark_goal_complete:${action.companyGoalId}:${action.reason?.slice(0, 80).toLowerCase().trim() ?? ""}`;
    case "record_validation_evidence":
    case "record_success_evidence":
      return `${action.action}:${action.itemId}:${action.status ?? "proposed"}:${action.resultText?.slice(0, 30) ?? ""}`;
    case "propose_memory":
      return `propose_memory:${action.category ?? ""}:${action.body.slice(0, 60).toLowerCase().trim()}`;
    default:
      return `unknown:${JSON.stringify(action).slice(0, 50)}`;
  }
}

function assistantMessageFingerprint(messages: SessionGetMessage[]): string {
  return JSON.stringify(extractAssistantTexts(messages));
}

export function extractAssistantTexts(messages: SessionGetMessage[]): string[] {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => {
      if (typeof message.content === "string") {
        return [message.content];
      }
      if (Array.isArray(message.content)) {
        // Concatenate all text blocks within a single assistant message.
        // OpenClaw's gateway can split one assistant turn across multiple
        // text blocks when streaming, which would otherwise fragment an
        // `mc-action` fence across block boundaries and cause the regex
        // to find zero matches. Joining per-message preserves message
        // boundaries (so separate assistant turns are still separate
        // strings) while keeping a single turn's fences intact.
        const combined = message.content
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text as string)
          .join("");
        return combined ? [combined] : [];
      }
      return [];
    })
    .map((text) => text.trim())
    .filter(Boolean);
}

export function loadStoredSessionMessages(sessionId: string, sessionKey: string): SessionGetMessage[] {
  const openclawAgentId = sessionKey.match(/^agent:([^:]+):/)?.[1];
  const candidatePaths = [
    openclawAgentId ? path.join(OPENCLAW_HOME, "agents", openclawAgentId, "sessions", `${sessionId}.jsonl`) : null,
    path.join(OPENCLAW_HOME, "agents", "main", "sessions", `${sessionId}.jsonl`),
  ].filter((value): value is string => Boolean(value));

  for (const filePath of candidatePaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf-8");
      const lines = raw.split("\n").filter(Boolean);
      const messages: SessionGetMessage[] = [];
      for (const line of lines) {
        const parsed = JSON.parse(line) as {
          type?: string;
          message?: SessionGetMessage;
        };
        if (parsed.type !== "message" || !parsed.message) continue;
        messages.push(parsed.message);
      }
      if (messages.length > 0) {
        return messages;
      }
    } catch {
      // Keep fallback silent — gateway payload remains the primary source.
    }
  }

  return [];
}

async function getSessionListEntry(
  sessionKey: string,
  execFileAsync: (cmd: string, args: string[], opts: { maxBuffer: number; env: NodeJS.ProcessEnv | undefined }) => Promise<{ stdout: string }>
): Promise<SessionListEntry | undefined> {
  const payload = await callGateway<{ sessions?: SessionListEntry[] } | SessionListEntry[]>(
    OPENCLAW_BIN,
    "sessions.list",
    {},
    execFileAsync
  );

  if (!payload) return undefined;

  const sessions = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.sessions)
      ? payload.sessions
      : [];

  return sessions.find((session) => session?.key === sessionKey);
}

export async function waitForSessionCompletion(
  _command: string,
  sessionKey: string,
  execFileAsync: (cmd: string, args: string[], opts: { maxBuffer: number; env: NodeJS.ProcessEnv | undefined }) => Promise<{ stdout: string }>
): Promise<unknown> {
  // Poll sessions.get until session is terminal or idle with new output.
  // Terminal statuses: done, completed, failed, error, cancelled
  // Idle heuristic: status is null/missing AND session has assistant messages
  //   (agent finished a quick turn without the status reaching "done")
  const timeoutMs = sessionCompletionTimeoutMs();
  const pollMs = sessionPollIntervalMs();
  const deadline = Date.now() + timeoutMs;
  let sawRunning = false;
  let lastAssistantFingerprint = "";
  let stableAssistantPolls = 0;
  let attempt = 0;

  while (Date.now() < deadline) {
    try {
      const data = await callGateway<Record<string, unknown>>(
        OPENCLAW_BIN,
        "sessions.get",
        { key: sessionKey },
        execFileAsync
      );
      const listEntry = await getSessionListEntry(sessionKey, execFileAsync);
      const status = typeof data?.status === "string" ? data.status.toLowerCase() : undefined;
      const listStatus = typeof listEntry?.status === "string" ? listEntry.status.toLowerCase() : undefined;
      const messages = Array.isArray(data?.messages) ? data.messages as SessionGetMessage[] : [];
      const assistantFingerprint = assistantMessageFingerprint(messages);
      const hasAssistantOutput = assistantFingerprint !== "[]";
      const hasActiveStatus = isActiveSessionStatus(status) || isActiveSessionStatus(listStatus);
      const merged = {
        ...(data ?? {}),
        ...(listEntry?.sessionId ? { sessionId: data?.sessionId ?? listEntry.sessionId } : {}),
        ...(listStatus ? { status: listStatus } : {}),
      };

      // Explicit terminal
      if (isTerminalSessionStatus(status)) {
        return merged;
      }
      if (isTerminalSessionStatus(listStatus)) {
        if (hasAssistantOutput || attempt > 0) {
          return merged;
        }
      }

      // Track if we've seen the session enter "running" state
      if (hasActiveStatus) {
        sawRunning = true;
      }

      if (assistantFingerprint && assistantFingerprint === lastAssistantFingerprint) {
        stableAssistantPolls += 1;
      } else {
        stableAssistantPolls = 0;
        lastAssistantFingerprint = assistantFingerprint;
      }

      // Idle heuristic: if the gateway stops reporting status but assistant
      // output is stable across polls, treat the turn as complete.
      if (hasAssistantOutput && !status && !listStatus && (sawRunning || stableAssistantPolls >= 1)) {
        return merged;
      }

      // sessions.get can stay blank while sessions.list has already moved on.
      // Once list reports a different session or endedAt timestamp for this key,
      // we treat the prior turn as done if assistant output exists.
      if (hasAssistantOutput && listEntry && listEntry.endedAt && !listStatus) {
        return merged;
      }
      if (hasAssistantOutput && listEntry?.startedAt && !listEntry.endedAt && !hasActiveStatus && stableAssistantPolls >= 2) {
        return merged;
      }

      if (!data && listEntry && isFinite(Number(listEntry.endedAt))) {
        return { ...merged };
      }

      if (!data && listEntry?.status && isTerminalSessionStatus(listEntry.status.toLowerCase())) {
        return { ...merged };
      }

      if (!data && listEntry?.status && isActiveSessionStatus(listEntry.status.toLowerCase())) {
        sawRunning = true;
      }

      if (!data && !listEntry) {
        if (attempt >= 2) {
          return null;
        }
      }

      // Not done yet.
      attempt += 1;
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    } catch {
      attempt += 1;
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    }
  }
  // Timeout — return terminal output if it landed on the final check. If the
  // session is still active, mark the payload so import does not mistake a
  // partial progress note for the final answer.
  try {
    const data = await callGateway<Record<string, unknown>>(
      OPENCLAW_BIN,
      "sessions.get",
      { key: sessionKey },
      execFileAsync
    );
    const listEntry = await getSessionListEntry(sessionKey, execFileAsync);
    const status = typeof data?.status === "string" ? data.status.toLowerCase() : undefined;
    const listStatus = typeof listEntry?.status === "string" ? listEntry.status.toLowerCase() : undefined;
    const merged = {
      ...(data ?? {}),
      ...(listEntry?.sessionId ? { sessionId: (data as Record<string, unknown> | undefined)?.sessionId ?? listEntry.sessionId } : {}),
      ...(listEntry?.status ? { status: (data as Record<string, unknown> | undefined)?.status ?? listEntry.status } : {}),
    };
    if (isTerminalSessionStatus(status) || isTerminalSessionStatus(listStatus)) {
      return merged;
    }
    return {
      ...merged,
      __sessionCompletionTimedOut: true,
    };
  } catch {
    return { __sessionCompletionTimedOut: true };
  }
}

export function parseActionsFromText(text: string): { actions: McAction[]; plainText: string; parseErrors: string[] } {
  const actions: McAction[] = [];
  const parseErrors: string[] = [];
  // Match ```mc-action ... ``` blocks (tolerant of extra whitespace and optional language tag)
  const pattern = /```mc-action[^\n]*\n([\s\S]*?)```/g;
  let plainText = text;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const jsonStr = match[1].trim();
    if (!jsonStr) {
      parseErrors.push("Empty mc-action block");
      plainText = plainText.replace(match[0], "");
      continue;
    }
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed || typeof parsed !== "object") {
        parseErrors.push(`mc-action block is not an object: ${jsonStr.slice(0, 80)}`);
        plainText = plainText.replace(match[0], "");
        continue;
      }
      if (!parsed.action || typeof parsed.action !== "string") {
        parseErrors.push(`mc-action block missing 'action' field: ${jsonStr.slice(0, 80)}`);
        plainText = plainText.replace(match[0], "");
        continue;
      }
      if (!VALID_ACTION_TYPES.has(parsed.action)) {
        parseErrors.push(`Unknown action type '${parsed.action}'`);
        plainText = plainText.replace(match[0], "");
        continue;
      }
      // Validate required fields per action type
      const validationError = validateActionFields(parsed);
      if (validationError) {
        parseErrors.push(validationError);
        plainText = plainText.replace(match[0], "");
        continue;
      }
      actions.push(parsed as McAction);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      parseErrors.push(`Invalid JSON in mc-action block: ${msg}`);
    }
    plainText = plainText.replace(match[0], "");
  }

  return { actions, plainText, parseErrors };
}

function validateActionFields(parsed: Record<string, unknown>): string | null {
  switch (parsed.action) {
    case "create_task":
      if (!parsed.title || typeof parsed.title !== "string") return "create_task: 'title' is required";
      if (parsed.dependsOn !== undefined) {
        if (!Array.isArray(parsed.dependsOn)) return "create_task: 'dependsOn' must be an array of task keys";
        if (!parsed.dependsOn.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
          return "create_task: 'dependsOn' must contain only non-empty task key strings";
        }
      }
      if (parsed.labels !== undefined) {
        if (!Array.isArray(parsed.labels)) return "create_task: 'labels' must be an array of labels";
        if (!parsed.labels.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
          return "create_task: 'labels' must contain only non-empty label strings";
        }
      }
      if (parsed.executionEngine !== undefined && !normalizeCreateTaskExecutionEngine(parsed.executionEngine)) {
        return "create_task: 'executionEngine' must be 'hiverunner', 'symphony', or 'manual'";
      }
      if (parsed.modelLane !== undefined) {
        if (typeof parsed.modelLane !== "string") return "create_task: 'modelLane' must be 'default', 'fast', 'mini', or 'deep'";
        const modelLane = parsed.modelLane.trim().toLowerCase();
        if (modelLane !== "default" && modelLane !== "fast" && modelLane !== "mini" && modelLane !== "deep") {
          return "create_task: 'modelLane' must be 'default', 'fast', 'mini', or 'deep'";
        }
      }
      if (parsed.status !== undefined && !normalizeCreateTaskStatus(parsed.status)) {
        return "create_task: 'status' must be backlog, to-do, in-progress, review, done, or blocked";
      }
      break;
    case "hire_agent":
      if (!parsed.name || typeof parsed.name !== "string") return "hire_agent: 'name' is required";
      if (!parsed.role || typeof parsed.role !== "string") return "hire_agent: 'role' is required";
      break;
    case "report":
      if (!parsed.summary || typeof parsed.summary !== "string") return "report: 'summary' is required";
      break;
    case "update_task":
      if (!parsed.taskKey || typeof parsed.taskKey !== "string") return "update_task: 'taskKey' is required";
      if (!parsed.status && !parsed.comment) return "update_task: must provide 'status' or 'comment'";
      break;
    case "add_comment":
      if (!parsed.taskKey || typeof parsed.taskKey !== "string") return "add_comment: 'taskKey' is required";
      if (!parsed.body || typeof parsed.body !== "string") return "add_comment: 'body' is required";
      if (parsed.source !== undefined && typeof parsed.source !== "string") return "add_comment: 'source' must be a string";
      break;
    case "use_skill":
      if (!parsed.skill || typeof parsed.skill !== "string") return "use_skill: 'skill' is required";
      if (parsed.taskKey !== undefined && typeof parsed.taskKey !== "string") return "use_skill: 'taskKey' must be a string";
      if (parsed.note !== undefined && typeof parsed.note !== "string") return "use_skill: 'note' must be a string";
      break;
    case "memory_receipt": {
      const error = validateMemoryReceiptActionFields(parsed);
      if (error) return error;
      break;
    }
    case "review_candidate":
      if (parsed.targetType !== "memory" && parsed.targetType !== "skill") {
        return "review_candidate: 'targetType' must be 'memory' or 'skill'";
      }
      if (!parsed.targetId || typeof parsed.targetId !== "string") return "review_candidate: 'targetId' is required";
      if (parsed.decision !== "approve" && parsed.decision !== "reject") {
        return "review_candidate: 'decision' must be 'approve' or 'reject'";
      }
      if (parsed.note !== undefined && typeof parsed.note !== "string") return "review_candidate: 'note' must be a string";
      if (parsed.confidence !== undefined) {
        const confidence = Number(parsed.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
          return "review_candidate: 'confidence' must be a number from 0 to 1";
        }
      }
      break;
    case "register_artifact":
      if (!parsed.taskKey || typeof parsed.taskKey !== "string") return "register_artifact: 'taskKey' is required";
      if (!parsed.uri || typeof parsed.uri !== "string") return "register_artifact: 'uri' is required";
      if (parsed.kind !== undefined && typeof parsed.kind !== "string") return "register_artifact: 'kind' must be a string";
      if (parsed.sha256 !== undefined && typeof parsed.sha256 !== "string") return "register_artifact: 'sha256' must be a string";
      break;
    case "propose_sprint_plan": {
      if (!parsed.companyGoalId || typeof parsed.companyGoalId !== "string") return "propose_sprint_plan: 'companyGoalId' is required";
      const validateTask = (task: unknown): string | null => {
        if (!task || typeof task !== "object") return "propose_sprint_plan: every task must be an object";
        const taskRecord = task as Record<string, unknown>;
        if (!taskRecord.title || typeof taskRecord.title !== "string") return "propose_sprint_plan: every task requires a title";
        if (taskRecord.priority !== undefined && !["P0", "P1", "P2", "P3"].includes(String(taskRecord.priority))) {
          return "propose_sprint_plan: task priority must be P0, P1, P2, or P3";
        }
        if (taskRecord.type !== undefined && !CANONICAL_TASK_TYPES.has(String(taskRecord.type))) {
          return "propose_sprint_plan: task type is invalid";
        }
        return null;
      };
      if (Array.isArray(parsed.sprints) && parsed.sprints.length > 0) {
        const seen = new Set<number>();
        for (const sprintValue of parsed.sprints) {
          if (!sprintValue || typeof sprintValue !== "object") return "propose_sprint_plan: every sprint must be an object";
          const sprint = sprintValue as Record<string, unknown>;
          if (!sprint.name || typeof sprint.name !== "string") return "propose_sprint_plan: every sprint requires a name";
          if (!sprint.objective || typeof sprint.objective !== "string") return "propose_sprint_plan: every sprint requires an objective";
          const sequence = Number(sprint.sequenceNumber ?? seen.size + 1);
          if (!Number.isInteger(sequence) || sequence < 1) return "propose_sprint_plan: sprint sequenceNumber must be a positive integer";
          if (seen.has(sequence)) return "propose_sprint_plan: sprint sequenceNumber values must be unique";
          seen.add(sequence);
          if (!Array.isArray(sprint.tasks) || sprint.tasks.length === 0) return "propose_sprint_plan: every sprint requires tasks";
          for (const task of sprint.tasks) {
            const taskError = validateTask(task);
            if (taskError) return taskError;
          }
        }
      } else {
        if (!parsed.sprint || typeof parsed.sprint !== "object") return "propose_sprint_plan: 'sprint' is required";
        const sprint = parsed.sprint as Record<string, unknown>;
        if (!sprint.name || typeof sprint.name !== "string") return "propose_sprint_plan: 'sprint.name' is required";
        if (!sprint.objective || typeof sprint.objective !== "string") return "propose_sprint_plan: 'sprint.objective' is required";
        if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) return "propose_sprint_plan: 'tasks' must contain at least one task";
        for (const task of parsed.tasks) {
          const taskError = validateTask(task);
          if (taskError) return taskError;
        }
      }
      break;
    }
    case "record_validation_evidence":
    case "record_success_evidence":
      if (!parsed.itemId || typeof parsed.itemId !== "string") {
        return `${String(parsed.action)}: 'itemId' is required`;
      }
      if (parsed.status !== undefined && parsed.status !== "proposed" && parsed.status !== "failed") {
        return `${String(parsed.action)}: agents may only record 'proposed' or 'failed' evidence`;
      }
      if (parsed.resultText !== undefined && typeof parsed.resultText !== "string") {
        return `${String(parsed.action)}: 'resultText' must be a string`;
      }
      if (parsed.artifactUri !== undefined && typeof parsed.artifactUri !== "string") {
        return `${String(parsed.action)}: 'artifactUri' must be a string`;
      }
      if (parsed.commandExitCode !== undefined) {
        const exitCode = Number(parsed.commandExitCode);
        if (!Number.isFinite(exitCode)) return `${String(parsed.action)}: 'commandExitCode' must be a number`;
      }
      break;
    case "mark_goal_complete":
      if (!parsed.companyGoalId || typeof parsed.companyGoalId !== "string") return "mark_goal_complete: 'companyGoalId' is required";
      if (!parsed.reason || typeof parsed.reason !== "string") return "mark_goal_complete: 'reason' is required";
      break;
    case "propose_memory":
      if (!parsed.body || typeof parsed.body !== "string") return "propose_memory: 'body' is required (string)";
      if (!(parsed.body as string).trim()) return "propose_memory: 'body' cannot be blank or whitespace-only";
      if (parsed.type !== undefined && typeof parsed.type !== "string") return "propose_memory: 'type' must be a string";
      if (parsed.tags !== undefined) {
        if (!Array.isArray(parsed.tags)) return "propose_memory: 'tags' must be an array of strings";
        if (!parsed.tags.every((t) => typeof t === "string")) return "propose_memory: 'tags' must contain only strings";
      }
      if (parsed.category !== undefined && typeof parsed.category !== "string") return "propose_memory: 'category' must be a string";
      if (parsed.target_source_file !== undefined && typeof parsed.target_source_file !== "string") return "propose_memory: 'target_source_file' must be a string";
      if (parsed.provenance !== undefined) {
        if (typeof parsed.provenance !== "object" || parsed.provenance === null) return "propose_memory: 'provenance' must be an object";
        const prov = parsed.provenance as Record<string, unknown>;
        if (prov.task_key !== undefined && typeof prov.task_key !== "string") return "propose_memory: 'provenance.task_key' must be a string";
        if (prov.run_id !== undefined && typeof prov.run_id !== "string") return "propose_memory: 'provenance.run_id' must be a string";
        if (prov.agent !== undefined && typeof prov.agent !== "string") return "propose_memory: 'provenance.agent' must be a string";
      }
      break;
  }
  return null;
}

function warnIfStuckLeadSprintProposalComment(input: {
  db: Database.Database;
  taskId: string;
  agentId: string;
  body: string;
  now: string;
}): void {
  const lowerBody = input.body.toLowerCase();
  if (!lowerBody.includes("sprint plan proposed") && !lowerBody.includes("re-proposed") && !lowerBody.includes("propose")) {
    return;
  }

  const planningTask = input.db
    .prepare(
      `SELECT id, task_key, title
       FROM tasks
       WHERE id = ?
         AND labels_json LIKE '%sprint-planning%'
       LIMIT 1`
    )
    .get(input.taskId) as { id: string; task_key: string | null; title: string } | undefined;
  if (!planningTask) return;

  const existingDraft = input.db
    .prepare(
      `SELECT id
       FROM goal_sprint_plan_drafts
       WHERE planning_task_id = ?
       LIMIT 1`
    )
    .get(input.taskId) as { id: string } | undefined;
  if (existingDraft) return;

  const windowStart = new Date(Date.parse(input.now) - 5 * 60 * 1000).toISOString();
  const recent = input.db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM comments
       WHERE task_id = ?
         AND author_agent_id = ?
         AND created_at >= ?
         AND (
           lower(body) LIKE '%sprint plan proposed%'
           OR lower(body) LIKE '%re-proposed%'
           OR lower(body) LIKE '%propose%'
         )`
    )
    .get(input.taskId, input.agentId, windowStart) as { count: number } | undefined;

  if ((recent?.count ?? 0) > 2) {
    console.warn("[stuck-lead-proposal]", {
      taskId: input.taskId,
      taskKey: planningTask.task_key,
      agentId: input.agentId,
      commentCount: recent?.count ?? 0,
      windowStart,
      message: "Lead planning task is receiving proposal prose comments without a propose_sprint_plan draft.",
    });
  }
}

export function importCommentOnTask(
  taskId: string,
  agentId: string,
  body: string,
  type: string,
  runId: string,
  db: Database.Database,
  source = "openclaw"
): void {
  // Resolve task — caller may pass either a task id or a task_key
  const task = (
    db.prepare("SELECT id, project_id FROM tasks WHERE id = ? LIMIT 1").get(taskId) ??
    db.prepare("SELECT id, project_id FROM tasks WHERE task_key = ? LIMIT 1").get(taskId)
  ) as { id: string; project_id: string } | undefined;
  if (!task || !task.id) return;

  // ── Cross-run dedup: content-based fingerprint ──
  // Hash the first 200 chars of the body to detect near-identical comments
  // Use resolved task.id for all DB operations (caller may have passed a task_key)
  const resolvedId = task.id;
  const sanitized = sanitizeAgentCommentLinks(body);
  const commentBody = sanitized.body;
  if (sanitized.invalidLinks.length > 0) {
    console.warn("[engine:link-verification] withheld agent comment with invalid external links", {
      taskId: resolvedId,
      source,
      invalidLinks: sanitized.invalidLinks.map((link) => ({ url: link.url, status: link.status, reason: link.reason })),
    });
  }

  const bodyFingerprint = createHash("sha1").update(commentBody.slice(0, 200).toLowerCase().trim()).digest("hex").slice(0, 16);
  const externalRef = `engine:comment:${resolvedId.slice(0, 8)}:${bodyFingerprint}`;

  // Check if a comment with this fingerprint already exists
  const existing = db
    .prepare(
      `SELECT id FROM comments
       WHERE task_id = ? AND source = ? AND external_ref = ?
       LIMIT 1`
    )
    .get(resolvedId, source, externalRef) as { id: string } | undefined;

  if (existing) {
    console.log(`[engine:dedup] skipped duplicate comment on ${resolvedId.slice(0, 8)} (fingerprint: ${bodyFingerprint})`);
    return;
  }

  const now = new Date().toISOString();
  const commentId = randomUUID();

  db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(commentId, resolvedId, agentId, commentBody, type, source, externalRef, now, now);

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`
  ).run(randomUUID(), task.project_id, resolvedId, agentId, JSON.stringify({ source: "engine_heartbeat", runId }), now);

  warnIfStuckLeadSprintProposalComment({
    db,
    taskId: resolvedId,
    agentId,
    body: commentBody,
    now,
  });
}

function autoStartAssignedTask(input: {
  taskId: string;
  projectId: string;
  companyId: string;
  assigneeId: string;
  sourceAgentId: string;
  runId: string;
  initialStatus: "to-do" | "in_progress";
  executionProvider?: ExecutionRunProvider | null;
  executionEngine?: TaskExecutionEngine | null;
  modelLane?: TaskModelLane | null;
  db: Database.Database;
}): { started: boolean; reason: string } {
  const db = input.db;
  const assignee = db.prepare(
    `SELECT
       a.status,
       EXISTS(
         SELECT 1
         FROM approvals ap
         WHERE ap.type = 'hire_agent'
           AND ap.company_id = a.company_id
           AND ap.status IN ('pending', 'revision_requested')
           AND json_extract(ap.payload_json, '$.agentId') = a.id
       ) AS has_pending_hire_approval,
       a.adapter_type,
       a.model
     FROM agents a
     WHERE a.id = ? AND a.archived_at IS NULL
     LIMIT 1`
  ).get(input.assigneeId) as { status: string; has_pending_hire_approval: number; adapter_type: string | null; model: string | null } | undefined;

  if (!assignee) return { started: false, reason: "assignee_not_found" };
  if (assignee.status === "paused" || assignee.status === "offline" || assignee.status === "error") {
    return { started: false, reason: `assignee_${assignee.status}` };
  }
  if (assignee.has_pending_hire_approval) return { started: false, reason: "assignee_pending_hire_approval" };
  const taskExecution = taskExecutionPolicyForWakeup({
    db,
    taskId: input.taskId,
    assigneeAdapterType: assignee.adapter_type,
    assigneeModel: assignee.model,
  });
  const provider = input.executionProvider ?? taskExecution.executionProvider;
  const executionEngine = input.executionEngine ?? taskExecution.executionEngine;
  const modelLane = normalizeTaskModelLane(input.modelLane ?? taskExecution.modelLane);
  const runnerProvider = taskExecution.runnerProvider ?? provider;
  if (!provider) {
    emitRunEvent(
      input.runId,
      input.sourceAgentId,
      "action_skipped",
      `Assigned task wakeup skipped: target agent has no executable runtime (${runtimeProviderLabel(assignee.adapter_type)}).`,
      db,
    );
    return { started: false, reason: "assignee_runtime_not_executable" };
  }

  const now = new Date().toISOString();
  if (input.initialStatus === "to-do") {
    const taskRow = db.prepare(
      `SELECT status FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1`
    ).get(input.taskId) as { status: string } | undefined;

    if (taskRow?.status === "to-do") {
      db.prepare(
        `UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'to-do'`
      ).run(now, input.taskId);

      db.prepare(
        `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'to-do', 'in_progress', ?, ?)`
      ).run(
        randomUUID(),
        input.projectId,
        input.taskId,
        input.sourceAgentId,
        JSON.stringify({ source: "engine_auto_assignment", runId: input.runId }),
        now,
      );
    }
  }

  const existingExecutionRun = db.prepare(
    `SELECT id
     FROM execution_runs
     WHERE task_id = ? AND provider = ? AND status IN ('pending', 'running')
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(input.taskId, provider) as { id: string } | undefined;

  const idempotencyKey = `engine-auto-task:${input.taskId}`;
  const executionRunId = existingExecutionRun?.id ?? randomUUID();
  if (!existingExecutionRun) {
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, execution_engine, runner_provider, model_lane, status, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(
      executionRunId,
      input.taskId,
      input.assigneeId,
      provider,
      executionEngine,
      runnerProvider,
      modelLane,
      idempotencyKey,
      now,
      now,
    );
  }

  const wake = enqueueWakeup(
    {
      agentId: input.assigneeId,
      companyId: input.companyId,
      source: "issue_assigned",
      reason: "engine_auto_task_assignment",
      payload: {
        taskId: input.taskId,
        taskStatus: "in_progress",
        projectId: input.projectId,
        executionEngine,
        modelLane,
        executionProvider: provider,
        runnerProvider,
        modelRouting: taskExecution.modelRouting,
        modelRoutingLabel: taskExecution.modelRoutingLabel,
        activeHiveId: taskExecution.activeHiveId,
        activeHiveName: taskExecution.activeHiveName,
        executionRunId,
      },
      idempotencyKey,
    },
    db,
  );

  if (wake.heartbeatRunId && (wake.status === "queued" || wake.status === "coalesced")) {
    // Do not execute nested heartbeats inline.
    // Let the engine tick pick this run up automatically so the parent agent
    // can finish importing its own actions and clear live state truthfully.
    emitRunEvent(
      input.runId,
      input.sourceAgentId,
      "action_executed",
      `Queued ${input.assigneeId === input.sourceAgentId ? "self" : "agent"} wakeup for assigned task`,
      db,
    );
  }
  return { started: wake.status === "queued" || wake.status === "coalesced", reason: wake.status };
}

function recoverNewAssignedTaskAutoStartFailure(input: {
  taskId: string;
  taskKey: string;
  projectId: string;
  companyId: string;
  originalAssigneeId: string;
  sourceAgentId: string;
  runId: string;
  initialStatus: "to-do" | "in_progress";
  failureReason: string;
  executionEngine: TaskExecutionEngine;
  modelLane: TaskModelLane;
  db: Database.Database;
}): void {
  const fallback = findNextResilienceAssignee(input.db, {
    taskId: input.taskId,
    excludeAgentIds: [input.originalAssigneeId],
  });
  const now = new Date().toISOString();

  if (!fallback) {
    const changed = input.db
      .prepare(
        `UPDATE tasks
         SET status = 'blocked',
             blocked_reason = ?,
             updated_at = ?
         WHERE id = ?
           AND archived_at IS NULL
           AND status IN ('to-do', 'in_progress')`,
      )
      .run(`Needs routing: assigned agent could not be woken (${input.failureReason}).`, now, input.taskId);
    if (changed.changes > 0) {
      input.db
        .prepare(
          `INSERT INTO task_events
            (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
           VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'blocked', ?, ?)`,
        )
        .run(
          randomUUID(),
          input.projectId,
          input.taskId,
          input.sourceAgentId,
          input.initialStatus,
          JSON.stringify({
            source: "engine_auto_assignment_unavailable",
            assigneeAgentId: input.originalAssigneeId,
            autoStartFailureReason: input.failureReason,
            runId: input.runId,
          }),
          now,
        );
      input.db
        .prepare(
          `INSERT INTO comments
            (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.taskId,
          `[AUTO_ASSIGNMENT] Assigned agent could not be woken after task creation (${input.failureReason}). No eligible online fallback was available, so this task was marked blocked for routing.`,
          `engine:create-task-routing-blocked:${input.runId}:${input.taskId}`,
          now,
          now,
        );
    }
    emitRunEvent(
      input.runId,
      input.sourceAgentId,
      "action_skipped",
      `create_task ${input.taskKey}: assigned agent could not be woken (${input.failureReason}) and no fallback was available.`,
      input.db,
    );
    return;
  }

  input.db
    .prepare(
      `UPDATE tasks
       SET assignee_agent_id = ?,
           assigned_at = ?,
           updated_at = ?
       WHERE id = ?
         AND archived_at IS NULL
         AND assignee_agent_id = ?`,
    )
    .run(fallback.id, now, now, input.taskId, input.originalAssigneeId);
  input.db
    .prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.reassigned', ?, ?)`,
    )
    .run(
      randomUUID(),
      input.projectId,
      input.taskId,
      fallback.id,
      JSON.stringify({
        source: "create_task_unavailable_assignee_fallback",
        from: input.originalAssigneeId,
        to: fallback.id,
        autoStartFailureReason: input.failureReason,
        runId: input.runId,
      }),
      now,
    );
  input.db
    .prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      input.taskId,
      `[AUTO_ASSIGNMENT] Assigned agent could not be woken after task creation (${input.failureReason}). Reassigned to ${fallback.name} and queued immediately.`,
      `engine:create-task-fallback:${input.runId}:${input.taskId}`,
      now,
      now,
    );

  const fallbackStart = autoStartAssignedTask({
    taskId: input.taskId,
    projectId: input.projectId,
    companyId: input.companyId,
    assigneeId: fallback.id,
    sourceAgentId: input.sourceAgentId,
    runId: input.runId,
    initialStatus: input.initialStatus,
    executionEngine: input.executionEngine,
    modelLane: input.modelLane,
    db: input.db,
  });
  if (!fallbackStart.started) {
    input.db
      .prepare(
        `UPDATE tasks
         SET status = 'blocked',
             blocked_reason = ?,
             updated_at = ?
         WHERE id = ?
           AND archived_at IS NULL
           AND status IN ('to-do', 'in_progress')`,
      )
      .run(`Needs routing: fallback agent could not be woken (${fallbackStart.reason}).`, now, input.taskId);
    input.db
      .prepare(
        `INSERT INTO comments
          (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.taskId,
        `[AUTO_ASSIGNMENT] Fallback assignee ${fallback.name} could not be woken after reassignment (${fallbackStart.reason}). Marked blocked for routing.`,
        `engine:create-task-fallback-blocked:${input.runId}:${input.taskId}`,
        now,
        now,
      );
  }
  emitRunEvent(
    input.runId,
    input.sourceAgentId,
    fallbackStart.started ? "action_executed" : "action_skipped",
    fallbackStart.started
      ? `create_task ${input.taskKey}: reassigned unavailable assignee to ${fallback.name} and queued wakeup.`
      : `create_task ${input.taskKey}: fallback ${fallback.name} could not be woken (${fallbackStart.reason}).`,
    input.db,
  );
}

function executionProviderForTaskAutoStart(input: {
  db: Database.Database;
  taskId: string;
  assigneeAdapterType: string | null | undefined;
}): ExecutionRunProvider | null {
  const row = input.db
    .prepare(
      `SELECT
         COALESCE(t.company_id, p.company_id) AS company_id,
         t.execution_engine,
         t.model_lane,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE t.id = ? AND t.archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskId) as
      | {
          execution_engine: TaskExecutionEngine | null;
          company_id: string | null;
          model_lane: string | null;
          project_settings_json: string | null;
          company_settings_json: string | null;
        }
      | undefined;

  if (!row?.company_id) return null;

  const route = resolveExecutionRoute({
    companyId: row.company_id,
    task: {
      modelLane: row.model_lane,
      executionEngine: row.execution_engine,
    },
  }, input.db);
  if (route.executionEngine === "manual") return null;
  if (route.executionEngine === "symphony") return "symphony";
  return route.primary.runtimeProvider;
}

export function pendingDependencyCount(db: Database.Database, dependencyIds: string[]): number {
  if (dependencyIds.length === 0) return 0;
  const placeholders = dependencyIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM tasks
       WHERE id IN (${placeholders})
         AND archived_at IS NULL
         AND status != 'done'`,
    )
    .get(...dependencyIds) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function parseDependencyIds(value: string | null): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "[]");
  } catch {
    parsed = [];
  }
  return Array.isArray(parsed)
    ? parsed.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
    : [];
}

export function autoStartUnblockedDependentTasks(input: {
  completedTaskId: string;
  companyId: string;
  sourceAgentId: string;
  runId: string;
  db: Database.Database;
}): number {
  const rows = input.db
    .prepare(
      `SELECT id, project_id, assignee_agent_id, depends_on_json
       FROM tasks
       WHERE company_id = ?
         AND archived_at IS NULL
         AND status = 'to-do'
         AND assignee_agent_id IS NOT NULL
         AND depends_on_json IS NOT NULL
         AND depends_on_json LIKE ?`,
    )
    .all(input.companyId, `%${input.completedTaskId}%`) as Array<{
      id: string;
      project_id: string;
      assignee_agent_id: string;
      depends_on_json: string | null;
    }>;

  let started = 0;
  for (const row of rows) {
    const dependencyIds = parseDependencyIds(row.depends_on_json);
    if (!dependencyIds.includes(input.completedTaskId)) continue;
    if (pendingDependencyCount(input.db, dependencyIds) > 0) continue;

    let startResult = autoStartAssignedTask({
      taskId: row.id,
      projectId: row.project_id,
      companyId: input.companyId,
      assigneeId: row.assignee_agent_id,
      sourceAgentId: input.sourceAgentId,
      runId: input.runId,
      initialStatus: "to-do",
      db: input.db,
    });
    if (!startResult.started) {
      const fallback = findNextResilienceAssignee(input.db, {
        taskId: row.id,
        excludeAgentIds: [row.assignee_agent_id],
      });
      if (fallback) {
        const now = new Date().toISOString();
        input.db
          .prepare(
            `UPDATE tasks
             SET assignee_agent_id = ?,
                 assigned_at = ?,
                 updated_at = ?
             WHERE id = ?
               AND status = 'to-do'
               AND archived_at IS NULL`,
          )
          .run(fallback.id, now, now, row.id);
        input.db
          .prepare(
            `INSERT INTO task_events
              (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
             VALUES (?, ?, ?, ?, 'task.reassigned', ?, ?)`,
          )
          .run(
            randomUUID(),
            row.project_id,
            row.id,
            fallback.id,
            JSON.stringify({
              source: "dependency_unblock_capable_fallback",
              from: row.assignee_agent_id,
              to: fallback.id,
              completedTaskId: input.completedTaskId,
              autoStartFailureReason: startResult.reason,
              runId: input.runId,
            }),
            now,
          );
        input.db
          .prepare(
            `INSERT INTO comments
              (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
             VALUES (?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            row.id,
            `[AUTO_ASSIGNMENT] Original assignee could not be woken after dependencies cleared (${startResult.reason}). Reassigned to ${fallback.name} and queued immediately.`,
            `engine:dependency-unblock-fallback:${input.runId}:${row.id}`,
            now,
            now,
          );
        startResult = autoStartAssignedTask({
          taskId: row.id,
          projectId: row.project_id,
          companyId: input.companyId,
          assigneeId: fallback.id,
          sourceAgentId: input.sourceAgentId,
          runId: input.runId,
          initialStatus: "to-do",
          db: input.db,
        });
      }
    }
    if (startResult.started) started += 1;
  }
  return started;
}


function normalizeCreateTaskLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const item of value) {
    const label = String(item).trim().replace(/\s+/g, "-").slice(0, 60);
    if (label && !labels.includes(label)) labels.push(label);
    if (labels.length >= 32) break;
  }
  return labels;
}

function normalizeCreateTaskStatus(value: unknown): "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "backlog" ||
    normalized === "to-do" ||
    normalized === "in_progress" ||
    normalized === "review" ||
    normalized === "done" ||
    normalized === "blocked"
  ) {
    return normalized;
  }
  return null;
}

type ResilienceAssigneeCandidate = {
  id: string;
  name: string;
};

function categorySetFromJson(value: string | null | undefined): Set<string> {
  return new Set(safeJsonStringArray(value).map((item) => item.replace(/[^a-z0-9_ -]/g, "").trim()).filter(Boolean));
}

function taskCategorySet(task: { title: string | null; type: string | null; labels_json: string | null; description: string | null }): Set<string> {
  const categories = categorySetFromJson(task.labels_json);
  const type = (task.type ?? "").trim().toLowerCase();
  if (type) categories.add(type);
  const text = `${task.title ?? ""} ${task.description ?? ""} ${type}`.toLowerCase();
  if (/\b(frontend|ui|visual|screen|component|css|react)\b/.test(text)) {
    categories.add("frontend");
    categories.add("ui");
  }
  if (/\b(api|backend|database|db|migration|service|handler)\b/.test(text)) {
    categories.add("backend");
    categories.add("implementation");
  }
  if (/\b(qa|verify|verification|test|review|regression)\b/.test(text)) {
    categories.add("qa");
    categories.add("verification");
  }
  if (/\b(research|audit|investigate|analysis)\b/.test(text)) {
    categories.add("research");
  }
  return categories;
}

function failedAgentIdsForTask(db: Database.Database, taskId: string): Set<string> {
  const failed = new Set<string>();
  const rows = db
    .prepare(
      `SELECT DISTINCT agent_id
       FROM execution_runs
       WHERE task_id = ?
         AND agent_id IS NOT NULL
         AND status IN ('failed', 'timed_out', 'cancelled')`
    )
    .all(taskId) as Array<{ agent_id: string }>;
  for (const row of rows) failed.add(row.agent_id);
  const eventRows = db
    .prepare(
      `SELECT DISTINCT agent_id
       FROM task_events
       WHERE task_id = ?
         AND agent_id IS NOT NULL
         AND json_extract(metadata_json, '$.source') IN ('engine_circuit_breaker', 'capable_list_rotation', 'stuck_agent_watchdog')`
    )
    .all(taskId) as Array<{ agent_id: string }>;
  for (const row of eventRows) failed.add(row.agent_id);
  return failed;
}

function findNextResilienceAssignee(
  db: Database.Database,
  input: { taskId: string; excludeAgentIds?: string[] },
): ResilienceAssigneeCandidate | null {
  const task = db
    .prepare(
      `SELECT t.id, t.company_id, t.assignee_agent_id, t.eligible_assignee_ids, t.title, t.description, t.type, t.labels_json
       FROM tasks t
       WHERE t.id = ?
         AND t.archived_at IS NULL
       LIMIT 1`
    )
    .get(input.taskId) as {
      id: string;
      company_id: string | null;
      assignee_agent_id: string | null;
      eligible_assignee_ids: string | null;
      title: string | null;
      description: string | null;
      type: string | null;
      labels_json: string | null;
    } | undefined;
  if (!task?.company_id) return null;

  const excluded = failedAgentIdsForTask(db, task.id);
  if (task.assignee_agent_id) excluded.add(task.assignee_agent_id);
  for (const id of input.excludeAgentIds ?? []) excluded.add(id);
  const eligibleIds = new Set(safeJsonStringArray(task.eligible_assignee_ids));
  const taskCategories = taskCategorySet(task);

  const candidates = db
    .prepare(
      `SELECT a.id, a.name, a.role, a.status, a.adapter_type, a.eligible_categories,
              COUNT(er.id) AS running_load
       FROM agents a
       LEFT JOIN execution_runs er
         ON er.agent_id = a.id
        AND er.status = 'running'
       WHERE a.company_id = ?
         AND a.archived_at IS NULL
       GROUP BY a.id
       ORDER BY running_load ASC, lower(a.name) ASC`
    )
    .all(task.company_id) as Array<{
      id: string;
      name: string;
      role: string | null;
      status: string;
      adapter_type: string | null;
      eligible_categories: string | null;
      running_load: number;
    }>;

  for (const candidate of candidates) {
    if (excluded.has(candidate.id)) continue;
    if (["paused", "offline", "error"].includes(candidate.status)) continue;
    if (!isExecutableAgentRuntime(candidate.adapter_type)) continue;
    if (eligibleIds.has(candidate.id)) return { id: candidate.id, name: candidate.name };
  }

  for (const candidate of candidates) {
    if (excluded.has(candidate.id)) continue;
    if (["paused", "offline", "error"].includes(candidate.status)) continue;
    if (!isExecutableAgentRuntime(candidate.adapter_type)) continue;
    const candidateCategories = categorySetFromJson(candidate.eligible_categories);
    const roleText = `${candidate.name} ${candidate.role ?? ""}`.toLowerCase();
    if (taskCategories.size > 0 && Array.from(taskCategories).some((category) => candidateCategories.has(category))) {
      return { id: candidate.id, name: candidate.name };
    }
    if (taskCategories.has("frontend") && /\b(frontend|ui|visual|implementation|engineer)\b/.test(roleText)) {
      return { id: candidate.id, name: candidate.name };
    }
    if (taskCategories.has("backend") && /\b(backend|implementation|engineer|repo)\b/.test(roleText)) {
      return { id: candidate.id, name: candidate.name };
    }
    if (taskCategories.has("qa") && /\b(qa|verification|quality|review)\b/.test(roleText)) {
      return { id: candidate.id, name: candidate.name };
    }
  }

  return null;
}


type CreateTaskSemanticRole = "integration" | "docs" | "qa" | "release";

function createTaskSemanticRole(action: Extract<McAction, { action: "create_task" }>): CreateTaskSemanticRole | null {
  const titleAndType = `${action.title ?? ""} ${action.type ?? ""}`.toLowerCase();
  const text = `${titleAndType} ${action.description ?? ""}`.toLowerCase();
  if (/\b(integration|integrate|integrating|assemble|assembly|wire|wiring|compose|package|static artifact|artifact bundle|prototype artifact)\b/.test(text)) {
    return "integration";
  }
  if (/\b(quality|test|tests|testing|validate|validation|verify|verification|smoke)\b/.test(titleAndType)) {
    return "qa";
  }
  if (/\b(release|readme|handoff|ship|finalize|finalise)\b/.test(text)) {
    return "release";
  }
  if (/\bqa\b/.test(titleAndType)) {
    return "qa";
  }
  if (/\b(docs|documentation|document|runbook|operator notes|runtime assumptions|assumption log|implementation notes)\b/.test(text)) {
    return "docs";
  }
  return null;
}

function inferCreateTaskDependencies(input: {
  action: Extract<McAction, { action: "create_task" }>;
  db: Database.Database;
  projectId: string;
  parentTaskId: string | null;
  creatorAgentId: string;
}): string[] {
  const role = createTaskSemanticRole(input.action);
  if (!role) return [];

  const creator = `agent:${input.creatorAgentId}`;
  const rows = input.db
    .prepare(
      `SELECT task_key, title, type
         FROM tasks
        WHERE project_id = ?
          AND archived_at IS NULL
          AND created_by = ?
          AND (? IS NULL OR parent_task_id = ?)
        ORDER BY task_number ASC`,
    )
    .all(input.projectId, creator, input.parentTaskId, input.parentTaskId) as Array<{
      task_key: string | null;
      title: string | null;
      type: string | null;
    }>;

  const dependencies: string[] = [];
  for (const row of rows) {
    if (!row.task_key) continue;
    const existingRole = createTaskSemanticRole({
      action: "create_task",
      title: row.title ?? "",
      type: row.type ?? "",
    });
    if (role === "integration" && (existingRole === "integration" || existingRole === "qa" || existingRole === "release")) continue;
    if (role === "docs" && (existingRole === "docs" || existingRole === "qa" || existingRole === "release")) continue;
    if (role === "qa" && existingRole === "release") continue;
    if (role === "release" && existingRole === "release") continue;
    dependencies.push(row.task_key);
  }
  return [...new Set(dependencies)];
}

function appendRemediationDependencyToSiblingReleaseTasks(input: {
  db: Database.Database;
  taskId: string;
  taskKey: string;
  projectId: string;
  parentTaskId: string | null;
  dependsOnTaskIds: string[];
  action: Extract<McAction, { action: "create_task" }>;
  runId: string;
  agentId: string;
}): number {
  if (!input.parentTaskId || input.dependsOnTaskIds.length === 0) return 0;
  if (createTaskSemanticRole(input.action) === "release") return 0;

  const placeholders = input.dependsOnTaskIds.map(() => "?").join(",");
  const dependencyRows = input.db
    .prepare(
      `SELECT id, title, type
         FROM tasks
        WHERE id IN (${placeholders})
          AND archived_at IS NULL`,
    )
    .all(...input.dependsOnTaskIds) as Array<{ id: string; title: string | null; type: string | null }>;

  const qaDependencyIds = dependencyRows
    .filter((row) => createTaskSemanticRole({
      action: "create_task",
      title: row.title ?? "",
      type: row.type ?? "",
    }) === "qa")
    .map((row) => row.id);
  if (qaDependencyIds.length === 0) return 0;

  const releaseRows = input.db
    .prepare(
      `SELECT id, task_key, title, type, depends_on_json
         FROM tasks
        WHERE project_id = ?
          AND parent_task_id = ?
          AND id != ?
          AND archived_at IS NULL
          AND status NOT IN ('done', 'cancelled')`,
    )
    .all(input.projectId, input.parentTaskId, input.taskId) as Array<{
      id: string;
      task_key: string | null;
      title: string | null;
      type: string | null;
      depends_on_json: string | null;
    }>;

  let updated = 0;
  for (const row of releaseRows) {
    const role = createTaskSemanticRole({
      action: "create_task",
      title: row.title ?? "",
      type: row.type ?? "",
    });
    if (role !== "release") continue;

    let deps: string[] = [];
    try {
      const parsed = JSON.parse(row.depends_on_json ?? "[]");
      deps = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
        : [];
    } catch {
      deps = [];
    }
    if (!qaDependencyIds.some((depId) => deps.includes(depId))) continue;
    if (deps.includes(input.taskId)) continue;

    const nextDeps = [...deps, input.taskId];
    input.db
      .prepare("UPDATE tasks SET depends_on_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(nextDeps), new Date().toISOString(), row.id);
    updated += 1;
    emitRunEvent(
      input.runId,
      input.agentId,
      "action_executed",
      `create_task ${input.taskKey}: added as dependency for release task ${row.task_key ?? row.id}.`,
      input.db,
    );
  }

  return updated;
}

function appendIntegrationDependencyToSiblingQaTasks(input: {
  db: Database.Database;
  taskId: string;
  taskKey: string;
  projectId: string;
  parentTaskId: string | null;
  dependsOnTaskIds: string[];
  action: Extract<McAction, { action: "create_task" }>;
  runId: string;
  agentId: string;
}): number {
  if (createTaskSemanticRole(input.action) !== "integration") return 0;
  if (input.dependsOnTaskIds.length === 0) return 0;

  const qaRows = input.db
    .prepare(
      `SELECT id, task_key, title, type, status, depends_on_json
         FROM tasks
        WHERE project_id = ?
          AND (? IS NULL OR parent_task_id = ?)
          AND id != ?
          AND archived_at IS NULL
          AND status NOT IN ('done', 'cancelled')`,
    )
    .all(input.projectId, input.parentTaskId, input.parentTaskId, input.taskId) as Array<{
      id: string;
      task_key: string | null;
      title: string | null;
      type: string | null;
      status: string;
      depends_on_json: string | null;
    }>;

  let updated = 0;
  for (const row of qaRows) {
    const role = createTaskSemanticRole({
      action: "create_task",
      title: row.title ?? "",
      type: row.type ?? "",
    });
    if (role !== "qa") continue;

    const deps = parseDependencyIds(row.depends_on_json);
    if (deps.includes(input.taskId)) continue;
    if (!input.dependsOnTaskIds.some((depId) => deps.includes(depId))) continue;

    const nextDeps = [...deps, input.taskId];
    input.db
      .prepare("UPDATE tasks SET depends_on_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(nextDeps), new Date().toISOString(), row.id);
    updated += 1;
    emitRunEvent(
      input.runId,
      input.agentId,
      "action_executed",
      `create_task ${input.taskKey}: added as dependency for QA task ${row.task_key ?? row.id}.`,
      input.db,
    );
  }

  return updated;
}

function appendSiblingIntegrationDependenciesToQaTask(input: {
  db: Database.Database;
  taskId: string;
  taskKey: string;
  projectId: string;
  parentTaskId: string | null;
  dependsOnTaskIds: string[];
  action: Extract<McAction, { action: "create_task" }>;
  runId: string;
  agentId: string;
}): number {
  if (createTaskSemanticRole(input.action) !== "qa") return 0;
  if (input.dependsOnTaskIds.length === 0) return 0;

  const integrationRows = input.db
    .prepare(
      `SELECT id, task_key, title, type, status, depends_on_json
         FROM tasks
        WHERE project_id = ?
          AND (? IS NULL OR parent_task_id = ?)
          AND id != ?
          AND archived_at IS NULL
          AND status NOT IN ('done', 'cancelled')`,
    )
    .all(input.projectId, input.parentTaskId, input.parentTaskId, input.taskId) as Array<{
      id: string;
      task_key: string | null;
      title: string | null;
      type: string | null;
      status: string;
      depends_on_json: string | null;
    }>;

  const deps = new Set(input.dependsOnTaskIds);
  for (const row of integrationRows) {
    const role = createTaskSemanticRole({
      action: "create_task",
      title: row.title ?? "",
      type: row.type ?? "",
    });
    if (role !== "integration") continue;

    const integrationDeps = parseDependencyIds(row.depends_on_json);
    if (!integrationDeps.some((depId) => input.dependsOnTaskIds.includes(depId))) continue;
    deps.add(row.id);
  }

  if (deps.size === input.dependsOnTaskIds.length) return 0;
  const nextDeps = Array.from(deps);
  const added = nextDeps.length - input.dependsOnTaskIds.length;
  input.db
    .prepare("UPDATE tasks SET depends_on_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(nextDeps), new Date().toISOString(), input.taskId);
  emitRunEvent(
    input.runId,
    input.agentId,
    "action_executed",
    `create_task ${input.taskKey}: added sibling integration dependency for QA.`,
    input.db,
  );
  input.dependsOnTaskIds.splice(0, input.dependsOnTaskIds.length, ...nextDeps);
  return added;
}

export async function executeCreateTask(
  action: Extract<McAction, { action: "create_task" }>,
  input: { agentId: string; agentName: string; companyId: string; taskKey: string; runId: string },
  db: Database.Database
): Promise<string | null> {
  // ── Cross-run dedup: check if a task with the same normalized title already exists ──
  const normalizedTitle = (action.title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (normalizedTitle) {
    const existing = db
      .prepare(
        `SELECT t.id, t.task_key FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE p.company_id = ? AND t.archived_at IS NULL
           AND LOWER(TRIM(REPLACE(t.title, '  ', ' '))) = ?
         LIMIT 1`
      )
      .get(input.companyId, normalizedTitle) as { id: string; task_key: string } | undefined;

    if (existing) {
      console.log(`[engine:dedup] skipped duplicate task "${action.title?.slice(0, 60)}" — already exists as ${existing.task_key}`);
      return null; // Returning null signals "skipped" to the caller
    }
  }

  const now = new Date().toISOString();
  const taskId = randomUUID();

  // Resolve project: use action.project slug, or fall back to the same project as the direction task
  let projectId: string | null = null;

  if (action.project) {
    const proj = db
      .prepare("SELECT id FROM projects WHERE (slug = ? OR name = ?) AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(action.project, action.project, input.companyId) as { id: string } | undefined;
    if (proj) projectId = proj.id;
  }

  const focusedTask = db
    .prepare(
      `SELECT
         t.id,
         t.task_key,
         t.project_id,
         t.type,
         t.execution_engine,
         t.execution_runtime_provider,
         t.execution_runtime_label,
         t.execution_model_routing,
         t.execution_model_routing_label,
         COALESCE(t.model_lane, 'default') AS model_lane,
         p.settings_json AS project_settings_json,
         c.settings_json AS company_settings_json
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE t.id = ? AND t.archived_at IS NULL LIMIT 1`
    )
    .get(input.taskKey) as
      | {
          id: string;
          task_key: string | null;
          project_id: string;
          type: string;
          execution_engine: TaskExecutionEngine | null;
          execution_runtime_provider: string | null;
          execution_runtime_label: string | null;
          execution_model_routing: string | null;
          execution_model_routing_label: string | null;
          model_lane: TaskModelLane | null;
          project_settings_json: string | null;
          company_settings_json: string | null;
        }
      | undefined;
  const focusedExecution = focusedTask
    ? resolveTaskExecutionEngine({
        taskExecutionEngine: focusedTask.execution_engine,
        projectSettingsJson: focusedTask.project_settings_json,
        companySettingsJson: focusedTask.company_settings_json,
      })
    : null;
  const focusedSymphonyExecutionEngine =
    focusedExecution?.engine === "symphony" ? focusedExecution.engine : null;
  const focusedSymphonyModelLane =
    focusedSymphonyExecutionEngine ? normalizeTaskModelLane(focusedTask?.model_lane) : null;
  const focusedExecutionRouting = focusedTask
    ? resolveTaskExecutionRouting({
        taskRuntimeProvider: focusedTask.execution_runtime_provider,
        taskRuntimeLabel: focusedTask.execution_runtime_label,
        taskModelRouting: focusedTask.execution_model_routing,
        taskModelRoutingLabel: focusedTask.execution_model_routing_label,
        projectSettingsJson: focusedTask.project_settings_json,
        companySettingsJson: focusedTask.company_settings_json,
      })
    : null;

  if (!projectId) {
    // Fall back to the direction task's project.
    if (focusedTask) projectId = focusedTask.project_id;
  }

  if (!projectId) {
    // Final fallback: first active project in company
    const proj = db
      .prepare("SELECT id FROM projects WHERE company_id = ? AND archived_at IS NULL AND status = 'active' LIMIT 1")
      .get(input.companyId) as { id: string } | undefined;
    projectId = proj?.id ?? null;
  }

  if (!projectId) return null;

  // Resolve parent (subtask wiring). Agents reference parent by task_key,
  // matching every other action (update_task, add_comment).
  //
  // Semantics per product decision 2026-04-18:
  //   - If parent is specified and resolvable, the subtask INHERITS the
  //     parent's project_id. If action.project was also specified and
  //     resolved to a DIFFERENT project, we REJECT the cross-project subtask
  //     link silently (keep the explicit project, drop the parent) — mixing
  //     agent-declared project with a parent in another project is almost
  //     always an agent mistake.
  //   - If parent is specified but not resolvable (unknown task_key), we
  //     silently drop the parent link and create a top-level task.
  //
  // Observability (added 2026-04-19, Claude recommendation #2): when
  // either drop branch fires, we capture a `parentDropReason` that gets
  // stamped into the task.created event's metadata_json AND emitted as
  // a heartbeat_run_event so the dashboard timeline surfaces the
  // attempted-but-dropped parent. Previously these were `console.warn`-
  // only — invisible from the UI, so a typo'd task_key looked identical
  // to a correctly-authored top-level task.
  let parentTaskId: string | null = null;
  let attemptedParentKey: string | null = null;
  let parentDropReason: "parent_unresolved" | "parent_cross_project" | null = null;
  let inheritedExecutionEngine: TaskExecutionEngine | null = null;
  let inheritedModelLane: TaskModelLane | null = null;
  let inheritedExecutionRuntimeProvider: string | null = null;
  let inheritedExecutionRuntimeLabel: string | null = null;
  let inheritedExecutionModelRouting: string | null = null;
  let inheritedExecutionModelRoutingLabel: string | null = null;
  const implicitDirectiveParentKey =
    !action.parent && focusedTask?.type === "directive" ? focusedTask.task_key : null;
  if (action.parent || implicitDirectiveParentKey) {
    attemptedParentKey = action.parent ?? implicitDirectiveParentKey;
    const parent = db
      .prepare(
        `SELECT
           t.id,
           t.project_id,
           t.execution_engine,
           t.execution_runtime_provider,
           t.execution_runtime_label,
           t.execution_model_routing,
           t.execution_model_routing_label,
           COALESCE(t.model_lane, 'default') AS model_lane,
           p.settings_json AS project_settings_json,
           c.settings_json AS company_settings_json
         FROM tasks t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
         WHERE t.task_key = ? AND t.archived_at IS NULL LIMIT 1`,
      )
      .get(attemptedParentKey) as
        | {
            id: string;
            project_id: string;
            execution_engine: TaskExecutionEngine | null;
            execution_runtime_provider: string | null;
            execution_runtime_label: string | null;
            execution_model_routing: string | null;
            execution_model_routing_label: string | null;
            model_lane: TaskModelLane | null;
            project_settings_json: string | null;
            company_settings_json: string | null;
          }
        | undefined;
    if (parent) {
      if (action.project && parent.project_id !== projectId) {
        parentDropReason = "parent_cross_project";
        console.warn(
          `[engine:create_task] rejecting cross-project parent link — ` +
          `parent ${attemptedParentKey} is in project ${parent.project_id}, ` +
          `action.project resolved to ${projectId}. Creating top-level task instead.`,
        );
      } else {
        parentTaskId = parent.id;
        projectId = parent.project_id; // inherit parent's project
        inheritedExecutionEngine = resolveTaskExecutionEngine({
          taskExecutionEngine: parent.execution_engine,
          projectSettingsJson: parent.project_settings_json,
          companySettingsJson: parent.company_settings_json,
        }).engine;
        inheritedModelLane = normalizeTaskModelLane(parent.model_lane);
        const inheritedRouting = resolveTaskExecutionRouting({
          taskRuntimeProvider: parent.execution_runtime_provider,
          taskRuntimeLabel: parent.execution_runtime_label,
          taskModelRouting: parent.execution_model_routing,
          taskModelRoutingLabel: parent.execution_model_routing_label,
          projectSettingsJson: parent.project_settings_json,
          companySettingsJson: parent.company_settings_json,
        });
        inheritedExecutionRuntimeProvider = inheritedRouting.runtimeProvider ?? null;
        inheritedExecutionRuntimeLabel = inheritedRouting.runtimeLabel ?? null;
        inheritedExecutionModelRouting = inheritedRouting.modelRouting ?? null;
        inheritedExecutionModelRoutingLabel = inheritedRouting.modelRoutingLabel ?? null;
      }
    } else {
      parentDropReason = "parent_unresolved";
      console.warn(
        `[engine:create_task] parent task_key "${attemptedParentKey}" not found — ` +
        `creating top-level task instead.`,
      );
    }
  }

  // Resolve assignee by name
  let assigneeId: string | null = null;
  if (action.assignee) {
    const agent = db
      .prepare("SELECT id, name, adapter_type FROM agents WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(action.assignee, input.companyId) as { id: string; name: string; adapter_type: string | null } | undefined;
    if (agent) {
      assertExecutableAgentRuntime({ agentName: agent.name, adapterType: agent.adapter_type });
      assigneeId = agent.id;
    }
  }

  const inferredDependsOn = inferCreateTaskDependencies({
    action,
    db,
    projectId,
    parentTaskId,
    creatorAgentId: input.agentId,
  });

  // G4 — resolve dependsOn task keys to task IDs. Same-project only; unresolved
  // or cross-project keys are dropped with reason captured for the task_event
  // metadata so the timeline shows what was attempted vs. what actually wired.
  const dependsOnTaskIds: string[] = [];
  const droppedDependsOn: Array<{ key: string; reason: "unresolved" | "cross_project" | "parent_link" }> = [];
  const explicitDependsOn = action.dependsOn ?? [];
  const dependsOnKeys = [...new Set([...explicitDependsOn, ...inferredDependsOn])];
  if (dependsOnKeys.length > 0) {
    for (const rawKey of dependsOnKeys) {
      const key = rawKey.trim();
      if (!key) continue;
      const dep = db
        .prepare(
          `SELECT id, project_id FROM tasks
           WHERE task_key = ? AND archived_at IS NULL LIMIT 1`,
        )
        .get(key) as { id: string; project_id: string } | undefined;
      if (!dep) {
        droppedDependsOn.push({ key, reason: "unresolved" });
        continue;
      }
      // Parentage already expresses containment/ownership. A child task that
      // also depends on its own parent creates a deadlock: the parent waits for
      // open children while the children wait for the parent to be done.
      if (parentTaskId && dep.id === parentTaskId) {
        droppedDependsOn.push({ key, reason: "parent_link" });
        continue;
      }
      if (dep.project_id !== projectId) {
        droppedDependsOn.push({ key, reason: "cross_project" });
        continue;
      }
      dependsOnTaskIds.push(dep.id);
    }
  }

  // Get next task number
  const maxRow = db
    .prepare("SELECT MAX(task_number) AS max_num FROM tasks t INNER JOIN projects p ON p.id = t.project_id WHERE p.company_id = ?")
    .get(input.companyId) as { max_num: number | null } | undefined;
  const nextNum = (maxRow?.max_num ?? 0) + 1;

  const codeRow = db.prepare("SELECT company_code FROM companies WHERE id = ? LIMIT 1").get(input.companyId) as { company_code: string | null } | undefined;
  const code = codeRow?.company_code ?? "MC";
  const taskKeyNew = `${code}-${nextNum}`;

  // Map priority
  const priorityMap: Record<string, string> = { critical: "critical", high: "high", medium: "medium", low: "low" };
  const priority = priorityMap[action.priority?.toLowerCase() ?? ""] ?? "medium";

  // Map type
  const typeMap: Record<string, string> = { feature: "feature", bug: "bug", maintenance: "maintenance", research: "research", infrastructure: "infrastructure", directive: "directive" };
  const taskType = typeMap[action.type?.toLowerCase() ?? ""] ?? "feature";
  const explicitExecutionEngine = normalizeCreateTaskExecutionEngine(action.executionEngine);
  const inheritedFocusedModelLane =
    !explicitExecutionEngine && !inheritedExecutionEngine ? focusedSymphonyModelLane : null;

  const explicitStatus = normalizeCreateTaskStatus(action.status);
  const status = explicitStatus ?? (assigneeId ? "to-do" : "backlog");
  const labels = normalizeCreateTaskLabels(action.labels);
  const inheritedAutonomousExecutionEngine = inheritedExecutionEngine === "manual" ? null : inheritedExecutionEngine;
  const executionEngine =
    explicitExecutionEngine ??
    inheritedAutonomousExecutionEngine ??
    focusedSymphonyExecutionEngine ??
    "hiverunner";
  const modelLane = normalizeTaskModelLane(action.modelLane ?? inheritedModelLane ?? inheritedFocusedModelLane ?? "default");
  const executionRuntimeProvider =
    inheritedExecutionRuntimeProvider ??
    focusedExecutionRouting?.runtimeProvider ??
    null;
  const executionRuntimeLabel =
    inheritedExecutionRuntimeLabel ??
    focusedExecutionRouting?.runtimeLabel ??
    null;
  const executionModelRouting =
    inheritedExecutionModelRouting ??
    focusedExecutionRouting?.modelRouting ??
    null;
  const executionModelRoutingLabel =
    inheritedExecutionModelRoutingLabel ??
    focusedExecutionRouting?.modelRoutingLabel ??
    null;

  db.prepare(
    `INSERT INTO tasks
       (id, company_id, project_id, parent_task_id, title, description, priority, type, status,
        assignee_agent_id, assigned_at, created_by,
        labels_json, depends_on_json, execution_engine, execution_runtime_provider, execution_runtime_label,
        execution_model_routing, execution_model_routing_label, model_lane,
        execution_mode, task_number, task_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?,
             'openclaw', ?, ?, ?, ?)`
  ).run(
    taskId, input.companyId, projectId, parentTaskId,
    (action.title ?? "Untitled task").slice(0, 255),
    (action.description ?? "").slice(0, 10000),
    priority, taskType, status,
    assigneeId, assigneeId ? now : null,
    `agent:${input.agentId}`,
    JSON.stringify(labels),
    JSON.stringify(dependsOnTaskIds),
    executionEngine,
    executionRuntimeProvider,
    executionRuntimeLabel,
    executionModelRouting,
    executionModelRoutingLabel,
    modelLane,
    nextNum, taskKeyNew,
    now, now
  );

  // Log events. When we silently demoted a parent reference (unresolved
  // task_key or cross-project mismatch), stamp the attempted parent +
  // reason into metadata_json so the task's own timeline shows the
  // intent. Also emit a heartbeat_run_event (when we're inside a real
  // heartbeat run — emitRunEvent is FK-protected and silently skips for
  // execution_runs ids from the poll path). Closes the observability
  // gap flagged on C3 carry-forward: pre-fix, a typo'd parent ref
  // looked identical to a correct top-level task.
  const createdMetadata: Record<string, unknown> = {
    source: "ceo_heartbeat",
    runId: input.runId,
  };
  if (labels.length > 0) {
    createdMetadata.labels = labels;
  }
  if (executionEngine) {
    createdMetadata.executionEngine = executionEngine;
    if (!action.executionEngine && inheritedAutonomousExecutionEngine) {
      createdMetadata.executionEngineInheritedFromParent = true;
    } else if (!action.executionEngine && !inheritedExecutionEngine && focusedSymphonyExecutionEngine) {
      createdMetadata.executionEngineInheritedFromFocusedTask = true;
    }
  }
  if (executionRuntimeProvider) {
    createdMetadata.executionRuntimeProvider = executionRuntimeProvider;
    if (inheritedExecutionRuntimeProvider) {
      createdMetadata.executionRuntimeProviderInheritedFromParent = true;
    } else if (focusedExecutionRouting?.runtimeProvider) {
      createdMetadata.executionRuntimeProviderInheritedFromFocusedTask = true;
    }
  }
  if (executionModelRouting) {
    createdMetadata.executionModelRouting = executionModelRouting;
    if (inheritedExecutionModelRouting) {
      createdMetadata.executionModelRoutingInheritedFromParent = true;
    } else if (focusedExecutionRouting?.modelRouting) {
      createdMetadata.executionModelRoutingInheritedFromFocusedTask = true;
    }
  }
  createdMetadata.modelLane = modelLane;
  if (!action.modelLane && inheritedModelLane) {
    createdMetadata.modelLaneInheritedFromParent = true;
  } else if (!action.modelLane && inheritedFocusedModelLane) {
    createdMetadata.modelLaneInheritedFromFocusedTask = true;
  }
  if (parentDropReason) {
    createdMetadata.attemptedParent = attemptedParentKey;
    createdMetadata.parentDropReason = parentDropReason;
  }
  if (implicitDirectiveParentKey && parentTaskId) {
    createdMetadata.implicitParent = implicitDirectiveParentKey;
  }
  if (dependsOnTaskIds.length > 0) {
    createdMetadata.dependsOn = dependsOnTaskIds;
  }
  if (droppedDependsOn.length > 0) {
    createdMetadata.droppedDependsOn = droppedDependsOn;
  }
  if (inferredDependsOn.length > 0) {
    createdMetadata.inferredDependsOn = inferredDependsOn;
  }
  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.created', ?, ?, ?)`
  ).run(randomUUID(), projectId, taskId, input.agentId, status, JSON.stringify(createdMetadata), now);

  if (parentDropReason) {
    const reasonLabel = parentDropReason === "parent_unresolved"
      ? "parent task_key not found"
      : "parent is in a different project";
    emitRunEvent(
      input.runId,
      input.agentId,
      "action_skipped",
      `create_task ${taskKeyNew}: parent "${attemptedParentKey}" dropped (${reasonLabel}); created as top-level instead.`,
      db,
    );
  }

  if (droppedDependsOn.length > 0) {
    for (const drop of droppedDependsOn) {
      const reasonLabel = drop.reason === "unresolved"
        ? "task_key not found"
        : drop.reason === "parent_link"
          ? "task is already the parent"
          : "task is in a different project";
      emitRunEvent(
        input.runId,
        input.agentId,
        "action_skipped",
        `create_task ${taskKeyNew}: dependsOn "${drop.key}" dropped (${reasonLabel}).`,
        db,
      );
    }
  }

  if (assigneeId) {
    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`
    ).run(randomUUID(), projectId, taskId, input.agentId, JSON.stringify({ assignee: action.assignee, source: "ceo_heartbeat" }), now);
  }

  appendRemediationDependencyToSiblingReleaseTasks({
    db,
    taskId,
    taskKey: taskKeyNew,
    projectId,
    parentTaskId,
    dependsOnTaskIds,
    action,
    runId: input.runId,
    agentId: input.agentId,
  });
  appendIntegrationDependencyToSiblingQaTasks({
    db,
    taskId,
    taskKey: taskKeyNew,
    projectId,
    parentTaskId,
    dependsOnTaskIds,
    action,
    runId: input.runId,
    agentId: input.agentId,
  });
  appendSiblingIntegrationDependenciesToQaTask({
    db,
    taskId,
    taskKey: taskKeyNew,
    projectId,
    parentTaskId,
    dependsOnTaskIds,
    action,
    runId: input.runId,
    agentId: input.agentId,
  });

  // G4 — if any dep is not yet done, skip the auto-start. Sweeper will wake
  // this task once all deps clear. Without this gate, autoStartAssignedTask
  // would transition the task to in_progress and kick the agent immediately,
  // racing the upstream work the dep was supposed to gate on.
  const hasPendingDeps = dependsOnTaskIds.length > 0 && pendingDependencyCount(db, dependsOnTaskIds) > 0;

  const shouldAutoStartAssignedTask =
    assigneeId &&
    assigneeId !== input.agentId &&
    !hasPendingDeps &&
    (status === "in_progress" || (!explicitStatus && status === "to-do"));

  if (shouldAutoStartAssignedTask && assigneeId) {
    const assigneeRuntime = db
      .prepare("SELECT adapter_type FROM agents WHERE id = ? AND archived_at IS NULL LIMIT 1")
      .get(assigneeId) as { adapter_type: string | null } | undefined;
    const startResult = autoStartAssignedTask({
      taskId,
      projectId,
      companyId: input.companyId,
      assigneeId,
      sourceAgentId: input.agentId,
      runId: input.runId,
      initialStatus: status as "to-do" | "in_progress",
      executionProvider: executionProviderForTaskAutoStart({
        db,
        taskId,
        assigneeAdapterType: assigneeRuntime?.adapter_type ?? null,
      }),
      executionEngine,
      modelLane,
      db,
    });
    if (!startResult.started) {
      recoverNewAssignedTaskAutoStartFailure({
        taskId,
        taskKey: taskKeyNew,
        projectId,
        companyId: input.companyId,
        originalAssigneeId: assigneeId,
        sourceAgentId: input.agentId,
        runId: input.runId,
        initialStatus: status as "to-do" | "in_progress",
        failureReason: startResult.reason,
        executionEngine,
        modelLane,
        db,
      });
    }
  } else if (hasPendingDeps) {
    emitRunEvent(
      input.runId,
      input.agentId,
      "action_skipped",
      `create_task ${taskKeyNew}: auto-start deferred — ${dependsOnTaskIds.length} dep(s) not yet done.`,
      db,
    );
  }

  // Keep the parent in sync with its new child (aggregate counts, status
  // rollup) — matches the service-layer createTask path which also calls
  // this, so parent state stays consistent whether the task was created via
  // UI or via an agent action.
  if (parentTaskId) {
    reconcileTaskHierarchy(db, {
      touchedParentTaskIds: [parentTaskId],
      now,
    });
  }

  return taskId;
}

export const AUTO_APPROVED_HIRE_PREFIX = "auto_approved_agent:";

export function executeHireAgent(
  action: Extract<McAction, { action: "hire_agent" }>,
  input: { agentId: string; agentName: string; companyId: string; taskKey: string; runId: string },
  db: Database.Database
): string | null {
  // ── Cross-run dedup: check for existing hire approval with same name+role ──
  const normalizedName = (action.name ?? "").trim().toLowerCase();
  const normalizedRole = (action.role ?? "").trim().toLowerCase();
  if (normalizedName) {
    const existing = db
      .prepare(
        `SELECT id, status FROM approvals
         WHERE company_id = ? AND type = 'hire_agent'
           AND status IN ('pending', 'revision_requested', 'approved')
           AND LOWER(TRIM(json_extract(payload_json, '$.name'))) = ?
           AND LOWER(TRIM(json_extract(payload_json, '$.role'))) = ?
         LIMIT 1`
      )
      .get(input.companyId, normalizedName, normalizedRole) as { id: string; status: string } | undefined;

    if (existing) {
      console.log(`[engine:dedup] skipped duplicate hire "${action.name}" (${action.role}) — already exists as ${existing.id.slice(0, 8)} [${existing.status}]`);
      return null;
    }
  }

  const runtimeDefaults = resolveHireRuntimeDefaults(action, input, db);
  const hirePayload = {
    name: action.name ?? "Unnamed Agent",
    role: action.role ?? "General",
    capabilities: action.capabilities ?? "",
    reason: action.reason ?? "Requested by CEO during heartbeat",
    requestedDuring: input.runId,
    ...runtimeDefaults,
  };
  if (shouldAutoApproveNewHires(input.companyId, db)) {
    const materialized = materializeApprovedHireAgent({
      approvalCompanyId: input.companyId,
      requestedByAgentId: input.agentId,
      payload: hirePayload,
      db,
    });
    console.log(`[engine:hire_agent] auto-approved hire "${action.name}" as ${materialized.agentId}`);
    return `${AUTO_APPROVED_HIRE_PREFIX}${materialized.agentId}`;
  }

  const stagedAgent = stagePendingHireAgent({
    approvalCompanyId: input.companyId,
    requestedByAgentId: input.agentId,
    payload: hirePayload,
    db,
  });
  const payload = {
    ...hirePayload,
    agentId: stagedAgent.agentId,
  };

  const taskRow = db
    .prepare("SELECT id FROM tasks WHERE task_key = ? AND archived_at IS NULL LIMIT 1")
    .get(input.taskKey) as { id: string } | undefined;
  const { approval } = createApproval({
    companyIdOrSlug: input.companyId,
    type: "hire_agent",
    requestedByAgentId: input.agentId,
    payload,
    linkedTaskId: taskRow?.id,
    db,
  });

  return approval.id;
}

export type UpdateTaskResult = {
  taskFound: boolean;
  taskId?: string;
  statusRequested: boolean;
  statusApplied: boolean;
  dependentAutostartDeferred?: boolean;
  statusRejectedReason?:
    | "invalid_status"
    | "no_transition_rule"
    | "already_at_status"
    | "self_approval_blocked"
    | "done_requires_comment"
    | "in_progress_assignee_not_executable"
    | "in_progress_assignee_not_found"
    | "in_progress_requires_assignee"
    | "no_op_resubmission"
    | "planning_draft_required";
  assigneeRequested: boolean;
  assigneeApplied: boolean;
  assigneeRejectedReason?: "not_found" | "not_executable_runtime";
  commentRequested: boolean;
  commentApplied: boolean;
};

function closePlanningTaskAfterSprintDraftProposed(input: {
  db: Database.Database;
  taskId: string;
  agentId: string;
  runId: string;
  draftId: string;
  proposalGroupId?: string | null;
  draftCount?: number;
  taskCount?: number;
  firstSequenceNumber?: number;
}): boolean {
  const task = input.db
    .prepare(
      `SELECT id, project_id, task_key, status, labels_json
       FROM tasks
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskId) as
      | { id: string; project_id: string; task_key: string | null; status: string; labels_json: string | null }
      | undefined;
  if (!task) return false;
  if (!isPlanningDraftLifecycleTask(task.labels_json)) return false;
  if (!planningTaskHasSprintDraft(input.db, task.id)) return false;
  if (["done", "cancelled", "backlog"].includes(task.status)) return false;

  const now = new Date().toISOString();
  const isPlanRevision = taskLabelsInclude(task.labels_json, "plan-revision");
  const draftSummary = input.draftCount && input.taskCount
    ? `${input.draftCount} sprint${input.draftCount === 1 ? "" : "s"} / ${input.taskCount} task${input.taskCount === 1 ? "" : "s"}`
    : "a structured sprint plan draft";
  const body = isPlanRevision
    ? [
        `Revised the remaining sprint plan and created ${draftSummary} for operator review.`,
        input.firstSequenceNumber ? `Next approval starts at Sprint ${input.firstSequenceNumber}.` : null,
        "No execution tasks were approved or materialized by this revision task; the structured draft on the Goals page is the review artifact.",
      ].filter(Boolean).join(" ")
    : "Sprint plan draft emitted. Closing the planning task while the operator reviews the structured draft.";
  input.db.prepare(
    `UPDATE tasks
       SET status = 'done',
           blocked_reason = NULL,
           updated_at = ?
     WHERE id = ?`,
  ).run(now, task.id);
  input.db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'done', ?, ?)`,
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    task.status,
    JSON.stringify({
      source: "planning_draft_proposed",
      runId: input.runId,
      draftId: input.draftId,
      proposalGroupId: input.proposalGroupId ?? null,
      draftCount: input.draftCount ?? null,
      taskCount: input.taskCount ?? null,
      firstSequenceNumber: input.firstSequenceNumber ?? null,
      reason: "operator_reviews_structured_draft",
    }),
    now,
  );

  const externalRef = `engine:planning-draft-proposed:${task.id}:${input.runId}`;
  input.db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
  ).run(
    randomUUID(),
    task.id,
    body,
    externalRef,
    now,
    now,
  );
  input.db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`,
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    JSON.stringify({
      source: "planning_draft_proposed",
      runId: input.runId,
      draftId: input.draftId,
      proposalGroupId: input.proposalGroupId ?? null,
      draftCount: input.draftCount ?? null,
      taskCount: input.taskCount ?? null,
    }),
    now,
  );
  refreshAgentLoad(input.db, input.agentId);
  return true;
}

export { getLatestReviewSubmissionAuthor };

export function executeUpdateTask(
  action: Extract<McAction, { action: "update_task" }>,
  input: { agentId: string; companyId: string; runId: string; source?: string; deferDependentAutoStart?: boolean },
  db: Database.Database
): UpdateTaskResult {
  const now = new Date().toISOString();
  let appliedTaskStatus: string | null = null;
  const result: UpdateTaskResult = {
    taskFound: false,
    statusRequested: !!action.status,
    statusApplied: false,
    assigneeRequested: !!action.assignee,
    assigneeApplied: false,
    commentRequested: !!action.comment,
    commentApplied: false,
  };

  // Resolve task by task_key. parent_task_id + sprint_id are needed so a
  // status change at the bottom of the tree propagates back up via
  // reconcileTaskHierarchy (G7 — earlier the engine action path skipped the
  // call that the service-layer moveTask makes, so parents got stuck in
  // 'review' even when every child was done; observed on WEA-282).
  const task = db
    .prepare(
      `SELECT t.id, t.project_id, t.parent_task_id, t.sprint_id, t.status, t.assignee_agent_id,
              t.task_key, t.title, t.type, t.labels_json,
              COALESCE(t.company_id, p.company_id) AS company_id
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.task_key = ? AND t.archived_at IS NULL LIMIT 1`,
    )
    .get(action.taskKey) as {
      id: string;
      project_id: string;
      parent_task_id: string | null;
      sprint_id: string | null;
      status: string;
      assignee_agent_id: string | null;
      task_key: string | null;
      title: string | null;
      type: string | null;
      labels_json: string | null;
      company_id: string | null;
    } | undefined;

  if (!task || !task.id) return result;
  result.taskFound = true;
  result.taskId = task.id;

  const requestedAssignee = action.assignee && task.company_id
    ? db
        .prepare(
          `SELECT id, name, adapter_type FROM agents
           WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
             AND company_id = ?
             AND archived_at IS NULL
           LIMIT 1`,
        )
        .get(action.assignee, task.company_id) as
          | { id: string; name: string; adapter_type: string | null }
          | undefined
    : undefined;

  // Status update if requested and transition is valid. The transition rule
  // machine lives in status-transitions.ts; this call site runs the rules and
  // performs the status write, then we fan out the downstream cascades that
  // depend on the new status.
  if (action.status) {
    const transition = applyStatusTransition(
      {
        id: task.id,
        project_id: task.project_id,
        status: task.status,
        task_key: task.task_key,
        labels_json: task.labels_json,
        assignee_agent_id: task.assignee_agent_id,
        company_id: task.company_id,
      },
      action.status,
      {
        agentId: input.agentId,
        companyId: input.companyId,
        runId: input.runId,
        source: input.source,
        now,
        inlineCommentProvided: Boolean(action.comment?.trim()),
        assigneeRequested: Boolean(action.assignee),
        requestedAssignee: requestedAssignee ?? null,
      },
      db,
    );
    if (transition.statusRejectedReason) {
      result.statusRejectedReason = transition.statusRejectedReason as UpdateTaskResult["statusRejectedReason"];
    }
    if (transition.statusApplied) {
      result.statusApplied = true;
    }

    if (transition.statusWritten) {
      const normalized = transition.normalizedStatus as string;
      appliedTaskStatus = normalized;
      const implicitInProgressOwner = transition.implicitInProgressOwner ?? null;

      if (implicitInProgressOwner && implicitInProgressOwner.id !== task.assignee_agent_id) {
        db.prepare(
          `UPDATE tasks
             SET assignee_agent_id = ?,
                 assigned_at = ?,
                 updated_at = ?
           WHERE id = ?`,
        ).run(implicitInProgressOwner.id, now, now, task.id);
        db.prepare(
          `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
           VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`,
        ).run(
          randomUUID(),
          task.project_id,
          task.id,
          input.agentId,
          JSON.stringify({
            source: "engine_action_in_progress_owner",
            runId: input.runId,
            newAssignee: implicitInProgressOwner.id,
            previousAssignee: task.assignee_agent_id,
            assigneeName: implicitInProgressOwner.name,
          }),
          now,
        );
        result.assigneeApplied = true;
      }

      if (
        normalized === "review" &&
        !action.assignee &&
        task.company_id &&
        !planningTaskHasSprintDraft(db, task.id)
      ) {
        const routed = autoRouteReviewHandoff({
          db,
          task,
          producerAgentId: input.agentId,
          runId: input.runId,
          normalizedStatus: normalized,
          emitRunEvent,
          enqueueEngineReassignmentWakeup,
        });
        result.assigneeApplied = result.assigneeApplied || routed.assigneeApplied;
      }

      if (task.status === "review") {
        const decision = applyReviewDecision({
          db,
          task,
          reviewerAgentId: input.agentId,
          runId: input.runId,
          normalizedStatus: normalized,
          actionAssigneeProvided: Boolean(action.assignee),
          requestedAssigneeId: requestedAssignee?.id ?? null,
          emitRunEvent,
          enqueueEngineReassignmentWakeup,
        });
        result.assigneeApplied = result.assigneeApplied || decision.assigneeApplied;
      }

      // G7 — propagate the status change up the tree. The service-layer
      // moveTask path always calls reconcileTaskHierarchy; the engine action
      // path was skipping it, so a child going to `done` via update_task
      // never re-evaluated the parent. Observed on WEA-282: parent stayed
      // in `review` even when all three children were done.
      if (task.parent_task_id || task.sprint_id) {
        if (normalized === "done") {
          maybeAutoCompleteSprintForTaskDone(db, {
            sprintId: task.sprint_id,
            projectId: task.project_id,
            taskId: task.id,
            actorUserId: `agent:${input.agentId}`,
            now,
          });
        }
        reconcileTaskHierarchy(db, {
          touchedParentTaskIds: [task.parent_task_id],
          touchedSprintIds: [task.sprint_id],
          now,
        });
      }

      if (normalized === "blocked" && task.parent_task_id) {
        queueParentBlockedWake({
          childTaskId: task.id,
          childTaskKey: action.taskKey,
          parentTaskId: task.parent_task_id,
          companyId: input.companyId,
          blockedByAgentId: input.agentId,
          runId: input.runId,
          db,
        });
      }

      if (normalized === "done" && !input.deferDependentAutoStart) {
        const unblocked = autoStartUnblockedDependentTasks({
          completedTaskId: task.id,
          companyId: input.companyId,
          sourceAgentId: input.agentId,
          runId: input.runId,
          db,
        });
        if (unblocked > 0) {
          emitRunEvent(
            input.runId,
            input.agentId,
            "action_executed",
            `Queued ${unblocked} dependent task${unblocked === 1 ? "" : "s"} now that ${action.taskKey} is done.`,
            db,
          );
        }
      } else if (normalized === "done" && input.deferDependentAutoStart) {
        result.dependentAutostartDeferred = true;
      }

    }
  }

  // Reassignment if requested. Resolve by agent name within the same company
  // as the task. Silently no-op if the name doesn't match a live agent (keeps
  // the action partial-success semantics — status/comment can still land).
  if (action.assignee) {
    if (task.company_id) {
      if (!requestedAssignee) {
        result.assigneeRejectedReason = "not_found";
      } else if (!isExecutableAgentRuntime(requestedAssignee.adapter_type)) {
        result.assigneeRejectedReason = "not_executable_runtime";
        emitRunEvent(
          input.runId,
          input.agentId,
          "action_error",
          `update_task ${action.taskKey}: assignee ${requestedAssignee.name} is not runnable (${runtimeProviderLabel(requestedAssignee.adapter_type)}).`,
          db,
        );
      }
      if (
        requestedAssignee &&
        !result.assigneeRejectedReason &&
        requestedAssignee.id !== task.assignee_agent_id
      ) {
        db.prepare(
          `UPDATE tasks
             SET assignee_agent_id = ?,
                 assigned_at = ?,
                 updated_at = ?
           WHERE id = ?`,
        ).run(requestedAssignee.id, now, now, task.id);
        db.prepare(
          `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
           VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`,
        ).run(
          randomUUID(),
          task.project_id,
          task.id,
          input.agentId,
          JSON.stringify({
            source: "engine_action_reassign",
            runId: input.runId,
            newAssignee: requestedAssignee.id,
            previousAssignee: task.assignee_agent_id,
            assigneeNameRequested: action.assignee,
          }),
          now,
        );
        result.assigneeApplied = true;
        enqueueEngineReassignmentWakeup({
          db,
          agentId: requestedAssignee.id,
          companyId: task.company_id,
          taskId: task.id,
          taskStatus: appliedTaskStatus ?? task.status,
          projectId: task.project_id,
          runId: input.runId,
          reason: "engine_action_reassign",
        });
      }
    }
  }

  // Comment if provided
  if (action.comment) {
    importCommentOnTask(task.id, input.agentId, action.comment.slice(0, 9000), "status_update", input.runId, db, input.source);
    result.commentApplied = true;
  }

  return result;
}

type EngineReassignmentWakeReason =
  | "engine_default_review_handoff"
  | "engine_review_completion_return_to_producer"
  | "engine_action_reassign";

function enqueueEngineReassignmentWakeup(input: {
  db: Database.Database;
  agentId: string | null | undefined;
  companyId: string | null | undefined;
  taskId: string;
  taskStatus: string;
  projectId: string | null;
  runId: string;
  reason: EngineReassignmentWakeReason;
}): EnqueueWakeupResult | null {
  const agentId = input.agentId?.trim();
  const companyId = input.companyId?.trim();
  if (!agentId || !companyId) return null;

  const assignee = input.db
    .prepare(
      `SELECT status, archived_at, adapter_type
       FROM agents
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(agentId) as
      | { status: string; archived_at: string | null; adapter_type: string | null }
      | undefined;
  let wakeAgentId = agentId;
  if (
    !assignee ||
    assignee.archived_at ||
    assignee.status === "paused" ||
    assignee.status === "offline" ||
    assignee.status === "error" ||
    !isExecutableAgentRuntime(assignee.adapter_type)
  ) {
    const fallback = findNextResilienceAssignee(input.db, {
      taskId: input.taskId,
      excludeAgentIds: [agentId],
    });
    if (!fallback) return null;
    const now = new Date().toISOString();
    input.db
      .prepare(
        `UPDATE tasks
         SET assignee_agent_id = ?,
             assigned_at = ?,
             updated_at = ?
         WHERE id = ?
           AND archived_at IS NULL`,
      )
      .run(fallback.id, now, now, input.taskId);
    input.db
      .prepare(
        `INSERT INTO task_events
          (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.reassigned', ?, ?)`,
      )
      .run(
        randomUUID(),
        input.projectId,
        input.taskId,
        fallback.id,
        JSON.stringify({
          source: "engine_reassignment_capable_fallback",
          originalReason: input.reason,
          from: agentId,
          to: fallback.id,
          runId: input.runId,
        }),
        now,
      );
    input.db
      .prepare(
        `INSERT INTO comments
          (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'status_update', 'engine', ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.taskId,
        `[AUTO_ASSIGNMENT] ${input.reason} selected an unavailable assignee. Reassigned to ${fallback.name} and queued immediately.`,
        `engine:reassignment-fallback:${input.runId}:${input.taskId}`,
        now,
        now,
      );
    wakeAgentId = fallback.id;
  }

  return enqueueWakeup(
    {
      agentId: wakeAgentId,
      companyId,
      source: "issue_assigned",
      reason: input.reason,
      payload: {
        taskId: input.taskId,
        taskStatus: input.taskStatus,
        projectId: input.projectId,
        runId: input.runId,
      },
      idempotencyKey: `engine_reassign:${input.taskId}:${wakeAgentId}:${input.runId}`,
    },
    input.db,
  );
}

export function queueParentBlockedWake(input: {
  childTaskId: string;
  childTaskKey: string;
  parentTaskId: string;
  companyId: string;
  blockedByAgentId: string;
  runId: string;
  db: Database.Database;
}): void {
  const parent = input.db
    .prepare(
      `SELECT id, task_key, project_id, assignee_agent_id
       FROM tasks
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.parentTaskId) as
      | { id: string; task_key: string | null; project_id: string; assignee_agent_id: string | null }
      | undefined;
  const assigneeId = parent?.assignee_agent_id?.trim();
  if (!parent || !assigneeId || assigneeId === input.blockedByAgentId) return;

  const assignee = input.db
    .prepare(
      `SELECT status, archived_at, adapter_type
       FROM agents
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(assigneeId) as
      | { status: string; archived_at: string | null; adapter_type: string | null }
      | undefined;
  if (!assignee || assignee.archived_at) return;
  if (assignee.status === "paused" || assignee.status === "offline" || assignee.status === "error") return;
  if (!isExecutableAgentRuntime(assignee.adapter_type)) {
    emitRunEvent(
      input.runId,
      input.blockedByAgentId,
      "action_skipped",
      `Parent blocked wakeup skipped: parent assignee has no executable runtime (${runtimeProviderLabel(assignee.adapter_type)}).`,
      input.db,
    );
    return;
  }

  const wake = enqueueWakeup(
    {
      agentId: assigneeId,
      companyId: input.companyId,
      source: "api",
      reason: "child_task_blocked",
      payload: {
        parentTaskId: parent.id,
        parentTaskKey: parent.task_key,
        childTaskId: input.childTaskId,
        childTaskKey: input.childTaskKey,
        blockedByAgentId: input.blockedByAgentId,
        runId: input.runId,
      },
      idempotencyKey: `child-blocked:${input.childTaskId}:${input.runId}`,
    },
    input.db,
  );

  if (wake.heartbeatRunId && (wake.status === "queued" || wake.status === "coalesced")) {
    emitRunEvent(
      input.runId,
      input.blockedByAgentId,
      "action_executed",
      `Queued parent wakeup because ${input.childTaskKey} is blocked.`,
      input.db,
    );
  }
}

export function executeAddComment(
  action: Extract<McAction, { action: "add_comment" }>,
  input: { agentId: string; companyId: string; runId: string; source?: string },
  db: Database.Database
): boolean {
  // Resolve task by task_key
  const task = db
    .prepare(
      `SELECT id, project_id, status, assignee_agent_id
       FROM tasks
       WHERE task_key = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(action.taskKey) as
      | {
          id: string;
          project_id: string;
          status: string;
          assignee_agent_id: string | null;
        }
      | undefined;

  if (!task || !task.id) return false;

  const body = action.body.slice(0, 9000);
  importCommentOnTask(task.id, input.agentId, body, "comment", input.runId, db, action.source ?? input.source);
  maybeHandBackReviewForClarification({ task, body, input, db });
  maybeWakeAssigneeForAgentComment({ task, body, input, db });
  return true;
}

function maybeHandBackReviewForClarification(input: {
  task: {
    id: string;
    project_id: string;
    status: string;
    assignee_agent_id: string | null;
  };
  body: string;
  input: { agentId: string; companyId: string; runId: string };
  db: Database.Database;
}): void {
  if (!/^\s*\[AWAITING_CLARIFICATION\]/i.test(input.body)) return;
  if (input.task.status !== "review") return;
  const assigneeId = input.task.assignee_agent_id?.trim();
  if (!assigneeId || assigneeId === input.input.agentId) return;

  const now = new Date().toISOString();
  const changed = input.db
    .prepare(
      `UPDATE tasks
       SET status = 'in_progress',
           updated_at = ?
       WHERE id = ?
         AND status = 'review'
         AND archived_at IS NULL`,
    )
    .run(now, input.task.id);

  if (changed.changes > 0) {
    input.db
      .prepare(
        `INSERT INTO task_events
          (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'review', 'in_progress', ?, ?)`,
      )
      .run(
        randomUUID(),
        input.task.project_id,
        input.task.id,
        input.input.agentId,
        JSON.stringify({
          source: "engine_clarification_request",
          runId: input.input.runId,
          assigneeAgentId: assigneeId,
        }),
        now,
      );
  }

  enqueueWakeup(
    {
      agentId: assigneeId,
      companyId: input.input.companyId,
      source: "api",
      reason: "clarification_requested",
      payload: {
        taskId: input.task.id,
        taskStatus: "in_progress",
        requestedByAgentId: input.input.agentId,
        runId: input.input.runId,
      },
      idempotencyKey: `clarification:${input.task.id}:${input.input.runId}`,
    },
    input.db,
  );
}

function maybeWakeAssigneeForAgentComment(input: {
  task: {
    id: string;
    project_id: string;
    status: string;
    assignee_agent_id: string | null;
  };
  body: string;
  input: { agentId: string; companyId: string; runId: string };
  db: Database.Database;
}): void {
  if (!input.body.trim()) return;
  if (!["to-do", "in_progress"].includes(input.task.status)) return;
  const assigneeId = input.task.assignee_agent_id?.trim();
  if (!assigneeId || assigneeId === input.input.agentId) return;

  const assignee = input.db
    .prepare(
      `SELECT status, archived_at, adapter_type
       FROM agents
       WHERE id = ? AND archived_at IS NULL
       LIMIT 1`,
    )
    .get(assigneeId) as
      | { status: string; archived_at: string | null; adapter_type: string | null }
      | undefined;
  if (!assignee || assignee.archived_at) return;
  if (assignee.status === "paused" || assignee.status === "offline" || assignee.status === "error") return;
  if (!isExecutableAgentRuntime(assignee.adapter_type)) return;

  enqueueWakeup(
    {
      agentId: assigneeId,
      companyId: input.input.companyId,
      source: "api",
      reason: "agent_comment_on_assigned_task",
      payload: {
        taskId: input.task.id,
        taskStatus: input.task.status,
        commentAuthorAgentId: input.input.agentId,
        runId: input.input.runId,
      },
      idempotencyKey: `agent-comment:${input.task.id}:${input.input.runId}`,
    },
    input.db,
  );
}

// G5 — Register an artifact on a task. The kind is normalized to one of a
// known set; unknown kinds fall through to 'file' so we never reject a write.
// If the agent provides a sha256, store it as-is (lowercased). The auto-sha
// path (compute from file://) is intentionally NOT here — agents should
// compute the hash in their environment so we don't introduce IO failures
// into the heartbeat path. G2's no-op detection treats a missing sha as
// "can't decide" (best-effort rather than blocking).
const ARTIFACT_KINDS = new Set(["html", "pdf", "image", "file", "url"]);
export type RegisterArtifactResult = {
  taskFound: boolean;
  kind: string | null;
};
export function executeRegisterArtifact(
  action: Extract<McAction, { action: "register_artifact" }>,
  input: { agentId: string; companyId: string; runId: string },
  db: Database.Database,
): RegisterArtifactResult {
  const task = db
    .prepare("SELECT id, project_id FROM tasks WHERE task_key = ? AND archived_at IS NULL LIMIT 1")
    .get(action.taskKey) as { id: string; project_id: string } | undefined;
  if (!task || !task.id) return { taskFound: false, kind: null };

  const rawKind = (action.kind ?? "").trim().toLowerCase();
  const kind = ARTIFACT_KINDS.has(rawKind) ? rawKind : "file";
  const uri = action.uri.trim().slice(0, 2000);
  const sha = (action.sha256 ?? "").trim().toLowerCase();
  const shaValid = /^[0-9a-f]{64}$/.test(sha);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE tasks
       SET artifact_uri = ?,
           artifact_kind = ?,
           artifact_registered_at = ?,
           artifact_sha256 = ?,
           updated_at = ?
     WHERE id = ?`,
  ).run(uri, kind, now, shaValid ? sha : null, now, task.id);

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.artifact_registered', ?, ?)`,
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    JSON.stringify({
      uri,
      kind,
      sha256: shaValid ? sha : null,
      runId: input.runId,
      shaSupplied: Boolean(action.sha256),
      shaInvalid: action.sha256 !== undefined && !shaValid,
    }),
    now,
  );

  return { taskFound: true, kind };
}
