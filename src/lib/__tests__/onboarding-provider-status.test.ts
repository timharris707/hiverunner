import assert from "node:assert/strict";

import { GET } from "@/app/api/onboarding/provider-status/route";
import {
  resetSecretStoreForTests,
  setSecretStoreForTests,
  type SecretStoreAdapter,
} from "@/lib/secrets";

const store: SecretStoreAdapter = {
  id: "local-dev",
  get(secretName: string) {
    return secretName === "GOOGLE_AI_API_KEY" ? "test-google-key" : null;
  },
  source(secretName: string) {
    return secretName === "GOOGLE_AI_API_KEY" ? "environment" : null;
  },
  set() {
    throw new Error("provider status should not write secrets");
  },
  clearCache() {},
};

async function run() {
  try {
    setSecretStoreForTests(store);
    const response = await GET();
    const payload = (await response.json()) as {
      providers: Array<{
        id: string;
        configured: boolean;
        configuredSecretName: string | null;
        source: string | null;
        envVars: string[];
        missingImpact: string;
      }>;
    };

    const google = payload.providers.find((provider) => provider.id === "google");
    const openai = payload.providers.find((provider) => provider.id === "openai");

    assert.ok(google, "Google/Gemini provider status should be present");
    assert.equal(google.configured, true);
    assert.equal(google.configuredSecretName, "GOOGLE_AI_API_KEY");
    assert.equal(google.source, "environment");

    assert.ok(openai, "OpenAI provider status should be present");
    assert.equal(openai.configured, false);
    assert.ok(openai.missingImpact.includes("Bundled starter-pack avatars"));
  } finally {
    resetSecretStoreForTests();
  }

  console.log("PASS onboarding-provider-status");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
