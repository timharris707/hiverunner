import type Database from "better-sqlite3";

function isActiveAgent(db: Database.Database, agentId: string | null | undefined): agentId is string {
  if (!agentId) return false;
  const row = db
    .prepare("SELECT 1 FROM agents WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(agentId) as { "1": number } | undefined;
  return Boolean(row);
}

export function resolveReviewProducerAssigneeId(
  db: Database.Database,
  taskId: string,
): string | null {
  const reviewEntry = db
    .prepare(
      `SELECT agent_id, created_at
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.status_changed'
         AND to_status = 'review'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(taskId) as { agent_id: string | null; created_at: string } | undefined;

  if (!reviewEntry) return null;
  if (isActiveAgent(db, reviewEntry.agent_id)) return reviewEntry.agent_id;

  const handoff = db
    .prepare(
      `SELECT COALESCE(
          json_extract(metadata_json, '$.previousAssignee'),
          json_extract(metadata_json, '$.previousAssigneeId')
        ) AS previous_assignee_id
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.assigned'
         AND created_at >= ?
         AND json_extract(metadata_json, '$.source') = 'engine_default_review_handoff'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(taskId, reviewEntry.created_at) as { previous_assignee_id: string | null } | undefined;

  return isActiveAgent(db, handoff?.previous_assignee_id)
    ? handoff.previous_assignee_id
    : null;
}
