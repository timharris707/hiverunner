import assert from "node:assert";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
        ANTHROPIC_API_KEY: "anthropic-provider-key",
        ORCHESTRATION_DB_PATH: "/tmp/control.db",
        MC_DATA_DIR: "/tmp/data",
        MC_ENGINE_TICK: "on",
        MC_WORKSPACE_ROOT: "/tmp/workspace",
        PORT: "3021",
      },
      {
        PATH: "/custom/bin:/bin",
        HIVERUNNER_EXTERNAL_RUNNER: "1",
        OPENAI_BASE_URL: "https://example.test",
      },
    );

    assert.strictEqual(env.HOME, "/tmp/home");
    assert.strictEqual(env.OPENAI_API_KEY, undefined);
    assert.strictEqual(env.OPENAI_BASE_URL, undefined);
    assert.strictEqual(env.ANTHROPIC_API_KEY, undefined);
    assert.strictEqual(env.PATH, "/custom/bin:/bin");
    assert.strictEqual(env.HIVERUNNER_EXTERNAL_RUNNER, "1");
    assert.strictEqual(env.ORCHESTRATION_DB_PATH, undefined);
    assert.strictEqual(env.MC_DATA_DIR, undefined);
    assert.strictEqual(env.MC_ENGINE_TICK, undefined);
    assert.strictEqual(env.MC_WORKSPACE_ROOT, undefined);
    assert.strictEqual(env.PORT, undefined);
  });

  await test("wrapper script env strips provider API keys after overrides", async () => {
    const moduleUrl = pathToFileURL(path.join(process.cwd(), "scripts", "lib", "external-runner-utils.mjs")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          process.env.OPENAI_API_KEY = "base-openai-key";
          process.env.ANTHROPIC_API_KEY = "base-anthropic-key";
          const { buildExternalRunnerEnv } = await import(${JSON.stringify(moduleUrl)});
          const env = buildExternalRunnerEnv({
            PATH: "/custom/bin",
            OPENAI_API_KEY: "override-openai-key",
            CLAUDE_API_KEY: "override-claude-key",
          });
          if (env.PATH !== "/custom/bin") throw new Error("PATH override was not preserved");
          if (env.OPENAI_API_KEY !== undefined) throw new Error("OPENAI_API_KEY was not stripped");
          if (env.ANTHROPIC_API_KEY !== undefined) throw new Error("ANTHROPIC_API_KEY was not stripped");
          if (env.CLAUDE_API_KEY !== undefined) throw new Error("CLAUDE_API_KEY was not stripped");
        `,
      ],
      { encoding: "utf8" },
    );

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
