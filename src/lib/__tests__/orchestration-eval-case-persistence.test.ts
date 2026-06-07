import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  createFixtureAgent,
  createFixtureProject,
  DEFAULT_ORCHESTRATION_COMPANY_ID,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import type { RunTraceEvidenceInput } from "@/lib/orchestration/run-trace";

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]" });

const now = Date.parse("2026-06-06T20:00:00.000Z");
const secretApiKey = "sk-proj-1234567890abcdefghijklmnopqrstuv";
const secretBearer = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret";

function traceInput(input: {
  runId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  agentId: string;
  agentName: string;
}): RunTraceEvidenceInput {
  return {
    run: {
      id: input.runId,
      status: "succeeded",
      providerId: "codex",
      invocationSource: "codex",
      startedAt: "2026-06-06T20:00:00.000Z",
      finishedAt: "2026-06-06T20:01:00.000Z",
      durationMs: 60_000,
      error: null,
    },
    task: {
      id: input.taskId,
      key: input.taskKey,
      title: input.taskTitle,
      status: "done",
      priority: "P1",
    },
    provider: {
      id: "codex",
      displayName: "Codex",
      capabilities: {
        liveText: true,
        actionDetection: true,
        structuredTools: true,
        thinking: true,
        runSteering: true,
        persistedTranscript: true,
      },
    },
    providerExecution: {
      structuredTelemetry: true,
      observedLiveText: true,
      observedStructuredTools: true,
      observedThinking: true,
      assistantSummary: `The runner used ${secretBearer} in a discarded local payload.`,
      resultErrors: [],
    },
    metrics: {
      durationMs: 60_000,
      inputTokens: 120,
      outputTokens: 80,
      totalCostUsd: 0.05,
      actionsFound: 1,
      actionsExecuted: 1,
    },
    transcript: {
      entries: [{
        id: "entry-1",
        body: `The provider emitted ${secretApiKey} before redaction.`,
        type: "assistant_text_final",
        source: "codex",
        ts: now,
      }],
      provenance: {
        totalEntries: 1,
        fullTranscriptAvailable: true,
        source: "execution_run_transcript_events",
      },
    },
    timeline: [
      { id: "started", kind: "run_start", summary: "started", ts: now, source: "execution_transcript" },
      {
        id: "assistant",
        kind: "assistant_text_final",
        summary: `Provider returned ${secretApiKey}.`,
        ts: now + 20_000,
        source: "execution_transcript",
        metadata: {
          env: {
            OPENAI_API_KEY: secretApiKey,
            NORMAL_ENV: "visible",
          },
        },
      },
      { id: "done", kind: "run_end", summary: "done", ts: now + 60_000, source: "execution_transcript" },
    ],
    workspaceRunVisibility: { schema: "hiverunner.workspace_run_visibility.v1" },
    memoryEvidence: { records: [{ id: "memory-1" }] },
    rawPayload: {
      request: {
        headers: {
          authorization: secretBearer,
        },
        env: {
          OPENAI_API_KEY: secretApiKey,
          NORMAL_ENV: "visible",
        },
      },
    },
  };
}

