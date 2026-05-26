export const DEFAULT_CLAUDE_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_CODEX_TIMEOUT_MS = 60 * 60 * 1000;
export const DEFAULT_HEARTBEAT_RUN_TIMEOUT_MS = 90 * 60 * 1000;

export function numberFromEnvWithDefault(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getHeartbeatRunTimeoutMs(): number {
  return numberFromEnvWithDefault("MC_HEARTBEAT_RUN_TIMEOUT_MS", DEFAULT_HEARTBEAT_RUN_TIMEOUT_MS);
}
