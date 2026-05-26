/**
 * Validation contract tests for heartbeat settings payloads.
 * Run:
 * npx tsx src/lib/__tests__/orchestration-heartbeat-settings-contract.test.ts
 */

import assert from "node:assert";

import { updateCompanyHeartbeatSettingsSchema } from "@/lib/orchestration/contracts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [PASS] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [FAIL] ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nHeartbeat Settings Validation Contract Tests\n");

  await test("accepts heartbeatEnabled-only updates", () => {
    const parsed = updateCompanyHeartbeatSettingsSchema.parse({
      agentId: "agent-123",
      heartbeatEnabled: false,
    });

    assert.strictEqual(parsed.agentId, "agent-123");
    assert.strictEqual(parsed.heartbeatEnabled, false);
    assert.strictEqual(parsed.intervalSeconds, undefined);
  });

  await test("accepts intervalSeconds-only updates including zero", () => {
    const parsed = updateCompanyHeartbeatSettingsSchema.parse({
      agentId: "agent-123",
      intervalSeconds: 0,
    });

    assert.strictEqual(parsed.agentId, "agent-123");
    assert.strictEqual(parsed.intervalSeconds, 0);
    assert.strictEqual(parsed.heartbeatEnabled, undefined);
  });

  await test("accepts combined heartbeat toggle and interval updates", () => {
    const parsed = updateCompanyHeartbeatSettingsSchema.parse({
      agentId: "agent-123",
      heartbeatEnabled: true,
      intervalSeconds: 300,
    });

    assert.strictEqual(parsed.heartbeatEnabled, true);
    assert.strictEqual(parsed.intervalSeconds, 300);
  });

  await test("rejects empty updates with no mutable heartbeat fields", () => {
    const result = updateCompanyHeartbeatSettingsSchema.safeParse({
      agentId: "agent-123",
    });

    assert.strictEqual(result.success, false);
    if (result.success) {
      throw new Error("Expected empty heartbeat settings update to fail validation");
    }

    assert.ok(
      result.error.issues.some((issue) => issue.message.includes("At least one heartbeat settings field must be provided"))
    );
  });

  await test("rejects negative intervals", () => {
    const result = updateCompanyHeartbeatSettingsSchema.safeParse({
      agentId: "agent-123",
      intervalSeconds: -1,
    });

    assert.strictEqual(result.success, false);
    if (result.success) {
      throw new Error("Expected negative intervalSeconds to fail validation");
    }
  });

  await test("rejects intervals beyond one day", () => {
    const result = updateCompanyHeartbeatSettingsSchema.safeParse({
      agentId: "agent-123",
      intervalSeconds: 86_401,
    });

    assert.strictEqual(result.success, false);
    if (result.success) {
      throw new Error("Expected intervalSeconds above 86400 to fail validation");
    }
  });

  await test("rejects blank agent ids", () => {
    const result = updateCompanyHeartbeatSettingsSchema.safeParse({
      agentId: "   ",
      heartbeatEnabled: true,
    });

    assert.strictEqual(result.success, false);
    if (result.success) {
      throw new Error("Expected blank agentId to fail validation");
    }
  });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
