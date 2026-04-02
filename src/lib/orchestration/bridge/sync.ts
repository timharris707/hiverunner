import { OrchestrationApiError } from "@/lib/orchestration/api";
import { createTaskComment, getTask, moveTask } from "@/lib/orchestration/service";
import {
  PaperclipBridgeClient,
  PaperclipBridgeError,
} from "@/lib/orchestration/bridge/client";
import { getPaperclipBridgeConfigFromEnv } from "@/lib/orchestration/bridge/config";
import {
  buildPaperclipIssueDescription,
  mapLocalPriorityToPaperclip,
  mapLocalStatusToPaperclip,
  mapPaperclipStatusToLocal,
} from "@/lib/orchestration/bridge/mapping";
import {
  getLatestTaskExternalCommentRef,
  getTaskBridgeRecord,
  listTaskExternalCommentRefs,
  setTaskPaperclipIssueMapping,
} from "@/lib/orchestration/bridge/store";
import type {
  BridgeTaskRecord,
  LocalTaskStatusDb,
  PaperclipIssueComment,
  PaperclipIssueReference,
} from "@/lib/orchestration/bridge/types";
import type { TaskStatusInput } from "@/lib/orchestration/contracts";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const PAPERCLIP_COMMENT_SOURCE = "paperclip" as const;
const SYSTEM_ACTOR = "paperclip:bridge";
const MAX_IMPORTED_COMMENT_BODY = 9_000;

const STATUS_DB_TO_API: Record<LocalTaskStatusDb, TaskStatusInput> = {
  backlog: "backlog",
  on_deck: "on-deck",
  in_progress: "in-progress",
  review: "review",
  done: "done",
  blocked: "blocked",
};

export type PullTaskBridgeStatusResult = {
  taskId: string;
  paperclipIssueId: string;
  paperclipIssueIdentifier: string;
  syncedAt: string;
  pollIntervalMs: number;
  status: {
    from: TaskStatusInput;
    to: TaskStatusInput;
    changed: boolean;
    skipped: boolean;
    skipReason?: string;
  };
  comments: {
    imported: number;
    skippedDuplicates: number;
    lastImportedCommentId?: string;
  };
  task: ReturnType<typeof getTask>["task"];
};

export type TriggerTaskAssignmentHeartbeatResult = {
  taskId: string;
  assigneeAgentId?: string;
  assigneePaperclipAgentId?: string;
  paperclipIssueId?: string;
  paperclipIssueIdentifier?: string;
  queued: boolean;
  status: "queued" | "running" | "skipped";
  runId?: string;
  reason?: string;
};

async function upsertPaperclipIssueForTask(
  bridge: PaperclipBridgeClient,
  task: BridgeTaskRecord
): Promise<PaperclipIssueReference> {
  const issuePayload = {
    title: task.title,
    description: buildPaperclipIssueDescription(task),
    priority: mapLocalPriorityToPaperclip(task.priority),
    status: mapLocalStatusToPaperclip(task.status),
    assigneeAgentId: task.assigneePaperclipAgentId,
  };

  if (task.paperclipIssueId) {
    return bridge.updateIssue(task.paperclipIssueId, issuePayload);
  }

  const created = await bridge.createIssue(issuePayload);
  setTaskPaperclipIssueMapping({
    taskId: task.id,
    issueId: created.id,
    executionSessionId: created.id,
  });
  return created;
}

function toApiStatus(status: LocalTaskStatusDb): TaskStatusInput {
  return STATUS_DB_TO_API[status];
}

function truncateBody(body: string): string {
  if (body.length <= MAX_IMPORTED_COMMENT_BODY) {
    return body;
  }
  return `${body.slice(0, MAX_IMPORTED_COMMENT_BODY)}\n\n[truncated by Mission Control bridge]`;
}

function formatImportedCommentBody(issueIdentifier: string, comment: PaperclipIssueComment): string {
  const header = `Paperclip (${issueIdentifier}) update:`;
  const text = comment.body.trim() || "(empty comment)";
  return `${header}\n\n${truncateBody(text)}`;
}

