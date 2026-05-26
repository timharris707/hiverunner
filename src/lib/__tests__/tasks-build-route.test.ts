/**
 * Contract test for POST /api/tasks/build.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/tasks-build-route.test.ts
 */

import assert from "node:assert";
import { POST } from "@/app/api/tasks/build/route";
import { readBuildLog, readTasks, writeBuildLog } from "../build-queue";
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

function makeTask(project = "mission-control", overrides: Record<string, unknown> = {}) {
  const id = `test-build-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: "Verify build trigger route",
    description: "Fixture task for POST /api/tasks/build contract test",
    project,
    status: "in-progress",
    priority: "P0",
    type: "bug",
    acceptance_criteria: ["build trigger starts a real process or blocks with an error"],
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

function makeRequest(taskId: string) {
  return {
    async json() {
      return { taskId };
    },
  } as any;
}

console.log("\nTasks Build Route Contract Test\n");

const originalBuildLog = JSON.parse(JSON.stringify(readBuildLog()));
const originalTasks = readTasks();
const fixtureTaskIds: string[] = [];

async function run() {
  const priorStub = process.env.HIVERUNNER_E2E_BUILD_STUB;
  const priorForcedFailure = process.env.HIVERUNNER_E2E_BUILD_FORCE_SPAWN_FAILURE;
  const priorWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const priorPath = process.env.PATH;

  try {
    await test("POST returns a PID and persists running state after a successful spawn", async () => {
      process.env.HIVERUNNER_E2E_BUILD_STUB = "1";
      delete process.env.HIVERUNNER_E2E_BUILD_FORCE_SPAWN_FAILURE;
      delete process.env.WORKSPACE_ROOT;
      writeBuildLog({ builds: [] });

      const task = makeTask();
      fixtureTaskIds.push(task.id);
      upsertTask(task);

      const response = await POST(makeRequest(task.id));
      const payload = await response.json();

      assert.strictEqual(response.status, 200);
      assert.ok([
        "Build agent spawned -> routed to GPT-5.4",
        "Build already active",
      ].includes(String(payload.message)));
      assert.strictEqual(payload.build.taskId, task.id);
      assert.strictEqual(payload.build.status, "running");
      assert.strictEqual(typeof payload.build.pid, "number");
      assert.strictEqual(payload.task.buildState, "running");
      assert.strictEqual(typeof payload.task.buildPid, "number");

      const persistedTask = getTask(task.id);
      assert.strictEqual(persistedTask.buildState, "running");
      assert.strictEqual(typeof persistedTask.buildPid, "number");

      const persistedBuild = readBuildLog().builds.find((entry: any) => entry.id === payload.build.id);
      assert.ok(persistedBuild);
      assert.strictEqual(persistedBuild.status, "running");
      assert.strictEqual(typeof persistedBuild.pid, "number");
    });

    await test("POST blocks the task with a spawn error when builder startup fails", async () => {
      delete process.env.HIVERUNNER_E2E_BUILD_STUB;
      process.env.HIVERUNNER_E2E_BUILD_FORCE_SPAWN_FAILURE = "Forced builder spawn failure for route test";
      writeBuildLog({ builds: [] });

      const task = makeTask();
      fixtureTaskIds.push(task.id);
      upsertTask(task);

      const response = await POST(makeRequest(task.id));
      const payload = await response.json();

      assert.ok([200, 500].includes(response.status));
      assert.strictEqual(payload.task.id, task.id);
      assert.strictEqual(payload.task.status, "blocked");
      assert.ok(String(payload.task.buildError || "").includes("Forced builder spawn failure for route test"));

      const blockedTask = getTask(task.id);
      assert.strictEqual(blockedTask.status, "blocked");
      assert.strictEqual(blockedTask.buildState, "blocked");
      assert.ok(String(blockedTask.blockedReason || "").includes("Forced builder spawn failure for route test"));

      const blockedBuild = readBuildLog().builds.find((entry: any) => entry.taskId === task.id);
      assert.ok(blockedBuild);
      assert.strictEqual(blockedBuild.status, "blocked");
      assert.strictEqual(blockedBuild.pid, null);
      assert.ok(String(blockedBuild.error || "").includes("Forced builder spawn failure for route test"));
    });
  } finally {
    if (priorStub === undefined) {
      delete process.env.HIVERUNNER_E2E_BUILD_STUB;
    } else {
      process.env.HIVERUNNER_E2E_BUILD_STUB = priorStub;
    }

    if (priorForcedFailure === undefined) {
      delete process.env.HIVERUNNER_E2E_BUILD_FORCE_SPAWN_FAILURE;
    } else {
      process.env.HIVERUNNER_E2E_BUILD_FORCE_SPAWN_FAILURE = priorForcedFailure;
    }

    if (priorWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = priorWorkspaceRoot;
    }

    if (priorPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = priorPath;
    }

    writeBuildLog(originalBuildLog);
    const db = getDb();
    db.prepare("DELETE FROM tasks").run();
    for (const task of originalTasks) {
      upsertTask(task);
    }
    deleteTaskFixtures(fixtureTaskIds);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  writeBuildLog(originalBuildLog);
  process.exit(1);
});
