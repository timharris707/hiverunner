import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";

const INACTIVE_TASK_STATUSES = new Set(["backlog", "done", "blocked", "cancelled"]);

export type AgentLiveState = {
  live: boolean;
  agentId: string;
  agentName?: string | null;
  agentSlug?: string | null;
  agentEmoji?: string | null;
  agentHasAvatar?: boolean;
  runningTaskId?: string;
  runningTaskKey?: string | null;
  runningTaskTitle?: string;
  runningTaskStatus?: string;
  runningSince?: string;
  runningRunId?: string;
  status?: string;
  updatedAt?: string;
};

type AgentLiveStateRow = {
  run_id: string;
  agent_id: string;
  agent_name: string | null;
  agent_slug: string | null;
  agent_emoji: string | null;
  agent_has_avatar: 0 | 1;
  status: string;
  started_at: string | null;
  created_at: string;
  updated_at: string;
  task_id: string | null;
  task_key: string | null;
  task_title: string | null;
  task_status: string | null;
};

function liveStateFromRow(row: AgentLiveStateRow): AgentLiveState {
  return {
    live: row.status === "running" && Boolean(row.task_id) && !INACTIVE_TASK_STATUSES.has(row.task_status ?? ""),
    agentId: row.agent_id,
    agentName: row.agent_name,
    agentSlug: row.agent_slug,
    agentEmoji: row.agent_emoji,
    agentHasAvatar: Boolean(row.agent_has_avatar),
    runningTaskId: row.task_id ?? undefined,
    runningTaskKey: row.task_key,
    runningTaskTitle: row.task_title ?? undefined,
    runningTaskStatus: row.task_status ?? undefined,
    runningSince: row.started_at ?? row.created_at,
    runningRunId: row.run_id,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function getAgentLiveState(
  agentId: string,
  db: Database.Database = getOrchestrationDb(),
): AgentLiveState {
  const row = db.prepare(
    `SELECT
       hr.id AS run_id,
       hr.agent_id,
       a.name AS agent_name,
       a.slug AS agent_slug,
       a.emoji AS agent_emoji,
       a.avatar_url IS NOT NULL AS agent_has_avatar,
       hr.status,
       hr.started_at,
       hr.created_at,
       hr.updated_at,
       t.id AS task_id,
       t.task_key,
       t.title AS task_title,
       t.status AS task_status
     FROM heartbeat_runs hr
     INNER JOIN agents a ON a.id = hr.agent_id
     LEFT JOIN tasks t ON t.id = json_extract(hr.context_snapshot_json, '$.taskId')
     WHERE hr.agent_id = ?
       AND hr.status = 'running'
       AND a.archived_at IS NULL
     ORDER BY COALESCE(hr.started_at, hr.created_at) DESC, hr.updated_at DESC
     LIMIT 1`,
  ).get(agentId) as AgentLiveStateRow | undefined;

  if (!row) return { live: false, agentId };
  return liveStateFromRow(row);
}

export function listActiveAgentLiveStates(input: {
  db?: Database.Database;
  companyId: string;
  limit?: number;
}): AgentLiveState[] {
  const db = input.db ?? getOrchestrationDb();
  const rows = db.prepare(
    `WITH ranked AS (
       SELECT
         hr.id AS run_id,
         hr.agent_id,
         a.name AS agent_name,
         a.slug AS agent_slug,
         a.emoji AS agent_emoji,
         a.avatar_url IS NOT NULL AS agent_has_avatar,
         hr.status,
         hr.started_at,
         hr.created_at,
         hr.updated_at,
         t.id AS task_id,
         t.task_key,
         t.title AS task_title,
         t.status AS task_status,
         ROW_NUMBER() OVER (
           PARTITION BY hr.agent_id
           ORDER BY COALESCE(hr.started_at, hr.created_at) DESC, hr.updated_at DESC
         ) AS rn
       FROM heartbeat_runs hr
       INNER JOIN agents a ON a.id = hr.agent_id
       LEFT JOIN tasks t ON t.id = json_extract(hr.context_snapshot_json, '$.taskId')
       WHERE hr.company_id = ?
         AND hr.status = 'running'
         AND a.archived_at IS NULL
     )
     SELECT *
     FROM ranked
     WHERE rn = 1
       AND task_id IS NOT NULL
       AND task_status NOT IN ('backlog', 'done', 'blocked', 'cancelled')
     ORDER BY COALESCE(started_at, created_at) ASC
     LIMIT ?`,
  ).all(input.companyId, input.limit ?? 80) as AgentLiveStateRow[];

  return rows
    .map(liveStateFromRow)
    .filter((state) => state.live);
}
