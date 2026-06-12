"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getProviderRuntimeControls,
  readProviderRuntimeSelection,
  type ProviderRuntimeSelection,
} from "@/lib/orchestration/provider-runtime-controls";

type RuntimeModelRecord = {
  id?: string;
  value?: string;
  label?: string;
  provider?: string;
  default?: boolean;
};

export type RuntimeModelOption = {
  id: string;
  label: string;
  provider?: string;
  default?: boolean;
};

type RuntimeModelSelectionState = {
  models: RuntimeModelOption[];
  loading: boolean;
  error: string | null;
  defaultModel: RuntimeModelOption | null;
  selectedModel: RuntimeModelOption | null;
  effectiveModelId: string;
  runtimeControls: ReturnType<typeof getProviderRuntimeControls>;
  runtimeSelection: ProviderRuntimeSelection;
};

const EMPTY_RUNTIME_MODELS: RuntimeModelOption[] = [];

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRuntimeSelectionProvider(provider: string | null | undefined): string {
  const normalized = provider?.trim().toLowerCase() ?? "";
  if (normalized === "openai" || normalized === "openai-codex") return "codex";
  if (normalized === "claude" || normalized === "claude-code") return "anthropic";
  if (normalized === "google" || normalized === "gemini-cli") return "gemini";
  return normalized;
}

export function runtimeModelTechnicalId(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.includes("/")) return normalized.split("/").slice(1).join("/") || normalized;
  if (normalized.includes(":")) return normalized.split(":").slice(1).join(":") || normalized;
  return normalized;
}

function runtimeModelSortValue(model: RuntimeModelOption): number {
  const value = model.id.toLowerCase();
  if (model.default) return -1;
  if (value.includes("gpt-5.5")) return 0;
  if (value.includes("gpt-5.4-mini")) return 2;
  if (value.includes("gpt-5.4")) return 1;
  if (value.includes("gpt-5.3-codex-spark")) return 4;
  if (value.includes("gpt-5.3-codex")) return 3;
  if (value.includes("gpt-5.2")) return 5;
  if (value.includes("claude-opus-4-8")) return 9;
  if (value.includes("claude-sonnet-4-6")) return 10;
  if (value.includes("claude-opus-4-7")) return 11;
  if (value.includes("claude-haiku-4-5")) return 12;
  if (value.includes("claude-opus-4-6")) return 13;
  if (value.includes("claude-sonnet-4-5")) return 14;
  if (value.includes("gemini-3.5-flash")) return 20;
  if (value.includes("gemini-3.1-pro")) return 21;
  if (value.includes("gemini-3-pro")) return 22;
  if (value.includes("gemini-3-flash")) return 23;
  if (value.includes("gemini-2.5-pro")) return 24;
  if (value.includes("gemini-2.5-flash")) return 25;
  return 100;
}

function buildRuntimeModelOptions(models: RuntimeModelRecord[]): RuntimeModelOption[] {
  const parsed: RuntimeModelOption[] = [];
  const seen = new Set<string>();

  for (const model of models) {
    // Option ids are normalized to the bare technical id (claude-fable-5),
    // never the catalog's composite form (anthropic/claude-fable-5): agents
    // store and runners spawn with the bare id, and raw-equality matching
    // against composite ids made the picker snap to the provider default and
    // misreport the agent's real model (Oracle/Fable shown as Sonnet).
    const id = runtimeModelTechnicalId(stringValue(model.id) || stringValue(model.value));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const provider = stringValue(model.provider);
    const option: RuntimeModelOption = {
      id,
      label: stringValue(model.label) || id,
      default: Boolean(model.default),
    };
    if (provider) option.provider = provider;
    parsed.push(option);
  }

  return parsed.sort((a, b) => {
    const priority = runtimeModelSortValue(a) - runtimeModelSortValue(b);
    if (priority !== 0) return priority;
    return a.label.localeCompare(b.label);
  });
}

function defaultRuntimeModel(models: RuntimeModelOption[]): RuntimeModelOption | null {
  return models.find((model) => model.default) ?? models[0] ?? null;
}

function resolveRuntimeModelId(models: RuntimeModelOption[], currentModel: string): string {
  const technical = runtimeModelTechnicalId(currentModel);
  if (technical) {
    const match = models.find(
      (model) => model.id === currentModel || runtimeModelTechnicalId(model.id) === technical,
    );
    if (match) return match.id;
  }
  return defaultRuntimeModel(models)?.id ?? "";
}

export function runtimeModelDisplayLabel(model: RuntimeModelOption | null, fallbackModel = ""): string {
  if (model?.label) return model.label;
  return runtimeModelTechnicalId(fallbackModel) || "Provider default";
}

export function useRuntimeModelSelection({
  provider,
  model,
  runtimeConfig,
  command,
  commandPath,
  enabled = true,
  autoSelectDefault = false,
  onModelChange,
}: {
  provider: string | null | undefined;
  model: string;
  runtimeConfig?: Record<string, unknown>;
  command?: string | null;
  commandPath?: string | null;
  enabled?: boolean;
  autoSelectDefault?: boolean;
  onModelChange?: (model: string) => void;
}): RuntimeModelSelectionState {
  const normalizedProvider = normalizeRuntimeSelectionProvider(provider);
  const [models, setModels] = useState<RuntimeModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !normalizedProvider) {
      return;
    }

    let cancelled = false;
    const params = new URLSearchParams({ provider: normalizedProvider });
    if (command?.trim()) params.set("command", command.trim());
    if (commandPath?.trim()) params.set("commandPath", commandPath.trim());

    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/orchestration/runtime-models?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`${response.status}`);
        const payload = await response.json() as { models?: RuntimeModelRecord[] };
        if (cancelled) return;
        const nextModels = buildRuntimeModelOptions(Array.isArray(payload.models) ? payload.models : []);
        setModels(nextModels);
        if (autoSelectDefault && onModelChange) {
          const nextModel = resolveRuntimeModelId(nextModels, model);
          if (nextModel && nextModel !== model) onModelChange(nextModel);
        }
      } catch (loadError) {
        if (cancelled) return;
        setModels([]);
        setError(loadError instanceof Error ? loadError.message : "model_discovery_failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    autoSelectDefault,
    command,
    commandPath,
    enabled,
    model,
    normalizedProvider,
    onModelChange,
  ]);

  const active = enabled && Boolean(normalizedProvider);
  const visibleModels = useMemo(() => active ? models : EMPTY_RUNTIME_MODELS, [active, models]);
  const visibleLoading = active ? loading : false;
  const visibleError = active ? error : null;
  const defaultModel = useMemo(() => defaultRuntimeModel(visibleModels), [visibleModels]);
  const selectedModel = useMemo(() => {
    const technical = runtimeModelTechnicalId(model);
    if (!technical) return null;
    return (
      visibleModels.find(
        (option) => option.id === model || runtimeModelTechnicalId(option.id) === technical,
      ) ?? null
    );
  }, [model, visibleModels]);
  const effectiveModelId = model || defaultModel?.id || "";
  const runtimeControls = getProviderRuntimeControls(normalizedProvider, effectiveModelId);
  const runtimeSelection = readProviderRuntimeSelection(
    normalizedProvider,
    runtimeConfig ?? {},
    effectiveModelId,
  );

  return {
    models: visibleModels,
    loading: visibleLoading,
    error: visibleError,
    defaultModel,
    selectedModel,
    effectiveModelId,
    runtimeControls,
    runtimeSelection,
  };
}
