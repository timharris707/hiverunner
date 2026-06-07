import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { DEFAULT_ORCHESTRATION_COMPANY_ID } from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  tmpdir(),
  `orchestration-experiment-persistence-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

function columnNames(db: Database.Database, tableName: string): string[] {
  return (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

function rowsJson(db: Database.Database, tableName: string): string {
  return JSON.stringify(
    db.prepare(`SELECT * FROM ${tableName} ORDER BY id`).all(),
    Object.keys((db.prepare(`SELECT * FROM ${tableName} LIMIT 1`).get() as Record<string, unknown> | undefined) ?? {}).sort(),
  );
}

function insertExistingRunEvalImproveFixtures(db: Database.Database): {
  agentId: string;
  evalCaseId: string;
  improvementRecommendationId: string;
  projectId: string;
  runId: string;
  taskId: string;
} {
  const now = "2026-06-07T17:00:00.000Z";
  const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;
  const projectId = `experiment-project-${randomUUID()}`;
  const agentId = `experiment-agent-${randomUUID()}`;
  const taskId = `experiment-task-${randomUUID()}`;
  const runId = `experiment-run-${randomUUID()}`;
  const evalCaseId = `experiment-eval-${randomUUID()}`;
  const improvementRecommendationId = `experiment-improve-${randomUUID()}`;

  db.prepare(
    `INSERT INTO projects
       (id, company_id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Experiment persistence fixture project', '#0ea5e9', 'active', 'test', '{}', ?, ?)`,
  ).run(projectId, companyId, `experiment-project-${randomUUID()}`, "Experiment Persistence Fixture", now, now);

  db.prepare(
    `INSERT INTO agents
       (id, company_id, project_id, name, role, personality, status, skills_json, created_at, updated_at)
     VALUES (?, ?, ?, 'Experiment Runner', 'Backend Engineer', 'Deterministic', 'idle', '[]', ?, ?)`,
  ).run(agentId, companyId, projectId, now, now);

  db.prepare(
    `INSERT INTO tasks
       (id, project_id, company_id, title, description, priority, type, status, column_order,
        assignee_agent_id, created_by, labels_json, depends_on_json, execution_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'Experiment source task', 'Reviewed work used as experiment source.', 'high',
        'feature', 'done', 1000, ?, 'test', '[]', '[]', 'manual', ?, ?)`,
  ).run(taskId, projectId, companyId, agentId, now, now);

  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
        error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
        runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'experiment-session-1', 'completed', ?, ?, NULL, '{}', 60000,
        ?, 'hiverunner', 'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
  ).run(runId, taskId, agentId, now, now, `run-${runId}`, now, now);

  db.prepare(
    `INSERT INTO eval_cases
       (id, company_id, project_id, source_task_id, source_task_key, source_task_title,
        source_task_type, source_run_id, trace_route, review_outcome, reviewer_rationale,
        execution_engine, runner_provider, provider_id, runner_model, runner_agent_id,
        runner_agent_name, capture_quality, evidence_gaps_json, redaction_summary_json,
        redacted_snapshot_json, snapshot_sha256, idempotency_key, created_by_agent_id, created_at)
     VALUES (?, ?, ?, ?, 'INS-TEMP', 'Experiment source task', 'feature', ?, ?, 'accepted',
        'Reviewed run has enough evidence to reuse as an experiment source.', 'hiverunner',
        'openai', 'codex', 'gpt-5.5', ?, 'Experiment Runner', 'complete', '[]', '{}',
        ?, ?, ?, ?, ?)`,
  ).run(
    evalCaseId,
    companyId,
    projectId,
    taskId,
    runId,
    `/HIVE/tasks/INS-TEMP/runs/${runId}`,
    agentId,
    JSON.stringify({ schema: "hiverunner.run_trace_redacted_export.v1", runId }),
    "a".repeat(64),
    `eval-${evalCaseId}`,
    agentId,
    now,
  );

  db.prepare(
    `INSERT INTO improvement_recommendations
       (id, company_id, project_id, trigger_key, scope_type, scope_key, title, rationale,
        proposed_change, severity, confidence, status, evidence_json, original_recommendation_json,
        current_recommendation_json, trigger_class, idempotency_key, created_by_agent_id, created_at, updated_at)
     VALUES (?, ?, ?, 'experiment-accepted-report', 'company', ?, 'Existing improvement recommendation',
        'Fixture recommendation created before experiment records are written.', 'Keep existing row unchanged.',
        'medium', 'medium', 'suggested', '[]', '{}', '{}', 'experiment', ?, ?, ?, ?)`,
  ).run(
    improvementRecommendationId,
    companyId,
    projectId,
    companyId,
    `improve-${improvementRecommendationId}`,
    agentId,
    now,
    now,
  );

  return { agentId, evalCaseId, improvementRecommendationId, projectId, runId, taskId };
}

