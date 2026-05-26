import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  normalizeExecutionRouteRuntimeProvider,
  resolveExecutionRoute,
} from "@/lib/orchestration/execution-route-resolver";
import { normalizeRouteModelForRunner } from "@/lib/orchestration/route-target-builder";
import { ensureCompanyExecutionHives } from "@/lib/orchestration/service/execution-hives";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-execution-route-resolver-${Date.now()}.db`,
  );
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  pass ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  fail ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

async function run() {
  console.log("\nExecution Route Resolver Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const company = createCompany({
    name: `Execution Route Resolver ${Date.now()}`,
    description: "Execution route resolver fixture",
    status: "active",
  }).company;
  const db = getOrchestrationDb();

  await test("throws loudly when no active hive exists", () => {
    assert.throws(
      () => resolveExecutionRoute({ companyId: company.id, modelLane: "default" }, db),
      /No active execution hive is configured/,
    );
  });

  await test("resolves each seeded lane from the active hive", () => {
    ensureCompanyExecutionHives({ companyIdOrSlug: company.slug }, db);

    const defaultRoute = resolveExecutionRoute({ companyId: company.id, modelLane: "default" }, db);
    assert.equal(defaultRoute.executionEngine, "hiverunner");
    assert.equal(defaultRoute.laneId, "default");
    assert.equal(defaultRoute.primary.runtimeProvider, "anthropic");
    assert.equal(defaultRoute.primary.model, null);
    assert.deepEqual(defaultRoute.fallbacks.map((fallback) => fallback.runtimeProvider), ["codex", "hermes"]);

    const deepRoute = resolveExecutionRoute({ companyId: company.id, modelLane: "deep" }, db);
    assert.equal(deepRoute.laneId, "deep");
    assert.equal(deepRoute.primary.runtimeProvider, "anthropic");
    assert.equal(deepRoute.primary.model, null);
    assert.deepEqual(deepRoute.fallbacks.map((fallback) => fallback.runtimeProvider), ["codex"]);

    const fastRoute = resolveExecutionRoute({ companyId: company.id, modelLane: "fast" }, db);
    assert.equal(fastRoute.laneId, "fast");
    assert.equal(fastRoute.primary.runtimeProvider, "codex");
    assert.deepEqual(fastRoute.fallbacks.map((fallback) => fallback.runtimeProvider), ["gemini"]);
  });

  await test("unknown lane defaults to the default lane without changing requested lane audit", () => {
    const route = resolveExecutionRoute({ companyId: company.id, modelLane: "unknown-lane" }, db);
    assert.equal(route.requestedLaneId, "default");
    assert.equal(route.laneId, "default");
    assert.equal(route.primary.runtimeProvider, "anthropic");
  });

  await test("task Symphony engine overrides a HiveRunner active hive for dispatch metadata", () => {
    const route = resolveExecutionRoute({
      companyId: company.id,
      task: {
        executionEngine: "symphony",
        modelLane: "deep",
      },
    }, db);

    assert.equal(route.executionEngine, "symphony");
    assert.equal(route.laneId, "deep");
    assert.equal(route.primary.runtimeProvider, "anthropic");
  });

  await test("assigned agent profile drives runner provider and model under Symphony", () => {
    const route = resolveExecutionRoute({
      companyId: company.id,
      task: {
        executionEngine: "symphony",
        modelLane: "deep",
      },
      agent: {
        adapterType: "codex",
        model: "openai-codex/gpt-5.5",
      },
    }, db);

    assert.equal(route.executionEngine, "symphony");
    assert.equal(route.primary.runtimeProvider, "codex");
    assert.equal(route.primary.model, "gpt-5.5");
    assert.equal(route.laneId, "deep");
  });

  await test("does not silently normalize OpenAI to Codex", () => {
    assert.equal(normalizeExecutionRouteRuntimeProvider("openai"), null);
    assert.equal(normalizeExecutionRouteRuntimeProvider("OpenAI Direct"), null);
    assert.equal(normalizeExecutionRouteRuntimeProvider("codex"), "codex");
  });

  await test("normalizes generic route labels before runner handoff", () => {
    const genericLabels = [
      "runtime managed",
      "Hive managed",
      "mini/fast model",
      "deep profile",
      "deep reasoning profile",
      "vision-capable model",
      "local capable model",
      "cheap capable fallback",
      "Anthropic Direct",
      "OpenAI Direct",
      "profile managed",
      "platform managed",
      "direct managed",
      "broker managed",
      "Gemini vision-capable model",
    ];
    for (const label of genericLabels) {
      assert.equal(normalizeRouteModelForRunner(label), null, label);
    }

    assert.equal(normalizeRouteModelForRunner("claude-sonnet-4-6"), "claude-sonnet-4-6");
    assert.equal(normalizeRouteModelForRunner("gpt-5"), "gpt-5");
    assert.equal(normalizeRouteModelForRunner("gemini-2.5-pro"), "gemini-2.5-pro");
  });

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }
  console.log(`\n${passed} passed`);
}

void run();
