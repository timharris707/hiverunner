import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  resolveHiveRunnerAppRoot,
  resolveHiveRunnerAppRootSource,
  resolveHiveRunnerDataDir,
  resolveHiveRunnerLogDir,
  resolveHiveRunnerStableDir,
} from "@/lib/runtime-paths";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

async function run() {
  console.log("\nRuntime Path Resolution Tests\n");

  await test("MC_APP_ROOT wins over cwd for app root resolution", () => {
    const env = {
      MC_APP_ROOT: "/tmp/mission-control-app",
    };
    assert.strictEqual(resolveHiveRunnerAppRoot(env), "/tmp/mission-control-app");
    assert.strictEqual(resolveHiveRunnerAppRootSource(env), "MC_APP_ROOT");
  });

  await test("data dir defaults under MC_APP_ROOT when MC_DATA_DIR is unset", () => {
    const env = {
      MC_APP_ROOT: "/tmp/mission-control-app",
    };
    assert.strictEqual(
      resolveHiveRunnerDataDir(env),
      "/tmp/mission-control-app/data",
    );
    assert.strictEqual(
      resolveHiveRunnerStableDir(env),
      "/tmp/mission-control-app/.stable",
    );
  });

  await test("MC_DATA_DIR and MC_LOG_DIR override repo-root defaults", () => {
    const env = {
      MC_APP_ROOT: "/tmp/mission-control-app",
      MC_DATA_DIR: "/var/tmp/mc-data",
      MC_LOG_DIR: "/var/tmp/mc-logs",
    };
    assert.strictEqual(resolveHiveRunnerDataDir(env), "/var/tmp/mc-data");
    assert.strictEqual(resolveHiveRunnerLogDir(env), "/var/tmp/mc-logs");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
