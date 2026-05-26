/**
 * Contract test for task-bound wake context preferring contextSnapshot.taskId.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-resolve-taskid-context.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-resolve-taskid-context.test.ts
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

console.log("\nOrchestration taskId Context Resolution Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { buildHeartbeatPrompt, getOrCreateTaskSession } = await import("@/lib/orchestration/engine/engine");

    await test("taskId in wake context takes precedence over unrelated active task fallback", async () => {
      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `taskId resolution ${Date.now()}`,
        description: "taskId resolution fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `taskId Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Precise",
        openclawAgentId: `taskid-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const targetTask = createTask({
        projectId: project.id,
        title: "Target task from context",
        description: "This is the task the wake explicitly asked for.",
        priority: "P2",
        type: "bug",
        status: "in-progress",
        assignee: agent.id,
        labels: ["target"],
        createdBy: "test-suite",
      }).task;

      createTask({
        projectId: project.id,
        title: "Higher priority fallback task",
        description: "If taskId is ignored, the engine will incorrectly pick this one.",
        priority: "P1",
        type: "bug",
        status: "in-progress",
        assignee: agent.id,
        labels: ["fallback"],
        createdBy: "test-suite",
      });

      const db = getOrchestrationDb();
      const session = getOrCreateTaskSession({
        agentId: agent.id,
        companyId: project.companyId,
        taskKey: targetTask.id,
      }, db);

      const prompt = buildHeartbeatPrompt(
        db.prepare(
          `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
                  adapter_config_json, runtime_config_json, capabilities
           FROM agents WHERE id = ? LIMIT 1`
        ).get(agent.id),
        { taskId: targetTask.id, wakeSource: "api", wakeReason: "user_comment_on_assigned_task" },
        session,
        db,
      );

      assert.match(prompt, /Target task from context/);
      assert.doesNotMatch(prompt, /Higher priority fallback task[\s\S]*Project:/);
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
