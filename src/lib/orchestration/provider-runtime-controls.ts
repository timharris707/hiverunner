export type RuntimeControlProvider = "codex" | "anthropic" | "gemini";

export type RuntimeReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type RuntimeSpeedMode = "standard" | "fast";

export interface RuntimeReasoningOption {
  value: RuntimeReasoningLevel;
  label: string;
}

export interface RuntimeSpeedOption {
  value: RuntimeSpeedMode;
  label: string;
  available: boolean;
  unavailableReason?: string;
}

export interface ProviderRuntimeControls {
  provider: RuntimeControlProvider;
  label: string;
  reasoning: {
    available: boolean;
    options: RuntimeReasoningOption[];
    defaultValue?: RuntimeReasoningLevel;
    unavailableReason?: string;
  };
  speed: {
    available: boolean;
    options: RuntimeSpeedOption[];
    unavailableReason?: string;
  };
}

export interface ProviderRuntimeSelection {
  reasoningEffort: RuntimeReasoningLevel | null;
  speedMode: RuntimeSpeedMode | null;
}

const REASONING_LABELS: Record<RuntimeReasoningLevel, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

const CODEX_REASONING: RuntimeReasoningOption[] = (["low", "medium", "high", "xhigh"] as RuntimeReasoningLevel[]).map((value) => ({
  value,
  label: REASONING_LABELS[value],
}));

const ANTHROPIC_REASONING: RuntimeReasoningOption[] = (["low", "medium", "high", "xhigh", "max"] as RuntimeReasoningLevel[]).map((value) => ({
  value,
  label: REASONING_LABELS[value],
}));

const GEMINI_FLASH_THINKING_LEVELS: RuntimeReasoningOption[] = (["minimal", "low", "medium", "high"] as RuntimeReasoningLevel[]).map((value) => ({
  value,
  label: REASONING_LABELS[value],
}));

const GEMINI_PRO_THINKING_LEVELS: RuntimeReasoningOption[] = (["low", "high"] as RuntimeReasoningLevel[]).map((value) => ({
  value,
  label: REASONING_LABELS[value],
}));

const GEMINI_3_1_PRO_THINKING_LEVELS: RuntimeReasoningOption[] = (["low", "medium", "high"] as RuntimeReasoningLevel[]).map((value) => ({
  value,
  label: REASONING_LABELS[value],
}));

export function normalizeRuntimeControlProvider(provider: string | null | undefined): RuntimeControlProvider | null {
  const normalized = provider?.trim().toLowerCase();
  if (normalized === "openai-codex") return "codex";
  if (normalized === "claude" || normalized === "claude-code") return "anthropic";
  if (normalized === "google") return "gemini";
  if (normalized === "codex" || normalized === "anthropic" || normalized === "gemini") return normalized;
  return null;
}

export function runtimeReasoningLabel(value: RuntimeReasoningLevel | string | null | undefined): string {
  return REASONING_LABELS[value as RuntimeReasoningLevel] ?? "Unavailable";
}

export function runtimeSpeedLabel(value: RuntimeSpeedMode | string | null | undefined): string {
  if (value === "fast") return "Fast";
  if (value === "standard") return "Standard";
  return "Unavailable";
}

