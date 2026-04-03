export type AIProvider = "anthropic" | "openai" | "google";

export interface ProviderModel {
  id: string;
  name: string;
  provider: AIProvider;
  model: string;
  costTier: "low" | "medium" | "high";
  default?: boolean;
  openclawModel?: string;
}

export const PROVIDERS: ProviderModel[] = [
  {
    id: "claude-sonnet",
    name: "Claude Sonnet",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    costTier: "medium",
    default: true,
    openclawModel: "anthropic/claude-sonnet-4-5",
  },
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "openai",
    model: "gpt-4o",
    costTier: "medium",
    openclawModel: "openai/gpt-4o",
  },
  {
    id: "gemini-flash",
    name: "Gemini Flash",
    provider: "google",
    model: "gemini-2.0-flash-001",
    costTier: "low",
    openclawModel: "google/gemini-2.0-flash-001",
  },
];

export function getDefaultProviderModel(): ProviderModel {
  const fallback = PROVIDERS[0];
  return PROVIDERS.find((m) => m.default) ?? fallback;
}

export function getProviderModelById(modelId?: string): ProviderModel {
  if (!modelId) return getDefaultProviderModel();
  return PROVIDERS.find((m) => m.id === modelId) ?? getDefaultProviderModel();
}

export function resolveProviderModelId(modelId?: string): string {
  return getProviderModelById(modelId).id;
}

export function resolveOpenClawModel(modelId?: string): string {
  if (modelId && modelId.includes("/")) return modelId;
  const directMatch = modelId ? PROVIDERS.find((m) => m.id === modelId) : undefined;
  if (directMatch) {
    return directMatch.openclawModel ?? `${directMatch.provider}/${directMatch.model}`;
  }
  if (modelId?.startsWith("gpt-")) return `openai/${modelId}`;
  if (modelId?.startsWith("claude-")) return `anthropic/${modelId}`;
  if (modelId?.startsWith("gemini-")) return `google/${modelId}`;
  const config = getProviderModelById(modelId);
  return config.openclawModel ?? `${config.provider}/${config.model}`;
}
