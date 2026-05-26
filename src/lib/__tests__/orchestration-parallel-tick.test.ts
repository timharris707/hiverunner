/**
 * Contract test for parallel tick claiming.
 *
 * Verifies that a single tick() claim cycle can claim multiple queued
 * heartbeat runs at once — up to MC_TICK_MAX_CONCURRENT, one per agent —
 * so that three simultaneous wakeups for three different agents all
 * advance to 'running' in one tick instead of serializing one-per-tick.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-parallel-tick.db \
 *     node --import ./scripts/register-ts-paths.mjs \
 *     src/lib/__tests__/orchestration-parallel-tick.test.ts
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
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration Parallel Tick Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { enqueueWakeup, __testHooks } = await import("@/lib/orchestration/engine/engine");

    await test("single claim cycle claims runs for 3 different agents concurrently", async () => {
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Parallel Tick ${Date.now()}`,
        description: "Parallel tick fixture",
        color: "#22c55e",
        emoji: "⚡",
        status: "active",
      }).project;

      const agents = [1, 2, 3].map((i) =>
        createProjectAgent({
          projectId: project.id,
          name: `Parallel Agent ${i} ${Math.random().toString(36).slice(2, 6)}`,
          emoji: "🤖",
          role: "Backend Engineer",
          personality: "Independent",
          openclawAgentId: `parallel-agent-${i}-${Math.random().toString(36).slice(2, 8)}`,
          status: "idle",
          skills: ["orchestration"],
        }).agent
      );

      const wakes = agents.map((agent) =>
        enqueueWakeup({
          agentId: agent.id,
          companyId: project.companyId,
          source: "api",
          reason: `parallel-${agent.id.slice(0, 4)}`,
        })
      );

      // All three runs should be queued initially.
      for (const w of wakes) {
        const row = db
          .prepare(`SELECT status FROM heartbeat_runs WHERE id = ?`)
          .get(w.heartbeatRunId) as { status: string } | undefined;
        assert.equal(row?.status, "queued", `wake ${w.heartbeatRunId} should start queued`);
      }

      // One claim cycle should pick up all three (default max is 5).
      const claimed = __testHooks.claimQueuedRunsForTick(db, 5);
      assert.equal(claimed.length, 3, `expected 3 claims, got ${claimed.length}`);

      const claimedAgentIds = new Set(claimed.map((c) => c.agent_id));
      assert.equal(claimedAgentIds.size, 3, "each claim must be for a distinct agent");
      for (const agent of agents) {
        assert.ok(claimedAgentIds.has(agent.id), `agent ${agent.id} should be claimed`);
      }

      // All three heartbeat_runs should now be 'running' in the DB.
      for (const w of wakes) {
        const row = db
          .prepare(`SELECT status FROM heartbeat_runs WHERE id = ?`)
          .get(w.heartbeatRunId) as { status: string } | undefined;
        assert.equal(row?.status, "running", `wake ${w.heartbeatRunId} should be running after claim`);
      }
    });

    await test("claim cycle respects the per-agent running guard across iterations", async () => {
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Per-Agent Guard ${Date.now()}`,
        description: "Per-agent guard fixture",
        color: "#ef4444",
        emoji: "🛑",
        status: "active",
      }).project;

      const busyAgent = createProjectAgent({
        projectId: project.id,
        name: `Busy Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔥",
        role: "Backend Engineer",
        personality: "Busy",
        openclawAgentId: `busy-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const freeAgent = createProjectAgent({
        projectId: project.id,
        name: `Free Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "✨",
        role: "Backend Engineer",
        personality: "Available",
        openclawAgentId: `free-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      // Pre-existing running heartbeat for busyAgent (simulates an in-flight run).
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, status, created_at, updated_at, started_at)
         VALUES ('parallel-busy-fixture', ?, ?, 'wakeup_request', 'running', ?, ?, ?)`
      ).run(busyAgent.id, project.companyId, now, now, now);

      const busyWake = enqueueWakeup({
        agentId: busyAgent.id,
        companyId: project.companyId,
        source: "api",
        reason: "busy-queued",
      });
      const freeWake = enqueueWakeup({
        agentId: freeAgent.id,
        companyId: project.companyId,
        source: "api",
        reason: "free-queued",
      });

      const claimed = __testHooks.claimQueuedRunsForTick(db, 4);
      assert.equal(claimed.length, 1, "only the free agent's run should be claimed");
      assert.equal(claimed[0].agent_id, freeAgent.id, "freeAgent must be the one claimed");

      const busyRow = db
        .prepare(`SELECT status FROM heartbeat_runs WHERE id = ?`)
        .get(busyWake.heartbeatRunId) as { status: string } | undefined;
      const freeRow = db
        .prepare(`SELECT status FROM heartbeat_runs WHERE id = ?`)
        .get(freeWake.heartbeatRunId) as { status: string } | undefined;

      assert.equal(busyRow?.status, "queued", "busyAgent queued run must stay queued while its other run is running");
      assert.equal(freeRow?.status, "running", "freeAgent queued run must advance to running");
    });

    await test("MC_TICK_MAX_CONCURRENT env var caps per-tick claims", async () => {
      const db = getOrchestrationDb();
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Max Concurrent ${Date.now()}`,
        description: "Env cap fixture",
        color: "#8b5cf6",
        emoji: "🎚️",
        status: "active",
      }).project;

      const agents = [1, 2, 3, 4].map((i) =>
        createProjectAgent({
          projectId: project.id,
          name: `Cap Agent ${i} ${Math.random().toString(36).slice(2, 6)}`,
          emoji: "🧪",
          role: "Backend Engineer",
          personality: "Quiet",
          openclawAgentId: `cap-agent-${i}-${Math.random().toString(36).slice(2, 8)}`,
          status: "idle",
          skills: ["orchestration"],
        }).agent
      );

      for (const agent of agents) {
        enqueueWakeup({
          agentId: agent.id,
          companyId: project.companyId,
          source: "api",
          reason: `cap-${agent.id.slice(0, 4)}`,
        });
      }

      const originalCap = process.env.MC_TICK_MAX_CONCURRENT;
      try {
        process.env.MC_TICK_MAX_CONCURRENT = "2";
        assert.equal(__testHooks.getTickMaxConcurrent(), 2);

        const claimed = __testHooks.claimQueuedRunsForTick(db, __testHooks.getTickMaxConcurrent());
        assert.equal(claimed.length, 2, "cap should limit this claim cycle to 2 runs");

        const runningCount = db
          .prepare(`SELECT COUNT(*) AS c FROM heartbeat_runs WHERE status = 'running'`)
          .get() as { c: number };
        assert.equal(runningCount.c, 2);

        const queuedCount = db
          .prepare(`SELECT COUNT(*) AS c FROM heartbeat_runs WHERE status = 'queued'`)
          .get() as { c: number };
        assert.equal(queuedCount.c, 2, "remaining runs stay queued for the next tick");
      } finally {
        if (originalCap === undefined) {
          delete process.env.MC_TICK_MAX_CONCURRENT;
        } else {
          process.env.MC_TICK_MAX_CONCURRENT = originalCap;
        }
      }
    });

    await test("default cap is 5", async () => {
      const originalCap = process.env.MC_TICK_MAX_CONCURRENT;
      try {
        delete process.env.MC_TICK_MAX_CONCURRENT;
        assert.equal(__testHooks.getTickMaxConcurrent(), 5);
      } finally {
        if (originalCap !== undefined) {
          process.env.MC_TICK_MAX_CONCURRENT = originalCap;
        }
      }
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
