/**
 * Contract test for stale heartbeat recovery clearing execution truth.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-stale-run-recovery.db
 * npx tsx src/lib/__tests__/orchestration-stale-run-recovery.test.ts
 */

import assert from "node:assert";
import { randomUUID } from "node:crypto";
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

console.log("\nOrchestration Stale Run Recovery Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    await test("tick() times out stale heartbeat runs and clears active execution truth", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const { createProject, createProjectAgent, createTask, listCompanyAgents } = await import("@/lib/orchestration/service");
      const { tick } = await import("@/lib/orchestration/engine/engine");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Stale Recovery ${Date.now()}`,
        description: "Stale recovery fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Recovery Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🛠️",
        role: "Backend Engineer",
        personality: "Reliable",
        openclawAgentId: `recovery-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "working",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Recover stale execution run",
        description: "Disposable stale-run fixture.",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["stale-recovery"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const staleStartedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      const staleRunId = randomUUID();
      const executionRunId = randomUUID();

      db.prepare(
        `UPDATE tasks
         SET execution_mode = 'openclaw', execution_session_id = ?, updated_at = ?
         WHERE id = ?`
      ).run("session-stale-123", new Date().toISOString(), task.id);

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'openclaw', 'running', ?, ?, ?)`
      ).run(executionRunId, task.id, agent.id, staleStartedAt, staleStartedAt, staleStartedAt);

      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, status, started_at, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'running', ?, ?, ?, ?)`
      ).run(
        staleRunId,
        agent.id,
        project.companyId,
        staleStartedAt,
        JSON.stringify({ taskId: task.id, taskStatus: "in_progress" }),
        staleStartedAt,
        staleStartedAt,
      );

      const tickResult = await tick(db);
      assert.strictEqual(tickResult.staleRunsRecovered, 1);
      assert.strictEqual(tickResult.claimed, false);

      const heartbeatRow = db.prepare(
        `SELECT status, error FROM heartbeat_runs WHERE id = ? LIMIT 1`
      ).get(staleRunId) as { status: string; error: string | null } | undefined;
      assert.strictEqual(heartbeatRow?.status, "timed_out");
      assert.match(heartbeatRow?.error ?? "", /Timed out/);

      const execRow = db.prepare(
        `SELECT status, error_message, completed_at FROM execution_runs WHERE id = ? LIMIT 1`
      ).get(executionRunId) as { status: string; error_message: string | null; completed_at: string | null } | undefined;
      assert.strictEqual(execRow?.status, "failed");
      assert.match(execRow?.error_message ?? "", /Timed out/);
      assert.ok(execRow?.completed_at);

      const taskRow = db.prepare(
        `SELECT execution_session_id FROM tasks WHERE id = ? LIMIT 1`
      ).get(task.id) as { execution_session_id: string | null } | undefined;
      assert.strictEqual(taskRow?.execution_session_id, null);

      const refreshedAgent = listCompanyAgents(project.companyId, { includeNonProduction: true }).agents.find((candidate) => candidate.id === agent.id);
      assert.ok(refreshedAgent);
      assert.strictEqual(refreshedAgent?.status, "idle");
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
