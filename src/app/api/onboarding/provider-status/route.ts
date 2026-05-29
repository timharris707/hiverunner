import { NextResponse } from "next/server";

import { getSecretSource, type SecretSource } from "@/lib/secrets";

export const dynamic = "force-dynamic";

type ProviderConfig = {
  id: "openai" | "google" | "anthropic";
  label: string;
  envVars: string[];
  enables: string[];
  missingImpact: string;
  setupCopy: string;
};

export type OnboardingProviderStatus = ProviderConfig & {
  configured: boolean;
  configuredSecretName: string | null;
  source: SecretSource | null;
};

const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    envVars: ["OPENAI_API_KEY"],
    enables: ["AI-generated avatars", "OpenAI model-source routes"],
    missingImpact: "Bundled starter-pack avatars still work without an OpenAI key.",
    setupCopy: "Add OPENAI_API_KEY to .env.local when you want to generate new avatar portraits.",
  },
  {
    id: "google",
    label: "Gemini / Google AI",
    envVars: ["GOOGLE_AI_API_KEY", "GEMINI_API_KEY"],
    enables: ["Gemini Live voice", "voice previews", "Gemini model-source routes"],
    missingImpact: "Starter agents still keep saved voice choices, but live voice calls stay disabled until configured.",
    setupCopy: "Add GOOGLE_AI_API_KEY to .env.local when you want live voice and Gemini-backed voice previews.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envVars: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    enables: ["Anthropic model-source routes"],
    missingImpact: "HiveRunner still runs with local/manual or other configured runtimes.",
    setupCopy: "Add ANTHROPIC_API_KEY to .env.local when you want direct Anthropic model-source access.",
  },
];

function providerStatus(provider: ProviderConfig): OnboardingProviderStatus {
  for (const envVar of provider.envVars) {
    const source = getSecretSource(envVar);
    if (source) {
      return {
        ...provider,
        configured: true,
        configuredSecretName: envVar,
        source,
      };
    }
  }

  return {
    ...provider,
    configured: false,
    configuredSecretName: null,
    source: null,
  };
}

export async function GET() {
  return NextResponse.json({
    providers: PROVIDERS.map(providerStatus),
  });
}
