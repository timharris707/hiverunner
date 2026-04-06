/**
 * Mission Control — Codex Execution Bridge
 *
 * Bridges real Codex CLI execution (from build-queue.ts) into the
 * canonical orchestration execution model (execution_runs table).
 *
 * Design:
 *   - Fail-safe: all functions catch errors and log them. Never throws.
 *   - The build-queue is the caller and must not be disrupted by bridge failures.
 *   - Uses idempotency_key = buildEntryId for dedup and update linkage.
 *   - task_id is NULL for factory builds (factory tasks are not orchestration tasks).
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

import { randomUUID } from "crypto";

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

/**
 * Resolve a factory agent name to an orchestration agent UUID.
 * Returns null if the agent is not found in the orchestration DB.
 */
function resolveAgentId(
  db: ReturnType<typeof getDb>,
  agentName: string | null | undefined,
): string | null {
  if (!db || !agentName) return null;
  try {
    const row = db
      .prepare(
        `SELECT id FROM agents
         WHERE lower(name) = lower(?) OR lower(slug) = lower(?)
         LIMIT 1`,
      )
      .get(agentName, agentName) as { id: string } | undefined;
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════
   Public Bridge Functions
   ══════════════════════════════════════════ */

/**
 * Called when a Codex build process has been verified as running.
 *
 * Creates an execution_runs record with status='running'.
 * task_id is NULL (factory builds are not orchestration tasks).
 * agent_id is resolved from the assigned agent name if possible.
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
  try {
    const db = getDb();
    if (!db) return;

    const agentId = resolveAgentId(db, params.assignedAgent);
    const now = new Date().toISOString();
    const runId = randomUUID();

    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, session_id, status,
         started_at, completed_at, error_message, token_usage_json,
         duration_ms, idempotency_key, created_at, updated_at)
       VALUES (?, NULL, ?, 'codex', NULL, 'running',
               ?, NULL, NULL, ?, NULL, ?, ?, ?)`,
    ).run(
      runId,
      agentId,
      params.startedAt,
      JSON.stringify({
        source: "codex-cli",
        cli: "codex exec --full-auto",
        factoryBuildId: params.buildId,
        factoryTaskId: params.factoryTaskId,
        factoryTaskTitle: params.factoryTaskTitle ?? null,
        modelId: params.modelId ?? "openai-codex/gpt-5.4",
        modelName: params.modelName ?? "GPT-5.4",
        note: "Token counts not available from Codex CLI output.",
      }),
      params.buildId, // idempotency_key = buildId for update linkage
      now,
      now,
    );

    console.log(
      `${BRIDGE_TAG} run started: ${runId} (build=${params.buildId}, agent=${params.assignedAgent ?? "unassigned"})`,
    );
  } catch (err) {
    // Idempotency: if the run already exists (duplicate buildId), log and continue
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint")) {
      console.log(`${BRIDGE_TAG} run already exists for build ${params.buildId} (idempotent)`);
    } else {
      console.error(`${BRIDGE_TAG} failed to create run for build ${params.buildId}:`, msg);
    }
  }
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

    // No existing run (e.g. spawn failure before updateRunningState).
    // Create a failed run directly.
    const agentId = resolveAgentId(db, params.assignedAgent);
    const now = new Date().toISOString();
    const runId = randomUUID();

    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, session_id, status,
         started_at, completed_at, error_message, token_usage_json,
         duration_ms, idempotency_key, created_at, updated_at)
       VALUES (?, NULL, ?, 'codex', NULL, 'failed',
               ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runId,
      agentId,
      params.startedAt,
      params.completedAt,
      params.error.slice(0, 2000),
      JSON.stringify({
        source: "codex-cli",
        cli: "codex exec --full-auto",
        factoryBuildId: params.buildId,
        factoryTaskId: params.factoryTaskId,
        note: "Token counts not available from Codex CLI output.",
      }),
      Math.trunc(params.durationMs),
      params.buildId,
      now,
      now,
    );

    console.log(
      `${BRIDGE_TAG} run created as failed: ${runId} (build=${params.buildId})`,
    );
  } catch (err) {
    console.error(
      `${BRIDGE_TAG} failed to record failure for build ${params.buildId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
