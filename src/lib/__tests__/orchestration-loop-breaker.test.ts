/**
 * Contract tests for the in-progress-loop circuit breaker (2026-04-18 late
 * evening). Migration v46 adds `tasks.consecutive_noop_wakes`. finishRun
 * calls `checkAndTripCircuitBreaker` after every terminal run; trip at 3 →
 * task blocked, [AWAITING_HUMAN] comment, continuation skipped. moveTask
 * resets the counter on operator status changes so manual unblocks start
 * fresh. Sweeper has a defensive `< 3` filter.
 *
 * Production trigger: Vane's WEA-258 loop (~4/hr wakes, 22% timeout rate,
 * identical "unblock sweep" boilerplate) + Barometer's WEA-237 loop (~16/hr
 * wakes, explicit "stale wake again" self-recognition comments) observed
 * 2026-04-18 evening. No structural events emitted — just comments on top
 * of comments. Breaker detects exactly this pattern.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-loop-breaker.db \
 *   npx tsx src/lib/__tests__/orchestration-loop-breaker.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration In-Progress-Loop Circuit Breaker Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask, createTaskComment, moveTask } = await import(
      "@/lib/orchestration/service"
    );
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { checkAndTripCircuitBreaker } = await import("@/lib/orchestration/engine/engine");
    const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();

    function makeProject(tag: string) {
      return createProject({
        companyId,
        name: `LoopBreaker ${tag} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Loop-breaker fixture",
        color: "#ef4444",
        emoji: "🚨",
        status: "active",
      }).project;
    }

    function makeAgent(projectId: string, tag: string) {
      return createProjectAgent({
        projectId,
        name: `LoopBreaker Agent ${tag}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Deterministic",
        openclawAgentId: `loop-breaker-${tag}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
    }

    function makeTask(
      projectId: string,
      assigneeId: string | null,
      status: "review" | "backlog" | "done" | "blocked" | "to-do" | "in-progress",
    ) {
      return createTask({
        projectId,
        title: `LoopBreaker task ${status} ${Math.random().toString(36).slice(2, 6)}`,
        description: "Loop-breaker fixture",
        priority: "P2",
        type: "feature",
        status,
        assignee: assigneeId ?? undefined,
        labels: [],
        createdBy: "loop-breaker-test",
      }).task;
    }

    function readCounter(taskId: string): number {
      const row = db
        .prepare(
          "SELECT consecutive_noop_wakes AS n FROM tasks WHERE id = ? LIMIT 1",
        )
        .get(taskId) as { n: number } | undefined;
      return row?.n ?? -1;
    }

    function readTaskStatus(taskId: string): string {
      const row = db
        .prepare("SELECT status FROM tasks WHERE id = ? LIMIT 1")
        .get(taskId) as { status: string } | undefined;
      return row?.status ?? "";
    }

    function countAwaitingHumanComments(taskId: string): number {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM comments WHERE task_id = ? AND body LIKE '[AWAITING_HUMAN]%'",
        )
        .get(taskId) as { n: number };
      return row.n;
    }

    function clearFixtureState() {
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();
      db.prepare("UPDATE tasks SET archived_at = ? WHERE archived_at IS NULL").run(new Date().toISOString());
    }

    await test("no-op run increments counter from 0 to 1 (not tripped)", () => {
      clearFixtureState();
      const project = makeProject("noop-1");
      const agent = makeAgent(project.id, "noop-1");
      const task = makeTask(project.id, agent.id, "in-progress");
      assert.equal(readCounter(task.id), 0);

      const runWindowStart = new Date().toISOString();
      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId: randomUUID(),
          agentId: agent.id,
          runWindowStart,
        },
        db,
      );

      assert.equal(tripped, false);
      assert.equal(readCounter(task.id), 1);
      assert.equal(readTaskStatus(task.id), "in_progress");
    });

    await test("third consecutive no-op run trips the breaker (task blocked + AWAITING_HUMAN comment + counter reset to 0)", () => {
      clearFixtureState();
      const project = makeProject("trip");
      const agent = makeAgent(project.id, "trip");
      const task = makeTask(project.id, agent.id, "in-progress");

      for (let i = 0; i < 2; i += 1) {
        const tripped = checkAndTripCircuitBreaker(
          {
            taskId: task.id,
            runId: randomUUID(),
            agentId: agent.id,
            runWindowStart: new Date().toISOString(),
          },
          db,
        );
        assert.equal(tripped, false, `wake ${i + 1} should not trip`);
      }
      assert.equal(readCounter(task.id), 2);

      const thirdTripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId: randomUUID(),
          agentId: agent.id,
          runWindowStart: new Date().toISOString(),
        },
        db,
      );

      assert.equal(thirdTripped, true, "third wake must trip");
      assert.equal(readTaskStatus(task.id), "blocked", "task flipped to blocked");
      assert.equal(readCounter(task.id), 0, "counter reset to 0 after trip");
      assert.equal(
        countAwaitingHumanComments(task.id),
        1,
        "exactly one [AWAITING_HUMAN] comment emitted",
      );

      const statusEvent = db
        .prepare(
          `SELECT metadata_json FROM task_events
            WHERE task_id = ? AND event_type = 'task.status_changed' AND to_status = 'blocked'
            ORDER BY created_at DESC LIMIT 1`,
        )
        .get(task.id) as { metadata_json: string } | undefined;
      assert.ok(statusEvent, "task.status_changed event recorded");
      assert.match(statusEvent!.metadata_json, /engine_circuit_breaker/);
    });

    await test("circuit breaker on child task wakes parent assignee for triage", () => {
      clearFixtureState();
      const project = makeProject("child-trip-parent-wake");
      const lead = makeAgent(project.id, "child-trip-lead");
      const worker = makeAgent(project.id, "child-trip-worker");
      const parent = makeTask(project.id, lead.id, "in-progress");
      const child = makeTask(project.id, worker.id, "in-progress");
      db.prepare("UPDATE tasks SET parent_task_id = ? WHERE id = ?").run(parent.id, child.id);

      for (let i = 0; i < 2; i += 1) {
        const tripped = checkAndTripCircuitBreaker(
          {
            taskId: child.id,
            runId: randomUUID(),
            agentId: worker.id,
            runWindowStart: new Date().toISOString(),
          },
          db,
        );
        assert.equal(tripped, false, `wake ${i + 1} should not trip`);
      }

      const runId = randomUUID();
      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: child.id,
          runId,
          agentId: worker.id,
          runWindowStart: new Date().toISOString(),
        },
        db,
      );

      assert.equal(tripped, true, "third child wake must trip");
      const wake = db
        .prepare(
          `SELECT reason, payload_json
           FROM agent_wakeup_requests
           WHERE agent_id = ?
             AND status IN ('queued', 'claimed')
             AND reason = 'child_task_blocked'
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(lead.id) as { reason: string; payload_json: string } | undefined;
      assert.ok(wake, "parent assignee should receive a blocked-child triage wake");
      const payload = JSON.parse(wake!.payload_json) as Record<string, unknown>;
      assert.equal(payload.parentTaskId, parent.id);
      assert.equal(payload.childTaskId, child.id);
      assert.equal(payload.runId, runId);
    });

    await test("parent with open child tasks does not trip the no-op circuit breaker", () => {
      clearFixtureState();
      const project = makeProject("parent-open-child");
      const agent = makeAgent(project.id, "parent-open-child");
      const parent = makeTask(project.id, agent.id, "in-progress");
      createTask({
        projectId: project.id,
        parentTaskId: parent.id,
        title: `Open child ${Math.random().toString(36).slice(2, 6)}`,
        description: "Child remains open, so parent is waiting rather than stuck.",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: agent.id,
        labels: [],
        createdBy: "loop-breaker-test",
      });
      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(parent.id);

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: parent.id,
          runId: randomUUID(),
          agentId: agent.id,
          runWindowStart: new Date().toISOString(),
        },
        db,
      );

      assert.equal(tripped, false);
      assert.notEqual(readTaskStatus(parent.id), "blocked");
      assert.equal(readCounter(parent.id), 0, "parent waiting on child work should reset the no-op counter");
      assert.equal(countAwaitingHumanComments(parent.id), 0);
    });

    await test("structural event during the run resets counter to 0", () => {
      clearFixtureState();
      const project = makeProject("reset");
      const agent = makeAgent(project.id, "reset");
      const task = makeTask(project.id, agent.id, "in-progress");

      // Seed the counter to 2 via two no-ops.
      for (let i = 0; i < 2; i += 1) {
        checkAndTripCircuitBreaker(
          {
            taskId: task.id,
            runId: randomUUID(),
            agentId: agent.id,
            runWindowStart: new Date().toISOString(),
          },
          db,
        );
      }
      assert.equal(readCounter(task.id), 2);

      // Now simulate a structural event (status_changed) during the NEXT run's
      // window. The function should detect it and reset the counter to 0.
      const nextRunStart = new Date().toISOString();
      db.prepare(
        `INSERT INTO task_events
          (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
      ).run(
        randomUUID(),
        project.id,
        task.id,
        agent.id,
        JSON.stringify({ source: "engine_action", runId: "test" }),
        new Date().toISOString(),
      );
      // Also update task.status so post-event state is consistent.
      db.prepare("UPDATE tasks SET status = 'review' WHERE id = ?").run(task.id);

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId: randomUUID(),
          agentId: agent.id,
          runWindowStart: nextRunStart,
        },
        db,
      );

      assert.equal(tripped, false);
      assert.equal(readCounter(task.id), 0, "structural progress resets counter");
    });

    await test("new agent comment during an assignment run counts as progress even without status movement", () => {
      clearFixtureState();
      const project = makeProject("agent-comment-progress");
      const agent = makeAgent(project.id, "agent-comment-progress");
      const task = makeTask(project.id, agent.id, "in-progress");

      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);

      const runWindowStart = new Date(Date.now() - 1_000).toISOString();
      createTaskComment({
        taskId: task.id,
        body: "Completed the requested assessment and posted the operator-facing findings with the relevant caveats.",
        type: "comment",
        authorAgentId: agent.id,
        source: "anthropic",
        createdAt: new Date().toISOString(),
      });

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId: randomUUID(),
          agentId: agent.id,
          runWindowStart,
        },
        db,
      );

      assert.equal(tripped, false);
      assert.equal(readTaskStatus(task.id), "in_progress");
      assert.equal(readCounter(task.id), 0, "fresh operator-facing comments count as progress");
      assert.equal(countAwaitingHumanComments(task.id), 0);
    });

    await test("executed task status action prevents same-run circuit breaker trip", () => {
      clearFixtureState();
      const project = makeProject("same-run-status-action");
      const agent = makeAgent(project.id, "same-run-status-action");
      const task = makeTask(project.id, agent.id, "in-progress");
      const runId = randomUUID();
      const now = new Date().toISOString();

      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, trigger_detail, status, started_at, result_json, usage_json, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'same-run status action fixture', 'running', ?, ?, '{}', '{}', ?, ?)`,
      ).run(
        runId,
        agent.id,
        companyId,
        now,
        JSON.stringify({
          perActionDetail: [
            { action: "update_task", target: task.key, status: "executed", durationMs: 1 },
          ],
        }),
        now,
        now,
      );

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId,
          agentId: agent.id,
          runWindowStart: now,
        },
        db,
      );

      assert.equal(tripped, false);
      assert.equal(readTaskStatus(task.id), "in_progress");
      assert.equal(readCounter(task.id), 0, "same-run executed update_task should reset counter");
      assert.equal(countAwaitingHumanComments(task.id), 0);
    });

    await test("duplicate agent comments do not bypass the no-op breaker", () => {
      clearFixtureState();
      const project = makeProject("duplicate-comment");
      const agent = makeAgent(project.id, "duplicate-comment");
      const task = makeTask(project.id, agent.id, "in-progress");
      const repeatedBody = "Still checking the same thing and will report back when I have a clearer answer.";

      createTaskComment({
        taskId: task.id,
        body: repeatedBody,
        type: "comment",
        authorAgentId: agent.id,
        source: "anthropic",
        createdAt: new Date(Date.now() - 5_000).toISOString(),
      });
      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);

      const runWindowStart = new Date(Date.now() - 1_000).toISOString();
      createTaskComment({
        taskId: task.id,
        body: repeatedBody,
        type: "comment",
        authorAgentId: agent.id,
        source: "anthropic",
        createdAt: new Date().toISOString(),
      });

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId: randomUUID(),
          agentId: agent.id,
          runWindowStart,
        },
        db,
      );

      assert.equal(tripped, true, "repeated comments should still trip at the threshold");
      assert.equal(readTaskStatus(task.id), "blocked");
      assert.equal(readCounter(task.id), 0);
      assert.equal(countAwaitingHumanComments(task.id), 1);
    });

    await test("agent reply to a human-comment wake resets counter without blocking review follow-ups", () => {
      clearFixtureState();
      const project = makeProject("human-followup");
      const agent = makeAgent(project.id, "human-followup");
      const task = makeTask(project.id, agent.id, "review");

      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);

      const runId = randomUUID();
      const runWindowStart = new Date(Date.now() - 1_000).toISOString();
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, status, started_at, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'succeeded', ?, ?, ?, ?)`,
      ).run(
        runId,
        agent.id,
        project.companyId,
        runWindowStart,
        JSON.stringify({
          wakeSource: "api",
          wakeReason: "user_comment_on_assigned_task",
          taskId: task.id,
          commentId: "human-comment-fixture",
        }),
        runWindowStart,
        runWindowStart,
      );
      createTaskComment({
        taskId: task.id,
        body: "Yes, answer the follow-up directly.",
        type: "comment",
        authorAgentId: agent.id,
        source: "anthropic",
        createdAt: new Date().toISOString(),
      });

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId,
          agentId: agent.id,
          runWindowStart,
        },
        db,
      );

      assert.equal(tripped, false);
      assert.equal(readTaskStatus(task.id), "review");
      assert.equal(readCounter(task.id), 0, "human follow-up replies count as progress");
      assert.equal(countAwaitingHumanComments(task.id), 0);
    });

    await test("human comments reset the no-op counter before the follow-up wake runs", () => {
      clearFixtureState();
      const project = makeProject("human-comment-reset");
      const agent = makeAgent(project.id, "human-comment-reset");
      const task = makeTask(project.id, agent.id, "review");

      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);

      createTaskComment({
        taskId: task.id,
        body: "Can you clarify this specific point?",
        type: "comment",
        authorUserId: "tim",
        source: "mission_control",
      });

      assert.equal(readCounter(task.id), 0, "human conversation should start a fresh breaker window");

      const queuedWake = db
        .prepare(
          `SELECT reason, trigger_detail
             FROM agent_wakeup_requests
            WHERE agent_id = ?
            ORDER BY requested_at DESC
            LIMIT 1`,
        )
        .get(agent.id) as { reason: string | null; trigger_detail: string | null } | undefined;
      assert.equal(queuedWake?.reason, "user_comment_on_assigned_task");
      assert.match(queuedWake?.trigger_detail ?? "", /^task_comment:/);
    });

    await test("human-comment wakes never trip the no-op breaker even if no reply import is detected", () => {
      clearFixtureState();
      const project = makeProject("human-wake-no-reply");
      const agent = makeAgent(project.id, "human-wake-no-reply");
      const task = makeTask(project.id, agent.id, "review");

      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);

      const runId = randomUUID();
      const humanCommentId = randomUUID();
      const runWindowStart = new Date(Date.now() - 1_000).toISOString();
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, trigger_detail, status, started_at, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', ?, 'succeeded', ?, ?, ?, ?)`,
      ).run(
        runId,
        agent.id,
        project.companyId,
        `task_comment:${humanCommentId}`,
        runWindowStart,
        JSON.stringify({
          wakeSource: "api",
          wakeReason: "user_comment_on_assigned_task",
          taskId: task.id,
          taskStatus: "review",
          commentId: humanCommentId,
        }),
        runWindowStart,
        runWindowStart,
      );

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId,
          agentId: agent.id,
          runWindowStart,
        },
        db,
      );

      assert.equal(tripped, false);
      assert.equal(readTaskStatus(task.id), "review");
      assert.equal(readCounter(task.id), 0, "human-comment wake should not consume a breaker strike");
      assert.equal(countAwaitingHumanComments(task.id), 0);
    });

    await test("task-comment wake with recorded agent comment event resets counter", () => {
      clearFixtureState();
      const project = makeProject("human-followup-event");
      const agent = makeAgent(project.id, "human-followup-event");
      const task = makeTask(project.id, agent.id, "review");

      db.prepare("UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?").run(task.id);

      const runId = randomUUID();
      const humanCommentId = randomUUID();
      const runWindowStart = new Date(Date.now() - 1_000).toISOString();
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, trigger_detail, status, started_at, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', ?, 'succeeded', ?, ?, ?, ?)`,
      ).run(
        runId,
        agent.id,
        project.companyId,
        `task_comment:${humanCommentId}`,
        runWindowStart,
        JSON.stringify({
          wakeSource: "api",
          taskId: task.id,
          taskStatus: "review",
          commentId: humanCommentId,
        }),
        runWindowStart,
        runWindowStart,
      );
      db.prepare(
        `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`,
      ).run(
        randomUUID(),
        project.id,
        task.id,
        agent.id,
        JSON.stringify({ source: "engine_heartbeat", runId }),
        new Date().toISOString(),
      );

      const tripped = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId,
          agentId: agent.id,
          runWindowStart,
        },
        db,
      );

      assert.equal(tripped, false);
      assert.equal(readTaskStatus(task.id), "review");
      assert.equal(readCounter(task.id), 0, "run-linked comment events count as progress");
      assert.equal(countAwaitingHumanComments(task.id), 0);
    });

    await test("breaker is a no-op on already-blocked tasks (idempotent; returns false without modifying)", () => {
      clearFixtureState();
      const project = makeProject("already-blocked");
      const agent = makeAgent(project.id, "already-blocked");
      const task = makeTask(project.id, agent.id, "in-progress");

      // Trip it.
      for (let i = 0; i < 3; i += 1) {
        checkAndTripCircuitBreaker(
          {
            taskId: task.id,
            runId: randomUUID(),
            agentId: agent.id,
            runWindowStart: new Date().toISOString(),
          },
          db,
        );
      }
      assert.equal(readTaskStatus(task.id), "blocked");
      const commentsBefore = countAwaitingHumanComments(task.id);

      // Call again on the already-blocked task — should be a no-op.
      const trippedAgain = checkAndTripCircuitBreaker(
        {
          taskId: task.id,
          runId: randomUUID(),
          agentId: agent.id,
          runWindowStart: new Date().toISOString(),
        },
        db,
      );

      assert.equal(trippedAgain, false);
      assert.equal(readCounter(task.id), 0);
      assert.equal(
        countAwaitingHumanComments(task.id),
        commentsBefore,
        "no new AWAITING_HUMAN comment on already-blocked task",
      );
    });

    await test("moveTask resets counter on status change (operator unblock path)", () => {
      clearFixtureState();
      const project = makeProject("operator-reset");
      const agent = makeAgent(project.id, "operator-reset");
      const task = makeTask(project.id, agent.id, "in-progress");

      // Seed counter to 2 via no-ops.
      for (let i = 0; i < 2; i += 1) {
        checkAndTripCircuitBreaker(
          {
            taskId: task.id,
            runId: randomUUID(),
            agentId: agent.id,
            runWindowStart: new Date().toISOString(),
          },
          db,
        );
      }
      assert.equal(readCounter(task.id), 2);

      // Operator manually bounces the task to to-do.
      moveTask({ taskId: task.id, status: "to-do", actorUserId: "tim" });

      assert.equal(readCounter(task.id), 0, "operator status change resets counter");
      assert.equal(readTaskStatus(task.id), "to-do");
    });

    await test("sweeper skips tasks with counter >= 3 (defensive; real trips already flip to blocked)", () => {
      clearFixtureState();
      const project = makeProject("sweeper-filter");
      const agent = makeAgent(project.id, "sweeper-filter");
      const task = makeTask(project.id, agent.id, "to-do");

      // Force counter >= 3 while keeping status sweep-eligible — belt-and-
      // suspenders case (shouldn't happen via normal trip because trip flips
      // to blocked, but the filter is defensive).
      db.prepare(
        "UPDATE tasks SET consecutive_noop_wakes = 5 WHERE id = ?",
      ).run(task.id);

      const result = sweepOpenTasks(db, { cap: 10 });

      // The candidate list should not include this task.
      assert.equal(
        result.wakesEnqueued,
        0,
        `sweeper should not enqueue; got ${JSON.stringify(result)}`,
      );
    });

    await test("sweeper still picks up tasks with counter < 3 (happy path regression)", () => {
      clearFixtureState();
      const project = makeProject("sweeper-happy");
      const agent = makeAgent(project.id, "sweeper-happy");
      const task = makeTask(project.id, agent.id, "to-do");

      db.prepare(
        "UPDATE tasks SET consecutive_noop_wakes = 2 WHERE id = ?",
      ).run(task.id);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `counter=2 should still sweep; got ${JSON.stringify(result)}`);
      assert.equal(result.candidatesConsidered, 1);
    });
  } catch (error) {
    failed += 1;
    console.error("  Fatal setup error:", error instanceof Error ? error.stack ?? error.message : error);
  } finally {
    console.log(`\n${passed} passed, ${failed} failed\n`);
    process.exit(failed === 0 ? 0 : 1);
  }
}

run();
