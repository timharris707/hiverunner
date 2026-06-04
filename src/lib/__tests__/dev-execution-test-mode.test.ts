import assert from "node:assert";

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
import { sweepOpenTasks } from "@/lib/orchestration/engine/sweeper";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { restoreEnvSnapshot, setTestNodeEnv, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const ENV_KEYS = [
  "NODE_ENV",
  "PORT",
  "MC_ENGINE_TICK",
  "MC_DEV_EXECUTION_TEST_MODE",
  "MC_DATA_DIR",
  "MC_WORKSPACE_ROOT",
] as const;

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

function patchDevExecutionLease(
  slug: string,
  body: { actor: string; durationMinutes?: number; enabled: boolean },
) {
  const req = new Request("http://localhost/api/orchestration/companies/settings/dev-execution-test-mode", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return patchDevExecutionTestModeRoute(req as never, {
    params: Promise.resolve({ slug }),
  });
}

async function run() {
  console.log("\nDev Execution Test Mode Tests\n");

  const envSnapshot = snapshotEnv(ENV_KEYS);

  try {
    resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

    setTestNodeEnv("development");
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
    const project = createProject({
      companyId: company.id,
      name: `Dev Lease Project ${Date.now()}`,
      description: "fixture project",
      color: "#f97316",
      emoji: "T",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: `Dev Lease Agent ${Date.now()}`,
      emoji: "A",
      role: "Engineer",
      personality: "Deterministic",
      openclawAgentId: `dev-lease-${Date.now()}`,
      status: "idle",
      skills: ["qa"],
    }).agent;
    createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Dev lease sweep guard task",
      description: "Fixture task that should not be swept without an active lease.",
      priority: "P2",
      type: "feature",
      status: "to-do",
      assignee: agent.id,
      labels: [],
      createdBy: "test-suite",
    });

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
      const sweep = sweepOpenTasks(getOrchestrationDb());
      assert.strictEqual(sweep.wakesEnqueued, 0);
      assert.strictEqual(sweep.skippedReasons.dev_execution_test_mode_inactive, 1);
    });

    await test("PATCH enable creates a persistent company-scoped lease and claim scope", async () => {
      const res = await patchDevExecutionLease(company.slug, { enabled: true, actor: "test" });
      assert.strictEqual(res.status, 200);
      const payload = await res.json() as {
        activeLease: { company: { id: string }; remainingSeconds: number; indefinite: boolean; enabledUntil: string };
        activeForCurrentCompany: boolean;
      };
      assert.strictEqual(payload.activeForCurrentCompany, true);
      assert.strictEqual(payload.activeLease.company.id, company.id);
      assert.strictEqual(payload.activeLease.indefinite, true);
      assert.strictEqual(payload.activeLease.enabledUntil, "9999-12-31T23:59:59.999Z");
      assert.strictEqual(resolveQueuedHeartbeatClaimCompanyId(), company.id);
      assert.strictEqual(canAutonomouslyExecuteCompany(company.id), true);
      assert.strictEqual(canAutonomouslyExecuteCompany(otherCompany.id), false);
    });

    await test("PATCH refuses to steal the lease for another company", async () => {
      const res = await patchDevExecutionLease(otherCompany.slug, {
        enabled: true,
        durationMinutes: 15,
        actor: "test",
      });
      assert.strictEqual(res.status, 409);
      const payload = await res.json() as { error?: { code?: string } };
      assert.strictEqual(payload.error?.code, "dev_execution_test_mode_in_use");
    });

    await test("PATCH disable clears the lease and restores observer-only scope", async () => {
      const res = await patchDevExecutionLease(company.slug, { enabled: false, actor: "test" });
      assert.strictEqual(res.status, 200);
      const payload = await res.json() as { activeLease: null; activeForCurrentCompany: boolean };
      assert.strictEqual(payload.activeLease, null);
      assert.strictEqual(payload.activeForCurrentCompany, false);
      assert.strictEqual(resolveQueuedHeartbeatClaimCompanyId(), "__disabled__");
      assert.strictEqual(canAutonomouslyExecuteCompany(company.id), false);
    });

    await test("PATCH enable still supports explicit temporary hour-scale leases for scripts", async () => {
      const res = await patchDevExecutionLease(company.slug, {
        enabled: true,
        durationMinutes: 360,
        actor: "test",
      });
      assert.strictEqual(res.status, 200);
      const payload = await res.json() as {
        activeLease: { company: { id: string }; remainingSeconds: number; indefinite: boolean };
        activeForCurrentCompany: boolean;
        maxDurationMinutes: number;
      };
      assert.strictEqual(payload.activeForCurrentCompany, true);
      assert.strictEqual(payload.activeLease.company.id, company.id);
      assert.strictEqual(payload.activeLease.indefinite, false);
      assert(payload.activeLease.remainingSeconds > 5 * 60 * 60);
      assert.strictEqual(payload.maxDurationMinutes, 720);

      const disableRes = await patchDevExecutionLease(company.slug, { enabled: false, actor: "test" });
      assert.strictEqual(disableRes.status, 200);
    });

    await test("service view explains why the control disappears when gate is off", () => {
      process.env.MC_DEV_EXECUTION_TEST_MODE = "0";
      const view = getDevExecutionTestModeView(company.slug);
      assert.strictEqual(view.available, false);
      assert.match(view.reason ?? "", /MC_DEV_EXECUTION_TEST_MODE=1/);
      process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
    });

    await test("explicit non-3010 dev executor can claim queued work without a lease", () => {
      process.env.PORT = "3002";
      process.env.MC_ENGINE_TICK = "on";
      process.env.MC_DEV_EXECUTION_TEST_MODE = "0";
      assert.strictEqual(canAutonomouslyExecuteCompany(company.id), true);
      assert.strictEqual(resolveQueuedHeartbeatClaimCompanyId(), null);

      process.env.MC_ENGINE_TICK = "off";
      assert.strictEqual(canAutonomouslyExecuteCompany(company.id), false);
      assert.strictEqual(resolveQueuedHeartbeatClaimCompanyId(), "__disabled__");
    });
  } finally {
    restoreEnvSnapshot(envSnapshot);
  }

  finish();
}

void run();
