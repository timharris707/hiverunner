import assert from "node:assert/strict";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { getRuntimeLaneStatus } from "@/lib/orchestration/runtime-lane-status";

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]" });

async function run() {
  console.log("\nRuntime Lane Status Tests\n");

  await test("port 3010 is always observer-only even when engine tick is requested", () => {
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

  await test("stable non-3010 lane defaults to executor", () => {
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

  await test("explicit off on a non-3010 lane reports observer truth", () => {
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

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
