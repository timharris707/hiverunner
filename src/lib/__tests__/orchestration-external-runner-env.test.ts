import assert from "node:assert";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { buildExternalRunnerEnv } from "@/lib/orchestration/execution/adapters/child-env";

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

async function run() {
  console.log("\nExternal Runner Env Tests\n");

  await test("child CLI env strips HiveRunner control-plane state", () => {
    const env = buildExternalRunnerEnv(
      {
        HOME: "/tmp/home",
        PATH: "/bin",
        OPENAI_API_KEY: "provider-key",
        ORCHESTRATION_DB_PATH: "/tmp/control.db",
        MC_DATA_DIR: "/tmp/data",
        MC_ENGINE_TICK: "on",
        MC_WORKSPACE_ROOT: "/tmp/workspace",
        PORT: "3021",
      },
      {
        PATH: "/custom/bin:/bin",
        HIVERUNNER_EXTERNAL_RUNNER: "1",
      },
    );

    assert.strictEqual(env.HOME, "/tmp/home");
    assert.strictEqual(env.OPENAI_API_KEY, "provider-key");
    assert.strictEqual(env.PATH, "/custom/bin:/bin");
    assert.strictEqual(env.HIVERUNNER_EXTERNAL_RUNNER, "1");
    assert.strictEqual(env.ORCHESTRATION_DB_PATH, undefined);
    assert.strictEqual(env.MC_DATA_DIR, undefined);
    assert.strictEqual(env.MC_ENGINE_TICK, undefined);
    assert.strictEqual(env.MC_WORKSPACE_ROOT, undefined);
    assert.strictEqual(env.PORT, undefined);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
