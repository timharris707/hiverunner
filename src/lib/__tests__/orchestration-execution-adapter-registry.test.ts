/**
 * Contract tests for the execution adapter registry (E7).
 * Run:
 *   npx tsx src/lib/__tests__/orchestration-execution-adapter-registry.test.ts
 *
 * Verifies that getExecutionAdapter dispatches by type, defaults to
 * OpenClaw when the type is missing/unknown, and that the Anthropic
 * stub returns a loud "not yet wired" error rather than silently
 * succeeding.
 */

import assert from "node:assert";

import {
  anthropicExecutionAdapter,
  getExecutionAdapter,
  openclawExecutionAdapter,
  type ExecutionInput,
} from "@/lib/orchestration/execution/adapters";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

function stubInput(overrides: Partial<ExecutionInput> = {}): ExecutionInput {
  return {
    agent: {
      id: "agent-stub",
      name: "Stub Agent",
      role: "Engineer",
      personality: "",
      company_id: "company-stub",
      openclaw_agent_id: null,
      adapter_type: "anthropic",
      adapter_config_json: "{}",
      runtime_config_json: "{}",
      capabilities: "",
    },
    prompt: "heartbeat",
    session: {
      id: "session-stub",
      agentId: "agent-stub",
      companyId: "company-stub",
      adapterType: "anthropic",
      taskKey: "TASK-STUB",
      sessionParams: {},
      sessionDisplayId: null,
      lastRunId: null,
      lastError: null,
      createdAt: "",
      updatedAt: "",
    },
    runtimeState: {
      agentId: "agent-stub",
      companyId: "company-stub",
      adapterType: "anthropic",
      sessionId: null,
      state: {},
      lastRunId: null,
      lastRunStatus: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostCents: 0,
      lastError: null,
    },
    ...overrides,
  };
}

async function run() {
  console.log("\nExecution Adapter Registry Tests\n");

  await test("getExecutionAdapter('openclaw') returns the OpenClaw adapter", () => {
    const adapter = getExecutionAdapter("openclaw");
    assert.strictEqual(adapter, openclawExecutionAdapter);
    assert.strictEqual(adapter.adapterType, "openclaw");
  });

  await test("getExecutionAdapter('anthropic') returns the Anthropic adapter", () => {
    const adapter = getExecutionAdapter("anthropic");
    assert.strictEqual(adapter, anthropicExecutionAdapter);
    assert.strictEqual(adapter.adapterType, "anthropic");
  });

  await test("getExecutionAdapter handles case/whitespace and unknown types", () => {
    assert.strictEqual(
      getExecutionAdapter(" OPENCLAW "),
      openclawExecutionAdapter,
      "should trim and lowercase",
    );
    assert.strictEqual(
      getExecutionAdapter(null),
      openclawExecutionAdapter,
      "null falls back to OpenClaw default",
    );
    assert.strictEqual(
      getExecutionAdapter(undefined),
      openclawExecutionAdapter,
      "undefined falls back to OpenClaw default",
    );
    assert.strictEqual(
      getExecutionAdapter("mystery-adapter"),
      openclawExecutionAdapter,
      "unknown type falls back to OpenClaw default",
    );
  });

  await test("Anthropic stub execute() returns a loud not-yet-wired error", async () => {
    const result = await anthropicExecutionAdapter.execute(stubInput());
    assert.strictEqual(result.sessionId, undefined);
    assert.ok(
      typeof result.error === "string" && result.error.includes("not yet wired"),
      `expected not-yet-wired error, got: ${result.error}`,
    );
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
