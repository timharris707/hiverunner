/**
 * Contract test for paused assignee trigger guards.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-paused-assignee-trigger.db
 * npx tsx src/lib/__tests__/orchestration-paused-assignee-trigger.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { triggerTaskExecution, triggerTaskNudge } from "@/lib/orchestration/execution";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration Paused Assignee Trigger Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalExecutionProvider = process.env.ORCHESTRATION_EXECUTION_PROVIDER;

  try {
    if (dbPath) rmSync(dbPath, { force: true });
    process.env.ORCHESTRATION_EXECUTION_PROVIDER = "openclaw";

    const db = getOrchestrationDb();

    await test("paused assignee blocks execution and assignment nudge wakeups", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Paused Assignee Project ${Date.now()}`,
        description: "Paused assignee fixture",
        color: "#0ea5e9",
        emoji: "P",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Paused Assignee Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "A",
        role: "Backend Engineer",
        personality: "Paused",
        openclawAgentId: "paused-assignee-contract",
        status: "idle",
        skills: [],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Paused assignee trigger test task",
        description: "Paused assignee should not be woken",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "test-suite",
      }).task;

      db.prepare("UPDATE agents SET status = 'paused' WHERE id = ?").run(agent.id);

      const execution = await triggerTaskExecution({ taskId: task.id });
      assert.equal(execution.status, "skipped");
      assert.equal(execution.queued, false);
      assert.equal(execution.reason, "assignee_paused");

      const nudge = await triggerTaskNudge({ taskId: task.id, reason: "test_paused_assignment_nudge" });
      assert.equal(nudge.status, "skipped");
      assert.equal(nudge.queued, false);
      assert.equal(nudge.reason, "assignee_paused");

      const wakeCount = db.prepare(
        `SELECT COUNT(*) AS n FROM agent_wakeup_requests
         WHERE agent_id = ? AND json_extract(payload_json, '$.taskId') = ?`,
      ).get(agent.id, task.id) as { n: number };
      assert.equal(wakeCount.n, 0);
    });
  } finally {
    if (originalExecutionProvider === undefined) {
      delete process.env.ORCHESTRATION_EXECUTION_PROVIDER;
    } else {
      process.env.ORCHESTRATION_EXECUTION_PROVIDER = originalExecutionProvider;
    }
  }
}

run()
  .then(() => {
    console.log(`\nResult: ${passed}/${passed + failed} passed`);
    if (failed > 0) process.exit(1);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
