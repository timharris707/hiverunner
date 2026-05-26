/**
 * Contract tests for lint-driven client helper refactors.
 * Run:
 * npx tsx src/lib/__tests__/client-lint-helper-contracts.test.ts
 */

import assert from "node:assert/strict";
import { formatIntentAgeLabel } from "@/components/voice/ToolActionCard";
import { STATUS_META } from "@/components/orchestration/task-display";
import { statusTheme } from "@/components/orchestration/ui";
import { STATUS_LABEL as TASKS_STATUS_LABEL } from "@/components/tasks/types";
import { ORCHESTRATION_COLUMNS } from "@/lib/orchestration/types";
import { buildConversationFlowEntries } from "@/hooks/useConversationFlow";
import {
  findAutoApprovedToolIntent,
  findDirectlyAuthorizedToolIntents,
  getGeminiAssistantPlaybackUntil,
  parseVoiceTurnOutput,
  shouldSendGeminiMicFrame,
  shouldSynthesizeDirectTaskActionFallback,
  type TranscriptEntry,
} from "@/hooks/useVoiceSession";
import type { ToolDispatchEvent } from "@/lib/voice-tool-dispatch";
import { VOICE_ASSISTANT_SYSTEM_PROMPT } from "@/lib/gemini-live";
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
      { role: "assistant", text: "checking", timestamp: 2_000 },
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
    assert.equal(toolEntries[0]?.timestamp, 2_000 + 1, "dispatching events should anchor just after the last Voice Assistant message");
    assert.equal(toolEntries[0]?.inflight, true);
    assert.equal(toolEntries[1]?.timestamp, 2_500, "terminal events should use executedAt when available");
    assert.equal(toolEntries[1]?.inflight, false);
  });

  await test("operator-facing task status labels use To-Do instead of stale On Deck/Todo wording", () => {
    assert.equal(STATUS_META["to-do"].label, "To-Do");
    assert.equal(statusTheme["to-do"].label, "To-Do");
    assert.equal(TASKS_STATUS_LABEL["to-do"], "To-Do");
    const orchestrationTodoColumn = ORCHESTRATION_COLUMNS.find((column) => column.id === "to-do");
    assert.equal(orchestrationTodoColumn?.label, "To-Do");
  });

  await test("findAutoApprovedToolIntent only auto-accepts a single pending tool request on explicit approval language", () => {
    const pendingIntent = {
      id: "intent-tool-1",
      name: "tool.request" as const,
      createdAt: 1_000,
      confidence: 0.9,
      payload: { tool: "move_task_status", params: { status: "To-Do" } },
      sourceText: "<voice_action>...</voice_action>",
      status: "proposed" as const,
    };

    assert.equal(
      findAutoApprovedToolIntent([pendingIntent], "Go ahead and do it now." )?.id,
      "intent-tool-1",
    );
    assert.equal(findAutoApprovedToolIntent([pendingIntent], "Not yet, hold on."), null);
    assert.equal(
      findAutoApprovedToolIntent([
        pendingIntent,
        { ...pendingIntent, id: "intent-tool-2" },
      ], "Go ahead"),
      null,
    );
  });

  await test("findAutoApprovedToolIntent treats a direct imperative task request as approval for a single pending status action", () => {
    const pendingIntent = {
      id: "intent-tool-directive",
      name: "tool.request" as const,
      createdAt: 2_000,
      confidence: 0.9,
      payload: { tool: "move_task_status", params: { status: "done" } },
      sourceText: "<voice_action>...</voice_action>",
      status: "proposed" as const,
    };

    assert.equal(
      findAutoApprovedToolIntent(
        [pendingIntent],
        "This task is already done, so change the status to complete or done for me, okay?",
      )?.id,
      "intent-tool-directive",
    );
  });

  await test("findDirectlyAuthorizedToolIntents can approve multiple matching task actions from one direct request", () => {
    const proposedStatusIntent = {
      id: "intent-status",
      name: "tool.request" as const,
      createdAt: 3_000,
      confidence: 0.9,
      payload: { tool: "move_task_status", params: { status: "done" } },
      sourceText: "<voice_action>...</voice_action>",
      status: "proposed" as const,
    };
    const proposedCommentIntent = {
      id: "intent-comment",
      name: "tool.request" as const,
      createdAt: 3_001,
      confidence: 0.9,
      payload: { tool: "add_task_comment", params: { body: "The operator and I talked. The operator is ready." } },
      sourceText: "<voice_action>...</voice_action>",
      status: "proposed" as const,
    };

    assert.deepEqual(
      findDirectlyAuthorizedToolIntents(
        [proposedStatusIntent, proposedCommentIntent],
        "This task is already done. Move it to complete for me and put a note in there that you and I talked and I'm the best.",
      ).map((intent) => intent.id),
      ["intent-status", "intent-comment"],
    );
  });

  await test("direct-task fallback stays off when the current Voice Assistant turn already used native Live tool calls", () => {
    assert.equal(
      shouldSynthesizeDirectTaskActionFallback({
        bindingScope: "task",
        lastUserText: "Move it to done and leave a note.",
        currentTurnHadNativeToolCall: true,
      }),
      false,
    );

    assert.equal(
      shouldSynthesizeDirectTaskActionFallback({
        bindingScope: "task",
        lastUserText: "Move it to done and leave a note.",
        currentTurnHadNativeToolCall: false,
      }),
      true,
    );
  });

  await test("HiveRunner Voice prompt tells the model to use native Live API tools for task actions instead of relying on hidden tool tags", () => {
    assert.match(
      VOICE_ASSISTANT_SYSTEM_PROMPT,
      /native Live API tools|call the matching tool|call each tool separately|do not need to emit hidden tool tags/i,
    );
  });

  await test("Gemini mic echo guard suppresses assistant playback bleed but still allows deliberate barge-in", () => {
    const now = 10_000;
    const playbackUntil = getGeminiAssistantPlaybackUntil({
      now,
      currentPlaybackUntil: 0,
      sampleCount: 12_000,
      sampleRate: 24_000,
      paddingMs: 180,
    });

    assert.equal(playbackUntil, 10_680);
    assert.equal(
      shouldSendGeminiMicFrame({
        now: 10_120,
        inputLevel: 0.08,
        assistantPlaybackUntil: playbackUntil,
        bargeInLevel: 0.24,
      }),
      false,
      "quiet mic bleed during assistant playback should not interrupt the Live model",
    );
    assert.equal(
      shouldSendGeminiMicFrame({
        now: 10_120,
        inputLevel: 0.32,
        assistantPlaybackUntil: playbackUntil,
        bargeInLevel: 0.24,
      }),
      true,
      "clear user speech should still interrupt intentionally",
    );
    assert.equal(
      shouldSendGeminiMicFrame({
        now: 10_681,
        inputLevel: 0.02,
        assistantPlaybackUntil: playbackUntil,
        bargeInLevel: 0.24,
      }),
      true,
      "normal mic streaming resumes after playback drains",
    );
  });

  await test("parseVoiceTurnOutput strips action tags from visible transcript text and keeps intents", () => {
    const parsed = parseVoiceTurnOutput(
      'I logged the blocker for later. <voice_action>{"name":"session.marker","confidence":0.92,"payload":{"kind":"blocker","summary":"Gemini tags should stay hidden"}}</voice_action>',
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
        sourceText: '<voice_action>{"name":"session.marker","confidence":0.92,"payload":{"kind":"blocker","summary":"Gemini tags should stay hidden"}}</voice_action>',
        status: "proposed",
      },
    ]);
  });

  await test("parseVoiceTurnOutput suppresses transcript rows when Voice Assistant only emitted tags", () => {
    const parsed = parseVoiceTurnOutput(
      '<voice_action>{"name":"tool.request","payload":{"tool":"get_current_time"}}</voice_action>',
      "turn-43",
      54_321,
    );

    assert.equal(parsed.cleanedText, "");
    assert.equal(parsed.hasTranscriptText, false);
    assert.equal(parsed.intents.length, 1);
    assert.equal(parsed.intents[0]?.name, "tool.request");
  });

  await test("parseVoiceTurnOutput falls back to text fallback when transcript text only contains hidden tags", () => {
    const parsed = parseVoiceTurnOutput(
      '<voice_action>{"name":"session.marker","confidence":0.8,"payload":{"kind":"note"}}</voice_action>',
      "turn-44",
      77_777,
      "Visible Voice Assistant reply from fallback channel."
    );

    assert.equal(parsed.cleanedText, "Visible Voice Assistant reply from fallback channel.");
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
      getItem: (key: string) => (key === "hiverunner-demo-mode" ? "true" : null),
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
      getItem: (key: string) => (key === "hiverunner-hidden-projects:nev" ? state.raw : null),
    } as Pick<Storage, "getItem">;

    const readSnapshot = createHiddenProjectsSnapshotReader(storage, "hiverunner-hidden-projects:nev");
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