function statusSkipReason(error: unknown): string {
  if (!(error instanceof OrchestrationApiError)) {
    return "status_sync_failed";
  }

  if (error.code === "invalid_transition") {
    return "transition_not_allowed";
  }
  if (error.code === "assignee_required") {
    return "assignee_required";
  }
  if (error.code === "review_notes_required") {
    return "review_notes_required";
  }

  return error.code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function attemptsSummary(error: PaperclipBridgeError): string {
  if (!isRecord(error.details)) {
    return "after retries";
  }
  const attempts = typeof error.details.attempts === "number" ? error.details.attempts : undefined;
  const maxAttempts =
    typeof error.details.maxAttempts === "number" ? error.details.maxAttempts : undefined;
  if (!attempts || !maxAttempts) {
    return "after retries";
  }
  return `after ${attempts}/${maxAttempts} attempts`;
}

function bridgeFailureExternalRef(taskId: string, phase: "heartbeat" | "pull", code: string): string {
  return `bridge-failure:${phase}:${taskId}:${code}`;
}

function recordBridgeFailure(taskId: string, phase: "heartbeat" | "pull", error: PaperclipBridgeError): void {
  console.error("[orchestration] paperclip bridge failure", {
    taskId,
    phase,
    code: error.code,
    message: error.message,
    retriable: error.retriable,
    details: error.details,
  });

  createTaskComment({
    taskId,
    type: "status_update",
    authorUserId: SYSTEM_ACTOR,
    externalRef: bridgeFailureExternalRef(taskId, phase, error.code),
    body: [
      `Paperclip bridge ${phase} failed (${error.code}) ${attemptsSummary(error)}.`,
      "",
      `Message: ${error.message}`,
      `Retriable: ${error.retriable ? "yes" : "no"}`,
    ].join("\n"),
  });
}

function markTaskBlockedOnTimeout(taskId: string, phase: "heartbeat" | "pull"): void {
  const reason =
    phase === "heartbeat"
      ? "Paperclip agent wake timed out; execution did not start"
      : "Paperclip status sync timed out";

  const existing = getTask(taskId).task;
  if (!existing || existing.status === "blocked") {
    return;
  }

  try {
    moveTask({
      taskId,
      status: "blocked",
      blockedReason: reason,
      actorUserId: SYSTEM_ACTOR,
    });
  } catch (error) {
    console.error("[orchestration] failed to mark task blocked after timeout", {
      taskId,
      phase,
      error,
    });
    return;
  }

  createTaskComment({
    taskId,
    type: "blocker",
    authorUserId: SYSTEM_ACTOR,
    externalRef: bridgeFailureExternalRef(taskId, phase, "paperclip_timeout_blocked"),
    body: [
      `Task auto-blocked: ${reason}.`,
      "",
      "Action: retry heartbeat once Paperclip connectivity recovers.",
    ].join("\n"),
  });
}

export async function pullTaskBridgeStatus(taskId: string): Promise<PullTaskBridgeStatusResult> {
  const task = getTaskBridgeRecord(taskId);
  if (!task.paperclipIssueId) {
    throw new OrchestrationApiError(
      409,
      "paperclip_issue_not_mapped",
      "Task is not mapped to a Paperclip issue"
    );
  }

  const bridge = new PaperclipBridgeClient(getPaperclipBridgeConfigFromEnv());

  let issue: Awaited<ReturnType<PaperclipBridgeClient["getIssue"]>>;
  let comments: Awaited<ReturnType<PaperclipBridgeClient["listIssueComments"]>>;
  try {
    [issue, comments] = await Promise.all([
      bridge.getIssue(task.paperclipIssueId),
      bridge.listIssueComments(task.paperclipIssueId, {
        after: getLatestTaskExternalCommentRef({ taskId: task.id, source: PAPERCLIP_COMMENT_SOURCE }),
        order: "asc",
      }),
    ]);
  } catch (error) {
    if (error instanceof PaperclipBridgeError) {
      recordBridgeFailure(task.id, "pull", error);
      if (error.code === "paperclip_timeout") {
        markTaskBlockedOnTimeout(task.id, "pull");
      }
    }
    throw error;
  }

  const mappedStatusDb = mapPaperclipStatusToLocal(issue.status);
  const fromStatus = toApiStatus(task.status);
  const toStatus = toApiStatus(mappedStatusDb);

  let statusChanged = false;
  let statusSkipped = false;
  let statusSkip: string | undefined;

  if (mappedStatusDb !== task.status) {
    try {
      moveTask({ taskId: task.id, status: toStatus, actorUserId: SYSTEM_ACTOR });
      statusChanged = true;
    } catch (error) {
      statusSkipped = true;
      statusSkip = statusSkipReason(error);
    }
  }

  const existingExternalRefs = listTaskExternalCommentRefs({
    taskId: task.id,
    source: PAPERCLIP_COMMENT_SOURCE,
  });

  let imported = 0;
  let skippedDuplicates = 0;
  let lastImportedCommentId: string | undefined;

  for (const comment of comments) {
    if (existingExternalRefs.has(comment.id)) {
      skippedDuplicates++;
      continue;
    }

    createTaskComment({
      taskId: task.id,
      body: formatImportedCommentBody(issue.identifier, comment),
      type: "status_update",
      authorUserId:
        comment.authorUserId ??
        (comment.authorAgentId ? `paperclip-agent:${comment.authorAgentId}` : "paperclip"),
      source: PAPERCLIP_COMMENT_SOURCE,
      externalRef: comment.id,
      createdAt: comment.createdAt,
    });

    existingExternalRefs.add(comment.id);
    imported++;
    lastImportedCommentId = comment.id;
  }

  const syncedTask = getTask(task.id).task;
  if (!syncedTask) {
    throw new OrchestrationApiError(500, "task_reload_failed", "Task sync completed but task reload failed");
  }

  return {
    taskId: task.id,
    paperclipIssueId: issue.id,
    paperclipIssueIdentifier: issue.identifier,
    syncedAt: new Date().toISOString(),
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    status: {
      from: fromStatus,
      to: toStatus,
      changed: statusChanged,
      skipped: statusSkipped,
      ...(statusSkip ? { skipReason: statusSkip } : {}),
    },
    comments: {
      imported,
      skippedDuplicates,
      ...(lastImportedCommentId ? { lastImportedCommentId } : {}),
    },
    task: syncedTask,
  };
}

export async function triggerTaskAssignmentHeartbeat(
  input: {
    taskId: string;
    idempotencyKey?: string;
    reason?: string;
    forceFreshSession?: boolean;
  }
): Promise<TriggerTaskAssignmentHeartbeatResult> {
  const task = getTaskBridgeRecord(input.taskId);
  if (task.status !== "in_progress") {
    return {
      taskId: task.id,
      assigneeAgentId: task.assigneeAgentId,
      assigneePaperclipAgentId: task.assigneePaperclipAgentId,
      queued: false,
      status: "skipped",
      reason: "task_not_in_progress",
    };
  }

  if (!task.assigneeAgentId) {
    return {
      taskId: task.id,
      queued: false,
      status: "skipped",
      reason: "assignee_required",
    };
  }

  if (!task.assigneePaperclipAgentId) {
    return {
      taskId: task.id,
      assigneeAgentId: task.assigneeAgentId,
      queued: false,
      status: "skipped",
      reason: "paperclip_agent_mapping_missing",
    };
  }

  const bridge = new PaperclipBridgeClient(getPaperclipBridgeConfigFromEnv());
  let issue: PaperclipIssueReference;
  let wake: Awaited<ReturnType<PaperclipBridgeClient["wakeAgent"]>>;
  try {
    issue = await upsertPaperclipIssueForTask(bridge, task);
    wake = await bridge.wakeAgent(task.assigneePaperclipAgentId, {
      source: "assignment",
      triggerDetail: "system",
      reason: input.reason ?? "mission_control_task_assignment",
      idempotencyKey: input.idempotencyKey ?? null,
      forceFreshSession: input.forceFreshSession ?? false,
      payload: {
        taskId: task.id,
        taskStatus: task.status,
        projectId: task.projectId,
        projectName: task.projectName,
        paperclipIssueId: issue.id,
        paperclipIssueIdentifier: issue.identifier,
        executionMode: task.executionMode,
      },
    });
  } catch (error) {
    if (error instanceof PaperclipBridgeError) {
      recordBridgeFailure(task.id, "heartbeat", error);
      if (error.code === "paperclip_timeout") {
        markTaskBlockedOnTimeout(task.id, "heartbeat");
      }
    }
    throw error;
  }

  return {
    taskId: task.id,
    assigneeAgentId: task.assigneeAgentId,
    assigneePaperclipAgentId: task.assigneePaperclipAgentId,
    paperclipIssueId: issue.id,
    paperclipIssueIdentifier: issue.identifier,
    queued: wake.status !== "skipped",
    status: wake.status,
    runId: wake.runId,
  };
}

export function isBridgeClientError(error: unknown): error is PaperclipBridgeError {
  return error instanceof PaperclipBridgeError;
}
