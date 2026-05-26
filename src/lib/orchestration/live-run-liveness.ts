/**
 * Derives operator-visible liveness for an in-flight heartbeat run.
 *
 * Operator trust requires that CLI runs which produce no output for minutes
 * are distinguishable from runs that have actually hung. We classify a run
 * along four buckets using the most recent signal we have for it (process
 * lifecycle event, run event, agent comment, task event).
 */

export type RunLiveness = "live" | "quiet" | "stalled" | "completed";

export interface RunLivenessInput {
  /** heartbeat_runs.status — running/queued/succeeded/failed/cancelled/timed_out */
  status: string;
  /** ISO timestamp from heartbeat_runs.started_at */
  startedAt?: string | null;
  /** ISO timestamp from heartbeat_runs.finished_at */
  finishedAt?: string | null;
  /** Newest signal we have for this run (event, comment, task transition). */
  lastEventAt?: string | null;
  /** Active process PID, when a CLI provider is still attached. */
  runnerPid?: number | null;
  /** Tri-state liveness of the runner PID. `true` = process verified alive
   * via signal(0). `false` = process verified gone. `null`/undefined = no
   * probe was performed (e.g. PID unknown, or running off-host). */
  runnerPidAlive?: boolean | null;
  /** Reference time for derivation; defaults to wall clock. */
  now?: number;
  /** Below this, runs render as "live". Default 30s. */
  quietThresholdMs?: number;
  /** At or above this, runs render as "stalled". Default 180s. */
  stalledThresholdMs?: number;
}

export interface RunLivenessSnapshot {
  liveness: RunLiveness;
  /** How long the run has been alive (start → now / finish). null when no start. */
  ageMs: number | null;
  /** How long since the last visible signal. null when no signal yet. */
  lastEventAgeMs: number | null;
  /** Human-readable badge label, e.g. "Live", "Quiet · 1m 12s", "Stalled · 4m". */
  label: string;
}

const DEFAULT_QUIET_MS = 30_000;
const DEFAULT_STALLED_MS = 180_000;
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  const totalSec = Math.round(ms / 1_000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

export function deriveRunLiveness(input: RunLivenessInput): RunLivenessSnapshot {
  const now = input.now ?? Date.now();
  const quietThresholdMs = input.quietThresholdMs ?? DEFAULT_QUIET_MS;
  const stalledThresholdMs = input.stalledThresholdMs ?? DEFAULT_STALLED_MS;

  const startedMs = parseTs(input.startedAt);
  const finishedMs = parseTs(input.finishedAt);
  const lastEventMs = parseTs(input.lastEventAt);

  // Use the freshest signal we have for the activity clock. The run row's
  // started_at counts as a signal (the engine has at minimum kicked it off).
  const lastSignalMs = Math.max(lastEventMs ?? 0, startedMs ?? 0) || null;
  const lastEventAgeMs = lastSignalMs != null ? Math.max(0, now - lastSignalMs) : null;
  const ageMs = startedMs != null
    ? Math.max(0, (finishedMs ?? now) - startedMs)
    : null;

  if (TERMINAL_STATUSES.has(input.status)) {
    const completedAt = finishedMs ?? lastSignalMs ?? now;
    const settledForMs = Math.max(0, now - completedAt);
    return {
      liveness: "completed",
      ageMs,
      lastEventAgeMs: settledForMs,
      label: `Completed · ${formatDuration(settledForMs)} ago`,
    };
  }

  // No clock at all yet — treat as live so the UI keeps animating instead of
  // flipping to a stall warning immediately after a fresh queue insert.
  if (lastEventAgeMs == null) {
    return {
      liveness: "live",
      ageMs,
      lastEventAgeMs: null,
      label: "Live",
    };
  }

  if (lastEventAgeMs < quietThresholdMs) {
    return {
      liveness: "live",
      ageMs,
      lastEventAgeMs,
      label: `Live · last signal ${formatDuration(lastEventAgeMs)} ago`,
    };
  }

  if (lastEventAgeMs < stalledThresholdMs) {
    const pidSuffix = input.runnerPid ? ` (pid ${input.runnerPid})` : "";
    return {
      liveness: "quiet",
      ageMs,
      lastEventAgeMs,
      label: `Quiet · no signal for ${formatDuration(lastEventAgeMs)}${pidSuffix}`,
    };
  }

  // Past the stall threshold: if we have positive evidence the runner process
  // is still alive on the host, hold the classification at "quiet" — the CLI
  // is working without flushing observable signal. Only flip to "stalled" when
  // we lack that evidence (no probe, or probe says the process is gone).
  if (input.runnerPidAlive === true) {
    const pidSuffix = input.runnerPid ? ` (pid ${input.runnerPid})` : "";
    return {
      liveness: "quiet",
      ageMs,
      lastEventAgeMs,
      label: `Quiet · runner alive, no signal for ${formatDuration(lastEventAgeMs)}${pidSuffix}`,
    };
  }

  return {
    liveness: "stalled",
    ageMs,
    lastEventAgeMs,
    label: `Stalled · no signal for ${formatDuration(lastEventAgeMs)}`,
  };
}

/**
 * Lightweight host-local liveness probe for a child process. Uses
 * `process.kill(pid, 0)` which sends signal 0 — a no-op that succeeds when
 * the PID is alive and reachable, EPERM-fails when alive but unreachable
 * (still alive), and ESRCH-fails when the PID is gone. Returns null when the
 * PID is not a positive integer (so callers can leave probe state unknown).
 */
export function probeRunnerPidAlive(pid: number | null | undefined): boolean | null {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    return false;
  }
}

export const LIVE_RUN_QUIET_THRESHOLD_MS = DEFAULT_QUIET_MS;
export const LIVE_RUN_STALLED_THRESHOLD_MS = DEFAULT_STALLED_MS;
