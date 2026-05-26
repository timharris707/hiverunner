import assert from "node:assert";

import {
  resolveHiveRunnerAppRoot,
  resolveHiveRunnerAppRootSource,
  resolveHiveRunnerDataDir,
  resolveHiveRunnerLogDir,
  resolveHiveRunnerStableDir,
} from "@/lib/runtime-paths";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  \u2717 ${name}`);
    console.error(`    ${message}`);
  }
}

function run() {
  console.log("\nRuntime Path Resolution Tests\n");

  test("MC_APP_ROOT wins over cwd for app root resolution", () => {
    const env = {
      MC_APP_ROOT: "/tmp/mission-control-app",
    };
    assert.strictEqual(resolveHiveRunnerAppRoot(env), "/tmp/mission-control-app");
    assert.strictEqual(resolveHiveRunnerAppRootSource(env), "MC_APP_ROOT");
  });

  test("data dir defaults under MC_APP_ROOT when MC_DATA_DIR is unset", () => {
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

  test("MC_DATA_DIR and MC_LOG_DIR override repo-root defaults", () => {
    const env = {
      MC_APP_ROOT: "/tmp/mission-control-app",
      MC_DATA_DIR: "/var/tmp/mc-data",
      MC_LOG_DIR: "/var/tmp/mc-logs",
    };
    assert.strictEqual(resolveHiveRunnerDataDir(env), "/var/tmp/mc-data");
    assert.strictEqual(resolveHiveRunnerLogDir(env), "/var/tmp/mc-logs");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
