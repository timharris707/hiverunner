/**
 * Contract test for heartbeat prompt task focus.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-heartbeat-prompt-focus.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-heartbeat-prompt-focus.test.ts
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

console.log("\nOrchestration Heartbeat Prompt Focus Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { buildHeartbeatPrompt, getOrCreateTaskSession } = await import("@/lib/orchestration/engine/engine");

    await test("task-focused wakes center the current task and trim unrelated task detail", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Prompt Focus ${Date.now()}`,
        description: "Prompt focus fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Prompt Focus Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Focused",
        openclawAgentId: `prompt-focus-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const focused = createTask({
        projectId: project.id,
        title: "Fix task-session contamination",
        description: "Focused task description with root cause details.",
        priority: "P1",
        type: "bug",
        status: "in-progress",
        assignee: agent.id,
        labels: ["focus"],
        createdBy: "test-suite",
      }).task;

      createTask({
        projectId: project.id,
        title: "Unrelated secondary task",
        description: "This unrelated description should not be expanded in a task-focused prompt.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: agent.id,
        labels: ["secondary"],
        createdBy: "test-suite",
      });

      const db = getOrchestrationDb();
      const session = getOrCreateTaskSession({
        agentId: agent.id,
        companyId: project.companyId,
        taskKey: focused.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities
           FROM agents WHERE id = ? LIMIT 1`
        ).get(agent.id),
        { wakeSource: "issue_assigned", wakeReason: "user_comment_on_assigned_task" },
        session,
        db,
      );

      assert.match(prompt, /## Current Task Focus/);
      assert.match(prompt, /Fix task-session contamination/);
      assert.match(prompt, /Stay centered on this task/);
      assert.doesNotMatch(prompt, /## All Open Tasks in Company/);
      assert.doesNotMatch(prompt, /Description: This unrelated description should not be expanded/);
      assert.match(prompt, /Unrelated secondary task/);
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
