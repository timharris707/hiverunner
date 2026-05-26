/**
 * In-Progress-Loop Circuit Breaker
 *
 * Detects stuck-agent loops (3 consecutive wakes with no structural progress)
 * and routes through reassign → decompose → reframe before blocking the task
 * for operator judgment. Called from heartbeat-manager via the dependency
 * injection wiring configured by engine.ts.
 */
import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  hasOpenChildTasks,
  queueParentBlockedWake,
  safeJsonStringArray,
} from "@/lib/orchestration/engine/action-dispatcher";
import { findCompanyCeo } from "@/lib/orchestration/engine/engine-queries";
import {
  hasMeaningfulAgentCommentProgress,
  isHumanCommentWake,
  runHadExecutedStructuralTaskAction,
} from "@/lib/orchestration/engine/run-continuation";
import { enqueueWakeup } from "@/lib/orchestration/engine/wakeup-queue";
import { isExecutableAgentRuntime } from "@/lib/orchestration/runtime-readiness";
import { refreshAgentLoad } from "@/lib/orchestration/service/shared";

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

function enqueueBlockedTaskLeadershipWake(
  db: Database.Database,
  input: { taskId: string; companyId: string; reason: "decompose_blocked_task" | "reframe_blocked_task"; now: string },
): boolean {
  const ceo = findCompanyCeo(input.companyId, db);
  if (!ceo?.id) return false;
  const wake = enqueueWakeup(
    {
      agentId: ceo.id,
      companyId: input.companyId,
      source: "api",
      reason: input.reason,
      triggerDetail: input.reason,
      payload: {
        taskId: input.taskId,
        taskStatus: "blocked",
        instruction:
          input.reason === "decompose_blocked_task"
            ? "Decompose this blocked task into concrete subtasks using create_task with dependsOn. Do not only narrate the options."
            : "Rewrite this blocked task to clarify acceptance criteria, scope, and next action. Do not only narrate the options.",
      },
      idempotencyKey: `${input.reason}:${input.taskId}`,
    },
    db,
  );
  return wake.status === "queued" || wake.status === "coalesced";
}

