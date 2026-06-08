/**
 * Derives operator-visible liveness for an in-flight heartbeat run.
 *
 * Operator trust requires that CLI runs which produce no output for minutes
 * are distinguishable from runs that have actually hung. We classify a run
 * along operator-facing buckets using the most recent signal we have for it (process
 * lifecycle event, run event, agent comment, task event).
 */

export type RunLiveness = "queued" | "live" | "quiet" | "suspicious" | "stalled" | "completed";

export interface RunLivenessInput {
  /** heartbeat_runs.status — running/queued/succeeded/failed/cancelled/timed_out */
  status: string;
  /** ISO timestamp from heartbeat_runs.started_at */
  startedAt?: string | null;
  /** ISO timestamp from heartbeat_runs.finished_at */
  finishedAt?: string | null;
  /** Newest signal we have for this run (event, comment, task transition). */
  lastEventAt?: string | null;
  /** Newest evidence that the CLI advanced the task, separate from heartbeat/noise. */
  lastMeaningfulProgressAt?: string | null;
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
  /** At or above this, runs render as "suspicious". Default 90s. */
  suspiciousThresholdMs?: number;
  /** @deprecated Use suspiciousThresholdMs. Kept for older callers/tests. */
  stalledThresholdMs?: number;
}

export interface RunLivenessSnapshot {
  liveness: RunLiveness;
  /** How long the run has been alive (start → now / finish). null when no start. */
  ageMs: number | null;
  /** How long since the last visible signal. null when no signal yet. */
  lastEventAgeMs: number | null;
  /** How long since the last meaningful runtime progress event. */
  lastMeaningfulProgressAgeMs: number | null;
  /** When the current run becomes suspicious if no more meaningful progress appears. */
  suspiciousAfterAt: string | null;
  /** Human-readable badge label, e.g. "Live", "Quiet · 1m 12s", "Suspicious · 4m". */
  label: string;
}

const DEFAULT_QUIET_MS = 30_000;
const DEFAULT_SUSPICIOUS_MS = 90_000;
const QUEUED_STATUSES = new Set(["queued", "pending"]);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const MEANINGFUL_PROGRESS_KINDS = new Set([
  "assistant_text_delta",
  "assistant_text_final",
  "assistant_final",
  "assistant_text",
  "thinking_delta",
  "thinking_summary",
  "tool_call_start",
  "tool_call_end",
  "tool_result",
  "action_detected",
  "comment_written",
  "task_updated",
  "report_written",
  "stdout_chunk",
  "stderr_chunk",
  "task.comment_added",
  "task.status_changed",
]);

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

