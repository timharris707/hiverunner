import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { enqueueWakeup, findCompanyCeo } from "@/lib/orchestration/engine/engine";
import { nextColumnOrder, reconcileTaskHierarchy, refreshAgentLoad } from "@/lib/orchestration/service/shared";

const OPENCLAW_RECONCILE_ACTOR = "openclaw:execution";
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

type ReconciliationCandidateRow = {
  id: string;
  status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked";
  project_id: string;
  sprint_id: string | null;
  parent_task_id: string | null;
  assignee_agent_id: string | null;
  execution_session_id: string | null;
  latest_run_status: string | null;
  has_active_run: number;
};

type ReconciliationScope = {
  companyId?: string;
  projectId?: string;
  agentId?: string;
  limit?: number;
};

export type OpenClawTaskReconciliationResult = {
  reconciled: boolean;
  movedToReview: boolean;
  clearedSession: boolean;
  refreshedAgentIds: string[];
};

function enqueueContinuationWake(
  input: {
    agentId: string;
    companyId: string;
    taskId: string;
    taskStatus: string;
    reason: string;
  },
  db: Database.Database,
): void {
  // Shares the `continuation:{taskId}:{status}` idempotency key with the
  // engine finish-run continuation path (engine.ts:2933). Before this
  // alignment the two paths used distinct keys, so they never coalesced and
  // the second enqueue superseded the first — which, prior to the
  // enqueueWakeup coalesce/prune reorder, meant the first wake vanished.
  enqueueWakeup(
    {
      agentId: input.agentId,
      companyId: input.companyId,
      source: "api",
      reason: input.reason,
      payload: {
        taskId: input.taskId,
        taskStatus: input.taskStatus,
        continuedBy: "terminal_reconciliation",
      },
      idempotencyKey: `continuation:${input.taskId}:${input.taskStatus}`,
    },
    db,
  );
}

function loadTaskReconciliationCandidate(
  taskId: string,
  db: Database.Database,
): ReconciliationCandidateRow | undefined {
  return db
    .prepare(
      `SELECT
         t.id,
         t.status,
         t.project_id,
         t.sprint_id,
         t.parent_task_id,
         t.assignee_agent_id,
         t.execution_session_id,
         (
           SELECT er.status
           FROM execution_runs er
           WHERE er.task_id = t.id
             AND er.provider = 'openclaw'
           ORDER BY COALESCE(er.updated_at, er.completed_at, er.created_at) DESC, er.created_at DESC
           LIMIT 1
         ) AS latest_run_status,
         CASE
           WHEN EXISTS (
             SELECT 1
             FROM execution_runs er_active
             WHERE er_active.task_id = t.id
               AND er_active.provider = 'openclaw'
               AND er_active.status IN ('pending', 'running')
           ) THEN 1
           ELSE 0
         END AS has_active_run
       FROM tasks t
       WHERE t.id = ?
         AND t.archived_at IS NULL
       LIMIT 1`
    )
    .get(taskId) as ReconciliationCandidateRow | undefined;
}

/**
 * Returns the agent_id of the task's most recent terminal execution_run,
 * or null if none exists. Used to break the CEO self-loop: if the latest
 * run on a review-state task was by the CEO and produced no status change,
 * we must not re-wake the CEO again — they already had their chance.
 * Observed 2026-04-18 after the initial review-loop fix: Barometer got
 * re-woken ~18 times in 6 min on WEA-211, each time emitting narrative
 * (report + add_comment) without update_task, re-triggering the wake.
 */
export function latestTerminalRunAgentId(
  taskId: string,
  db: Database.Database,
): string | null {
  const row = db
    .prepare(
      `SELECT agent_id
       FROM execution_runs
       WHERE task_id = ?
         AND status IN ('completed','failed','cancelled')
       ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
       LIMIT 1`,
    )
    .get(taskId) as { agent_id: string | null } | undefined;
  return row?.agent_id ?? null;
}

