import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createFixtureAgent, createFixtureProject } from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  os.tmpdir(),
  `orchestration-experiment-attempt-runner-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "[PASS]", failLabel: "[FAIL]", errorStackLines: 3 });

type AttemptRow = {
  attempt_number: number;
  status: string;
  workspace_ref: string | null;
  context_snapshot_json: string;
  comparison_snapshot_json: string;
  execution_run_id: string | null;
  trace_route: string | null;
  error_message: string | null;
};

function removeTestDatabaseFiles(dbPath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

function parseJson(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

function apiErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : null;
}

function expectApiError(fn: () => Promise<unknown>, code: string): Promise<void> {
  return fn().then(
    () => {
      throw new Error(`Expected ${code}`);
    },
    (error) => {
      assert.equal(apiErrorCode(error), code);
    },
  );
}

async function run() {
  console.log("\nOrchestration Experiment Attempt Runner Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  removeTestDatabaseFiles(dbPath);
  const sourceRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-attempt-source-"));
  writeFileSync(path.join(sourceRoot, "source.txt"), "source-state");

  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-experiment-attempt-runner-",
  });

  try {
    const { createCompany } = await import("@/lib/orchestration/company-service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const {
      approveExperimentVariants,
      createExperimentDraft,
    } = await import("@/lib/orchestration/experiments");
    const { runExperimentAttempt } = await import("@/lib/orchestration/experiment-attempt-runner");
    const { createEvalCase, RUN_TRACE_REDACTED_EXPORT_SCHEMA, RUN_TRACE_REDACTION_POLICY } = await import("@/lib/orchestration/eval-cases");
    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { listExecutionTranscriptEvents } = await import("@/lib/orchestration/service/execution-transcript");

    const db = getOrchestrationDb();
    workspaceIsolation.syncDatabase(db);

    const stamp = Date.now();
    const company = createCompany({
      name: `Attempt Runner ${stamp}`,
      description: "Attempt runner fixture company.",
      status: "active",
    }).company;
    db.prepare("UPDATE companies SET company_code = ? WHERE id = ?").run("INS", company.id);
    const project = createFixtureProject(createProject, {
      companyId: company.id,
      namePrefix: "Attempt Runner Project",
      label: "runner",
      description: "Attempt runner fixture project.",
      color: "#2563eb",
      emoji: "R",
    });
    const agent = createFixtureAgent(createProjectAgent, {
      projectId: project.id,
      namePrefix: "AttemptRunner",
      openclawPrefix: "attempt-runner",
      emoji: "R",
      role: "Backend Engineer",
      skills: ["backend"],
    });
    const task = createTask({
      projectId: project.id,
      title: "Reviewed source for isolated attempts",
      description: "Source task for attempt runner tests.",
      priority: "P1",
      type: "feature",
      status: "done",
      labels: ["experiments"],
      assignee: agent.id,
      createdBy: agent.id,
    }).task;
    const taskKey = task.key ?? task.id;
    const now = "2026-06-07T19:00:00.000Z";
    const runId = `attempt-source-run-${randomUUID()}`;
    db.prepare(
      `INSERT INTO execution_runs
         (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
          error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
          runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, 'codex', 'attempt-source-session', 'completed', ?, ?,
          NULL, '{}', 15000, ?, 'hiverunner', 'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
    ).run(runId, task.id, agent.id, now, now, `run-${runId}`, now, now);

    const evalCase = createEvalCase({
      companyId: company.id,
      projectId: project.id,
      sourceTask: {
        id: task.id,
        key: taskKey,
        title: "Reviewed source for isolated attempts",
        type: "feature",
      },
      sourceRun: {
        id: runId,
        traceRoute: `/companies/${company.slug}/tasks/${taskKey}/runs/${runId}`,
        executionEngine: "hiverunner",
        runnerProvider: "openai",
        providerId: "codex",
        runnerModel: "gpt-5.5",
        agentId: agent.id,
        agentName: agent.name,
      },
      review: {
        outcome: "accepted",
        rationale: "Reviewed source is suitable for isolated comparison attempts.",
        reviewedAt: now,
      },
      captureQuality: "complete",
      evidenceGaps: [],
      redactedSnapshot: {
        schema: RUN_TRACE_REDACTED_EXPORT_SCHEMA,
        redaction: {
          policy: RUN_TRACE_REDACTION_POLICY,
          redactedAt: now,
          categories: {},
        },
        run: { id: runId, taskKey },
      } as never,
      idempotencyKey: `eval-${runId}`,
      createdByAgentId: agent.id,
      createdAt: now,
    }, db);

    await test("runs snapshot attempts in fresh temp workspaces, captures redacted traces, and cleans up", async () => {
      const experiment = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "reduce_review_returns",
        limits: { variantCap: 1, attemptLimit: 2, timeboxMinutes: 5 },
        variants: [{
          key: "snapshot-a",
          name: "Snapshot variant",
          changeType: "prompt",
          plannedChange: { promptDelta: "Require tighter verification." },
        }],
      }, db);
      approveExperimentVariants({
        companyIdOrSlug: company.slug,
        experimentId: experiment.id,
        variantKeys: ["snapshot-a"],
        approvedByAgentId: agent.id,
      }, db);

      const first = await runExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: experiment.id,
        variantKey: "snapshot-a",
        attemptNumber: 1,
        sourceWorkspaceRoot: sourceRoot,
        runtimeLimits: { timeboxMs: 500, maxIterations: 2, maxCostUsd: 0.5, maxTokens: 1000 },
        executor: (context) => {
          assert.equal(context.workspace.mode, "snapshot");
          assert.notEqual(context.workspace.cwd, sourceRoot);
          assert.equal(readFileSync(path.join(context.workspace.cwd, "source.txt"), "utf8"), "source-state");
          writeFileSync(path.join(context.workspace.cwd, "attempt-output.txt"), "mutated copy");
          context.recordIteration({ costUsd: 0.1, tokens: 50 });
          context.recordTraceEvent({
            kind: "message",
            role: "assistant",
            body: "Redact this key sk-proj-1234567890abcdefghijklmnop before storing.",
          });
          return {
            status: "succeeded",
            resultText: "Attempt passed verification.",
            metrics: { totalCostUsd: 0.1, totalTokens: 50 },
            verification: { passed: true },
            transcriptEvents: [{
              kind: "message",
              role: "assistant",
              body: "Also redact Bearer eyJhbGciOiJIUzI1NiJ9.fixture-token",
            }],
          };
        },
      }, db);

      assert.equal(first.status, "succeeded");
      assert.equal(first.cleanedUp, true);
      assert.equal(first.tempRoot ? existsSync(first.tempRoot) : true, false);
      assert.equal(existsSync(path.join(sourceRoot, "attempt-output.txt")), false);
      assert.match(first.traceRoute, new RegExp(`/companies/${company.slug}/tasks/${taskKey}/runs/`));

      const second = await runExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: experiment.id,
        variantKey: "snapshot-a",
        attemptNumber: 2,
        sourceWorkspaceRoot: sourceRoot,
        runtimeLimits: { timeboxMs: 500, maxIterations: 2, maxCostUsd: 0.5, maxTokens: 1000 },
        executor: (context) => {
          assert.equal(context.workspace.mode, "snapshot");
          assert.notEqual(context.workspace.cwd, first.workspaceRoot);
          context.recordIteration({ costUsd: 0.05, tokens: 25 });
          return {
            status: "succeeded",
            resultText: "Second fresh attempt passed.",
            metrics: { totalCostUsd: 0.05, totalTokens: 25 },
            verification: { passed: true },
          };
        },
      }, db);

      assert.equal(second.status, "succeeded");
      assert.equal(second.cleanedUp, true);
      assert.notEqual(second.contextId, first.contextId);
      assert.notEqual(second.workspaceRef, first.workspaceRef);

      const attempts = db
        .prepare(
          `SELECT attempt_number, status, workspace_ref, context_snapshot_json,
                  comparison_snapshot_json, execution_run_id, trace_route, error_message
           FROM experiment_attempts
           WHERE experiment_id = ?
           ORDER BY attempt_number ASC`,
        )
        .all(experiment.id) as AttemptRow[];
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts.map((attempt) => attempt.status), ["succeeded", "succeeded"]);

      const contextOne = parseJson(attempts[0].context_snapshot_json);
      const contextTwo = parseJson(attempts[1].context_snapshot_json);
      assert.equal(contextOne.schema, "hiverunner.experiment_attempt_context.v1");
      assert.notEqual(contextOne.contextId, contextTwo.contextId);
      assert.notEqual(attempts[0].workspace_ref, attempts[1].workspace_ref);
      assert.doesNotMatch(JSON.stringify(contextOne), /sk-proj-|Bearer\s/i);

      const comparisonOne = parseJson(attempts[0].comparison_snapshot_json);
      assert.equal(comparisonOne.schema, "hiverunner.experiment_attempt_trace.v1");
      assert.doesNotMatch(JSON.stringify(comparisonOne), /sk-proj-|Bearer\s/i);

      const run = db
        .prepare("SELECT status, metadata_json, token_usage_json FROM execution_runs WHERE id = ?")
        .get(first.executionRunId) as { status: string; metadata_json: string; token_usage_json: string } | undefined;
      assert.equal(run?.status, "completed");
      assert.equal(parseJson(run?.metadata_json ?? "{}").experimentId, experiment.id);
      assert.equal(parseJson(run?.token_usage_json ?? "{}").totalTokens, 50);

      const transcriptEvents = listExecutionTranscriptEvents(db, first.executionRunId);
      assert.equal(transcriptEvents.length, 2);
      assert.doesNotMatch(JSON.stringify(transcriptEvents), /sk-proj-|Bearer\s/i);
    });

    await test("runs branch attempts in separate reversible workspaces and cleans temp state", async () => {
      const experiment = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "shorten_runtime",
        workspaceMode: "branch",
        limits: { variantCap: 1, attemptLimit: 1, timeboxMinutes: 5 },
        variants: [{ key: "branch-a", name: "Branch variant", changeType: "context_package" }],
      }, db);
      approveExperimentVariants({
        companyIdOrSlug: company.slug,
        experimentId: experiment.id,
        variantKeys: ["branch-a"],
        approvedByAgentId: agent.id,
      }, db);

      const result = await runExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: experiment.id,
        variantKey: "branch-a",
        attemptNumber: 1,
        sourceWorkspaceRoot: sourceRoot,
        runtimeLimits: { timeboxMs: 500, maxIterations: 1, maxCostUsd: 0.5, maxTokens: 1000 },
        executor: (context) => {
          assert.equal(context.workspace.mode, "branch");
          assert.notEqual(context.workspace.cwd, sourceRoot);
          assert.match(context.workspace.ref, /^branch:/);
          writeFileSync(path.join(context.workspace.cwd, "branch-output.txt"), "branch mutation");
          context.recordIteration({ costUsd: 0.02, tokens: 20 });
          return {
            status: "succeeded",
            resultText: "Branch attempt passed.",
            metrics: { totalCostUsd: 0.02, totalTokens: 20 },
            verification: { passed: true },
          };
        },
      }, db);

      assert.equal(result.status, "succeeded");
      assert.equal(result.cleanedUp, true);
      assert.equal(result.tempRoot ? existsSync(result.tempRoot) : true, false);
      assert.equal(existsSync(path.join(sourceRoot, "branch-output.txt")), false);
    });

    await test("branch attempts use a git worktree and leave no leftover branch in the source repo", async () => {
      const { spawnSync } = await import("node:child_process");
      const gitSourceRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-attempt-git-source-"));
      try {
        const git = (args: string[]) =>
          spawnSync("git", ["-C", gitSourceRoot, ...args], { encoding: "utf8", stdio: "pipe" });
        assert.equal(spawnSync("git", ["init", gitSourceRoot], { encoding: "utf8", stdio: "pipe" }).status, 0);
        git(["config", "user.email", "attempt-runner@example.com"]);
        git(["config", "user.name", "Attempt Runner"]);
        writeFileSync(path.join(gitSourceRoot, "source.txt"), "git-source-state");
        git(["add", "-A"]);
        assert.equal(git(["commit", "-m", "init"]).status, 0);

        const experiment = createExperimentDraft({
          companyIdOrSlug: company.slug,
          source: { kind: "eval_case", id: evalCase.id },
          objective: "shorten_runtime",
          workspaceMode: "branch",
          limits: { variantCap: 1, attemptLimit: 1, timeboxMinutes: 5 },
          variants: [{ key: "branch-git-a", name: "Branch git variant", changeType: "context_package" }],
        }, db);
        approveExperimentVariants({
          companyIdOrSlug: company.slug,
          experimentId: experiment.id,
          variantKeys: ["branch-git-a"],
          approvedByAgentId: agent.id,
        }, db);

        const result = await runExperimentAttempt({
          companyIdOrSlug: company.slug,
          experimentId: experiment.id,
          variantKey: "branch-git-a",
          attemptNumber: 1,
          sourceWorkspaceRoot: gitSourceRoot,
          runtimeLimits: { timeboxMs: 500, maxIterations: 1, maxCostUsd: 0.5, maxTokens: 1000 },
          executor: (context) => {
            assert.equal(context.workspace.mode, "branch");
            assert.match(context.workspace.ref, /^branch:hiverunner-exp-/);
            assert.doesNotMatch(context.workspace.ref, /copy-fallback/);
            assert.equal(readFileSync(path.join(context.workspace.cwd, "source.txt"), "utf8"), "git-source-state");
            context.recordIteration({ costUsd: 0.02, tokens: 20 });
            return { status: "succeeded", resultText: "Branch git attempt passed.", verification: { passed: true } };
          },
        }, db);

        assert.equal(result.status, "succeeded");
        assert.equal(result.cleanedUp, true);
        assert.equal(result.tempRoot ? existsSync(result.tempRoot) : true, false);

        const branches = spawnSync(
          "git",
          ["-C", gitSourceRoot, "branch", "--list", "hiverunner-exp-*"],
          { encoding: "utf8", stdio: "pipe" },
        );
        assert.equal(branches.status, 0);
        assert.equal(branches.stdout.trim(), "");

        const worktrees = spawnSync(
          "git",
          ["-C", gitSourceRoot, "worktree", "list"],
          { encoding: "utf8", stdio: "pipe" },
        );
        assert.doesNotMatch(worktrees.stdout, /hiverunner-experiment-branch-/);
      } finally {
        rmSync(gitSourceRoot, { recursive: true, force: true });
      }
    });

    await test("records cancellation and timeout terminal states when runtime limits are breached", async () => {
      const costExperiment = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "reduce_cost",
        limits: { variantCap: 1, attemptLimit: 1, timeboxMinutes: 5 },
        variants: [{ key: "cost-a", name: "Cost variant", changeType: "runner_model" }],
      }, db);
      approveExperimentVariants({
        companyIdOrSlug: company.slug,
        experimentId: costExperiment.id,
        variantKeys: ["cost-a"],
        approvedByAgentId: agent.id,
      }, db);

      const cancelled = await runExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: costExperiment.id,
        variantKey: "cost-a",
        attemptNumber: 1,
        sourceWorkspaceRoot: sourceRoot,
        runtimeLimits: { timeboxMs: 500, maxIterations: 2, maxCostUsd: 0.01, maxTokens: 1000 },
        executor: (context) => {
          context.recordIteration({ costUsd: 0.02, tokens: 25 });
          return { status: "succeeded" };
        },
      }, db);
      assert.equal(cancelled.status, "cancelled");

      const timeoutExperiment = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "shorten_runtime",
        limits: { variantCap: 1, attemptLimit: 1, timeboxMinutes: 5 },
        variants: [{ key: "timeout-a", name: "Timeout variant", changeType: "prompt" }],
      }, db);
      approveExperimentVariants({
        companyIdOrSlug: company.slug,
        experimentId: timeoutExperiment.id,
        variantKeys: ["timeout-a"],
        approvedByAgentId: agent.id,
      }, db);

      const timedOut = await runExperimentAttempt({
        companyIdOrSlug: company.slug,
        experimentId: timeoutExperiment.id,
        variantKey: "timeout-a",
        attemptNumber: 1,
        sourceWorkspaceRoot: sourceRoot,
        runtimeLimits: { timeboxMs: 10, maxIterations: 1, maxCostUsd: 0.5, maxTokens: 1000 },
        executor: () => new Promise((resolve) => {
          setTimeout(() => resolve({ status: "succeeded" }), 50);
        }),
      }, db);
      assert.equal(timedOut.status, "timed_out");

      const rows = db
        .prepare("SELECT status, error_message, execution_run_id FROM experiment_attempts WHERE experiment_id IN (?, ?) ORDER BY created_at ASC")
        .all(costExperiment.id, timeoutExperiment.id) as AttemptRow[];
      assert.deepEqual(rows.map((row) => row.status), ["cancelled", "timed_out"]);
      assert.match(rows[0].error_message ?? "", /cost limit/i);
      assert.match(rows[1].error_message ?? "", /timebox/i);
      for (const row of rows) {
        const run = db.prepare("SELECT status, failure_class FROM execution_runs WHERE id = ?").get(row.execution_run_id) as { status: string; failure_class: string } | undefined;
        assert.equal(run?.status, row.status === "cancelled" ? "cancelled" : "failed");
        assert.ok(run?.failure_class);
      }
    });

    await test("refuses live attempt execution unless governed live selection is passed through", async () => {
      const live = createExperimentDraft({
        companyIdOrSlug: company.slug,
        source: { kind: "eval_case", id: evalCase.id },
        objective: "improve_acceptance",
        workspaceMode: "live",
        liveWorkspaceConfirmed: true,
        liveWorkspaceReason: "Operator explicitly selected live mode for this test fixture.",
        variants: [{ key: "live-a", name: "Live variant", changeType: "prompt" }],
      }, db);
      approveExperimentVariants({
        companyIdOrSlug: company.slug,
        experimentId: live.id,
        variantKeys: ["live-a"],
        approvedByAgentId: agent.id,
        liveWorkspaceConfirmed: true,
        liveWorkspaceReason: "Operator explicitly approved live variant execution for this fixture.",
      }, db);

      await expectApiError(
        () => runExperimentAttempt({
          companyIdOrSlug: company.slug,
          experimentId: live.id,
          variantKey: "live-a",
          attemptNumber: 1,
          sourceWorkspaceRoot: sourceRoot,
          executor: () => ({ status: "succeeded" }),
        }, db),
        "live_workspace_requires_governed_selection",
      );
    });
  } finally {
    workspaceIsolation.dispose();
    rmSync(sourceRoot, { recursive: true, force: true });
    removeTestDatabaseFiles(dbPath);
  }
}

run()
  .then(() => finish())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
