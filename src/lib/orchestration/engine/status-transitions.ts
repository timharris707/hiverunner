/**
 * Task status state machine.
 *
 * This module is the single function the engine and action-dispatcher call
 * whenever an agent-driven `update_task` action wants to change a task's
 * status. It was extracted from `executeUpdateTask` (action-dispatcher.ts) so
 * the transition rules stop being smeared across engine.ts, the approval-
 * cascade helpers, and the auto-progression paths.
 *
 * The transition contract preserved here (do not change semantics inside this
 * sprint — bugs discovered must be filed as follow-up tasks under a new goal):
 *
 *  1. Normalize the requested status by lowercasing and replacing whitespace
 *     and hyphen runs with `_`. Note: this normalization currently turns
 *     `to-do` into `to_do`, which then fails the `validStatuses` check unless
 *     the caller supplies a canonical token. Preserved verbatim.
 *
 *  2. When the task is in `review` and the requested (normalized) status is
 *     `to-do`, upgrade it to `in_progress` (reviewers who type "to-do" mean
 *     "send it back into work"). Preserved verbatim.
 *
 *  3. Reject `invalid_status` if the normalized value is not in the canonical
 *     set: backlog, to-do, in_progress, review, done, blocked.
 *
 *  4. Auto-accept *without* a DB write when the request is `review` and the
 *     task is a planning-draft lifecycle task that already emitted its draft;
 *     the operator reviews the structured draft on the Goals page, not via
 *     the standard QA review loop.
 *
 *  5. Auto-accept *without* a DB write when the request is `review` on a
 *     learning-review target that already has a decision (memory/skill).
 *
 *  6. Reject `already_at_status` when the normalized status equals the
 *     current task status.
 *
 *  7. Look up `status_transition_rules` for from/to. Reject `no_transition_rule`
 *     when the row is missing.
 *
 *  8. Reject `self_approval_blocked` (G1) when the transition is review → done
 *     and the agent submitting `done` is the same agent who posted the most
 *     recent "Ready for review" comment in the current review cycle.
 *
 *  9. Reject `planning_draft_required` when a sprint-planning task is being
 *     closed without a sprint-plan draft on file. Also records a one-shot
 *     comment + task_event so the operator sees the stuck-lead state.
 *
 * 10. Reject `done_requires_comment` when a done transition has no inline
 *     comment in the same action and no visible comment from the same run.
 *
 * 11. Reject `no_op_resubmission` (G2) when a review-style resubmission has
 *     the same artifact_sha256 the reviewer rejected last time. Best-effort
 *     only — skipped when either sha is null. Bumps the noop counter.
 *
 * 12. In_progress assignee guards:
 *      - With an explicit assignee that doesn't resolve to a runnable agent,
 *        reject `in_progress_assignee_not_found` or `_not_executable`.
 *      - With no explicit assignee, resolve the running agent as the implicit
 *        in-progress owner. If that owner isn't a runnable runtime, reject
 *        `in_progress_requires_assignee`.
 *
 * 13. On success: write tasks.status (clearing blocked_reason unless going to
 *     blocked) and emit a `task.status_changed` task_event with metadata that
 *     stamps the rejected_artifact_sha256 when applicable to G2.
 *
 * The caller still owns the post-transition cascade (reassignment, hierarchy
 * reconcile, sprint auto-complete, dependent autostart, sibling QA rearm,
 * review-rework wake). applyStatusTransition only signals which of those
 * downstream effects apply by returning the resolved implicit owner and
 * the appliedStatus.
 */

import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { isExecutableAgentRuntime } from "@/lib/orchestration/runtime-readiness";

export type StatusTransitionRejectedReason =
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

export type StatusTransitionTask = {
  id: string;
  project_id: string;
  status: string;
  task_key: string | null;
  labels_json: string | null;
  assignee_agent_id: string | null;
  company_id: string | null;
};

export type StatusTransitionAssignee = {
  id: string;
  name: string;
  adapter_type: string | null;
};

export type StatusTransitionContext = {
  agentId: string;
  companyId: string;
  runId: string;
  source?: string;
  now: string;
  /**
   * True when the action carried a non-empty inline `comment`. Used by the
   * `done_requires_comment` guard so we don't ask the DB for a visible
   * comment that is about to be written by the caller anyway.
   */
  inlineCommentProvided: boolean;
  /** True when the action included an `assignee` field. */
  assigneeRequested: boolean;
  /**
   * Resolved assignee row when the caller already looked it up (typically by
   * agent name within the task's company). Passing null with
   * assigneeRequested=true means "agent name supplied but did not resolve".
   */
  requestedAssignee: StatusTransitionAssignee | null;
};

