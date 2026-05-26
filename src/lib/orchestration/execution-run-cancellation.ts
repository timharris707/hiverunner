import type Database from "better-sqlite3";

import { getExecutionAdapter } from "@/lib/orchestration/execution/adapters";
import { cleanupRunArtifacts } from "@/lib/orchestration/execution/cleanup";
import type { DbTaskStatus } from "@/lib/orchestration/service/shared";

export type ExecutionRunToCancel = {
  id: string;
  taskId: string;
  provider: string;
  sessionId: string | null;
  processPid: number | null;
  startedAt: string | null;
};

export type ExecutionRunTerminator = (run: ExecutionRunToCancel) => void | Promise<unknown>;

const EXECUTION_INACTIVE_TASK_STATUSES = new Set<DbTaskStatus>(["backlog", "to-do", "done", "blocked"]);

export function taskStatusCancelsRunningExecutions(status: DbTaskStatus): boolean {
  return EXECUTION_INACTIVE_TASK_STATUSES.has(status);
}

function defaultTerminateExecutionRun(run: ExecutionRunToCancel): void {
  const adapter = getExecutionAdapter(run.provider);
  if (!adapter.cancel) return;
  adapter.cancel(run.id, run.processPid, run.sessionId).catch((error) => {
    console.warn("[execution-runs] terminate signal failed during task-status cancellation", {
      runId: run.id,
      provider: run.provider,
      error: error instanceof Error ? error.message : String(error),
    });
  });
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
      `SELECT id, task_id, provider, session_id, process_pid, started_at
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
    }>;

  const runs = rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    provider: row.provider,
    sessionId: row.session_id,
    processPid: row.process_pid,
    startedAt: row.started_at,
  }));

  for (const run of runs) {
    const durationMs = run.startedAt
      ? Math.max(0, Date.parse(input.now) - Date.parse(run.startedAt))
      : null;
    db.prepare(
      `UPDATE execution_runs
       SET status = 'cancelled',
           completed_at = ?,
           duration_ms = COALESCE(?, duration_ms),
           error_message = ?,
           failure_class = 'cancelled',
           process_pid = NULL,
           updated_at = ?
       WHERE id = ?
         AND status = 'running'`
    ).run(
      input.now,
      Number.isFinite(durationMs) ? durationMs : null,
      `Cancelled: task transitioned to ${input.toStatus}`,
      input.now,
      run.id
    );

    try {
      const terminate = input.terminateRun ?? defaultTerminateExecutionRun;
      void terminate(run);
    } catch (error) {
      console.warn("[execution-runs] terminate signal threw during task-status cancellation", {
        runId: run.id,
        provider: run.provider,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    cleanupRunArtifacts(run.id).catch(() => {});
  }

  return runs;
}
