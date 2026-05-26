/**
 * HiveRunner — Codex Execution Bridge
 *
 * Bridges real Codex CLI execution (from build-queue.ts) into the
 * canonical orchestration execution model when a build is backed by an
 * orchestration task.
 *
 * Design:
 *   - Fail-safe: all functions catch errors and log them. Never throws.
 *   - The build-queue is the caller and must not be disrupted by bridge failures.
 *   - Uses idempotency_key = buildEntryId for dedup and update linkage.
 *   - factory builds without orchestration task ids are logged by build-queue only.
 *   - agent_id is resolved by name lookup against the orchestration agents table.
 *
 * What this bridge records honestly:
 *   - Run lifecycle: running → completed | failed
 *   - Wall-clock timing: started_at, completed_at, duration_ms
 *   - Error messages on failure
 *   - Provider identity: "codex"
 *
 * What this bridge does NOT record (because the CLI does not emit it):
 *   - Token usage (CLI does not report token counts)
 *   - Cost data (derivable from pricing table but not from CLI output)
 *   - Thinking/reasoning level (CLI has no control flag or telemetry)
 *   - Structured tool events (CLI output is unstructured text)
 *   - Transcript (CLI stdout is captured by build-queue, not parsed here)
 */

const BRIDGE_TAG = "[codex-bridge]";

/**
 * Lazily import the orchestration DB.
 * The build-queue may run in contexts where the orchestration module
 * is not yet initialized. Lazy import prevents import-time crashes.
 */
function getDb() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getOrchestrationDb } = require("@/lib/orchestration/db");
    return getOrchestrationDb();
  } catch (err) {
    console.warn(
      `${BRIDGE_TAG} orchestration DB not available:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/* ══════════════════════════════════════════
   Public Bridge Functions
   ══════════════════════════════════════════ */

/**
 * Called when a Codex build process has been verified as running.
 *
 * Factory builds are not orchestration tasks, so they should not create
 * taskless execution_runs rows.
 */
export function bridgeCodexRunStarted(params: {
  buildId: string;
  factoryTaskId: string;
  factoryTaskTitle?: string;
  assignedAgent: string | null;
  startedAt: string;
  modelId?: string;
  modelName?: string;
}): void {
  console.log(
    `${BRIDGE_TAG} factory build started outside orchestration task scope: build=${params.buildId}, factoryTask=${params.factoryTaskId}, agent=${params.assignedAgent ?? "unassigned"}`,
  );
}

/**
 * Called when a Codex build completes successfully.
 *
 * Updates the execution_run matched by idempotency_key = buildId.
 */
export function bridgeCodexRunCompleted(params: {
  buildId: string;
  completedAt: string;
  durationMs: number;
}): void {
  try {
    const db = getDb();
    if (!db) return;

    const result = db
      .prepare(
        `UPDATE execution_runs
         SET status = 'completed',
             completed_at = ?,
             duration_ms = ?,
             updated_at = ?
         WHERE idempotency_key = ? AND provider = 'codex'`,
      )
      .run(
        params.completedAt,
        Math.trunc(params.durationMs),
        new Date().toISOString(),
        params.buildId,
      );

    if (result.changes > 0) {
      console.log(
        `${BRIDGE_TAG} run completed: build=${params.buildId} (${Math.round(params.durationMs / 1000)}s)`,
      );
    } else {
      console.warn(
        `${BRIDGE_TAG} no run found to complete for build=${params.buildId}`,
      );
    }
  } catch (err) {
    console.error(
      `${BRIDGE_TAG} failed to complete run for build ${params.buildId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Called when a Codex build fails (execution failure or spawn failure).
 *
 * Updates the execution_run matched by idempotency_key = buildId.
 * If no run exists yet (spawn failure before running state), creates one.
 */
export function bridgeCodexRunFailed(params: {
  buildId: string;
  factoryTaskId: string;
  assignedAgent: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  error: string;
}): void {
  try {
    const db = getDb();
    if (!db) return;

    // Try to update existing run first
    const result = db
      .prepare(
        `UPDATE execution_runs
         SET status = 'failed',
             completed_at = ?,
             duration_ms = ?,
             error_message = ?,
             updated_at = ?
         WHERE idempotency_key = ? AND provider = 'codex'`,
      )
      .run(
        params.completedAt,
        Math.trunc(params.durationMs),
        params.error.slice(0, 2000),
        new Date().toISOString(),
        params.buildId,
      );

    if (result.changes > 0) {
      console.log(
        `${BRIDGE_TAG} run failed: build=${params.buildId}`,
      );
      return;
    }

    console.log(
      `${BRIDGE_TAG} factory build failed outside orchestration task scope: build=${params.buildId}, factoryTask=${params.factoryTaskId}`,
    );
  } catch (err) {
    console.error(
      `${BRIDGE_TAG} failed to record failure for build ${params.buildId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