export type StatusTransitionResult = {
  /**
   * Mirrors the legacy `statusApplied` shape: true when the request was
   * honored (including the planning-draft / learning-review auto-accepts that
   * deliberately skip the DB write).
   */
  statusApplied: boolean;
  statusRejectedReason?: StatusTransitionRejectedReason;
  /** The normalized status after the `review`+`to-do` upgrade. */
  normalizedStatus?: string;
  /**
   * True only when the tasks row was actually mutated. Cascade side effects
   * (sprint auto-complete, dependent autostart, hierarchy reconcile, sibling
   * QA rearm, review-rework wake) should only fire on `statusWritten = true`.
   */
  statusWritten: boolean;
  /** Resolved implicit owner for an in_progress transition with no explicit assignee. */
  implicitInProgressOwner?: StatusTransitionAssignee | null;
};

const VALID_STATUSES = ["backlog", "to-do", "in_progress", "review", "done", "blocked"];

export function taskLabelsInclude(labelsJson: string | null | undefined, label: string): boolean {
  if (!labelsJson) return false;
  try {
    const parsed = JSON.parse(labelsJson) as unknown;
    return Array.isArray(parsed) && parsed.some((entry) => String(entry).toLowerCase() === label);
  } catch {
    return labelsJson.includes(label);
  }
}

export function isPlanningDraftLifecycleTask(labelsJson: string | null | undefined): boolean {
  return taskLabelsInclude(labelsJson, "sprint-planning") || taskLabelsInclude(labelsJson, "plan-revision");
}

export function planningTaskHasSprintDraft(db: Database.Database, taskId: string): boolean {
  const row = db
    .prepare("SELECT id FROM goal_sprint_plan_drafts WHERE planning_task_id = ? AND status IN ('pending', 'approved') LIMIT 1")
    .get(taskId) as { id: string } | undefined;
  return Boolean(row);
}

export function learningReviewTargetHasDecision(db: Database.Database, taskId: string): boolean {
  const memory = db
    .prepare(
      `SELECT 1 AS found
       FROM company_memory_records
       WHERE json_extract(metadata_json, '$.reviewTask.taskId') = ?
         AND json_extract(metadata_json, '$.reviewDecision.decision') IN ('approve', 'reject')
       LIMIT 1`,
    )
    .get(taskId) as { found: number } | undefined;
  if (memory) return true;

  const skill = db
    .prepare(
      `SELECT 1 AS found
       FROM company_skills
       WHERE json_extract(metadata_json, '$.reviewTask.taskId') = ?
         AND json_extract(metadata_json, '$.reviewDecision.decision') IN ('approve', 'reject')
       LIMIT 1`,
    )
    .get(taskId) as { found: number } | undefined;
  return Boolean(skill);
}

