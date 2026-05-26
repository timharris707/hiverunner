import {
  SEEDED_MODEL_SOURCES,
  type ModelSourceProbeResult,
  type ModelSourceInventoryItem,
} from "@/lib/orchestration/execution-hives";
import { getSecret, getSecretSource, getSecretStore, setSecret, type SecretSource } from "@/lib/secrets";

type ModelSourceCredentialConfig = {
  id: ModelSourceInventoryItem["id"];
  primarySecretName: string;
  secretNames: string[];
  connectedNote: string;
  missingNote: string;
  optional?: boolean;
  endpointLabel: string;
};

const CREDENTIAL_CONFIGS: ModelSourceCredentialConfig[] = [
  {
    id: "openai",
    primarySecretName: "OPENAI_API_KEY",
    secretNames: ["OPENAI_API_KEY"],
    connectedNote: "Direct OpenAI credential is configured.",
    missingNote: "Direct OpenAI routes need OPENAI_API_KEY. Codex runtime auth is separate and can still work without this key.",
    endpointLabel: "OpenAI models",
  },
  {
    id: "anthropic",
    primarySecretName: "ANTHROPIC_API_KEY",
    secretNames: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    connectedNote: "Direct Anthropic credential is configured.",
    missingNote: "Direct Anthropic routes need ANTHROPIC_API_KEY. Claude Code runtime auth is separate and can still work without this key.",
    endpointLabel: "Anthropic models",
  },
  {
    id: "google",
    primarySecretName: "GEMINI_API_KEY",
    secretNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    connectedNote: "Direct Google/Gemini credential is configured.",
    missingNote: "Direct Google routes need GEMINI_API_KEY or an equivalent Google AI key.",
    endpointLabel: "Google Generative Language models",
  },
  {
    id: "openrouter",
    primarySecretName: "OPENROUTER_API_KEY",
    secretNames: ["OPENROUTER_API_KEY"],
    connectedNote: "OpenRouter broker credential is configured.",
    missingNote: "OpenRouter routes need OPENROUTER_API_KEY. Runtime labels alone do not prove broker access.",
    endpointLabel: "OpenRouter key metadata",
  },
  {
    id: "ollama",
    primarySecretName: "OLLAMA_HOST",
    secretNames: ["OLLAMA_HOST"],
    connectedNote: "Local model host override is configured.",
    missingNote: "No explicit local model host is configured. Default localhost probing is not wired into this credential check yet.",
    optional: true,
    endpointLabel: "Ollama local tags",
  },
  {
    id: "vllm",
    primarySecretName: "VLLM_BASE_URL",
    secretNames: ["VLLM_BASE_URL", "VLLM_API_KEY"],
    connectedNote: "Self-hosted vLLM endpoint credential metadata is configured.",
    missingNote: "Self-hosted vLLM routing needs VLLM_BASE_URL and, if required, VLLM_API_KEY.",
    endpointLabel: "vLLM OpenAI-compatible models",
  },
];

const CONFIG_BY_ID = new Map(CREDENTIAL_CONFIGS.map((config) => [config.id, config]));

function findConfiguredSecret(secretNames: string[]): { name: string; source: SecretSource } | null {
  for (const name of secretNames) {
    const source = getSecretSource(name);
    if (source) return { name, source };
  }
  return null;
}

function findConfiguredSecretValue(secretNames: string[]): { name: string; source: SecretSource; value: string } | null {
  for (const name of secretNames) {
    const source = getSecretSource(name);
    const value = getSecret(name);
    if (source && value) return { name, source, value };
  }
  return null;
}

function credentialStorageMetadata(source: SecretSource | null): NonNullable<ModelSourceInventoryItem["credentialStorage"]> {
  const store = getSecretStore();
  const isManaged = store.id === "managed" || source === "managed-secret-store";
  const label = source === "environment"
    ? "Environment variable"
    : source === "keychain"
      ? "Local keychain"
      : source === "local-file"
        ? "Local data file"
        : source === "managed-secret-store"
          ? "Managed secret store"
          : store.id === "managed"
            ? "Managed secret store"
            : "Local secret adapter";

  return {
    adapterId: store.id,
    label,
    productionReady: isManaged,
    note: isManaged
      ? "Production-ready tenant-scoped secret storage is active for this environment."
      : source === "local-file"
        ? "Saved server-side under the local HiveRunner data directory. This is convenient for local-first installs; hosted production should use encrypted tenant-scoped secret storage with audit logs and rotation."
        : "Local and staging use this server-side local adapter. Hosted production should use encrypted tenant-scoped secret storage with audit logs, rotation, and no secret values returned to the browser.",
  };
}

