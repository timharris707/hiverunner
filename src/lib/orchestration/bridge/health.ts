import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { PaperclipBridgeClient, PaperclipBridgeError } from "@/lib/orchestration/bridge/client";
import { getPaperclipBridgeConfigFromEnv } from "@/lib/orchestration/bridge/config";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import type { BridgeHealthStatusResult, BridgeMappingError, BridgeMappingErrorCode } from "@/lib/orchestration/bridge/types";

type BridgeStatsRow = {
  paperclip_task_count: number | null;
  mapped_task_count: number | null;
};

type LastSyncRow = {
  last_synced_at: string | null;
};

type MappingErrorRow = {
  code: BridgeMappingErrorCode;
  task_id: string;
  task_title: string;
  project_id: string;
  project_name: string;
};

function listBridgeMappingErrors(db: Database.Database): BridgeMappingError[] {
  const rows = db
    .prepare(
      `WITH active_tasks AS (
         SELECT
           t.id AS task_id,
           t.title AS task_title,
           t.status,
           t.execution_mode,
           t.paperclip_issue_id,
           t.assignee_agent_id,
           p.id AS project_id,
           p.name AS project_name,
           p.company_id,
           a.paperclip_agent_id
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         LEFT JOIN agents a ON a.id = t.assignee_agent_id
         WHERE t.archived_at IS NULL
       ),
       issue_rows AS (
         SELECT
           'missing_project_company' AS code,
           task_id,
           task_title,
           project_id,
           project_name
         FROM active_tasks
         WHERE execution_mode = 'paperclip' AND company_id IS NULL
       ),
       mapping_rows AS (
         SELECT
           'missing_paperclip_issue_mapping' AS code,
           task_id,
           task_title,
           project_id,
           project_name
         FROM active_tasks
         WHERE execution_mode = 'paperclip' AND paperclip_issue_id IS NULL
       ),
       assignee_rows AS (
         SELECT
           'missing_assignee' AS code,
           task_id,
           task_title,
           project_id,
           project_name
         FROM active_tasks
         WHERE status = 'in_progress' AND assignee_agent_id IS NULL
       ),
       agent_mapping_rows AS (
         SELECT
           'missing_paperclip_agent_mapping' AS code,
           task_id,
           task_title,
           project_id,
           project_name
         FROM active_tasks
         WHERE status = 'in_progress'
           AND assignee_agent_id IS NOT NULL
           AND (paperclip_agent_id IS NULL OR TRIM(paperclip_agent_id) = '')
       )
       SELECT code, task_id, task_title, project_id, project_name
       FROM (
         SELECT * FROM issue_rows
         UNION ALL
         SELECT * FROM mapping_rows
         UNION ALL
         SELECT * FROM assignee_rows
         UNION ALL
         SELECT * FROM agent_mapping_rows
       )
       ORDER BY project_name ASC, task_title ASC, code ASC
       LIMIT 100`
    )
    .all() as MappingErrorRow[];

  return rows.map((row) => ({
    code: row.code,
    taskId: row.task_id,
    taskTitle: row.task_title,
    projectId: row.project_id,
    projectName: row.project_name,
  }));
}

function getBridgeLastSyncAt(db: Database.Database): string | null {
  const row = db
    .prepare(
      `WITH candidates(sync_at) AS (
         SELECT MAX(c.created_at) AS sync_at
         FROM comments c
         WHERE c.source = 'paperclip'

         UNION ALL

         SELECT MAX(t.updated_at) AS sync_at
         FROM tasks t
         WHERE t.archived_at IS NULL AND t.paperclip_issue_id IS NOT NULL
       )
       SELECT MAX(sync_at) AS last_synced_at
       FROM candidates`
    )
    .get() as LastSyncRow | undefined;

  return row?.last_synced_at ?? null;
}

function getBridgeStats(db: Database.Database): { paperclipTaskCount: number; mappedTaskCount: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN t.execution_mode = 'paperclip' THEN 1 ELSE 0 END) AS paperclip_task_count,
         SUM(CASE WHEN t.paperclip_issue_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped_task_count
       FROM tasks t
       WHERE t.archived_at IS NULL`
    )
    .get() as BridgeStatsRow | undefined;

  return {
    paperclipTaskCount: row?.paperclip_task_count ?? 0,
    mappedTaskCount: row?.mapped_task_count ?? 0,
  };
}

export async function getBridgeStatus(db = getOrchestrationDb()): Promise<BridgeHealthStatusResult> {
  const checkedAt = new Date().toISOString();
  const mappingErrors = listBridgeMappingErrors(db);
  const { paperclipTaskCount, mappedTaskCount } = getBridgeStats(db);
  const lastSyncedAt = getBridgeLastSyncAt(db);

  try {
    const config = getPaperclipBridgeConfigFromEnv();
    const bridge = new PaperclipBridgeClient(config);
    const health = await bridge.getBridgeHealth();

    return {
      checkedAt,
      connection: {
        ok: health.ok,
        agentId: health.agentId,
      },
      sync: {
        lastSyncedAt,
        paperclipTaskCount,
        mappedTaskCount,
      },
      mapping: {
        errorCount: mappingErrors.length,
        errors: mappingErrors,
      },
    };
  } catch (error) {
    if (error instanceof PaperclipBridgeError) {
      return {
        checkedAt,
        connection: {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retriable: error.retriable,
          },
        },
        sync: {
          lastSyncedAt,
          paperclipTaskCount,
          mappedTaskCount,
        },
        mapping: {
          errorCount: mappingErrors.length,
          errors: mappingErrors,
        },
      };
    }

    if (error instanceof OrchestrationApiError && error.code === "bridge_not_configured") {
      return {
        checkedAt,
        connection: {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retriable: false,
          },
        },
        sync: {
          lastSyncedAt,
          paperclipTaskCount,
          mappedTaskCount,
        },
        mapping: {
          errorCount: mappingErrors.length,
          errors: mappingErrors,
        },
      };
    }

    throw error;
  }
}