export function supportsCodexFastMode(model: string | null | undefined): boolean {
  const normalized = model?.trim().toLowerCase().replace(/^openai-codex\//, "") ?? "";
  return normalized === "gpt-5.5" || normalized === "gpt-5.4";
}

export function supportsGeminiThinkingLevel(model: string | null | undefined): boolean {
  const normalized = model
    ?.trim()
    .toLowerCase()
    .replace(/^google\//, "")
    .replace(/^models\//, "") ?? "";
  return normalized.startsWith("gemini-3");
}

function geminiThinkingOptions(model: string | null | undefined): RuntimeReasoningOption[] {
  if (!supportsGeminiThinkingLevel(model)) return [];
  const normalized = model
    ?.trim()
    .toLowerCase()
    .replace(/^google\//, "")
    .replace(/^models\//, "") ?? "";
  if (normalized.includes("gemini-3.1-pro")) return GEMINI_3_1_PRO_THINKING_LEVELS;
  return normalized.includes("flash") ? GEMINI_FLASH_THINKING_LEVELS : GEMINI_PRO_THINKING_LEVELS;
}

export function getProviderRuntimeControls(
  providerInput: string | null | undefined,
  model?: string | null,
): ProviderRuntimeControls | null {
  const provider = normalizeRuntimeControlProvider(providerInput);
  if (!provider) return null;

  if (provider === "codex") {
    const fastAvailable = supportsCodexFastMode(model);
    return {
      provider,
      label: "Codex",
      reasoning: {
        available: true,
        options: CODEX_REASONING,
        defaultValue: "xhigh",
      },
      speed: {
        available: fastAvailable,
        unavailableReason: fastAvailable ? undefined : "Fast mode is verified for GPT-5.5 and GPT-5.4.",
        options: [
          { value: "standard", label: "Standard", available: true },
          {
            value: "fast",
            label: "Fast",
            available: fastAvailable,
            unavailableReason: fastAvailable ? undefined : "Fast mode is verified for GPT-5.5 and GPT-5.4.",
          },
        ],
      },
    };
  }

  if (provider === "anthropic") {
    return {
      provider,
      label: "Claude Code",
      reasoning: {
        available: true,
        options: ANTHROPIC_REASONING,
        defaultValue: "xhigh",
      },
      speed: {
        available: false,
        unavailableReason: "No verified Claude Code speed flag is wired for agent execution yet.",
        options: [
          { value: "standard", label: "Standard", available: true },
          {
            value: "fast",
            label: "Fast",
            available: false,
            unavailableReason: "No verified Claude Code speed flag is wired for agent execution yet.",
          },
        ],
      },
    };
  }

  const thinkingLevelAvailable = supportsGeminiThinkingLevel(model);
  const thinkingOptions = geminiThinkingOptions(model);
  return {
    provider,
    label: "Gemini",
    reasoning: {
      available: thinkingLevelAvailable,
      options: thinkingOptions,
      defaultValue: "high",
      unavailableReason: thinkingLevelAvailable
        ? undefined
        : "Gemini 2.5 models use thinking budgets; HiveRunner currently exposes thinking levels for Gemini 3 models.",
    },
    speed: {
      available: false,
      options: [
        { value: "standard", label: "Standard", available: true },
        {
          value: "fast",
          label: "Fast",
          available: false,
          unavailableReason: "Use Gemini model tiers such as Flash or Pro for speed/intelligence tradeoffs.",
        },
      ],
      unavailableReason: "Use Gemini model tiers such as Flash or Pro for speed/intelligence tradeoffs.",
    },
  };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeReasoningForControls(
  controls: ProviderRuntimeControls,
  value: string | null,
): RuntimeReasoningLevel | null {
  if (!controls.reasoning.available) return null;
  const match = controls.reasoning.options.find((option) => option.value === value);
  return match?.value
    ?? controls.reasoning.defaultValue
    ?? controls.reasoning.options.find((option) => option.value === "xhigh")?.value
    ?? controls.reasoning.options[0]?.value
    ?? null;
}

export function readProviderRuntimeSelection(
  providerInput: string | null | undefined,
  runtimeConfig: Record<string, unknown>,
  model?: string | null,
): ProviderRuntimeSelection {
  const controls = getProviderRuntimeControls(providerInput, model);
  if (!controls) return { reasoningEffort: null, speedMode: null };

  const reasoning = normalizeReasoningForControls(
    controls,
    firstString(runtimeConfig, ["reasoningEffort", "modelReasoningEffort", "thinkingLevel"]),
  );
  const fastMode = runtimeConfig.fastMode === true;
  const speedPreference = firstString(runtimeConfig, ["speedPreference", "speed", "thinkingSpeed"]);
  const requestedFast = fastMode || speedPreference === "fast" || speedPreference === "fast_1_5x";
  const fastAvailable = controls.speed.options.some((option) => option.value === "fast" && option.available);

  return {
    reasoningEffort: reasoning,
    speedMode: controls.speed.available ? (requestedFast && fastAvailable ? "fast" : "standard") : null,
  };
}

export function buildProviderRuntimeConfigPatch(
  providerInput: string | null | undefined,
  selection: Partial<ProviderRuntimeSelection>,
): Record<string, unknown> {
  const provider = normalizeRuntimeControlProvider(providerInput);
  if (!provider) return {};

  const patch: Record<string, unknown> = {};
  if (selection.reasoningEffort) {
    patch.reasoningEffort = selection.reasoningEffort;
    patch.modelReasoningEffort = selection.reasoningEffort;
    patch.thinkingLevel = selection.reasoningEffort;
  }
  if (selection.speedMode) {
    const fast = selection.speedMode === "fast";
    patch.fastMode = fast;
    patch.speedPreference = fast ? "fast" : "standard";
    if (provider === "codex") {
      patch.serviceTier = fast ? "fast" : "default";
    }
  }
  return patch;
}
