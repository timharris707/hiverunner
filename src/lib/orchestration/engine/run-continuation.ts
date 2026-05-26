import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { parseJson } from "@/lib/orchestration/engine/persistence";
import type { HeartbeatRunStatus } from "@/lib/orchestration/engine/wakeup-queue";

export type ActionResults = {
  messagesImported: number;
  actionsFound: number;
  actionsExecuted: number;
  actionsSkippedDedup: number;
  actionsDeferred: number;
  tasksCreated: string[];
  approvalsCreated: string[];
  reportsImported: number;
  errors: string[];
  hadDroppedActions?: boolean;
  fatalError?: string | null;
};

export type ContinuationDecision = {
  shouldContinue: boolean;
  reason?: string;
};

export const MISSING_SESSION_OUTPUT_ERROR = "missing_session_output: could not retrieve session data after execution";
export const EMPTY_ASSISTANT_OUTPUT_ERROR = "empty_assistant_output: session completed without any assistant text output";
export const OPENCLAW_SESSION_TIMEOUT_ERROR = "openclaw_session_timeout: session did not complete before import deadline";
export const NO_OP_RESUBMISSION_ERROR = "no_op_resubmission";
export const SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX = "sweep_unassigned_to_ceo scope violation:";
export const SWEEP_UNASSIGNED_NO_ACTION_ERROR = `${SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX} no allowed action found for unassigned triage wake.`;

export function loadStoredActionResults(
  runId: string,
  db: Database.Database,
): ActionResults | null {
  try {
    const stored = db
      .prepare("SELECT result_json FROM heartbeat_runs WHERE id = ? LIMIT 1")
      .get(runId) as { result_json: string | null } | undefined;

    if (!stored?.result_json) return null;

    const parsed = JSON.parse(stored.result_json) as Partial<ActionResults>;
    return {
      messagesImported: Number(parsed.messagesImported ?? 0),
      actionsFound: Number(parsed.actionsFound ?? 0),
      actionsExecuted: Number(parsed.actionsExecuted ?? 0),
      actionsSkippedDedup: Number(parsed.actionsSkippedDedup ?? 0),
      actionsDeferred: Number(parsed.actionsDeferred ?? 0),
      tasksCreated: Array.isArray(parsed.tasksCreated) ? parsed.tasksCreated as string[] : [],
      approvalsCreated: Array.isArray(parsed.approvalsCreated) ? parsed.approvalsCreated as string[] : [],
      reportsImported: Number(parsed.reportsImported ?? 0),
      errors: Array.isArray(parsed.errors) ? parsed.errors as string[] : [],
      fatalError: typeof parsed.fatalError === "string" ? parsed.fatalError : null,
    };
  } catch {
    return null;
  }
}

export function getActionResultsTerminalFailure(actionResults: ActionResults | null | undefined): string | null {
  if (!actionResults) return null;
  if (typeof actionResults.fatalError === "string" && actionResults.fatalError.trim()) {
    return actionResults.fatalError;
  }
  if (actionResults.errors.includes(EMPTY_ASSISTANT_OUTPUT_ERROR) || actionResults.errors.includes("No assistant text output found in session")) {
    return EMPTY_ASSISTANT_OUTPUT_ERROR;
  }
  if (actionResults.errors.includes(MISSING_SESSION_OUTPUT_ERROR) || actionResults.errors.includes("Could not retrieve session data after execution")) {
    return MISSING_SESSION_OUTPUT_ERROR;
  }
  if (actionResults.errors.includes(OPENCLAW_SESSION_TIMEOUT_ERROR)) {
    return OPENCLAW_SESSION_TIMEOUT_ERROR;
  }
  if (actionResults.errors.some((error) => error.includes(NO_OP_RESUBMISSION_ERROR))) {
    return NO_OP_RESUBMISSION_ERROR;
  }
  if (actionResults.errors.some((error) => error.startsWith(SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX))) {
    return SWEEP_UNASSIGNED_SCOPE_VIOLATION_PREFIX;
  }
  return null;
}

export function isInsufficientProgress(
  taskId: string,
  actionResults: ActionResults,
  db: Database.Database,
): boolean {
  const task = db
    .prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(taskId) as { status: string; assignee_agent_id: string | null } | undefined;

  if (!task?.assignee_agent_id) return false;
  if (["done", "blocked", "review"].includes(task.status)) return false;

  // Plain imported reports/status text are not enough. Unfinished assigned work
  // must include at least one concrete structured action (for example add_comment
  // or update_task), otherwise the run is insufficient progress.
  return actionResults.actionsExecuted === 0;
}

