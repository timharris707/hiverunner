/**
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-execution-run-cancellation.db
 * npx tsx src/lib/__tests__/orchestration-execution-run-cancellation.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  createProject,
  createProjectAgent,
  createTask,
  moveTask,
} from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/service/shared";
import type { TaskStatus } from "@/lib/orchestration/types";

let passed = 0;
let failed = 0;

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed, "object");
  assert.ok(parsed);
  assert.equal(Array.isArray(parsed), false);
  return parsed as Record<string, unknown>;
}

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  FAIL ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

function createRunningTaskFixture() {
  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Execution Cancel Project ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: "Execution cancellation fixture",
    color: "#0ea5e9",
    emoji: "EC",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Execution Cancel Agent ${Math.random().toString(36).slice(2, 6)}`,
    emoji: "T",
    role: "Test Runner",
    personality: "Careful",
    status: "idle",
    skills: [],
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: `Execution cancellation task ${Math.random().toString(36).slice(2, 6)}`,
    description: "Task with a running execution row.",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test-suite",
  }).task;
  const db = getOrchestrationDb();
  const runId = randomUUID();
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, execution_engine, status, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'hiverunner', 'running', ?, ?, ?)`
  ).run(runId, task.id, agent.id, startedAt, startedAt, startedAt);
  return { task, runId };
}

console.log("\nExecution Run Cancellation Tests\n");

async function run() {
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  for (const status of ["done", "blocked", "backlog", "to-do"] as TaskStatus[]) {
    await test(`moving task to ${status} cancels one running execution run and terminates once`, () => {
      const { task, runId } = createRunningTaskFixture();
      const terminated: string[] = [];
      moveTask({
        taskId: task.id,
        status,
        actorUserId: "test-suite",
        terminateExecutionRun: (run) => {
          terminated.push(run.id);
        },
      });

      const row = getOrchestrationDb()
        .prepare(
          `SELECT status, error_message, completed_at, process_pid, terminalized_by,
                  retry_allowed, retry_decision_reason, cancellation_actor,
                  cancellation_reason, cancellation_result_json, idempotency_key
           FROM execution_runs
           WHERE id = ?`
        )
        .get(runId) as {
          status: string;
          error_message: string;
          completed_at: string | null;
          process_pid: number | null;
          terminalized_by: string | null;
          retry_allowed: number | null;
          retry_decision_reason: string | null;
          cancellation_actor: string | null;
          cancellation_reason: string | null;
          cancellation_result_json: string | null;
          idempotency_key: string | null;
        };
      assert.equal(row.status, "cancelled");
      assert.match(row.error_message, new RegExp(`task transitioned to ${status}`));
      assert.ok(row.completed_at);
      assert.equal(row.process_pid, null);
      assert.equal(row.terminalized_by, "task_status_transition");
      assert.equal(row.retry_allowed, 0);
      assert.equal(row.retry_decision_reason, "task_status_transition");
      assert.equal(row.cancellation_actor, "task_status_transition");
      assert.match(row.cancellation_reason ?? "", new RegExp(`task transitioned to ${status}`));
      assert.equal(row.idempotency_key, null);
      const cancellationResult = parseJsonRecord(row.cancellation_result_json);
      assert.equal(cancellationResult.method, "task_status_transition");
      assert.equal(cancellationResult.signalStatus, "completed");

      const eventRows = getOrchestrationDb()
        .prepare("SELECT event_type FROM execution_run_attempt_events WHERE execution_run_id = ? ORDER BY created_at ASC")
        .all(runId) as Array<{ event_type: string }>;
      assert.deepEqual(eventRows.map((event) => event.event_type), ["cancelled", "cancel_signal_completed"]);
      assert.deepEqual(terminated, [runId]);
    });
  }

  await test("task-status cancellation records failed terminate signal evidence", () => {
    const { task, runId } = createRunningTaskFixture();
    moveTask({
      taskId: task.id,
      status: "done",
      actorUserId: "test-suite",
      terminateExecutionRun: () => {
        throw new Error("process group refused SIGTERM");
      },
    });

    const row = getOrchestrationDb()
      .prepare(
        `SELECT status, cancellation_result_json
         FROM execution_runs
         WHERE id = ?`
      )
      .get(runId) as { status: string; cancellation_result_json: string | null };
    assert.equal(row.status, "cancelled");
    const cancellationResult = parseJsonRecord(row.cancellation_result_json);
    assert.equal(cancellationResult.signalStatus, "failed");
    assert.match(String(cancellationResult.error), /process group refused SIGTERM/);

    const eventRows = getOrchestrationDb()
      .prepare("SELECT event_type FROM execution_run_attempt_events WHERE execution_run_id = ? ORDER BY created_at ASC")
      .all(runId) as Array<{ event_type: string }>;
    assert.deepEqual(eventRows.map((event) => event.event_type), ["cancelled", "cancel_signal_failed"]);
  });

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }

  console.log(`\n${passed} passed`);
}

void run();
