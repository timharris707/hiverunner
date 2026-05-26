import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { GET as getCompanyHivesRoute } from "@/app/api/orchestration/companies/[slug]/hives/route";
import { POST as activateCompanyHiveRoute } from "@/app/api/orchestration/companies/[slug]/hives/[hiveId]/activate/route";
import { POST as configureCompanyHiveRoute } from "@/app/api/orchestration/companies/[slug]/hives/[hiveId]/configure/route";
import { POST as probeCompanyHiveRoute } from "@/app/api/orchestration/companies/[slug]/hives/[hiveId]/probe/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

function resetDb() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) return;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

async function run() {
  console.log("\nExecution Hive Route Tests\n");
  resetDb();

  const company = createCompany({
    name: `Hive Route ${Date.now()}`,
    slug: `hive-route-${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  await test("GET returns persisted hives and active/default metadata", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/hives`),
    };
    const res = await getCompanyHivesRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });

    assert.equal(res.status, 200);
    const payload = await res.json() as {
      hives: Array<{ id: string; isActive?: boolean }>;
      activeHive: { id: string } | null;
      executionDefaults: Record<string, unknown>;
    };
    assert.equal(payload.hives.length, 4);
    assert.ok(payload.hives.some((hive) => hive.id === "balanced-builder"));
    assert.equal(payload.activeHive?.id, "balanced-builder");
    assert.deepEqual(payload.executionDefaults, {});
  });

  await test("POST activate updates active hive and company defaults", async () => {
    const req = new Request(
      `http://localhost/api/orchestration/companies/${company.slug}/hives/max-quality/activate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const res = await activateCompanyHiveRoute(req as never, {
      params: Promise.resolve({ slug: company.slug, hiveId: "max-quality" }),
    });

    assert.equal(res.status, 200);
    const payload = await res.json() as {
      hive: { id: string; isActive: boolean };
      hives: Array<{ id: string; isActive?: boolean }>;
      activeHive: { id: string } | null;
      executionDefaults: {
        defaultEngine: string;
        defaultModelLane: string;
        defaultRuntimeProvider: string;
        defaultRuntimeLabel: string;
        defaultModelRouting: string;
        defaultModelRoutingLabel: string;
        activeHiveId: string;
        activeHiveSlug: string;
        activeHiveName: string;
      };
    };
    assert.equal(payload.hive.id, "max-quality");
    assert.equal(payload.hive.isActive, true);
    assert.equal(payload.activeHive?.id, "max-quality");
    assert.deepEqual(payload.hives.filter((hive) => hive.isActive).map((hive) => hive.id), ["max-quality"]);
    assert.equal(payload.executionDefaults.defaultEngine, "hiverunner");
    assert.equal(payload.executionDefaults.defaultModelLane, "default");
    assert.equal(payload.executionDefaults.activeHiveSlug, "max-quality");
    assert.equal(payload.executionDefaults.defaultRuntimeProvider, "anthropic");

    const db = getOrchestrationDb();
    const settingsRow = db
      .prepare("SELECT settings_json FROM companies WHERE id = ?")
      .get(company.id) as { settings_json: string };
    const settings = JSON.parse(settingsRow.settings_json) as { execution?: Record<string, unknown> };
    assert.equal(settings.execution?.activeHiveId, "max-quality");
  });

  await test("POST configure updates matrix fields and active company defaults", async () => {
    const req = new Request(
      `http://localhost/api/orchestration/companies/${company.slug}/hives/max-quality/configure`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orchestrationMode: "symphony",
          runtimeProvider: "gemini",
          runtimeLabel: "Gemini CLI",
          modelRouting: "openrouter",
          modelRoutingLabel: "OpenRouter",
        }),
      },
    );
    const res = await configureCompanyHiveRoute(req as never, {
      params: Promise.resolve({ slug: company.slug, hiveId: "max-quality" }),
    });

    assert.equal(res.status, 200);
    const payload = await res.json() as {
      hive: {
        orchestrationMode: string;
        runtimePriority: string[];
        routingPolicy: string;
      };
      executionDefaults: {
        defaultEngine: string;
        defaultRuntimeProvider: string;
        defaultModelRouting: string;
      };
    };
    assert.equal(payload.hive.orchestrationMode, "symphony");
    assert.equal(payload.hive.runtimePriority[0], "Gemini CLI");
    assert.match(payload.hive.routingPolicy, /OpenRouter/);
    assert.equal(payload.executionDefaults.defaultEngine, "symphony");
    assert.equal(payload.executionDefaults.defaultRuntimeProvider, "gemini");
    assert.equal(payload.executionDefaults.defaultModelRouting, "openrouter");
  });

  await test("POST probe runs a live hive lane check and returns updated verification", async () => {
    const req = new Request(
      `http://localhost/api/orchestration/companies/${company.slug}/hives/max-quality/probe`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          laneId: "default",
          kind: "lane",
        }),
      },
    );
    const res = await probeCompanyHiveRoute(req as never, {
      params: Promise.resolve({ slug: company.slug, hiveId: "max-quality" }),
    });

    assert.equal(res.status, 200);
    const payload = await res.json() as {
      probe: { laneId: string; status: string; note?: string };
      hive: { id: string; lanes: Array<{ id: string; verificationStatus: string }> };
      runtimeSummary: { checkedRuntimes: number };
    };
    assert.equal(payload.hive.id, "max-quality");
    assert.equal(payload.probe.laneId, "default");
    assert.ok(["pass", "warn", "fail"].includes(payload.probe.status));
    assert.ok(payload.probe.note);
    assert.ok(payload.runtimeSummary.checkedRuntimes >= 0);
    assert.ok(payload.hive.lanes.some((lane) => lane.id === "default"));
  });

  if (failed > 0) throw new Error(`${failed} execution hive route test(s) failed`);
  console.log(`\n${passed} execution hive route tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
