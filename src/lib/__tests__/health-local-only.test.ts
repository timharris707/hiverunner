import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [pass] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [fail] ${name}`);
      console.error(`    ${message}`);
    });
}

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

  const tempRoot = path.join(os.tmpdir(), `hiverunner-health-local-${Date.now()}`);
  const dbPath = process.env.ORCHESTRATION_DB_PATH || path.join(tempRoot, "orchestration.db");
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  process.env.ORCHESTRATION_DB_PATH = dbPath;
  process.env.MC_DATA_DIR = tempRoot;
  process.env.NODE_ENV = "development";

  const { closeOrchestrationDb, getOrchestrationDb } = await import("@/lib/orchestration/db");
  getOrchestrationDb().prepare("SELECT 1").get();
  closeOrchestrationDb();

  const { GET: platformHealth } = await import("@/app/api/health/route");
  const { GET: hiveRunnerHealth } = await import("@/app/api/hiverunner/health/route");

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
    const payload = await response.json() as { status?: string; migrationCompatibility?: { ok?: boolean } };
    assert.equal(payload.status, "ok");
    assert.equal(payload.migrationCompatibility?.ok, true);
  });

  closeOrchestrationDb();
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
