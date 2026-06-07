import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  buildRuntimeBenchmarkSummary,
  classifyRunFailure,
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
  return db;
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
      assert.equal(summary.failureBuckets.deterministicPreflight, 1);
      assert.equal(summary.failureBuckets.intentionalCancellation, 1);
      assert.equal(summary.failureBuckets.runtimeQuality, 1);
      assert.equal(summary.executionUsage.freshInputTokens, 20);
      assert.equal(summary.overseerTurnCount, 1);
      assert.equal(summary.overseerUsage.freshInputTokens, 10);
      assert.equal(summary.combinedUsage.freshInputTokens, 30);
    } finally {
      db.close();
    }
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