async function run() {
  console.log("\nOrchestration Eval Case Persistence Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-eval-case-persistence-",
  });

  try {
    const { getOrchestrationDb, runOrchestrationMigrations } = await import("@/lib/orchestration/db");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { buildRedactedRunTraceExport } = await import("@/lib/orchestration/run-trace");
    const { createEvalCase } = await import("@/lib/orchestration/eval-cases");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const project = createFixtureProject(createProject, {
      namePrefix: "Eval Case Project",
      label: "persistence",
      description: "Eval case persistence fixture",
      color: "#0ea5e9",
      emoji: "E",
    });
    const runner = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "EvalRunner",
      openclawPrefix: "eval-runner",
      emoji: "R",
      role: "Backend Engineer",
      skills: ["backend"],
    });
    const reviewer = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "EvalReviewer",
      openclawPrefix: "eval-reviewer",
      emoji: "Q",
      role: "QA Reviewer",
      skills: ["qa"],
    });
    const task = createTask({
      projectId: project.id,
      title: "Capture reviewed evidence as an eval case",
      description: "Store reviewed Run Trace evidence for later comparison.",
      labels: [],
      assignee: runner.id,
      createdBy: reviewer.id,
      priority: "P1",
      type: "feature",
      status: "done",
    }).task;
    const runId = "eval-case-run-1";
    const taskKey = task.key ?? task.id;

    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
          error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
          runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
       VALUES
         (?, ?, ?, 'codex', ?, 'completed', ?, ?, NULL, ?, 60000, ?, 'hiverunner',
          'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
    ).run(
      runId,
      task.id,
      runner.id,
      "eval-session-1",
      "2026-06-06T20:00:00.000Z",
      "2026-06-06T20:01:00.000Z",
      JSON.stringify({ runnerProvider: "openai", runnerModel: "gpt-5.5" }),
      "eval-run-idempotency",
      "2026-06-06T20:00:00.000Z",
      "2026-06-06T20:01:00.000Z",
    );

    const trace = traceInput({
      runId,
      taskId: task.id,
      taskKey,
      taskTitle: task.title,
      agentId: runner.id,
      agentName: runner.name,
    });
    const redactedSnapshot = buildRedactedRunTraceExport(trace);
    const traceRoute = `/HIVE/tasks/${taskKey}/runs/${runId}`;

    await test("migration creates the eval case table, indexes, and immutable update trigger", () => {
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'eval_cases'")
        .get() as { name: string } | undefined;
      const index = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_eval_cases_source_run'")
        .get() as { name: string } | undefined;
      const trigger = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'eval_cases_prevent_update'")
        .get() as { name: string } | undefined;

      assert.equal(table?.name, "eval_cases");
      assert.equal(index?.name, "idx_eval_cases_source_run");
      assert.equal(trigger?.name, "eval_cases_prevent_update");
    });

    let evalCaseId = "";
    let snapshotSha256 = "";

    await test("creates an immutable eval case from a redacted Run Trace snapshot", () => {
      const evalCase = createEvalCase({
        companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
        projectId: project.id,
        sourceTask: {
          id: task.id,
          key: taskKey,
          title: task.title,
          type: task.type,
        },
        sourceRun: {
          id: runId,
          traceRoute,
          executionEngine: "hiverunner",
          runnerProvider: "openai",
          providerId: "codex",
          runnerModel: "gpt-5.5",
          agentId: runner.id,
          agentName: runner.name,
        },
        templateContext: {
          templateId: "starter-build",
          templateVersion: 3,
        },
        review: {
          outcome: "accepted",
          rationale: "The reviewed run satisfied the task contract and has enough evidence to reuse.",
          reviewerAgentId: reviewer.id,
          reviewerName: reviewer.name,
          reviewedAt: "2026-06-06T21:00:00.000Z",
        },
        captureQuality: redactedSnapshot.captureQuality.label,
        evidenceGaps: redactedSnapshot.evidenceGaps,
        redactedSnapshot,
        idempotencyKey: `${runId}:accepted`,
        createdByAgentId: reviewer.id,
      }, db);

      evalCaseId = evalCase.id;
      snapshotSha256 = evalCase.snapshotSha256;

      assert.equal(evalCase.sourceTask.key, taskKey);
      assert.equal(evalCase.sourceRun.id, runId);
      assert.equal(evalCase.sourceRun.traceRoute, traceRoute);
      assert.equal(evalCase.review.outcome, "accepted");
      assert.equal(evalCase.review.reviewerAgentId, reviewer.id);
      assert.equal(evalCase.sourceRun.runnerProvider, "openai");
      assert.equal(evalCase.sourceRun.providerId, "codex");
      assert.equal(evalCase.sourceRun.runnerModel, "gpt-5.5");
      assert.equal(evalCase.sourceRun.agentId, runner.id);
      assert.equal(evalCase.templateContext.templateId, "starter-build");
      assert.equal(evalCase.captureQuality, "complete");
      assert.equal(evalCase.annotationSnapshot.state, "deferred");
      assert.equal(evalCase.redactedSnapshot.schema, "hiverunner.run_trace_redacted_export.v1");
      assert.match(evalCase.snapshotSha256, /^[a-f0-9]{64}$/);
    });

    await test("returns the same row when the same idempotency key is replayed", () => {
      const replayed = createEvalCase({
        companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
        projectId: project.id,
        sourceTask: {
          id: task.id,
          key: taskKey,
          title: task.title,
          type: task.type,
        },
        sourceRun: {
          id: runId,
          traceRoute,
          executionEngine: "hiverunner",
          runnerProvider: "openai",
          providerId: "codex",
          runnerModel: "gpt-5.5",
          agentId: runner.id,
          agentName: runner.name,
        },
        review: {
          outcome: "accepted",
          rationale: "The reviewed run satisfied the task contract and has enough evidence to reuse.",
        },
        captureQuality: redactedSnapshot.captureQuality.label,
        evidenceGaps: redactedSnapshot.evidenceGaps,
        redactedSnapshot,
        idempotencyKey: `${runId}:accepted`,
      }, db);

      const count = db
        .prepare("SELECT COUNT(*) AS count FROM eval_cases WHERE source_run_id = ?")
        .get(runId) as { count: number };

      assert.equal(replayed.id, evalCaseId);
      assert.equal(replayed.snapshotSha256, snapshotSha256);
      assert.equal(count.count, 1);
    });

    await test("recovers cleanly when migration artifacts exist but the migration row is absent", () => {
      db.prepare("DELETE FROM schema_migrations WHERE version = 115").run();
      db.exec(`
        DROP TRIGGER IF EXISTS eval_cases_prevent_update;
        DROP INDEX IF EXISTS idx_eval_cases_source_run;
      `);

      assert.doesNotThrow(() => runOrchestrationMigrations(db));

      const migration = db
        .prepare("SELECT name FROM schema_migrations WHERE version = 115")
        .get() as { name: string } | undefined;
      const trigger = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'eval_cases_prevent_update'")
        .get() as { name: string } | undefined;
      const index = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_eval_cases_source_run'")
        .get() as { name: string } | undefined;
      const count = db
        .prepare("SELECT COUNT(*) AS count FROM eval_cases WHERE id = ?")
        .get(evalCaseId) as { count: number };

      assert.equal(migration?.name, "eval_case_persistence");
      assert.equal(trigger?.name, "eval_cases_prevent_update");
      assert.equal(index?.name, "idx_eval_cases_source_run");
      assert.equal(count.count, 1);
    });

    await test("rejects updates to stored eval case snapshots", () => {
      assert.throws(
        () => db.prepare("UPDATE eval_cases SET reviewer_rationale = ? WHERE id = ?").run("changed", evalCaseId),
        /eval_cases are immutable/,
      );
    });

    await test("stores no unredacted trace secret values", () => {
      const row = db
        .prepare("SELECT redacted_snapshot_json FROM eval_cases WHERE id = ?")
        .get(evalCaseId) as { redacted_snapshot_json: string } | undefined;

      assert.ok(row);
      assert.doesNotMatch(row.redacted_snapshot_json, /sk-proj-[A-Za-z0-9_-]+/);
      assert.doesNotMatch(row.redacted_snapshot_json, /Bearer\s+[A-Za-z0-9._-]+/i);
      assert.match(row.redacted_snapshot_json, /\[REDACTED:api_key\]/);
      assert.match(row.redacted_snapshot_json, /\[REDACTED:bearer_token\]/);
    });

    await test("rejects non-redacted Run Trace snapshot schemas", () => {
      assert.throws(
        () => createEvalCase({
          companyId: DEFAULT_ORCHESTRATION_COMPANY_ID,
          projectId: project.id,
          sourceTask: {
            id: task.id,
            key: taskKey,
            title: task.title,
            type: task.type,
          },
          sourceRun: {
            id: "raw-run",
            traceRoute: `/HIVE/tasks/${taskKey}/runs/raw-run`,
          },
          review: {
            outcome: "returned",
            rationale: "This raw snapshot must not be stored as an eval case.",
          },
          captureQuality: "partial",
          evidenceGaps: [],
          redactedSnapshot: {
            ...redactedSnapshot,
            schema: "hiverunner.run_trace_view.v1",
          } as typeof redactedSnapshot,
        }, db),
        /redacted Run Trace export schema/,
      );
    });
  } finally {
    workspaceIsolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
