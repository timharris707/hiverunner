import assert from "node:assert/strict";

import { synthesizeDirectTaskActionIntents } from "@/lib/voice-direct-task-actions";
import type { VoiceActionIntent } from "@/lib/voice-action-intent";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ ${name}`);
    console.error(`    ${message}`);
  }
}

function makeIntent(tool: string): VoiceActionIntent {
  return {
    id: `intent-${tool}`,
    name: "tool.request",
    createdAt: 1_000,
    confidence: 0.9,
    payload: { tool },
    sourceText: "<voice_action>...</voice_action>",
    status: "proposed",
  };
}

console.log("\nVoice Direct Task Action Tests\n");

test("synthesizes both status and comment actions from one direct task request", () => {
  const intents = synthesizeDirectTaskActionIntents(
    "Hey, can you do me a favor? This task is already done. Please mark it completed and leave a comment that says \"The operator is cool, please.\"",
    "turn-1",
    2_000,
    [],
  );

  assert.equal(intents.length, 2);
  assert.deepEqual(
    intents.map((intent) => intent.payload),
    [
      { tool: "move_task_status", params: { status: "done" } },
      { tool: "add_task_comment", params: { body: "The operator is cool, please." } },
    ],
  );
});

test("fills in only the missing action when Voice Assistant already proposed one tool request", () => {
  const intents = synthesizeDirectTaskActionIntents(
    "Move it to complete for me and put a note in there that you and I talked and I'm the best.",
    "turn-2",
    3_000,
    [makeIntent("move_task_status")],
  );

  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.payload.tool, "add_task_comment");
  assert.match(String((intents[0]?.payload.params as { body?: string } | undefined)?.body ?? ""), /you and i talked/i);
});

test("synthesizes start_task_work when the operator asks the bound agent to pick up work", () => {
  const intents = synthesizeDirectTaskActionIntents(
    "Can you pick up this task and start working on it now?",
    "turn-3",
    4_000,
    [],
  );

  assert.equal(intents.length, 1);
  assert.deepEqual(intents[0]?.payload, { tool: "start_task_work", params: {} });
});

test("returns no synthetic intents for non-action chatter", () => {
  const intents = synthesizeDirectTaskActionIntents(
    "Hey Voice Assistant, is it Scout or is it Voice Assistant?",
    "turn-4",
    5_000,
    [],
  );

  assert.deepEqual(intents, []);
});

if (failed > 0) {
  console.error(`\nResult: ${passed}/${passed + failed} passed`);
  process.exit(1);
}

console.log(`\nResult: ${passed}/${passed + failed} passed`);
