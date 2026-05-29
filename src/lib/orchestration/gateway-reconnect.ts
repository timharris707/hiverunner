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

export type GatewayMode = "disabled" | "configured" | "unconfigured";

/** Max connection attempts before an UNCONFIGURED (optional) gateway goes quietly offline. */
export const MAX_UNCONFIGURED_ATTEMPTS = 3;

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/**
 * Decide how the bridge should treat the gateway:
 *  - "disabled": explicitly turned off via OPENCLAW_GATEWAY_DISABLED.
 *  - "configured": the operator clearly intends to use a gateway (auth token
 *    present, or an explicit OPENCLAW_GATEWAY_URL override) → keep retrying.
 *  - "unconfigured": optional/absent gateway → connect-attempt a few times then
 *    go quietly offline instead of churning forever.
 */
export function resolveGatewayMode(input: {
  disabledFlag?: string | undefined;
  explicitUrl?: string | undefined;
  hasToken: boolean;
}): GatewayMode {
  if (TRUTHY.has((input.disabledFlag ?? "").trim().toLowerCase())) return "disabled";
  if (input.hasToken || (input.explicitUrl ?? "").trim().length > 0) return "configured";
  return "unconfigured";
}

/**
 * When the gateway is optional (unconfigured) and has never connected, stop
 * retrying after a few attempts so an absent gateway does not churn forever.
 * A configured gateway (or one that has connected before) keeps retrying.
 */
export function shouldStopReconnecting(input: {
  mode: GatewayMode;
  everConnected: boolean;
  attempt: number;
}): boolean {
  if (input.mode === "configured" || input.everConnected) return false;
  return input.attempt >= MAX_UNCONFIGURED_ATTEMPTS;
}
