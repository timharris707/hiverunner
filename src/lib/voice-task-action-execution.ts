import { OrchestrationApiError } from "@/lib/orchestration/api";
import type { TaskPriorityInput, TaskStatusInput } from "@/lib/orchestration/contracts";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  assignTask,
  createTaskComment,
  getTask,
  moveTask,
  updateTask,
} from "@/lib/orchestration/service";
import { triggerTaskExecution } from "@/lib/orchestration/execution";
import type { TriggerTaskExecutionResult } from "@/lib/orchestration/execution";
import type { TaskStatus } from "@/lib/orchestration/types";
import type { ResolvedVoiceBinding } from "@/lib/voice-binding";

export type VoiceActionToolName =
  | "add_task_comment"
  | "start_task_work"
  | "move_task_status"
  | "reassign_task"
  | "set_task_priority";

export interface ExecuteVoiceActionToolInput {
  tool: VoiceActionToolName;
  params?: Record<string, unknown>;
  binding?: ResolvedVoiceBinding;
  sessionId?: string | null;
  intentId?: string | null;
}

export interface VoiceActionToolResult {
  action: VoiceActionToolName;
  taskId: string;
  taskKey?: string;
  deduped?: boolean;
  changed?: boolean;
  reason?: string;
  commentId?: string;
  status?: TaskStatusInput;
  fromStatus?: TaskStatus;
  toStatus?: TaskStatus;
  assignee?: string | null;
  fromAssignee?: string | null;
  toAssignee?: string | null;
  priority?: TaskPriorityInput;
  fromPriority?: TaskPriorityInput;
  toPriority?: TaskPriorityInput;
  execution?: TriggerTaskExecutionResult;
}

/**
 * Voice-driven task actions attribute to the bound agent when one exists
 * (the agent is effectively the one performing the action on the caller's
 * verbal request). When no agent is bound, we fall back to a "voice"
 * marker for the audit trail. For comments specifically we also tag
 * `source: "voice"` so the timeline + future UI can surface the origin.
 */
function voiceAuthorUserId(binding: ResolvedVoiceBinding & { taskId: string }): string {
  return binding.agentId ? `voice:${binding.agentId}` : "voice";
}

const TASK_STATUS_VALUES: TaskStatusInput[] = ["backlog", "to-do", "in-progress", "review", "done", "blocked"];
const TASK_STATUS_ALIASES: Record<string, TaskStatusInput> = {
  backlog: "backlog",
  "to-do": "to-do",
  ondeck: "to-do",
  todo: "to-do",
  to_do: "to-do",
  queued: "to-do",
  in_progress: "in-progress",
  inprogress: "in-progress",
  active: "in-progress",
  working: "in-progress",
  review: "review",
  in_review: "review",
  inreview: "review",
  qa: "review",
  done: "done",
  completed: "done",
  complete: "done",
  closed: "done",
  resolved: "done",
  blocked: "blocked",
  block: "blocked",
  blocked_waiting: "blocked",
  waiting: "blocked",
};

function requireTaskBinding(binding?: ResolvedVoiceBinding): ResolvedVoiceBinding & { taskId: string } {
  if (!binding || binding.scope !== "task" || !binding.taskId) {
    throw new OrchestrationApiError(
      400,
      "voice_action_requires_task_binding",
      "Voice action tools require a task-bound session",
    );
  }
  return binding as ResolvedVoiceBinding & { taskId: string };
}

function normalizeRequiredBody(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new OrchestrationApiError(400, "voice_action_body_required", "Voice task comments require a non-empty body");
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new OrchestrationApiError(400, "voice_action_invalid_text", "Expected a text value for this voice action field");
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

const TASK_PRIORITY_VALUES: TaskPriorityInput[] = ["P0", "P1", "P2", "P3"];
const TASK_PRIORITY_ALIASES: Record<string, TaskPriorityInput> = {
  p0: "P0",
  p1: "P1",
  p2: "P2",
  p3: "P3",
  urgent: "P0",
  critical: "P0",
  highest: "P0",
  high: "P1",
  medium: "P2",
  med: "P2",
  normal: "P2",
  default: "P2",
  low: "P3",
  lowest: "P3",
};

function normalizeTaskPriority(value: unknown): TaskPriorityInput {
  if (typeof value !== "string") {
    throw new OrchestrationApiError(400, "voice_action_priority_required", "Voice priority changes require a target priority");
  }
  const token = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const normalized = TASK_PRIORITY_ALIASES[token];
  if (!normalized || !TASK_PRIORITY_VALUES.includes(normalized)) {
    throw new OrchestrationApiError(
      400,
      "voice_action_invalid_priority",
      `Unsupported task priority '${value}'. Expected one of: P0, P1, P2, P3 (or urgent/high/medium/low)`,
    );
  }
  return normalized;
}

function normalizeAssigneeInput(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new OrchestrationApiError(400, "voice_action_invalid_assignee", "Assignee must be an agent name or id");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(none|unassign|unassigned|nobody|no one|clear)$/i.test(trimmed)) return null;
  return trimmed;
}

