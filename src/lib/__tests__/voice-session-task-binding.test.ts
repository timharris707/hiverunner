/**
 * Contract tests for voice session task/project/global binding normalization.
 * Run:
 * npx tsx src/lib/__tests__/voice-session-task-binding.test.ts
 */

import assert from "node:assert/strict";

import { buildLiveCallScaffold } from "../avatar-session";
import { normalizeVoiceBindingRequest } from "../voice-binding";
import { normalizeVoiceSessionBootstrap } from "../voice-session-bootstrap";

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

console.log("\nVoice Session Task Binding Contract Tests\n");

async function run() {
  await test("empty binding request normalizes to global scope with defaults", () => {
    const binding = normalizeVoiceBindingRequest({});

    assert.deepEqual(binding, {
      scope: "global",
      mode: "discuss",
      source: "voice-lab",
    });
  });

  await test("task binding request normalizes to task scope", () => {
    const binding = normalizeVoiceBindingRequest({
      companySlug: "acme",
      projectId: "project-1",
      taskKey: "TASK-42",
      agentId: "agent-7",
      source: "task-detail",
      mode: "review",
    });

    assert.deepEqual(binding, {
      scope: "task",
      companySlug: "acme",
      projectId: "project-1",
      taskKey: "TASK-42",
      agentId: "agent-7",
      mode: "review",
      source: "task-detail",
    });
  });

  await test("project binding request normalizes to project scope", () => {
    const binding = normalizeVoiceBindingRequest({
      projectSlug: "apollo",
      source: "project-overview",
    });

    assert.deepEqual(binding, {
      scope: "project",
      projectSlug: "apollo",
      mode: "discuss",
      source: "project-overview",
    });
  });

  await test("request normalization ignores resolved-only metadata", () => {
    const binding = normalizeVoiceBindingRequest({
      companySlug: "acme",
      projectSlug: "apollo",
      taskId: "task-99",
      agentId: "agent-7",
      projectName: "Apollo",
      taskTitle: "Close the loop",
      taskStatus: "in_progress",
      agentName: "Scout",
      agentAvatarUrl: "https://example.com/scout.png",
      mode: "handoff",
      source: "task-detail",
    });

    assert.deepEqual(binding, {
      scope: "task",
      companySlug: "acme",
      projectSlug: "apollo",
      taskId: "task-99",
      agentId: "agent-7",
      mode: "handoff",
      source: "task-detail",
    });
  });

  await test("bootstrap normalization trims strings, keeps resolved binding metadata, and drops invalid liveCall", () => {
    const bootstrap = normalizeVoiceSessionBootstrap({
      wsUrl: "   ",
      systemPrompt: " \n\t ",
      voiceName: { label: "Voice Assistant" },
      liveCall: { status: "not-a-scaffold" },
      binding: {
        companySlug: "acme",
        projectSlug: "apollo",
        projectName: " Apollo Mission ",
        taskId: "task-99",
        taskTitle: " Close the loop ",
        taskStatus: " blocked ",
        agentId: "agent-7",
        agentName: " Scout ",
        agentAvatarUrl: { bad: true },
        mode: "unblock",
        source: "task-detail",
      },
    });

    assert.deepEqual(bootstrap, {
      provider: "gemini-live",
      wsUrl: "",
      systemPrompt: "",
      voiceName: "Charon",
      binding: {
        scope: "task",
        companySlug: "acme",
        projectSlug: "apollo",
        projectName: "Apollo Mission",
        taskId: "task-99",
        taskTitle: "Close the loop",
        taskStatus: "blocked",
        agentId: "agent-7",
        agentName: "Scout",
        mode: "unblock",
        source: "task-detail",
      },
    });
  });

  await test("bootstrap normalization preserves a valid liveCall scaffold", () => {
    const liveCall = buildLiveCallScaffold({
      callSessionId: "call-1",
      avatarSessionId: "avatar-1",
      voiceSessionId: "voice-1",
    });

    const bootstrap = normalizeVoiceSessionBootstrap({ liveCall });

    assert.deepEqual(bootstrap, {
      provider: "gemini-live",
      wsUrl: "",
      systemPrompt: "",
      voiceName: "Charon",
      liveCall,
    });
  });

  await test("bootstrap normalization preserves OpenAI Realtime pilot config", () => {
    const bootstrap = normalizeVoiceSessionBootstrap({
      provider: "openai-realtime-2",
      model: "gpt-realtime-2",
      systemPrompt: "Speak clearly.",
      voiceName: "Charon",
      openai: {
        realtimeUrl: "https://api.openai.com/v1/realtime/calls",
        clientSecret: "ek_test",
        expiresAt: 123,
        voice: "marin",
        reasoningEffort: "medium",
      },
    });

    assert.deepEqual(bootstrap, {
      provider: "openai-realtime-2",
      model: "gpt-realtime-2",
      wsUrl: "",
      systemPrompt: "Speak clearly.",
      voiceName: "Charon",
      openai: {
        realtimeUrl: "https://api.openai.com/v1/realtime/calls",
        clientSecret: "ek_test",
        expiresAt: 123,
        voice: "marin",
        reasoningEffort: "medium",
      },
    });
  });

  await test("bootstrap normalization preserves binding", () => {
    const bootstrap = normalizeVoiceSessionBootstrap({
      wsUrl: "wss://voice.example/ws",
      systemPrompt: "Speak clearly.",
      voiceName: "Voice Assistant",
      binding: {
        companySlug: "acme",
        projectSlug: "apollo",
        taskId: "task-99",
        taskTitle: "Close the loop",
        agentName: "Scout",
        mode: "unblock",
        source: "task-detail",
      },
    });

    assert.equal(bootstrap.wsUrl, "wss://voice.example/ws");
    assert.equal(bootstrap.systemPrompt, "Speak clearly.");
    assert.equal(bootstrap.voiceName, "Voice Assistant");
    assert.deepEqual(bootstrap.binding, {
      scope: "task",
      companySlug: "acme",
      projectSlug: "apollo",
      taskId: "task-99",
      taskTitle: "Close the loop",
      agentName: "Scout",
      mode: "unblock",
      source: "task-detail",
    });
  });

  await test("invalid or mixed weird input normalizes safely", () => {
    const binding = normalizeVoiceBindingRequest({
      taskId: 123,
      projectId: { raw: true },
      projectSlug: "   ",
      taskTitle: 456,
      mode: "not-a-real-mode",
      source: ["bad-source"],
      agentName: null,
    });

    assert.deepEqual(binding, {
      scope: "task",
      taskId: "123",
      mode: "discuss",
      source: "voice-lab",
    });
  });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
