import type { AvailableModel, AvailableModelProvider } from "@/lib/orchestration/available-models";
import type { RouteTarget, RouteTargetMode } from "@/lib/orchestration/execution-hives";

export type ModelRouteChoice = "auto" | "direct" | "openrouter";

export const MODEL_ROUTE_LABELS: Record<ModelRouteChoice, string> = {
  auto: "Auto",
  direct: "Direct API",
  openrouter: "Via OpenRouter",
};

export const OPENROUTER_SUPPORTED_MODEL_PROVIDERS: AvailableModelProvider[] = [
  "anthropic",
  "openai",
  "google",
];

const GENERIC_ROUTE_MODEL_LABELS = new Set([
  "anthropic direct",
  "broker managed",
  "cheap capable fallback",
  "deep profile",
  "deep reasoning profile",
  "direct managed",
  "gemini vision-capable model",
  "hive managed",
  "local capable model",
  "mini/fast model",
  "openai direct",
  "platform managed",
  "profile managed",
  "runtime managed",
  "vision-capable model",
]);

export function isOpenRouterSupportedProvider(provider: AvailableModelProvider): boolean {
  return OPENROUTER_SUPPORTED_MODEL_PROVIDERS.includes(provider);
}

export function normalizeRouteModelForRunner(routeTargetModel: string | null | undefined): string | null {
  const normalized = String(routeTargetModel ?? "").trim();
  if (!normalized) return null;

  // Lane presets historically stored display labels in modelLabel. Those are audit/UI
  // hints, not runnable model IDs, so runner handoff must defer to the runtime default.
  if (GENERIC_ROUTE_MODEL_LABELS.has(normalized.toLowerCase())) return null;
  return normalized;
}

function runtimeIdForModel(model: AvailableModel): string {
  switch (model.runtimeProvider) {
    case "openai":
      return "codex";
    case "google":
      return "gemini-cli";
    case "anthropic":
      return "anthropic";
    case "openrouter":
      return "openrouter";
    case "hermes":
    case "openclaw":
      return model.runtimeProvider;
  }
}

export function routeModeForChoice(choice: ModelRouteChoice): RouteTargetMode {
  if (choice === "direct") return "direct_source";
  if (choice === "openrouter") return "broker";
  return "runtime_managed";
}

export function routeTargetForModelChoice(model: AvailableModel, choice: ModelRouteChoice): RouteTarget {
  if (choice === "openrouter") {
    return {
      mode: "broker",
      runtimeId: "openrouter",
      runtimeLabel: "OpenRouter",
      modelSourceId: "openrouter",
      modelSourceLabel: "OpenRouter",
      modelId: model.id,
      modelLabel: model.displayName,
    };
  }

  const mode = routeModeForChoice(choice);
  return {
    mode,
    runtimeId: runtimeIdForModel(model),
    runtimeLabel: model.defaultRuntimeLabel,
    modelSourceId: model.modelSourceId,
    modelSourceLabel: model.modelSourceId,
    modelId: model.id,
    modelLabel: model.displayName,
  };
}

export function routeChoiceFromTarget(target: RouteTarget): ModelRouteChoice {
  if (target.mode === "broker" || target.modelSourceId === "openrouter") return "openrouter";
  if (target.mode === "direct_source") return "direct";
  return "auto";
}
