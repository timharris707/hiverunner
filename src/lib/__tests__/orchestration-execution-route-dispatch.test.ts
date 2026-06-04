import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { executeHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { triggerTaskExecution } from "@/lib/orchestration/execution";
import { upsertCompanyRuntime } from "@/lib/orchestration/runtime-registry";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";
import { updateDevExecutionTestMode } from "@/lib/orchestration/service/dev-execution-test-mode";
import { configureCompanyExecutionHive, ensureCompanyExecutionHives } from "@/lib/orchestration/service/execution-hives";
import type { RoutingLane } from "@/lib/orchestration/execution-hives";

if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-execution-route-dispatch-${Date.now()}.db`,
  );
}

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

function writeFakeRunner(dir: string): string {
  const file = path.join(dir, "fake-symphony-runner.cjs");
  writeFileSync(
    file,
    `#!${process.execPath}
let body = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => body += chunk);
process.stdin.on("end", () => {
  const payload = JSON.parse(body);
  const line = JSON.stringify({ runnerProvider: payload.runnerProvider, runnerModel: payload.runnerModel, modelLane: payload.modelLane });
  require("fs").appendFileSync(process.env.ROUTE_AUDIT_FILE, line + "\\n");
  if (process.env.FAIL_ANTHROPIC === "1" && payload.runnerProvider === "anthropic") {
    console.error("network 503: anthropic unavailable");
    process.exit(1);
  }
  if (process.env.FAIL_GEMINI_UNKNOWN_EXIT === "1" && payload.runnerProvider === "gemini") {
    console.error("Gemini CLI failed with exit code unknown");
    process.exit(1);
  }
  if (process.env.FAIL_CODEX_USAGE_LIMIT === "1" && payload.runnerProvider === "codex") {
    console.error("You've hit your usage limit for GPT-5.3-Codex-Spark. Switch to another model now, or try again at 2:11 AM.");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({
    sessionId: "route-dispatch-session",
    resultText: "Route dispatch completed",
    assistantSummary: "Route dispatch completed",
    runnerProvider: payload.runnerProvider,
    runnerModel: payload.runnerModel,
    tokenUsage: { inputTokens: 1, outputTokens: 1 }
  }));
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

function latestRun(taskId: string) {
  const db = getOrchestrationDb();
  return db
    .prepare(
      `SELECT provider, execution_engine, runner_provider, runner_model, model_lane,
              fallback_used, fallback_index, fallback_from_provider, route_attempts_json, status
       FROM execution_runs
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(taskId) as {
      provider: string;
      execution_engine: string | null;
      runner_provider: string | null;
      runner_model: string | null;
      model_lane: string | null;
      fallback_used: number;
      fallback_index: number | null;
      fallback_from_provider: string | null;
      route_attempts_json: string;
      status: string;
    };
}

type RouteRunRow = ReturnType<typeof latestRun>;
type RouteAttempt = { status: string; runtimeProvider: string; error?: string | null };

function expectRunRow(runRow: RouteRunRow, expected: Partial<RouteRunRow>) {
  for (const [key, value] of Object.entries(expected) as Array<[keyof RouteRunRow, RouteRunRow[keyof RouteRunRow]]>) {
    assert.equal(runRow[key], value, `expected run ${String(key)} to match`);
  }
}

function routeAttempts(runRow: RouteRunRow): RouteAttempt[] {
  return JSON.parse(runRow.route_attempts_json) as RouteAttempt[];
}

function routeAttemptSummaries(runRow: RouteRunRow): string[] {
  return routeAttempts(runRow).map((attempt) => `${attempt.runtimeProvider}:${attempt.status}`);
}

async function run() {
  console.log("\nExecution Route Dispatch Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH!;
  resetSqliteDatabaseFiles(dbPath);

  const tmp = mkdtempSync(path.join(os.tmpdir(), "mc-route-dispatch-"));
  const auditFile = path.join(tmp, "route-audit.jsonl");
  const fakeRunner = writeFakeRunner(tmp);
  process.env.ROUTE_AUDIT_FILE = auditFile;
  process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
  process.env.PORT = "3010";
  process.env.SYMPHONY_EXEC_TIMEOUT_MS = "5000";
  (process.env as Record<string, string | undefined>).NODE_ENV = "development";

  const company = createCompany({
    name: `Execution Route Dispatch ${Date.now()}`,
    description: "Execution route dispatch fixture",
    status: "active",
  }).company;
  const db = getOrchestrationDb();
  const project = createProject({
    companyId: company.id,
    name: "Route Dispatch Project",
    description: "fixture",
    color: "#0ea5e9",
    emoji: "R",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: "Route Runner",
    emoji: "R",
    role: "Engineer",
    personality: "Routes tasks.",
    status: "idle",
    skills: [],
  }).agent;

  ensureCompanyExecutionHives({ companyIdOrSlug: company.slug }, db);
  configureCompanyExecutionHive({
    companyIdOrSlug: company.slug,
    hiveId: "balanced-builder",
    orchestrationMode: "symphony",
    runtimeProvider: "codex",
    runtimeLabel: "Codex",
    modelRouting: "hive-managed",
    modelRoutingLabel: "Hive managed",
  }, db);
  upsertCompanyRuntime({
    companyIdOrSlug: company.id,
    provider: "symphony",
    runtimeSlug: "route-test",
    displayName: "Route test runner",
    command: fakeRunner,
    status: "online",
    metadata: {
      trustedLocalExecution: { enabled: true },
    },
  });
  updateDevExecutionTestMode({
    companyIdOrSlug: company.id,
    enabled: true,
    durationMinutes: 10,
    actor: "test",
    note: "Route dispatch test",
  }, db);

  function readHiveLanes(): RoutingLane[] {
    const row = db
      .prepare("SELECT lanes_json FROM company_execution_hives WHERE company_id = ? AND slug = 'balanced-builder'")
      .get(company.id) as { lanes_json: string };
    return JSON.parse(row.lanes_json) as RoutingLane[];
  }

  function writeHiveLanes(lanes: RoutingLane[]) {
    db.prepare("UPDATE company_execution_hives SET lanes_json = ?, updated_at = ? WHERE company_id = ? AND slug = 'balanced-builder'")
      .run(JSON.stringify(lanes), new Date().toISOString(), company.id);
  }

  async function withHiveLanes(update: (lanes: RoutingLane[]) => RoutingLane[], body: () => Promise<void>) {
    const originalLanes = readHiveLanes();
    writeHiveLanes(update(originalLanes));
    try {
      await body();
    } finally {
      writeHiveLanes(originalLanes);
    }
  }

  async function executeRouteTask(options: {
    title: string;
    description: string;
    reason: string;
    modelLane?: string;
    executionEngine?: "symphony";
  }) {
    const task = createTask({
      projectId: project.id,
      title: options.title,
      description: options.description,
      priority: "P2",
      type: "feature",
      status: "in-progress",
      assignee: agent.id,
      labels: ["route"],
      modelLane: options.modelLane ?? "deep",
      ...(options.executionEngine ? { executionEngine: options.executionEngine } : {}),
      createdBy: "test",
    }).task;

    const queued = await triggerTaskExecution({ taskId: task.id, reason: options.reason });
    const result = await executeHeartbeatRun(queued.runId!, db);
    return { queued, result, runRow: latestRun(task.id) };
  }

  function expectSymphonyDispatchSucceeded(route: Awaited<ReturnType<typeof executeRouteTask>>) {
    assert.equal(route.queued.mode, "symphony");
    assert.ok(route.queued.runId);
    assert.equal(route.result.status, "succeeded", route.result.error ?? undefined);
  }

  await test("task Symphony engine is preserved in execution run metadata when active hive mode is HiveRunner", async () => {
    db.prepare(
      "UPDATE company_execution_hives SET orchestration_mode = 'hiverunner', updated_at = ? WHERE company_id = ? AND slug = 'balanced-builder'",
    ).run(new Date().toISOString(), company.id);

    try {
      process.env.FAIL_ANTHROPIC = "0";
      const route = await executeRouteTask({
        title: "Task engine overrides active hive mode",
        description: "Specific task should record Symphony execution metadata.",
        executionEngine: "symphony",
        modelLane: "deep",
        reason: "route_dispatch_task_engine_override",
      });
      expectSymphonyDispatchSucceeded(route);
      expectRunRow(route.runRow, {
        provider: "symphony",
        execution_engine: "symphony",
        runner_provider: "anthropic",
        runner_model: null,
        model_lane: "deep",
        status: "completed",
      });
    } finally {
      db.prepare(
        "UPDATE company_execution_hives SET orchestration_mode = 'symphony', updated_at = ? WHERE company_id = ? AND slug = 'balanced-builder'",
      ).run(new Date().toISOString(), company.id);
    }
  });

  await test("Symphony dispatch uses the assigned agent model as the runner target", async () => {
    db.prepare("UPDATE agents SET adapter_type = 'codex', model = 'openai-codex/gpt-5.5', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), agent.id);
    try {
      process.env.FAIL_ANTHROPIC = "0";
      const route = await executeRouteTask({
        title: "Agent profile runner target",
        description: "Symphony should orchestrate while the assigned agent profile chooses the runner model.",
        executionEngine: "symphony",
        modelLane: "deep",
        reason: "route_dispatch_agent_profile_model",
      });
      expectSymphonyDispatchSucceeded(route);
      expectRunRow(route.runRow, {
        provider: "symphony",
        execution_engine: "symphony",
        runner_provider: "codex",
        runner_model: "gpt-5.5",
        model_lane: "deep",
        status: "completed",
      });
    } finally {
      db.prepare("UPDATE agents SET adapter_type = 'manual', model = NULL, updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), agent.id);
    }
  });

  await test("deep lane routes to its non-default primary runtime", async () => {
    process.env.FAIL_ANTHROPIC = "0";
    const route = await executeRouteTask({
      title: "Deep lane primary route",
      description: "Should use the deep lane primary runtime.",
      modelLane: "deep",
      reason: "route_dispatch_deep_primary",
    });
    expectSymphonyDispatchSucceeded(route);
    expectRunRow(route.runRow, {
      provider: "symphony",
      execution_engine: "symphony",
      runner_provider: "anthropic",
      runner_model: null,
      model_lane: "deep",
      fallback_used: 0,
      status: "completed",
    });
  });

  await test("resolved route model overrides legacy task model-routing in execution runs", async () => {
    await withHiveLanes(
      (lanes) => lanes.map((lane) => lane.id === "deep"
        ? {
            ...lane,
            primary: {
              ...lane.primary,
              modelId: "claude-opus-4-7",
              modelLabel: "Claude Opus 4.7",
            },
          }
        : lane),
      async () => {
        process.env.FAIL_ANTHROPIC = "0";
        const { result, runRow } = await executeRouteTask({
          title: "Deep lane resolved model precedence",
          description: "Should ignore legacy task model routing.",
          modelLane: "deep",
          reason: "route_dispatch_model_precedence",
        });
        assert.equal(result.status, "succeeded", result.error ?? undefined);
        expectRunRow(runRow, {
          runner_provider: "anthropic",
          runner_model: "claude-opus-4-7",
          model_lane: "deep",
          status: "completed",
        });
      },
    );
  });

  await test("transient primary failure falls through to the first configured fallback", async () => {
    process.env.FAIL_ANTHROPIC = "1";
    const { result, runRow } = await executeRouteTask({
      title: "Deep lane fallback route",
      description: "Should fall back from Anthropic to Codex.",
      modelLane: "deep",
      reason: "route_dispatch_fallback",
    });
    assert.equal(result.status, "succeeded", result.error ?? undefined);
    expectRunRow(runRow, {
      runner_provider: "codex",
      runner_model: null,
      model_lane: "deep",
      fallback_used: 1,
      fallback_index: 0,
      fallback_from_provider: "anthropic",
    });
    assert.deepEqual(routeAttemptSummaries(runRow), [
      "anthropic:failed",
      "codex:succeeded",
    ]);
  });

  await test("opaque Gemini CLI unknown-exit failure falls through to configured fallback", async () => {
    try {
      await withHiveLanes(
        (lanes) => lanes.map((lane) => lane.id === "deep"
          ? {
              ...lane,
              primary: {
                mode: "runtime_managed",
                runtimeId: "gemini-cli",
                runtimeLabel: "Gemini CLI",
              },
              fallbacks: [
                {
                  mode: "runtime_managed",
                  runtimeId: "codex-cli",
                  runtimeLabel: "Codex",
                },
              ],
            }
          : lane),
        async () => {
          process.env.FAIL_ANTHROPIC = "0";
          process.env.FAIL_GEMINI_UNKNOWN_EXIT = "1";
          const { result, runRow } = await executeRouteTask({
            title: "Deep lane Gemini opaque fallback route",
            description: "Should fall back from Gemini unknown-exit wrapper failure to Codex.",
            modelLane: "deep",
            reason: "route_dispatch_gemini_unknown_exit_fallback",
          });
          assert.equal(result.status, "succeeded", result.error ?? undefined);
          expectRunRow(runRow, {
            runner_provider: "codex",
            runner_model: null,
            model_lane: "deep",
            fallback_used: 1,
            fallback_index: 0,
            fallback_from_provider: "gemini",
          });
          assert.deepEqual(routeAttemptSummaries(runRow), [
            "gemini:failed",
            "codex:succeeded",
          ]);
          const attempts = routeAttempts(runRow);
          assert.match(attempts[0]?.error ?? "", /Gemini CLI failed with exit code unknown/);
        },
      );
    } finally {
      process.env.FAIL_GEMINI_UNKNOWN_EXIT = "0";
    }
  });

  await test("Codex usage-limit failure falls through to configured fallback", async () => {
    try {
      await withHiveLanes(
        (lanes) => lanes.map((lane) => lane.id === "deep"
          ? {
              ...lane,
              primary: {
                mode: "runtime_managed",
                runtimeId: "codex-cli",
                runtimeLabel: "Codex",
              },
              fallbacks: [
                {
                  mode: "runtime_managed",
                  runtimeId: "claude-code",
                  runtimeLabel: "Claude Code",
                },
              ],
            }
          : lane),
        async () => {
          process.env.FAIL_ANTHROPIC = "0";
          process.env.FAIL_GEMINI_UNKNOWN_EXIT = "0";
          process.env.FAIL_CODEX_USAGE_LIMIT = "1";
          const { result, runRow } = await executeRouteTask({
            title: "Deep lane Codex usage-limit fallback route",
            description: "Should fall back from Codex usage-limit failure to Anthropic.",
            modelLane: "deep",
            reason: "route_dispatch_codex_usage_limit_fallback",
          });
          assert.equal(result.status, "succeeded", result.error ?? undefined);
          expectRunRow(runRow, {
            runner_provider: "anthropic",
            runner_model: null,
            model_lane: "deep",
            fallback_used: 1,
            fallback_index: 0,
            fallback_from_provider: "codex",
          });
          assert.deepEqual(routeAttemptSummaries(runRow), [
            "codex:failed",
            "anthropic:succeeded",
          ]);
          const attempts = routeAttempts(runRow);
          assert.match(attempts[0]?.error ?? "", /usage limit/i);
        },
      );
    } finally {
      process.env.FAIL_CODEX_USAGE_LIMIT = "0";
    }
  });

  await test("zero-fallback lane fails cleanly without invoking another runtime", async () => {
    await withHiveLanes(
      (lanes) => lanes.map((lane) => lane.id === "fast"
        ? {
            ...lane,
            primary: {
              mode: "runtime_managed",
              runtimeId: "claude-code",
              runtimeLabel: "Claude Code",
              modelLabel: "fast no-fallback profile",
            },
            fallbacks: [],
          }
        : lane),
      async () => {
        process.env.FAIL_ANTHROPIC = "1";
        const { result, runRow } = await executeRouteTask({
          title: "Fast lane no fallback",
          description: "Should fail without fallback.",
          modelLane: "fast",
          reason: "route_dispatch_no_fallback",
        });
        assert.equal(result.status, "failed");
        expectRunRow(runRow, {
          runner_provider: "anthropic",
          runner_model: "fast no-fallback profile",
          model_lane: "fast",
          fallback_used: 0,
        });
        const attempts = routeAttempts(runRow);
        assert.deepEqual(attempts.map((attempt) => attempt.runtimeProvider), ["anthropic"]);
      },
    );
  });

  const auditLines = readFileSync(auditFile, "utf8").trim().split(/\n+/).filter(Boolean);
  assert.ok(auditLines.length >= 4, "fake runner should have received route payloads");

  finish();
}

void run();
