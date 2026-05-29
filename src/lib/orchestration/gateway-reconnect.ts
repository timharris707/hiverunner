/**
 * Pure reconnect/backoff helpers for the gateway stream bridge.
 *
 * Kept dependency-free (no DB / native imports) so they can be unit-tested
 * without booting the orchestration DB.
 */

export const RECONNECT_BASE_MS = 2000;
export const RECONNECT_MAX_MS = 30000;

/**
 * Reconnect backoff delay with jitter. Capped at RECONNECT_MAX_MS; ±15% jitter
 * avoids synchronized reconnect storms when several lanes/clients retry together.
 */
export function computeReconnectDelayMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(RECONNECT_BASE_MS * Math.pow(1.5, Math.max(0, attempt)), RECONNECT_MAX_MS);
  return Math.round(base * (0.85 + rand() * 0.3));
}

/**
 * Throttle "gateway unavailable" logging: log the first failure, then stay quiet,
 * emitting only a periodic heartbeat (~every 20th attempt). A long gateway outage
 * then produces a handful of log lines instead of thousands.
 */
export function shouldLogReconnectFailure(attempt: number): boolean {
  if (attempt <= 0) return true;
  return attempt % 20 === 0;
}