function normalizeTaskStatus(value: unknown): TaskStatusInput {
  if (typeof value !== "string") {
    throw new OrchestrationApiError(400, "voice_action_status_required", "Voice status changes require a target status");
  }
  const token = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const normalized = TASK_STATUS_ALIASES[token];
  if (!normalized || !TASK_STATUS_VALUES.includes(normalized)) {
    throw new OrchestrationApiError(
      400,
      "voice_action_invalid_status",
      `Unsupported task status '${value}'. Expected one of: backlog, to-do, in_progress, review, done, blocked`,
    );
  }
  return normalized;
}

function normalizeSessionToken(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function buildVoiceActionExternalRef(
  tool: VoiceActionToolName,
  taskId: string,
  sessionId?: string | null,
  intentId?: string | null,
): string {
  return [
    "voice-action",
    taskId,
    normalizeSessionToken(sessionId, "unknown-session"),
    normalizeSessionToken(intentId, "unknown-intent"),
    tool,
  ].join(":");
}

function buildVoiceExecutionIdempotencyKey(
  taskId: string,
  sessionId?: string | null,
  intentId?: string | null,
): string {
  return [
    "voice-start-work",
    taskId,
    normalizeSessionToken(sessionId, "unknown-session"),
    normalizeSessionToken(intentId, "unknown-intent"),
  ].join(":");
}

function commentExists(taskId: string, externalRef: string): boolean {
  const db = getOrchestrationDb();
  const row = db
    .prepare("SELECT id FROM comments WHERE task_id = ? AND source = 'voice' AND external_ref = ? LIMIT 1")
    .get(taskId, externalRef) as { id: string } | undefined;
  return Boolean(row?.id);
}

function getTaskAssigneeAgentId(taskId: string): string | null {
  const db = getOrchestrationDb();
  const row = db
    .prepare("SELECT assignee_agent_id FROM tasks WHERE id = ? LIMIT 1")
    .get(taskId) as { assignee_agent_id: string | null } | undefined;
  return row?.assignee_agent_id ?? null;
}

export async function executeVoiceActionTool(input: ExecuteVoiceActionToolInput): Promise<VoiceActionToolResult> {
  const binding = requireTaskBinding(input.binding);

  switch (input.tool) {
    case "add_task_comment": {
      const externalRef = buildVoiceActionExternalRef(input.tool, binding.taskId, input.sessionId, input.intentId);
      const deduped = commentExists(binding.taskId, externalRef);
      const comment = createTaskComment({
        taskId: binding.taskId,
        body: normalizeRequiredBody(input.params?.body),
        type: "comment",
        ...(binding.agentId
          ? { authorAgentId: binding.agentId }
          : { authorUserId: "voice" }),
        source: "voice",
        externalRef,
      }).comment;

      return {
        action: input.tool,
        taskId: binding.taskId,
        taskKey: binding.taskKey,
        commentId: comment.id,
        deduped,
      };
    }

    case "start_task_work": {
      let currentTask = getTask(binding.taskId).task;
      const fromStatus = currentTask.status;
      const fromAssignee = currentTask.assignee ?? null;
      let toAssignee = fromAssignee;
      let currentAssigneeAgentId = getTaskAssigneeAgentId(binding.taskId);

      if (!currentAssigneeAgentId && binding.agentId) {
        const assignment = assignTask({
          taskId: binding.taskId,
          assignee: binding.agentId,
          actorUserId: voiceAuthorUserId(binding),
        });
        currentTask = assignment.task;
        toAssignee = currentTask.assignee ?? null;
        currentAssigneeAgentId = binding.agentId;
      } else if (
        currentAssigneeAgentId &&
        binding.agentId &&
        currentAssigneeAgentId !== binding.agentId
      ) {
        throw new OrchestrationApiError(
          409,
          "voice_start_work_assignee_mismatch",
          "This task is assigned to a different agent. Reassign it before starting work.",
        );
      }

      const statusChanged = currentTask.status !== "in-progress";
      const moved = statusChanged
        ? moveTask({
            taskId: binding.taskId,
            status: "in-progress",
            actorUserId: voiceAuthorUserId(binding),
          })
        : null;

      const execution = await triggerTaskExecution({
        taskId: binding.taskId,
        idempotencyKey: buildVoiceExecutionIdempotencyKey(
          binding.taskId,
          input.sessionId,
          input.intentId,
        ),
        reason: "voice_start_task_work",
      });

      return {
        action: input.tool,
        taskId: binding.taskId,
        taskKey: binding.taskKey,
        changed: statusChanged || fromAssignee !== toAssignee || execution.queued,
        status: "in-progress",
        fromStatus,
        toStatus: moved?.transition.to ?? currentTask.status,
        assignee: toAssignee,
        fromAssignee,
        toAssignee,
        execution,
      };
    }

    case "move_task_status": {
      const status = normalizeTaskStatus(input.params?.status);
      const blockedReason = normalizeOptionalText(input.params?.blockedReason);
      const reviewNotes = normalizeOptionalText(input.params?.reviewNotes);
      const currentTask = getTask(binding.taskId).task;
      const currentBlockedReason = currentTask.blockedReason ?? null;
      const currentReviewNotes =
        (currentTask as typeof currentTask & { reviewNotes?: string | null }).reviewNotes ?? null;
      const nextBlockedReason = blockedReason === undefined ? currentBlockedReason : blockedReason;
      const nextReviewNotes = reviewNotes === undefined ? currentReviewNotes : reviewNotes;

      if (
        currentTask.status === status &&
        currentBlockedReason === nextBlockedReason &&
        currentReviewNotes === nextReviewNotes
      ) {
        return {
          action: input.tool,
          taskId: binding.taskId,
          taskKey: binding.taskKey,
          changed: false,
          reason: "already_in_requested_state",
          status,
          fromStatus: currentTask.status,
          toStatus: currentTask.status,
        };
      }

      const moved = moveTask({
        taskId: binding.taskId,
        status,
        blockedReason,
        reviewNotes,
        actorUserId: voiceAuthorUserId(binding),
      });

      return {
        action: input.tool,
        taskId: binding.taskId,
        taskKey: binding.taskKey,
        changed: true,
        status,
        fromStatus: moved.transition.from,
        toStatus: moved.transition.to,
      };
    }

    case "reassign_task": {
      const requested = normalizeAssigneeInput(input.params?.assignee);
      const currentTask = getTask(binding.taskId).task;
      const fromAssignee = currentTask.assignee ?? null;

      const result = assignTask({
        taskId: binding.taskId,
        assignee: requested,
        actorUserId: voiceAuthorUserId(binding),
      });

      const toAssignee = result.task.assignee ?? null;

      return {
        action: input.tool,
        taskId: binding.taskId,
        taskKey: binding.taskKey,
        changed: result.assignmentChanged,
        reason: result.assignmentChanged ? undefined : "already_assigned_to_target",
        assignee: toAssignee,
        fromAssignee,
        toAssignee,
      };
    }

    case "set_task_priority": {
      const priority = normalizeTaskPriority(input.params?.priority);
      const currentTask = getTask(binding.taskId).task;
      const fromPriority = currentTask.priority;

      if (fromPriority === priority) {
        return {
          action: input.tool,
          taskId: binding.taskId,
          taskKey: binding.taskKey,
          changed: false,
          reason: "already_at_requested_priority",
          priority,
          fromPriority,
          toPriority: priority,
        };
      }

      const updated = updateTask({
        taskId: binding.taskId,
        priority,
        actorUserId: voiceAuthorUserId(binding),
      });

      return {
        action: input.tool,
        taskId: binding.taskId,
        taskKey: binding.taskKey,
        changed: true,
        priority,
        fromPriority,
        toPriority: updated.task.priority,
      };
    }

    default: {
      const exhaustive: never = input.tool;
      throw new OrchestrationApiError(400, "voice_action_not_supported", `Unsupported voice action tool: ${exhaustive}`);
    }
  }
}
