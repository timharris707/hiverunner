/**
 * Contract test for POST /api/tasks/build.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/tasks-build-route.test.ts
 */

import assert from "node:assert";
import { POST } from "@/app/api/tasks/build/route";
import {
  type BuildTaskFixture,
  deleteBuildTaskFixtures,
  getBuildTaskFixture,
  makeBuildTaskFixture,
  upsertBuildTaskFixture,
} from "@/lib/__tests__/helpers/build-task-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { readBuildLog, readTasks, writeBuildLog } from "../build-queue";
import { getDb } from "../tasks-db";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

type BuildLogEntry = {
  id?: string;
  taskId?: string;
  status?: string;
  pid?: number | null;
  error?: string | null;
  [key: string]: unknown;
};

function makeTask(project = "mission-control", overrides: Record<string, unknown> = {}): BuildTaskFixture {
  return makeBuildTaskFixture({
    idPrefix: "test-build-route",
    title: "Verify build trigger route",
    description: "Fixture task for POST /api/tasks/build contract test",
    project,
    priority: "P0",
    type: "bug",
    acceptanceCriteria: ["build trigger starts a real process or blocks with an error"],
    overrides,
  });
}

const upsertTask = upsertBuildTaskFixture;
const deleteTaskFixtures = deleteBuildTaskFixtures;
const getTask = getBuildTaskFixture;

function makeRequest(taskId: string) {
  return {
    async json() {
      return { taskId };
    },
  } as unknown as Parameters<typeof POST>[0];
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

      const persistedBuild = (readBuildLog().builds as BuildLogEntry[]).find((entry) => entry.id === payload.build.id);
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

      const blockedBuild = (readBuildLog().builds as BuildLogEntry[]).find((entry) => entry.taskId === task.id);
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

  finish();
}

run().catch((error) => {
  console.error(error);
  writeBuildLog(originalBuildLog);
  process.exit(1);
});
