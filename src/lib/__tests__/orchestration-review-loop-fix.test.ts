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

    await test("findCompanyCeo matches whitespace-token roles ('Weather CEO', 'Head Executive / CEO')", async () => {
      clearWakes();
      const { findCompanyCeo } = await import("@/lib/orchestration/engine/engine");
      const project = makeProject("ceo-token-match");

      // Regression: prior to this fix, findCompanyCeo required LOWER(TRIM(role))='ceo'
      // (exact match), which silently dropped every real CEO agent on WEA
      // ("Weather CEO"), and any company with a modifier token in the role.
      const weatherCeo = makeAgent(project.id, "weather-ceo", "Weather CEO");
      const worker = makeAgent(project.id, "worker-beside-ceo", "Backend Engineer");
      void worker;

      const resolved = findCompanyCeo(companyId, db);
      assert.ok(resolved, "findCompanyCeo must resolve for role='Weather CEO'");
      assert.equal(resolved.id, weatherCeo.id, "should find the CEO agent, not the worker");
      assert.equal(resolved.role, "Weather CEO");
    });

    await test("findCompanyCeo rejects role substrings that are not CEO tokens ('Receptor', 'CEO-Junior')", async () => {
      clearWakes();
      const { findCompanyCeo } = await import("@/lib/orchestration/engine/engine");
      const project = makeProject("ceo-false-positives");

      // "Receptor" contains "cep" but is NOT a CEO token. "CEO-Junior" is a
      // single hyphenated token, not 'CEO' alone. Both should fail to match.
      makeAgent(project.id, "receptor", "Receptor");
      makeAgent(project.id, "ceo-junior", "CEO-Junior");

      const resolved = findCompanyCeo(companyId, db);
      assert.equal(resolved, null, "no real CEO present → must return null");
    });

    await test("CEO self-loop guard: reconcile does NOT re-wake CEO if the task's latest run was by the CEO", () => {
      clearWakes();
      const project = makeProject("ceo-self-loop-reconcile");
      const worker = makeAgent(project.id, "ceo-loop-worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "ceo-loop-ceo", "CEO");

      // Simulate the sequence that triggered the 18-wake loop on WEA-211:
      // 1. Worker assigned, worked, task moved to review (reconcile fires
      //    first CEO wake — not modeled here, already covered above).
      // 2. CEO ran on the review task and emitted narrative only.
      // 3. Engine calls reconcileTerminalOpenClawTaskState on the same task.
      // Fresh-but-CEO-already-reviewed: CEO ran most recently, task still
      // in review, assignee still the worker.
      const task = makeTask(project.id, worker.id, "review");
      seedCompletedOpenclawRun(task.id, ceo.id, "completed");

      reconcileTerminalOpenClawTaskState(task.id, db);

      const ceoWakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE agent_id = ? AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(ceo.id, task.id) as { n: number } | undefined;
      assert.equal(
        ceoWakes?.n ?? 0,
        0,
        "CEO must NOT be re-woken — their own run was the most recent terminal run on this task",
      );
    });

    await test("CEO self-loop guard: sweep skips review task with 'ceo_recent_review_no_close' when CEO just ran on it", () => {
      clearWakes();
      const project = makeProject("ceo-self-loop-sweep");
      const worker = makeAgent(project.id, "sweep-loop-worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "sweep-loop-ceo", "CEO");
      const task = makeTask(project.id, worker.id, "review");
      seedCompletedOpenclawRun(task.id, ceo.id, "completed");

      const result = sweepOpenTasks(db, { cap: 10 });

      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(task.id) as { n: number } | undefined;
      assert.equal(wakes?.n ?? 0, 0, "sweep must NOT re-fire CEO wake");
      assert.ok(
        (result.skippedReasons.ceo_recent_review_no_close ?? 0) >= 1,
        `expected 'ceo_recent_review_no_close' skip reason; got: ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("CEO self-loop guard: reconcile DOES wake CEO if the latest run was by the assignee (first-review path unchanged)", () => {
      clearWakes();
      const project = makeProject("ceo-self-loop-first-review");
      const worker = makeAgent(project.id, "first-review-worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "first-review-ceo", "CEO");

      // Assignee just finished — task now in review. Latest run agent is
      // the worker, not the CEO. CEO has never reviewed this task.
      const task = makeTask(project.id, worker.id, "in-progress");
      seedCompletedOpenclawRun(task.id, worker.id, "completed");

      reconcileTerminalOpenClawTaskState(task.id, db);

      const ceoWakes = db
        .prepare(
          `SELECT reason FROM agent_wakeup_requests
           WHERE agent_id = ? AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(ceo.id, task.id) as Array<{ reason: string }>;
      assert.equal(ceoWakes.length, 1, "first-review path must still wake CEO once");
      assert.equal(ceoWakes[0].reason, "ceo_review_requested");
    });

    await test("sweep routes unassigned on_deck task to CEO with reason 'sweep_unassigned_to_ceo'", () => {
      clearWakes();
      const project = makeProject("sweep-unassigned-happy");
      const ceo = makeAgent(project.id, "triage-ceo", "CEO");
      // Unassigned task — create via direct SQL since makeTask requires an
      // assignee. Matches the real-world pattern where operators or prior
      // runs leave a task in on_deck with no assignee_agent_id.
      const taskId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO tasks
           (id, project_id, title, description, priority, type, status,
            assignee_agent_id, created_by, execution_mode,
            task_number, task_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'high', 'feature', 'on_deck',
                 NULL, 'operator:test', 'openclaw',
                 9999, 'UNASSIGNED-9999', ?, ?)`,
      ).run(taskId, project.id, "Unassigned P1 task awaiting triage", "Needs CEO to route", now, now);

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1, `expected 1 wake; got ${JSON.stringify(result)}`);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason, idempotency_key FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(taskId) as Array<{ agent_id: string; reason: string; idempotency_key: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, ceo.id, "sweep must target CEO for unassigned task");
      assert.equal(wakes[0].reason, "sweep_unassigned_to_ceo");
      assert.equal(wakes[0].idempotency_key, `ceo_triage:${taskId}`);
    });

    await test("sweep skips unassigned task with 'no_ceo_for_unassigned' when no CEO exists", () => {
      clearWakes();
      const project = makeProject("sweep-unassigned-no-ceo");
      // Seed a worker so the company has agents, but no CEO.
      makeAgent(project.id, "worker-only", "Backend Engineer");

      const taskId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO tasks
           (id, project_id, title, description, priority, type, status,
            assignee_agent_id, created_by, execution_mode,
            task_number, task_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'high', 'feature', 'on_deck',
                 NULL, 'operator:test', 'openclaw',
                 9998, 'UNASSIGNED-9998', ?, ?)`,
      ).run(taskId, project.id, "Unassigned with no CEO", "Stuck until CEO hired", now, now);

      const result = sweepOpenTasks(db, { cap: 10 });
      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(taskId) as { n: number } | undefined;
      assert.equal(wakes?.n ?? 0, 0, "no wake when no CEO exists");
      assert.ok(
        (result.skippedReasons.no_ceo_for_unassigned ?? 0) >= 1,
        `expected 'no_ceo_for_unassigned' skip; got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep skips unassigned task with 'ceo_recent_triage_no_assign' when CEO already ran on it", () => {
      clearWakes();
      const project = makeProject("sweep-unassigned-ceo-ran");
      const ceo = makeAgent(project.id, "triage-ceo-ran", "CEO");

      const taskId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO tasks
           (id, project_id, title, description, priority, type, status,
            assignee_agent_id, created_by, execution_mode,
            task_number, task_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'high', 'feature', 'on_deck',
                 NULL, 'operator:test', 'openclaw',
                 9997, 'UNASSIGNED-9997', ?, ?)`,
      ).run(taskId, project.id, "Already-triaged unassigned", "CEO ran but didn't assign", now, now);

      // Seed a completed execution_run by the CEO on this task — simulates
      // "CEO has triaged once already, produced no assignment, guard kicks in."
      seedCompletedOpenclawRun(taskId, ceo.id, "completed");

      const result = sweepOpenTasks(db, { cap: 10 });
      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(taskId) as { n: number } | undefined;
      assert.equal(wakes?.n ?? 0, 0, "no wake — CEO already triaged and produced no assignment");
      assert.ok(
        (result.skippedReasons.ceo_recent_triage_no_assign ?? 0) >= 1,
        `expected 'ceo_recent_triage_no_assign' skip; got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep ignores unassigned tasks in non-on_deck statuses (backlog / review / in_progress)", () => {
      clearWakes();
      const project = makeProject("sweep-unassigned-wrong-status");
      makeAgent(project.id, "wrong-status-ceo", "CEO");

      const now = new Date().toISOString();
      // Unassigned + backlog — should NOT be considered
      const backlogId = randomUUID();
      db.prepare(
        `INSERT INTO tasks (id, project_id, title, description, priority, type, status, assignee_agent_id, created_by, execution_mode, task_number, task_key, created_at, updated_at)
         VALUES (?, ?, 'Backlog unassigned', '-', 'medium', 'feature', 'backlog', NULL, 'test', 'openclaw', 9990, 'UNASSIGNED-9990', ?, ?)`,
      ).run(backlogId, project.id, now, now);
      // Unassigned + review — should NOT be considered (data anomaly)
      const reviewId = randomUUID();
      db.prepare(
        `INSERT INTO tasks (id, project_id, title, description, priority, type, status, assignee_agent_id, created_by, execution_mode, task_number, task_key, created_at, updated_at)
         VALUES (?, ?, 'Review unassigned', '-', 'medium', 'feature', 'review', NULL, 'test', 'openclaw', 9991, 'UNASSIGNED-9991', ?, ?)`,
      ).run(reviewId, project.id, now, now);

      sweepOpenTasks(db, { cap: 10 });

      const wakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') IN (?, ?)`,
        )
        .get(backlogId, reviewId) as { n: number } | undefined;
      assert.equal(wakes?.n ?? 0, 0, "unassigned tasks outside on_deck must not be swept");
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
