import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import {
  GET as getDevExecutionTestModeRoute,
  PATCH as patchDevExecutionTestModeRoute,
} from "@/app/api/orchestration/companies/[slug]/settings/dev-execution-test-mode/route";
import {
  canAutonomouslyExecuteCompany,
  getDevExecutionTestModeView,
  resolveQueuedHeartbeatClaimCompanyId,
} from "@/lib/orchestration/service/dev-execution-test-mode";

let passed = 0;
let failed = 0;

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  MC_DEV_EXECUTION_TEST_MODE: process.env.MC_DEV_EXECUTION_TEST_MODE,
  MC_DATA_DIR: process.env.MC_DATA_DIR,
  MC_WORKSPACE_ROOT: process.env.MC_WORKSPACE_ROOT,
};

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nDev Execution Test Mode Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  process.env.NODE_ENV = "development";
  process.env.PORT = "3010";
  process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
  process.env.MC_DATA_DIR = process.env.MC_DATA_DIR || "/tmp/mc-dev-execution-test-mode-data-dev";
  process.env.MC_WORKSPACE_ROOT =
    process.env.MC_WORKSPACE_ROOT || "/tmp/mc-dev-execution-test-mode-workspaces";

  const company = createCompany({
    name: `Dev Lease Company ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;
  const otherCompany = createCompany({
    name: `Dev Lease Other ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  await test("GET exposes dev-only test mode as available but off by default", async () => {
    const res = await getDevExecutionTestModeRoute({} as never, {
      params: Promise.resolve({ slug: company.slug }),
    });
    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      available: boolean;
      activeLease: { company: { id: string } } | null;
      activeForCurrentCompany: boolean;
    };
    assert.strictEqual(payload.available, true);
    assert.strictEqual(payload.activeLease, null);
    assert.strictEqual(payload.activeForCurrentCompany, false);
    assert.strictEqual(resolveQueuedHeartbeatClaimCompanyId(), "__disabled__");
    assert.strictEqual(canAutonomouslyExecuteCompany(company.id), false);
  });

  await test("PATCH enable creates a company-scoped lease and claim scope", async () => {
    const req = new Request("http://localhost/api/orchestration/companies/settings/dev-execution-test-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, durationMinutes: 15, actor: "test" }),
    });

    const res = await patchDevExecutionTestModeRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });
    assert.strictEqual(res.status, 200);
    const payload = await res.json() as {
      activeLease: { company: { id: string }; remainingSeconds: number };
      activeForCurrentCompany: boolean;
    };
    assert.strictEqual(payload.activeForCurrentCompany, true);
    assert.strictEqual(payload.activeLease.company.id, company.id);
    assert(payload.activeLease.remainingSeconds > 0);
    assert.strictEqual(resolveQueuedHeartbeatClaimCompanyId(), company.id);
    assert.strictEqual(canAutonomouslyExecuteCompany(company.id), true);
    assert.strictEqual(canAutonomouslyExecuteCompany(otherCompany.id), false);
  });

  await test("PATCH refuses to steal the lease for another company", async () => {
    const req = new Request("http://localhost/api/orchestration/companies/settings/dev-execution-test-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, durationMinutes: 15, actor: "test" }),
    });

    const res = await patchDevExecutionTestModeRoute(req as never, {
      params: Promise.resolve({ slug: otherCompany.slug }),
    });
    assert.strictEqual(res.status, 409);
    const payload = await res.json() as { error?: { code?: string } };
    assert.strictEqual(payload.error?.code, "dev_execution_test_mode_in_use");
  });

  await test("PATCH disable clears the lease and restores observer-only scope", async () => {
    const req = new Request("http://localhost/api/orchestration/companies/settings/dev-execution-test-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, actor: "test" }),
    });

    const res = await patchDevExecutionTestModeRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });
    assert.strictEqual(res.status, 200);
    const payload = await res.json() as { activeLease: null; activeForCurrentCompany: boolean };
    assert.strictEqual(payload.activeLease, null);
    assert.strictEqual(payload.activeForCurrentCompany, false);
    assert.strictEqual(resolveQueuedHeartbeatClaimCompanyId(), "__disabled__");
    assert.strictEqual(canAutonomouslyExecuteCompany(company.id), false);
  });

  await test("service view explains why the control disappears when gate is off", () => {
    process.env.MC_DEV_EXECUTION_TEST_MODE = "0";
    const view = getDevExecutionTestModeView(company.slug);
    assert.strictEqual(view.available, false);
    assert.match(view.reason ?? "", /MC_DEV_EXECUTION_TEST_MODE=1/);
    process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);

  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  process.env.PORT = ORIGINAL_ENV.PORT;
  process.env.MC_DEV_EXECUTION_TEST_MODE = ORIGINAL_ENV.MC_DEV_EXECUTION_TEST_MODE;
  process.env.MC_DATA_DIR = ORIGINAL_ENV.MC_DATA_DIR;
  process.env.MC_WORKSPACE_ROOT = ORIGINAL_ENV.MC_WORKSPACE_ROOT;

  process.exit(failed === 0 ? 0 : 1);
}

void run();
