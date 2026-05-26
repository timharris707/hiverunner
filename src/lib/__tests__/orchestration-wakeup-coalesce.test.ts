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

console.log("\nOrchestration Wakeup Coalesce Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { enqueueWakeup } = await import("@/lib/orchestration/engine/engine");

    async function makeAgent() {
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
        openclawAgentId: `coalesce-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
      return { project, agent };
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

      const db = getOrchestrationDb();
      const rows = db.prepare(
        `SELECT id, status, coalesced_count FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agent.id) as Array<{ id: string; status: string; coalesced_count: number }>;

      assert.equal(rows.length, 1, "only one wake row should exist");
      assert.equal(rows[0].status, "queued", "the surviving wake stays queued");
      assert.equal(rows[0].coalesced_count, 1, "coalesced_count should bump from 0 to 1");
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

      const db = getOrchestrationDb();
      const rows = db.prepare(
        `SELECT id, status FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agent.id) as Array<{ id: string; status: string }>;

      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows,
        [
          { id: first.wakeupRequestId, status: "failed" },
          { id: second.wakeupRequestId, status: "queued" },
        ],
      );
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

      const db = getOrchestrationDb();
      const rows = db.prepare(
        `SELECT id, status FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agent.id) as Array<{ id: string; status: string }>;

      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows,
        [
          { id: first.wakeupRequestId, status: "failed" },
          { id: second.wakeupRequestId, status: "queued" },
        ],
      );
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

      const db = getOrchestrationDb();
      const rows = db.prepare(
        `SELECT id, status, coalesced_count FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agent.id) as Array<{ id: string; status: string; coalesced_count: number }>;

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

      const db = getOrchestrationDb();
      const rows = db.prepare(
        `SELECT id, status FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agent.id) as Array<{ id: string; status: string }>;

      assert.equal(rows.length, 2);
      assert.deepEqual(rows, [
        { id: first.wakeupRequestId, status: "failed" },
        { id: second.wakeupRequestId, status: "queued" },
      ]);
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

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
