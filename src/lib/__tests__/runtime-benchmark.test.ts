import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  buildRuntimeBenchmarkPromotionReport,
  buildRuntimeBenchmarkSummary,
  buildSafetySignalEvidenceFromSummary,
  classifyRunFailure,
  DEFAULT_OVERSEER_TOKEN_CEILING,
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
      company_id TEXT,
      status TEXT NOT NULL DEFAULT 'done',
      blocked_reason TEXT
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
      status TEXT NOT NULL,
      execution_status TEXT,
      created_at TEXT
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
  db
    .prepare("INSERT INTO tasks (id, sprint_id, task_key, company_id, status, blocked_reason) VALUES ('task-1', 'sprint-1', 'INS-1', 'company-1', 'done', NULL)")
    .run();
  db
    .prepare("INSERT INTO tasks (id, sprint_id, task_key, company_id, status, blocked_reason) VALUES ('task-2', 'sprint-1', 'INS-2', 'company-1', 'blocked', NULL)")
    .run();
  db.prepare(`
    INSERT INTO execution_runs
      (id, task_id, status, failure_class, error_message, token_usage_json, duration_ms, created_at, started_at, completed_at, updated_at)
    VALUES
      ('run-1', 'task-1', 'failed', 'deterministic_preflight', 'External runner command exited with code 127: env: node: No such file or directory', '{}', 1000, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z'),
      ('run-2', 'task-1', 'completed', NULL, NULL, '{"inputTokens":100,"cacheReadInputTokens":80,"outputTokens":20,"totalTokens":120}', 2000, '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:04.000Z', '2026-01-01T00:00:04.000Z'),
      ('run-3', 'task-2', 'cancelled', 'coalesced', 'Execution wake coalesced into an already active run.', '{}', 3000, '2026-01-01T00:00:05.000Z', '2026-01-01T00:00:05.000Z', '2026-01-01T00:00:08.000Z', '2026-01-01T00:00:08.000Z'),
      ('run-4', 'task-2', 'failed', 'no_output_timeout', 'External runner command produced no stdout/stderr for 600000ms', '{}', 4000, '2026-01-01T00:00:09.000Z', '2026-01-01T00:00:09.000Z', '2026-01-01T00:00:13.000Z', '2026-01-01T00:00:13.000Z')
  `).run();
  db.prepare(`
    INSERT INTO overseer_turns (id, company_id, usage_json, created_at)
    VALUES ('turn-1', 'company-1', '{"inputTokens":50,"cacheReadInputTokens":40,"outputTokens":5,"totalTokens":55}', '2026-01-01T00:00:06.000Z')
  `).run();
  db.prepare(`
    INSERT INTO runtime_action_ledger (id, task_id, execution_run_id, status, execution_status, created_at)
    VALUES
      ('action-1', 'task-1', 'run-2', 'parsed', 'executed', '2026-01-01T00:00:04.000Z'),
      ('action-2', 'task-2', 'run-4', 'parse_failed', 'parse_failed', '2026-01-01T00:00:12.000Z')
  `).run();
  db.prepare(`
    INSERT INTO runtime_browser_proof_audit (id, task_id, status, duration_ms, created_at)
    VALUES
      ('proof-1', 'task-1', 'succeeded', 9000, '2026-01-01T00:00:04.000Z'),
      ('proof-2', 'task-2', 'failed', 45000, '2026-01-01T00:00:11.000Z')
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
    finalTaskStatus: {
      total: 10,
      done: 10,
      nonDone: 0,
      missingStatusCount: 0,
      blockedWithoutReason: 0,
      byStatus: {
        done: 10,
      },
      nonDoneTaskKeys: [],
      blockedWithoutReasonTaskKeys: [],
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
    executionUsageValidation: {
      completedRunCount: 10,
      withUsageCount: 10,
      missingUsageCount: 0,
      invalidUsageCount: 0,
      missingUsageRunIds: [],
      invalidUsageRunIds: [],
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
    safetySignals: {
      preflightCircuitOpenCount: 0,
      preflightDistinctFingerprintCount: 0,
      fallbackUsedCount: 0,
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
      classifyRunFailure({ status: "failed", failure_class: "deterministic_preflight", error_message: "env: node: No such file or directory" }),
      "deterministicPreflight",
    );
    assert.equal(
      classifyRunFailure({ status: "cancelled", failure_class: "coalesced", error_message: "Execution wake coalesced into an already active run." }),
      "intentionalCancellation",
    );
    assert.equal(
      classifyRunFailure({ status: "failed", failure_class: "no_output_timeout", error_message: "No stdout" }),
      "runtimeQuality",
    );
  });

  await test("benchmark summary includes execution and overseer usage", () => {
    const db = createFixtureDb();
    try {
      const summary = buildRuntimeBenchmarkSummary(db, "INS-G006");
      assert.equal(summary.taskCount, 2);
      assert.deepEqual(summary.finalTaskStatus, {
        total: 2,
        done: 1,
        nonDone: 1,
        missingStatusCount: 0,
        blockedWithoutReason: 1,
        byStatus: {
          blocked: 1,
          done: 1,
        },
        nonDoneTaskKeys: ["INS-2"],
        blockedWithoutReasonTaskKeys: ["INS-2"],
      });
      assert.equal(summary.executionRunCount, 4);
      assert.equal(summary.scope.overseerScope, "company_all_turns");
      assert.equal(summary.protocol.expectedTaskCount, 10);
      assert.deepEqual(summary.protocol.frozenTaskKeys, []);
      assert.equal(summary.failureBuckets.deterministicPreflight, 1);
      assert.equal(summary.failureBuckets.intentionalCancellation, 1);
      assert.equal(summary.failureBuckets.runtimeQuality, 1);
      assert.equal(summary.executionUsage.freshInputTokens, 20);
      assert.deepEqual(summary.executionUsageValidation, {
        completedRunCount: 1,
        withUsageCount: 1,
        missingUsageCount: 0,
        invalidUsageCount: 0,
        missingUsageRunIds: [],
        invalidUsageRunIds: [],
      });
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
      assert.equal(summary.latency.firstEvidenceMs.medianMs, 2500);
      assert.equal(summary.latency.firstEvidenceMs.p95Ms, 5000);
      assert.equal(summary.latency.detectUnhealthyMs.sampleCount, 1);
      assert.equal(summary.latency.detectUnhealthyMs.medianMs, 4000);
    } finally {
      db.close();
    }
  });

  await test("benchmark summary classifies completed runs with missing usage", () => {
    const db = createFixtureDb();
    try {
      db.prepare("UPDATE execution_runs SET token_usage_json = '{}' WHERE id = 'run-2'").run();
      const summary = buildRuntimeBenchmarkSummary(db, "INS-G006");

      assert.equal(summary.completedRunCount, 1);
      assert.deepEqual(summary.executionUsageValidation, {
        completedRunCount: 1,
        withUsageCount: 0,
        missingUsageCount: 1,
        invalidUsageCount: 0,
        missingUsageRunIds: ["run-2"],
        invalidUsageRunIds: [],
      });
      assert.equal(summary.executionUsage.totalTokens, 0);
    } finally {
      db.close();
    }
  });

  await test("benchmark summary classifies completed runs with invalid usage", () => {
    const db = createFixtureDb();
    try {
      db.prepare("UPDATE execution_runs SET token_usage_json = ? WHERE id = 'run-2'").run("{");
      const summary = buildRuntimeBenchmarkSummary(db, "INS-G006");

      assert.equal(summary.completedRunCount, 1);
      assert.deepEqual(summary.executionUsageValidation, {
        completedRunCount: 1,
        withUsageCount: 0,
        missingUsageCount: 0,
        invalidUsageCount: 1,
        missingUsageRunIds: [],
        invalidUsageRunIds: ["run-2"],
      });
      assert.equal(summary.executionUsage.totalTokens, 0);
    } finally {
      db.close();
    }
  });

  await test("benchmark summary filters frozen task keys and run windows", () => {
    const db = createFixtureDb();
    try {
      const summary = buildRuntimeBenchmarkSummary(db, "INS-G006", {
        expectedTaskCount: 1,
        taskKeys: [" INS-2 ", "INS-2"],
        runStartedAfter: "2026-01-01T00:00:08.000Z",
        runStartedBefore: "2026-01-01T00:00:14.000Z",
      });

      assert.equal(summary.taskCount, 1);
      assert.deepEqual(summary.protocol.frozenTaskKeys, ["INS-2"]);
      assert.deepEqual(summary.finalTaskStatus, {
        total: 1,
        done: 0,
        nonDone: 1,
        missingStatusCount: 0,
        blockedWithoutReason: 1,
        byStatus: {
          blocked: 1,
        },
        nonDoneTaskKeys: ["INS-2"],
        blockedWithoutReasonTaskKeys: ["INS-2"],
      });
      assert.equal(summary.executionRunCount, 1);
      assert.equal(summary.completedRunCount, 0);
      assert.equal(summary.failureBuckets.runtimeQuality, 1);
      assert.equal(summary.overseerTurnCount, 0);
      assert.equal(summary.actionLedger.total, 1);
      assert.equal(summary.actionLedger.parseFailed, 1);
      assert.equal(summary.browserProof.total, 1);
      assert.equal(summary.browserProof.failed, 1);
      assert.equal(summary.latency.firstEvidenceMs.sampleCount, 1);
      assert.equal(summary.latency.firstEvidenceMs.medianMs, 3_000);
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
    const missingUsageResult = evaluateRuntimeBenchmarkPromotionGate(promotionSummary({
      executionUsageValidation: {
        completedRunCount: 10,
        withUsageCount: 9,
        missingUsageCount: 1,
        invalidUsageCount: 0,
        missingUsageRunIds: ["run-missing-usage"],
        invalidUsageRunIds: [],
      },
    }), baseline);
    assert.equal(missingUsageResult.ok, false);
    assert.equal(
      missingUsageResult.checks.find((check) => check.name === "candidate completed runs have no missing_usage/invalid usage")?.ok,
      false,
    );
    const blockedTaskResult = evaluateRuntimeBenchmarkPromotionGate(promotionSummary({
      finalTaskStatus: {
        total: 10,
        done: 9,
        nonDone: 1,
        missingStatusCount: 0,
        blockedWithoutReason: 1,
        byStatus: {
          blocked: 1,
          done: 9,
        },
        nonDoneTaskKeys: ["INS-278"],
        blockedWithoutReasonTaskKeys: ["INS-278"],
      },
    }), baseline);
    assert.equal(blockedTaskResult.ok, false);
    assert.equal(
      blockedTaskResult.checks.find((check) => check.name === "candidate final fixture tasks are all done")?.ok,
      false,
    );
    assert.match(
      String(blockedTaskResult.checks.find((check) => check.name === "candidate final fixture tasks are all done")?.detail),
      /blocked without reason INS-278/,
    );
    const legacySummary = promotionSummary() as RuntimeBenchmarkSummary & { executionUsageValidation?: unknown };
    delete legacySummary.executionUsageValidation;
    const missingValidationResult = evaluateRuntimeBenchmarkPromotionGate(legacySummary as RuntimeBenchmarkSummary, baseline);
    assert.equal(missingValidationResult.ok, false);
    assert.equal(
      missingValidationResult.checks.find((check) => check.name === "candidate completed runs have no missing_usage/invalid usage")?.value,
      "missing validation",
    );
    const legacyTaskStatusSummary = promotionSummary() as RuntimeBenchmarkSummary & { finalTaskStatus?: unknown };
    delete legacyTaskStatusSummary.finalTaskStatus;
    const missingFinalTaskStatusResult = evaluateRuntimeBenchmarkPromotionGate(legacyTaskStatusSummary as RuntimeBenchmarkSummary, baseline);
    assert.equal(missingFinalTaskStatusResult.ok, false);
    assert.equal(
      missingFinalTaskStatusResult.checks.find((check) => check.name === "candidate final fixture tasks are all done")?.value,
      "missing final task status evidence",
    );
    assert.equal(evaluateRuntimeBenchmarkPromotionGate(current, null).ok, false);
  });

  await test("promotion report enforces repeat fixture protocol and replay-noise comparisons", () => {
    const evidence = {
      uiConsistency: { ok: true, source: "ui-truth-smoke" },
      untrackedActions: { ok: true, count: 0, source: "action-ledger-query" },
      safetySignals: {
        preflightCircuitOpen: { ok: true, count: 1, source: "safety-demo" },
        detectUnhealthy: { ok: true, count: 1, source: "safety-demo" },
        overseerWatch: { ok: true, count: 1, source: "safety-demo" },
        providerFallback: { ok: true, count: 1, source: "safety-demo" },
      },
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

    const missingUsageReport = buildRuntimeBenchmarkPromotionReport(
      candidateSummaries.map((summary, index) => index === 0
        ? {
          ...summary,
          executionUsageValidation: {
            completedRunCount: 10,
            withUsageCount: 9,
            missingUsageCount: 1,
            invalidUsageCount: 0,
            missingUsageRunIds: ["run-missing-usage"],
            invalidUsageRunIds: [],
          },
        }
        : summary),
      baselineSummaries,
      {
        requiredTaskCount: 10,
        requiredRepeats: 3,
        evidence,
      },
    );
    assert.equal(missingUsageReport.gate.ok, false);
    assert.equal(
      missingUsageReport.gate.checks.find((check) => check.name === "candidate completed runs have no missing_usage/invalid usage")?.ok,
      false,
    );

    const blockedFinalTaskReport = buildRuntimeBenchmarkPromotionReport(
      candidateSummaries.map((summary, index) => index === 0
        ? {
          ...summary,
          finalTaskStatus: {
            total: 10,
            done: 9,
            nonDone: 1,
            missingStatusCount: 0,
            blockedWithoutReason: 1,
            byStatus: {
              blocked: 1,
              done: 9,
            },
            nonDoneTaskKeys: ["INS-278"],
            blockedWithoutReasonTaskKeys: ["INS-278"],
          },
        }
        : summary),
      baselineSummaries,
      {
        requiredTaskCount: 10,
        requiredRepeats: 3,
        evidence,
      },
    );
    assert.equal(blockedFinalTaskReport.gate.ok, false);
    assert.equal(
      blockedFinalTaskReport.gate.checks.find((check) => check.name === "candidate final fixture tasks are all done")?.ok,
      false,
    );
    assert.match(
      String(blockedFinalTaskReport.gate.checks.find((check) => check.name === "candidate final fixture tasks are all done")?.detail),
      /r1:INS-278/,
    );

    const mismatchedFixtureReport = buildRuntimeBenchmarkPromotionReport(
      candidateSummaries.map((summary, index) => index === 0
        ? {
          ...summary,
          protocol: {
            ...summary.protocol,
            frozenTaskKeys: ["INS-A", "INS-B"],
          },
        }
        : summary),
      baselineSummaries,
      {
        requiredTaskCount: 10,
        requiredRepeats: 3,
        evidence,
      },
    );
    assert.equal(mismatchedFixtureReport.gate.ok, false);
    assert.equal(
      mismatchedFixtureReport.gate.checks.find((check) => check.name === "all repeats share frozen task keys")?.ok,
      false,
    );
  });

  await test("benchmark markdown tolerates legacy summaries without action or proof metrics", () => {
    const legacySummary = promotionSummary() as RuntimeBenchmarkSummary & {
      actionLedger?: unknown;
      browserProof?: unknown;
      latency?: unknown;
      executionUsageValidation?: unknown;
      finalTaskStatus?: unknown;
    };
    delete legacySummary.actionLedger;
    delete legacySummary.browserProof;
    delete legacySummary.latency;
    delete legacySummary.executionUsageValidation;
    delete legacySummary.finalTaskStatus;

    const markdown = formatRuntimeBenchmarkMarkdown(legacySummary as RuntimeBenchmarkSummary);
    assert.match(markdown, /Total action rows: 0/);
    assert.match(markdown, /Total proof runs: 0/);
    assert.match(markdown, /First evidence samples: 0/);
    assert.match(markdown, /Completed runs with usage: 0\/0/);
    assert.match(markdown, /Final tasks done: 0\/0/);
    assert.match(markdown, /Status counts: none/);
  });

  await test("benchmark summary counts fallback_used runs and deterministic preflight circuit-open rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-benchmark-safety-"));
    const db = new Database(path.join(dir, "fixture.db"));
    db.exec(`
      CREATE TABLE sprints (id TEXT PRIMARY KEY, parent_id TEXT, goal_key TEXT);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, sprint_id TEXT, task_key TEXT, company_id TEXT, status TEXT NOT NULL DEFAULT 'done', blocked_reason TEXT);
      CREATE TABLE execution_runs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, failure_class TEXT, error_message TEXT,
        token_usage_json TEXT NOT NULL DEFAULT '{}', duration_ms INTEGER, created_at TEXT, started_at TEXT, completed_at TEXT, updated_at TEXT,
        fallback_used INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE overseer_turns (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, usage_json TEXT NOT NULL DEFAULT '{}', created_at TEXT);
      CREATE TABLE runtime_preflight_results (id TEXT PRIMARY KEY, classification TEXT, runtime_fingerprint TEXT, created_at TEXT);
    `);
    db.prepare("INSERT INTO sprints (id, parent_id, goal_key) VALUES ('goal', NULL, 'INS-G006')").run();
    db.prepare("INSERT INTO sprints (id, parent_id, goal_key) VALUES ('sprint-1', 'goal', NULL)").run();
    db.prepare("INSERT INTO tasks (id, sprint_id, task_key, company_id, status, blocked_reason) VALUES ('task-1', 'sprint-1', 'INS-1', 'company-1', 'done', NULL)").run();
    db.prepare(`INSERT INTO execution_runs (id, task_id, status, token_usage_json, duration_ms, created_at, started_at, completed_at, updated_at, fallback_used) VALUES
      ('r1','task-1','completed','{}',10,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:01.000Z','2026-01-01T00:00:01.000Z',1),
      ('r2','task-1','completed','{}',10,'2026-01-01T00:00:02.000Z','2026-01-01T00:00:02.000Z','2026-01-01T00:00:03.000Z','2026-01-01T00:00:03.000Z',0)
    `).run();
    db.prepare(`INSERT INTO runtime_preflight_results (id, classification, runtime_fingerprint, created_at) VALUES
      ('p1','deterministic_preflight','fingerprint-A','2026-01-01T00:00:00.500Z'),
      ('p2','quarantined_provider_model_fingerprint','fingerprint-B','2026-01-01T00:00:00.500Z')
    `).run();

    const summary = buildRuntimeBenchmarkSummary(db, "INS-G006");
    assert.equal(summary.safetySignals.fallbackUsedCount, 1);
    // Only classification='deterministic_preflight' rows count as circuit-opens (the quarantined row is excluded).
    assert.equal(summary.safetySignals.preflightCircuitOpenCount, 1);
    assert.equal(summary.safetySignals.preflightDistinctFingerprintCount, 1);
    db.close();
  });

  await test("promotion report fails when any safety-signal attestation is missing or did not fire", () => {
    const frozenKeys = Array.from({ length: 10 }, (_, i) => `INS-${i + 1}`);
    const baselineSummaries = [0, 1, 2].map((index) => promotionSummary({
      protocol: { fixtureId: "ins-g006-runtime-replay-v1", arm: "baseline", repeatIndex: index + 1, requiredRepeats: 3, expectedTaskCount: 10, frozenTaskKeys: frozenKeys },
      averageRunsPerTask: 2 + index * 0.1,
      executionRunCount: 20 + index,
      combinedUsage: { inputTokens: 100_000, cacheReadInputTokens: 0, freshInputTokens: 100_000 + index * 1_000, outputTokens: 10_000, totalTokens: 110_000, estimatedCostUsd: null },
      latency: { firstEvidenceMs: { sampleCount: 20 + index, medianMs: [10_000, 11_000, 9_000][index], p95Ms: [30_000, 31_000, 29_000][index] }, detectUnhealthyMs: { sampleCount: 1, medianMs: [60_000, 62_000, 58_000][index], p95Ms: [60_000, 62_000, 58_000][index] } },
    }));
    const candidateSummaries = [0, 1, 2].map((index) => promotionSummary({
      protocol: { fixtureId: "ins-g006-runtime-replay-v1", arm: "candidate", repeatIndex: index + 1, requiredRepeats: 3, expectedTaskCount: 10, frozenTaskKeys: frozenKeys },
      latency: { firstEvidenceMs: { sampleCount: 10, medianMs: [2_000, 2_200, 2_100][index], p95Ms: [5_000, 5_200, 5_100][index] }, detectUnhealthyMs: { sampleCount: 0, medianMs: null, p95Ms: null } },
    }));
    const allPass = {
      preflightCircuitOpen: { ok: true, count: 1, source: "demo" },
      detectUnhealthy: { ok: true, count: 1, source: "demo" },
      overseerWatch: { ok: true, count: 1, source: "demo" },
      providerFallback: { ok: true, count: 1, source: "demo" },
    };
    const baseEvidence = { uiConsistency: { ok: true, source: "ui" }, untrackedActions: { ok: true, count: 0, source: "ledger" } };
    const buildReport = (safetySignals?: unknown) => buildRuntimeBenchmarkPromotionReport(candidateSummaries, baselineSummaries, {
      requiredTaskCount: 10,
      requiredRepeats: 3,
      evidence: safetySignals === undefined ? baseEvidence : { ...baseEvidence, safetySignals },
    } as Parameters<typeof buildRuntimeBenchmarkPromotionReport>[2]);

    // Sanity: with all four safety signals attested, this exact input passes — so any
    // failure below is attributable to the safety dimension, not a replication error.
    assert.equal(buildReport(allPass).gate.ok, true);

    // No safetySignals block at all -> all four safety checks fail -> gate fails.
    const noSafety = buildReport(undefined);
    const safetyChecks = noSafety.gate.checks.filter((check) => check.name.startsWith("safety:"));
    assert.equal(safetyChecks.length, 4);
    assert.equal(safetyChecks.every((check) => !check.ok), true);
    assert.equal(noSafety.gate.ok, false);

    // Each individual signal missing/not-fired fails the gate on exactly that check.
    for (const key of ["preflightCircuitOpen", "detectUnhealthy", "overseerWatch", "providerFallback"] as const) {
      const report = buildReport({ ...allPass, [key]: { ok: false, count: 0, source: "demo" } });
      assert.equal(report.gate.ok, false, `expected gate to fail when ${key} did not fire`);
    }
  });

  await test("fresh-input metric divides by COMPLETED (done) tasks per goal spec #238, reporting per-run and per-task separately", () => {
    // A summary where done (6), completed runs (12), and fixture tasks (10) are all different,
    // so the three denominators yield distinct numbers and we can prove which one the gate metric uses.
    const summary = promotionSummary({
      taskCount: 10,
      completedRunCount: 12,
      combinedUsage: { inputTokens: 600_000, cacheReadInputTokens: 0, freshInputTokens: 600_000, outputTokens: 0, totalTokens: 600_000, estimatedCostUsd: null },
      finalTaskStatus: {
        total: 10, done: 6, nonDone: 4, missingStatusCount: 0, blockedWithoutReason: 0,
        byStatus: { done: 6, review: 4 }, nonDoneTaskKeys: ["INS-7", "INS-8", "INS-9", "INS-10"], blockedWithoutReasonTaskKeys: [],
      },
    });
    const report = buildRuntimeBenchmarkPromotionReport([promotionSummary()], [summary], {});
    // spec metric: 600000 / 6 done = 100000 (NOT 50000 per-run, NOT 60000 per-task)
    assert.equal(report.baseline.metrics.freshInputPerCompletedTask.median, 100_000);
    assert.equal(report.baseline.metrics.freshInputPerCompletedRun.median, 50_000);
    assert.equal(report.baseline.metrics.freshInputPerFixtureTask.median, 60_000);
  });

  await test("buildSafetySignalEvidenceFromSummary derives attestations from real demo summary counts", () => {
    const okLatency = { firstEvidenceMs: { sampleCount: 10, medianMs: 2_000, p95Ms: 5_000 }, detectUnhealthyMs: { sampleCount: 1, medianMs: 91_000, p95Ms: 91_000 } };

    const demo = promotionSummary({
      safetySignals: { preflightCircuitOpenCount: 1, preflightDistinctFingerprintCount: 1, fallbackUsedCount: 2 },
      overseerTurnCount: 1,
      overseerUsage: { inputTokens: 3_000, cacheReadInputTokens: 0, freshInputTokens: 3_000, outputTokens: 500, totalTokens: 3_500, estimatedCostUsd: null },
      latency: okLatency,
    });
    const ev = buildSafetySignalEvidenceFromSummary(demo);
    assert.equal(ev.preflightCircuitOpen?.ok, true);
    assert.equal(ev.preflightCircuitOpen?.count, 1);
    assert.equal(ev.detectUnhealthy?.ok, true);
    assert.equal(ev.detectUnhealthy?.count, 1);
    assert.equal(ev.overseerWatch?.ok, true);
    assert.equal(ev.providerFallback?.ok, true);
    assert.equal(ev.providerFallback?.count, 2);

    // Churn: 2 circuit-open rows across 1 fingerprint -> not ok.
    assert.equal(buildSafetySignalEvidenceFromSummary(promotionSummary({
      safetySignals: { preflightCircuitOpenCount: 2, preflightDistinctFingerprintCount: 1, fallbackUsedCount: 1 },
      overseerTurnCount: 1, latency: okLatency,
    })).preflightCircuitOpen?.ok, false);

    // Overseer over the token ceiling -> not ok.
    assert.equal(buildSafetySignalEvidenceFromSummary(promotionSummary({
      safetySignals: { preflightCircuitOpenCount: 1, preflightDistinctFingerprintCount: 1, fallbackUsedCount: 1 },
      overseerTurnCount: 1,
      overseerUsage: { inputTokens: 0, cacheReadInputTokens: 0, freshInputTokens: 0, outputTokens: 0, totalTokens: DEFAULT_OVERSEER_TOKEN_CEILING + 1, estimatedCostUsd: null },
      latency: okLatency,
    })).overseerWatch?.ok, false);

    // No overseer turn -> not ok.
    assert.equal(buildSafetySignalEvidenceFromSummary(promotionSummary({
      safetySignals: { preflightCircuitOpenCount: 1, preflightDistinctFingerprintCount: 1, fallbackUsedCount: 1 },
      overseerTurnCount: 0, latency: okLatency,
    })).overseerWatch?.ok, false);

    // No detect-unhealthy sample (default latency) -> not ok; no fallback -> not ok.
    const noSignals = buildSafetySignalEvidenceFromSummary(promotionSummary({ overseerTurnCount: 1 }));
    assert.equal(noSignals.detectUnhealthy?.ok, false);
    assert.equal(noSignals.providerFallback?.ok, false);
    assert.equal(noSignals.preflightCircuitOpen?.ok, false);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
