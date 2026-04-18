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

    const { createProject, createProjectAgent, createTask, moveTask } = await import(
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
      status: "review" | "backlog" | "done" | "blocked" | "on-deck" | "in-progress",
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

      // Operator manually bounces the task to on_deck.
      moveTask({ taskId: task.id, status: "on-deck", actorUserId: "tim" });

      assert.equal(readCounter(task.id), 0, "operator status change resets counter");
      assert.equal(readTaskStatus(task.id), "on_deck");
    });

    await test("sweeper skips tasks with counter >= 3 (defensive; real trips already flip to blocked)", () => {
      clearFixtureState();
      const project = makeProject("sweeper-filter");
      const agent = makeAgent(project.id, "sweeper-filter");
      const task = makeTask(project.id, agent.id, "on-deck");

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
      const task = makeTask(project.id, agent.id, "on-deck");

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
