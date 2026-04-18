/**
 * Contract tests for the review-pinning loop fix (2026-04-18).
 *
 * Production pre-pause observed 86 `reconcile_continue_review` wakes in 8h,
 * 61 review→in_progress + 60 in_progress→review churn events, only 3 real
 * closures. The assignee was being re-woken to "self-review" their own work,
 * which can never pass because they lack the authority to close the review.
 * Engine.ts also force-moved review→in_progress on every finished run, which
 * completed the loop.
 *
 * The fix:
 *   1. reconcileTerminalOpenClawTaskState routes the post-review wake to the
 *      CEO (reason: `ceo_review_requested`), not the assignee.
 *   2. Engine's finishRun no longer force-moves review→in_progress.
 *   3. decideTaskContinuation returns `shouldContinue: false` on review.
 *   4. Sweeper routes review-status sweeps to CEO, skips if no CEO.
 *   5. DB migration v45 allows review→on_deck so CEO can reject a review
 *      back to to-do with a comment.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-review-loop-fix.db
 * npx tsx src/lib/__tests__/orchestration-review-loop-fix.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

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

console.log("\nOrchestration Review-Pinning Loop Fix Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { reconcileTerminalOpenClawTaskState } = await import("@/lib/orchestration/openclaw-reconciliation");
    const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");
    const { decideFinishRunContinuation } = await import("@/lib/orchestration/engine/engine");

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();

    function makeProject(tag: string) {
      return createProject({
        companyId,
        name: `Review-Loop-Fix ${tag} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Review-loop fixture",
        color: "#8b5cf6",
        emoji: "🔁",
        status: "active",
      }).project;
    }

    function makeAgent(projectId: string, tag: string, role = "Backend Engineer") {
      return createProjectAgent({
        projectId,
        name: `Review-Loop Agent ${tag}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role,
        personality: "Deterministic",
        openclawAgentId: `review-loop-${tag}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
    }

    function makeTask(projectId: string, assigneeId: string, status: string) {
      return createTask({
        projectId,
        title: `Review-loop task ${status} ${Math.random().toString(36).slice(2, 6)}`,
        description: "Review-loop fixture task",
        priority: "P2",
        type: "feature",
        status,
        assignee: assigneeId,
        labels: [],
        createdBy: "review-loop-test",
      }).task;
    }

    function seedCompletedOpenclawRun(
      taskId: string,
      agentId: string,
      executionStatus: "completed" | "failed" | "cancelled" = "completed",
    ) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
          (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', ?, ?, ?, ?)`,
      ).run(randomUUID(), taskId, agentId, executionStatus, now, now, now);
    }

    function clearWakes() {
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();
      db.prepare("DELETE FROM execution_runs").run();
      // Archive tasks AND agents from prior tests. findCompanyCeo() scopes by
      // company_id only (not project), so CEO agents from earlier tests in
      // the same company would otherwise "leak" into this test's lookup and
      // steal the wake we expect the fresh CEO to receive.
      const stamp = new Date().toISOString();
      db.prepare("UPDATE tasks  SET archived_at = ? WHERE archived_at IS NULL").run(stamp);
      db.prepare("UPDATE agents SET archived_at = ? WHERE archived_at IS NULL").run(stamp);
    }

    await test("decideFinishRunContinuation returns shouldContinue=false on review-state tasks", () => {
      clearWakes();
      const project = makeProject("decide-continuation-review");
      const agent = makeAgent(project.id, "worker");
      const task = makeTask(project.id, agent.id, "review");

      const now = new Date().toISOString();
      const runId = randomUUID();
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, status, context_snapshot_json, result_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'succeeded', ?, ?, ?, ?)`,
      ).run(
        runId,
        agent.id,
        project.companyId,
        JSON.stringify({ taskId: task.id }),
        JSON.stringify({
          messagesImported: 1,
          actionsFound: 5,
          actionsExecuted: 5,
          actionsSkippedDedup: 0,
          tasksCreated: [],
          approvalsCreated: [],
          reportsImported: 0,
          errors: [],
        }),
        now,
        now,
      );

      const decision = decideFinishRunContinuation(task.id, runId, "succeeded", db);
      assert.deepStrictEqual(
        decision,
        { shouldContinue: false },
        `review task must NOT self-continue; got: ${JSON.stringify(decision)}`,
      );
    });

    await test("reconcileTerminalOpenClawTaskState moves in_progress → review AND wakes CEO (not assignee)", () => {
      clearWakes();
      const project = makeProject("reconcile-wakes-ceo");
      const worker = makeAgent(project.id, "worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "ceo", "CEO");
      const task = makeTask(project.id, worker.id, "in-progress");
      seedCompletedOpenclawRun(task.id, worker.id, "completed");

      const result = reconcileTerminalOpenClawTaskState(task.id, db);
      assert.equal(result.movedToReview, true, "task should move in_progress → review");

      const postStatus = (db
        .prepare("SELECT status FROM tasks WHERE id = ? LIMIT 1")
        .get(task.id) as { status: string } | undefined)?.status;
      assert.equal(postStatus, "review", "task must be in review after reconcile");

      const assigneeWakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE agent_id = ? AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(worker.id, task.id) as { n: number } | undefined;
      assert.equal(
        assigneeWakes?.n ?? 0,
        0,
        "assignee must NOT be woken to self-review their own work",
      );

      const ceoWakes = db
        .prepare(
          `SELECT reason, idempotency_key FROM agent_wakeup_requests
           WHERE agent_id = ? AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(ceo.id, task.id) as Array<{ reason: string; idempotency_key: string }>;
      assert.equal(ceoWakes.length, 1, `expected 1 CEO wake, got ${ceoWakes.length}`);
      assert.equal(ceoWakes[0].reason, "ceo_review_requested");
      assert.equal(ceoWakes[0].idempotency_key, `ceo_review:${task.id}`);
    });

    await test("reconcile does NOT wake CEO when assignee IS the CEO (no self-review path)", () => {
      clearWakes();
      const project = makeProject("assignee-is-ceo");
      const ceo = makeAgent(project.id, "solo-ceo", "CEO");
      const task = makeTask(project.id, ceo.id, "in-progress");
      seedCompletedOpenclawRun(task.id, ceo.id, "completed");

      reconcileTerminalOpenClawTaskState(task.id, db);

      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(task.id) as { n: number } | undefined;
      assert.equal(wakes?.n ?? 0, 0, "no wake should fire — CEO cannot self-review");
    });

    await test("reconcile does NOT wake anyone when no CEO exists for the company", () => {
      clearWakes();
      const project = makeProject("no-ceo");
      const worker = makeAgent(project.id, "worker-no-ceo", "Backend Engineer");
      const task = makeTask(project.id, worker.id, "in-progress");
      seedCompletedOpenclawRun(task.id, worker.id, "completed");

      reconcileTerminalOpenClawTaskState(task.id, db);

      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(task.id) as { n: number } | undefined;
      assert.equal(
        wakes?.n ?? 0,
        0,
        "no wake — assignee cannot self-review and no CEO exists to review on their behalf",
      );
    });

    await test("sweep routes review-state tasks to CEO with reason 'sweep_review_to_ceo'", () => {
      clearWakes();
      const project = makeProject("sweep-review-to-ceo");
      const worker = makeAgent(project.id, "sweep-worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "sweep-ceo", "CEO");
      const task = makeTask(project.id, worker.id, "review");

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1, `expected 1 wake, got: ${JSON.stringify(result)}`);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason, idempotency_key FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string; idempotency_key: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, ceo.id, "sweep must target CEO for review task");
      assert.equal(wakes[0].reason, "sweep_review_to_ceo");
      assert.equal(wakes[0].idempotency_key, `ceo_review:${task.id}`);

      const assigneeWakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE agent_id = ? AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(worker.id, task.id) as { n: number } | undefined;
      assert.equal(assigneeWakes?.n ?? 0, 0, "sweep must NOT re-wake the assignee on review");
    });

    await test("sweep skips review tasks with 'no_ceo_for_review' when no CEO exists", () => {
      clearWakes();
      const project = makeProject("sweep-no-ceo");
      const worker = makeAgent(project.id, "sweep-worker-no-ceo", "Backend Engineer");
      const task = makeTask(project.id, worker.id, "review");

      const result = sweepOpenTasks(db, { cap: 10 });

      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(task.id) as { n: number } | undefined;
      assert.equal(wakes?.n ?? 0, 0, "no wake when no CEO");
      assert.ok(
        (result.skippedReasons.no_ceo_for_review ?? 0) >= 1,
        `expected 'no_ceo_for_review' in skippedReasons; got: ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep skips review tasks with 'assignee_is_ceo_for_review' when CEO is assignee", () => {
      clearWakes();
      const project = makeProject("sweep-ceo-is-assignee");
      const ceo = makeAgent(project.id, "sweep-sole-ceo", "CEO");
      const task = makeTask(project.id, ceo.id, "review");

      const result = sweepOpenTasks(db, { cap: 10 });

      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(task.id) as { n: number } | undefined;
      assert.equal(wakes?.n ?? 0, 0, "no wake when assignee is CEO");
      assert.ok(
        (result.skippedReasons.assignee_is_ceo_for_review ?? 0) >= 1,
        `expected 'assignee_is_ceo_for_review' in skippedReasons; got: ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep still wakes assignee for on_deck / in_progress tasks (baseline preserved)", () => {
      clearWakes();
      const project = makeProject("sweep-baseline-in-progress");
      const worker = makeAgent(project.id, "baseline-worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "baseline-ceo", "CEO");
      void ceo;
      const task = makeTask(project.id, worker.id, "in-progress");

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, worker.id, "in_progress sweep targets assignee, not CEO");
      assert.equal(wakes[0].reason, "sweep_open_task");
    });

    await test("review → on_deck transition is allowed (migration v45)", () => {
      const row = db
        .prepare(
          `SELECT 1 AS present FROM status_transition_rules
           WHERE from_status = 'review' AND to_status = 'on_deck' LIMIT 1`,
        )
        .get() as { present: number } | undefined;
      assert.equal(row?.present, 1, "review → on_deck transition must be present after v45");
    });

    await test("reconcile does NOT force-move review back to in_progress (previously line 2969 enforcement)", () => {
      clearWakes();
      const project = makeProject("reconcile-no-force-back");
      const worker = makeAgent(project.id, "stable-review-worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "stable-review-ceo", "CEO");
      void ceo;
      const task = makeTask(project.id, worker.id, "in-progress");
      seedCompletedOpenclawRun(task.id, worker.id, "completed");

      reconcileTerminalOpenClawTaskState(task.id, db);

      const status = (db
        .prepare("SELECT status FROM tasks WHERE id = ? LIMIT 1")
        .get(task.id) as { status: string } | undefined)?.status;
      assert.equal(
        status,
        "review",
        "task must remain in review after reconcile — the old force-back-to-in_progress path is removed",
      );
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
