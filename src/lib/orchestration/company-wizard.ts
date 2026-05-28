import {
  buildStarterTeamSetupPayload,
} from "@/lib/orchestration/starter-team-templates";

export type CompanyWizardModelOption = {
  value: string;
  label: string;
  provider: string;
};

export const COMPANY_WIZARD_MODEL_FALLBACK: CompanyWizardModelOption[] = [
  { value: "openai-codex/gpt-5.5", label: "Powerful - Recommended", provider: "openai-codex" },
  { value: "openai-codex/gpt-5.4", label: "Balanced", provider: "openai-codex" },
  { value: "openai-codex/gpt-5.3-codex", label: "Coding Specialist", provider: "openai-codex" },
  { value: "anthropic/claude-sonnet-4-6", label: "Implementation Balanced", provider: "anthropic" },
  { value: "anthropic/claude-opus-4-6", label: "Deep Reasoning", provider: "anthropic" },
  { value: "anthropic/claude-haiku-4-5", label: "Fast", provider: "anthropic" },
  { value: "google/gemini-3-pro-preview", label: "Multimodal Pro", provider: "google" },
  { value: "google/gemini-3.1-pro-preview", label: "Large Context", provider: "google" },
  { value: "google/gemini-3-flash-preview", label: "Fast Multimodal", provider: "google" },
  { value: "google/gemini-2.5-pro", label: "Reliable Pro", provider: "google" },
  { value: "google/gemini-2.5-flash", label: "Quick Response", provider: "google" },
];

export const COMPANY_WIZARD_STATIC_MODEL_OPTIONS = COMPANY_WIZARD_MODEL_FALLBACK.map(({ value, label }) => ({
  value,
  label,
}));

export function createInitialCompanyWizardData() {
  const starterTeam = buildStarterTeamSetupPayload("software-product");
  return {
    company: { name: "", description: "", slug: "" },
    owner: { displayName: "", email: "" },
    project: null,
    starterTeam: starterTeam.starterTeam,
    ceo: { name: "", model: "openai-codex/gpt-5.5", guidance: "" },
    goal: starterTeam.kickoffGoal,
    task: starterTeam.kickoffGoal,
  };
}