export function decideFinishRunContinuation(
  taskId: string,
  runId: string,
  finalStatus: HeartbeatRunStatus,
  db = getOrchestrationDb(),
): ContinuationDecision {
  // Never auto-requeue failed/timed-out runs. They need intervention, not a
  // fresh queue entry that can starve real work behind a retry storm.
  if (finalStatus !== "succeeded") return { shouldContinue: false };

  const actionResults = loadStoredActionResults(runId, db);
  if (!actionResults) return { shouldContinue: false };
  if (getActionResultsTerminalFailure(actionResults)) return { shouldContinue: false };

  return decideTaskContinuation(taskId, actionResults, db);
}

export function decideTaskContinuation(
  taskId: string,
  actionResults: ActionResults,
  db: Database.Database,
): ContinuationDecision {
  const task = db
    .prepare("SELECT id, status, assignee_agent_id FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(taskId) as { id: string; status: string; assignee_agent_id: string | null } | undefined;

  if (!task || !task.assignee_agent_id) return { shouldContinue: false };
  if (task.status === "done" || task.status === "blocked") return { shouldContinue: false };
  if (getActionResultsTerminalFailure(actionResults)) return { shouldContinue: false };

  if (task.status === "to-do") {
    // If a task is still to-do at the end of the run, nothing structurally moved
    // it. Comments, reports, and hire_agent calls are narrative; they don't
    // represent progress on THIS task.
    return { shouldContinue: false };
  }
  if (task.status === "review") {
    // Review is gated by a reviewer or lead wake; the assignee does not
    // immediately self-continue.
    return { shouldContinue: false };
  }

  if (task.status === "in_progress") {
    // A successful run should not immediately queue itself again. The next wake
    // should come from a user, manager, routine, or sweep rather than a tight
    // self-loop.
    return { shouldContinue: false };
  }

  return { shouldContinue: false };
}

export function runHadExecutedStructuralTaskAction(
  runId: string,
  taskKey: string,
  db: Database.Database,
): boolean {
  const row = db
    .prepare("SELECT result_json FROM heartbeat_runs WHERE id = ? LIMIT 1")
    .get(runId) as { result_json: string } | undefined;
  if (!row?.result_json) return false;

  try {
    const parsed = JSON.parse(row.result_json) as {
      perActionDetail?: Array<{ action?: unknown; target?: unknown; status?: unknown }>;
    };
    return (parsed.perActionDetail ?? []).some((detail) => {
      if (detail.status !== "executed") return false;
      if (detail.target === taskKey && (detail.action === "update_task" || detail.action === "register_artifact")) {
        return true;
      }
      return detail.action === "propose_sprint_plan" ||
        detail.action === "record_validation_evidence" ||
        detail.action === "record_success_evidence" ||
        detail.action === "register_artifact";
    });
  } catch {
    return false;
  }
}

export function isHumanCommentWake(
  input: {
    taskId: string;
    runId: string;
    agentId: string;
    runWindowStart: string;
  },
  db: Database.Database,
): boolean {
  const run = db
    .prepare(
      `SELECT trigger_detail, context_snapshot_json
         FROM heartbeat_runs
        WHERE id = ?
        LIMIT 1`,
    )
    .get(input.runId) as { trigger_detail: string | null; context_snapshot_json: string | null } | undefined;
  const context = parseJson(run?.context_snapshot_json);
  return (
    context.wakeReason === "user_comment_on_assigned_task" ||
    typeof context.commentId === "string" ||
    (run?.trigger_detail ?? "").startsWith("task_comment:")
  );
}

export function hasMeaningfulAgentCommentProgress(
  input: {
    taskId: string;
    runId: string;
    agentId: string;
    runWindowStart: string;
  },
  db: Database.Database,
): boolean {
  const commentRows = db
    .prepare(
      `SELECT body
         FROM comments
        WHERE task_id = ?
          AND author_agent_id = ?
          AND source != 'engine'
          AND created_at >= ?
        ORDER BY created_at ASC`,
    )
    .all(input.taskId, input.agentId, input.runWindowStart) as Array<{ body: string | null }>;

  for (const row of commentRows) {
    const normalized = normalizeProgressComment(row.body);
    if (!normalized || !isSubstantiveProgressComment(normalized)) continue;

    const previousRows = db
      .prepare(
        `SELECT body
           FROM comments
          WHERE task_id = ?
            AND author_agent_id = ?
            AND source != 'engine'
            AND created_at < ?
          ORDER BY created_at DESC
          LIMIT 20`,
      )
      .all(input.taskId, input.agentId, input.runWindowStart) as Array<{ body: string | null }>;

    const duplicate = previousRows.some((previous) => normalizeProgressComment(previous.body) === normalized);
    if (!duplicate) return true;
  }

  const eventRow = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM task_events
        WHERE task_id = ?
          AND agent_id = ?
          AND event_type = 'task.comment_added'
          AND json_extract(metadata_json, '$.runId') = ?
          AND created_at >= ?`,
    )
    .get(input.taskId, input.agentId, input.runId, input.runWindowStart) as { n: number } | undefined;

  return (eventRow?.n ?? 0) > 0;
}

function normalizeProgressComment(body: string | null | undefined): string {
  return (body ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isSubstantiveProgressComment(normalizedBody: string): boolean {
  if (!normalizedBody) return false;
  if (/^(starting|started|working|running|queued|heartbeat|now i('|\u2019)ll|i('|\u2019)ll start|researching)\b/.test(normalizedBody)) {
    return false;
  }
  return normalizedBody.length >= 24;
}

function runHasExplicitReviewOrDoneDeclaration(
  db: Database.Database,
  input: { taskId: string; agentId: string; runId: string }
): boolean {
  const row = db
    .prepare(
      `SELECT 1
       FROM task_events
       WHERE task_id = ?
         AND agent_id = ?
         AND event_type = 'task.status_changed'
         AND to_status IN ('review', 'done')
         AND json_extract(metadata_json, '$.runId') = ?
       LIMIT 1`
    )
    .get(input.taskId, input.agentId, input.runId);
  return Boolean(row);
}

function runHasExplicitReviewReturnDeclaration(
  db: Database.Database,
  input: { taskId: string; agentId: string; runId: string }
): boolean {
  const row = db
    .prepare(
      `SELECT 1
       FROM task_events
       WHERE task_id = ?
         AND agent_id = ?
         AND event_type = 'task.status_changed'
         AND from_status = 'review'
         AND to_status IN ('in_progress', 'to-do', 'blocked')
         AND json_extract(metadata_json, '$.runId') = ?
       LIMIT 1`
    )
    .get(input.taskId, input.agentId, input.runId);
  return Boolean(row);
}

function runHasSubstantiveTaskWork(
  db: Database.Database,
  input: { taskId: string; agentId: string; runId: string; runWindowStart?: string | null }
): boolean {
  const row = db
    .prepare(
      `SELECT 1
       FROM task_events
       WHERE task_id = ?
         AND agent_id = ?
         AND event_type IN ('task.comment_added', 'task.artifact_registered')
         AND (
           json_extract(metadata_json, '$.runId') = ?
           OR created_at >= COALESCE(?, created_at)
         )
       LIMIT 1`
    )
    .get(input.taskId, input.agentId, input.runId, input.runWindowStart ?? null);
  return Boolean(row);
}

function incrementMissingEndDeclarationTelemetry(db: Database.Database, runId: string): void {
  const row = db
    .prepare("SELECT usage_json FROM heartbeat_runs WHERE id = ? LIMIT 1")
    .get(runId) as { usage_json: string | null } | undefined;
  let usage: Record<string, unknown> = {};
  try {
    usage = row?.usage_json ? JSON.parse(row.usage_json) as Record<string, unknown> : {};
  } catch {
    usage = {};
  }
  usage.missingEndDeclaration = Number(usage.missingEndDeclaration ?? 0) + 1;
  db.prepare("UPDATE heartbeat_runs SET usage_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(usage), new Date().toISOString(), runId);
}

export function autoFlipTaskToReviewAfterMissingEndDeclaration(
  db: Database.Database,
  input: { taskId: string; agentId: string; runId: string; runWindowStart?: string | null; now: string }
): boolean {
  const task = db
    .prepare("SELECT id, project_id, status FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(input.taskId) as { id: string; project_id: string | null; status: string } | undefined;
  if (!task || !["in_progress", "to-do"].includes(task.status)) return false;
  if (runHasExplicitReviewOrDoneDeclaration(db, input)) return false;
  if (runHasExplicitReviewReturnDeclaration(db, input)) return false;
  if (!runHasSubstantiveTaskWork(db, input)) return false;

  const changed = db
    .prepare(
      `UPDATE tasks
       SET status = 'review',
           review_notes = COALESCE(review_notes, 'Engine auto-moved to review after completed work without an explicit end-of-run declaration.'),
           updated_at = ?
       WHERE id = ?
         AND status IN ('in_progress', 'to-do')
         AND archived_at IS NULL`
    )
    .run(input.now, task.id);
  if (changed.changes === 0) return false;
  const reviewNotes = "Engine auto-moved to review after completed work without an explicit end-of-run declaration.";

  db.prepare(
    `INSERT INTO task_events
      (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'review', ?, ?)`
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    task.status,
    JSON.stringify({
      source: "engine_end_of_run_autoflip",
      runId: input.runId,
      reason: "agent_did_work_without_declaring_terminal_status",
      review_notes: reviewNotes,
    }),
    input.now,
  );
  db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'status_update', 'mission_control', ?, ?, ?)`
  ).run(
    randomUUID(),
    task.id,
    "Agent completed substantive work but did not emit update_task to declare review/done. Engine auto-moved this task to review to unblock dependent work. Future runs should explicitly emit update_task at end of work.",
    `engine:end-of-run-autoflip:${input.runId}`,
    input.now,
    input.now,
  );
  incrementMissingEndDeclarationTelemetry(db, input.runId);
  return true;
}
