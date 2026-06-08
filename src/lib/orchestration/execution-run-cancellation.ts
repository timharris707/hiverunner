import type Database from "better-sqlite3";

import { recordExecutionRunAttemptEvent } from "@/lib/orchestration/db";
import { getExecutionAdapter } from "@/lib/orchestration/execution/adapters";
import type { CancelAdapterResult } from "@/lib/orchestration/execution/adapters/types";
import { cleanupRunArtifacts } from "@/lib/orchestration/execution/cleanup";
import type { DbTaskStatus } from "@/lib/orchestration/service/shared";

export type ExecutionRunToCancel = {
  id: string;
  taskId: string;
  provider: string;
  sessionId: string | null;
  processPid: number | null;
  startedAt: string | null;
  attemptNumber: number | null;
};

export type ExecutionRunTerminator = (run: ExecutionRunToCancel) => unknown | Promise<unknown>;

const EXECUTION_INACTIVE_TASK_STATUSES = new Set<DbTaskStatus>(["backlog", "to-do", "done", "blocked"]);

export function taskStatusCancelsRunningExecutions(status: DbTaskStatus): boolean {
  return EXECUTION_INACTIVE_TASK_STATUSES.has(status);
}

function defaultTerminateExecutionRun(run: ExecutionRunToCancel): Promise<CancelAdapterResult> | CancelAdapterResult {
  const adapter = getExecutionAdapter(run.provider);
  if (!adapter.cancel) {
    return { killed: false, method: "adapter_cancel_unavailable" };
  }
  return adapter.cancel(run.id, run.processPid, run.sessionId);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value && typeof (value as { then?: unknown }).then === "function");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedPrimitive(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean" || value === null) return value;
  return String(value).slice(0, 500);
}

function summarizeCancellationResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const summary: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result as Record<string, unknown>).slice(0, 12)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        summary[key] = boundedPrimitive(value);
      }
    }
    return Object.keys(summary).length > 0 ? summary : { value: "[object]" };
  }
  return { value: boundedPrimitive(result) };
}

export function buildCancellationRequestResult(input: {
  method: string;
  actor: string;
  reason: string;
  requestedAt: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    method: input.method,
    actor: input.actor,
    requested: true,
    signalStatus: "requested",
    requestedAt: input.requestedAt,
    ...(input.extra ?? {}),
  };
}

