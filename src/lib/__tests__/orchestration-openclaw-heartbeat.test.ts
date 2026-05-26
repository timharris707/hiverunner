/**
 * Contract tests for OpenClaw cron-driven agent heartbeat behavior.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-openclaw-heartbeat.db
 * npx tsx src/lib/__tests__/orchestration-openclaw-heartbeat.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";

import {
  createProject,
  createProjectAgent,
  createTask,
  heartbeatProjectAgent,
  listTaskComments,
} from "@/lib/orchestration/service";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createIsolatedOrchestrationWorkspace } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";

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

function createFixture() {
  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `OpenClaw Heartbeat Project ${Date.now()}`,
    description: "Heartbeat fixture",
    color: "#0ea5e9",
    emoji: "🫀",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Heartbeat Agent ${Math.random().toString(36).slice(2, 8)}`,
    emoji: "🔧",
    role: "Backend Engineer",
    personality: "Reliable",
    openclawAgentId: `forge-openclaw-heartbeat-${Math.random().toString(36).slice(2, 8)}`,
    status: "idle",
    skills: ["api", "orchestration"],
  }).agent;

  const task = createTask({
    projectId: project.id,
    title: "Heartbeat fixture task",
    description: "Task for heartbeat task-link validation.",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: ["orchestration"],
    createdBy: "test-suite",
  }).task;

  return { project, agent, task };
}

console.log("\nOrchestration OpenClaw Heartbeat Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const workspaceIsolation = createIsolatedOrchestrationWorkspace({
    prefix: "mc-openclaw-heartbeat-",
  });
  try {
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
    workspaceIsolation.syncDatabase(getOrchestrationDb());

    await test("Heartbeat updates agent lastHeartbeat, status, current task, and runtime", () => {
      const fixture = createFixture();
      const observedAt = "2026-04-01T14:10:00.000Z";

      const result = heartbeatProjectAgent({
        agentId: fixture.agent.id,
        source: "openclaw",
        observedAt,
        status: "working",
        currentTaskId: fixture.task.id,
        runtimeMinutesDelta: 7,
      });

      assert.strictEqual(result.agent.id, fixture.agent.id);
      assert.strictEqual(result.agent.status, "working");
      assert.strictEqual(result.agent.currentTask, fixture.task.title);
      assert.strictEqual(result.agent.lastHeartbeat, observedAt);
      assert.strictEqual(result.agent.totalRuntimeMinutes, 7);
      assert.strictEqual(result.heartbeat.source, "openclaw");
      assert.strictEqual(result.heartbeat.runtimeMinutesDelta, 7);
      assert.strictEqual(result.heartbeat.observedAt, observedAt);
    });

    await test("Heartbeat preserves current task when currentTaskId is omitted", () => {
      const fixture = createFixture();
      heartbeatProjectAgent({
        agentId: fixture.agent.id,
        status: "working",
        currentTaskId: fixture.task.id,
        runtimeMinutesDelta: 2,
      });

      const second = heartbeatProjectAgent({
        agentId: fixture.agent.id,
        source: "cron",
        runtimeMinutesDelta: 3,
      });

      assert.strictEqual(second.agent.currentTask, fixture.task.title);
      assert.strictEqual(second.agent.totalRuntimeMinutes, 5);
      assert.strictEqual(second.agent.status, "working");
    });

    await test("OpenClaw heartbeat can acknowledge progress on the current task", () => {
      const fixture = createFixture();
      const observedAt = "2026-04-08T23:59:00.000Z";

      const result = heartbeatProjectAgent({
        agentId: fixture.agent.id,
        source: "openclaw",
        status: "working",
        currentTaskId: fixture.task.id,
        observedAt,
        progressComment: "Acknowledged heartbeat proof task and marked execution progress.",
      });

      assert.strictEqual(result.agent.currentTask, fixture.task.title);

      const comments = listTaskComments(fixture.task.id).comments;
      assert.strictEqual(comments.length, 1);
      assert.match(comments[0]?.text ?? "", /Acknowledged heartbeat proof task/);
      assert.strictEqual(comments[0]?.author, fixture.agent.name);
      assert.strictEqual(comments[0]?.timestamp, observedAt);
    });

    await test("Heartbeat rejects task outside agent project", () => {
      const fixtureA = createFixture();
      const fixtureB = createFixture();

      assert.throws(
        () =>
          heartbeatProjectAgent({
            agentId: fixtureA.agent.id,
            currentTaskId: fixtureB.task.id,
          }),
        (error: unknown) =>
          error instanceof OrchestrationApiError &&
          error.status === 400 &&
          error.code === "invalid_current_task"
      );
    });
  } finally {
    if (dbPath) {
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    }
    workspaceIsolation.dispose();
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