function handleCircuitBreakerRoutableEscalation(
  db: Database.Database,
  input: {
    task: { id: string; project_id: string; status: string; assignee_agent_id: string | null; company_id: string };
    agentId: string;
    runId: string;
    noOpCount: number;
    now: string;
  },
): boolean {
  const next = findNextResilienceAssignee(db, {
    taskId: input.task.id,
    excludeAgentIds: [input.agentId],
  });
  if (next) {
    db.prepare(
      `UPDATE tasks
       SET assignee_agent_id = ?,
           assigned_at = ?,
           consecutive_noop_wakes = 0,
           status = CASE WHEN status = 'blocked' THEN 'to-do' ELSE status END,
           updated_at = ?
       WHERE id = ?`
    ).run(next.id, input.now, input.now, input.task.id);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.reassigned', ?, ?)`
    ).run(
      randomUUID(),
      input.task.project_id,
      input.task.id,
      next.id,
      JSON.stringify({
        source: "capable_list_rotation",
        from: input.agentId,
        to: next.id,
        noOpWakes: input.noOpCount,
        runId: input.runId,
      }),
      input.now,
    );
    db.prepare(
      `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'status_update', 'escalation', ?, ?, ?)`
    ).run(
      randomUUID(),
      input.task.id,
      `[ESCALATION] Reassigned from ${input.agentId} to ${next.name} after no-op loop. Reason: capable-list rotation; prior agent ran ${input.noOpCount} no-op wakes.`,
      `engine:capable-list-rotation:${input.runId}`,
      input.now,
      input.now,
    );
    enqueueWakeup(
      {
        agentId: next.id,
        companyId: input.task.company_id,
        source: "api",
        reason: "circuit_breaker_reassigned",
        payload: {
          taskId: input.task.id,
          taskStatus: input.task.status,
          reassignedFromAgentId: input.agentId,
          runId: input.runId,
        },
        idempotencyKey: `circuit_breaker_reassigned:${input.task.id}:${next.id}`,
      },
      db,
    );
    refreshAgentLoad(db, input.agentId);
    refreshAgentLoad(db, next.id);
    return true;
  }

  const decomposedAlready = db
    .prepare(
      `SELECT 1 FROM task_events
       WHERE task_id = ?
         AND json_extract(metadata_json, '$.source') = 'decompose_blocked_task'
       LIMIT 1`
    )
    .get(input.task.id);
  if (!decomposedAlready && enqueueBlockedTaskLeadershipWake(db, {
    taskId: input.task.id,
    companyId: input.task.company_id,
    reason: "decompose_blocked_task",
    now: input.now,
  })) {
    db.prepare("UPDATE tasks SET status = 'blocked', blocked_reason = ?, consecutive_noop_wakes = 0, updated_at = ? WHERE id = ?")
      .run("Decomposition requested after no-op loop", input.now, input.task.id);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'blocked', ?, ?)`
    ).run(
      randomUUID(),
      input.task.project_id,
      input.task.id,
      input.agentId,
      input.task.status,
      JSON.stringify({ source: "decompose_blocked_task", runId: input.runId, noOpWakes: input.noOpCount }),
      input.now,
    );
    db.prepare(
      `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'status_update', 'escalation', ?, ?, ?)`
    ).run(
      randomUUID(),
      input.task.id,
      `[ESCALATION] No capable alternate was available after ${input.noOpCount} no-op wakes. Woke the lead to decompose this task into concrete subtasks.`,
      `engine:decompose-blocked:${input.runId}`,
      input.now,
      input.now,
    );
    return true;
  }

  const reframedAlready = db
    .prepare(
      `SELECT 1 FROM task_events
       WHERE task_id = ?
         AND json_extract(metadata_json, '$.source') = 'reframe_blocked_task'
       LIMIT 1`
    )
    .get(input.task.id);
  if (!reframedAlready && enqueueBlockedTaskLeadershipWake(db, {
    taskId: input.task.id,
    companyId: input.task.company_id,
    reason: "reframe_blocked_task",
    now: input.now,
  })) {
    db.prepare("UPDATE tasks SET status = 'blocked', blocked_reason = ?, consecutive_noop_wakes = 0, updated_at = ? WHERE id = ?")
      .run("Reframe requested after no-op loop", input.now, input.task.id);
    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'blocked', ?, ?)`
    ).run(
      randomUUID(),
      input.task.project_id,
      input.task.id,
      input.agentId,
      input.task.status,
      JSON.stringify({ source: "reframe_blocked_task", runId: input.runId, noOpWakes: input.noOpCount }),
      input.now,
    );
    db.prepare(
      `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'status_update', 'escalation', ?, ?, ?)`
    ).run(
      randomUUID(),
      input.task.id,
      `[ESCALATION] Decomposition was already attempted or unavailable. Woke the lead to reframe this task before handing it to the operator.`,
      `engine:reframe-blocked:${input.runId}`,
      input.now,
      input.now,
    );
    return true;
  }

  return false;
}

/**
 * Detect a stuck-agent loop and trip the breaker.
 *
 * Called from `finishRun` after every terminal run to check whether the run
 * produced structural progress on its target task. Counts consecutive no-op
 * wakes via `tasks.consecutive_noop_wakes` (migration v46). Trip threshold:
 * 3. Tripped tasks are flipped to `blocked` with an `[AWAITING_HUMAN]`
 * comment, the counter is reset to 0 so manual unblocks start fresh, and
 * the caller is expected to skip the continuation-wake enqueue.
 *
 * "Structural progress" = any `task.status_changed`, `task.assigned`, or
 * `task.unassigned` event on the target task since the run started. Human
 * comment wakes are treated as conversational progress and reset the counter
 * even when the agent reply import shape varies by runtime. A fresh,
 * substantive agent comment also counts as progress; an exact repeat of a
 * prior agent comment does not, which preserves loop protection for duplicate
 * boilerplate.
 *
 * Also callable directly from contract tests.
 */
