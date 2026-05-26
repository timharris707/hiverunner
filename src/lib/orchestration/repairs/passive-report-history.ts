import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getOrchestrationDb } from "@/lib/orchestration/db";

const NO_REPLY_SENTINEL = "NO_REPLY";
const PASSIVE_CONTINUATION_REASON = "continuation_passive_report_only";
const PASSIVE_CONTINUATION_EVENT_DETAIL = "Queued continuation wake: continuation_passive_report_only";
const STALE_PASSIVE_CONTINUATION_AGE_MS = 10 * 60 * 1000;

type RepairDb = Database.Database;

export type NoReplyCommentRow = {
  id: string;
  task_id: string;
  task_key: string;
  task_title: string;
  project_id: string;
  project_name: string;
  author_agent_id: string | null;
  agent_name: string | null;
  body: string;
  type: string;
  source: string;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type PassiveTaskEventRow = {
  id: string;
  project_id: string;
  task_id: string;
  task_key: string;
  agent_id: string | null;
  event_type: string;
  metadata_json: string;
  created_at: string;
};

export type PassiveWakeRow = {
  id: string;
  agent_id: string;
  agent_name: string | null;
  company_id: string;
  company_name: string | null;
  source: string;
  reason: string | null;
  status: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type PassiveHeartbeatEventRow = {
  id: string;
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  event_type: string;
  detail: string;
  created_at: string;
};

export type PassiveHeartbeatRunRow = {
  id: string;
  agent_id: string;
  company_id: string;
  wakeup_request_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type PassiveReportHistoryInspection = {
  noReplyComments: NoReplyCommentRow[];
  noReplyTaskEvents: PassiveTaskEventRow[];
  passiveContinuationWakeRows: PassiveWakeRow[];
  passiveContinuationHeartbeatEvents: PassiveHeartbeatEventRow[];
  stalePassiveContinuationHeartbeatRuns: PassiveHeartbeatRunRow[];
};

export type PassiveReportHistoryRepairSummary = {
  noReplyComments: number;
  noReplyTaskEvents: number;
  passiveContinuationWakeRows: number;
  passiveContinuationHeartbeatEvents: number;
  stalePassiveContinuationHeartbeatRuns: number;
};

export type PassiveReportHistoryRepairResult = {
  applied: boolean;
  backupPath: string | null;
  summary: PassiveReportHistoryRepairSummary;
};

export function inspectPassiveReportHistory(
  db: RepairDb = getOrchestrationDb(),
  now = new Date(),
): PassiveReportHistoryInspection {
  const staleCutoff = new Date(now.getTime() - STALE_PASSIVE_CONTINUATION_AGE_MS).toISOString();
  const noReplyComments = db.prepare(
    `SELECT DISTINCT
       c.id,
       c.task_id,
       t.task_key,
       t.title AS task_title,
       t.project_id,
       p.name AS project_name,
       c.author_agent_id,
       a.name AS agent_name,
       c.body,
       c.type,
       c.source,
       c.external_ref,
       c.created_at,
       c.updated_at
     FROM comments c
     INNER JOIN tasks t ON t.id = c.task_id
     INNER JOIN projects p ON p.id = t.project_id
     LEFT JOIN agents a ON a.id = c.author_agent_id
     INNER JOIN task_events te
       ON te.task_id = c.task_id
      AND te.event_type = 'task.comment_added'
      AND te.created_at = c.created_at
      AND json_extract(te.metadata_json, '$.source') = 'engine_heartbeat'
      AND ((c.author_agent_id IS NULL AND te.agent_id IS NULL) OR te.agent_id = c.author_agent_id)
     INNER JOIN heartbeat_runs hr
       ON hr.id = json_extract(te.metadata_json, '$.runId')
     WHERE c.source = 'openclaw'
       AND trim(c.body) = ?
       AND COALESCE(CAST(json_extract(hr.result_json, '$.actionsExecuted') AS INTEGER), 0) = 0
       AND (
         SELECT COUNT(*)
         FROM task_events te2
         WHERE te2.task_id = c.task_id
           AND te2.event_type = 'task.comment_added'
           AND te2.created_at = c.created_at
           AND json_extract(te2.metadata_json, '$.source') = 'engine_heartbeat'
           AND ((c.author_agent_id IS NULL AND te2.agent_id IS NULL) OR te2.agent_id = c.author_agent_id)
       ) = 1
     ORDER BY c.created_at ASC, c.id ASC`
  ).all(NO_REPLY_SENTINEL) as NoReplyCommentRow[];

  const noReplyTaskEvents = noReplyComments.flatMap((comment) =>
    db.prepare(
      `SELECT
         te.id,
         te.project_id,
         te.task_id,
         t.task_key,
         te.agent_id,
         te.event_type,
         te.metadata_json,
         te.created_at
       FROM task_events te
       INNER JOIN tasks t ON t.id = te.task_id
       WHERE te.task_id = ?
         AND te.event_type = 'task.comment_added'
         AND te.created_at = ?
         AND json_extract(te.metadata_json, '$.source') = 'engine_heartbeat'
         AND (
           (? IS NULL AND te.agent_id IS NULL)
           OR te.agent_id = ?
         )
       ORDER BY te.id ASC`
    ).all(comment.task_id, comment.created_at, comment.author_agent_id, comment.author_agent_id) as PassiveTaskEventRow[]
  );

  const passiveContinuationWakeRows = db.prepare(
    `SELECT
       w.id,
       w.agent_id,
       a.name AS agent_name,
       w.company_id,
       c.name AS company_name,
       w.source,
       w.reason,
       w.status,
       w.payload_json,
       w.created_at,
       w.updated_at,
       w.finished_at
     FROM agent_wakeup_requests w
     LEFT JOIN agents a ON a.id = w.agent_id
     LEFT JOIN companies c ON c.id = w.company_id
     WHERE w.reason = ?
       AND (
         w.status IN ('failed', 'finished')
         OR (
           w.status IN ('queued', 'claimed')
           AND COALESCE(w.updated_at, w.created_at) <= ?
           AND NOT EXISTS (
             SELECT 1
             FROM heartbeat_runs hr
             WHERE hr.wakeup_request_id = w.id
               AND hr.status = 'running'
           )
         )
       )
     ORDER BY w.created_at ASC, w.id ASC`
  ).all(PASSIVE_CONTINUATION_REASON, staleCutoff) as PassiveWakeRow[];

  const passiveContinuationHeartbeatEvents = db.prepare(
    `SELECT
       e.id,
       e.run_id,
       e.agent_id,
       a.name AS agent_name,
       e.event_type,
       e.detail,
       e.created_at
     FROM heartbeat_run_events e
     LEFT JOIN agents a ON a.id = e.agent_id
     WHERE e.detail = ?
     ORDER BY e.created_at ASC, e.id ASC`
  ).all(PASSIVE_CONTINUATION_EVENT_DETAIL) as PassiveHeartbeatEventRow[];

  const stalePassiveContinuationHeartbeatRuns = db.prepare(
    `SELECT
       hr.id,
       hr.agent_id,
       hr.company_id,
       hr.wakeup_request_id,
       hr.status,
       hr.created_at,
       hr.updated_at
     FROM heartbeat_runs hr
     INNER JOIN agent_wakeup_requests w ON w.id = hr.wakeup_request_id
     WHERE w.reason = ?
       AND w.status IN ('queued', 'claimed')
       AND COALESCE(w.updated_at, w.created_at) <= ?
       AND hr.status = 'queued'
     ORDER BY hr.created_at ASC, hr.id ASC`
  ).all(PASSIVE_CONTINUATION_REASON, staleCutoff) as PassiveHeartbeatRunRow[];

  return {
    noReplyComments,
    noReplyTaskEvents,
    passiveContinuationWakeRows,
    passiveContinuationHeartbeatEvents,
    stalePassiveContinuationHeartbeatRuns,
  };
}

export function summarizePassiveReportHistory(inspection: PassiveReportHistoryInspection): PassiveReportHistoryRepairSummary {
  return {
    noReplyComments: inspection.noReplyComments.length,
    noReplyTaskEvents: inspection.noReplyTaskEvents.length,
    passiveContinuationWakeRows: inspection.passiveContinuationWakeRows.length,
    passiveContinuationHeartbeatEvents: inspection.passiveContinuationHeartbeatEvents.length,
    stalePassiveContinuationHeartbeatRuns: inspection.stalePassiveContinuationHeartbeatRuns.length,
  };
}

export function repairPassiveReportHistory(input: {
  db?: RepairDb;
  backupDir: string;
  apply?: boolean;
  now?: Date;
}): PassiveReportHistoryRepairResult {
  const db = input.db ?? getOrchestrationDb();
  const apply = input.apply === true;
  const inspection = inspectPassiveReportHistory(db, input.now ?? new Date());
  const summary = summarizePassiveReportHistory(inspection);

  if (!apply) {
    return {
      applied: false,
      backupPath: null,
      summary,
    };
  }

  const timestamp = (input.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  mkdirSync(input.backupDir, { recursive: true });
  const backupPath = path.join(input.backupDir, `passive-report-history-repair-${timestamp}.json`);
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        noReplyComments: inspection.noReplyComments,
        noReplyTaskEvents: inspection.noReplyTaskEvents,
        passiveContinuationWakeRows: inspection.passiveContinuationWakeRows,
        passiveContinuationHeartbeatEvents: inspection.passiveContinuationHeartbeatEvents,
        stalePassiveContinuationHeartbeatRuns: inspection.stalePassiveContinuationHeartbeatRuns,
      },
      null,
      2,
    ),
    "utf8",
  );

  const deleteRows = db.transaction(() => {
    for (const row of inspection.noReplyTaskEvents) {
      db.prepare(`DELETE FROM task_events WHERE id = ?`).run(row.id);
    }
    for (const row of inspection.noReplyComments) {
      db.prepare(`DELETE FROM comments WHERE id = ?`).run(row.id);
    }
    for (const row of inspection.passiveContinuationHeartbeatEvents) {
      db.prepare(`DELETE FROM heartbeat_run_events WHERE id = ?`).run(row.id);
    }
    for (const row of inspection.stalePassiveContinuationHeartbeatRuns) {
      db.prepare(`DELETE FROM heartbeat_runs WHERE id = ?`).run(row.id);
    }
    for (const row of inspection.passiveContinuationWakeRows) {
      db.prepare(`DELETE FROM agent_wakeup_requests WHERE id = ?`).run(row.id);
    }
  });

  deleteRows();

  return {
    applied: true,
    backupPath,
    summary,
  };
}

export const passiveReportHistoryRepairConstants = {
  NO_REPLY_SENTINEL,
  PASSIVE_CONTINUATION_REASON,
  PASSIVE_CONTINUATION_EVENT_DETAIL,
  STALE_PASSIVE_CONTINUATION_AGE_MS,
};
