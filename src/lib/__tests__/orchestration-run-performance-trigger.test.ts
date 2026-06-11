import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  DEFAULT_ORCHESTRATION_COMPANY_ID,
  createBasicFixtureTask,
  createFixtureAgent,
  createFixtureProject,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-run-performance-trigger-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

async function run() {
  console.log("\nOrchestration Run Performance Trigger Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-run-performance-trigger-",
  });

  try {
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      DEFAULT_RUN_PERFORMANCE_THRESHOLDS,
      INS_G006_BASELINE_FRESH_INPUT_TOKENS,
      RUN_PERFORMANCE_TRIGGER_KEY,
      evaluateRunPerformance,
      extractRunPerformanceMetrics,
      resolveRunPerformanceThresholds,
      runPerformanceTriggerForExecutionRun,
      sweepCompletedRunsForPerformanceOutliers,
    } = await import("@/lib/orchestration/run-performance-trigger");
    const {
      setCompanyImprovementPause,
      setImprovementTriggerEnabled,
    } = await import("@/lib/orchestration/improvement-recommendations");
    const { createProject } = await import("@/lib/orchestration/service/project");
    const { createProjectAgent } = await import("@/lib/orchestration/service/agent");
    const { createTask } = await import("@/lib/orchestration/service/task");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);
    const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;

    const project = createFixtureProject(createProject, {
      namePrefix: "PerfTrigger",
      label: "Lane",
      description: "Run performance trigger tests",
      color: "#8888ff",
      emoji: "⚡",
    });
    const agent = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "perf-agent",
      emoji: "🐢",
      role: "Builder",
      skills: ["typescript"],
    });
    const task = createBasicFixtureTask(createTask, {
      projectId: project.id,
      title: "Perf trigger fixture task",
      assignee: agent.id,
      createdBy: "tim",
    });

    function insertRun(input: {
      status?: string;
      completedAt?: string;
      durationMs?: number | null;
      usage?: Record<string, unknown> | null;
      agentId?: string | null;
    }): string {
      const id = randomUUID();
      const completedAt = input.completedAt ?? new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, runner_provider, runner_model, status,
            started_at, completed_at, duration_ms, token_usage_json, created_at, updated_at)
         VALUES (?, ?, ?, 'symphony', 'codex', 'gpt-5.5', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        task.id,
        input.agentId === undefined ? agent.id : input.agentId,
        input.status ?? "completed",
        completedAt,
        completedAt,
        input.durationMs === undefined ? 120_000 : input.durationMs,
        JSON.stringify(input.usage ?? {}),
        completedAt,
        completedAt,
      );
      return id;
    }

    function firingCount(): number {
      return (db
        .prepare("SELECT COUNT(*) AS n FROM improvement_trigger_firings WHERE company_id = ? AND trigger_key = ?")
        .get(companyId, RUN_PERFORMANCE_TRIGGER_KEY) as { n: number }).n;
    }

    function recommendationRows(): Array<{ id: string; scope_type: string; scope_key: string; severity: string }> {
      return db
        .prepare(
          "SELECT id, scope_type, scope_key, severity FROM improvement_recommendations WHERE company_id = ? AND trigger_key = ? ORDER BY created_at",
        )
        .all(companyId, RUN_PERFORMANCE_TRIGGER_KEY) as Array<{ id: string; scope_type: string; scope_key: string; severity: string }>;
    }

    await test("extracts fresh input tokens from codex-style camelCase usage", () => {
      const metrics = extractRunPerformanceMetrics({
        duration_ms: 300_000,
        token_usage_json: JSON.stringify({
          inputTokens: 429_139,
          outputTokens: 9_042,
          cacheReadInputTokens: 379_136,
          totalTokens: 438_181,
        }),
      });
      assert.equal(metrics.durationMs, 300_000);
      assert.equal(metrics.inputTokens, 429_139);
      assert.equal(metrics.cacheReadTokens, 379_136);
      assert.equal(metrics.freshInputTokens, 429_139 - 379_136);
      assert.equal(metrics.outputTokens, 9_042);
      assert.equal(metrics.hasTokenData, true);
    });

    await test("extracts snake_case usage and tolerates missing token data", () => {
      const snake = extractRunPerformanceMetrics({
        duration_ms: 60_000,
        token_usage_json: JSON.stringify({ input_tokens: 5_000, output_tokens: 800, cache_read_tokens: 1_000 }),
      });
      assert.equal(snake.freshInputTokens, 4_000);

      const empty = extractRunPerformanceMetrics({ duration_ms: 60_000, token_usage_json: "{}" });
      assert.equal(empty.hasTokenData, false);
      assert.equal(empty.freshInputTokens, null);

      const invalid = extractRunPerformanceMetrics({ duration_ms: null, token_usage_json: "not-json" });
      assert.equal(invalid.hasTokenData, false);
      assert.equal(invalid.durationMs, null);
    });

    await test("evaluates outliers against thresholds with severity escalation", () => {
      const ok = evaluateRunPerformance({
        durationMs: 300_000,
        inputTokens: 40_000,
        cacheReadTokens: 0,
        freshInputTokens: 40_000,
        outputTokens: 2_000,
        hasTokenData: true,
      });
      assert.equal(ok.isOutlier, false);

      const slow = evaluateRunPerformance({
        durationMs: DEFAULT_RUN_PERFORMANCE_THRESHOLDS.maxDurationMs + 1,
        inputTokens: null,
        cacheReadTokens: 0,
        freshInputTokens: null,
        outputTokens: null,
        hasTokenData: false,
      });
      assert.deepEqual(slow.reasons, ["slow"]);
      assert.equal(slow.severity, "medium");

      const veryExpensive = evaluateRunPerformance({
        durationMs: 60_000,
        inputTokens: 240_000,
        cacheReadTokens: 0,
        freshInputTokens: 240_000,
        outputTokens: 4_000,
        hasTokenData: true,
      });
      assert.deepEqual(veryExpensive.reasons, ["expensive"]);
      assert.equal(veryExpensive.severity, "high");
      assert.ok((veryExpensive.baselineMultiple ?? 0) > 240_000 / INS_G006_BASELINE_FRESH_INPUT_TOKENS - 0.01);
    });

    await test("creates an agent-scoped recommendation and firing for an expensive run", () => {
      const runId = insertRun({
        usage: { inputTokens: 150_000, outputTokens: 8_000, cacheReadInputTokens: 0 },
      });
      const result = runPerformanceTriggerForExecutionRun(runId, db);
      assert.equal(result.outcome, "created");
      assert.deepEqual(result.evaluation?.reasons, ["expensive"]);

      const recs = recommendationRows();
      assert.equal(recs.length, 1);
      assert.equal(recs[0].scope_type, "agent");
      assert.equal(recs[0].scope_key, agent.id);
      assert.equal(recs[0].severity, "medium");

      const firing = db
        .prepare(
          "SELECT source_run_id, thresholds_json, status FROM improvement_trigger_firings WHERE company_id = ? AND trigger_key = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(companyId, RUN_PERFORMANCE_TRIGGER_KEY) as { source_run_id: string; thresholds_json: string; status: string };
      assert.equal(firing.source_run_id, runId);
      assert.equal(firing.status, "created_recommendation");
      assert.equal(
        JSON.parse(firing.thresholds_json).maxFreshInputTokens,
        DEFAULT_RUN_PERFORMANCE_THRESHOLDS.maxFreshInputTokens,
      );
    });

    await test("same agent + month folds into the existing recommendation; new month creates a new one", () => {
      const sameMonthRun = insertRun({
        usage: { inputTokens: 200_000, outputTokens: 3_000, cacheReadInputTokens: 0 },
      });
      const sameMonth = runPerformanceTriggerForExecutionRun(sameMonthRun, db);
      assert.equal(sameMonth.outcome, "existing");
      assert.equal(recommendationRows().length, 1);
      assert.equal(firingCount(), 2);

      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      const priorMonthRun = insertRun({
        completedAt: lastMonth.toISOString(),
        usage: { inputTokens: 200_000, outputTokens: 3_000, cacheReadInputTokens: 0 },
      });
      const priorMonth = runPerformanceTriggerForExecutionRun(priorMonthRun, db);
      assert.equal(priorMonth.outcome, "created");
      assert.equal(recommendationRows().length, 2);
    });

    await test("below-threshold and cache-heavy runs write nothing", () => {
      const before = firingCount();
      const cacheHeavy = insertRun({
        usage: { inputTokens: 429_139, outputTokens: 9_000, cacheReadInputTokens: 379_136 },
      });
      const result = runPerformanceTriggerForExecutionRun(cacheHeavy, db);
      assert.equal(result.outcome, "below_threshold");
      assert.equal(firingCount(), before);

      const noTokens = insertRun({ usage: {}, durationMs: 240_000 });
      assert.equal(runPerformanceTriggerForExecutionRun(noTokens, db).outcome, "below_threshold");
      assert.equal(firingCount(), before);
    });

    await test("non-completed runs and unknown runs are skipped", () => {
      const failed = insertRun({
        status: "failed",
        usage: { inputTokens: 500_000, outputTokens: 100, cacheReadInputTokens: 0 },
      });
      assert.equal(runPerformanceTriggerForExecutionRun(failed, db).outcome, "skipped_status");
      assert.equal(runPerformanceTriggerForExecutionRun(randomUUID(), db).outcome, "skipped_not_found");
    });

    await test("company pause and trigger disable gate the suggestion but log skipped firings", () => {
      setCompanyImprovementPause({ companyId, paused: true, reason: "test pause" }, db);
      const pausedRun = insertRun({ usage: { inputTokens: 180_000, outputTokens: 2_000, cacheReadInputTokens: 0 } });
      const paused = runPerformanceTriggerForExecutionRun(pausedRun, db);
      assert.equal(paused.outcome, "skipped");
      assert.equal(paused.suggestion?.firing?.status, "skipped");
      setCompanyImprovementPause({ companyId, paused: false }, db);

      setImprovementTriggerEnabled({ companyId, triggerKey: RUN_PERFORMANCE_TRIGGER_KEY, enabled: false }, db);
      const disabledRun = insertRun({ usage: { inputTokens: 180_000, outputTokens: 2_000, cacheReadInputTokens: 0 } });
      const disabled = runPerformanceTriggerForExecutionRun(disabledRun, db);
      assert.equal(disabled.outcome, "skipped");
      assert.equal(disabled.suggestion?.reason, "trigger_disabled");
      setImprovementTriggerEnabled({ companyId, triggerKey: RUN_PERFORMANCE_TRIGGER_KEY, enabled: true }, db);
    });

    await test("per-company threshold overrides are honored", () => {
      setImprovementTriggerEnabled({
        companyId,
        triggerKey: RUN_PERFORMANCE_TRIGGER_KEY,
        enabled: true,
        threshold: { maxDurationMs: 60_000, maxFreshInputTokens: 117_000 },
      }, db);
      const resolved = resolveRunPerformanceThresholds(db, companyId);
      assert.equal(resolved.maxDurationMs, 60_000);

      const slowRun = insertRun({ durationMs: 90_000, usage: { inputTokens: 1_000, outputTokens: 100 } });
      const result = runPerformanceTriggerForExecutionRun(slowRun, db);
      assert.deepEqual(result.evaluation?.reasons, ["slow"]);
      assert.notEqual(result.outcome, "below_threshold");

      setImprovementTriggerEnabled({
        companyId,
        triggerKey: RUN_PERFORMANCE_TRIGGER_KEY,
        enabled: true,
        threshold: DEFAULT_RUN_PERFORMANCE_THRESHOLDS,
      }, db);
    });

    await test("sweep evaluates recent completed runs and tallies outcomes", () => {
      const sweep = sweepCompletedRunsForPerformanceOutliers({ limit: 50 }, db);
      assert.ok(sweep.scanned >= 5);
      assert.ok(sweep.outliers >= 3);
      assert.ok((sweep.outcomes.existing ?? 0) + (sweep.outcomes.created ?? 0) >= 1);
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