export function recordExecutionRunCancellationSignalResult(
  db: Database.Database,
  input: {
    executionRunId: string;
    attemptNumber?: number | null;
    actor: string;
    method: string;
    reason: string;
    requestedAt: string;
    finishedAt?: string;
    result?: unknown;
    error?: unknown;
    extra?: Record<string, unknown>;
  },
): void {
  const finishedAt = input.finishedAt ?? new Date().toISOString();
  const failed = input.error !== undefined && input.error !== null;
  const payload = {
    method: input.method,
    actor: input.actor,
    reason: input.reason,
    requested: true,
    signalStatus: failed ? "failed" : "completed",
    requestedAt: input.requestedAt,
    finishedAt,
    ...(input.extra ?? {}),
    ...(failed
      ? { error: errorMessage(input.error) }
      : { result: summarizeCancellationResult(input.result) }),
  };

  db.prepare(
    `UPDATE execution_runs
     SET cancellation_result_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(JSON.stringify(payload), finishedAt, input.executionRunId);

  recordExecutionRunAttemptEvent(db, {
    executionRunId: input.executionRunId,
    attemptNumber: input.attemptNumber,
    eventType: failed ? "cancel_signal_failed" : "cancel_signal_completed",
    metadata: payload,
    createdAt: finishedAt,
  });
}

function observeCancellationSignal(
  db: Database.Database,
  input: {
    run: ExecutionRunToCancel;
    actor: string;
    method: string;
    reason: string;
    requestedAt: string;
    result: unknown;
    extra?: Record<string, unknown>;
  },
): void {
  const record = (result: unknown, error?: unknown) => {
    try {
      recordExecutionRunCancellationSignalResult(db, {
        executionRunId: input.run.id,
        attemptNumber: input.run.attemptNumber,
        actor: input.actor,
        method: input.method,
        reason: input.reason,
        requestedAt: input.requestedAt,
        result,
        error,
        extra: input.extra,
      });
    } catch (recordError) {
      console.warn("[execution-runs] failed to persist cancellation signal result", {
        runId: input.run.id,
        provider: input.run.provider,
        error: errorMessage(recordError),
      });
    }
  };

  if (isPromiseLike(input.result)) {
    input.result.then((result) => record(result)).catch((error) => record(undefined, error));
    return;
  }

  record(input.result);
}

export function cancelRunningExecutionRunsForTask(
  db: Database.Database,
  input: {
    taskId: string;
    toStatus: DbTaskStatus;
    now: string;
    terminateRun?: ExecutionRunTerminator;
  }
): ExecutionRunToCancel[] {
  if (!taskStatusCancelsRunningExecutions(input.toStatus)) return [];

  const rows = db
    .prepare(
      `SELECT id, task_id, provider, session_id, process_pid, started_at, attempt_number
       FROM execution_runs
       WHERE task_id = ?
         AND status = 'running'`
    )
    .all(input.taskId) as Array<{
      id: string;
      task_id: string;
      provider: string;
      session_id: string | null;
      process_pid: number | null;
      started_at: string | null;
      attempt_number: number | null;
    }>;

  const runs = rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    provider: row.provider,
    sessionId: row.session_id,
    processPid: row.process_pid,
    startedAt: row.started_at,
    attemptNumber: row.attempt_number,
  }));

  for (const run of runs) {
    const durationMs = run.startedAt
      ? Math.max(0, Date.parse(input.now) - Date.parse(run.startedAt))
      : null;
    const cancellationReason = `Cancelled: task transitioned to ${input.toStatus}`;
    const cancellationRequest = buildCancellationRequestResult({
      method: "task_status_transition",
      actor: "task_status_transition",
      reason: cancellationReason,
      requestedAt: input.now,
      extra: { toStatus: input.toStatus },
    });
    db.prepare(
      `UPDATE execution_runs
       SET status = 'cancelled',
           completed_at = ?,
           duration_ms = COALESCE(?, duration_ms),
           error_message = ?,
           failure_class = 'cancelled',
           terminalized_by = COALESCE(terminalized_by, 'task_status_transition'),
           failure_reason = COALESCE(failure_reason, ?),
           retry_allowed = 0,
           retry_decision_reason = 'task_status_transition',
           cancellation_actor = COALESCE(cancellation_actor, 'task_status_transition'),
           cancellation_reason = COALESCE(cancellation_reason, ?),
           cancellation_result_json = COALESCE(cancellation_result_json, ?),
           process_pid = NULL,
           idempotency_key = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'running'`
    ).run(
      input.now,
      Number.isFinite(durationMs) ? durationMs : null,
      cancellationReason,
      cancellationReason,
      cancellationReason,
      JSON.stringify(cancellationRequest),
      input.now,
      run.id
    );
    recordExecutionRunAttemptEvent(db, {
      executionRunId: run.id,
      attemptNumber: run.attemptNumber,
      eventType: "cancelled",
      metadata: {
        actor: "task_status_transition",
        taskId: run.taskId,
        toStatus: input.toStatus,
        durationMs: Number.isFinite(durationMs) ? durationMs : null,
      },
      createdAt: input.now,
    });

    try {
      const terminate = input.terminateRun ?? defaultTerminateExecutionRun;
      const terminationResult = terminate(run);
      observeCancellationSignal(db, {
        run,
        actor: "task_status_transition",
        method: "task_status_transition",
        reason: cancellationReason,
        requestedAt: input.now,
        result: terminationResult,
        extra: { toStatus: input.toStatus },
      });
    } catch (error) {
      console.warn("[execution-runs] terminate signal threw during task-status cancellation", {
        runId: run.id,
        provider: run.provider,
        error: errorMessage(error),
      });
      recordExecutionRunCancellationSignalResult(db, {
        executionRunId: run.id,
        attemptNumber: run.attemptNumber,
        actor: "task_status_transition",
        method: "task_status_transition",
        reason: cancellationReason,
        requestedAt: input.now,
        error,
        extra: { toStatus: input.toStatus },
      });
    }

    cleanupRunArtifacts(run.id).catch(() => {});
  }

  return runs;
}
