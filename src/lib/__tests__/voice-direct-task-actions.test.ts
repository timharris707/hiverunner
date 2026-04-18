import assert from "node:assert/strict";

import { synthesizeDirectTaskActionIntents } from "@/lib/voice-direct-task-actions";
import type { HenryActionIntent } from "@/lib/voice-action-intent";

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

function makeIntent(tool: string): HenryActionIntent {
  return {
    id: `intent-${tool}`,
    name: "tool.request",
    createdAt: 1_000,
    confidence: 0.9,
    payload: { tool },
    sourceText: "<henry_action>...</henry_action>",
    status: "proposed",
  };
}

console.log("\nVoice Direct Task Action Tests\n");

test("synthesizes both status and comment actions from one direct task request", () => {
  const intents = synthesizeDirectTaskActionIntents(
    "Hey, can you do me a favor? This task is already done. Please mark it completed and leave a comment that says \"Tim is cool, please.\"",
    "turn-1",
    2_000,
    [],
  );

  assert.equal(intents.length, 2);
  assert.deepEqual(
    intents.map((intent) => intent.payload),
    [
      { tool: "move_task_status", params: { status: "done" } },
      { tool: "add_task_comment", params: { body: "Tim is cool, please." } },
    ],
  );
});

test("fills in only the missing action when Henry already proposed one tool request", () => {
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

test("returns no synthetic intents for non-action chatter", () => {
  const intents = synthesizeDirectTaskActionIntents(
    "Hey Henry, is it Scout or is it Henry?",
    "turn-3",
    4_000,
    [],
  );

  assert.deepEqual(intents, []);
});

if (failed > 0) {
  console.error(`\nResult: ${passed}/${passed + failed} passed`);
  process.exit(1);
}

console.log(`\nResult: ${passed}/${passed + failed} passed`);
