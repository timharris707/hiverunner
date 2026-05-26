import type Database from "better-sqlite3";

import {
  SEEDED_AVAILABLE_MODELS,
  type AvailableModelCapability,
  type AvailableModelProvider,
  type AvailableModelRefreshStatus,
} from "@/lib/orchestration/available-models";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  recordAvailableModelRefreshStatus,
  upsertRuntimeCatalogModels,
  type RuntimeCatalogModelInput,
} from "@/lib/orchestration/service/available-models";

type FetchLike = typeof fetch;

type ProviderRefreshResult = {
  provider: AvailableModelProvider;
  status: AvailableModelRefreshStatus["status"];
  models: RuntimeCatalogModelInput[];
  message?: string | null;
};

const providerCapabilities: AvailableModelCapability[] = ["text", "vision", "tools", "structured-output"];

function envValue(names: string[], env: NodeJS.ProcessEnv): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function titleFromModelId(id: string): string {
  return id
    .replace(/^models\//, "")
    .replace(/^[^/]+\//, "")
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function seededModelsFor(provider: AvailableModelProvider): RuntimeCatalogModelInput[] {
  return SEEDED_AVAILABLE_MODELS
    .filter((model) => model.runtimeProvider === provider)
    .map((model) => ({
      id: model.id,
      displayName: model.displayName,
      runtimeProvider: model.runtimeProvider,
      defaultRuntimeLabel: model.defaultRuntimeLabel,
      modelSourceId: model.modelSourceId,
      capabilities: model.capabilities,
      contextWindow: model.contextWindow,
      description: model.description,
    }));
}

function chatCapableOpenAiModel(id: string): boolean {
  const normalized = id.toLowerCase();
  if (/(embedding|whisper|tts|moderation|dall-e|image|audio|transcribe|realtime)/.test(normalized)) return false;
  return /^(gpt-|o\d|chatgpt|codex)/.test(normalized);
}

export async function refreshOpenAiModels(input: { fetcher?: FetchLike; env?: NodeJS.ProcessEnv } = {}): Promise<ProviderRefreshResult> {
  const apiKey = envValue(["OPENAI_API_KEY"], input.env ?? process.env);
  if (!apiKey) return { provider: "openai", status: "fallback", models: seededModelsFor("openai"), message: "OPENAI_API_KEY not configured; used curated OpenAI seed list." };
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenAI model refresh failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: unknown }> };
  const models = (body.data ?? [])
    .map((item) => typeof item.id === "string" ? item.id.trim() : "")
    .filter((id) => id && chatCapableOpenAiModel(id))
    .map((id): RuntimeCatalogModelInput => ({
      id,
      displayName: titleFromModelId(id),
      runtimeProvider: "openai",
      defaultRuntimeLabel: "Codex",
      modelSourceId: "openai",
      capabilities: providerCapabilities,
      description: "Discovered from OpenAI /v1/models.",
    }));
  return { provider: "openai", status: "refreshed", models, message: `OpenAI returned ${models.length} chat-capable model(s).` };
}

export async function refreshGoogleModels(input: { fetcher?: FetchLike; env?: NodeJS.ProcessEnv } = {}): Promise<ProviderRefreshResult> {
  const apiKey = envValue(["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"], input.env ?? process.env);
  if (!apiKey) return { provider: "google", status: "fallback", models: seededModelsFor("google"), message: "Google/Gemini key not configured; used curated Google seed list." };
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`);
  if (!response.ok) throw new Error(`Google model refresh failed with HTTP ${response.status}`);
  const body = await response.json() as { models?: Array<{ name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }> };
  const models = (body.models ?? [])
    .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes("generateContent"))
    .map((item) => String(item.name ?? "").replace(/^models\//, "").trim())
    .filter(Boolean)
    .map((id): RuntimeCatalogModelInput => ({
      id,
      displayName: titleFromModelId(id),
      runtimeProvider: "google",
      defaultRuntimeLabel: "Gemini CLI",
      modelSourceId: "google",
      capabilities: providerCapabilities,
      description: "Discovered from Google Generative Language /v1/models.",
    }));
  return { provider: "google", status: "refreshed", models, message: `Google returned ${models.length} generateContent model(s).` };
}

export async function refreshOpenRouterModels(input: { fetcher?: FetchLike; env?: NodeJS.ProcessEnv } = {}): Promise<ProviderRefreshResult> {
  const apiKey = envValue(["OPENROUTER_API_KEY"], input.env ?? process.env);
  if (!apiKey) return { provider: "openrouter", status: "skipped", models: [], message: "OPENROUTER_API_KEY not configured; skipped OpenRouter catalog refresh." };
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`OpenRouter model refresh failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown }> };
  const models = (body.data ?? [])
    .map((item): RuntimeCatalogModelInput | null => {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) return null;
      return {
        id,
        displayName: typeof item.name === "string" && item.name.trim() ? item.name.trim() : titleFromModelId(id),
        runtimeProvider: "openrouter" as const,
        defaultRuntimeLabel: "OpenRouter",
        modelSourceId: "openrouter",
        capabilities: providerCapabilities,
        contextWindow: typeof item.context_length === "number" ? item.context_length : null,
        description: "Discovered from OpenRouter /api/v1/models.",
      };
    })
    .filter((model): model is RuntimeCatalogModelInput => model !== null);
  return { provider: "openrouter", status: "refreshed", models, message: `OpenRouter returned ${models.length} model(s).` };
}

