/**
 * Contract tests for the execution adapter registry (E7).
 * Run:
 *   npx tsx src/lib/__tests__/orchestration-execution-adapter-registry.test.ts
 *
 * Verifies that getExecutionAdapter dispatches by type, defaults to
 * the neutral manual adapter when the type is missing/unknown, and that the
 * provider adapters are registered without making OpenClaw the implicit sink.
 */

import assert from "node:assert";

import {
  anthropicExecutionAdapter,
  codexExecutionAdapter,
  geminiExecutionAdapter,
  getExecutionAdapter,
  hermesExecutionAdapter,
  manualExecutionAdapter,
  openclawExecutionAdapter,
  symphonyExecutionAdapter,
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
      runtime_workspace_root: null,
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

  await test("getExecutionAdapter('codex') returns the Codex adapter", () => {
    const adapter = getExecutionAdapter("codex");
    assert.strictEqual(adapter, codexExecutionAdapter);
    assert.strictEqual(adapter.adapterType, "codex");
  });

  await test("getExecutionAdapter('hermes') returns the HERMES adapter", () => {
    const adapter = getExecutionAdapter("hermes");
    assert.strictEqual(adapter, hermesExecutionAdapter);
    assert.strictEqual(adapter.adapterType, "hermes");
  });

  await test("getExecutionAdapter('gemini') returns the Gemini adapter", () => {
    const adapter = getExecutionAdapter("gemini");
    assert.strictEqual(adapter, geminiExecutionAdapter);
    assert.strictEqual(adapter.adapterType, "gemini");
  });

  await test("getExecutionAdapter('symphony') returns the Symphony adapter", () => {
    const adapter = getExecutionAdapter("symphony");
    assert.strictEqual(adapter, symphonyExecutionAdapter);
    assert.strictEqual(adapter.adapterType, "symphony");
  });

  await test("getExecutionAdapter handles case/whitespace and uses manual fallback", () => {
    assert.strictEqual(
      getExecutionAdapter(" OPENCLAW "),
      openclawExecutionAdapter,
      "should trim and lowercase",
    );
    assert.strictEqual(
      getExecutionAdapter(null),
      manualExecutionAdapter,
      "null falls back to neutral manual adapter",
    );
    assert.strictEqual(
      getExecutionAdapter(undefined),
      manualExecutionAdapter,
      "undefined falls back to neutral manual adapter",
    );
    assert.strictEqual(
      getExecutionAdapter("mystery-adapter"),
      manualExecutionAdapter,
      "unknown type falls back to neutral manual adapter",
    );
  });

  await test("Anthropic adapter exposes the Claude Code execution surface", () => {
    assert.strictEqual(anthropicExecutionAdapter.adapterType, "anthropic");
    assert.strictEqual(typeof anthropicExecutionAdapter.execute, "function");
    assert.strictEqual(typeof anthropicExecutionAdapter.clearTaskSessionForSelfHeal, "function");
  });

  await test("HERMES adapter exposes the ACP execution surface", () => {
    assert.strictEqual(hermesExecutionAdapter.adapterType, "hermes");
    assert.strictEqual(typeof hermesExecutionAdapter.execute, "function");
    assert.strictEqual(typeof hermesExecutionAdapter.clearTaskSessionForSelfHeal, "function");
  });

  await test("Gemini adapter exposes the Gemini CLI execution surface", () => {
    assert.strictEqual(geminiExecutionAdapter.adapterType, "gemini");
    assert.strictEqual(typeof geminiExecutionAdapter.execute, "function");
    assert.strictEqual(typeof geminiExecutionAdapter.clearTaskSessionForSelfHeal, "function");
  });

  await test("Symphony adapter exposes the HiveRunner command execution surface", () => {
    assert.strictEqual(symphonyExecutionAdapter.adapterType, "symphony");
    assert.strictEqual(typeof symphonyExecutionAdapter.execute, "function");
    assert.strictEqual(typeof symphonyExecutionAdapter.clearTaskSessionForSelfHeal, "function");
  });

  await test("Manual fallback execute() returns a no-runtime error", async () => {
    const result = await manualExecutionAdapter.execute(stubInput({
      agent: {
        ...stubInput().agent,
        adapter_type: "manual",
      },
    }));
    assert.strictEqual(result.sessionId, undefined);
    assert.ok(
      typeof result.error === "string" && result.error.includes("no executable runtime configured"),
      `expected no-runtime error, got: ${result.error}`,
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
