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
 *   5. DB migration v45 allows review→to-do so CEO can reject a review
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
    const { createTaskComment } = await import("@/lib/orchestration/service/comment");
    const { reconcileTerminalOpenClawTaskState } = await import("@/lib/orchestration/openclaw-reconciliation");
    const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");
    const {
      buildHeartbeatPrompt,
      decideFinishRunContinuation,
      enqueueWakeup,
      executeAddComment,
      executeHeartbeatRun,
      executeUpdateTask,
      getOrCreateTaskSession,
    } = await import("@/lib/orchestration/engine/engine");

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

    function makeTask(projectId: string, assigneeId: string, status: Parameters<typeof createTask>[0]["status"]) {
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

    await test("CEO unassigned-task sweep uses a compact triage prompt", () => {
      clearWakes();
      const project = makeProject("compact-unassigned-triage");
      const oracle = makeAgent(project.id, "compact-oracle", "Lead / Product Orchestrator");
      makeAgent(project.id, "compact-engineer", "Senior Front End Engineer");
      makeAgent(project.id, "compact-qa", "QA / Verification Lead");
      const task = createTask({
        projectId: project.id,
        title: "Add orchestration mode indicator to task cards",
        description: "Add a small visual indicator to task cards showing whether the task uses HiveRunner Native or Symphony.",
        priority: "P2",
        type: "feature",
        status: "to-do",
        labels: ["orchestration"],
        createdBy: "review-loop-test",
      }).task;
      const agentRow = db
        .prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities,
                  NULL AS runtime_workspace_root
             FROM agents
            WHERE id = ?
            LIMIT 1`,
        )
        .get(oracle.id) as Parameters<typeof buildHeartbeatPrompt>[0];
      const session = getOrCreateTaskSession({
        agentId: oracle.id,
        companyId,
        adapterType: "codex",
        taskKey: task.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        agentRow,
        {
          wakeSource: "api",
          wakeReason: "sweep_unassigned_to_ceo",
          taskId: task.id,
          taskStatus: "to-do",
        },
        session,
        db,
      );

      assert.match(prompt, /# Fast Triage Wake/);
      assert.match(prompt, /Your only job is to route this unassigned task/);
      assert.match(prompt, /"action":"update_task"/);
      assert.doesNotMatch(prompt, /Latest Review Candidate/);
      assert.doesNotMatch(prompt, /Pending Approvals/);
      assert.ok(prompt.length < 7000, `expected compact prompt, got ${prompt.length} chars`);
    });

    await test("CEO review prompt includes the full latest worker deliverable", () => {
      clearWakes();
      const project = makeProject("review-candidate-context");
      const worker = makeAgent(project.id, "worker");
      const ceo = makeAgent(project.id, "ceo", "CEO");
      const task = makeTask(project.id, worker.id, "review");
      const longDeliverable = [
        "## Final operator-facing answer",
        "",
        "This is the opening paragraph that would fit in the old compact comment window.",
        "",
        "A".repeat(700),
        "",
        "ITEM TWO: this content must remain visible to the reviewer.",
        "",
        "B".repeat(700),
        "",
        "ITEM FIVE: this tail proves the full deliverable was not clipped to the first 500 characters.",
      ].join("\n");

      createTaskComment({
        taskId: task.id,
        authorAgentId: worker.id,
        body: longDeliverable,
        type: "comment",
        source: "anthropic" as never,
      });

      const ceoRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(ceo.id) as never;
      const prompt = buildHeartbeatPrompt(
        ceoRow,
        {
          taskId: task.id,
          wakeSource: "api",
          wakeReason: "ceo_review_requested",
        },
        {
          id: randomUUID(),
          agentId: ceo.id,
          companyId,
          adapterType: "codex",
          taskKey: task.id,
          sessionParams: {},
          sessionDisplayId: null,
          lastRunId: null,
          lastError: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        db,
      );

      assert.match(prompt, /## Latest Review Candidate \(full\)/);
      assert.match(prompt, /ITEM TWO: this content must remain visible/);
      assert.match(prompt, /ITEM FIVE: this tail proves/);
      assert.match(prompt, /Do not reject only because the compact Recent Task Discussion below is truncated/);
    });

    await test("declared QA review prompt uses the producer deliverable and tells reviewer to close approved work", () => {
      clearWakes();
      const project = makeProject("qa-review-candidate-context");
      const worker = makeAgent(project.id, "qa-context-worker", "Builder");
      const reviewer = makeAgent(project.id, "qa-context-reviewer", "QA");
      const task = makeTask(project.id, reviewer.id, "review");
      const now = new Date().toISOString();
      const deliverable = [
        "## Producer deliverable",
        "",
        "The implementation is complete and ready for QA.",
        "",
        "QA MUST SEE THIS PRODUCER DETAIL.",
      ].join("\n");

      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
      ).run(
        randomUUID(),
        project.id,
        task.id,
        worker.id,
        JSON.stringify({ source: "test_producer_review_submit" }),
        now,
      );
      createTaskComment({
        taskId: task.id,
        authorAgentId: worker.id,
        body: deliverable,
        type: "comment",
        source: "codex" as never,
      });

      const reviewerRow = db.prepare("SELECT * FROM agents WHERE id = ?").get(reviewer.id) as never;
      const prompt = buildHeartbeatPrompt(
        reviewerRow,
        {
          taskId: task.id,
          wakeSource: "api",
          wakeReason: "sweep_review_to_assignee",
        },
        {
          id: randomUUID(),
          agentId: reviewer.id,
          companyId,
          adapterType: "codex",
          taskKey: task.id,
          sessionParams: {},
          sessionDisplayId: null,
          lastRunId: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        },
        db,
      );

      assert.match(prompt, /QA MUST SEE THIS PRODUCER DETAIL/);
      assert.match(prompt, /if the work passes review, emit an `add_comment`/);
      assert.match(prompt, /`update_task` this task to `done`/);
      assert.doesNotMatch(prompt, /From: qa-context-reviewer/);
    });

    await test("QA rejection with reassignment wakes the producer, not the reviewer", () => {
      clearWakes();
      const project = makeProject("qa-reject-reassign-wake");
      const producer = makeAgent(project.id, "qa-reject-producer", "Builder");
      const reviewer = makeAgent(project.id, "qa-reject-reviewer", "QA");
      const task = makeTask(project.id, reviewer.id, "review");
      const runId = randomUUID();

      const result = executeUpdateTask(
        {
          action: "update_task",
          taskKey: task.key ?? "",
          status: "in-progress",
          assignee: producer.name,
        },
        {
          agentId: reviewer.id,
          companyId,
          runId,
        },
        db,
      );

      assert.equal(result.statusApplied, true);
      assert.equal(result.assigneeApplied, true);

      const wakes = db.prepare(
        `SELECT agent_id, reason
         FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?
         ORDER BY created_at ASC`,
      ).all(task.id) as Array<{ agent_id: string; reason: string | null }>;

      assert.equal(wakes.length, 1);
      assert.equal(wakes[0]?.agent_id, producer.id);
      assert.equal(wakes[0]?.reason, "review_rework_requested");
    });

    await test("update_task moving an unassigned task to in_progress assigns the acting agent", () => {
      clearWakes();
      const project = makeProject("in-progress-owner-invariant");
      const oracle = makeAgent(project.id, "in-progress-oracle", "Lead / Product Orchestrator");
      const task = createTask({
        projectId: project.id,
        title: "Route unassigned task without losing owner",
        description: "Fixture for in_progress ownership invariant",
        priority: "P2",
        type: "feature",
        status: "to-do",
        labels: [],
        createdBy: "review-loop-test",
      }).task;

      const result = executeUpdateTask(
        {
          action: "update_task",
          taskKey: task.key ?? "",
          status: "in-progress",
        },
        {
          agentId: oracle.id,
          companyId,
          runId: randomUUID(),
        },
        db,
      );

      assert.equal(result.statusApplied, true);
      assert.equal(result.assigneeApplied, true);
      const post = db
        .prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ? LIMIT 1")
        .get(task.id) as { status: string; assignee_agent_id: string | null } | undefined;
      assert.equal(post?.status, "in_progress");
      assert.equal(post?.assignee_agent_id, oracle.id);

      const event = db
        .prepare(
          `SELECT metadata_json
             FROM task_events
            WHERE task_id = ? AND event_type = 'task.assigned'
            ORDER BY created_at DESC
            LIMIT 1`,
        )
        .get(task.id) as { metadata_json: string } | undefined;
      assert.equal(JSON.parse(event?.metadata_json ?? "{}").source, "engine_action_in_progress_owner");
    });

    await test("task-specific wakes for the same agent queue separately instead of superseding", () => {
      clearWakes();
      const project = makeProject("task-wake-queue");
      const oracle = makeAgent(project.id, "wake-queue-oracle", "Lead / Product Orchestrator");
      const first = createTask({
        projectId: project.id,
        title: "First triage task",
        description: "Fixture",
        priority: "P2",
        type: "feature",
        status: "to-do",
        labels: [],
        createdBy: "review-loop-test",
      }).task;
      const second = createTask({
        projectId: project.id,
        title: "Second triage task",
        description: "Fixture",
        priority: "P2",
        type: "feature",
        status: "to-do",
        labels: [],
        createdBy: "review-loop-test",
      }).task;

      enqueueWakeup({
        agentId: oracle.id,
        companyId,
        source: "api",
        reason: "sweep_unassigned_to_ceo",
        payload: { taskId: first.id, taskStatus: "to-do" },
        idempotencyKey: `ceo_triage:${first.id}`,
      }, db);
      enqueueWakeup({
        agentId: oracle.id,
        companyId,
        source: "api",
        reason: "sweep_unassigned_to_ceo",
        payload: { taskId: second.id, taskStatus: "to-do" },
        idempotencyKey: `ceo_triage:${second.id}`,
      }, db);

      const wakes = db
        .prepare(
          `SELECT status, json_extract(payload_json, '$.taskId') AS task_id
             FROM agent_wakeup_requests
            WHERE agent_id = ?
            ORDER BY created_at ASC`,
        )
        .all(oracle.id) as Array<{ status: string; task_id: string | null }>;
      assert.deepEqual(wakes.map((wake) => wake.status), ["queued", "queued"]);
      assert.deepEqual(wakes.map((wake) => wake.task_id), [first.id, second.id]);
    });

    await test("stale task-status wakes cancel before moving completed work backward", async () => {
      clearWakes();
      const project = makeProject("stale-status-wake");
      const worker = makeAgent(project.id, "stale-worker", "Builder");
      const task = makeTask(project.id, worker.id, "done");
      const wake = enqueueWakeup(
        {
          agentId: worker.id,
          companyId,
          source: "api",
          reason: "agent_comment_on_assigned_task",
          payload: {
            taskId: task.id,
            taskStatus: "in_progress",
          },
        },
        db,
      );

      const result = await executeHeartbeatRun(wake.heartbeatRunId, db);

      assert.equal(result.status, "cancelled");
      assert.match(result.error ?? "", /Skipped stale wake/);
      const after = db.prepare("SELECT status FROM tasks WHERE id = ?").get(task.id) as { status: string };
      assert.equal(after.status, "done");
    });

    await test("open-task wakes cancel when they target a non-assignee", async () => {
      clearWakes();
      const project = makeProject("wrong-assignee-wake");
      const worker = makeAgent(project.id, "actual-worker", "Builder");
      const staleAgent = makeAgent(project.id, "stale-worker", "QA");
      const task = makeTask(project.id, worker.id, "in-progress");
      const wake = enqueueWakeup(
        {
          agentId: staleAgent.id,
          companyId,
          source: "api",
          reason: "review_rework_requested",
          payload: {
            taskId: task.id,
            taskStatus: "in_progress",
          },
        },
        db,
      );

      const result = await executeHeartbeatRun(wake.heartbeatRunId, db);

      assert.equal(result.status, "cancelled");
      assert.match(result.error ?? "", /assigned to another agent/);
      const after = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
        status: string;
        assignee_agent_id: string;
      };
      assert.equal(after.status, "in_progress");
      assert.equal(after.assignee_agent_id, worker.id);
    });

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
      assert.equal(wakes[0].idempotency_key, `ceo_review:${task.id}:${ceo.id}`);

      const assigneeWakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE agent_id = ? AND json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(worker.id, task.id) as { n: number } | undefined;
      assert.equal(assigneeWakes?.n ?? 0, 0, "sweep must NOT re-wake the assignee on review");
    });

    await test("CEO clarification comment reopens review task and wakes assigned worker", () => {
      clearWakes();
      const project = makeProject("clarification-handback");
      const worker = makeAgent(project.id, "clarify-worker", "Research Agent");
      const ceo = makeAgent(project.id, "clarify-ceo", "CEO");
      const task = makeTask(project.id, worker.id, "review");
      const taskKey = (db
        .prepare("SELECT task_key FROM tasks WHERE id = ? LIMIT 1")
        .get(task.id) as { task_key: string } | undefined)?.task_key;
      assert.ok(taskKey, "fixture task needs a task key");

      const runId = randomUUID();
      const added = executeAddComment(
        {
          action: "add_comment",
          taskKey,
          body: "[AWAITING_CLARIFICATION] Mira, please confirm the field list before I approve this handoff.",
        },
        { agentId: ceo.id, companyId: project.companyId ?? companyId, runId },
        db,
      );
      assert.equal(added, true, "clarification comment should be imported");

      const postTask = db
        .prepare("SELECT status FROM tasks WHERE id = ? LIMIT 1")
        .get(task.id) as { status: string } | undefined;
      assert.equal(postTask?.status, "in_progress", "clarification must hand review back to the worker");

      const wakes = db
        .prepare(
          `SELECT agent_id, reason, payload_json FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string; payload_json: string }>;
      assert.equal(wakes.length, 1, "clarification handback should queue one worker wake");
      assert.equal(wakes[0].agent_id, worker.id, "clarification must wake the assigned worker");
      assert.equal(wakes[0].reason, "clarification_requested");
      assert.equal(JSON.parse(wakes[0].payload_json).requestedByAgentId, ceo.id);
    });

    await test("CEO comment on an open assigned task wakes the assigned worker", () => {
      clearWakes();
      const project = makeProject("agent-comment-wake");
      const worker = makeAgent(project.id, "comment-worker", "Research Agent");
      const ceo = makeAgent(project.id, "comment-ceo", "CEO");
      const task = makeTask(project.id, worker.id, "to-do");
      const taskKey = (db
        .prepare("SELECT task_key FROM tasks WHERE id = ? LIMIT 1")
        .get(task.id) as { task_key: string } | undefined)?.task_key;
      assert.ok(taskKey, "fixture task needs a task key");

      const runId = randomUUID();
      const added = executeAddComment(
        {
          action: "add_comment",
          taskKey,
          body: "Please resubmit this with concrete sample card content so downstream work can start.",
        },
        { agentId: ceo.id, companyId: project.companyId ?? companyId, runId },
        db,
      );
      assert.equal(added, true);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason, payload_json FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string; payload_json: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, worker.id);
      assert.equal(wakes[0].reason, "agent_comment_on_assigned_task");
      assert.equal(JSON.parse(wakes[0].payload_json).commentAuthorAgentId, ceo.id);
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

    await test("sweep still wakes assignee for to-do / in_progress tasks (baseline preserved)", () => {
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

    await test("review → to-do transition is allowed (migration v45)", () => {
      const row = db
        .prepare(
          `SELECT 1 AS present FROM status_transition_rules
           WHERE from_status = 'review' AND to_status = 'to-do' LIMIT 1`,
        )
        .get() as { present: number } | undefined;
      assert.equal(row?.present, 1, "review → to-do transition must be present after v45");
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

    await test("findCompanyCeo falls back to explicit product orchestrator roles", async () => {
      clearWakes();
      const { findCompanyCeo } = await import("@/lib/orchestration/engine/engine");
      const project = makeProject("company-orchestrator-fallback");

      const orchestrator = makeAgent(project.id, "oracle", "Lead / Product Orchestrator");
      const qaLead = makeAgent(project.id, "qa-lead", "QA / Verification Lead");
      void qaLead;

      const resolved = findCompanyCeo(companyId, db);
      assert.ok(resolved, "findCompanyCeo must resolve an explicit Product Orchestrator fallback");
      assert.equal(resolved.id, orchestrator.id, "should find the orchestration lead, not a generic QA lead");
      assert.equal(resolved.role, "Lead / Product Orchestrator");
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
      // Worker produced first (realistic flow), then CEO reviewed and
      // emitted no status change. The worker-prior-run marks the assignee
      // as a prior producer so the 2026-04-24 declared-reviewer branch
      // doesn't misroute the wake back to the worker. Explicit timestamps
      // make the "CEO is latest producer" ordering deterministic — without
      // them two seed calls in the same ms tie-break non-deterministically.
      const now = Date.now();
      const tWorker = new Date(now - 2000).toISOString();
      const tCeo = new Date(now).toISOString();
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, worker.id, tWorker, tWorker, tWorker);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, ceo.id, tCeo, tCeo, tCeo);

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
      const blocked = db
        .prepare("SELECT status, blocked_reason FROM tasks WHERE id = ?")
        .get(task.id) as { status: string; blocked_reason: string | null } | undefined;
      assert.equal(blocked?.status, "blocked", "stale review must be surfaced as blocked for human decision");
      assert.match(blocked?.blocked_reason ?? "", /Review loop guard/);
    });

    await test("sweep routes review-state task to declared reviewer (assignee != producer, reviewer has no prior run)", () => {
      clearWakes();
      const project = makeProject("sweep-declared-reviewer");
      const producer = makeAgent(project.id, "declared-producer", "Backend Engineer");
      const reviewer = makeAgent(project.id, "declared-reviewer", "QA Engineer");
      const ceo = makeAgent(project.id, "declared-ceo", "CEO");
      void ceo;
      // Producer completed work, then handed task to QA reviewer via
      // update_task (status=review, assignee=reviewer). Reviewer has not
      // yet run on this task.
      const task = makeTask(project.id, reviewer.id, "review");
      seedCompletedOpenclawRun(task.id, producer.id, "completed");

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1, `expected 1 wake; got ${JSON.stringify(result)}`);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason, idempotency_key FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string; idempotency_key: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, reviewer.id, "sweep must target declared reviewer, not CEO");
      assert.equal(wakes[0].reason, "sweep_review_to_assignee");
      assert.equal(wakes[0].idempotency_key, `review_assignee:${task.id}:${reviewer.id}`);
    });

    await test("sweep routes revised review submissions back to the same QA reviewer", () => {
      clearWakes();
      const project = makeProject("sweep-reviewer-new-cycle");
      const producer = makeAgent(project.id, "cycle-producer", "Backend Engineer");
      const reviewer = makeAgent(project.id, "cycle-reviewer", "QA Engineer");
      const ceo = makeAgent(project.id, "cycle-ceo", "CEO");
      void ceo;
      const task = makeTask(project.id, reviewer.id, "review");
      const now = Date.now();
      const tInitialSubmit = new Date(now - 6000).toISOString();
      const tReviewerReject = new Date(now - 4000).toISOString();
      const tResubmit = new Date(now - 1000).toISOString();

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'symphony', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, producer.id, tInitialSubmit, tInitialSubmit, tInitialSubmit);
      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
      ).run(randomUUID(), project.id, task.id, producer.id, tInitialSubmit);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'symphony', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, reviewer.id, tReviewerReject, tReviewerReject, tReviewerReject);
      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'review', 'in_progress', '{}', ?)`,
      ).run(randomUUID(), project.id, task.id, reviewer.id, tReviewerReject);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'symphony', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, producer.id, tResubmit, tResubmit, tResubmit);
      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
      ).run(randomUUID(), project.id, task.id, producer.id, tResubmit);

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1, `expected QA review wake; got ${JSON.stringify(result)}`);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, reviewer.id, "revised submission should return to the declared QA reviewer");
      assert.equal(wakes[0].reason, "sweep_review_to_assignee");
    });

    await test("sweep falls back to CEO when declared reviewer has already run on the task (reviewer-didn't-close → escalate)", () => {
      clearWakes();
      const project = makeProject("sweep-reviewer-no-close-escalate");
      const producer = makeAgent(project.id, "escalate-producer", "Backend Engineer");
      const reviewer = makeAgent(project.id, "escalate-reviewer", "QA Engineer");
      const ceo = makeAgent(project.id, "escalate-ceo", "CEO");
      // Producer produced, handed to reviewer. Reviewer ran, emitted
      // narrative-only, task still in review with reviewer assignee.
      // Next sweep should escalate to CEO (reviewer had their chance).
      // Explicit timestamps to make "reviewer is latest" deterministic.
      const task = makeTask(project.id, reviewer.id, "review");
      const now = Date.now();
      const tProducer = new Date(now - 2000).toISOString();
      const tReviewer = new Date(now).toISOString();
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, producer.id, tProducer, tProducer, tProducer);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, reviewer.id, tReviewer, tReviewer, tReviewer);

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1, `expected CEO escalation wake; got ${JSON.stringify(result)}`);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, ceo.id, "must escalate to CEO once reviewer has run without closing");
      assert.equal(wakes[0].reason, "sweep_review_to_ceo");
    });

    await test("sweep escalates stale declared-reviewer review to Oracle before Ralph/CEO with watchdog reason", () => {
      clearWakes();
      const project = makeProject("sweep-reviewer-watchdog-assign-oracle");
      const producer = makeAgent(project.id, "watchdog-producer", "Backend Engineer");
      const reviewer = makeAgent(project.id, "watchdog-reviewer", "QA Engineer");
      const oracle = makeAgent(project.id, "watchdog-oracle", "Oracle");
      const ralph = makeAgent(project.id, "watchdog-ralph", "Ralph");
      const ceo = makeAgent(project.id, "watchdog-ceo", "CEO");
      void ralph;
      void ceo;

      // Producer submitted to review more than one review window ago with no
      // reviewer action. Watchdog should escalate to Oracle (first escalation
      // slot before Ralph) and wake the new assignee.
      const task = makeTask(project.id, reviewer.id, "review");
      const now = Date.now();
      const staleSubmission = new Date(now - 2 * 60 * 60 * 1000).toISOString();

      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
      ).run(randomUUID(), project.id, task.id, producer.id, staleSubmission);
      db.prepare("UPDATE tasks SET assigned_at = ?, updated_at = ? WHERE id = ?")
        .run(staleSubmission, staleSubmission, task.id);

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1, `expected Oracle escalation wake; got ${JSON.stringify(result)}`);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason, idempotency_key FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string; idempotency_key: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, oracle.id, "must escalate to Oracle once reviewer is stale");
      assert.equal(wakes[0].reason, "sweep_review_to_ceo");
      assert.equal(wakes[0].idempotency_key, `ceo_review:${task.id}:${oracle.id}`);

      const postTask = db
        .prepare("SELECT assignee_agent_id, blocked_reason FROM tasks WHERE id = ?")
        .get(task.id) as { assignee_agent_id: string; blocked_reason: string | null } | undefined;
      assert.equal(postTask?.assignee_agent_id, oracle.id, "assignee should be reassigned to escalation target");
      assert.match(postTask?.blocked_reason ?? "", /Review watchdog: no review progress/);
    });

    await test("sweep does not re-wake CEO after CEO already reviewed the current reviewer submission", () => {
      clearWakes();
      const project = makeProject("sweep-ceo-reviewed-current-submission");
      const producer = makeAgent(project.id, "ceo-current-producer", "Backend Engineer");
      const reviewer = makeAgent(project.id, "ceo-current-reviewer", "QA Engineer");
      const ceo = makeAgent(project.id, "ceo-current-ceo", "CEO");
      const task = makeTask(project.id, reviewer.id, "review");
      const now = Date.now();
      const tSubmission = new Date(now - 3000).toISOString();
      const tReviewer = new Date(now - 2000).toISOString();
      const tCeo = new Date(now - 1000).toISOString();

      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
      ).run(randomUUID(), project.id, task.id, producer.id, tSubmission);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, reviewer.id, tReviewer, tReviewer, tReviewer);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), task.id, ceo.id, tCeo, tCeo, tCeo);

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 0, `expected no repeated CEO wake; got ${JSON.stringify(result)}`);
      assert.ok(
        (result.skippedReasons.ceo_recent_review_no_close ?? 0) >= 1,
        `expected ceo_recent_review_no_close skip; got ${JSON.stringify(result.skippedReasons)}`,
      );
      const blocked = db
        .prepare("SELECT status, blocked_reason FROM tasks WHERE id = ?")
        .get(task.id) as { status: string; blocked_reason: string | null } | undefined;
      assert.equal(blocked?.status, "blocked", "CEO-reviewed current submission must be surfaced for human decision");
      assert.match(blocked?.blocked_reason ?? "", /Review loop guard/);
    });

    await test("sweep leaves review parents waiting when child tasks are still open", () => {
      clearWakes();
      const project = makeProject("sweep-review-parent-waiting-on-children");
      const producer = makeAgent(project.id, "parent-wait-producer", "Backend Engineer");
      const reviewer = makeAgent(project.id, "parent-wait-reviewer", "QA Engineer");
      const ceo = makeAgent(project.id, "parent-wait-ceo", "CEO");
      const parent = makeTask(project.id, reviewer.id, "review");
      const child = makeTask(project.id, producer.id, "review");
      db.prepare("UPDATE tasks SET parent_task_id = ? WHERE id = ?").run(parent.id, child.id);
      const now = Date.now();
      const tSubmission = new Date(now - 3000).toISOString();
      const tReviewer = new Date(now - 2000).toISOString();
      const tCeo = new Date(now - 1000).toISOString();

      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', '{}', ?)`,
      ).run(randomUUID(), project.id, parent.id, producer.id, tSubmission);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), parent.id, reviewer.id, tReviewer, tReviewer, tReviewer);
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?)`,
      ).run(randomUUID(), parent.id, ceo.id, tCeo, tCeo, tCeo);

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.ok(
        (result.skippedReasons.parent_waiting_on_children ?? 0) >= 1,
        `expected parent_waiting_on_children skip; got ${JSON.stringify(result.skippedReasons)}`,
      );
      const parentWakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .get(parent.id) as { n: number } | undefined;
      assert.equal(parentWakes?.n ?? 0, 0, `expected no parent wake while child is open; got ${JSON.stringify(result)}`);
      const blocked = db
        .prepare("SELECT status, blocked_reason FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string; blocked_reason: string | null } | undefined;
      assert.equal(blocked?.status, "review", "parent must remain in review until children close");
      assert.equal(blocked?.blocked_reason, null);
    });

    await test("sweep skips declared reviewer when reviewer is paused / offline / archived", () => {
      clearWakes();
      const project = makeProject("sweep-reviewer-unavailable");
      const producer = makeAgent(project.id, "unavail-producer", "Backend Engineer");
      const paused = makeAgent(project.id, "unavail-paused", "QA Engineer");
      const offline = makeAgent(project.id, "unavail-offline", "QA Engineer");
      const archived = makeAgent(project.id, "unavail-archived", "QA Engineer");
      const ceo = makeAgent(project.id, "unavail-ceo", "CEO");
      void ceo;

      const taskPaused = makeTask(project.id, paused.id, "review");
      seedCompletedOpenclawRun(taskPaused.id, producer.id, "completed");
      const taskOffline = makeTask(project.id, offline.id, "review");
      seedCompletedOpenclawRun(taskOffline.id, producer.id, "completed");
      const taskArchived = makeTask(project.id, archived.id, "review");
      seedCompletedOpenclawRun(taskArchived.id, producer.id, "completed");

      db.prepare("UPDATE agents SET status = 'paused' WHERE id = ?").run(paused.id);
      db.prepare("UPDATE agents SET status = 'offline' WHERE id = ?").run(offline.id);
      db.prepare("UPDATE agents SET archived_at = ? WHERE id = ?")
        .run(new Date().toISOString(), archived.id);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0, "no wakes — reviewer unavailable, no implicit CEO fallback");
      assert.ok(
        (result.skippedReasons.agent_paused ?? 0) >= 1,
        `expected agent_paused skip; got ${JSON.stringify(result.skippedReasons)}`,
      );
      assert.ok(
        (result.skippedReasons.agent_offline ?? 0) >= 1,
        `expected agent_offline skip; got ${JSON.stringify(result.skippedReasons)}`,
      );
      assert.ok(
        (result.skippedReasons.agent_archived ?? 0) >= 1,
        `expected agent_archived skip; got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep routes to CEO when reviewer assignee equals the most-recent producer (self-review fallback)", () => {
      clearWakes();
      const project = makeProject("sweep-reviewer-equals-producer");
      const worker = makeAgent(project.id, "self-worker", "Backend Engineer");
      const ceo = makeAgent(project.id, "self-ceo", "CEO");
      // Worker ran and task is in review with worker still assigned.
      // Classic workflow: assignee == producer → fallback to CEO.
      const task = makeTask(project.id, worker.id, "review");
      seedCompletedOpenclawRun(task.id, worker.id, "completed");

      const result = sweepOpenTasks(db, { cap: 10 });
      assert.equal(result.wakesEnqueued, 1);

      const wakes = db
        .prepare(
          `SELECT agent_id, reason FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?`,
        )
        .all(task.id) as Array<{ agent_id: string; reason: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, ceo.id, "assignee == producer must fall back to CEO");
      assert.equal(wakes[0].reason, "sweep_review_to_ceo");
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

    await test("sweep routes unassigned to-do task to CEO with reason 'sweep_unassigned_to_ceo'", () => {
      clearWakes();
      const project = makeProject("sweep-unassigned-happy");
      const ceo = makeAgent(project.id, "triage-ceo", "CEO");
      // Unassigned task — create via direct SQL since makeTask requires an
      // assignee. Matches the real-world pattern where operators or prior
      // runs leave a task in to-do with no assignee_agent_id.
      const taskId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO tasks
           (id, project_id, title, description, priority, type, status,
            assignee_agent_id, created_by, execution_mode,
            task_number, task_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'high', 'feature', 'to-do',
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
         VALUES (?, ?, ?, ?, 'high', 'feature', 'to-do',
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
         VALUES (?, ?, ?, ?, 'high', 'feature', 'to-do',
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

    await test("sweep retries unassigned to-do task when prior CEO triage failed", () => {
      clearWakes();
      const project = makeProject("sweep-unassigned-ceo-failed");
      const ceo = makeAgent(project.id, "triage-ceo-failed", "CEO");

      const taskId = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO tasks
           (id, project_id, title, description, priority, type, status,
            assignee_agent_id, created_by, execution_mode,
            task_number, task_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'high', 'feature', 'to-do',
                 NULL, 'operator:test', 'openclaw',
                 9996, 'UNASSIGNED-9996', ?, ?)`,
      ).run(taskId, project.id, "Failed-triage unassigned", "CEO failed before assigning", now, now);

      seedCompletedOpenclawRun(taskId, ceo.id, "failed");

      const result = sweepOpenTasks(db, { cap: 10 });
      const wake = db
        .prepare(
          `SELECT agent_id, reason
             FROM agent_wakeup_requests
            WHERE json_extract(payload_json, '$.taskId') = ?
            LIMIT 1`,
        )
        .get(taskId) as { agent_id: string; reason: string | null } | undefined;
      assert.equal(wake?.agent_id, ceo.id);
      assert.equal(wake?.reason, "sweep_unassigned_to_ceo");
      assert.equal(result.wakesEnqueued, 1);
    });

    await test("sweep ignores unassigned backlog/review tasks but routes unassigned in_progress anomaly", () => {
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
      // Unassigned + in_progress — anomaly, but it should be swept to CEO so
      // it gets an accountable owner instead of sitting active with no assignee.
      const inProgressId = randomUUID();
      db.prepare(
        `INSERT INTO tasks (id, project_id, title, description, priority, type, status, assignee_agent_id, created_by, execution_mode, task_number, task_key, created_at, updated_at)
         VALUES (?, ?, 'In-progress unassigned', '-', 'medium', 'feature', 'in_progress', NULL, 'test', 'openclaw', 9992, 'UNASSIGNED-9992', ?, ?)`,
      ).run(inProgressId, project.id, now, now);

      sweepOpenTasks(db, { cap: 10 });

      const ignoredWakes = db
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') IN (?, ?)`,
        )
        .get(backlogId, reviewId) as { n: number } | undefined;
      assert.equal(ignoredWakes?.n ?? 0, 0, "unassigned backlog/review tasks must not be swept");

      const routedWake = db
        .prepare(
          `SELECT reason
             FROM agent_wakeup_requests
            WHERE json_extract(payload_json, '$.taskId') = ?
            LIMIT 1`,
        )
        .get(inProgressId) as { reason: string | null } | undefined;
      assert.equal(routedWake?.reason, "sweep_unassigned_to_ceo");
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
