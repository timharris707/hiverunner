export type AvailableModelProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "hermes"
  | "openclaw"
  | "openrouter";

export type AvailableModelCapability = "text" | "vision" | "tools" | "structured-output";

export interface AvailableModel {
  id: string;
  displayName: string;
  runtimeProvider: AvailableModelProvider;
  defaultRuntimeLabel: string;
  modelSourceId: string;
  capabilities: AvailableModelCapability[];
  contextWindow: number | null;
  description: string | null;
  isSeed: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableModelRefreshStatus {
  provider: AvailableModelProvider;
  status: "refreshed" | "fallback" | "skipped" | "failed";
  refreshedAt: string;
  modelCount: number;
  message: string | null;
}

export const AVAILABLE_MODEL_PROVIDERS: AvailableModelProvider[] = [
  "anthropic",
  "openai",
  "google",
  "hermes",
  "openclaw",
  "openrouter",
];

export const AVAILABLE_MODEL_CAPABILITIES: AvailableModelCapability[] = [
  "text",
  "vision",
  "tools",
  "structured-output",
];

export const SEEDED_AVAILABLE_MODELS: Array<Omit<AvailableModel, "createdAt" | "updatedAt">> = [
  {
    id: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    runtimeProvider: "anthropic",
    defaultRuntimeLabel: "Claude Code",
    modelSourceId: "anthropic",
    capabilities: ["text", "vision", "tools", "structured-output"],
    contextWindow: null,
    description: "Balanced Anthropic model for implementation, review, and product reasoning.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    runtimeProvider: "anthropic",
    defaultRuntimeLabel: "Claude Code",
    modelSourceId: "anthropic",
    capabilities: ["text", "vision", "tools", "structured-output"],
    contextWindow: null,
    description: "Deep Anthropic model for architecture, hard debugging, and high-stakes review.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    runtimeProvider: "anthropic",
    defaultRuntimeLabel: "Claude Code",
    modelSourceId: "anthropic",
    capabilities: ["text", "tools"],
    contextWindow: null,
    description: "Fast Anthropic model for low-risk summaries, triage, and short edits.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "gpt-5",
    displayName: "GPT-5",
    runtimeProvider: "openai",
    defaultRuntimeLabel: "Codex",
    modelSourceId: "openai",
    capabilities: ["text", "vision", "tools", "structured-output"],
    contextWindow: null,
    description: "General OpenAI model for coding, analysis, and tool-rich execution.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "gpt-5-mini",
    displayName: "GPT-5 Mini",
    runtimeProvider: "openai",
    defaultRuntimeLabel: "Codex",
    modelSourceId: "openai",
    capabilities: ["text", "tools", "structured-output"],
    contextWindow: null,
    description: "Fast OpenAI model for lightweight coding and operational tasks.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "gpt-4o",
    displayName: "GPT-4o",
    runtimeProvider: "openai",
    defaultRuntimeLabel: "Codex",
    modelSourceId: "openai",
    capabilities: ["text", "vision", "tools", "structured-output"],
    contextWindow: null,
    description: "Multimodal OpenAI model for vision-heavy review and general work.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "gpt-4o-mini",
    displayName: "GPT-4o Mini",
    runtimeProvider: "openai",
    defaultRuntimeLabel: "Codex",
    modelSourceId: "openai",
    capabilities: ["text", "vision", "tools"],
    contextWindow: null,
    description: "Low-latency OpenAI model for small multimodal and text tasks.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    runtimeProvider: "google",
    defaultRuntimeLabel: "Gemini CLI",
    modelSourceId: "google",
    capabilities: ["text", "vision", "tools", "structured-output"],
    contextWindow: null,
    description: "Google model for long-context, multimodal, and implementation work.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    runtimeProvider: "google",
    defaultRuntimeLabel: "Gemini CLI",
    modelSourceId: "google",
    capabilities: ["text", "vision", "tools"],
    contextWindow: null,
    description: "Fast Google model for low-latency tasks and broad context checks.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "hermes-runtime-managed",
    displayName: "Hermes Runtime Managed",
    runtimeProvider: "hermes",
    defaultRuntimeLabel: "Hermes",
    modelSourceId: "hermes",
    capabilities: ["text", "tools"],
    contextWindow: null,
    description: "Hermes-managed in-house profile selected by the runtime.",
    isSeed: true,
    isActive: true,
  },
  {
    id: "openclaw-runtime-managed",
    displayName: "OpenClaw Runtime Managed",
    runtimeProvider: "openclaw",
    defaultRuntimeLabel: "OpenClaw",
    modelSourceId: "openclaw",
    capabilities: ["text", "tools"],
    contextWindow: null,
    description: "OpenClaw-managed local or workspace model selected by the runtime.",
    isSeed: true,
    isActive: true,
  },
];
