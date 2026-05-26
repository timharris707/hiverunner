/**
 * Bundle 4 heartbeat timeout contract tests.
 * Run:
 * npx tsx src/lib/__tests__/orchestration-heartbeat-run-timeout.test.ts
 */

import assert from "node:assert/strict";

process.env.ORCHESTRATION_DB_PATH = process.env.ORCHESTRATION_DB_PATH ?? "/tmp/orchestration-heartbeat-timeout.db";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function run() {
  const {
    DEFAULT_CLAUDE_TIMEOUT_MS,
    DEFAULT_CODEX_TIMEOUT_MS,
    DEFAULT_HEARTBEAT_RUN_TIMEOUT_MS,
    getHeartbeatRunTimeoutMs,
  } = await import("@/lib/orchestration/execution-timeouts");

  console.log("\nHeartbeat Run Timeout Tests\n");

  const previous = process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS;

  test("heartbeat run timeout defaults to 90 minutes", () => {
    delete process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS;
    assert.equal(DEFAULT_HEARTBEAT_RUN_TIMEOUT_MS, 90 * 60 * 1000);
    assert.equal(getHeartbeatRunTimeoutMs(), 90 * 60 * 1000);
  });

  test("heartbeat run timeout respects MC_HEARTBEAT_RUN_TIMEOUT_MS", () => {
    process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS = String(123_456);
    assert.equal(getHeartbeatRunTimeoutMs(), 123_456);
  });

  test("engine stale-run guard stays above adapter defaults", () => {
    delete process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS;
    assert.equal(DEFAULT_CLAUDE_TIMEOUT_MS, 60 * 60 * 1000);
    assert.equal(DEFAULT_CODEX_TIMEOUT_MS, 60 * 60 * 1000);
    assert.ok(getHeartbeatRunTimeoutMs() > Math.max(DEFAULT_CLAUDE_TIMEOUT_MS, DEFAULT_CODEX_TIMEOUT_MS));
  });

  if (previous === undefined) {
    delete process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS;
  } else {
    process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS = previous;
  }

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }

  console.log(`\n${passed} passed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
