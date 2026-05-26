import assert from "node:assert";

import { __testHooks } from "@/lib/build-queue";

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

function run() {
  console.log("\nBuild Queue Project Meta Path Tests\n");

  test("hiverunner tasks resolve under MC_APP_ROOT even when WORKSPACE_ROOT points elsewhere", () => {
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

  test("hiverunner-orchestration tasks also resolve under MC_APP_ROOT", () => {
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

  test("non HiveRunner projects still use workspace-root search behavior", () => {
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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
