import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { getOrchestrationDb } from "@/lib/orchestration/db";

export type WakeupSource = "timer" | "issue_assigned" | "routine" | "explicit" | "api" | "kickoff";
export type WakeupStatus = "queued" | "claimed" | "finished" | "failed";
export type HeartbeatRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
export type InvocationSource = "on_demand" | "timer" | "issue_assigned" | "wakeup_request" | "kickoff";

export interface WakeupRequest {
  id: string;
  agentId: string;
  companyId: string;
  source: WakeupSource;
  reason: string | null;
  triggerDetail: string | null;
  payload: Record<string, unknown>;
  status: WakeupStatus;
  coalescedCount: number;
  idempotencyKey: string | null;
  runId: string | null;
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
}

export interface HeartbeatRun {
  id: string;
  agentId: string;
  companyId: string;
  invocationSource: InvocationSource;
  triggerDetail: string | null;
  status: HeartbeatRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  wakeupRequestId: string | null;
  sessionIdBefore: string | null;
  sessionIdAfter: string | null;
  usage: Record<string, unknown>;
  result: Record<string, unknown>;
  exitCode: number | null;
  error: string | null;
  contextSnapshot: Record<string, unknown>;
  createdAt: string;
}

export interface EnqueueWakeupResult {
  wakeupRequestId: string;
  heartbeatRunId: string;
  status: "queued" | "coalesced";
}

export type WakeTarget = {
  taskId: string | null;
  taskKey: string | null;
};

export function wakeTargetFromRecord(record: Record<string, unknown> | null | undefined): WakeTarget {
  const taskId = typeof record?.taskId === "string" && record.taskId.trim()
    ? record.taskId.trim()
    : null;
  const taskKey = typeof record?.taskKey === "string" && record.taskKey.trim()
    ? record.taskKey.trim()
    : null;
  return { taskId, taskKey };
}

export function wakeTargetFromJson(json: string | null | undefined): WakeTarget {
  if (!json) return { taskId: null, taskKey: null };
  try {
    return wakeTargetFromRecord(JSON.parse(json) as Record<string, unknown>);
  } catch {
    return { taskId: null, taskKey: null };
  }
}

export function isTaskWakeTarget(target: WakeTarget): boolean {
  return Boolean(target.taskId || target.taskKey);
}

export function sameWakeTarget(a: WakeTarget, b: WakeTarget): boolean {
  return Boolean(
    (a.taskId && b.taskId && a.taskId === b.taskId) ||
    (a.taskKey && b.taskKey && a.taskKey === b.taskKey),
  );
}

function findQueuedWakeForScopeCoalesce(
  agentId: string,
  incomingTarget: WakeTarget,
  db: Database.Database,
): { id: string; run_id: string | null } | null {
  const queued = db.prepare(
    `SELECT awr.id, awr.run_id, hr.context_snapshot_json
     FROM agent_wakeup_requests awr
     LEFT JOIN heartbeat_runs hr ON hr.id = awr.run_id
     WHERE awr.agent_id = ? AND awr.status = 'queued'
     ORDER BY awr.created_at ASC`
  ).all(agentId) as Array<{ id: string; run_id: string | null; context_snapshot_json: string | null }>;

  for (const wake of queued) {
    const existingTarget = wakeTargetFromJson(wake.context_snapshot_json);
    if (isTaskWakeTarget(incomingTarget) && sameWakeTarget(incomingTarget, existingTarget)) {
      return { id: wake.id, run_id: wake.run_id };
    }
    if (!isTaskWakeTarget(incomingTarget) && isTaskWakeTarget(existingTarget)) {
      return { id: wake.id, run_id: wake.run_id };
    }
  }

  return null;
}

export function shouldSupersedeQueuedWake(existingTarget: WakeTarget, incomingTarget: WakeTarget): boolean {
  if (isTaskWakeTarget(incomingTarget) && isTaskWakeTarget(existingTarget)) {
    return false;
  }
  if (!isTaskWakeTarget(incomingTarget) && isTaskWakeTarget(existingTarget)) {
    return false;
  }
  return true;
}

function pruneSupersededQueuedWakeups(
  agentId: string,
  now: string,
  db: Database.Database,
  incomingTarget: WakeTarget,
): void {
  const queued = db.prepare(
    `SELECT awr.id, awr.run_id, hr.context_snapshot_json
     FROM agent_wakeup_requests awr
     LEFT JOIN heartbeat_runs hr ON hr.id = awr.run_id
     WHERE awr.agent_id = ? AND awr.status = 'queued'`
  ).all(agentId) as Array<{ id: string; run_id: string | null; context_snapshot_json: string | null }>;

  if (queued.length === 0) {
    return;
  }

  for (const wake of queued) {
    if (!shouldSupersedeQueuedWake(wakeTargetFromJson(wake.context_snapshot_json), incomingTarget)) {
      continue;
    }

    db.prepare(
      `UPDATE agent_wakeup_requests
       SET status = 'failed', finished_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`
    ).run(now, now, wake.id);

    if (wake.run_id) {
      db.prepare(
        `UPDATE heartbeat_runs
         SET status = 'failed', finished_at = ?, error = 'superseded_by_newer_wake', updated_at = ?
         WHERE id = ? AND status = 'queued'`
      ).run(now, now, wake.run_id);
    }
  }
}

export function mapSourceToInvocation(source: WakeupSource): InvocationSource {
  switch (source) {
    case "timer":
      return "timer";
    case "issue_assigned":
      return "issue_assigned";
    case "kickoff":
      return "kickoff";
    default:
      return "wakeup_request";
  }
}

