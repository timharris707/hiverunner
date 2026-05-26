/**
 * Contract tests for per-agent wake queue hygiene.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-single-active-wake-queue.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-single-active-wake-queue.test.ts
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

console.log("\nOrchestration Single Active Wake Queue Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { enqueueWakeup, __testHooks } = await import("@/lib/orchestration/engine/engine");

    await test("new queued wake supersedes older queued wake for the same agent", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Wake Queue ${Date.now()}`,
        description: "Wake queue fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Queue Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Deterministic",
        openclawAgentId: `queue-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

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
      const requests = db.prepare(
        `SELECT id, status, reason FROM agent_wakeup_requests WHERE agent_id = ? ORDER BY created_at ASC`
      ).all(agent.id) as Array<{ id: string; status: string; reason: string | null }>;

      assert.equal(requests.length, 2);
      assert.deepEqual(
        requests.map((row) => ({ id: row.id, status: row.status, reason: row.reason })),
        [
          { id: first.wakeupRequestId, status: "failed", reason: "first" },
          { id: second.wakeupRequestId, status: "queued", reason: "second" },
        ],
      );
    });

    await test("queue tick does not claim a queued run for an agent that already has a running heartbeat", async () => {
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Single Active ${Date.now()}`,
        description: "Single active fixture",
        color: "#22c55e",
        emoji: "🫀",
        status: "active",
      }).project;

      const agentA = createProjectAgent({
        projectId: project.id,
        name: `Running Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🅰️",
        role: "Backend Engineer",
        personality: "Busy",
        openclawAgentId: `running-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const agentB = createProjectAgent({
        projectId: project.id,
        name: `Free Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🅱️",
        role: "Backend Engineer",
        personality: "Free",
        openclawAgentId: `free-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, status, created_at, updated_at, started_at)
         VALUES ('running-fixture', ?, ?, 'wakeup_request', 'running', ?, ?, ?)`
      ).run(agentA.id, project.companyId, now, now, now);

      const waitingA = enqueueWakeup({
        agentId: agentA.id,
        companyId: project.companyId,
        source: "api",
        reason: "agent-a-queued",
      });
      const waitingB = enqueueWakeup({
        agentId: agentB.id,
        companyId: project.companyId,
        source: "api",
        reason: "agent-b-queued",
      });

      const claimed = __testHooks.claimNextQueuedRun(db);
      assert.equal(claimed?.agent_id, agentB.id);

      const runA = db.prepare(`SELECT status FROM heartbeat_runs WHERE id = ?`).get(waitingA.heartbeatRunId) as { status: string };
      const runB = db.prepare(`SELECT status FROM heartbeat_runs WHERE id = ?`).get(waitingB.heartbeatRunId) as { status: string };

      assert.equal(runA.status, "queued");
      assert.equal(runB.status, "running");
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
