import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  buildRuntimeBenchmarkPromotionReport,
  buildRuntimeBenchmarkSummary,
  classifyRunFailure,
  evaluateRuntimeBenchmarkPromotionGate,
  formatRuntimeBenchmarkMarkdown,
  type RuntimeBenchmarkSummary,
  usageTotalsFromJson,
} from "@/lib/orchestration/runtime-benchmark";

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]" });

function createFixtureDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-benchmark-"));
  const db = new Database(path.join(dir, "fixture.db"));
  db.exec(`
    CREATE TABLE sprints (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      goal_key TEXT
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      sprint_id TEXT,
      task_key TEXT,
      company_id TEXT
    );
    CREATE TABLE execution_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      failure_class TEXT,
      error_message TEXT,
      token_usage_json TEXT NOT NULL DEFAULT '{}',
      duration_ms INTEGER,
      created_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE overseer_turns (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      usage_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT
    );
    CREATE TABLE runtime_action_ledger (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      execution_run_id TEXT,
      status TEXT NOT NULL
    );
    CREATE TABLE runtime_browser_proof_audit (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      execution_run_id TEXT,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT
    );
    CREATE TABLE execution_run_transcript_events (
      id TEXT PRIMARY KEY,
      execution_run_id TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE execution_run_attempt_events (
      id TEXT PRIMARY KEY,
      execution_run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  db.prepare("INSERT INTO sprints (id, parent_id, goal_key) VALUES ('goal', NULL, 'INS-G006')").run();
  db.prepare("INSERT INTO sprints (id, parent_id, goal_key) VALUES ('sprint-1', 'goal', NULL)").run();
  db.prepare("INSERT INTO tasks (id, sprint_id, task_key, company_id) VALUES ('task-1', 'sprint-1', 'INS-1', 'company-1')").run();
  db.prepare("INSERT INTO tasks (id, sprint_id, task_key, company_id) VALUES ('task-2', 'sprint-1', 'INS-2', 'company-1')").run();
  db.prepare(`
    INSERT INTO execution_runs
      (id, task_id, status, failure_class, error_message, token_usage_json, duration_ms, created_at, started_at, completed_at, updated_at)
    VALUES
      ('run-1', 'task-1', 'failed', 'runtime_error', 'External runner command exited with code 127: env: node: No such file or directory', '{}', 1000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z'),
      ('run-2', 'task-1', 'completed', NULL, NULL, '{"inputTokens":100,"cacheReadInputTokens":80,"outputTokens":20,"totalTokens":120}', 2000, '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:04.000Z', '2026-01-01T00:00:04.000Z'),
      ('run-3', 'task-2', 'cancelled', 'coalesced', 'Execution wake coalesced into an already active run.', '{}', 3000, '2026-01-01T00:00:05.000Z', '2026-01-01T00:00:05.000Z', '2026-01-01T00:00:08.000Z', '2026-01-01T00:00:08.000Z'),
      ('run-4', 'task-2', 'failed', 'silent_timeout', 'External runner command produced no stdout/stderr for 600000ms', '{}', 4000, '2026-01-01T00:00:09.000Z', '2026-01-01T00:00:09.000Z', '2026-01-01T00:00:13.000Z', '2026-01-01T00:00:13.000Z')
  `).run();
  db.prepare(`
    INSERT INTO overseer_turns (id, company_id, usage_json, created_at)
    VALUES ('turn-1', 'company-1', '{"inputTokens":50,"cacheReadInputTokens":40,"outputTokens":5,"totalTokens":55}', '2026-01-01T00:00:06.000Z')
  `).run();
  db.prepare(`
    INSERT INTO runtime_action_ledger (id, task_id, execution_run_id, status)
    VALUES
      ('action-1', 'task-1', 'run-2', 'executed'),
      ('action-2', 'task-2', 'run-4', 'parse_failed')
  `).run();
  db.prepare(`
    INSERT INTO runtime_browser_proof_audit (id, task_id, status, duration_ms)
    VALUES
      ('proof-1', 'task-1', 'succeeded', 9000),
      ('proof-2', 'task-2', 'failed', 45000)
  `).run();
  db.prepare(`
    INSERT INTO execution_run_transcript_events (id, execution_run_id, event_kind, occurred_at)
    VALUES
      ('event-1', 'run-1', 'provider_event', '2026-01-01T00:00:05.000Z'),
      ('event-2', 'run-2', 'tool_call_start', '2026-01-01T00:00:04.000Z'),
      ('event-3', 'run-3', 'message', '2026-01-01T00:00:06.000Z'),
      ('event-4', 'run-4', 'message', '2026-01-01T00:00:19.000Z')
  `).run();
  db.prepare(`
    INSERT INTO execution_run_attempt_events (id, execution_run_id, event_type, created_at)
    VALUES
      ('attempt-1', 'run-1', 'failed', '2026-01-01T00:00:01.000Z'),
      ('attempt-4', 'run-4', 'failed', '2026-01-01T00:00:13.000Z')
  `).run();
  return db;
}

function promotionSummary(overrides: Partial<RuntimeBenchmarkSummary> = {}): RuntimeBenchmarkSummary {
  const taskIds = Array.from({ length: 10 }, (_, index) => `task-${index + 1}`);
  return {
    scope: {
      goalKey: "INS-G006",
      goalSprintId: "goal",
      sprintIds: ["goal"],
      taskIds,
      companyIds: ["company-1"],
      runStartedAt: "2026-01-01T00:00:00.000Z",
      runEndedAt: "2026-01-01T00:10:00.000Z",
      overseerScope: "company_all_turns",
    },
    protocol: {
      fixtureId: "ins-g006-runtime-replay-v1",
      arm: "candidate",
      repeatIndex: 1,
      requiredRepeats: 3,
      expectedTaskCount: 10,
      frozenTaskKeys: taskIds.map((id) => id.replace("task", "INS")),
    },
    taskCount: 10,
    executionRunCount: 10,
    completedRunCount: 10,
    nonCompletedRunCount: 0,
    tasksWithBreakdowns: 0,
    tasksWithMultipleRuns: 0,
    averageRunsPerTask: 1,
    recordedDurationMs: 600_000,
    executionUsage: {
      inputTokens: 10_000,
      cacheReadInputTokens: 5_000,
      freshInputTokens: 5_000,
      outputTokens: 2_000,
      totalTokens: 12_000,
      estimatedCostUsd: null,
    },
    overseerTurnCount: 0,
    overseerUsage: {
      inputTokens: 0,
      cacheReadInputTokens: 0,
      freshInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
    },
    combinedUsage: {
      inputTokens: 10_000,
      cacheReadInputTokens: 5_000,
      freshInputTokens: 5_000,
      outputTokens: 2_000,
      totalTokens: 12_000,
      estimatedCostUsd: null,
    },
    failureBuckets: {
      deterministicPreflight: 0,
      intentionalCancellation: 0,
      runtimeQuality: 0,
    },
    repeatedFailures: [],
    actionLedger: {
      total: 10,
      terminal: 10,
      nonTerminalParsed: 0,
      parseFailed: 0,
      pendingApproval: 0,
      untracked: 0,
    },
    browserProof: {
      total: 1,
      succeeded: 1,
      failed: 0,
      succeededUnder30s: 1,
      maxDurationMs: 10_000,
    },
    latency: {
      firstEvidenceMs: {
        sampleCount: 10,
        medianMs: 2_000,
        p95Ms: 5_000,
      },
      detectUnhealthyMs: {
        sampleCount: 0,
        medianMs: null,
        p95Ms: null,
      },
    },
    ...overrides,
  };
}

async function run() {
  await test("usage totals separate cache-read and fresh input", () => {
    const totals = usageTotalsFromJson([
      { token_usage_json: '{"inputTokens":100,"cacheReadInputTokens":80,"outputTokens":10,"totalTokens":110}' },
      { usage_json: '{"inputTokens":25,"cachedInputTokens":5,"outputTokens":5}' },
      { usage_json: '{"inputTokens":10,"cacheReadInputTokens":40,"outputTokens":2,"totalTokens":12}' },
    ]);

    assert.equal(totals.inputTokens, 135);
    assert.equal(totals.cacheReadInputTokens, 125);
    assert.equal(totals.freshInputTokens, 40);
    assert.equal(totals.outputTokens, 17);
    assert.equal(totals.totalTokens, 152);
  });

  await test("failure classifier separates deterministic, intentional, and runtime failures", () => {
    assert.equal(
      classifyRunFailure({ status: "failed", failure_class: "runtime_error", error_message: "env: node: No such file or directory" }),
      "deterministicPreflight",
    );
    assert.equal(
      classifyRunFailure({ status: "cancelled", failure_class: "coalesced", error_message: "Execution wake coalesced into an already active run." }),
      "intentionalCancellation",
    );
    assert.equal(
      classifyRunFailure({ status: "failed", failure_class: "silent_timeout", error_message: "No stdout" }),
      "runtimeQuality",
    );
  });

  await test("benchmark summary includes execution and overseer usage", () => {
    const db = createFixtureDb();
    try {
      const summary = buildRuntimeBenchmarkSummary(db, "INS-G006");
      assert.equal(summary.taskCount, 2);
      assert.equal(summary.executionRunCount, 4);
      assert.equal(summary.scope.overseerScope, "company_all_turns");
      assert.equal(summary.protocol.expectedTaskCount, 10);
      assert.deepEqual(summary.protocol.frozenTaskKeys, []);
      assert.equal(summary.failureBuckets.deterministicPreflight, 1);
      assert.equal(summary.failureBuckets.intentionalCancellation, 1);
      assert.equal(summary.failureBuckets.runtimeQuality, 1);
      assert.equal(summary.executionUsage.freshInputTokens, 20);
      assert.equal(summary.overseerTurnCount, 1);
      assert.equal(summary.overseerUsage.freshInputTokens, 10);
      assert.equal(summary.combinedUsage.freshInputTokens, 30);
      assert.equal(summary.actionLedger.total, 2);
      assert.equal(summary.actionLedger.nonTerminalParsed, 0);
      assert.equal(summary.actionLedger.parseFailed, 1);
      assert.equal(summary.actionLedger.untracked, 0);
      assert.equal(summary.browserProof.total, 2);
      assert.equal(summary.browserProof.succeededUnder30s, 1);
      assert.equal(summary.latency.firstEvidenceMs.sampleCount, 4);
      assert.equal(summary.latency.firstEvidenceMs.medianMs, 3500);
      assert.equal(summary.latency.firstEvidenceMs.p95Ms, 10000);
      assert.equal(summary.latency.detectUnhealthyMs.sampleCount, 1);
      assert.equal(summary.latency.detectUnhealthyMs.medianMs, 4000);
    } finally {
      db.close();
    }
  });

  await test("promotion gate passes only with baseline, proof, terminal actions, and improved fresh input", () => {
    const current = promotionSummary();
    const baseline = promotionSummary({
      averageRunsPerTask: 2,
      executionRunCount: 20,
      combinedUsage: {
        inputTokens: 100_000,
        cacheReadInputTokens: 0,
        freshInputTokens: 100_000,
        outputTokens: 10_000,
        totalTokens: 110_000,
        estimatedCostUsd: null,
      },
    });
    assert.equal(evaluateRuntimeBenchmarkPromotionGate(current, baseline).ok, true);
    assert.equal(
      evaluateRuntimeBenchmarkPromotionGate(promotionSummary({
        actionLedger: {
          total: 10,
          terminal: 9,
          nonTerminalParsed: 1,
          parseFailed: 0,
          pendingApproval: 0,
          untracked: 0,
        },
      }), baseline).ok,
      false,
    );
    assert.equal(evaluateRuntimeBenchmarkPromotionGate(current, null).ok, false);
  });

  await test("promotion report enforces repeat fixture protocol and replay-noise comparisons", () => {
    const evidence = {
      uiConsistency: { ok: true, source: "ui-truth-smoke" },
      untrackedActions: { ok: true, count: 0, source: "action-ledger-query" },
    };
    const baselineSummaries = [0, 1, 2].map((index) => promotionSummary({
      protocol: {
        fixtureId: "ins-g006-runtime-replay-v1",
        arm: "baseline",
        repeatIndex: index + 1,
        requiredRepeats: 3,
        expectedTaskCount: 10,
        frozenTaskKeys: Array.from({ length: 10 }, (_, taskIndex) => `INS-${taskIndex + 1}`),
      },
      averageRunsPerTask: 2 + index * 0.1,
      executionRunCount: 20 + index,
      combinedUsage: {
        inputTokens: 100_000,
        cacheReadInputTokens: 0,
        freshInputTokens: 100_000 + index * 1_000,
        outputTokens: 10_000,
        totalTokens: 110_000,
        estimatedCostUsd: null,
      },
      latency: {
        firstEvidenceMs: {
          sampleCount: 20 + index,
          medianMs: [10_000, 11_000, 9_000][index],
          p95Ms: [30_000, 31_000, 29_000][index],
        },
        detectUnhealthyMs: {
          sampleCount: 1,
          medianMs: [60_000, 62_000, 58_000][index],
          p95Ms: [60_000, 62_000, 58_000][index],
        },
      },
    }));
    const candidateSummaries = [0, 1, 2].map((index) => promotionSummary({
      protocol: {
        fixtureId: "ins-g006-runtime-replay-v1",
        arm: "candidate",
        repeatIndex: index + 1,
        requiredRepeats: 3,
        expectedTaskCount: 10,
        frozenTaskKeys: Array.from({ length: 10 }, (_, taskIndex) => `INS-${taskIndex + 1}`),
      },
      latency: {
        firstEvidenceMs: {
          sampleCount: 10,
          medianMs: [2_000, 2_200, 2_100][index],
          p95Ms: [5_000, 5_200, 5_100][index],
        },
        detectUnhealthyMs: {
          sampleCount: 0,
          medianMs: null,
          p95Ms: null,
        },
      },
    }));

    const report = buildRuntimeBenchmarkPromotionReport(candidateSummaries, baselineSummaries, {
      requiredTaskCount: 10,
      requiredRepeats: 3,
      evidence,
    });
    assert.equal(report.gate.ok, true);
    assert.equal(report.candidate.metrics.firstEvidenceP95Ms.median, 5100);

    const missingRepeatReport = buildRuntimeBenchmarkPromotionReport(candidateSummaries.slice(0, 2), baselineSummaries, {
      requiredTaskCount: 10,
      requiredRepeats: 3,
      evidence,
    });
    assert.equal(missingRepeatReport.gate.ok, false);
    assert.equal(
      missingRepeatReport.gate.checks.find((check) => check.name === "candidate has at least 3 fixture repeats")?.ok,
      false,
    );

    const regressedLatencyReport = buildRuntimeBenchmarkPromotionReport(
      candidateSummaries.map((summary) => ({
        ...summary,
        latency: {
          ...summary.latency,
          firstEvidenceMs: {
            ...summary.latency.firstEvidenceMs,
            p95Ms: 40_000,
          },
        },
      })),
      baselineSummaries,
      {
        requiredTaskCount: 10,
        requiredRepeats: 3,
        evidence,
      },
    );
    assert.equal(regressedLatencyReport.gate.ok, false);
    assert.equal(
      regressedLatencyReport.gate.checks.find((check) => check.name === "first-evidence p95 not worse than baseline median plus replay noise")?.ok,
      false,
    );
  });

  await test("benchmark markdown tolerates legacy summaries without action or proof metrics", () => {
    const legacySummary = promotionSummary() as RuntimeBenchmarkSummary & {
      actionLedger?: unknown;
      browserProof?: unknown;
      latency?: unknown;
    };
    delete legacySummary.actionLedger;
    delete legacySummary.browserProof;
    delete legacySummary.latency;

    const markdown = formatRuntimeBenchmarkMarkdown(legacySummary as RuntimeBenchmarkSummary);
    assert.match(markdown, /Total action rows: 0/);
    assert.match(markdown, /Total proof runs: 0/);
    assert.match(markdown, /First evidence samples: 0/);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
