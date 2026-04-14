import assert from "node:assert";

import { isAgentLive, isRunLive } from "@/lib/orchestration/live-status";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  [FAIL] ${name}`);
    console.error(`    ${message}`);
  }
}

console.log("\nOrchestration Live Status Tests\n");

test("isRunLive treats queued and pending as live", () => {
  assert.strictEqual(isRunLive("queued"), true);
  assert.strictEqual(isRunLive("pending"), true);
  assert.strictEqual(isRunLive("running"), true);
  assert.strictEqual(isRunLive("succeeded"), false);
  assert.strictEqual(isRunLive("failed"), false);
});

test("terminal live run status overrides stale SSE and persisted working status", () => {
  const liveRunsByAgentId = new Map<string, { status: string }>([["agent-1", { status: "succeeded" }]]);
  const liveAgentIds = new Set<string>(["agent-1"]);

  assert.strictEqual(
    isAgentLive({
      agentId: "agent-1",
      agentStatus: "working",
      liveAgentIds,
      liveRunsByAgentId,
    }),
    false,
  );
});

test("SSE-only signal still marks agent live when no run snapshot exists yet", () => {
  assert.strictEqual(
    isAgentLive({
      agentId: "agent-2",
      agentStatus: "idle",
      liveAgentIds: new Set<string>(["agent-2"]),
      liveRunsByAgentId: new Map(),
    }),
    true,
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
