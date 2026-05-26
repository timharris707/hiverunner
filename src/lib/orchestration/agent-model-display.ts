import type { TaskExecutionEngine } from "@/lib/orchestration/types";

export type ModelProviderFamily = "anthropic" | "codex" | "gemini" | "openai" | "manual" | "runtime";

export interface AgentModelDisplay {
  provider: ModelProviderFamily;
  providerLabel: string;
  model: string;
  displayModel: string;
  label: string;
  color: string;
  background: string;
  border: string;
}

function clean(value?: string | null): string {
  return value?.trim() ?? "";
}

export function inferModelProviderFamily(input: {
  provider?: string | null;
  model?: string | null;
  executionEngine?: TaskExecutionEngine | string | null;
}): ModelProviderFamily {
  const provider = clean(input.provider).toLowerCase();
  const model = clean(input.model).toLowerCase();
  if (input.executionEngine === "manual" || provider === "manual") return "manual";
  const [modelProviderPrefix, modelFamily = model] = model.split("/", 2);
  if (["openai-codex", "codex"].includes(modelProviderPrefix)) return "codex";
  if (modelProviderPrefix === "anthropic") return "anthropic";
  if (modelProviderPrefix === "openai") return "openai";
  if (["gemini", "google"].includes(modelProviderPrefix)) return "gemini";
  if (modelFamily.includes("gemini") || modelFamily.includes("google")) return "gemini";
  if (modelFamily.includes("claude") || modelFamily.includes("anthropic")) return "anthropic";
  if (modelFamily.includes("codex")) return "codex";
  if (modelFamily.startsWith("gpt-") || modelFamily.includes("openai")) return "openai";
  if (provider.includes("gemini") || provider.includes("google")) return "gemini";
  if (provider.includes("anthropic") || provider.includes("claude")) return "anthropic";
  if (provider.includes("codex")) return "codex";
  if (provider.includes("openai")) return "openai";
  return "runtime";
}

export function modelProviderLabel(provider: ModelProviderFamily): string {
  switch (provider) {
    case "anthropic": return "Anthropic";
    case "codex": return "Codex";
    case "gemini": return "Gemini";
    case "openai": return "OpenAI";
    case "manual": return "Manual";
    default: return "Runtime";
  }
}

export function modelProviderColors(provider: ModelProviderFamily): Pick<AgentModelDisplay, "color" | "background" | "border"> {
  switch (provider) {
    case "anthropic":
      return { color: "#f59e0b", background: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.36)" };
    case "codex":
    case "openai":
      return { color: "#22c55e", background: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.34)" };
    case "gemini":
      return { color: "#60a5fa", background: "rgba(96,165,250,0.13)", border: "rgba(96,165,250,0.36)" };
    case "manual":
      return { color: "#a3a3a3", background: "rgba(163,163,163,0.12)", border: "rgba(163,163,163,0.3)" };
    default:
      return { color: "#c4b5fd", background: "rgba(196,181,253,0.12)", border: "rgba(196,181,253,0.32)" };
  }
}

export function resolveAgentModelDisplay(input: {
  provider?: string | null;
  model?: string | null;
  executionEngine?: TaskExecutionEngine | string | null;
}): AgentModelDisplay | null {
  const model = clean(input.model);
  if (!model && input.executionEngine !== "manual") return null;
  const provider = inferModelProviderFamily(input);
  const providerLabel = modelProviderLabel(provider);
  const displayModel = model || "Manual";
  const colors = modelProviderColors(provider);
  return {
    provider,
    providerLabel,
    model: displayModel,
    displayModel: compactAgentModelLabel(displayModel),
    label: `${providerLabel} · ${displayModel}`,
    ...colors,
  };
}

export function resolveLiveRunnerModelDisplay(input: {
  provider?: string | null;
  model?: string | null;
  executionEngine?: TaskExecutionEngine | string | null;
}): (AgentModelDisplay & { source: "runner" }) | null {
  const display = resolveAgentModelDisplay(input);
  if (!display) return null;
  const compact = display.displayModel || compactAgentModelLabel(display.model);
  return {
    ...display,
    displayModel: `Runner: ${compact}`,
    label: `Runner: ${display.providerLabel} · ${display.model}`,
    source: "runner",
  };
}

export function compactAgentModelLabel(model: string): string {
  const normalized = model
    .replace(/^openai-codex\//i, "")
    .replace(/^anthropic\//i, "")
    .replace(/^openai\//i, "")
    .replace(/^google\/gemini[-/\s]?/i, "gemini-")
    .replace(/^google\//i, "")
    .replace(/^gemini\//i, "")
    .replace(/^models\//i, "")
    .trim();

  const gemini = normalized.match(/^gemini[-\s]+(\d+(?:\.\d+)?)[-\s]+([a-z]+)(?:[-\s]+[a-z0-9]+)*(?:[-\s]+(?:preview|latest))?$/i);
  if (gemini) {
    return `G${gemini[1]} ${capitalizeModelWord(gemini[2])}`;
  }

  return normalized
    .replace(/^claude-/i, "")
    .replace(/^gpt-/i, "GPT-")
    .replace(/\bsonnet-(\d+)-(\d+)\b/i, "Sonnet $1.$2")
    .replace(/\bhaiku-(\d+)-(\d+)\b/i, "Haiku $1.$2")
    .replace(/\bopus-(\d+)-(\d+)\b/i, "Opus $1.$2");
}

function capitalizeModelWord(value: string): string {
  const lower = value.toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
}
