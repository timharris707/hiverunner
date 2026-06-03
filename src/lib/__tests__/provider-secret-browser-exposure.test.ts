import assert from "node:assert/strict";

import { GET as getProviderStatus } from "@/app/api/onboarding/provider-status/route";
import { GET as getDecartConfig } from "@/app/api/voice/decart-config/route";
import { POST as postVoiceSession } from "@/app/api/voice/session/route";
import {
  resetSecretStoreForTests,
  setSecretStoreForTests,
  type SecretStoreAdapter,
} from "@/lib/secrets";

function makeVoiceRequest(body?: unknown) {
  return new Request("http://localhost/api/voice/session", {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function restoreEnvVar(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

const store: SecretStoreAdapter = {
  id: "local-dev",
  get(secretName: string) {
    return secretName === "GOOGLE_AI_API_KEY" ? "test-google-provider-key" : null;
  },
  source(secretName: string) {
    return secretName === "GOOGLE_AI_API_KEY" ? "environment" : null;
  },
  set() {
    throw new Error("provider safety test should not write secrets");
  },
  clearCache() {},
};

async function run() {
  const originalDecartApiKey = process.env.DECART_API_KEY;

  try {
    process.env.DECART_API_KEY = "test-decart-provider-key";
    setSecretStoreForTests(store);

    const voiceResponse = await postVoiceSession(makeVoiceRequest({ voiceProvider: "gemini-live" }) as never);
    const voiceBody = await voiceResponse.json() as unknown;
    const voiceSerialized = JSON.stringify(voiceBody);

    assert.equal(voiceResponse.status, 503);
    assert.match(voiceSerialized, /gemini_browser_websocket_disabled/);
    assert.doesNotMatch(voiceSerialized, /test-google-provider-key/);
    assert.doesNotMatch(voiceSerialized, /\?key=/);

    const decartResponse = await getDecartConfig();
    const decartBody = await decartResponse.json() as unknown;
    const decartSerialized = JSON.stringify(decartBody);

    assert.equal(decartResponse.status, 503);
    assert.match(decartSerialized, /decart_browser_key_disabled/);
    assert.doesNotMatch(decartSerialized, /test-decart-provider-key/);
    assert.doesNotMatch(decartSerialized, /"apiKey"/);

    const providerStatusResponse = await getProviderStatus();
    const providerStatusBody = await providerStatusResponse.json() as unknown;

    assert.equal(providerStatusResponse.status, 200);
    assert.doesNotMatch(JSON.stringify(providerStatusBody), /test-google-provider-key/);
  } finally {
    resetSecretStoreForTests();
    restoreEnvVar("DECART_API_KEY", originalDecartApiKey);
  }

  console.log("PASS provider-secret-browser-exposure");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