// G1 — No self-approval guardrail.
// Returns the agent_id of the most recent "Ready for review" comment posted
// in the *current* review cycle (i.e. after the latest task.status_changed
// event whose to_status is 'review'). Returns null when there's no match.
export function getLatestReviewSubmissionAuthor(
  taskId: string,
  db: Database.Database,
): string | null {
  const lastReviewEntry = db
    .prepare(
      `SELECT created_at FROM task_events
       WHERE task_id = ? AND event_type = 'task.status_changed' AND to_status = 'review'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(taskId) as { created_at: string } | undefined;

  if (!lastReviewEntry) return null;

  const submission = db
    .prepare(
      `SELECT author_agent_id FROM comments
       WHERE task_id = ?
         AND author_agent_id IS NOT NULL
         AND created_at >= ?
         AND LOWER(TRIM(body)) LIKE 'ready for review%'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(taskId, lastReviewEntry.created_at) as { author_agent_id: string | null } | undefined;

  return submission?.author_agent_id ?? null;
}

function taskHasVisibleCommentFromRun(
  db: Database.Database,
  input: { taskId: string; agentId: string; runId: string },
): boolean {
  const existing = db
    .prepare(
      `SELECT 1
         FROM task_events
        WHERE task_id = ?
          AND agent_id = ?
          AND event_type = 'task.comment_added'
          AND json_extract(metadata_json, '$.runId') = ?
        LIMIT 1`,
    )
    .get(input.taskId, input.agentId, input.runId);

  return Boolean(existing);
}

// G2 — No-op resubmission detection.
function detectNoOpResubmission(
  taskId: string,
  db: Database.Database,
): { isNoOp: boolean; rejectedSha: string | null; currentSha: string | null } {
  const taskRow = db
    .prepare("SELECT artifact_sha256 FROM tasks WHERE id = ? LIMIT 1")
    .get(taskId) as { artifact_sha256: string | null } | undefined;
  const currentSha = taskRow?.artifact_sha256 ?? null;
  if (!currentSha) return { isNoOp: false, rejectedSha: null, currentSha };

  const rejection = db
    .prepare(
      `SELECT metadata_json FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.status_changed'
         AND from_status = 'review'
         AND to_status IN ('in_progress', 'to-do')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(taskId) as { metadata_json: string } | undefined;
  if (!rejection) return { isNoOp: false, rejectedSha: null, currentSha };

  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(rejection.metadata_json) as Record<string, unknown>; } catch { metadata = {}; }
  const rejectedSha = typeof metadata.rejected_artifact_sha256 === "string"
    ? metadata.rejected_artifact_sha256
    : null;
  if (!rejectedSha) return { isNoOp: false, rejectedSha: null, currentSha };

  return {
    isNoOp: rejectedSha === currentSha,
    rejectedSha,
    currentSha,
  };
}

function recordPlanningDraftRequiredRejection(input: {
  db: Database.Database;
  task: { id: string; project_id: string; task_key: string | null };
  agentId: string;
  runId: string;
  now: string;
}): void {
  const externalRef = `engine:planning-draft-required:${input.task.id}:${input.runId}`;
  const existing = input.db
    .prepare("SELECT id FROM comments WHERE task_id = ? AND external_ref = ? LIMIT 1")
    .get(input.task.id, externalRef) as { id: string } | undefined;
  if (!existing) {
    const body = "Lead agent closed planning task without emitting propose_sprint_plan - task remains open. Emit the sprint plan using a fenced mc-action block or tool call so the operator can review and approve it.";
    input.db.prepare(
      `INSERT INTO comments (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, 'status_update', 'engine', ?, ?, ?)`
    ).run(randomUUID(), input.task.id, body, externalRef, input.now, input.now);
    input.db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`
    ).run(
      randomUUID(),
      input.task.project_id,
      input.task.id,
      input.agentId,
      JSON.stringify({ source: "engine_planning_draft_guard", runId: input.runId }),
      input.now,
    );
  }
  console.warn("[stuck-lead-proposal]", {
    taskId: input.task.id,
    taskKey: input.task.task_key,
    agentId: input.agentId,
    runId: input.runId,
    message: "Lead planning task attempted to close without a goal_sprint_plan_drafts row.",
  });
}

