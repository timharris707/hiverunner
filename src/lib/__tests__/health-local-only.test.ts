import assert from "node:assert/strict";
import path from "node:path";
import { restoreEnvSnapshot, setTestNodeEnv, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const { finish, test } = createTestRunner({ passLabel: "[pass]", failLabel: "[fail]" });

async function withBlockedFetch<T>(fn: () => Promise<T>): Promise<{ result: T; calls: string[] }> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const value = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(value);
    throw new Error(`health route attempted HTTP fetch: ${value}`);
  }) as typeof fetch;

  try {
    return { result: await fn(), calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function run() {
  console.log("\nHealth Local-Only Contract Test\n");

  const envSnapshot = snapshotEnv(["MC_DATA_DIR", "NODE_ENV", "ORCHESTRATION_DB_PATH", "PORT"]);
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({ prefix: "hiverunner-health-local-" });
  const dbPath = process.env.ORCHESTRATION_DB_PATH || path.join(workspaceIsolation.tempRoot, "orchestration.db");
  let closeOrchestrationDb: (() => void) | undefined;

  try {
    resetSqliteDatabaseFiles(dbPath);
    process.env.ORCHESTRATION_DB_PATH = dbPath;
    process.env.MC_DATA_DIR = workspaceIsolation.tempRoot;
    setTestNodeEnv("development");
    process.env.PORT = "3010";

    const dbModule = await import("@/lib/orchestration/db");
    closeOrchestrationDb = dbModule.closeOrchestrationDb;
    dbModule.getOrchestrationDb().prepare("SELECT 1").get();
    closeOrchestrationDb();

    const { GET: platformHealth } = await import("@/app/api/health/route");
    const { GET: hiveRunnerHealth } = await import("@/app/api/hiverunner/health/route");
    const { GET: hiveRunnerBuild } = await import("@/app/api/hiverunner/build/route");

    await test("/api/health uses only local process and DB checks", async () => {
      const { result: response, calls } = await withBlockedFetch(() => platformHealth());
      assert.equal(response.status, 200);
      assert.deepEqual(calls, []);
      const payload = await response.json() as {
        status?: string;
        externalProviderChecks?: string;
        checks?: Array<{ name?: string; url?: string; status?: string }>;
      };
      assert.equal(payload.status, "healthy");
      assert.equal(payload.externalProviderChecks, "disabled");
      assert.ok(payload.checks?.some((check) => check.name === "HiveRunner process" && check.status === "up"));
      assert.ok(payload.checks?.some((check) => check.name === "Orchestration DB" && check.status === "up"));
      assert.equal(payload.checks?.some((check) => /anthropic|openai|openrouter|gemini/i.test(check.name ?? "")), false);
      assert.equal(payload.checks?.some((check) => /^https?:\/\//i.test(check.url ?? "")), false);
    });

    await test("/api/hiverunner/health remains local-only", async () => {
      const { result: response, calls } = await withBlockedFetch(() => hiveRunnerHealth());
      assert.equal(response.status, 200);
      assert.deepEqual(calls, []);
      const payload = await response.json() as { status?: string; build?: { version?: string }; migrationCompatibility?: { ok?: boolean } };
      assert.equal(payload.status, "ok");
      assert.equal(payload.build?.version, "0.2.0-preview.1");
      assert.equal(payload.migrationCompatibility?.ok, true);
    });

    await test("/api/hiverunner/build exposes local build metadata", async () => {
      const { result: response, calls } = await withBlockedFetch(() => hiveRunnerBuild());
      assert.equal(response.status, 200);
      assert.deepEqual(calls, []);
      const payload = await response.json() as {
        version?: string;
        versionLabel?: string;
        mode?: string;
        lane?: string;
        port?: string;
        displayLabel?: string;
      };
      assert.equal(payload.version, "0.2.0-preview.1");
      assert.equal(payload.versionLabel, "v0.2.0-preview.1");
      assert.equal(payload.mode, "dev");
      assert.equal(payload.lane, "dev");
      assert.equal(payload.port, "3010");
      assert.match(payload.displayLabel ?? "", /^v0\.2\.0-preview\.1/);
    });
  } finally {
    closeOrchestrationDb?.();
    resetSqliteDatabaseFiles(dbPath);
    workspaceIsolation.dispose();
    restoreEnvSnapshot(envSnapshot);
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
