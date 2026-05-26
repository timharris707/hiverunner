import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { GET as listHivesRoute } from "@/app/api/orchestration/companies/[slug]/hives/route";
import { POST as activateHiveRoute } from "@/app/api/orchestration/companies/[slug]/hives/[hiveId]/activate/route";
import { POST as configureHiveRoute } from "@/app/api/orchestration/companies/[slug]/hives/[hiveId]/configure/route";
import { PATCH as updateLaneRoute } from "@/app/api/orchestration/companies/[slug]/hives/[hiveId]/lanes/[laneId]/route";
import { GET as listAvailableModelsRoute, POST as createAvailableModelRoute } from "@/app/api/orchestration/available-models/route";
import { DELETE as deleteAvailableModelRoute, PATCH as updateAvailableModelRoute } from "@/app/api/orchestration/available-models/[id]/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  upsertCompanyRuntime,
} from "@/lib/orchestration/runtime-registry";
import {
  activateCompanyExecutionHive,
  configureCompanyExecutionHive,
  ensureCompanyExecutionHives,
  listCompanyExecutionHives,
  recordCompanyModelSourceProbe,
  runCompanyExecutionHiveProbe,
  updateCompanyExecutionHiveLane,
} from "@/lib/orchestration/service/execution-hives";
import { routeTargetForModelChoice } from "@/lib/orchestration/route-target-builder";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-execution-hives-${Date.now()}.db`,
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

function makeGetRequest(url: string) {
  return {
    nextUrl: new URL(url),
  };
}

function makePostRequest(body: unknown = {}) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    async json() {
      return body;
    },
  };
}

async function run() {
  console.log("\nExecution Hives Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const company = createCompany({
    name: `Execution Hives ${Date.now()}`,
    description: "Execution Hives fixture",
    status: "active",
  }).company;
  const db = getOrchestrationDb();

  await test("seeds company execution hives and keeps one active", () => {
    const result = ensureCompanyExecutionHives({ companyIdOrSlug: company.slug }, db);
    assert.ok(result.hives.length >= 4);
    assert.equal(result.hives.filter((hive) => hive.isActive).length, 1);
    assert.ok(result.hives.some((hive) => hive.name === "Balanced Builder"));
    assert.equal(result.activeHive?.id, "balanced-builder");
  });

  await test("activation persists active hive and company execution defaults", () => {
    db.prepare("UPDATE companies SET settings_json = ? WHERE id = ?").run(
      JSON.stringify({ unrelated: { keep: true }, execution: { previous: "value" } }),
      company.id,
    );

    const result = activateCompanyExecutionHive({ companyIdOrSlug: company.slug, hiveId: "cost-saver" }, db);
    assert.equal(result.hive.name, "Cost Saver");
    assert.equal(result.hive.isActive, true);
    assert.equal(result.executionDefaults.defaultEngine, "hiverunner");
    assert.equal(result.executionDefaults.defaultModelLane, "default");
    assert.equal(result.executionDefaults.activeHiveSlug, "cost-saver");

    const hives = listCompanyExecutionHives({ companyIdOrSlug: company.slug }, db).hives;
    assert.deepEqual(hives.filter((hive) => hive.isActive).map((hive) => hive.id), [result.hive.id]);

    const settingsJson = (db
      .prepare("SELECT settings_json FROM companies WHERE id = ?")
      .get(company.id) as { settings_json: string }).settings_json;
    const settings = JSON.parse(settingsJson) as Record<string, unknown>;
    assert.deepEqual(settings.unrelated, { keep: true });
    const execution = settings.execution as Record<string, unknown>;
    assert.equal(execution.previous, "value");
    assert.equal(execution.activeHiveSlug, "cost-saver");
    assert.equal(execution.defaultRuntimeProvider, "codex");
    assert.equal(execution.defaultRuntimeLabel, "Codex");
  });

  await test("activation fails loudly when a lane target cannot map to a runtime", () => {
    const badCompany = createCompany({
      name: `Execution Hives Bad Target ${Date.now()}`,
      description: "Execution Hives bad target fixture",
      status: "active",
    }).company;
    ensureCompanyExecutionHives({ companyIdOrSlug: badCompany.slug }, db);
    const row = db
      .prepare("SELECT id, lanes_json FROM company_execution_hives WHERE company_id = ? AND slug = ? LIMIT 1")
      .get(badCompany.id, "max-quality") as { id: string; lanes_json: string };
    const lanes = JSON.parse(row.lanes_json) as Array<{
      id: string;
      label: string;
      primary: Record<string, unknown>;
      fallbacks: unknown[];
    }>;
    const corrupted = lanes.map((lane) => lane.id === "deep"
      ? {
          ...lane,
          primary: {
            mode: "runtime_managed",
            runtimeId: "mystery-runner",
            runtimeLabel: "Mystery Runner",
            modelLabel: "phantom model",
          },
        }
      : lane);
    db.prepare("UPDATE company_execution_hives SET lanes_json = ? WHERE id = ?").run(
      JSON.stringify(corrupted),
      row.id,
    );

    assert.throws(
      () => activateCompanyExecutionHive({ companyIdOrSlug: badCompany.slug, hiveId: "max-quality" }, db),
      /Lane Deep lane has a target that can't be mapped to a runtime: .*mystery-runner/,
    );
  });

  await test("configuration saves matrix choices and updates active company defaults", () => {
    const result = configureCompanyExecutionHive({
      companyIdOrSlug: company.slug,
      hiveId: "cost-saver",
      orchestrationMode: "symphony",
      runtimeProvider: "gemini",
      runtimeLabel: "Gemini CLI",
      modelRouting: "openrouter",
      modelRoutingLabel: "OpenRouter",
    }, db);

    assert.equal(result.hive.orchestrationMode, "symphony");
    assert.equal(result.hive.runtimePriority[0], "Gemini CLI");
    assert.match(result.hive.routingPolicy, /OpenRouter/);
    assert.equal(result.hive.lanes.find((lane) => lane.id === "default")?.primary.modelSourceId, "openrouter");
    assert.equal(result.hive.lanes.find((lane) => lane.id === "default")?.verificationStatus, "untested");
    assert.match(result.hive.lanes.find((lane) => lane.id === "default")?.verificationNote ?? "", /run lane check to verify/i);
    assert.equal(result.executionDefaults.defaultEngine, "symphony");
    assert.equal(result.executionDefaults.defaultRuntimeProvider, "gemini");
    assert.equal(result.executionDefaults.defaultRuntimeLabel, "Gemini CLI");
    assert.equal(result.executionDefaults.defaultModelRouting, "openrouter");
  });

  await test("configuration maps every model-routing matrix option into a concrete lane target", () => {
    const cases = [
      { routing: "runtime-managed", label: "Runtime managed", expectedMode: "runtime_managed", expectedSource: undefined },
      { routing: "hive-managed", label: "Hive managed", expectedMode: "hive_managed", expectedSource: undefined },
      { routing: "openrouter", label: "OpenRouter", expectedMode: "broker", expectedSource: "openrouter" },
      { routing: "anthropic", label: "Anthropic Direct", expectedMode: "direct_source", expectedSource: "anthropic" },
      { routing: "openai", label: "OpenAI Direct", expectedMode: "direct_source", expectedSource: "openai" },
      { routing: "google", label: "Google Direct", expectedMode: "direct_source", expectedSource: "google" },
    ] as const;

    for (const entry of cases) {
      const result = configureCompanyExecutionHive({
        companyIdOrSlug: company.slug,
        hiveId: "cost-saver",
        orchestrationMode: "hiverunner",
        runtimeProvider: "anthropic",
        runtimeLabel: "Claude Code",
        modelRouting: entry.routing,
        modelRoutingLabel: entry.label,
      }, db);
      const primary = result.hive.lanes.find((lane) => lane.id === "default")?.primary;
      assert.equal(primary?.mode, entry.expectedMode);
      assert.equal(primary?.modelSourceId, entry.expectedSource);
      assert.equal(result.executionDefaults.defaultModelRouting, entry.routing);
      assert.equal(result.executionDefaults.defaultModelRoutingLabel, entry.label);
    }
  });

  await test("legacy Execution Matrix route-edit warnings read back as untested", () => {
    const legacyCompany = createCompany({
      name: `Execution Hives Legacy Warning ${Date.now()}`,
      description: "Execution Hives legacy warning fixture",
      status: "active",
    }).company;
    ensureCompanyExecutionHives({ companyIdOrSlug: legacyCompany.slug }, db);
    const row = db
      .prepare("SELECT id, lanes_json, verification_json FROM company_execution_hives WHERE company_id = ? AND slug = ? LIMIT 1")
      .get(legacyCompany.id, "balanced-builder") as { id: string; lanes_json: string; verification_json: string };
    const lanes = JSON.parse(row.lanes_json) as Array<Record<string, unknown>>;
    const warned = lanes.map((lane) => lane.id === "default"
      ? {
          ...lane,
          verificationStatus: "warning",
          verificationNote: "Default lane updated from the Execution Matrix to Claude Code / Runtime managed; live probe recommended before broad rollout.",
        }
      : lane);
    db.prepare("UPDATE company_execution_hives SET lanes_json = ?, verification_json = ? WHERE id = ?").run(
      JSON.stringify(warned),
      JSON.stringify({ ...JSON.parse(row.verification_json), warn: 1 }),
      row.id,
    );

    const listed = listCompanyExecutionHives({ companyIdOrSlug: legacyCompany.slug }, db);
    const defaultLane = listed.activeHive?.lanes.find((lane) => lane.id === "default");
    assert.equal(defaultLane?.verificationStatus, "untested");
    assert.match(defaultLane?.verificationNote ?? "", /run lane check to verify/i);
    assert.equal(listed.activeHive?.verification.warn, 1);
  });

  await test("configuration can restore the active matrix selection after a provider change", () => {
    const changed = configureCompanyExecutionHive({
      companyIdOrSlug: company.slug,
      hiveId: "cost-saver",
      orchestrationMode: "symphony",
      runtimeProvider: "codex",
      runtimeLabel: "Codex",
      modelRouting: "hive-managed",
      modelRoutingLabel: "Hive managed",
    }, db);

    assert.equal(changed.executionDefaults.defaultEngine, "symphony");
    assert.equal(changed.executionDefaults.defaultRuntimeProvider, "codex");
    assert.equal(changed.executionDefaults.defaultModelRouting, "hive-managed");

    const restored = configureCompanyExecutionHive({
      companyIdOrSlug: company.slug,
      hiveId: "cost-saver",
      orchestrationMode: "hiverunner",
      runtimeProvider: "anthropic",
      runtimeLabel: "Claude Code",
      modelRouting: "runtime-managed",
      modelRoutingLabel: "Runtime managed",
    }, db);

    assert.equal(restored.hive.orchestrationMode, "hiverunner");
    assert.equal(restored.hive.runtimePriority[0], "Claude Code");
    assert.match(restored.hive.routingPolicy, /Runtime managed/);
    assert.equal(restored.hive.lanes.find((lane) => lane.id === "default")?.primary.mode, "runtime_managed");
    assert.equal(restored.executionDefaults.defaultEngine, "hiverunner");
    assert.equal(restored.executionDefaults.defaultRuntimeProvider, "anthropic");
    assert.equal(restored.executionDefaults.defaultRuntimeLabel, "Claude Code");
    assert.equal(restored.executionDefaults.defaultModelRouting, "runtime-managed");
    assert.equal(restored.executionDefaults.defaultModelRoutingLabel, "Runtime managed");
  });

  await test("configuration on an inactive hive does not cascade into company defaults", () => {
    const before = listCompanyExecutionHives({ companyIdOrSlug: company.slug }, db).executionDefaults;
    const result = configureCompanyExecutionHive({
      companyIdOrSlug: company.slug,
      hiveId: "max-quality",
      orchestrationMode: "manual",
      runtimeProvider: "openclaw",
      runtimeLabel: "OpenClaw",
      modelRouting: "runtime-managed",
      modelRoutingLabel: "Runtime managed",
    }, db);

    assert.equal(result.hive.orchestrationMode, "manual");
    assert.equal(result.hive.runtimePriority[0], "OpenClaw");
    assert.equal(result.executionDefaults.defaultEngine, before.defaultEngine);
    assert.equal(result.executionDefaults.activeHiveSlug, before.activeHiveSlug);
  });

  await test("lane update persists primary and fallbacks then resets verification", () => {
    const result = updateCompanyExecutionHiveLane({
      companyIdOrSlug: company.slug,
      hiveId: "cost-saver",
      laneId: "deep",
      primary: {
        mode: "runtime_managed",
        runtimeId: "codex",
        runtimeLabel: "Codex",
        modelLabel: "gpt-5",
      },
      fallbacks: [
        {
          mode: "runtime_managed",
          runtimeId: "gemini-cli",
          runtimeLabel: "Gemini CLI",
          modelLabel: "gemini-2.5-pro",
        },
      ],
    }, db);

    assert.equal(result.hive.id, "cost-saver");
    assert.equal(result.lane.id, "deep");
    assert.equal(result.lane.primary.runtimeId, "codex");
    assert.equal(result.lane.primary.modelLabel, "gpt-5");
    assert.equal(result.lane.fallbacks.length, 1);
    assert.equal(result.lane.fallbacks[0].runtimeId, "gemini-cli");
    assert.equal(result.lane.verificationStatus, "untested");
  });

  await test("lane update repairs legacy model-source targets without adding fallbacks", () => {
    const legacyCompany = createCompany({
      name: `Execution Hives Legacy Target ${Date.now()}`,
      description: "Execution Hives legacy target fixture",
      status: "active",
    }).company;
    ensureCompanyExecutionHives({ companyIdOrSlug: legacyCompany.slug }, db);
    const row = db
      .prepare("SELECT id, lanes_json FROM company_execution_hives WHERE company_id = ? AND slug = ? LIMIT 1")
      .get(legacyCompany.id, "balanced-builder") as { id: string; lanes_json: string };
    const lanes = JSON.parse(row.lanes_json) as Array<{
      id: string;
      fallbacks: Array<Record<string, unknown>>;
    }>;
    const legacyLanes = lanes.map((lane) => lane.id === "mini"
      ? {
          ...lane,
          fallbacks: [{
            mode: "broker",
            modelSourceId: "openrouter",
            modelSourceLabel: "OpenRouter",
            modelLabel: "cheap capable fallback",
          }],
        }
      : lane);
    db.prepare("UPDATE company_execution_hives SET lanes_json = ? WHERE id = ?").run(
      JSON.stringify(legacyLanes),
      row.id,
    );

    const result = updateCompanyExecutionHiveLane({
      companyIdOrSlug: legacyCompany.slug,
      hiveId: "balanced-builder",
      laneId: "deep",
      primary: {
        mode: "runtime_managed",
        runtimeId: "codex",
        runtimeLabel: "Codex",
        modelLabel: "gpt-5",
      },
      fallbacks: [],
    }, db);

    const mini = result.hive.lanes.find((lane) => lane.id === "mini");
    assert.equal(mini?.fallbacks.length, 1);
    assert.equal(mini?.fallbacks[0].runtimeId, "codex");
    assert.equal(result.lane.fallbacks.length, 0);
  });

  await test("model-source probe persists into hive verification summary", () => {
    const result = recordCompanyModelSourceProbe({
      companyIdOrSlug: company.slug,
      probe: {
        sourceId: "openrouter",
        status: "pass",
        label: "OpenRouter",
        checkedAt: "2026-05-09T12:00:00.000Z",
        endpointLabel: "OpenRouter key metadata",
        latencyMs: 42,
        configuredSecretNames: ["OPENROUTER_API_KEY"],
        note: "Provider responded with HTTP 200.",
      },
    }, db);

    assert.equal(result.probe.status, "pass");
    assert.equal(result.activeHive?.verification.modelSourceProbes?.openrouter.status, "pass");
    assert.equal(result.activeHive?.verification.modelSourceSummary?.pass, 1);
    assert.equal(result.activeHive?.verification.modelSourceSummary?.total, 1);

    const listed = listCompanyExecutionHives({ companyIdOrSlug: company.slug }, db).activeHive;
    assert.equal(listed?.verification.modelSourceProbes?.openrouter.latencyMs, 42);
  });

  await test("lane probe updates persisted lane verification state", () => {
    const result = runCompanyExecutionHiveProbe({
      companyIdOrSlug: company.slug,
      hiveId: "max-quality",
      laneId: "default",
      kind: "lane",
    }, db);

    assert.equal(result.hive.id, "max-quality");
    assert.equal(result.lane.id, "default");
    assert.equal(result.probe.laneId, "default");
    assert.ok(["pass", "warn", "fail"].includes(result.probe.status));
    assert.ok(result.runtimeSummary.checkedRuntimes >= 0);
    assert.equal(
      result.hive.lanes.find((lane) => lane.id === "default")?.verificationStatus,
      result.probe.status === "pass" ? "verified" : result.probe.status === "fail" ? "failed" : "warning",
    );
  });

  await test("lane probe can resolve locally detected runtime inventory when attached runtime is stale", () => {
    db.prepare("DELETE FROM agent_runtimes WHERE company_id = ? AND provider = 'codex'").run(company.id);
    upsertCompanyRuntime({
      companyIdOrSlug: company.slug,
      provider: "codex",
      runtimeSlug: "stale-codex",
      displayName: "Codex stale attached",
      runtimeKind: "cli",
      scope: "company",
      command: "/missing/codex",
      status: "offline",
    });

    const binDir = mkdtempSync(path.join(os.tmpdir(), "mc-hive-runtime-bin-"));
    const fakeCodex = path.join(binDir, "codex");
    writeFileSync(
      fakeCodex,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli 9.9.9"
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  echo "Logged in"
  exit 0
fi
echo "ok"
exit 0
`,
      "utf8",
    );
    chmodSync(fakeCodex, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const result = runCompanyExecutionHiveProbe({
        companyIdOrSlug: company.slug,
        hiveId: "cost-saver",
        laneId: "fast",
        kind: "lane",
      }, db);

      assert.equal(result.probe.status, "pass");
      assert.equal(result.runtimeSummary.selectedRuntimeLabel, "Codex");
      assert.match(result.probe.note ?? "", /resolved to Codex/);
    } finally {
      process.env.PATH = previousPath;
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  await test("hives API lists and activates persisted company hives", async () => {
    const getResponse = await listHivesRoute(
      makeGetRequest(`http://localhost/api/orchestration/companies/${company.slug}/hives`) as never,
      { params: Promise.resolve({ slug: company.slug }) },
    );
    assert.equal(getResponse.status, 200);
    const listPayload = await getResponse.json() as { hives: Array<{ id: string; isActive?: boolean }> };
    assert.ok(listPayload.hives.length >= 4);

    const postResponse = await activateHiveRoute(
      makePostRequest() as never,
      { params: Promise.resolve({ slug: company.slug, hiveId: "max-quality" }) },
    );
    assert.equal(postResponse.status, 200);
    const activatePayload = await postResponse.json() as {
      hive: { id: string; name: string; isActive?: boolean };
      executionDefaults: Record<string, unknown>;
    };
    assert.equal(activatePayload.hive.name, "Max Quality");
    assert.equal(activatePayload.hive.isActive, true);
    assert.equal(activatePayload.executionDefaults.activeHiveSlug, "max-quality");
  });

  await test("hives API configures a hive from the execution matrix payload", async () => {
    const postResponse = await configureHiveRoute(
      makePostRequest({
        orchestrationMode: "hiverunner",
        runtimeProvider: "anthropic",
        runtimeLabel: "Claude Code",
        modelRouting: "runtime-managed",
        modelRoutingLabel: "Runtime managed",
      }) as never,
      { params: Promise.resolve({ slug: company.slug, hiveId: "max-quality" }) },
    );
    assert.equal(postResponse.status, 200);
    const payload = await postResponse.json() as {
      hive: { id: string; orchestrationMode: string; runtimePriority: string[]; routingPolicy: string };
      executionDefaults: Record<string, unknown>;
    };
    assert.equal(payload.hive.id, "max-quality");
    assert.equal(payload.hive.orchestrationMode, "hiverunner");
    assert.equal(payload.hive.runtimePriority[0], "Claude Code");
    assert.match(payload.hive.routingPolicy, /Runtime managed/);
    assert.equal(payload.executionDefaults.defaultRuntimeProvider, "anthropic");
  });

  await test("hives API patches a lane and rejects unmappable targets", async () => {
    const patchResponse = await updateLaneRoute(
      makePostRequest({
        primary: {
          mode: "runtime_managed",
          runtimeId: "codex",
          runtimeLabel: "Codex",
          modelLabel: "gpt-5",
        },
        fallbacks: [],
      }) as never,
      { params: Promise.resolve({ slug: company.slug, hiveId: "max-quality", laneId: "deep" }) },
    );
    assert.equal(patchResponse.status, 200);
    const patchPayload = await patchResponse.json() as {
      lane: { id: string; primary: { runtimeId?: string }; fallbacks: unknown[]; verificationStatus: string };
    };
    assert.equal(patchPayload.lane.id, "deep");
    assert.equal(patchPayload.lane.primary.runtimeId, "codex");
    assert.equal(patchPayload.lane.fallbacks.length, 0);
    assert.equal(patchPayload.lane.verificationStatus, "untested");

    const badResponse = await updateLaneRoute(
      makePostRequest({
        primary: {
          mode: "runtime_managed",
          runtimeId: "not-real-runtime",
          runtimeLabel: "Not Real Runtime",
          modelLabel: "ghost",
        },
        fallbacks: [],
      }) as never,
      { params: Promise.resolve({ slug: company.slug, hiveId: "max-quality", laneId: "deep" }) },
    );
    assert.equal(badResponse.status, 422);
    const badPayload = await badResponse.json() as { error?: { code?: string; message?: string } };
    assert.equal(badPayload.error?.code, "execution_hive_route_unresolvable");
    assert.match(badPayload.error?.message ?? "", /Deep lane.*not-real-runtime/);

    const mismatchResponse = await updateLaneRoute(
      makePostRequest({
        primary: {
          mode: "runtime_managed",
          runtimeId: "claude-code",
          runtimeLabel: "Claude Code",
          modelLabel: "gpt-5",
        },
        fallbacks: [],
      }) as never,
      { params: Promise.resolve({ slug: company.slug, hiveId: "max-quality", laneId: "deep" }) },
    );
    assert.equal(mismatchResponse.status, 422);
    const mismatchPayload = await mismatchResponse.json() as { error?: { code?: string; message?: string } };
    assert.equal(mismatchPayload.error?.code, "execution_hive_runtime_model_mismatch");
    assert.match(mismatchPayload.error?.message ?? "", /Deep lane primary target claude-code cannot serve model gpt-5/);
  });

  await test("available models API creates, lists, updates, and soft-deletes operator models", async () => {
    const createResponse = await createAvailableModelRoute(
      makePostRequest({
        id: "test-model-api",
        displayName: "Test Model API",
        runtimeProvider: "openai",
        defaultRuntimeLabel: "Codex",
        modelSourceId: "openai",
        capabilities: ["text", "tools"],
        contextWindow: 128000,
        description: "Operator-added model for CRUD testing.",
      }) as never,
    );
    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json() as { model: { id: string; isSeed: boolean; isActive: boolean } };
    assert.equal(createPayload.model.id, "test-model-api");
    assert.equal(createPayload.model.isSeed, false);
    assert.equal(createPayload.model.isActive, true);

    const listResponse = await listAvailableModelsRoute(
      makeGetRequest("http://localhost/api/orchestration/available-models?provider=openai") as never,
    );
    assert.equal(listResponse.status, 200);
    const listPayload = await listResponse.json() as { models: Array<{ id: string }> };
    assert.ok(listPayload.models.some((model) => model.id === "test-model-api"));

    const patchResponse = await updateAvailableModelRoute(
      makePostRequest({ displayName: "Test Model API Updated", capabilities: ["text"] }) as never,
      { params: Promise.resolve({ id: "test-model-api" }) },
    );
    assert.equal(patchResponse.status, 200);
    const patchPayload = await patchResponse.json() as { model: { displayName: string; capabilities: string[] } };
    assert.equal(patchPayload.model.displayName, "Test Model API Updated");
    assert.deepEqual(patchPayload.model.capabilities, ["text"]);

    const deleteResponse = await deleteAvailableModelRoute(
      makePostRequest() as never,
      { params: Promise.resolve({ id: "test-model-api" }) },
    );
    assert.equal(deleteResponse.status, 200);
    const deletePayload = await deleteResponse.json() as { model: { isActive: boolean } };
    assert.equal(deletePayload.model.isActive, false);
  });

  await test("model-first route target persists direct Anthropic lane route", () => {
    const result = updateCompanyExecutionHiveLane({
      companyIdOrSlug: company.slug,
      hiveId: "max-quality",
      laneId: "deep",
      primary: routeTargetForModelChoice({
        id: "claude-opus-4-7",
        displayName: "Claude Opus 4.7",
        runtimeProvider: "anthropic",
        defaultRuntimeLabel: "Claude Code",
        modelSourceId: "anthropic",
        capabilities: ["text"],
        contextWindow: null,
        description: null,
        isSeed: true,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, "direct"),
      fallbacks: [],
    }, db);

    const lane = result.hive.lanes.find((candidate) => candidate.id === "deep");
    assert.equal(lane?.primary.mode, "direct_source");
    assert.equal(lane?.primary.runtimeId, "anthropic");
    assert.equal(lane?.primary.modelId, "claude-opus-4-7");
    assert.equal(lane?.primary.modelSourceId, "anthropic");
    assert.equal(lane?.verificationStatus, "untested");
  });

  await test("model-first lane update accepts seeded runtime-managed fallback model ids", () => {
    const result = updateCompanyExecutionHiveLane({
      companyIdOrSlug: company.slug,
      hiveId: "balanced-builder",
      laneId: "default",
      primary: routeTargetForModelChoice({
        id: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        runtimeProvider: "google",
        defaultRuntimeLabel: "Gemini CLI",
        modelSourceId: "google",
        capabilities: ["text"],
        contextWindow: null,
        description: null,
        isSeed: true,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, "auto"),
      fallbacks: [
        routeTargetForModelChoice({
          id: "gpt-4o",
          displayName: "GPT-4o",
          runtimeProvider: "openai",
          defaultRuntimeLabel: "Codex",
          modelSourceId: "openai",
          capabilities: ["text"],
          contextWindow: null,
          description: null,
          isSeed: true,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, "auto"),
        routeTargetForModelChoice({
          id: "hermes-runtime-managed",
          displayName: "Hermes Runtime Managed",
          runtimeProvider: "hermes",
          defaultRuntimeLabel: "Hermes",
          modelSourceId: "hermes",
          capabilities: ["text"],
          contextWindow: null,
          description: null,
          isSeed: true,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }, "auto"),
      ],
    }, db);

    const lane = result.hive.lanes.find((candidate) => candidate.id === "default");
    assert.equal(lane?.primary.modelId, "gemini-2.5-flash");
    assert.equal(lane?.fallbacks[0]?.modelId, "gpt-4o");
    assert.equal(lane?.fallbacks[1]?.modelId, "hermes-runtime-managed");
    assert.equal(lane?.verificationStatus, "untested");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
