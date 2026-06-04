/**
 * Contract test for finishRun continuation gating.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-finish-run-continuation.db
 * npx tsx src/lib/__tests__/orchestration-finish-run-continuation.test.ts
 */

import assert from "node:assert";
import {
  DEFAULT_ORCHESTRATION_COMPANY_ID,
  createBasicFixtureTask,
  createFixtureAgent,
  createFixtureProject,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

type OrchestrationDb = ReturnType<typeof import("@/lib/orchestration/db")["getOrchestrationDb"]>;

type HeartbeatRunResult = {
  messagesImported: number;
  actionsFound: number;
  actionsExecuted: number;
  actionsSkippedDedup: number;
  tasksCreated: unknown[];
  approvalsCreated: unknown[];
  reportsImported: number;
  errors: unknown[];
};

async function createFixture() {
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const companyId = DEFAULT_ORCHESTRATION_COMPANY_ID;

  const project = createFixtureProject(createProject, {
    companyId,
    namePrefix: "Finish Run Continuation",
    label: "fixture",
    description: "Continuation gating fixture",
    color: "#0ea5e9",
    emoji: "🧪",
  });

  const agent = createFixtureAgent(createProjectAgent, {
    projectId: project.id,
    namePrefix: "Continuation Agent",
    emoji: "🔧",
    role: "Backend Engineer",
    openclawPrefix: "continuation-agent",
    skills: ["orchestration"],
  });

  const task = createBasicFixtureTask(createTask, {
    projectId: project.id,
    title: "Continuation gating task",
    description: "Disposable continuation test task.",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    createdBy: "test-suite",
  });

  const db = getOrchestrationDb();
  return { db, project, agent, task, companyId };
}

function continuationResult(overrides: Partial<HeartbeatRunResult>): HeartbeatRunResult {
  return {
    messagesImported: 0,
    actionsFound: 0,
    actionsExecuted: 0,
    actionsSkippedDedup: 0,
    tasksCreated: [],
    approvalsCreated: [],
    reportsImported: 0,
    errors: [],
    ...overrides,
  };
}

function setTaskStatus(db: OrchestrationDb, taskId: string, status: string): void {
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, new Date().toISOString(), taskId);
}

