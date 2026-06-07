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

type EnqueueWakeupInput = {
  agentId: string;
  companyId: string;
  source: WakeupSource;
  reason?: string;
  triggerDetail?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  invocationSource?: InvocationSource;
  contextSnapshot?: Record<string, unknown>;
};

type CoalesceableWake = {
  id: string;
  run_id: string | null;
  wake_status: string;
  run_status: string | null;
};

function isWakeAlreadyExecuting(wake: Pick<CoalesceableWake, "wake_status" | "run_status">): boolean {
  return wake.wake_status === "claimed" || wake.run_status === "running";
}

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

function findActiveWakeForScopeCoalesce(
  agentId: string,
  incomingTarget: WakeTarget,
  db: Database.Database,
): CoalesceableWake | null {
  const active = db.prepare(
    `SELECT awr.id, awr.run_id, awr.status AS wake_status, hr.status AS run_status, hr.context_snapshot_json
     FROM agent_wakeup_requests awr
     LEFT JOIN heartbeat_runs hr ON hr.id = awr.run_id
     WHERE awr.agent_id = ?
       AND (
         awr.status IN ('queued', 'claimed')
         OR hr.status IN ('queued', 'running')
       )
     ORDER BY
       CASE
         WHEN awr.status = 'claimed' OR hr.status = 'running' THEN 0
         ELSE 1
       END,
       awr.created_at ASC`
  ).all(agentId) as Array<CoalesceableWake & { context_snapshot_json: string | null }>;

  for (const wake of active) {
    const existingTarget = wakeTargetFromJson(wake.context_snapshot_json);
    if (isTaskWakeTarget(incomingTarget) && sameWakeTarget(incomingTarget, existingTarget)) {
      return wake;
    }
    if (
      !isTaskWakeTarget(incomingTarget) &&
      isTaskWakeTarget(existingTarget) &&
      !isWakeAlreadyExecuting(wake)
    ) {
      return wake;
    }
  }

  return null;
}

function markWakeCoalesced(
  existing: CoalesceableWake,
  input: EnqueueWakeupInput,
  snapshot: Record<string, unknown>,
  incomingTarget: WakeTarget,
  now: string,
  db: Database.Database,
): EnqueueWakeupResult {
  const shouldRefreshQueuedContext =
    isTaskWakeTarget(incomingTarget) &&
    (existing.wake_status === "queued" || existing.run_status === "queued");
  const shouldRefreshActiveContext =
    isTaskWakeTarget(incomingTarget) &&
    isWakeAlreadyExecuting(existing);
  const shouldRefreshContext = shouldRefreshQueuedContext || shouldRefreshActiveContext;

  db.prepare(
    `UPDATE agent_wakeup_requests
     SET coalesced_count = coalesced_count + 1,
         payload_json = CASE WHEN ? THEN ? ELSE payload_json END,
         updated_at = ?
     WHERE id = ?`
  ).run(
    shouldRefreshContext ? 1 : 0,
    JSON.stringify(input.payload ?? {}),
    now,
    existing.id,
  );

  if (shouldRefreshContext && existing.run_id) {
    db.prepare(
      `UPDATE heartbeat_runs
       SET context_snapshot_json = ?,
           trigger_detail = COALESCE(?, trigger_detail),
           updated_at = ?
       WHERE id = ?
         AND status IN ('queued', 'running')`
    ).run(JSON.stringify(snapshot), input.triggerDetail ?? null, now, existing.run_id);
  }

  return {
    wakeupRequestId: existing.id,
    heartbeatRunId: existing.run_id ?? "",
    status: "coalesced",
  };
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
  input: EnqueueWakeupInput,
  db = getOrchestrationDb()
): EnqueueWakeupResult {
  const now = new Date().toISOString();
  const snapshot = input.contextSnapshot ?? {
    wakeSource: input.source,
    wakeReason: input.reason ?? null,
    ...(input.payload ?? {}),
  };
  const incomingTarget = wakeTargetFromRecord(snapshot);

  // Check for existing active wakeup we can coalesce BEFORE pruning.
  // Previously pruneSupersededQueuedWakeups ran first and flipped every queued
  // wake for this agent to 'failed/superseded_by_newer_wake' — which meant the
  // idempotency SELECT below could never find a match. Active means queued or
  // already claimed/running: a same-task comment wake followed by a transition
  // wake must not create a second heartbeat just because the first wake has
  // started executing.
  if (input.idempotencyKey) {
    const existing = db
      .prepare(
        `SELECT awr.id, awr.run_id, awr.status AS wake_status, hr.status AS run_status
         FROM agent_wakeup_requests awr
         LEFT JOIN heartbeat_runs hr ON hr.id = awr.run_id
         WHERE awr.idempotency_key = ?
           AND (
             awr.status IN ('queued', 'claimed')
             OR hr.status IN ('queued', 'running')
           )
         ORDER BY
           CASE
             WHEN awr.status = 'claimed' OR hr.status = 'running' THEN 0
             ELSE 1
           END,
           awr.created_at ASC
         LIMIT 1`
      )
      .get(input.idempotencyKey) as CoalesceableWake | undefined;

    if (existing) {
      return markWakeCoalesced(existing, input, snapshot, incomingTarget, now, db);
    }
  }

  const scopedExisting = findActiveWakeForScopeCoalesce(input.agentId, incomingTarget, db);
  if (scopedExisting) {
    return markWakeCoalesced(scopedExisting, input, snapshot, incomingTarget, now, db);
  }

  pruneSupersededQueuedWakeups(input.agentId, now, db, incomingTarget);

  // The UNIQUE index on idempotency_key covers ALL rows with a non-null key
  // (not just queued), so a terminal row from a prior identical wake will
  // block a fresh insert. Free the key on any terminal row with the same
  // value before inserting — we already confirmed no active row exists, so
  // nothing live is coalesceable.
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
          `SELECT awr.id, awr.status, awr.run_id, hr.status AS run_status
           FROM agent_wakeup_requests awr
           LEFT JOIN heartbeat_runs hr ON hr.id = awr.run_id
           WHERE awr.idempotency_key = ?
           ORDER BY awr.created_at DESC
           LIMIT 1`,
        )
        .get(input.idempotencyKey) as { id: string; status: string; run_id: string | null; run_status: string | null } | undefined;

      if (
        any &&
        (
          any.status === "queued" ||
          any.status === "claimed" ||
          any.run_status === "queued" ||
          any.run_status === "running"
        )
      ) {
        return markWakeCoalesced(
          {
            id: any.id,
            run_id: any.run_id,
            wake_status: any.status,
            run_status: any.run_status,
          },
          input,
          snapshot,
          incomingTarget,
          now,
          db,
        );
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
