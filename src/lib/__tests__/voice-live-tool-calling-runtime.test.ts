import assert from "node:assert/strict";

import type { ToolResult } from "@/lib/voice-tool-dispatch";
import {
  buildToolResponseMessage,
  normalizeLiveFunctionCalls,
  toLiveToolRequest,
} from "@/lib/voice-live-tool-calling";

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

console.log("\nVoice Live Tool Calling Runtime Tests\n");

test("normalizeLiveFunctionCalls parses object and JSON-string args from Gemini tool calls", () => {
  const calls = normalizeLiveFunctionCalls({
    functionCalls: [
      { id: "call-1", name: "move_task_status", args: { status: "done" } },
      { id: "call-2", name: "add_task_comment", args: '{"body":"The operator approved it."}' },
    ],
  });

  assert.deepEqual(calls, [
    { id: "call-1", name: "move_task_status", args: { status: "done" } },
    { id: "call-2", name: "add_task_comment", args: { body: "The operator approved it." } },
  ]);
});

test("toLiveToolRequest converts a native function call into the same bounded voice tool request shape", () => {
  assert.deepEqual(
    toLiveToolRequest({ id: "call-1", name: "move_task_status", args: { status: "done" } }),
    {
      tool: "move_task_status",
      params: { status: "done" },
    },
  );

  assert.equal(
    toLiveToolRequest({ id: "call-bad", name: "delete_everything", args: {} }),
    null,
  );
});

test("buildToolResponseMessage serializes tool results into a Live API toolResponse payload", () => {
  const result: ToolResult = {
    tool: "move_task_status",
    status: "success",
    output: { changed: true, toStatus: "done" },
    durationMs: 41,
    executedAt: 1_000,
  };

  assert.deepEqual(
    buildToolResponseMessage([
      {
        id: "call-1",
        name: "move_task_status",
        result,
      },
    ]),
    {
      toolResponse: {
        functionResponses: [
          {
            id: "call-1",
            name: "move_task_status",
            response: {
              status: "success",
              output: { changed: true, toStatus: "Done" },
            },
          },
        ],
      },
    },
  );
});

test("buildToolResponseMessage sanitizes internal to-do status wording to user-facing To-Do for Gemini", () => {
  const result: ToolResult = {
    tool: "move_task_status",
    status: "rejected",
    output: {
      error: "Task transition to-do -> done is not allowed",
      fromStatus: "to-do",
      toStatus: "done",
    },
    durationMs: 41,
    executedAt: 1_000,
  };

  assert.deepEqual(
    buildToolResponseMessage([
      {
        id: "call-2",
        name: "move_task_status",
        result,
      },
    ]),
    {
      toolResponse: {
        functionResponses: [
          {
            id: "call-2",
            name: "move_task_status",
            response: {
              status: "rejected",
              output: {
                error: "Task transition To-Do -> done is not allowed",
                fromStatus: "To-Do",
                toStatus: "Done",
              },
            },
          },
        ],
      },
    },
  );
});

if (failed > 0) {
  console.error(`\nResult: ${passed}/${passed + failed} passed`);
  process.exit(1);
}

console.log(`\nResult: ${passed}/${passed + failed} passed`);