function seedHeartbeatRun(
  db: OrchestrationDb,
  input: {
    runId: string;
    agentId: string;
    companyId: string;
    taskId: string;
    resultJson: HeartbeatRunResult;
  },
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, status, context_snapshot_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'succeeded', ?, ?, ?, ?)`
  ).run(
    input.runId,
    input.agentId,
    input.companyId,
    JSON.stringify({ taskId: input.taskId }),
    JSON.stringify(input.resultJson),
    now,
    now,
  );
}

async function assertNoContinuationForRun(input: {
  taskStatus: string;
  runId: string;
  runStatus: "failed" | "succeeded";
  resultJson: HeartbeatRunResult;
  failureMessage?: (decision: unknown) => string;
}): Promise<void> {
  const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
  const { db, companyId, agent, task } = await createFixture();

  setTaskStatus(db, task.id, input.taskStatus);
  seedHeartbeatRun(db, {
    runId: input.runId,
    agentId: agent.id,
    companyId,
    taskId: task.id,
    resultJson: input.resultJson,
  });

  const decision = decideFinishRunContinuation(task.id, input.runId, input.runStatus, db);
  assert.deepStrictEqual(
    decision,
    { shouldContinue: false },
    input.failureMessage?.(decision),
  );
}

console.log("\nOrchestration Finish Run Continuation Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    resetSqliteDatabaseFiles(dbPath);

    await test("Failed passive-report runs do not auto-continue on to-do tasks", async () => {
      await assertNoContinuationForRun({
        taskStatus: "to-do",
        runId: "run-passive-failed",
        runStatus: "failed",
        resultJson: continuationResult({
          messagesImported: 1,
          reportsImported: 1,
        }),
      });
    });

    await test("Successful to-do runs do NOT auto-continue even with actions executed (no self-loop)", async () => {
      // Regression: a task still in to-do at the end of a run means
      // nothing structurally moved it. Comments and reports don't count
      // — they're narrative. The only way to advance is update_task to
      // a different status, and if that had run we wouldn't be in the
      // to-do branch. Auto-continuing here caused agents (e.g. Barometer
      // on WEA-262, 2026-04-17) to re-wake themselves forever by posting
      // narrative comments.
      await assertNoContinuationForRun({
        taskStatus: "to-do",
        runId: "run-to-do-actions",
        runStatus: "succeeded",
        resultJson: continuationResult({
          messagesImported: 1,
          actionsFound: 7,
          actionsExecuted: 7,
          reportsImported: 2,
        }),
        failureMessage: (decision) =>
          `to-do task with narrative-only actions must NOT auto-continue; got: ${JSON.stringify(decision)}`,
      });
    });

    await test("to-do with zero actions also does not continue (baseline unchanged)", async () => {
      await assertNoContinuationForRun({
        taskStatus: "to-do",
        runId: "run-to-do-empty",
        runStatus: "succeeded",
        resultJson: continuationResult({}),
      });
    });

    await test("in_progress task with actions does not self-continue", async () => {
      await assertNoContinuationForRun({
        taskStatus: "in_progress",
        runId: "run-in-progress-with-actions",
        runStatus: "succeeded",
        resultJson: continuationResult({
          messagesImported: 1,
          actionsFound: 2,
          actionsExecuted: 2,
        }),
        failureMessage: (decision) =>
          `in_progress tasks with actions must wait for the next external wake instead of self-looping; got: ${JSON.stringify(decision)}`,
      });
    });

    await test("Successful in_progress report-only runs do not continue", async () => {
      await assertNoContinuationForRun({
        taskStatus: "in_progress",
        runId: "run-in-progress-report-only",
        runStatus: "succeeded",
        resultJson: continuationResult({
          messagesImported: 1,
          reportsImported: 1,
        }),
      });
    });

    await test("finished task queues next ready assigned task for same idle agent", async () => {
      const { createTask } = await import("@/lib/orchestration/service");
      const { __testHooks } = await import("@/lib/orchestration/engine/engine");
      const { configureCompanyExecutionHive, ensureCompanyExecutionHives } = await import("@/lib/orchestration/service/execution-hives");
      const { db, companyId, project, agent, task } = await createFixture();

      ensureCompanyExecutionHives({ companyIdOrSlug: companyId }, db);
      configureCompanyExecutionHive({
        companyIdOrSlug: companyId,
        hiveId: "balanced-builder",
        orchestrationMode: "hiverunner",
        runtimeProvider: "openclaw",
        runtimeLabel: "OpenClaw",
      }, db);
      db.prepare("DELETE FROM heartbeat_runs WHERE company_id = ?").run(companyId);
      db.prepare("DELETE FROM agent_wakeup_requests WHERE company_id = ?").run(companyId);
      db.prepare("DELETE FROM execution_runs WHERE agent_id = ?").run(agent.id);
      setTaskStatus(db, task.id, "done");

      const pendingDependency = createTask({
        projectId: project.id,
        title: "Pending dependency",
        description: "Not done yet.",
        priority: "P1",
        type: "infrastructure",
        status: "to-do",
        labels: ["continuation"],
        createdBy: "test-suite",
      }).task;
      const blockedCandidate = createTask({
        projectId: project.id,
        title: "Blocked next assigned task",
        description: "Higher priority but dependency-blocked.",
        priority: "P1",
        type: "infrastructure",
        status: "to-do",
        assignee: agent.id,
        labels: ["continuation"],
        createdBy: "test-suite",
      }).task;
      db.prepare("UPDATE tasks SET depends_on_json = ? WHERE id = ?")
        .run(JSON.stringify([pendingDependency.id]), blockedCandidate.id);

      const readyCandidate = createTask({
        projectId: project.id,
        title: "Ready next assigned task",
        description: "Should start immediately after prior task completion.",
        priority: "P2",
        type: "infrastructure",
        status: "to-do",
        assignee: agent.id,
        labels: ["continuation"],
        createdBy: "test-suite",
      }).task;

      const result = __testHooks.maybeEnqueueNextReadyAssignedTaskForAgent({
        agentId: agent.id,
        companyId,
        completedTaskId: task.id,
        currentTaskStatus: "done",
        runId: "run-next-ready",
        db,
      });

      assert.deepStrictEqual(result, { queued: true, taskId: readyCandidate.id, reason: "queued" });
      const readyStatus = db.prepare("SELECT status FROM tasks WHERE id = ?").get(readyCandidate.id) as { status: string };
      assert.equal(readyStatus.status, "in_progress");
      const blockedStatus = db.prepare("SELECT status FROM tasks WHERE id = ?").get(blockedCandidate.id) as { status: string };
      assert.equal(blockedStatus.status, "to-do");

      const wake = db.prepare(
        `SELECT source, reason, payload_json, idempotency_key
         FROM agent_wakeup_requests
         WHERE agent_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      ).get(agent.id) as { source: string; reason: string; payload_json: string; idempotency_key: string };
      assert.equal(wake.source, "issue_assigned");
      assert.equal(wake.reason, "engine_next_ready_task_assignment");
      assert.equal(wake.idempotency_key, `next-ready:${readyCandidate.id}:${agent.id}`);
      assert.equal(JSON.parse(wake.payload_json).taskId, readyCandidate.id);

      const duplicate = __testHooks.maybeEnqueueNextReadyAssignedTaskForAgent({
        agentId: agent.id,
        companyId,
        completedTaskId: task.id,
        currentTaskStatus: "done",
        runId: "run-next-ready-duplicate",
        db,
      });
      assert.equal(duplicate.queued, false);
      assert.equal(duplicate.reason, "agent_already_has_active_wake");
      const wakeCount = db.prepare(
        `SELECT COUNT(*) AS count
         FROM agent_wakeup_requests
         WHERE agent_id = ? AND reason = 'engine_next_ready_task_assignment'`,
      ).get(agent.id) as { count: number };
      assert.equal(wakeCount.count, 1);
    });
  } finally {
    resetSqliteDatabaseFiles(dbPath);
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
