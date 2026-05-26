import assert from "node:assert/strict";

import {
  listModelSourceCredentials,
  probeModelSourceCredential,
  runModelSourceConnectionProbe,
  saveModelSourceCredential,
} from "@/lib/orchestration/model-source-credentials";
import {
  resetSecretStoreForTests,
  setSecretStoreForTests,
  type SecretSource,
  type SecretStoreAdapter,
  type SecretWriteInput,
} from "@/lib/secrets";

const values = new Map<string, { source: SecretSource; value: string }>();
const originalFetch = globalThis.fetch;

const fakeStore: SecretStoreAdapter = {
  id: "managed",
  get(secretName: string): string | null {
    return values.get(secretName)?.value ?? null;
  },
  source(secretName: string): SecretSource | null {
    return values.get(secretName)?.source ?? null;
  },
  set(input: SecretWriteInput): void {
    values.set(input.name, { source: "managed-secret-store", value: input.value });
  },
  clearCache(secretName?: string): void {
    if (secretName) {
      values.delete(secretName);
      return;
    }
    values.clear();
  },
};

async function run() {
  setSecretStoreForTests(fakeStore);
  values.clear();
  values.set("OPENROUTER_API_KEY", { source: "managed-secret-store", value: "sk-test-openrouter" });

  const openRouter = probeModelSourceCredential("openrouter");
  assert.equal(openRouter.status, "connected");
  assert.equal(openRouter.authSurface, "managed-secret-store");
  assert.equal(openRouter.credentialStorage?.adapterId, "managed");
  assert.equal(openRouter.credentialStorage?.productionReady, true);
  assert.deepEqual(openRouter.configuredSecretNames, ["OPENROUTER_API_KEY"]);
  assert.doesNotMatch(JSON.stringify(openRouter), /sk-test-openrouter/);

  const anthropic = probeModelSourceCredential("anthropic");
  assert.equal(anthropic.status, "needs_key");
  assert.equal(anthropic.authSurface, "none");
  assert.equal(anthropic.credentialStorage?.productionReady, true);
  assert.deepEqual(anthropic.configuredSecretNames, []);

  saveModelSourceCredential({ sourceId: "anthropic", credentialValue: "sk-test-anthropic" });
  const savedAnthropic = probeModelSourceCredential("anthropic");
  assert.equal(savedAnthropic.status, "connected");
  assert.equal(savedAnthropic.authSurface, "managed-secret-store");
  assert.deepEqual(savedAnthropic.configuredSecretNames, ["ANTHROPIC_API_KEY"]);
  assert.doesNotMatch(JSON.stringify(listModelSourceCredentials()), /sk-test-anthropic|sk-test-openrouter/);

  const probedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    probedUrls.push(url);
    const authHeader = init?.headers instanceof Headers
      ? init.headers.get("authorization") ?? init.headers.get("x-api-key")
      : Array.isArray(init?.headers)
        ? init.headers.find(([key]) => key.toLowerCase() === "authorization" || key.toLowerCase() === "x-api-key")?.[1]
        : typeof init?.headers === "object" && init?.headers
          ? String((init.headers as Record<string, string>)["Authorization"] ?? (init.headers as Record<string, string>)["x-api-key"] ?? "")
          : "";
    assert.ok(authHeader.includes("sk-test-openrouter") || url.includes("key=") || authHeader.includes("sk-test-anthropic"));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  const openRouterProbe = await runModelSourceConnectionProbe("openrouter");
  assert.equal(openRouterProbe.status, "pass");
  assert.equal(openRouterProbe.authSurface, "managed-secret-store");
  assert.deepEqual(openRouterProbe.configuredSecretNames, ["OPENROUTER_API_KEY"]);
  assert.match(probedUrls.join("\n"), /openrouter\.ai\/api\/v1\/key/);
  assert.doesNotMatch(JSON.stringify(openRouterProbe), /sk-test-openrouter/);

  values.delete("ANTHROPIC_API_KEY");
  const missingProbe = await runModelSourceConnectionProbe("anthropic");
  assert.equal(missingProbe.status, "fail");
  assert.equal(missingProbe.authSurface, "none");
  assert.deepEqual(missingProbe.configuredSecretNames, []);

  console.log("Model source credential tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  globalThis.fetch = originalFetch;
  resetSecretStoreForTests();
});