export function checkAndTripCircuitBreaker(
  input: {
    taskId: string;
    runId: string;
    agentId: string;
    runWindowStart: string;
    now?: string;
  },
  db = getOrchestrationDb(),
): boolean {
  const now = input.now ?? new Date().toISOString();

  const task = db
    .prepare(
      `SELECT t.id, t.task_key, t.status, t.project_id, t.parent_task_id, p.company_id
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = ? AND t.archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.taskId) as
      | {
          id: string;
          task_key: string | null;
          status: string;
          project_id: string;
          parent_task_id: string | null;
          company_id: string;
        }
      | undefined;
  if (!task) return false;
  if (task.status === "blocked" || task.status === "done" || task.status === "backlog") {
    // Already at a terminal-ish state for the sweeper — no breaker work to do.
    return false;
  }

  const structuralEvents = db
    .prepare(
      `SELECT COUNT(*) AS n FROM task_events
        WHERE task_id = ?
          AND event_type IN ('task.status_changed', 'task.assigned', 'task.unassigned')
          AND created_at >= ?`,
    )
    .get(task.id, input.runWindowStart) as { n: number };

  if (structuralEvents.n > 0) {
    db.prepare(
      `UPDATE tasks SET consecutive_noop_wakes = 0, updated_at = ? WHERE id = ?`,
    ).run(now, task.id);
    return false;
  }

  if (task.task_key && runHadExecutedStructuralTaskAction(input.runId, task.task_key, db)) {
    db.prepare(
      `UPDATE tasks SET consecutive_noop_wakes = 0, updated_at = ? WHERE id = ?`,
    ).run(now, task.id);
    return false;
  }

  if (isHumanCommentWake(input, db) || hasMeaningfulAgentCommentProgress(input, db)) {
    db.prepare(
      `UPDATE tasks SET consecutive_noop_wakes = 0, updated_at = ? WHERE id = ?`,
    ).run(now, task.id);
    return false;
  }

  if (hasOpenChildTasks(db, task.id)) {
    db.prepare(
      `UPDATE tasks SET consecutive_noop_wakes = 0, updated_at = ? WHERE id = ?`,
    ).run(now, task.id);
    return false;
  }

  const updated = db
    .prepare(
      `UPDATE tasks
         SET consecutive_noop_wakes = consecutive_noop_wakes + 1,
             updated_at = ?
       WHERE id = ?
       RETURNING consecutive_noop_wakes`,
    )
    .get(now, task.id) as { consecutive_noop_wakes: number } | undefined;

  if (!updated || updated.consecutive_noop_wakes < 3) return false;

  const routed = handleCircuitBreakerRoutableEscalation(db, {
    task: {
      id: task.id,
      project_id: task.project_id,
      status: task.status,
      assignee_agent_id: input.agentId,
      company_id: task.company_id,
    },
    agentId: input.agentId,
    runId: input.runId,
    noOpCount: updated.consecutive_noop_wakes,
    now,
  });
  if (routed) return true;

  const breakerReason =
    "Circuit breaker: 3 consecutive wakes with no structural progress " +
    "(no status change, no reassignment). Agent appears stuck in a no-op " +
    "loop. Auto-blocked after routable recovery attempts were exhausted.";

  db.prepare(
    `UPDATE tasks
       SET status = 'blocked',
           blocked_reason = ?,
           consecutive_noop_wakes = 0,
           updated_at = ?
     WHERE id = ?`,
  ).run(breakerReason, now, task.id);

  db.prepare(
    `INSERT INTO task_events
      (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'blocked', ?, ?)`,
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    task.status,
    JSON.stringify({
      source: "engine_circuit_breaker",
      runId: input.runId,
      consecutive_noop_wakes: 3,
      recoveryAttempts: ["reassign", "decompose", "reframe"],
    }),
    now,
  );

  db.prepare(
    `INSERT INTO comments
      (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 'blocker', 'engine', ?, ?, ?)`,
  ).run(
    randomUUID(),
    task.id,
    "[AWAITING_HUMAN] Circuit breaker tripped after routable recovery attempts were exhausted. Attempted: reassign to a capable alternate, decompose through the lead/CEO, then reframe through the lead/CEO. None produced a usable route, so this now needs operator judgment. Task auto-blocked to stop the loop.",
    `engine:circuit_breaker:${input.runId}`,
    now,
    now,
  );

  if (task.parent_task_id) {
    queueParentBlockedWake({
      childTaskId: task.id,
      childTaskKey: task.task_key ?? task.id,
      parentTaskId: task.parent_task_id,
      companyId: task.company_id,
      blockedByAgentId: input.agentId,
      runId: input.runId,
      db,
    });
  }

  return true;
}
