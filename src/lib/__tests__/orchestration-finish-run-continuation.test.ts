/**
 * Contract test for finishRun continuation gating.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-finish-run-continuation.db
 * npx tsx src/lib/__tests__/orchestration-finish-run-continuation.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function createFixture() {
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

  const project = createProject({
    companyId,
    name: `Finish Run Continuation ${Date.now()}`,
    description: "Continuation gating fixture",
    color: "#0ea5e9",
    emoji: "🧪",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Continuation Agent ${Math.random().toString(36).slice(2, 6)}`,
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Deterministic",
    openclawAgentId: `continuation-agent-${Math.random().toString(36).slice(2, 8)}`,
    status: "idle",
    skills: ["orchestration"],
  }).agent;

  const task = createTask({
    projectId: project.id,
    title: "Continuation gating task",
    description: "Disposable continuation test task.",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: ["continuation"],
    createdBy: "test-suite",
  }).task;

  const db = getOrchestrationDb();
  return { db, project, agent, task, companyId };
}

function seedHeartbeatRun(
  db: ReturnType<typeof import("@/lib/orchestration/db")["getOrchestrationDb"]>,
  input: {
    runId: string;
    agentId: string;
    companyId: string;
    taskId: string;
    resultJson: Record<string, unknown>;
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

console.log("\nOrchestration Finish Run Continuation Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    await test("Failed passive-report runs do not auto-continue on to-do tasks", async () => {
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, companyId, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'to-do', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-passive-failed",
        agentId: agent.id,
        companyId,
        taskId: task.id,
        resultJson: {
          messagesImported: 1,
          actionsFound: 0,
          actionsExecuted: 0,
          actionsSkippedDedup: 0,
          tasksCreated: [],
          approvalsCreated: [],
          reportsImported: 1,
          errors: [],
        },
      });

      const decision = decideFinishRunContinuation(task.id, "run-passive-failed", "failed", db);
      assert.deepStrictEqual(decision, { shouldContinue: false });
    });

    await test("Successful to-do runs do NOT auto-continue even with actions executed (no self-loop)", async () => {
      // Regression: a task still in to-do at the end of a run means
      // nothing structurally moved it. Comments and reports don't count
      // — they're narrative. The only way to advance is update_task to
      // a different status, and if that had run we wouldn't be in the
      // to-do branch. Auto-continuing here caused agents (e.g. Barometer
      // on WEA-262, 2026-04-17) to re-wake themselves forever by posting
      // narrative comments.
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, companyId, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'to-do', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-to-do-actions",
        agentId: agent.id,
        companyId,
        taskId: task.id,
        resultJson: {
          messagesImported: 1,
          actionsFound: 7,
          actionsExecuted: 7,
          actionsSkippedDedup: 0,
          tasksCreated: [],
          approvalsCreated: [],
          reportsImported: 2,
          errors: [],
        },
      });

      const decision = decideFinishRunContinuation(task.id, "run-to-do-actions", "succeeded", db);
      assert.deepStrictEqual(
        decision,
        { shouldContinue: false },
        `to-do task with narrative-only actions must NOT auto-continue; got: ${JSON.stringify(decision)}`,
      );
    });

    await test("to-do with zero actions also does not continue (baseline unchanged)", async () => {
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, companyId, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'to-do', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-to-do-empty",
        agentId: agent.id,
        companyId,
        taskId: task.id,
        resultJson: {
          messagesImported: 0,
          actionsFound: 0,
          actionsExecuted: 0,
          actionsSkippedDedup: 0,
          tasksCreated: [],
          approvalsCreated: [],
          reportsImported: 0,
          errors: [],
        },
      });

      const decision = decideFinishRunContinuation(task.id, "run-to-do-empty", "succeeded", db);
      assert.deepStrictEqual(decision, { shouldContinue: false });
    });

    await test("in_progress task with actions does not self-continue", async () => {
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, companyId, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-in-progress-with-actions",
        agentId: agent.id,
        companyId,
        taskId: task.id,
        resultJson: {
          messagesImported: 1,
          actionsFound: 2,
          actionsExecuted: 2,
          actionsSkippedDedup: 0,
          tasksCreated: [],
          approvalsCreated: [],
          reportsImported: 0,
          errors: [],
        },
      });

      const decision = decideFinishRunContinuation(task.id, "run-in-progress-with-actions", "succeeded", db);
      assert.deepStrictEqual(
        decision,
        { shouldContinue: false },
        `in_progress tasks with actions must wait for the next external wake instead of self-looping; got: ${JSON.stringify(decision)}`,
      );
    });

    await test("Successful in_progress report-only runs do not continue", async () => {
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, companyId, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-in-progress-report-only",
        agentId: agent.id,
        companyId,
        taskId: task.id,
        resultJson: {
          messagesImported: 1,
          actionsFound: 0,
          actionsExecuted: 0,
          actionsSkippedDedup: 0,
          tasksCreated: [],
          approvalsCreated: [],
          reportsImported: 1,
          errors: [],
        },
      });

      const decision = decideFinishRunContinuation(task.id, "run-in-progress-report-only", "succeeded", db);
      assert.deepStrictEqual(decision, { shouldContinue: false });
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
      db.prepare("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), task.id);

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
    if (dbPath) rmSync(dbPath, { force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
