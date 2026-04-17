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

  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
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
  return { db, project, agent, task };
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

    await test("Failed passive-report runs do not auto-continue on on_deck tasks", async () => {
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, project, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'on_deck', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-passive-failed",
        agentId: agent.id,
        companyId: project.companyId,
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

    await test("Successful on_deck runs only continue when they executed real actions", async () => {
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, project, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'on_deck', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-on-deck-actions",
        agentId: agent.id,
        companyId: project.companyId,
        taskId: task.id,
        resultJson: {
          messagesImported: 1,
          actionsFound: 1,
          actionsExecuted: 1,
          actionsSkippedDedup: 0,
          tasksCreated: [],
          approvalsCreated: [],
          reportsImported: 0,
          errors: [],
        },
      });

      const decision = decideFinishRunContinuation(task.id, "run-on-deck-actions", "succeeded", db);
      assert.strictEqual(decision.shouldContinue, true);
      assert.strictEqual(decision.reason, "continuation_on_deck_after_actions");
    });

    await test("Successful in_progress report-only runs do not continue", async () => {
      const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");
      const { db, project, agent, task } = await createFixture();

      db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(new Date().toISOString(), task.id);
      seedHeartbeatRun(db, {
        runId: "run-in-progress-report-only",
        agentId: agent.id,
        companyId: project.companyId,
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
