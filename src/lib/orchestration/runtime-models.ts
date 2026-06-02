import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import type { AvailableModel, AvailableModelProvider } from "@/lib/orchestration/available-models";
import { listAvailableModels } from "@/lib/orchestration/service/available-models";

export type RuntimeModel = {
  id: string;
  label: string;
  provider?: string;
  default?: boolean;
};

export type RuntimeModelsResult = {
  models: RuntimeModel[];
  supported: boolean;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; result: RuntimeModelsResult }>();

function normalizeRuntimeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  if (normalized === "openai") return "codex";
  return normalized;
}

function commandForProvider(provider: string, command?: string | null, commandPath?: string | null): string {
  if (commandPath?.trim()) return commandPath.trim();
  if (command?.trim()) return command.trim();
  switch (normalizeRuntimeProvider(provider)) {
    case "anthropic":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    case "hermes":
      return "hermes";
    case "symphony":
      return "symphony";
    case "multica":
      return "multica";
    case "openclaw":
      return "openclaw";
    default:
      return provider;
  }
}

function cached(key: string, discover: () => RuntimeModelsResult): RuntimeModelsResult {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.result;
  const result = discover();
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

function claudeModels(): RuntimeModel[] {
  return [
    { id: "anthropic/claude-sonnet-4-8", label: "Claude Sonnet 4.8", provider: "anthropic", default: true },
    { id: "anthropic/claude-opus-4-8", label: "Claude Opus 4.8", provider: "anthropic" },
    { id: "anthropic/claude-haiku-4-8", label: "Claude Haiku 4.8", provider: "anthropic" },
    { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
    { id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7", provider: "anthropic" },
    { id: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "anthropic" },
    { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic" },
    { id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "anthropic" },
  ];
}

function codexModels(): RuntimeModel[] {
  return [
    { id: "openai-codex/gpt-5.5", label: "GPT-5.5", provider: "openai-codex", default: true },
    { id: "openai-codex/gpt-5.4", label: "GPT-5.4", provider: "openai-codex" },
    { id: "openai-codex/gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai-codex" },
    { id: "openai-codex/gpt-5.3-codex", label: "GPT-5.3 Codex", provider: "openai-codex" },
    { id: "openai-codex/gpt-5.3-codex-spark", label: "Codex Spark", provider: "openai-codex" },
    { id: "openai-codex/gpt-5.2", label: "GPT-5.2", provider: "openai-codex" },
  ];
}

function geminiModels(): RuntimeModel[] {
  return [
    { id: "google/gemini-3-pro-preview", label: "Gemini 3 Pro Preview", provider: "google", default: true },
    { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", provider: "google" },
    { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview", provider: "google" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" },
    { id: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: "google" },
  ];
}

function runtimeCatalogProvider(provider: string): AvailableModelProvider | null {
  switch (provider) {
    case "anthropic":
      return "anthropic";
    case "codex":
      return "openai";
    case "gemini":
      return "google";
    default:
      return null;
  }
}

function runtimeModelProvider(provider: AvailableModelProvider): string {
  switch (provider) {
    case "openai":
      return "openai-codex";
    case "google":
      return "google";
    default:
      return provider;
  }
}

function stripRuntimeModelPrefix(id: string, provider: AvailableModelProvider): string {
  switch (provider) {
    case "anthropic":
      return id.replace(/^anthropic\//i, "").trim();
    case "openai":
      return id
        .replace(/^openai-codex\//i, "")
        .replace(/^openai\//i, "")
        .replace(/^codex\//i, "")
        .trim();
    case "google":
      return id
        .replace(/^google\//i, "")
        .replace(/^gemini\//i, "gemini-")
        .replace(/^models\//i, "")
        .trim();
    default:
      return id.trim();
  }
}

function runtimeModelIdForCatalogModel(model: AvailableModel): string {
  const id = stripRuntimeModelPrefix(model.id, model.runtimeProvider);
  switch (model.runtimeProvider) {
    case "anthropic":
      return id ? `anthropic/${id}` : model.id;
    case "openai":
      return id ? `openai-codex/${id}` : model.id;
    case "google":
      return id ? `google/${id}` : model.id;
    default:
      return model.id;
  }
}

function canonicalRuntimeModelId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/^anthropic\//, "")
    .replace(/^openai-codex\//, "")
    .replace(/^openai\//, "")
    .replace(/^codex\//, "")
    .replace(/^google\//, "")
    .replace(/^gemini\//, "gemini-")
    .replace(/^models\//, "");
}

function mergeCatalogWithFallback(
  catalogModels: RuntimeModel[],
  fallback: RuntimeModel[],
  suppressedFallbackIds = new Set<string>(),
): RuntimeModel[] {
  if (catalogModels.length === 0) return fallback;
  const seen = new Set<string>();
  const merged: RuntimeModel[] = [];
  const fallbackDefaultId = fallback.find((model) => model.default)?.id;
  const fallbackDefaultCanonical = fallbackDefaultId ? canonicalRuntimeModelId(fallbackDefaultId) : "";

  for (const model of [...catalogModels, ...fallback]) {
    const canonical = canonicalRuntimeModelId(model.id);
    if (!canonical || seen.has(canonical)) continue;
    if (suppressedFallbackIds.has(canonical) && !catalogModels.includes(model)) continue;
    seen.add(canonical);
    merged.push({ ...model, default: Boolean(fallbackDefaultCanonical && canonical === fallbackDefaultCanonical) });
  }

  if (!merged.some((model) => model.default) && merged[0]) {
    return [{ ...merged[0], default: true }, ...merged.slice(1)];
  }
  return merged;
}

function catalogRuntimeModels(provider: string, fallback: RuntimeModel[]): RuntimeModel[] {
  const catalogProvider = runtimeCatalogProvider(provider);
  if (!catalogProvider) return fallback;

  try {
    const catalogRows = listAvailableModels({ provider: catalogProvider, includeInactive: true });
    const inactiveCatalogIds = new Set(
      catalogRows
        .filter((model) => !model.isActive)
        .map((model) => canonicalRuntimeModelId(runtimeModelIdForCatalogModel(model))),
    );
    const models = catalogRows
      .filter((model) => model.isActive)
      .map((model): RuntimeModel => ({
        id: runtimeModelIdForCatalogModel(model),
        label: model.displayName,
        provider: runtimeModelProvider(model.runtimeProvider),
      }));
    return mergeCatalogWithFallback(models, fallback, inactiveCatalogIds);
  } catch (error) {
    console.warn("[runtime-models] catalog lookup failed; using static fallback", {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

function parseOpenClawModelCatalog(raw: string): RuntimeModel[] {
  const parsed = JSON.parse(raw) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { models?: unknown }).models)
      ? (parsed as { models: unknown[] }).models
      : [];

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = typeof record.value === "string"
      ? record.value.trim()
      : typeof record.id === "string"
        ? record.id.trim()
        : typeof record.key === "string"
          ? record.key.trim()
          : "";
    if (!id) return [];
    const label = typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : id;
    const provider = typeof record.provider === "string" && record.provider.trim()
      ? record.provider.trim()
      : id.split("/")[0] || undefined;
    const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
    const option: RuntimeModel = {
      id,
      label,
      default: tags.includes("default") || record.default === true,
    };
    if (provider) option.provider = provider;
    return [option];
  });
}

function openClawModels(command: string): RuntimeModel[] {
  for (const args of [
    ["models", "list", "--json"],
    ["models", "list", "--output", "json"],
  ]) {
    try {
      const output = execFileSync(command, args, {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 5 * 1024 * 1024,
      });
      const models = parseOpenClawModelCatalog(output);
      if (models.length > 0) return models;
    } catch {
      // Try the next supported JSON spelling.
    }
  }
  return [];
}

function parseAcpSessionModels(raw: unknown): RuntimeModel[] {
  if (!raw || typeof raw !== "object") return [];
  const modelsBlock = (raw as { models?: unknown }).models;
  if (!modelsBlock || typeof modelsBlock !== "object") return [];
  const currentModelId = typeof (modelsBlock as { currentModelId?: unknown }).currentModelId === "string"
    ? (modelsBlock as { currentModelId: string }).currentModelId
    : "";
  const available = (modelsBlock as { availableModels?: unknown }).availableModels;
  if (!Array.isArray(available)) return [];

  const seen = new Set<string>();
  return available.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = typeof record.modelId === "string" ? record.modelId.trim() : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const label = typeof record.name === "string" && record.name.trim() ? record.name.trim() : id;
    const provider = id.includes(":") ? id.split(":")[0] : id.includes("/") ? id.split("/")[0] : undefined;
    const option: RuntimeModel = { id, label, default: id === currentModelId };
    if (provider) option.provider = provider;
    return [option];
  });
}

function acpModels(command: string, env: NodeJS.ProcessEnv = process.env): RuntimeModel[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hiverunner-runtime-models-"));
  try {
    const input = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: 1,
          clientInfo: { name: "hiverunner-model-discovery", version: "0.1.0" },
          clientCapabilities: {},
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "session/new",
        params: { cwd: tmp, mcpServers: [] },
      }),
      "",
    ].join("\n");

    const result = spawnSync(command, ["acp"], {
      input,
      encoding: "utf8",
      timeout: 15_000,
      env: { ...env, HERMES_YOLO_MODE: "1" },
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) return [];

    for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const envelope = JSON.parse(line) as { id?: unknown; result?: unknown };
        if (String(envelope.id) === "2") {
          return parseAcpSessionModels(envelope.result);
        }
      } catch {
        // Ignore non-JSON logs.
      }
    }
    return [];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function withFallback(models: RuntimeModel[], fallback: RuntimeModel[]): RuntimeModel[] {
  return models.length > 0 ? models : fallback;
}

export function discoverRuntimeModels(input: {
  provider: string;
  command?: string | null;
  commandPath?: string | null;
  env?: NodeJS.ProcessEnv;
}): RuntimeModelsResult {
  const provider = normalizeRuntimeProvider(input.provider);
  const command = commandForProvider(provider, input.command, input.commandPath);
  const cacheKey = `${provider}:${command}`;

  switch (provider) {
    case "anthropic":
      return { models: catalogRuntimeModels(provider, claudeModels()), supported: true };
    case "codex":
      return { models: catalogRuntimeModels(provider, codexModels()), supported: true };
    case "gemini":
      return { models: catalogRuntimeModels(provider, geminiModels()), supported: true };
  }

  return cached(cacheKey, () => {
    switch (provider) {
      case "hermes":
        return { models: withFallback(acpModels(command, input.env), [...claudeModels(), ...codexModels(), ...geminiModels()]), supported: true };
      case "symphony":
        return { models: [], supported: true };
      case "openclaw":
      case "multica":
        return { models: withFallback(openClawModels(command), [...codexModels(), ...claudeModels(), ...geminiModels()]), supported: true };
      default:
        return { models: [], supported: true };
    }
  });
}
