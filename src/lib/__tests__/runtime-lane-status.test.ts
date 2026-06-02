import assert from "node:assert/strict";

import { getRuntimeLaneStatus } from "@/lib/orchestration/runtime-lane-status";

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

console.log("\nRuntime Lane Status Tests\n");

test("port 3010 is always observer-only even when engine tick is requested", () => {
  const status = getRuntimeLaneStatus({
    NODE_ENV: "development",
    PORT: "3010",
    MC_ENGINE_TICK: "on",
    MC_DEV_EXECUTION_TEST_MODE: "1",
  } as NodeJS.ProcessEnv);

  assert.equal(status.role, "observer");
  assert.equal(status.engineTick, "disabled");
  assert.equal(status.engineTickActive, false);
  assert.equal(status.engineTickForcedObserver, true);
  assert.equal(status.observerOnly, true);
  assert.match(status.executionDisabledReason ?? "", /Port 3010/);
});

test("stable non-3010 lane defaults to executor", () => {
  const status = getRuntimeLaneStatus({
    NODE_ENV: "production",
    PORT: "3001",
  } as NodeJS.ProcessEnv);

  assert.equal(status.mode, "stable");
  assert.equal(status.role, "executor");
  assert.equal(status.engineTick, "active");
  assert.equal(status.observerOnly, false);
  assert.equal(status.executionDisabledReason, null);
});

test("explicit off on a non-3010 lane reports observer truth", () => {
  const status = getRuntimeLaneStatus({
    NODE_ENV: "production",
    PORT: "3001",
    MC_ENGINE_TICK: "off",
  } as NodeJS.ProcessEnv);

  assert.equal(status.role, "observer");
  assert.equal(status.engineTick, "disabled");
  assert.equal(status.observerOnly, true);
  assert.match(status.executionDisabledReason ?? "", /MC_ENGINE_TICK=off/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
