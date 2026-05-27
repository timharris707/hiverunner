import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resetSecretStoreForTests,
  setSecretStoreForTests,
  type SecretStoreAdapter,
} from "@/lib/secrets";
import { normalizeSafeErrorMessage } from "@/lib/orchestration/avatar-wizard-errors";
import { getUnsupportedVoiceRuntimeMessage } from "@/lib/voice-runtime-readiness";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

function makeRequest(body?: unknown) {
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

const emptySecretStore: SecretStoreAdapter = {
  id: "local-dev",
  get: () => null,
  source: () => null,
  set: () => {
    throw new Error("test secret store is read-only");
  },
  clearCache: () => {},
};

const geminiSecretStore: SecretStoreAdapter = {
  id: "local-dev",
  get: (name) => (name === "GOOGLE_AI_API_KEY" ? "test-gemini-key" : null),
  source: (name) => (name === "GOOGLE_AI_API_KEY" ? "test" : null),
  set: () => {
    throw new Error("test secret store is read-only");
  },
  clearCache: () => {},
};

console.log("\nVoice Session Startup Error Tests\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-voice-session-startup-errors-"));
  const fakeHome = path.join(tmpRoot, "home");
  const workspaceRoot = path.join(fakeHome, ".openclaw", "workspace");
  const originalEnv = {
    HOME: process.env.HOME,
    OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE,
    OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
    ORCHESTRATION_DB_PATH: process.env.ORCHESTRATION_DB_PATH,
    GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(path.join(workspaceRoot, "MEMORY.md"), "# Memory\n\nStartup error fixture.\n", "utf-8");

  try {
    process.env.HOME = fakeHome;
    process.env.OPENCLAW_WORKSPACE = workspaceRoot;
    process.env.OPENCLAW_WORKSPACE_ROOT = workspaceRoot;
    process.env.ORCHESTRATION_DB_PATH = path.join(tmpRoot, "voice-session-startup-errors.db");
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    setSecretStoreForTests(emptySecretStore);

    const { POST } = await import("@/app/api/voice/session/route");

    await test("default voice missing key response normalizes to setup copy, never [object Object]", async () => {
      const response = await POST(makeRequest({ voiceProvider: "gemini-live" }) as never);
      const body = await response.json() as unknown;
      const message = normalizeSafeErrorMessage(body, "Fallback");

      assert.equal(response.status, 503);
      assert.match(message, /Voice chat is optional/);
      assert.match(message, /GOOGLE_AI_API_KEY/);
      assert.doesNotMatch(message, /\[object Object\]/);
    });

    await test("testing runtime missing key response normalizes to setup copy, never [object Object]", async () => {
      const response = await POST(makeRequest({ voiceProvider: "openai-realtime-2" }) as never);
      const body = await response.json() as unknown;
      const message = normalizeSafeErrorMessage(body, "Fallback");

      assert.equal(response.status, 503);
      assert.match(message, /Voice chat is optional/);
      assert.match(message, /OPENAI_API_KEY/);
      assert.doesNotMatch(message, /\[object Object\]/);
    });

    await test("missing provider key is reported before bound task lookup failures", async () => {
      const response = await POST(
        makeRequest({
          voiceProvider: "gemini-live",
          taskKey: "VOICE-MISSING-KEY-FIRST",
          source: "task-detail",
        }) as never,
      );
      const body = await response.json() as unknown;
      const message = normalizeSafeErrorMessage(body, "Fallback");

      assert.equal(response.status, 503);
      assert.match(message, /Voice chat is optional/);
      assert.doesNotMatch(message, /Task not found/);
    });

    await test("Gemini Live configured key path returns a browser session bootstrap", async () => {
      setSecretStoreForTests(geminiSecretStore);
      try {
        const response = await POST(makeRequest({ voiceProvider: "gemini-live" }) as never);
        const body = await response.json() as { provider?: unknown; wsUrl?: unknown; capabilities?: { audioInput?: unknown } };

        assert.equal(response.status, 200);
        assert.equal(body.provider, "gemini-live");
        assert.equal(typeof body.wsUrl, "string");
        assert.match(String(body.wsUrl), /test-gemini-key/);
        assert.equal(body.capabilities?.audioInput, true);
      } finally {
        setSecretStoreForTests(emptySecretStore);
      }
    });

    await test("browser runtime readiness reports unsupported local microphone state", () => {
      const message = getUnsupportedVoiceRuntimeMessage("gemini-live", {
        navigator: {} as Navigator,
        WebSocket: WebSocket,
        AudioContext: class {} as typeof AudioContext,
      });

      assert.match(message ?? "", /microphone access/);
      assert.doesNotMatch(message ?? "", /\[object Object\]/);
    });

    await test("Gemini Live browser runtime readiness accepts Safari webkit AudioContext", () => {
      const message = getUnsupportedVoiceRuntimeMessage("gemini-live", {
        navigator: {
          mediaDevices: {
            getUserMedia: (() => Promise.resolve({} as MediaStream)) as MediaDevices["getUserMedia"],
          },
        } as Navigator,
        WebSocket: WebSocket,
        webkitAudioContext: class {} as typeof AudioContext,
      });

      assert.equal(message, null);
    });

    await test("OpenAI Realtime browser runtime readiness requires WebRTC", () => {
      const message = getUnsupportedVoiceRuntimeMessage("openai-realtime-2", {
        navigator: {
          mediaDevices: {
            getUserMedia: (() => Promise.resolve({} as MediaStream)) as MediaDevices["getUserMedia"],
          },
        } as Navigator,
        document: { body: {} as HTMLElement } as Document,
      });

      assert.match(message ?? "", /WebRTC support/);
      assert.doesNotMatch(message ?? "", /\[object Object\]/);
    });
  } finally {
    resetSecretStoreForTests();
    restoreEnvVar("HOME", originalEnv.HOME);
    restoreEnvVar("OPENCLAW_WORKSPACE", originalEnv.OPENCLAW_WORKSPACE);
    restoreEnvVar("OPENCLAW_WORKSPACE_ROOT", originalEnv.OPENCLAW_WORKSPACE_ROOT);
    restoreEnvVar("ORCHESTRATION_DB_PATH", originalEnv.ORCHESTRATION_DB_PATH);
    restoreEnvVar("GOOGLE_AI_API_KEY", originalEnv.GOOGLE_AI_API_KEY);
    restoreEnvVar("GEMINI_API_KEY", originalEnv.GEMINI_API_KEY);
    restoreEnvVar("OPENAI_API_KEY", originalEnv.OPENAI_API_KEY);
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
