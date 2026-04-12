export type CompanyWizardModelOption = {
  value: string;
  label: string;
  provider: string;
};

export const COMPANY_WIZARD_MODEL_FALLBACK: CompanyWizardModelOption[] = [
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic" },
  { value: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic" },
  { value: "openai-codex/gpt-5.4", label: "GPT-5.4", provider: "openai-codex" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", provider: "google" },
];

export const COMPANY_WIZARD_STATIC_MODEL_OPTIONS = COMPANY_WIZARD_MODEL_FALLBACK.map(({ value, label }) => ({
  value,
  label,
}));

export function createInitialCompanyWizardData() {
  return {
    company: { name: "", description: "", slug: "" },
    project: null,
    ceo: { name: "", model: "anthropic/claude-sonnet-4-6", guidance: "" },
    task: {
      title: "Hire your first engineer and set up the company for execution",
      description:
        "You are the founding CEO. Get this company operational:\n1. Hire one engineer agent to be your first teammate.\n2. Create your first project to organize the work.\n3. Break the company mission into 2-3 concrete tasks and assign them.\n4. Write a short operating plan to memory.\nDo not just plan — take real actions: hire, create, assign, delegate.",
      priority: "P1",
    },
  };
}
