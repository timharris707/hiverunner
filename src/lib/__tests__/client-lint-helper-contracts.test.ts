/**
 * Contract tests for lint-driven client helper refactors.
 * Run:
 * npx tsx src/lib/__tests__/client-lint-helper-contracts.test.ts
 */

import assert from "node:assert/strict";
import { formatIntentAgeLabel } from "@/components/voice/ToolActionCard";
import { buildConversationFlowEntries } from "@/hooks/useConversationFlow";
import {
  parseHenryTurnOutput,
  type TranscriptEntry,
} from "@/hooks/useVoiceSession";
import type { ToolDispatchEvent } from "@/lib/voice-tool-dispatch";
import { shouldPollLiveRuns } from "@/hooks/useLiveRuns";
import { readStoredDemoModeFromStorage } from "@/lib/demo-mode";
import { createHiddenProjectsSnapshotReader, getEmptyHiddenProjectsSnapshot, parseHiddenProjects } from "@/lib/hidden-project-state";

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

console.log("\nClient Lint Helper Contract Tests\n");

async function run() {
  await test("formatIntentAgeLabel rounds seconds and minutes consistently", () => {
    assert.equal(formatIntentAgeLabel(4_000), "4s ago");
    assert.equal(formatIntentAgeLabel(59_600), "60s ago");
    assert.equal(formatIntentAgeLabel(61_000), "1m ago");
    assert.equal(formatIntentAgeLabel(-500), "0s ago");
  });

  await test("buildConversationFlowEntries uses terminal executedAt and deterministic transcript fallback", () => {
    const transcript: TranscriptEntry[] = [
      { role: "user", text: "hey", timestamp: 1_000 },
      { role: "henry", text: "checking", timestamp: 2_000 },
      { role: "user", text: "thanks", timestamp: 3_000 },
    ];

    const toolEvents: ToolDispatchEvent[] = [
      { type: "dispatching", intentId: "intent-dispatch", tool: "get_current_time" },
      {
        type: "completed",
        intentId: "intent-terminal",
        tool: "get_system_status",
        result: {
          tool: "get_system_status",
          status: "success",
          output: { ok: true },
          durationMs: 42,
          executedAt: 2_500,
        },
      },
    ];

    const flow = buildConversationFlowEntries(transcript, toolEvents);
    const toolEntries = flow.filter((entry) => entry.kind === "tool");

    assert.equal(toolEntries.length, 2);
    assert.equal(toolEntries[0]?.timestamp, 2_000 + 1, "dispatching events should anchor just after the last Henry message");
    assert.equal(toolEntries[0]?.inflight, true);
    assert.equal(toolEntries[1]?.timestamp, 2_500, "terminal events should use executedAt when available");
    assert.equal(toolEntries[1]?.inflight, false);
  });

  await test("parseHenryTurnOutput strips action tags from visible transcript text and keeps intents", () => {
    const parsed = parseHenryTurnOutput(
      'I logged the blocker for later. <henry_action>{"name":"session.marker","confidence":0.92,"payload":{"kind":"blocker","summary":"Gemini tags should stay hidden"}}</henry_action>',
      "turn-42",
      12_345,
    );

    assert.equal(parsed.cleanedText, "I logged the blocker for later.");
    assert.equal(parsed.hasTranscriptText, true);
    assert.deepEqual(parsed.intents, [
      {
        id: "turn-42:intent:0",
        name: "session.marker",
        createdAt: 12_345,
        confidence: 0.92,
        payload: {
          kind: "blocker",
          summary: "Gemini tags should stay hidden",
        },
        sourceText: '<henry_action>{"name":"session.marker","confidence":0.92,"payload":{"kind":"blocker","summary":"Gemini tags should stay hidden"}}</henry_action>',
        status: "proposed",
      },
    ]);
  });

  await test("parseHenryTurnOutput suppresses transcript rows when Henry only emitted tags", () => {
    const parsed = parseHenryTurnOutput(
      '<henry_action>{"name":"tool.request","payload":{"tool":"get_current_time"}}</henry_action>',
      "turn-43",
      54_321,
    );

    assert.equal(parsed.cleanedText, "");
    assert.equal(parsed.hasTranscriptText, false);
    assert.equal(parsed.intents.length, 1);
    assert.equal(parsed.intents[0]?.name, "tool.request");
  });

  await test("parseHenryTurnOutput falls back to text fallback when transcript text only contains hidden tags", () => {
    const parsed = parseHenryTurnOutput(
      '<henry_action>{"name":"session.marker","confidence":0.8,"payload":{"kind":"note"}}</henry_action>',
      "turn-44",
      77_777,
      "Visible Henry reply from fallback channel."
    );

    assert.equal(parsed.cleanedText, "Visible Henry reply from fallback channel.");
    assert.equal(parsed.hasTranscriptText, true);
    assert.equal(parsed.intents.length, 1);
    assert.equal(parsed.intents[0]?.name, "session.marker");
  });

  await test("shouldPollLiveRuns respects enabled override and cooldown window", () => {
    assert.equal(shouldPollLiveRuns({ enabled: true, lastActiveAt: 0, now: 0 }), true);
    assert.equal(shouldPollLiveRuns({ enabled: false, lastActiveAt: 10_000, now: 129_999 }), true);
    assert.equal(shouldPollLiveRuns({ enabled: false, lastActiveAt: 10_000, now: 130_001 }), false);
  });

  await test("readStoredDemoModeFromStorage only trusts an explicit true flag", () => {
    const storage = {
      getItem: (key: string) => (key === "mission-control-demo-mode" ? "true" : null),
    } as Pick<Storage, "getItem">;

    assert.equal(readStoredDemoModeFromStorage(storage), true);
    assert.equal(readStoredDemoModeFromStorage({ getItem: () => "false" }), false);
    assert.equal(readStoredDemoModeFromStorage(null), false);
  });

  await test("parseHiddenProjects tolerates invalid JSON and preserves valid maps", () => {
    assert.deepEqual(parseHiddenProjects('{"project-a":true,"project-b":false}'), {
      "project-a": true,
      "project-b": false,
    });
    assert.deepEqual(parseHiddenProjects("not-json"), {});
    assert.deepEqual(parseHiddenProjects(null), {});
  });

  await test("hidden-project snapshot helpers cache stable objects across unchanged storage", () => {
    const state = { raw: '{"project-a":true}' };
    const storage = {
      getItem: (key: string) => (key === "mission-control-hidden-projects:nev" ? state.raw : null),
    } as Pick<Storage, "getItem">;

    const readSnapshot = createHiddenProjectsSnapshotReader(storage, "mission-control-hidden-projects:nev");
    const first = readSnapshot();
    const second = readSnapshot();
    assert.equal(second, first, "unchanged storage should reuse the same snapshot object");

    state.raw = '{"project-a":true,"project-b":false}';
    const third = readSnapshot();
    assert.notEqual(third, first, "changed storage should produce a new snapshot object");
    assert.deepEqual(third, {
      "project-a": true,
      "project-b": false,
    });
    assert.equal(readSnapshot(), third, "unchanged post-update storage should remain referentially stable");
    assert.equal(getEmptyHiddenProjectsSnapshot(), getEmptyHiddenProjectsSnapshot());
  });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