export async function refreshAnthropicModels(input: { fetcher?: FetchLike; env?: NodeJS.ProcessEnv } = {}): Promise<ProviderRefreshResult> {
  const apiKey = envValue(["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"], input.env ?? process.env);
  if (!apiKey) {
    return {
      provider: "anthropic",
      status: "fallback",
      models: seededModelsFor("anthropic"),
      // Prior HiveRunner builds surfaced Anthropic models through the curated claudeModels()
      // list in runtime-models.ts. Use that same curated path when the official API cannot run.
      message: "Anthropic key not configured; used the existing curated Claude model seed list.",
    };
  }
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!response.ok) throw new Error(`Anthropic model refresh failed with HTTP ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: unknown; display_name?: unknown }> };
  const models = (body.data ?? [])
    .map((item): RuntimeCatalogModelInput | null => {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) return null;
      return {
        id,
        displayName: typeof item.display_name === "string" && item.display_name.trim() ? item.display_name.trim() : titleFromModelId(id),
        runtimeProvider: "anthropic" as const,
        defaultRuntimeLabel: "Claude Code",
        modelSourceId: "anthropic",
        capabilities: providerCapabilities,
        description: "Discovered from Anthropic /v1/models.",
      };
    })
    .filter((model): model is RuntimeCatalogModelInput => model !== null);
  return { provider: "anthropic", status: "refreshed", models, message: `Anthropic returned ${models.length} model(s).` };
}

async function refreshProvider(
  provider: AvailableModelProvider,
  refresh: () => Promise<ProviderRefreshResult>,
  db: Database.Database,
): Promise<AvailableModelRefreshStatus> {
  try {
    const result = await refresh();
    if (result.models.length > 0) {
      upsertRuntimeCatalogModels(provider, result.models, db);
    }
    return recordAvailableModelRefreshStatus({
      provider,
      status: result.status,
      modelCount: result.models.length,
      message: result.message ?? null,
    }, db);
  } catch (error) {
    const fallbackModels = seededModelsFor(provider);
    if (fallbackModels.length > 0) {
      upsertRuntimeCatalogModels(provider, fallbackModels, db);
    }
    return recordAvailableModelRefreshStatus({
      provider,
      status: fallbackModels.length > 0 ? "fallback" : "failed",
      modelCount: fallbackModels.length,
      message: error instanceof Error ? error.message : String(error),
    }, db);
  }
}

export async function refreshAllAvailableModels(input: { fetcher?: FetchLike; env?: NodeJS.ProcessEnv; db?: Database.Database } = {}): Promise<AvailableModelRefreshStatus[]> {
  const db = input.db ?? getOrchestrationDb();
  const shared = { fetcher: input.fetcher, env: input.env };
  const statuses = await Promise.all([
    refreshProvider("anthropic", () => refreshAnthropicModels(shared), db),
    refreshProvider("openai", () => refreshOpenAiModels(shared), db),
    refreshProvider("google", () => refreshGoogleModels(shared), db),
    refreshProvider("openrouter", () => refreshOpenRouterModels(shared), db),
    // Hermes models live in the Hermes harness; auto-pull is deferred to a future harness-bridge lane.
    recordAvailableModelRefreshStatus({ provider: "hermes", status: "skipped", modelCount: 0, message: "Hermes harness model bridge not wired yet." }, db),
    // OpenClaw models live in the OpenClaw harness; auto-pull is deferred to a future harness-bridge lane.
    recordAvailableModelRefreshStatus({ provider: "openclaw", status: "skipped", modelCount: 0, message: "OpenClaw harness model bridge not wired yet." }, db),
  ]);
  return statuses;
}
