import {
  buildStarterTeamSetupPayload,
} from "@/lib/orchestration/starter-team-templates";

export type CompanyWizardModelOption = {
  value: string;
  label: string;
  provider: string;
};

export const COMPANY_WIZARD_MODEL_FALLBACK: CompanyWizardModelOption[] = [
  // "Recommended" is appended dynamically in the wizard from the servability
  // probe (lead-model-default.ts) — keep these labels static and neutral.
  { value: "anthropic/claude-fable-5", label: "Frontier Orchestrator", provider: "anthropic" },
  { value: "openai-codex/gpt-5.5", label: "Powerful", provider: "openai-codex" },
  { value: "openai-codex/gpt-5.4", label: "Balanced", provider: "openai-codex" },
  { value: "openai-codex/gpt-5.3-codex", label: "Coding Specialist", provider: "openai-codex" },
  { value: "anthropic/claude-sonnet-4-6", label: "Implementation Balanced", provider: "anthropic" },
  { value: "anthropic/claude-opus-4-8", label: "Deep Reasoning", provider: "anthropic" },
  { value: "anthropic/claude-haiku-4-5", label: "Fast", provider: "anthropic" },
  { value: "google/gemini-3-pro-preview", label: "Multimodal Pro", provider: "google" },
  { value: "google/gemini-3.1-pro-preview", label: "Large Context", provider: "google" },
  { value: "google/gemini-3.5-flash", label: "Latest Fast", provider: "google" },
  { value: "google/gemini-3-flash-preview", label: "Fast Multimodal", provider: "google" },
  { value: "google/gemini-2.5-pro", label: "Reliable Pro", provider: "google" },
  { value: "google/gemini-2.5-flash", label: "Quick Response", provider: "google" },
];

export const COMPANY_WIZARD_STATIC_MODEL_OPTIONS = COMPANY_WIZARD_MODEL_FALLBACK.map(({ value, label }) => ({
  value,
  label,
}));

/**
 * Client-safe mirror of the lead-model recommendation served by
 * /api/orchestration/models. The probe itself lives in lead-model-default.ts,
 * which spawns the subscription CLI and must never be imported by client
 * components — wizard surfaces consume the recommendation through this parser.
 */
export type LeadModelDefaultInfo = {
  model: string;
  source: "verified" | "fallback_anthropic" | "fallback_provider";
  note: string;
};

export function parseLeadModelDefault(value: unknown): LeadModelDefaultInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.model !== "string" || !record.model.trim()) return null;
  const source = record.source === "verified" || record.source === "fallback_anthropic" || record.source === "fallback_provider"
    ? record.source
    : "fallback_provider";
  return {
    model: record.model,
    source,
    note: typeof record.note === "string" ? record.note : "",
  };
}

export const COMPANY_LEAD_TITLE_PRESETS = ["CEO", "Team Lead"] as const;

export function createInitialCompanyWizardData() {
  const starterTeam = buildStarterTeamSetupPayload("software-product");
  return {
    company: { name: "", description: "", slug: "" },
    owner: { displayName: "", email: "" },
    project: null,
    starterTeam: starterTeam.starterTeam,
    ceo: { name: "", title: "CEO", model: "openai-codex/gpt-5.5", guidance: "" },
    task: starterTeam.kickoffTask,
  };
}