export function enqueueWakeup(
  input: {
    agentId: string;
    companyId: string;
    source: WakeupSource;
    reason?: string;
    triggerDetail?: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
    invocationSource?: InvocationSource;
    contextSnapshot?: Record<string, unknown>;
  },
  db = getOrchestrationDb()
): EnqueueWakeupResult {
  const now = new Date().toISOString();
  const snapshot = input.contextSnapshot ?? {
    wakeSource: input.source,
    wakeReason: input.reason ?? null,
    ...(input.payload ?? {}),
  };
  const incomingTarget = wakeTargetFromRecord(snapshot);

  // Check for existing queued wakeup we can coalesce BEFORE pruning.
  // Previously pruneSupersededQueuedWakeups ran first and flipped every queued
  // wake for this agent to 'failed/superseded_by_newer_wake' — which meant the
  // idempotency SELECT below (WHERE status = 'queued') could never find a
  // match. Coalesce was dead code, and two paths enqueuing the same logical
  // event (e.g. finish-run-continuation vs reconcile-continuation for the same
  // task-in-review) would always produce superseded losses instead of a single
  // coalesced wake. Do the coalesce lookup first; only prune when we're about
  // to actually insert a new row.
  if (input.idempotencyKey) {
    const existing = db
      .prepare(
        `SELECT id, run_id FROM agent_wakeup_requests
         WHERE idempotency_key = ? AND status = 'queued'
         LIMIT 1`
      )
      .get(input.idempotencyKey) as { id: string; run_id: string | null } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE agent_wakeup_requests
         SET coalesced_count = coalesced_count + 1, updated_at = ?
         WHERE id = ?`
      ).run(now, existing.id);
      return {
        wakeupRequestId: existing.id,
        heartbeatRunId: existing.run_id ?? "",
        status: "coalesced",
      };
    }
  }

  const scopedExisting = findQueuedWakeForScopeCoalesce(input.agentId, incomingTarget, db);
  if (scopedExisting) {
    db.prepare(
      `UPDATE agent_wakeup_requests
       SET coalesced_count = coalesced_count + 1, updated_at = ?
       WHERE id = ?`
    ).run(now, scopedExisting.id);
    return {
      wakeupRequestId: scopedExisting.id,
      heartbeatRunId: scopedExisting.run_id ?? "",
      status: "coalesced",
    };
  }

  pruneSupersededQueuedWakeups(input.agentId, now, db, incomingTarget);

  // The UNIQUE index on idempotency_key covers ALL rows with a non-null key
  // (not just queued), so a terminal row from a prior identical wake will
  // block a fresh insert. Free the key on any terminal row with the same
  // value before inserting — we already confirmed no *queued* row exists,
  // so nothing live is coalesceable.
  if (input.idempotencyKey) {
    db.prepare(
      `UPDATE agent_wakeup_requests
       SET idempotency_key = NULL
       WHERE idempotency_key = ?
         AND status IN ('finished', 'failed', 'cancelled', 'claimed')`,
    ).run(input.idempotencyKey);
  }

  const wakeupId = randomUUID();
  const runId = randomUUID();

  const invSource = input.invocationSource ?? mapSourceToInvocation(input.source);

  // Retry-once wrapper guards the rare race where two concurrent callers
  // both pass the coalesce SELECT (both see no queued row), both reach the
  // INSERT, and the second hits the UNIQUE constraint. On SQLITE_CONSTRAINT_UNIQUE
  // we re-read the table for any matching key — if it's queued now, coalesce
  // onto the winner; otherwise free the stale key and insert again.
  const insertRequest = (): void => {
    db.prepare(
      `INSERT INTO agent_wakeup_requests
         (id, agent_id, company_id, source, reason, trigger_detail, payload_json, status, idempotency_key, run_id, requested_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
    ).run(
      wakeupId,
      input.agentId,
      input.companyId,
      input.source,
      input.reason ?? null,
      input.triggerDetail ?? null,
      JSON.stringify(input.payload ?? {}),
      input.idempotencyKey ?? null,
      runId,
      now,
      now,
      now,
    );
  };

  try {
    insertRequest();
  } catch (error) {
    const sqliteCode = (error as { code?: string } | null)?.code;
    if (sqliteCode === "SQLITE_CONSTRAINT_UNIQUE" && input.idempotencyKey) {
      const any = db
        .prepare(
          `SELECT id, status, run_id FROM agent_wakeup_requests
           WHERE idempotency_key = ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(input.idempotencyKey) as { id: string; status: string; run_id: string | null } | undefined;

      if (any && any.status === "queued") {
        db.prepare(
          `UPDATE agent_wakeup_requests
           SET coalesced_count = coalesced_count + 1, updated_at = ?
           WHERE id = ?`,
        ).run(now, any.id);
        return {
          wakeupRequestId: any.id,
          heartbeatRunId: any.run_id ?? "",
          status: "coalesced",
        };
      }

      if (any) {
        db.prepare(
          "UPDATE agent_wakeup_requests SET idempotency_key = NULL WHERE id = ?",
        ).run(any.id);
        insertRequest();
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
  ).run(
    runId,
    input.agentId,
    input.companyId,
    invSource,
    input.triggerDetail ?? null,
    wakeupId,
    JSON.stringify(snapshot),
    now,
    now,
  );

  return { wakeupRequestId: wakeupId, heartbeatRunId: runId, status: "queued" };
}
