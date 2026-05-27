import assert from "node:assert/strict";

import { POST as generatePreviewPost } from "@/app/api/orchestration/avatars/generate-preview/route";
import {
  AvatarProviderUnavailableError,
  detectAvatarProvider,
  generateAvatarPreviews,
  resetAvatarOpenAIClientFactoryForTests,
  setAvatarOpenAIClientFactoryForTests,
} from "@/lib/orchestration/avatar-provider";
import { normalizeAvatarWizardErrorMessage } from "@/lib/orchestration/avatar-wizard-errors";
import {
  resetSecretStoreForTests,
  setSecretStoreForTests,
  type SecretStoreAdapter,
} from "@/lib/secrets";

const emptySecretStore: SecretStoreAdapter = {
  id: "local-dev",
  get: () => null,
  source: () => null,
  set: () => {
    throw new Error("test secret store is read-only");
  },
  clearCache: () => {},
};

const openAiSecretStore: SecretStoreAdapter = {
  id: "local-dev",
  get: (name) => (name === "OPENAI_API_KEY" ? "sk-test-avatar-openai" : null),
  source: (name) => (name === "OPENAI_API_KEY" ? "environment" : null),
  set: () => {
    throw new Error("test secret store is read-only");
  },
  clearCache: () => {},
};

function previewRequest(body: unknown): Request {
  return new Request("http://localhost/api/orchestration/avatars/generate-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function run() {
  try {
    setSecretStoreForTests(emptySecretStore);

    const missingStatus = detectAvatarProvider();
    assert.equal(missingStatus.provider, "local");
    assert.equal(missingStatus.aiAvailable, false);
    assert.match(missingStatus.setupHint ?? "", /OPENAI_API_KEY/);

    await assert.rejects(
      () => generateAvatarPreviews({
        agentName: "Oracle",
        agentRole: "Lead",
        agentEmoji: "icon:bot",
        agentPersonality: "",
        styleId: "cyber-organic",
        gender: "androgynous",
        count: 1,
      }),
      (error: unknown) => {
        assert.ok(error instanceof AvatarProviderUnavailableError);
        assert.equal(error.status, 503);
        assert.doesNotMatch(error.message, /\[object Object\]/);
        return true;
      },
    );

    const missingResponse = await generatePreviewPost(
      previewRequest({ agentName: "Oracle", count: 1 }) as never,
    );
    const missingBody = await missingResponse.json() as unknown;
    const missingMessage = normalizeAvatarWizardErrorMessage(missingBody, "Fallback");
    assert.equal(missingResponse.status, 503);
    assert.match(missingMessage, /OPENAI_API_KEY/);
    assert.doesNotMatch(missingMessage, /\[object Object\]/);
    assert.doesNotMatch(JSON.stringify(missingBody), /sk-test/);

    setSecretStoreForTests(openAiSecretStore);
    let callCount = 0;
    setAvatarOpenAIClientFactoryForTests((apiKey) => {
      assert.equal(apiKey, "sk-test-avatar-openai");
      return {
        images: {
          generate: async () => {
            callCount += 1;
            return { data: [{ b64_json: Buffer.from(`avatar-${callCount}`).toString("base64") }] };
          },
        },
      } as never;
    });

    const result = await generateAvatarPreviews({
      agentName: "Oracle",
      agentRole: "Lead",
      agentEmoji: "icon:bot",
      agentPersonality: "pragmatic",
      styleId: "cyber-organic",
      gender: "androgynous",
      count: 2,
    });

    assert.equal(result.provider, "openai");
    assert.equal(result.isAiGenerated, true);
    assert.deepEqual(result.previews, [
      `data:image/png;base64,${Buffer.from("avatar-1").toString("base64")}`,
      `data:image/png;base64,${Buffer.from("avatar-2").toString("base64")}`,
    ]);
    assert.equal(callCount, 2);
    assert.doesNotMatch(JSON.stringify(result), /sk-test-avatar-openai/);

    console.log("Avatar provider tests passed");
  } finally {
    resetAvatarOpenAIClientFactoryForTests();
    resetSecretStoreForTests();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
