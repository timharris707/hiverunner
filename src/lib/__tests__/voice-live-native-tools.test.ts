import assert from "node:assert/strict";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { buildSetupMessage, parseServerMessage } from "@/lib/gemini-live";

const { finish, test } = createTestRunner({ passLabel: "✓", failLabel: "✗" });

async function run() {
  console.log("\nVoice Live Native Tool Tests\n");

  await test("buildSetupMessage includes native Live API function declarations for HiveRunner Voice tools", () => {
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

  await test("parseServerMessage surfaces native tool_call events from Gemini Live server messages", () => {
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

  await test("parseServerMessage surfaces native tool_call_cancellation events", () => {
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

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
