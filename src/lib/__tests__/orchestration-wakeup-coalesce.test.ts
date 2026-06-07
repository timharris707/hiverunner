/**
 * Contract tests for idempotent wake coalescing.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-wakeup-coalesce.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-wakeup-coalesce.test.ts
 *
 * Regression guard for the supersede-before-coalesce bug: enqueueWakeup used
 * to run pruneSupersededQueuedWakeups first, which flipped every queued wake
 * for the agent to failed/superseded_by_newer_wake. The idempotency SELECT
 * that followed (WHERE status = 'queued') could never find a match, so
 * coalesce was dead code. In production this caused continuation paths that
 * used distinct idempotency keys (finish-run-continuation vs
 * reconcile-continuation) to destroy each other's queued wakes instead of
 * collapsing into one.
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "✓", failLabel: "✗" });

console.log("\nOrchestration Wakeup Coalesce Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { enqueueWakeup, executeHeartbeatRun, __testHooks } = await import("@/lib/orchestration/engine/engine");

    async function makeAgent(options: { openclaw?: boolean } = {}) {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Coalesce ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: "Coalesce fixture",
        color: "#8b5cf6",
        emoji: "🧪",
        status: "active",
      }).project;
      const agent = createProjectAgent({
        projectId: project.id,
        name: `Coalesce Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Deterministic",
        openclawAgentId: options.openclaw === false
          ? undefined
          : `coalesce-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
      return { project, agent };
    }

    function listWakeStatuses(agentId: string) {
      const db = getOrchestrationDb();
      return db.prepare(
        `SELECT id, status FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agentId) as Array<{ id: string; status: string }>;
    }

    function listWakeCoalesceRows(agentId: string) {
      const db = getOrchestrationDb();
      return db.prepare(
        `SELECT id, status, coalesced_count FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agentId) as Array<{ id: string; status: string; coalesced_count: number }>;
    }

    function assertSupersededWakePair(
      rows: Array<{ id: string; status: string }>,
      firstId: string,
      secondId: string,
    ) {
      assert.equal(rows.length, 2);
      assert.deepEqual(rows, [
        { id: firstId, status: "failed" },
        { id: secondId, status: "queued" },
      ]);
    }

    await test("two enqueues with the same idempotencyKey coalesce onto the first wake", async () => {
      const { project, agent } = await makeAgent();

      const first = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "continuation_review_assignee",
        idempotencyKey: `continuation:fake-task-1:review`,
      });
      const second = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "reconcile_continue_review",
        idempotencyKey: `continuation:fake-task-1:review`,
      });

      assert.equal(second.status, "coalesced", "second enqueue with same key should coalesce");
      assert.equal(second.wakeupRequestId, first.wakeupRequestId, "coalesced call must reuse first wake's id");

      const rows = listWakeCoalesceRows(agent.id);

      assert.equal(rows.length, 1, "only one wake row should exist");
      assert.equal(rows[0].status, "queued", "the surviving wake stays queued");
      assert.equal(rows[0].coalesced_count, 1, "coalesced_count should bump from 0 to 1");
    });

    await test("comment wake and in-progress transition wake for the same claimed task do not refresh active context", async () => {
      const { project, agent } = await makeAgent();
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM heartbeat_runs").run();
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      const taskId = `task-comment-transition-${Math.random().toString(36).slice(2, 8)}`;

      const commentWake = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "user_comment_on_assigned_task",
        triggerDetail: "task_comment:comment-1",
        payload: {
          taskId,
          taskStatus: "to-do",
          commentId: "comment-1",
        },
        idempotencyKey: `task-comment-wake:comment-1:${taskId}`,
      });

      const claimed = __testHooks.claimNextQueuedRun(db);
      assert.equal(claimed?.id, commentWake.heartbeatRunId, "fixture should claim the comment wake");

      const transitionWake = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "issue_assigned",
        reason: "task_moved_to_in_progress",
        payload: {
          taskId,
          taskStatus: "in_progress",
          executionRunId: "execution-run-from-transition",
        },
        idempotencyKey: `mc-task-transition:${taskId}:to-do->in_progress:updated-at`,
      });

      assert.equal(transitionWake.status, "coalesced");
      assert.equal(transitionWake.wakeupRequestId, commentWake.wakeupRequestId);
      assert.equal(transitionWake.heartbeatRunId, commentWake.heartbeatRunId);

      const rows = db.prepare(
        `SELECT awr.id, awr.status AS wake_status, awr.coalesced_count, hr.id AS run_id, hr.status AS run_status,
                hr.context_snapshot_json
         FROM agent_wakeup_requests awr
         INNER JOIN heartbeat_runs hr ON hr.id = awr.run_id
         WHERE awr.agent_id = ?
         ORDER BY awr.created_at ASC`,
      ).all(agent.id) as Array<{
        id: string;
        wake_status: string;
        coalesced_count: number;
        run_id: string;
        run_status: string;
        context_snapshot_json: string;
      }>;

      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, commentWake.wakeupRequestId);
      assert.equal(rows[0].wake_status, "claimed");
      assert.equal(rows[0].coalesced_count, 1);
      assert.equal(rows[0].run_id, commentWake.heartbeatRunId);
      assert.equal(rows[0].run_status, "running");
      const snapshot = JSON.parse(rows[0].context_snapshot_json) as Record<string, unknown>;
      assert.equal(snapshot.taskStatus, "to-do");
      assert.equal(snapshot.executionRunId, undefined);
    });

    await test("queued same-task coalesce refreshes the surviving heartbeat context", async () => {
      const { project, agent } = await makeAgent();
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM heartbeat_runs").run();
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      const taskId = `task-comment-transition-queued-${Math.random().toString(36).slice(2, 8)}`;

      const commentWake = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "user_comment_on_assigned_task",
        payload: {
          taskId,
          taskStatus: "to-do",
          commentId: "comment-before-transition",
        },
        idempotencyKey: `task-comment-wake:comment-before-transition:${taskId}`,
      });
      const transitionWake = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "issue_assigned",
        reason: "task_moved_to_in_progress",
        payload: {
          taskId,
          taskStatus: "in_progress",
          executionRunId: "execution-run-before-claim",
        },
        idempotencyKey: `mc-task-transition:${taskId}:to-do->in_progress:queued`,
      });

      assert.equal(transitionWake.status, "coalesced");
      assert.equal(transitionWake.wakeupRequestId, commentWake.wakeupRequestId);

      const row = db.prepare(
        `SELECT awr.coalesced_count, awr.payload_json, hr.context_snapshot_json
         FROM agent_wakeup_requests awr
         INNER JOIN heartbeat_runs hr ON hr.id = awr.run_id
         WHERE awr.id = ?
         LIMIT 1`,
      ).get(commentWake.wakeupRequestId) as {
        coalesced_count: number;
        payload_json: string;
        context_snapshot_json: string;
      };
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      const snapshot = JSON.parse(row.context_snapshot_json) as Record<string, unknown>;

      assert.equal(row.coalesced_count, 1);
      assert.equal(payload.taskStatus, "in_progress");
      assert.equal(snapshot.taskStatus, "in_progress");
      assert.equal(snapshot.executionRunId, "execution-run-before-claim");
    });

    await test("comment wake that transitions to in-progress is not cancelled as stale", async () => {
      const { project, agent } = await makeAgent({ openclaw: false });
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM heartbeat_runs").run();
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      const task = createTask({
        projectId: project.id,
        title: "Comment transition fixture",
        description: "The user comments, then starts the task before the wake executes.",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: agent.id,
        labels: [],
        createdBy: "coalesce-test",
      }).task;
      const wake = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "user_comment_on_assigned_task",
        payload: {
          taskId: task.id,
          taskStatus: "to-do",
          commentId: "comment-before-start",
        },
        idempotencyKey: `task-comment-wake:comment-before-start:${task.id}`,
      });

      db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), task.id);

      let resultError = "";
      try {
        const result = await executeHeartbeatRun(wake.heartbeatRunId, db);
        resultError = result.error ?? "";
      } catch (error) {
        resultError = error instanceof Error ? error.message : String(error);
      }

      assert.doesNotMatch(resultError, /Skipped stale wake/);
    });

    await test("generic manual wake does not coalesce onto an already running task wake", async () => {
      const { project, agent } = await makeAgent();
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM heartbeat_runs").run();
      db.prepare("DELETE FROM agent_wakeup_requests").run();

      const taskWake = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "sweep_open_task",
        contextSnapshot: {
          wakeSource: "api",
          wakeReason: "sweep_open_task",
          taskId: "task-running-specific",
          taskStatus: "to-do",
        },
        idempotencyKey: "sweep:task-running-specific:to-do",
      });

      const claimed = __testHooks.claimNextQueuedRun(db);
      assert.equal(claimed?.id, taskWake.heartbeatRunId, "fixture should claim the task wake");

      const manualWake = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "explicit",
        reason: "ui_manual_wake",
      });

      assert.equal(manualWake.status, "queued");
      assert.notEqual(manualWake.wakeupRequestId, taskWake.wakeupRequestId);

      const rows = db.prepare(
        `SELECT status
         FROM agent_wakeup_requests
         WHERE agent_id = ?
         ORDER BY created_at ASC`,
      ).all(agent.id) as Array<{ status: string }>;
      assert.deepEqual(rows.map((row) => row.status), ["claimed", "queued"]);
    });

    await test("two enqueues with DIFFERENT idempotencyKeys supersede (newer wins, older fails)", async () => {
      const { project, agent } = await makeAgent();

      const first = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "first-event",
        idempotencyKey: `event-A:task-X`,
      });
      const second = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "second-event",
        idempotencyKey: `event-B:task-X`,
      });

      assert.notEqual(second.status, "coalesced", "different keys must not coalesce");

      assertSupersededWakePair(listWakeStatuses(agent.id), first.wakeupRequestId, second.wakeupRequestId);
    });

    await test("non-idempotent enqueues still supersede prior queued wakes (legacy behavior preserved)", async () => {
      const { project, agent } = await makeAgent();

      const first = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "first",
      });
      const second = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "second",
      });

      assertSupersededWakePair(listWakeStatuses(agent.id), first.wakeupRequestId, second.wakeupRequestId);
    });

    await test("generic manual wake coalesces onto an existing task-specific wake instead of superseding it", async () => {
      const { project, agent } = await makeAgent();

      const first = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "sweep_open_task",
        contextSnapshot: {
          wakeSource: "api",
          wakeReason: "sweep_open_task",
          taskId: "task-specific-1",
          taskStatus: "to-do",
        },
        idempotencyKey: "sweep:task-specific-1:to-do",
      });
      const second = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "explicit",
        reason: "ui_manual_wake",
      });

      assert.equal(second.status, "coalesced");
      assert.equal(second.wakeupRequestId, first.wakeupRequestId);

      const rows = listWakeCoalesceRows(agent.id);

      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], { id: first.wakeupRequestId, status: "queued", coalesced_count: 1 });
    });

    await test("task-specific wake supersedes an older generic wake so the task context wins", async () => {
      const { project, agent } = await makeAgent();

      const first = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "explicit",
        reason: "ui_manual_wake",
      });
      const second = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "sweep_open_task",
        contextSnapshot: {
          wakeSource: "api",
          wakeReason: "sweep_open_task",
          taskId: "task-specific-2",
          taskStatus: "to-do",
        },
        idempotencyKey: "sweep:task-specific-2:to-do",
      });

      assertSupersededWakePair(listWakeStatuses(agent.id), first.wakeupRequestId, second.wakeupRequestId);
    });

    await test("three enqueues with the same key collapse to one wake with coalesced_count=2", async () => {
      const { project, agent } = await makeAgent();

      const first = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "r1",
        idempotencyKey: `continuation:fake-task-triple:in_progress`,
      });
      const second = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "r2",
        idempotencyKey: `continuation:fake-task-triple:in_progress`,
      });
      const third = enqueueWakeup({
        agentId: agent.id,
        companyId: project.companyId,
        source: "api",
        reason: "r3",
        idempotencyKey: `continuation:fake-task-triple:in_progress`,
      });

      assert.equal(second.status, "coalesced");
      assert.equal(third.status, "coalesced");
      assert.equal(second.wakeupRequestId, first.wakeupRequestId);
      assert.equal(third.wakeupRequestId, first.wakeupRequestId);

      const db = getOrchestrationDb();
      const row = db.prepare(
        `SELECT coalesced_count FROM agent_wakeup_requests WHERE id = ?`
      ).get(first.wakeupRequestId) as { coalesced_count: number } | undefined;

      assert.equal(row?.coalesced_count, 2, "two coalesces should bump the counter to 2");
    });
  } finally {
    if (dbPath) rmSync(dbPath, { force: true });
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