function loadAgentsPointingAtTask(taskId: string, db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT id
       FROM agents
       WHERE current_task_id = ?
         AND archived_at IS NULL`
    )
    .all(taskId) as Array<{ id: string }>;

  return rows.map((row) => row.id);
}

export function reconcileTerminalOpenClawTaskState(
  taskId: string,
  db = getOrchestrationDb(),
): OpenClawTaskReconciliationResult {
  const candidate = loadTaskReconciliationCandidate(taskId, db);
  if (!candidate) {
    return {
      reconciled: false,
      movedToReview: false,
      clearedSession: false,
      refreshedAgentIds: [],
    };
  }

  if (candidate.has_active_run || !TERMINAL_RUN_STATUSES.has(candidate.latest_run_status ?? "")) {
    return {
      reconciled: false,
      movedToReview: false,
      clearedSession: false,
      refreshedAgentIds: [],
    };
  }

  const refreshedAgentIds = new Set(loadAgentsPointingAtTask(taskId, db));
  let movedToReview = false;
  let clearedSession = false;
  if (candidate.assignee_agent_id) {
    refreshedAgentIds.add(candidate.assignee_agent_id);
  }

  if (candidate.execution_session_id) {
    db.prepare(
      `UPDATE tasks
       SET execution_session_id = NULL,
           updated_at = ?
       WHERE id = ?`
    ).run(new Date().toISOString(), taskId);
    clearedSession = true;
  }

  if (candidate.status === "in_progress" && candidate.latest_run_status === "completed") {
    try {
      const now = new Date().toISOString();
      const reviewColumnOrder = nextColumnOrder(db, candidate.project_id, "review");
      const tx = db.transaction(() => {
        const result = db.prepare(
          `UPDATE tasks
           SET status = 'review',
               column_order = ?,
               completed_at = NULL,
               updated_at = ?
           WHERE id = ?
             AND status = 'in_progress'`
        ).run(reviewColumnOrder, now, taskId);

        if (result.changes === 0) {
          return false;
        }

        db.prepare(
          `INSERT INTO task_events
            (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
           VALUES
            (?, ?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`
        ).run(
          randomUUID(),
          candidate.project_id,
          taskId,
          candidate.assignee_agent_id,
          OPENCLAW_RECONCILE_ACTOR,
          JSON.stringify({ reconciledBy: "terminal_openclaw_run" }),
          now,
        );

        db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, candidate.project_id);
        reconcileTaskHierarchy(db, {
          touchedParentTaskIds: [candidate.parent_task_id],
          touchedSprintIds: [candidate.sprint_id],
          now,
        });
        return true;
      });

      movedToReview = tx();
    } catch (error) {
      console.warn("[orchestration] failed to auto-reconcile stale openclaw task state", {
        taskId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const agentId of refreshedAgentIds) {
    try {
      refreshAgentLoad(db, agentId);
    } catch (error) {
      console.warn("[orchestration] failed to refresh agent load during openclaw reconciliation", {
        agentId,
        taskId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const companyRow = db
    .prepare("SELECT company_id FROM projects WHERE id = ? LIMIT 1")
    .get(candidate.project_id) as { company_id: string | null } | undefined;
  const postStatus = movedToReview ? "review" : candidate.status;
  if (
    candidate.latest_run_status === "completed" &&
    companyRow?.company_id &&
    candidate.assignee_agent_id
  ) {
    if (postStatus === "in_progress") {
      enqueueContinuationWake(
        {
          agentId: candidate.assignee_agent_id,
          companyId: companyRow.company_id,
          taskId,
          taskStatus: postStatus,
          reason: "reconcile_continue_in_progress",
        },
        db,
      );
    } else if (postStatus === "review") {
      // Review is a reviewer-gated state — the assignee cannot approve their
      // own work. Route the continuation wake to the CEO (or skip if no CEO
      // exists or the assignee IS the CEO). This breaks the review-pinning
      // self-loop observed 2026-04-18: 86 `reconcile_continue_review` wakes
      // re-woke the same assignee who could only narrate "reviewing" and
      // never close. Sweep will re-nudge the CEO on subsequent cycles.
      const ceo = findCompanyCeo(companyRow.company_id, db);
      if (ceo && ceo.id !== candidate.assignee_agent_id) {
        // CEO self-loop guard: if the most recent terminal run on this task
        // was BY the CEO, they already had their chance and emitted no
        // status change. Re-waking immediately creates a ~10s CEO loop
        // (observed 2026-04-18 on WEA-211: 18 consecutive ceo_review_requested
        // wakes in 6 min, all narrative-only). The task stays in review
        // until the next assignee run, a sweep cycle after the cooldown,
        // or explicit operator action.
        const latestRunAgent = latestTerminalRunAgentId(taskId, db);
        if (latestRunAgent !== ceo.id) {
          enqueueWakeup(
            {
              agentId: ceo.id,
              companyId: companyRow.company_id,
              source: "api",
              reason: "ceo_review_requested",
              payload: {
                taskId,
                taskStatus: "review",
                assigneeAgentId: candidate.assignee_agent_id,
                requestedBy: "terminal_reconciliation",
              },
              idempotencyKey: `ceo_review:${taskId}`,
            },
            db,
          );
        }
      }
    }
  }

  return {
    reconciled: clearedSession || movedToReview || refreshedAgentIds.size > 0,
    movedToReview,
    clearedSession,
    refreshedAgentIds: [...refreshedAgentIds],
  };
}

export function reconcileScopedTerminalOpenClawTasks(
  scope: ReconciliationScope,
  db = getOrchestrationDb(),
): { reconciledTaskIds: string[] } {
  const whereParts = [
    "t.archived_at IS NULL",
    "t.execution_mode = 'openclaw'",
    `(
      t.status = 'in_progress'
      OR t.execution_session_id IS NOT NULL
      OR EXISTS (
        SELECT 1
        FROM agents ag_current
        WHERE ag_current.current_task_id = t.id
          AND ag_current.archived_at IS NULL
      )
    )`,
    `NOT EXISTS (
      SELECT 1
      FROM execution_runs er_active
      WHERE er_active.task_id = t.id
        AND er_active.provider = 'openclaw'
        AND er_active.status IN ('pending', 'running')
    )`,
    `EXISTS (
      SELECT 1
      FROM execution_runs er_latest
      WHERE er_latest.id = (
        SELECT er_pick.id
        FROM execution_runs er_pick
        WHERE er_pick.task_id = t.id
          AND er_pick.provider = 'openclaw'
        ORDER BY COALESCE(er_pick.updated_at, er_pick.completed_at, er_pick.created_at) DESC, er_pick.created_at DESC
        LIMIT 1
      )
        AND er_latest.status IN ('completed', 'failed', 'cancelled')
    )`,
  ];
  const params: unknown[] = [];

  if (scope.companyId) {
    whereParts.push("p.company_id = ?");
    params.push(scope.companyId);
  }

  if (scope.projectId) {
    whereParts.push("t.project_id = ?");
    params.push(scope.projectId);
  }

  if (scope.agentId) {
    whereParts.push(
      `(
        t.assignee_agent_id = ?
        OR EXISTS (
          SELECT 1
          FROM agents ag_scope
          WHERE ag_scope.id = ?
            AND ag_scope.current_task_id = t.id
            AND ag_scope.archived_at IS NULL
        )
      )`
    );
    params.push(scope.agentId, scope.agentId);
  }

  const limit = Math.max(1, Math.min(250, Math.trunc(scope.limit ?? 100)));
  const rows = db
    .prepare(
      `SELECT t.id
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE ${whereParts.join(" AND ")}
       ORDER BY t.updated_at DESC
       LIMIT ?`
    )
    .all(...params, limit) as Array<{ id: string }>;

  const reconciledTaskIds: string[] = [];
  for (const row of rows) {
    const result = reconcileTerminalOpenClawTaskState(row.id, db);
    if (result.reconciled) {
      reconciledTaskIds.push(row.id);
    }
  }

  return { reconciledTaskIds };
}
