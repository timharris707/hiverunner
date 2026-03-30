/**
 * Queue lifecycle tests for buildState terminal transitions.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/build-state-terminal-transitions.test.ts
 */

import assert from "node:assert";
import {
  __testHooks,
  readBuildLog,
  readTasks,
  writeBuildLog,
} from "../build-queue";
import { getDb } from "../tasks-db";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: any) => {
      failed++;
      console.error(`  \u2717 ${name}`);
      console.error(`    ${error?.message || String(error)}`);
    });
}

function makeTask(overrides: Record<string, unknown> = {}) {
  const id = `test-build-state-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: "Verify buildState transitions",
    description: "Fixture task for queue lifecycle tests",
    project: "mission-control",
    status: "in-progress",
    priority: "P1",
    type: "feature",
    acceptance_criteria: ["buildState transitions are persisted correctly"],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...overrides,
  };
}

function upsertTask(task: any) {
  const db = getDb();
  db.prepare(`
    INSERT INTO tasks (id, data, status, project, updated)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      status = excluded.status,
      project = excluded.project,
      updated = excluded.updated
  `).run(task.id, JSON.stringify(task), task.status, task.project || null, task.updated);
}

function deleteTaskFixtures(ids: string[]) {
  if (ids.length === 0) return;
  const db = getDb();
  const deleteTask = db.prepare("DELETE FROM tasks WHERE id = ?");
  const deleteTransitions = db.prepare("DELETE FROM task_transitions WHERE task_id = ?");
  for (const id of ids) {
    deleteTransitions.run(id);
    deleteTask.run(id);
  }
}

function getTask(id: string) {
  const task = readTasks().find((entry: any) => entry.id === id);
  assert.ok(task, `expected task ${id} to exist`);
  return task;
}

console.log("\nBuild State Terminal Transition Tests\n");

const originalBuildLog = JSON.parse(JSON.stringify(readBuildLog()));
const fixtureTaskIds: string[] = [];

async function run() {
  try {
    await test("buildState is set on build start and updated while running", async () => {
      writeBuildLog({ builds: [] });

      const task = makeTask();
      fixtureTaskIds.push(task.id);
      upsertTask(task);

      const decision = await __testHooks.queueOrStartBuildDecision(task.id, { source: "test" });
      assert.strictEqual(decision.kind, "started");

      const startedTask = getTask(task.id);
      assert.strictEqual(startedTask.buildState, "spawning");
      assert.strictEqual(startedTask.activeBuildId, decision.build.id);

      await __testHooks.updateRunningState(decision.build.id, task.id);

      const runningTask = getTask(task.id);
      assert.strictEqual(runningTask.buildState, "running");
      assert.ok(runningTask.buildStartedAt);
    });

    await test("buildState becomes completed and transient build tracking clears when task reaches done", async () => {
      const task = makeTask({
        status: "review",
        buildState: "running",
        activeBuildId: "gater-approved-build",
        buildQueuedAt: new Date().toISOString(),
        buildStartedAt: new Date().toISOString(),
      });
      fixtureTaskIds.push(task.id);
      upsertTask(task);
      writeBuildLog({
        builds: [
          {
            id: "gater-approved-build",
            taskId: task.id,
            taskTitle: task.title,
            project: task.project,
            executionKey: `${task.id}:review`,
            status: "running",
            queuedAt: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            agentType: "gater-qa",
            workDir: process.cwd(),
            source: "test",
            routing: { tier: "sonnet", modelId: "test", modelName: "Test", reason: "test" },
          },
        ],
      });

      await __testHooks.finalizeGaterQA("gater-approved-build", task.id, true, "VERDICT: APPROVED\nLooks good.");

      const completedTask = getTask(task.id);
      assert.strictEqual(completedTask.status, "done");
      assert.strictEqual(completedTask.buildState, "completed");
      assert.ok(completedTask.buildCompletedAt);
      assert.ok(!completedTask.activeBuildId);
      assert.ok(!completedTask.buildQueuedAt);
      assert.ok(!completedTask.buildStartedAt);
    });

    await test("buildState becomes blocked and transient build tracking clears when task reaches blocked", async () => {
      const task = makeTask({
        status: "review",
        buildState: "running",
        activeBuildId: "gater-blocked-build",
        buildQueuedAt: new Date().toISOString(),
        buildStartedAt: new Date().toISOString(),
      });
      fixtureTaskIds.push(task.id);
      upsertTask(task);
      writeBuildLog({
        builds: [
          {
            id: "gater-blocked-build",
            taskId: task.id,
            taskTitle: task.title,
            project: task.project,
            executionKey: `${task.id}:review`,
            status: "running",
            queuedAt: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            agentType: "gater-qa",
            workDir: process.cwd(),
            source: "test",
            routing: { tier: "sonnet", modelId: "test", modelName: "Test", reason: "test" },
          },
        ],
      });

      await __testHooks.finalizeGaterQA(
        "gater-blocked-build",
        task.id,
        true,
        "VERDICT: BLOCKED\nBLOCKED: Safari verification unavailable"
      );

      const blockedTask = getTask(task.id);
      assert.strictEqual(blockedTask.status, "blocked");
      assert.strictEqual(blockedTask.buildState, "blocked");
      assert.ok(blockedTask.buildCompletedAt);
      assert.ok(!blockedTask.activeBuildId);
      assert.ok(!blockedTask.buildQueuedAt);
      assert.ok(!blockedTask.buildStartedAt);
    });
  } finally {
    writeBuildLog(originalBuildLog);
    deleteTaskFixtures(fixtureTaskIds);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  writeBuildLog(originalBuildLog);
  deleteTaskFixtures(fixtureTaskIds);
  process.exit(1);
});
