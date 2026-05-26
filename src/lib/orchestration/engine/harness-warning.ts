import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";

export type HarnessWarningSeverity = "info" | "warning" | "error";

const HARNESS_WARNING_USER_ID = "hiverunner:harness-warning";

function resolveTaskId(db: Database.Database, taskId: string | null | undefined): { id: string; project_id: string } | null {
  const taskRef = taskId?.trim();
  if (!taskRef || taskRef === "__heartbeat__") return null;
  const task = (
    db.prepare("SELECT id, project_id FROM tasks WHERE id = ? LIMIT 1").get(taskRef) ??
    db.prepare("SELECT id, project_id FROM tasks WHERE task_key = ? LIMIT 1").get(taskRef)
  ) as { id: string; project_id: string } | undefined;
  return task ?? null;
}

export function findHarnessWarningFallbackTask(
  db: Database.Database,
  agentId: string,
): { id: string; project_id: string } | null {
  const task = db.prepare(
    `SELECT id, project_id
     FROM tasks
     WHERE assignee_agent_id = ?
       AND archived_at IS NULL
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
  ).get(agentId) as { id: string; project_id: string } | undefined;
  return task ?? null;
}

export function emitHarnessWarningComment(input: {
  db: Database.Database;
  taskId?: string | null;
  agentId: string;
  runId: string;
  body: string;
  severity?: HarnessWarningSeverity;
}): { emitted: boolean; taskId: string | null } {
  const body = input.body.trim();
  if (!body) return { emitted: false, taskId: null };

  const task = resolveTaskId(input.db, input.taskId) ?? findHarnessWarningFallbackTask(input.db, input.agentId);
  if (!task) return { emitted: false, taskId: null };

  const now = new Date().toISOString();
  const severity = input.severity ?? "warning";
  const normalizedBody = body.startsWith("[HARNESS_WARNING]") ? body : `[HARNESS_WARNING] ${body}`;
  const bodyHash = createHash("sha1").update(normalizedBody).digest("hex").slice(0, 12);
  const externalRef = `engine:harness-warning:${input.runId}:${bodyHash}`;

  const existing = input.db
    .prepare("SELECT id FROM comments WHERE task_id = ? AND source = 'engine' AND external_ref = ? LIMIT 1")
    .get(task.id, externalRef) as { id: string } | undefined;
  if (existing) return { emitted: false, taskId: task.id };

  input.db.prepare(
    `INSERT INTO comments
       (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, 'status_update', 'engine', ?, ?, ?)`,
  ).run(randomUUID(), task.id, HARNESS_WARNING_USER_ID, normalizedBody, externalRef, now, now);

  input.db.prepare(
    `INSERT INTO task_events
       (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`,
  ).run(
    randomUUID(),
    task.project_id,
    task.id,
    input.agentId,
    JSON.stringify({
      source: "engine_harness_warning",
      severity,
      runId: input.runId,
    }),
    now,
  );

  return { emitted: true, taskId: task.id };
}
