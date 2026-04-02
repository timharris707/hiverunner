import { OrchestrationApiError } from "@/lib/orchestration/api";

export interface PaperclipBridgeConfig {
  apiUrl: string;
  apiKey: string;
  /** Board-level API key used for wakeup calls (falls back to apiKey). */
  bridgeApiKey: string;
  companyId: string;
  runId?: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
}

function sanitizeApiUrl(raw: string): string {
  return raw.replace(/\/+$/, "");
}

export function getPaperclipBridgeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): PaperclipBridgeConfig {
  const apiUrl = env.PAPERCLIP_API_URL?.trim();
  const apiKey = env.PAPERCLIP_API_KEY?.trim();
  const bridgeApiKey = env.PAPERCLIP_BRIDGE_API_KEY?.trim();
  const companyId = env.PAPERCLIP_COMPANY_ID?.trim();
  const runId = env.PAPERCLIP_RUN_ID?.trim();

  const parsedTimeout = Number(env.ORCHESTRATION_BRIDGE_TIMEOUT_MS ?? "10000");
  const timeoutMs = Number.isFinite(parsedTimeout)
    ? Math.min(60_000, Math.max(1000, Math.floor(parsedTimeout)))
    : 10_000;
  const parsedMaxRetries = Number(env.ORCHESTRATION_BRIDGE_MAX_RETRIES ?? "2");
  const maxRetries = Number.isFinite(parsedMaxRetries)
    ? Math.min(5, Math.max(0, Math.floor(parsedMaxRetries)))
    : 2;
  const parsedRetryBaseMs = Number(env.ORCHESTRATION_BRIDGE_RETRY_BASE_MS ?? "300");
  const retryBaseMs = Number.isFinite(parsedRetryBaseMs)
    ? Math.min(5_000, Math.max(100, Math.floor(parsedRetryBaseMs)))
    : 300;

  if (!apiUrl || !apiKey || !companyId) {
    throw new OrchestrationApiError(
      503,
      "bridge_not_configured",
      "Paperclip bridge is not configured"
    );
  }

  return {
    apiUrl: sanitizeApiUrl(apiUrl),
    apiKey,
    bridgeApiKey: bridgeApiKey || apiKey,
    companyId,
    runId: runId || undefined,
    timeoutMs,
    maxRetries,
    retryBaseMs,
  };
}
