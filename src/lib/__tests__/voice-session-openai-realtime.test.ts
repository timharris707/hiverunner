/**
 * Contract tests for the OpenAI Realtime 2 voice pilot bootstrap.
 * Run:
 * npx tsx src/lib/__tests__/voice-session-openai-realtime.test.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearSecretCache } from "@/lib/secrets";

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

console.log("\nOpenAI Realtime Voice Bootstrap Contract Tests\n");

async function run() {
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "mc-openai-realtime-voice-"));
  const fakeHome = path.join(tmpRoot, "home");
  const workspaceRoot = path.join(fakeHome, ".openclaw", "workspace");
  const dbPath = path.join(tmpRoot, "openai-realtime-voice.db");
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    HOME: process.env.HOME,
    OPENCLAW_WORKSPACE: process.env.OPENCLAW_WORKSPACE,
    OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
    ORCHESTRATION_DB_PATH: process.env.ORCHESTRATION_DB_PATH,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_REALTIME_VOICE_MODEL: process.env.OPENAI_REALTIME_VOICE_MODEL,
    OPENAI_REALTIME_VOICE: process.env.OPENAI_REALTIME_VOICE,
    OPENAI_REALTIME_REASONING_EFFORT: process.env.OPENAI_REALTIME_REASONING_EFFORT,
    OPENAI_REALTIME_TRANSCRIPTION_MODEL: process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL,
    OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE: process.env.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE,
    OPENAI_REALTIME_TRANSCRIPTION_PROMPT: process.env.OPENAI_REALTIME_TRANSCRIPTION_PROMPT,
  };

  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(path.join(workspaceRoot, "MEMORY.md"), "# Memory\n\nHiveRunner voice pilot fixture.\n", "utf-8");

  try {
    process.env.HOME = fakeHome;
    process.env.OPENCLAW_WORKSPACE = workspaceRoot;
    process.env.OPENCLAW_WORKSPACE_ROOT = workspaceRoot;
    process.env.ORCHESTRATION_DB_PATH = dbPath;
    process.env.OPENAI_API_KEY = "test-openai-key";
    delete process.env.OPENAI_REALTIME_VOICE_MODEL;
    delete process.env.OPENAI_REALTIME_VOICE;
    delete process.env.OPENAI_REALTIME_REASONING_EFFORT;
    delete process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL;
    delete process.env.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE;
    delete process.env.OPENAI_REALTIME_TRANSCRIPTION_PROMPT;
    clearSecretCache();

    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : {};
      requests.push({ url, body });

      return new Response(JSON.stringify({
        value: "ek_test_realtime",
        expires_at: 1_800_000_000,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const { POST } = await import("@/app/api/voice/session/route");

    await test("OpenAI Realtime provider mints an ephemeral client secret with HiveRunner tools", async () => {
      const response = await POST(makeRequest({ voiceProvider: "openai-realtime-2" }) as never);
      const body = await response.json() as {
        provider: string;
        model: string;
        systemPrompt: string;
        openai?: {
          clientSecret: string;
          realtimeUrl: string;
          voice: string;
          reasoningEffort: string;
        };
      };

      assert.equal(response.status, 200);
      assert.equal(body.provider, "openai-realtime-2");
      assert.equal(body.model, "gpt-realtime-2");
      assert.equal(body.openai?.clientSecret, "ek_test_realtime");
      assert.equal(body.openai?.voice, "marin");
      assert.equal(body.openai?.reasoningEffort, "low");
      assert.match(body.systemPrompt, /OpenAI Realtime 2 Voice Behavior/);
      assert.match(body.systemPrompt, /Do not use wait_for_user for hard questions/);

      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.url, "https://api.openai.com/v1/realtime/client_secrets");
      const session = requests[0]?.body.session as Record<string, unknown>;
      assert.equal(session.model, "gpt-realtime-2");
      assert.deepEqual(session.output_modalities, ["audio"]);
      assert.equal((session.reasoning as { effort?: string }).effort, "low");
      const audio = session.audio as { input?: { turn_detection?: Record<string, unknown> } };
      assert.deepEqual(audio.input?.turn_detection, {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 250,
        silence_duration_ms: 450,
      });
      assert.deepEqual(audio.input?.noise_reduction, { type: "near_field" });
      assert.deepEqual(audio.input?.transcription, {
        model: "gpt-4o-transcribe",
        language: "en",
        prompt: [
          "Transcribe the operator's English speech during a HiveRunner voice conversation.",
          "Common terms include HiveRunner, OpenAI, Gemini, Realtime 2, Linda, Scout, Mira, Codex, OpenClaw, Weather Edge, task, project, and agent.",
          "If audio is unclear, prefer the closest natural English phrase or leave it incomplete.",
          "Do not switch languages or emit Japanese, Chinese, Hindi, or other non-English scripts unless the operator clearly speaks that language.",
        ].join(" "),
      });
      const toolNames = ((session.tools as Array<{ name: string }>) ?? []).map((tool) => tool.name);
      assert.ok(toolNames.includes("start_task_work"));
      assert.ok(toolNames.includes("add_task_comment"));
      assert.ok(toolNames.includes("wait_for_user"));
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvVar("HOME", originalEnv.HOME);
    restoreEnvVar("OPENCLAW_WORKSPACE", originalEnv.OPENCLAW_WORKSPACE);
    restoreEnvVar("OPENCLAW_WORKSPACE_ROOT", originalEnv.OPENCLAW_WORKSPACE_ROOT);
    restoreEnvVar("ORCHESTRATION_DB_PATH", originalEnv.ORCHESTRATION_DB_PATH);
    restoreEnvVar("OPENAI_API_KEY", originalEnv.OPENAI_API_KEY);
    restoreEnvVar("OPENAI_REALTIME_VOICE_MODEL", originalEnv.OPENAI_REALTIME_VOICE_MODEL);
    restoreEnvVar("OPENAI_REALTIME_VOICE", originalEnv.OPENAI_REALTIME_VOICE);
    restoreEnvVar("OPENAI_REALTIME_REASONING_EFFORT", originalEnv.OPENAI_REALTIME_REASONING_EFFORT);
    restoreEnvVar("OPENAI_REALTIME_TRANSCRIPTION_MODEL", originalEnv.OPENAI_REALTIME_TRANSCRIPTION_MODEL);
    restoreEnvVar("OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE", originalEnv.OPENAI_REALTIME_TRANSCRIPTION_LANGUAGE);
    restoreEnvVar("OPENAI_REALTIME_TRANSCRIPTION_PROMPT", originalEnv.OPENAI_REALTIME_TRANSCRIPTION_PROMPT);
    clearSecretCache();
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