function responseSummary(status: number, ok: boolean): string {
  if (ok) return `Provider responded with HTTP ${status}.`;
  if (status === 401 || status === 403) return `Provider rejected the credential with HTTP ${status}.`;
  if (status === 404) return "Provider endpoint was not found. Check the configured base URL.";
  if (status >= 500) return `Provider endpoint returned HTTP ${status}.`;
  return `Provider responded with HTTP ${status}.`;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 7000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function openAiCompatibleModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`;
}

async function runProviderProbe(sourceId: string, configured: { value: string }): Promise<{ response: Response; endpointLabel: string }> {
  switch (sourceId) {
    case "openai":
      return {
        endpointLabel: "OpenAI models",
        response: await fetchWithTimeout("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${configured.value}` },
        }),
      };
    case "anthropic":
      return {
        endpointLabel: "Anthropic models",
        response: await fetchWithTimeout("https://api.anthropic.com/v1/models", {
          headers: {
            "anthropic-version": "2023-06-01",
            "x-api-key": configured.value,
          },
        }),
      };
    case "google":
      return {
        endpointLabel: "Google Generative Language models",
        response: await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(configured.value)}`),
      };
    case "openrouter":
      return {
        endpointLabel: "OpenRouter key metadata",
        response: await fetchWithTimeout("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${configured.value}` },
        }),
      };
    case "ollama":
      return {
        endpointLabel: "Ollama local tags",
        response: await fetchWithTimeout(`${normalizeBaseUrl(configured.value || "http://127.0.0.1:11434")}/api/tags`, {}, 2500),
      };
    case "vllm": {
      const apiKey = getSecret("VLLM_API_KEY");
      return {
        endpointLabel: "vLLM OpenAI-compatible models",
        response: await fetchWithTimeout(openAiCompatibleModelsUrl(configured.value), {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        }),
      };
    }
    default:
      throw new Error(`Unknown model source: ${sourceId}`);
  }
}

export function probeModelSourceCredential(sourceId: string, checkedAt = new Date().toISOString()): ModelSourceInventoryItem {
  const seed = SEEDED_MODEL_SOURCES.find((source) => source.id === sourceId);
  if (!seed) {
    throw new Error(`Unknown model source: ${sourceId}`);
  }

  const config = CONFIG_BY_ID.get(seed.id);
  if (!config) {
    return {
      ...seed,
      status: "not_configured",
      authSurface: "none",
      credentialStorage: credentialStorageMetadata(null),
      lastCheckedAt: checkedAt,
    };
  }

  const configured = findConfiguredSecret(config.secretNames);
  if (configured) {
    return {
      ...seed,
      status: "connected",
      authSurface: configured.source,
      credentialStorage: credentialStorageMetadata(configured.source),
      configuredSecretNames: [configured.name],
      credentialSecretNames: config.secretNames,
      note: `${config.connectedNote} Source: ${configured.source}.`,
      lastCheckedAt: checkedAt,
    };
  }

  return {
    ...seed,
    status: config.optional ? "not_configured" : "needs_key",
    authSurface: config.optional ? "local" : "none",
    credentialStorage: credentialStorageMetadata(null),
    credentialSecretNames: config.secretNames,
    configuredSecretNames: [],
    note: config.missingNote,
    lastCheckedAt: checkedAt,
  };
}

export function listModelSourceCredentials(checkedAt = new Date().toISOString()): ModelSourceInventoryItem[] {
  return SEEDED_MODEL_SOURCES.map((source) => probeModelSourceCredential(source.id, checkedAt));
}

export function saveModelSourceCredential(input: {
  sourceId: string;
  credentialValue: string;
}): ModelSourceInventoryItem {
  const config = CONFIG_BY_ID.get(input.sourceId);
  if (!config) {
    throw new Error(`Unknown model source: ${input.sourceId}`);
  }
  setSecret(config.primarySecretName, input.credentialValue);
  return probeModelSourceCredential(input.sourceId);
}

export async function runModelSourceConnectionProbe(sourceId: string, checkedAt = new Date().toISOString()): Promise<ModelSourceProbeResult> {
  const seed = SEEDED_MODEL_SOURCES.find((source) => source.id === sourceId);
  if (!seed) {
    throw new Error(`Unknown model source: ${sourceId}`);
  }
  const config = CONFIG_BY_ID.get(seed.id);
  if (!config) {
    return {
      sourceId,
      status: "warn",
      label: seed.label,
      checkedAt,
      note: "This model source does not have a provider probe yet.",
    };
  }

  const configured = findConfiguredSecretValue(config.secretNames);
  if (!configured) {
    return {
      sourceId,
      status: config.optional ? "warn" : "fail",
      label: seed.label,
      checkedAt,
      authSurface: config.optional ? "local" : "none",
      configuredSecretNames: [],
      endpointLabel: config.endpointLabel,
      note: config.missingNote,
    };
  }

  const startedAt = Date.now();
  try {
    const { response, endpointLabel } = await runProviderProbe(sourceId, configured);
    const latencyMs = Date.now() - startedAt;
    return {
      sourceId,
      status: response.ok ? "pass" : response.status === 401 || response.status === 403 ? "fail" : "warn",
      label: seed.label,
      checkedAt,
      authSurface: configured.source,
      configuredSecretNames: [configured.name],
      endpointLabel,
      latencyMs,
      note: responseSummary(response.status, response.ok),
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error && error.name === "AbortError"
      ? "Provider probe timed out before returning metadata."
      : error instanceof Error
        ? error.message
        : String(error);
    return {
      sourceId,
      status: "warn",
      label: seed.label,
      checkedAt,
      authSurface: configured.source,
      configuredSecretNames: [configured.name],
      endpointLabel: config.endpointLabel,
      latencyMs,
      note: message,
    };
  }
}