export function applyStatusTransition(
  task: StatusTransitionTask,
  requestedStatus: string,
  ctx: StatusTransitionContext,
  db: Database.Database,
): StatusTransitionResult {
  const result: StatusTransitionResult = {
    statusApplied: false,
    statusWritten: false,
  };

  let normalized = requestedStatus.toLowerCase().replace(/[\s-]+/g, "_");
  if (task.status === "review" && normalized === "to-do") {
    normalized = "in_progress";
  }
  result.normalizedStatus = normalized;

  if (!VALID_STATUSES.includes(normalized)) {
    result.statusRejectedReason = "invalid_status";
    return result;
  }

  if (
    normalized === "review" &&
    isPlanningDraftLifecycleTask(task.labels_json) &&
    planningTaskHasSprintDraft(db, task.id)
  ) {
    // Structured sprint-plan drafts are operator-reviewed on the goal page.
    // Treat the lead's "ready for review" update as already satisfied so the
    // planning/revision task does not enter the normal QA review/rework loop.
    result.statusApplied = true;
    return result;
  }

  if (
    normalized === "review" &&
    task.status === "done" &&
    learningReviewTargetHasDecision(db, task.id)
  ) {
    result.statusApplied = true;
    return result;
  }

  if (normalized === task.status) {
    result.statusRejectedReason = "already_at_status";
    return result;
  }

  const rule = db
    .prepare("SELECT 1 FROM status_transition_rules WHERE from_status = ? AND to_status = ?")
    .get(task.status, normalized);
  if (!rule) {
    result.statusRejectedReason = "no_transition_rule";
    return result;
  }

  if (
    task.status === "review" &&
    normalized === "done" &&
    getLatestReviewSubmissionAuthor(task.id, db) === ctx.agentId
  ) {
    // G1 — same agent submitted "Ready for review" and is now trying to close
    // to done. Reject; the sweeper will route the next review wake to a fresh
    // reviewer (declared QA or CEO) per existing logic.
    result.statusRejectedReason = "self_approval_blocked";
    return result;
  }

  if (
    normalized === "done" &&
    taskLabelsInclude(task.labels_json, "sprint-planning") &&
    !planningTaskHasSprintDraft(db, task.id)
  ) {
    result.statusRejectedReason = "planning_draft_required";
    recordPlanningDraftRequiredRejection({
      db,
      task: { id: task.id, project_id: task.project_id, task_key: task.task_key },
      agentId: ctx.agentId,
      runId: ctx.runId,
      now: ctx.now,
    });
    return result;
  }

  if (
    normalized === "done" &&
    !ctx.inlineCommentProvided &&
    !taskHasVisibleCommentFromRun(db, { taskId: task.id, agentId: ctx.agentId, runId: ctx.runId })
  ) {
    // A Done transition is operator-visible closure. Require a visible
    // comment in the same heartbeat run so cards/details explain what
    // happened instead of silently jumping to Done.
    result.statusRejectedReason = "done_requires_comment";
    return result;
  }

  if (
    // G2 — resubmitting to review (from in_progress or to-do) without
    // changing the artifact since the prior rejection. Skip silently when
    // no sha is on file (best-effort).
    normalized === "review" &&
    (task.status === "in_progress" || task.status === "to-do") &&
    detectNoOpResubmission(task.id, db).isNoOp
  ) {
    result.statusRejectedReason = "no_op_resubmission";
    // Bump the noop counter so the existing circuit breaker triggers if the
    // agent keeps re-submitting unchanged. Counter is reset on any operator-
    // driven status change, matching the behavior of moveTask.
    db.prepare("UPDATE tasks SET consecutive_noop_wakes = COALESCE(consecutive_noop_wakes, 0) + 1, updated_at = ? WHERE id = ?")
      .run(ctx.now, task.id);
    return result;
  }

  if (
    normalized === "in_progress" &&
    !task.assignee_agent_id &&
    ctx.assigneeRequested &&
    (!ctx.requestedAssignee || !isExecutableAgentRuntime(ctx.requestedAssignee.adapter_type))
  ) {
    // A task in progress must have an accountable owner. If the action names
    // an invalid or non-runnable assignee, reject the status move instead of
    // creating an unassigned in_progress card.
    result.statusRejectedReason = ctx.requestedAssignee
      ? "in_progress_assignee_not_executable"
      : "in_progress_assignee_not_found";
    return result;
  }

  let implicitInProgressOwner: StatusTransitionAssignee | null = null;
  if (
    normalized === "in_progress" &&
    !task.assignee_agent_id &&
    !ctx.assigneeRequested &&
    task.company_id
  ) {
    implicitInProgressOwner = db
      .prepare(
        `SELECT id, name, adapter_type
           FROM agents
          WHERE id = ?
            AND company_id = ?
            AND archived_at IS NULL
          LIMIT 1`,
      )
      .get(ctx.agentId, task.company_id) as StatusTransitionAssignee | undefined ?? null;
  }

  if (
    normalized === "in_progress" &&
    !task.assignee_agent_id &&
    !ctx.assigneeRequested &&
    (!implicitInProgressOwner || !isExecutableAgentRuntime(implicitInProgressOwner.adapter_type))
  ) {
    result.statusRejectedReason = "in_progress_requires_assignee";
    return result;
  }

  // All guards passed. Stamp the row and the status_changed event.
  // Capture the artifact sha at rejection time so G2 can compare it on the
  // next resubmission. Stamped into the status_changed event metadata only
  // for review → in_progress / to-do transitions.
  const rejectionMetadata: Record<string, unknown> = {
    source: "engine_action",
    runId: ctx.runId,
  };
  if (
    task.status === "review" &&
    (normalized === "in_progress" || normalized === "to-do")
  ) {
    const taskRow = db
      .prepare("SELECT artifact_sha256 FROM tasks WHERE id = ? LIMIT 1")
      .get(task.id) as { artifact_sha256: string | null } | undefined;
    if (taskRow?.artifact_sha256) {
      rejectionMetadata.rejected_artifact_sha256 = taskRow.artifact_sha256;
    }
  }

  db.prepare(
    `UPDATE tasks
       SET status = ?,
           blocked_reason = CASE WHEN ? = 'blocked' THEN blocked_reason ELSE NULL END,
           updated_at = ?
     WHERE id = ?`,
  ).run(normalized, normalized, ctx.now, task.id);
  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    ctx.agentId,
    task.status,
    normalized,
    JSON.stringify(rejectionMetadata),
    ctx.now,
  );

  result.statusApplied = true;
  result.statusWritten = true;
  result.implicitInProgressOwner = implicitInProgressOwner;
  return result;
}