async function run() {
  console.log("\nOrchestration Experiment Persistence Migration Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const { runOrchestrationMigrations } = await import("@/lib/orchestration/db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  try {
    runOrchestrationMigrations(db);

    const fixtures = insertExistingRunEvalImproveFixtures(db);

    await test("migration creates additive experiment persistence tables", () => {
      for (const tableName of [
        "experiments",
        "experiment_sources",
        "experiment_variants",
        "experiment_attempts",
        "experiment_comparison_reports",
        "experiment_evidence_attachments",
        "experiment_persistence_migration_notes",
      ]) {
        assert.equal(tableExists(db, tableName), true, `${tableName} should exist`);
      }

      for (const column of ["workspace_mode", "limit_snapshot_json", "status", "created_at", "updated_at"]) {
        assert.ok(columnNames(db, "experiments").includes(column), `experiments.${column}`);
      }
      for (const column of ["source_run_id", "source_eval_case_id", "source_snapshot_json"]) {
        assert.ok(columnNames(db, "experiment_sources").includes(column), `experiment_sources.${column}`);
      }
      for (const column of ["execution_run_id", "eval_case_id", "trace_route", "workspace_mode", "limit_snapshot_json"]) {
        assert.ok(columnNames(db, "experiment_attempts").includes(column), `experiment_attempts.${column}`);
      }
      for (const column of ["report_json", "recommendation_id", "accepted_at", "updated_at"]) {
        assert.ok(columnNames(db, "experiment_comparison_reports").includes(column), `experiment_comparison_reports.${column}`);
      }

      const migration = db
        .prepare("SELECT name FROM schema_migrations WHERE version = 119")
        .get() as { name: string } | undefined;
      assert.equal(migration?.name, "experiment_persistence_model");

      const notes = db
        .prepare("SELECT rollback_notes FROM experiment_persistence_migration_notes WHERE migration_version = 119")
        .get() as { rollback_notes: string } | undefined;
      assert.match(notes?.rollback_notes ?? "", /do not mutate execution_runs, eval_cases, or improvement_recommendations/i);
    });

    const existingTraceEvalImproveBefore = {
      executionRuns: rowsJson(db, "execution_runs"),
      evalCases: rowsJson(db, "eval_cases"),
      improvementRecommendations: rowsJson(db, "improvement_recommendations"),
      executionRunColumns: columnNames(db, "execution_runs"),
      evalCaseColumns: columnNames(db, "eval_cases"),
      improvementRecommendationColumns: columnNames(db, "improvement_recommendations"),
    };

    await test("stores source-linked experiment, variant, attempt, report, and evidence records", () => {
      const now = "2026-06-07T17:05:00.000Z";
      const experimentId = `experiment-${randomUUID()}`;
      const variantId = `variant-${randomUUID()}`;
      const attemptId = `attempt-${randomUUID()}`;
      const reportId = `report-${randomUUID()}`;
      const evidenceId = `evidence-${randomUUID()}`;
      const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;

      db.prepare(
        `INSERT INTO experiments
           (id, company_id, project_id, source_kind, primary_source_run_id, primary_source_eval_case_id,
            source_task_id, source_trace_route, objective, objective_kind, definition_of_better,
            hypothesis, workspace_mode, workspace_snapshot_json, limit_snapshot_json,
            limit_snapshot_sha256, status, created_by_agent_id, created_at, updated_at)
         VALUES (?, ?, ?, 'eval_case', ?, ?, ?, ?, 'Improve evidence quality for reviewed backend tasks.',
            'evidence_quality', 'The better variant leaves stronger source-linked verification evidence.',
            'A tighter handoff should produce clearer evidence.', 'snapshot', ?, ?, ?, 'approved', ?, ?, ?)`,
      ).run(
        experimentId,
        companyId,
        fixtures.projectId,
        fixtures.runId,
        fixtures.evalCaseId,
        fixtures.taskId,
        `/HIVE/tasks/INS-TEMP/runs/${fixtures.runId}`,
        JSON.stringify({ mode: "snapshot", workspaceRoot: "/tmp/hiverunner-experiment-snapshot" }),
        JSON.stringify({ maxVariants: 3, maxAttemptsPerVariant: 2, maxCostUsd: 1, maxDurationMinutes: 30 }),
        "b".repeat(64),
        fixtures.agentId,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO experiment_sources
           (id, experiment_id, company_id, source_type, source_run_id, source_task_id, trace_route,
            source_snapshot_json, source_snapshot_sha256, created_at)
         VALUES (?, ?, ?, 'run_trace', ?, ?, ?, ?, ?, ?)`,
      ).run(
        `source-run-${randomUUID()}`,
        experimentId,
        companyId,
        fixtures.runId,
        fixtures.taskId,
        `/HIVE/tasks/INS-TEMP/runs/${fixtures.runId}`,
        JSON.stringify({ schema: "hiverunner.experiment_source_snapshot.v1", source: "run_trace" }),
        "c".repeat(64),
        now,
      );

      db.prepare(
        `INSERT INTO experiment_sources
           (id, experiment_id, company_id, source_type, source_eval_case_id, source_task_id, trace_route,
            source_snapshot_json, source_snapshot_sha256, created_at)
         VALUES (?, ?, ?, 'eval_case', ?, ?, ?, ?, ?, ?)`,
      ).run(
        `source-eval-${randomUUID()}`,
        experimentId,
        companyId,
        fixtures.evalCaseId,
        fixtures.taskId,
        `/HIVE/evals/${fixtures.evalCaseId}`,
        JSON.stringify({ schema: "hiverunner.experiment_source_snapshot.v1", source: "eval_case" }),
        "d".repeat(64),
        now,
      );

      db.prepare(
        `INSERT INTO experiment_variants
           (id, experiment_id, company_id, variant_key, name, description, change_type,
            planned_change_json, status, approval_snapshot_json, limit_snapshot_json,
            limit_snapshot_sha256, proposed_by_agent_id, approved_by_agent_id, approved_at, created_at, updated_at)
         VALUES (?, ?, ?, 'variant-a', 'Evidence-focused handoff', 'Add explicit evidence requirements to the handoff.',
            'prompt', ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        variantId,
        experimentId,
        companyId,
        JSON.stringify({ promptDelta: "Require source-linked verification." }),
        JSON.stringify({ approvedBy: "operator", maxAttempts: 2 }),
        JSON.stringify({ maxAttempts: 2, maxCostUsd: 0.5 }),
        "e".repeat(64),
        fixtures.agentId,
        fixtures.agentId,
        now,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO experiment_attempts
           (id, experiment_id, variant_id, company_id, attempt_number, status, workspace_mode,
            workspace_ref, context_snapshot_json, limit_snapshot_json, limit_snapshot_sha256,
            execution_run_id, eval_case_id, trace_route, comparison_snapshot_json, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'succeeded', 'snapshot', 'snapshot:/tmp/experiment-attempt-1',
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        attemptId,
        experimentId,
        variantId,
        companyId,
        JSON.stringify({ freshContext: true }),
        JSON.stringify({ maxCostUsd: 0.5, maxDurationMinutes: 10 }),
        "f".repeat(64),
        fixtures.runId,
        fixtures.evalCaseId,
        `/HIVE/tasks/INS-TEMP/runs/${fixtures.runId}`,
        JSON.stringify({ accepted: true, evidenceQuality: "strong" }),
        now,
        now,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO experiment_comparison_reports
           (id, experiment_id, company_id, status, summary, report_json, conclusion_json,
            winning_variant_id, recommendation_id, report_sha256, generated_by_agent_id, created_at, updated_at)
         VALUES (?, ?, ?, 'generated', 'Variant A produced stronger source-linked evidence.', ?, ?,
            ?, ?, ?, ?, ?, ?)`,
      ).run(
        reportId,
        experimentId,
        companyId,
        JSON.stringify({
          schema: "hiverunner.experiment_comparison_report.v1",
          baseline: { runId: fixtures.runId, evalCaseId: fixtures.evalCaseId },
          variants: [{ id: variantId, attemptId, outcome: "better_evidence" }],
        }),
        JSON.stringify({ outcome: "variant_wins", reason: "stronger verification evidence" }),
        variantId,
        fixtures.improvementRecommendationId,
        "1".repeat(64),
        fixtures.agentId,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO experiment_evidence_attachments
           (id, company_id, experiment_id, attempt_id, report_id, attachment_scope, evidence_type,
            title, summary, artifact_uri, artifact_kind, artifact_sha256, source_run_id,
            source_eval_case_id, recommendation_id, evidence_json, created_by_agent_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'report', 'comparison_report', 'Comparison report',
            'Report saved as linked experiment evidence.', 'file:///tmp/experiment-report.json',
            'json', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        evidenceId,
        companyId,
        experimentId,
        attemptId,
        reportId,
        "2".repeat(64),
        fixtures.runId,
        fixtures.evalCaseId,
        fixtures.improvementRecommendationId,
        JSON.stringify({ reportId, sourceRunId: fixtures.runId, sourceEvalCaseId: fixtures.evalCaseId }),
        fixtures.agentId,
        now,
      );

      const joined = db
        .prepare(
          `SELECT
             e.workspace_mode,
             e.limit_snapshot_sha256,
             v.status AS variant_status,
             a.status AS attempt_status,
             a.execution_run_id,
             a.eval_case_id,
             r.recommendation_id,
             ev.artifact_sha256
           FROM experiments e
           JOIN experiment_variants v ON v.experiment_id = e.id
           JOIN experiment_attempts a ON a.variant_id = v.id
           JOIN experiment_comparison_reports r ON r.experiment_id = e.id
           JOIN experiment_evidence_attachments ev ON ev.report_id = r.id
           WHERE e.id = ?`,
        )
        .get(experimentId) as {
          artifact_sha256: string;
          eval_case_id: string;
          execution_run_id: string;
          limit_snapshot_sha256: string;
          recommendation_id: string;
          attempt_status: string;
          variant_status: string;
          workspace_mode: string;
        } | undefined;

      assert.equal(joined?.workspace_mode, "snapshot");
      assert.equal(joined?.limit_snapshot_sha256, "b".repeat(64));
      assert.equal(joined?.variant_status, "approved");
      assert.equal(joined?.attempt_status, "succeeded");
      assert.equal(joined?.execution_run_id, fixtures.runId);
      assert.equal(joined?.eval_case_id, fixtures.evalCaseId);
      assert.equal(joined?.recommendation_id, fixtures.improvementRecommendationId);
      assert.equal(joined?.artifact_sha256, "2".repeat(64));

      const sourceCount = db
        .prepare("SELECT COUNT(*) AS count FROM experiment_sources WHERE experiment_id = ?")
        .get(experimentId) as { count: number };
      assert.equal(sourceCount.count, 2);
    });

    await test("experiment writes do not mutate existing Trace, Eval, or Improve records", () => {
      assert.equal(rowsJson(db, "execution_runs"), existingTraceEvalImproveBefore.executionRuns);
      assert.equal(rowsJson(db, "eval_cases"), existingTraceEvalImproveBefore.evalCases);
      assert.equal(rowsJson(db, "improvement_recommendations"), existingTraceEvalImproveBefore.improvementRecommendations);

      for (const [tableName, beforeColumns] of Object.entries({
        execution_runs: existingTraceEvalImproveBefore.executionRunColumns,
        eval_cases: existingTraceEvalImproveBefore.evalCaseColumns,
        improvement_recommendations: existingTraceEvalImproveBefore.improvementRecommendationColumns,
      })) {
        assert.deepEqual(columnNames(db, tableName), beforeColumns);
        assert.equal(
          beforeColumns.some((column) => column.startsWith("experiment_") || column === "experiment_id"),
          false,
          `${tableName} should not gain experiment-specific columns`,
        );
      }
    });

    await test("migration can be reapplied after a missing marker and remains idempotent", () => {
      db.prepare("DELETE FROM schema_migrations WHERE version = 119").run();
      assert.doesNotThrow(() => runOrchestrationMigrations(db));
      assert.doesNotThrow(() => runOrchestrationMigrations(db));

      const migrationRows = db
        .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 119")
        .get() as { count: number };
      assert.equal(migrationRows.count, 1);

      const notes = db
        .prepare("SELECT COUNT(*) AS count FROM experiment_persistence_migration_notes WHERE migration_version = 119")
        .get() as { count: number };
      assert.equal(notes.count, 1);
      assert.equal(rowsJson(db, "execution_runs"), existingTraceEvalImproveBefore.executionRuns);
      assert.equal(rowsJson(db, "eval_cases"), existingTraceEvalImproveBefore.evalCases);
      assert.equal(rowsJson(db, "improvement_recommendations"), existingTraceEvalImproveBefore.improvementRecommendations);
    });
  } finally {
    db.close();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }
}

run()
  .then(() => finish())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
