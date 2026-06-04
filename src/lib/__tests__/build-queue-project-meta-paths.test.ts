import assert from "node:assert";

import { __testHooks } from "@/lib/build-queue";
import { createTestRunner } from "./helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function run() {
  console.log("\nBuild Queue Project Meta Path Tests\n");

  await test("hiverunner tasks resolve under MC_APP_ROOT even when WORKSPACE_ROOT points elsewhere", () => {
    withEnv(
      {
        MC_APP_ROOT: "/Users/timharris/.hiverunner/app",
        WORKSPACE_ROOT: "/Users/timharris/.openclaw/workspace",
      },
      () => {
        const meta = __testHooks.getProjectMeta({ project: "hiverunner", title: "x" }, []);
        assert.strictEqual(meta.projectDir, "/Users/timharris/.hiverunner/app/projects/hiverunner");
      },
    );
  });

  await test("hiverunner-orchestration tasks also resolve under MC_APP_ROOT", () => {
    withEnv(
      {
        MC_APP_ROOT: "/Users/timharris/.hiverunner/app",
        WORKSPACE_ROOT: "/Users/timharris/.openclaw/workspace",
      },
      () => {
        const meta = __testHooks.getProjectMeta({ project: "hiverunner-orchestration", title: "x" }, []);
        assert.strictEqual(meta.projectDir, "/Users/timharris/.hiverunner/app/projects/hiverunner");
      },
    );
  });

  await test("non HiveRunner projects still use workspace-root search behavior", () => {
    withEnv(
      {
        MC_APP_ROOT: "/Users/timharris/.hiverunner/app",
        WORKSPACE_ROOT: process.cwd(),
      },
      () => {
        const meta = __testHooks.getProjectMeta({ project: "ops-automation", title: "x" }, []);
        assert.ok(meta.projectDir.endsWith("projects/ops-automation"));
      },
    );
  });

  finish();
}

run();