function hasReadableBody(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function isRuntimeProgressDiagnostic(input: { type?: string | null; message?: string | null }): boolean {
  const type = input.type?.trim().toLowerCase() ?? "";
  const message = input.message?.trim() ?? "";
  if (type === "heartbeat" || type === "run_progress" || type === "runtime_progress") return true;
  if (type === "waiting" && message.startsWith("External runner still active after")) return true;
  return false;
}

function isMeaningfulProgressKind(kind: string | null | undefined): boolean {
  return Boolean(kind && MEANINGFUL_PROGRESS_KINDS.has(kind));
}

export function isMeaningfulProgressEntry(input: {
  kind?: string | null;
  type?: string | null;
  message?: string | null;
}): boolean {
  if (!hasReadableBody(input.message)) return false;
  if (isRuntimeProgressDiagnostic({ type: input.type, message: input.message })) return false;
  return isMeaningfulProgressKind(input.type) || input.kind === "comment";
}

export function latestMeaningfulProgressMs<T extends { ts?: string | null; type?: string | null; kind?: string | null; message?: string | null }>(
  entries: T[],
): number | null {
  return entries.reduce<number | null>((acc, entry) => {
    if (!isMeaningfulProgressEntry(entry)) return acc;
    const ms = parseTs(entry.ts);
    if (ms == null) return acc;
    return acc == null || ms > acc ? ms : acc;
  }, null);
}

export function suspiciousAfterAt(referenceAt: string | null | undefined, thresholdMs = DEFAULT_SUSPICIOUS_MS): string | null {
  const referenceMs = parseTs(referenceAt);
  return referenceMs == null ? null : new Date(referenceMs + thresholdMs).toISOString();
}

export function deriveRunLiveness(input: RunLivenessInput): RunLivenessSnapshot {
  const now = input.now ?? Date.now();
  const quietThresholdMs = input.quietThresholdMs ?? DEFAULT_QUIET_MS;
  const suspiciousThresholdMs = input.suspiciousThresholdMs ?? input.stalledThresholdMs ?? DEFAULT_SUSPICIOUS_MS;

  const startedMs = parseTs(input.startedAt);
  const finishedMs = parseTs(input.finishedAt);
  const lastEventMs = parseTs(input.lastEventAt);
  const lastMeaningfulProgressMs = parseTs(input.lastMeaningfulProgressAt);

  // Use the freshest signal we have for the activity clock. The run row's
  // started_at counts as a signal (the engine has at minimum kicked it off).
  const lastSignalMs = Math.max(lastEventMs ?? 0, startedMs ?? 0) || null;
  const lastEventAgeMs = lastSignalMs != null ? Math.max(0, now - lastSignalMs) : null;
  const progressReferenceMs = lastMeaningfulProgressMs ?? startedMs;
  const lastMeaningfulProgressAgeMs = progressReferenceMs != null ? Math.max(0, now - progressReferenceMs) : null;
  const suspiciousAfter = progressReferenceMs != null
    ? new Date(progressReferenceMs + suspiciousThresholdMs).toISOString()
    : null;
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
      lastMeaningfulProgressAgeMs,
      suspiciousAfterAt: null,
      label: `Completed · ${formatDuration(settledForMs)} ago`,
    };
  }

  if (QUEUED_STATUSES.has(input.status)) {
    const queuedLabel = input.status === "pending" ? "Pending" : "Queued";
    return {
      liveness: "queued",
      ageMs,
      lastEventAgeMs,
      lastMeaningfulProgressAgeMs,
      suspiciousAfterAt: suspiciousAfter,
      label: lastEventAgeMs == null
        ? queuedLabel
        : `${queuedLabel} · waiting ${formatDuration(lastEventAgeMs)}`,
    };
  }

  // A running row without a clock is still in-flight; keep it live instead of
  // flipping to a stall warning before the first durable signal arrives.
  if (lastEventAgeMs == null) {
    return {
      liveness: "live",
      ageMs,
      lastEventAgeMs: null,
      lastMeaningfulProgressAgeMs: null,
      suspiciousAfterAt: null,
      label: "Live",
    };
  }

  if (lastMeaningfulProgressAgeMs != null && lastMeaningfulProgressAgeMs < quietThresholdMs) {
    return {
      liveness: "live",
      ageMs,
      lastEventAgeMs,
      lastMeaningfulProgressAgeMs,
      suspiciousAfterAt: suspiciousAfter,
      label: `Live · progress ${formatDuration(lastMeaningfulProgressAgeMs)} ago`,
    };
  }

  if (lastMeaningfulProgressAgeMs != null && lastMeaningfulProgressAgeMs < suspiciousThresholdMs) {
    const pidSuffix = input.runnerPid ? ` (pid ${input.runnerPid})` : "";
    return {
      liveness: "quiet",
      ageMs,
      lastEventAgeMs,
      lastMeaningfulProgressAgeMs,
      suspiciousAfterAt: suspiciousAfter,
      label: `Quiet · no progress for ${formatDuration(lastMeaningfulProgressAgeMs)}${pidSuffix}`,
    };
  }

  // Past the suspicious threshold, process liveness is not enough to call the run
  // healthy. A wrapper can be alive while the operator has no durable evidence
  // of progress, so surface that as suspicious and let the watchdog/policy layer
  // decide whether to retry, reassign, or wait.
  if (input.runnerPidAlive === true) {
    const pidSuffix = input.runnerPid ? ` (pid ${input.runnerPid})` : "";
    return {
      liveness: "suspicious",
      ageMs,
      lastEventAgeMs,
      lastMeaningfulProgressAgeMs,
      suspiciousAfterAt: suspiciousAfter,
      label: `Suspicious · runner alive but no progress for ${formatDuration(lastMeaningfulProgressAgeMs ?? lastEventAgeMs)}${pidSuffix}`,
    };
  }

  return {
    liveness: "suspicious",
    ageMs,
    lastEventAgeMs,
    lastMeaningfulProgressAgeMs,
    suspiciousAfterAt: suspiciousAfter,
    label: `Suspicious · no progress for ${formatDuration(lastMeaningfulProgressAgeMs ?? lastEventAgeMs)}`,
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
