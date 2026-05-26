/**
 * Engine query helpers — read-side projections of heartbeat runs and wakeup
 * requests. Extracted from engine.ts so the coordinator only carries the
 * runtime control surface, not row mapping.
 */

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { parseJson } from "@/lib/orchestration/engine/persistence";
import {
  isCeoRole,
  isCompanyOrchestrationLeadRole,
} from "@/lib/orchestration/engine/prompt-builder";
import type {
  HeartbeatRun,
  HeartbeatRunStatus,
  InvocationSource,
  WakeupRequest,
  WakeupSource,
  WakeupStatus,
} from "@/lib/orchestration/engine/wakeup-queue";

type HeartbeatRunRow = {
  id: string;
  agent_id: string;
  company_id: string;
  invocation_source: string;
  trigger_detail: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  wakeup_request_id: string | null;
  session_id_before: string | null;
  session_id_after: string | null;
  usage_json: string;
  result_json: string;
  exit_code: number | null;
  error: string | null;
  context_snapshot_json: string;
  created_at: string;
};

type WakeupRequestRow = {
  id: string;
  agent_id: string;
  company_id: string;
  source: string;
  reason: string | null;
  trigger_detail: string | null;
  payload_json: string;
  status: string;
  coalesced_count: number;
  idempotency_key: string | null;
  run_id: string | null;
  requested_at: string;
  claimed_at: string | null;
  finished_at: string | null;
};

function mapHeartbeatRunRow(row: HeartbeatRunRow): HeartbeatRun {
  return {
    id: row.id,
    agentId: row.agent_id,
    companyId: row.company_id,
    invocationSource: row.invocation_source as InvocationSource,
    triggerDetail: row.trigger_detail,
    status: row.status as HeartbeatRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    wakeupRequestId: row.wakeup_request_id,
    sessionIdBefore: row.session_id_before,
    sessionIdAfter: row.session_id_after,
    usage: parseJson(row.usage_json),
    result: parseJson(row.result_json),
    exitCode: row.exit_code,
    error: row.error,
    contextSnapshot: parseJson(row.context_snapshot_json),
    createdAt: row.created_at,
  };
}

function mapWakeupRequestRow(row: WakeupRequestRow): WakeupRequest {
  return {
    id: row.id,
    agentId: row.agent_id,
    companyId: row.company_id,
    source: row.source as WakeupSource,
    reason: row.reason,
    triggerDetail: row.trigger_detail,
    payload: parseJson(row.payload_json),
    status: row.status as WakeupStatus,
    coalescedCount: row.coalesced_count,
    idempotencyKey: row.idempotency_key,
    runId: row.run_id,
    requestedAt: row.requested_at,
    claimedAt: row.claimed_at,
    finishedAt: row.finished_at,
  };
}

export function listHeartbeatRuns(
  input: { companyId: string; agentId?: string; limit?: number },
  db = getOrchestrationDb(),
): HeartbeatRun[] {
  const clauses = ["company_id = ?"];
  const params: unknown[] = [input.companyId];

  if (input.agentId) {
    clauses.push("agent_id = ?");
    params.push(input.agentId);
  }

  const limit = input.limit ?? 50;

  const rows = db
    .prepare(
      `SELECT id, agent_id, company_id, invocation_source, trigger_detail, status,
              started_at, finished_at, wakeup_request_id,
              session_id_before, session_id_after,
              usage_json, result_json, exit_code, error, context_snapshot_json,
              created_at
       FROM heartbeat_runs
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params, limit) as HeartbeatRunRow[];

  return rows.map(mapHeartbeatRunRow);
}

export function listWakeupRequests(
  input: { companyId: string; agentId?: string; status?: WakeupStatus; limit?: number },
  db = getOrchestrationDb(),
): WakeupRequest[] {
  const clauses = ["company_id = ?"];
  const params: unknown[] = [input.companyId];

  if (input.agentId) {
    clauses.push("agent_id = ?");
    params.push(input.agentId);
  }
  if (input.status) {
    clauses.push("status = ?");
    params.push(input.status);
  }

  const rows = db
    .prepare(
      `SELECT * FROM agent_wakeup_requests
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...params, input.limit ?? 50) as WakeupRequestRow[];

  return rows.map(mapWakeupRequestRow);
}

export function findCompanyCeo(
  companyId: string,
  db = getOrchestrationDb(),
): { id: string; name: string; role: string; adapter_type: string | null } | null {
  // Sweep/review routing needs a human-style company orchestrator even when a
  // company no longer has a literal "CEO" role. Prefer true CEO roles, then
  // fall back to explicit orchestration lead roles such as Insight's Oracle.
  const rows = db
    .prepare(
      `SELECT id, name, role, adapter_type FROM agents
       WHERE company_id = ? AND archived_at IS NULL
         AND (
           LOWER(role) LIKE '%ceo%'
           OR LOWER(role) LIKE '%product orchestrator%'
           OR LOWER(role) LIKE '%orchestration lead%'
         )
       ORDER BY
         CASE WHEN LOWER(role) LIKE '%ceo%' THEN 0 ELSE 1 END,
         created_at ASC`,
    )
    .all(companyId) as Array<{ id: string; name: string; role: string; adapter_type: string | null }>;
  return (
    rows.find((row) => isCeoRole(row.role)) ??
    rows.find((row) => isCompanyOrchestrationLeadRole(row.role)) ??
    null
  );
}

export function getHeartbeatRun(
  runId: string,
  db = getOrchestrationDb(),
): HeartbeatRun | null {
  const row = db
    .prepare(
      `SELECT id, agent_id, company_id, invocation_source, trigger_detail, status,
              started_at, finished_at, wakeup_request_id,
              session_id_before, session_id_after,
              usage_json, result_json, exit_code, error, context_snapshot_json,
              created_at
       FROM heartbeat_runs WHERE id = ? LIMIT 1`,
    )
    .get(runId) as HeartbeatRunRow | undefined;

  return row ? mapHeartbeatRunRow(row) : null;
}
