import assert from "node:assert/strict";

import { buildSetupMessage, parseServerMessage } from "@/lib/gemini-live";

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

console.log("\nVoice Live Native Tool Tests\n");

test("buildSetupMessage includes native Live API function declarations for HiveRunner Voice tools", () => {
  const message = buildSetupMessage({
    apiKey: "test-key",
    systemInstruction: "You are Voice Assistant.",
    voiceName: "Charon",
  }) as {
    setup?: {
      tools?: Array<{
        functionDeclarations?: Array<{ name?: string }>;
      }>;
    };
  };

  const names = (message.setup?.tools ?? [])
    .flatMap((tool) => tool.functionDeclarations ?? [])
    .map((tool) => tool.name)
    .filter(Boolean);

  assert.ok(names.includes("move_task_status"), "expected move_task_status function declaration");
  assert.ok(names.includes("add_task_comment"), "expected add_task_comment function declaration");
  assert.ok(names.includes("get_current_context"), "expected get_current_context function declaration");
});

test("parseServerMessage surfaces native tool_call events from Gemini Live server messages", () => {
  const events = parseServerMessage({
    toolCall: {
      functionCalls: [
        { id: "call-1", name: "move_task_status", args: { status: "done" } },
        { id: "call-2", name: "add_task_comment", args: { body: "The operator approved it." } },
      ],
    },
  });

  assert.deepEqual(events, [
    {
      type: "tool_call",
      functionCalls: [
        { id: "call-1", name: "move_task_status", args: { status: "done" } },
        { id: "call-2", name: "add_task_comment", args: { body: "The operator approved it." } },
      ],
    },
  ]);
});

test("parseServerMessage surfaces native tool_call_cancellation events", () => {
  const events = parseServerMessage({
    toolCallCancellation: {
      ids: ["call-1", "call-2"],
    },
  });

  assert.deepEqual(events, [
    {
      type: "tool_call_cancellation",
      ids: ["call-1", "call-2"],
    },
  ]);
});

if (failed > 0) {
  console.error(`\nResult: ${passed}/${passed + failed} passed`);
  process.exit(1);
}

console.log(`\nResult: ${passed}/${passed + failed} passed`);
