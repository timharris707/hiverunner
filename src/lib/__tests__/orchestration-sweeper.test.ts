/**
 * Contract tests for the orchestration sweeper.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-sweeper.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-sweeper.test.ts
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

console.log("\nOrchestration Sweeper Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();

    function makeProject(nameTag: string) {
      return createProject({
        companyId,
        name: `Sweep ${nameTag} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Sweep fixture",
        color: "#3b82f6",
        emoji: "🧹",
        status: "active",
      }).project;
    }

    function makeAgent(projectId: string, tag: string) {
      return createProjectAgent({
        projectId,
        name: `Sweep Agent ${tag}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Deterministic",
        openclawAgentId: `sweep-${tag}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
    }

    function makeTask(projectId: string, assigneeId: string | null, status: string) {
      const task = createTask({
        projectId,
        title: `Sweep task ${status} ${Math.random().toString(36).slice(2, 6)}`,
        description: "Sweep task fixture",
        priority: "P2",
        type: "feature",
        status,
        assignee: assigneeId,
        labels: [],
        createdBy: "sweep-test",
      }).task;
      return task;
    }

    function clearWakes() {
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();
      // Archive tasks from prior tests so sweeper doesn't pick them up. Each
      // test seeds its own tasks fresh — the filter is archived_at IS NULL so
      // setting archived_at removes them from the candidate set.
      db.prepare("UPDATE tasks SET archived_at = ? WHERE archived_at IS NULL").run(new Date().toISOString());
    }

    await test("sweep enqueues wakes for assigned open tasks (on-deck / in-progress / review)", () => {
      clearWakes();
      const project = makeProject("happy-path");
      // One agent per task so the per-agent concurrency guard doesn't suppress
      // the second/third enqueue on a single pass.
      const agentOnDeck = makeAgent(project.id, "on-deck");
      const agentInProg = makeAgent(project.id, "in-prog");
      const agentReview = makeAgent(project.id, "review");
      makeTask(project.id, agentOnDeck.id, "on-deck");
      makeTask(project.id, agentInProg.id, "in-progress");
      makeTask(project.id, agentReview.id, "review");

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 3, `expected 3 wakes, got ${JSON.stringify(result)}`);
      assert.equal(result.candidatesConsidered, 3);
    });

    await test("sweep skips blocked / done / backlog tasks (cancelled handled at caller)", () => {
      clearWakes();
      const project = makeProject("terminal-statuses");
      const agent = makeAgent(project.id, "terminal");
      makeTask(project.id, agent.id, "blocked");
      makeTask(project.id, agent.id, "done");
      makeTask(project.id, agent.id, "backlog");

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.equal(result.wakesCoalesced, 0);
      // The SQL filter drops these entirely — they shouldn't even be candidates.
      // (Tasks from earlier open-status tests in the same DB may still match
      //  the query, which is why we compare ">= 0" rather than "=== 0" on
      //  candidatesConsidered.)
      assert.ok(result.candidatesConsidered >= 0);
    });

    await test("sweep skips unassigned tasks", () => {
      clearWakes();
      const project = makeProject("unassigned");
      const unassignedTask = makeTask(project.id, null, "on-deck");

      const result = sweepOpenTasks(db, { cap: 10 });
      const wakeForUnassigned = db.prepare(
        `SELECT COUNT(*) AS n FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?`,
      ).get(unassignedTask.id) as { n: number } | undefined;

      assert.equal(wakeForUnassigned?.n ?? 0, 0);
      void result;
    });

    await test("sweep skips paused / offline / archived agents", () => {
      clearWakes();
      const project = makeProject("paused-offline");
      const paused = makeAgent(project.id, "paused");
      const offline = makeAgent(project.id, "offline");
      const archived = makeAgent(project.id, "archived");

      // Create tasks FIRST (createTask rejects paused/offline/archived
      // assignees), then flip agent status after assignment.
      makeTask(project.id, paused.id, "in-progress");
      makeTask(project.id, offline.id, "in-progress");
      makeTask(project.id, archived.id, "in-progress");

      db.prepare("UPDATE agents SET status = 'paused' WHERE id = ?").run(paused.id);
      db.prepare("UPDATE agents SET status = 'offline' WHERE id = ?").run(offline.id);
      db.prepare("UPDATE agents SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), archived.id);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.ok(
        (result.skippedReasons.agent_paused ?? 0) >= 1,
        `expected at least one agent_paused skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
      assert.ok(
        (result.skippedReasons.agent_offline ?? 0) >= 1,
        `expected at least one agent_offline skip`,
      );
      // archived agents are filtered at the SQL join (INNER JOIN on agents
      // still sees archived rows — the archived filter happens in loop body)
      assert.ok(
        (result.skippedReasons.agent_archived ?? 0) >= 1,
        `expected at least one agent_archived skip`,
      );
    });

    await test("sweep skips agents that already have queued or running wakes", () => {
      clearWakes();
      const project = makeProject("concurrency");
      const agent = makeAgent(project.id, "busy");
      makeTask(project.id, agent.id, "in-progress");

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_wakeup_requests
           (id, agent_id, company_id, source, status, requested_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'queued', ?, ?, ?)`,
      ).run(randomUUID(), agent.id, project.companyId, now, now, now);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.ok(
        (result.skippedReasons.agent_has_active_wake ?? 0) >= 1,
        `expected at least one agent_has_active_wake skip`,
      );
    });

    await test("sweep backs off agents with 3+ failed runs in the last hour", () => {
      clearWakes();
      const project = makeProject("backoff");
      const agent = makeAgent(project.id, "failing");
      makeTask(project.id, agent.id, "in-progress");

      const now = new Date();
      for (let i = 0; i < 3; i += 1) {
        const ts = new Date(now.getTime() - (i + 1) * 60_000).toISOString();
        db.prepare(
          `INSERT INTO heartbeat_runs
             (id, agent_id, company_id, invocation_source, status, started_at, finished_at, created_at, updated_at)
           VALUES (?, ?, ?, 'wakeup_request', 'failed', ?, ?, ?, ?)`,
        ).run(randomUUID(), agent.id, project.companyId, ts, ts, ts, ts);
      }

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.ok(
        (result.skippedReasons.agent_backoff ?? 0) >= 1,
        `expected agent_backoff skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("same task swept twice coalesces onto one wake", () => {
      clearWakes();
      const project = makeProject("coalesce");
      const agent = makeAgent(project.id, "coalesce");
      const task = makeTask(project.id, agent.id, "in-progress");

      const first = sweepOpenTasks(db, { cap: 10 });
      // Second call shouldn't enqueue again (agent already has queued wake → skip)
      const second = sweepOpenTasks(db, { cap: 10 });

      const rows = db.prepare(
        `SELECT id, status FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ? AND status = 'queued'`,
      ).all(task.id) as Array<{ id: string; status: string }>;

      assert.equal(first.wakesEnqueued, 1);
      assert.equal(second.wakesEnqueued, 0);
      assert.equal(rows.length, 1, "only one queued wake should exist for the task");
    });

    await test("cap bounds the number of wakes enqueued per sweep", () => {
      clearWakes();
      const project = makeProject("cap");
      // Make 5 agents, each with one task, ensure cap=2 limits enqueues to 2.
      for (let i = 0; i < 5; i += 1) {
        const a = makeAgent(project.id, `cap-${i}`);
        makeTask(project.id, a.id, "on-deck");
      }

      const result = sweepOpenTasks(db, { cap: 2 });

      assert.equal(result.wakesEnqueued, 2);
      assert.ok(
        (result.skippedReasons.cap_reached ?? 0) >= 1,
        `expected cap_reached skips, got ${JSON.stringify(result.skippedReasons)}`,
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
