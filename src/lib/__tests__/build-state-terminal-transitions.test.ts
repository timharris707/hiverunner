/**
 * Queue lifecycle tests for buildState terminal transitions.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/build-state-terminal-transitions.test.ts
 */

import assert from "node:assert";
import { execFile } from "node:child_process";
import {
  __testHooks,
  queueOrStartBuild,
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
    await test("projectDir resolves back to MC_APP_ROOT for legacy mission-control tasks when WORKSPACE_ROOT is unset", async () => {
      const priorWorkspaceRoot = process.env.WORKSPACE_ROOT;
      const priorAppRoot = process.env.MC_APP_ROOT;
      delete process.env.WORKSPACE_ROOT;
      process.env.MC_APP_ROOT = "/tmp/live-mission-control-app";

      try {
        const meta = __testHooks.getProjectMeta(makeTask({ project: "mission-control" }));
        assert.strictEqual(meta.projectDir, "/tmp/live-mission-control-app/projects/hiverunner");
      } finally {
        if (priorWorkspaceRoot === undefined) {
          delete process.env.WORKSPACE_ROOT;
        } else {
          process.env.WORKSPACE_ROOT = priorWorkspaceRoot;
        }
        if (priorAppRoot === undefined) {
          delete process.env.MC_APP_ROOT;
        } else {
          process.env.MC_APP_ROOT = priorAppRoot;
        }
      }
    });

    await test("legacy mission-control tasks ignore nearby retired clones when MC_APP_ROOT is set", async () => {
      const priorWorkspaceRoot = process.env.WORKSPACE_ROOT;
      const priorAppRoot = process.env.MC_APP_ROOT;
      process.env.WORKSPACE_ROOT = "/Users/timharris/.openclaw/workspace";
      process.env.MC_APP_ROOT = "/Users/timharris/.mission-control/app";

      try {
        const meta = __testHooks.getProjectMeta(makeTask({ project: "mission-control-orchestration" }));
        assert.strictEqual(meta.projectDir, "/Users/timharris/.mission-control/app/projects/hiverunner");
      } finally {
        if (priorWorkspaceRoot === undefined) {
          delete process.env.WORKSPACE_ROOT;
        } else {
          process.env.WORKSPACE_ROOT = priorWorkspaceRoot;
        }
        if (priorAppRoot === undefined) {
          delete process.env.MC_APP_ROOT;
        } else {
          process.env.MC_APP_ROOT = priorAppRoot;
        }
      }
    });

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

      await __testHooks.updateRunningState(decision.build.id, task.id, 42424);

      const runningTask = getTask(task.id);
      assert.strictEqual(runningTask.buildState, "running");
      assert.ok(runningTask.buildStartedAt);
      assert.strictEqual(runningTask.buildPid, 42424);

      const runningBuild = readBuildLog().builds.find((entry: any) => entry.id === decision.build.id);
      assert.ok(runningBuild);
      assert.strictEqual(runningBuild.status, "running");
      assert.strictEqual(runningBuild.pid, 42424);
    });

    await test("spawn failures move the task to blocked with the spawn error", async () => {
      const task = makeTask({
        buildState: "spawning",
        activeBuildId: "spawn-failed-build",
      });
      fixtureTaskIds.push(task.id);
      upsertTask(task);
      writeBuildLog({
        builds: [
          {
            id: "spawn-failed-build",
            taskId: task.id,
            taskTitle: task.title,
            project: task.project,
            executionKey: `${task.id}:spawn`,
            status: "spawning",
            queuedAt: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            agentType: "codex",
            workDir: process.cwd(),
            source: "test",
            routing: { tier: "gpt-5.4", modelId: "test", modelName: "Test", reason: "test" },
          },
        ],
      });

      await __testHooks.blockTaskForSpawnFailure("spawn-failed-build", task.id, "spawn ENOENT codex");

      const blockedTask = getTask(task.id);
      assert.strictEqual(blockedTask.status, "blocked");
      assert.strictEqual(blockedTask.buildState, "blocked");
      assert.ok(String(blockedTask.buildError || "").includes("spawn ENOENT codex"));
      assert.ok(String(blockedTask.blockedReason || "").includes("spawn ENOENT codex"));
      assert.ok(!blockedTask.activeBuildId);
      assert.ok(!blockedTask.buildPid);

      const blockedBuild = readBuildLog().builds.find((entry: any) => entry.id === "spawn-failed-build");
      assert.ok(blockedBuild);
      assert.strictEqual(blockedBuild.status, "blocked");
      assert.strictEqual(blockedBuild.pid, null);
      assert.ok(String(blockedBuild.error || "").includes("spawn ENOENT codex"));
    });

    await test("spawnBuildProcess returns only after a real builder PID exists", async () => {
      writeBuildLog({ builds: [] });

      const priorStub = process.env.HIVERUNNER_E2E_BUILD_STUB;
      process.env.HIVERUNNER_E2E_BUILD_STUB = "1";

      try {
        const task = makeTask({
          status: "done",
          buildState: "spawning",
          activeBuildId: "stubbed-spawn-build",
        });
        fixtureTaskIds.push(task.id);
        upsertTask(task);
        writeBuildLog({
          builds: [
            {
              id: "stubbed-spawn-build",
              taskId: task.id,
              taskTitle: task.title,
              project: task.project,
              executionKey: `${task.id}:spawn`,
              status: "spawning",
              queuedAt: null,
              startedAt: new Date().toISOString(),
              completedAt: null,
              agentType: "codex",
              workDir: process.cwd(),
              source: "test",
              routing: { tier: "gpt-5.4", modelId: "test", modelName: "Test", reason: "test" },
            },
          ],
        });

        const result = await __testHooks.spawnBuildProcess(
          task,
          readBuildLog().builds[0],
          "mission-control",
          process.cwd(),
        );
        assert.strictEqual(typeof result?.pid, "number");

        const runningTask = getTask(task.id);
        assert.strictEqual(runningTask.buildState, "running");
        assert.strictEqual(typeof runningTask.buildPid, "number");

        const runningBuild = readBuildLog().builds.find((entry: any) => entry.id === "stubbed-spawn-build");
        assert.ok(runningBuild);
        assert.strictEqual(runningBuild.status, "running");
        assert.strictEqual(typeof runningBuild.pid, "number");
      } finally {
        if (priorStub === undefined) {
          delete process.env.HIVERUNNER_E2E_BUILD_STUB;
        } else {
          process.env.HIVERUNNER_E2E_BUILD_STUB = priorStub;
        }
      }
    });

    await test("spawn verifier rejects processes that die immediately after spawn", async () => {
      const liveChild = execFile(process.execPath, ["-e", "setTimeout(() => process.exit(0), 1500)"]);
      await new Promise<void>((resolve, reject) => {
        liveChild.once("spawn", () => resolve());
        liveChild.once("error", reject);
      });
      assert.strictEqual(await __testHooks.verifySpawnedProcess(liveChild.pid, 50), true);
      liveChild.kill("SIGTERM");

      const shortLivedChild = execFile(process.execPath, ["-e", "process.exit(0)"]);
      await new Promise<void>((resolve, reject) => {
        shortLivedChild.once("spawn", () => resolve());
        shortLivedChild.once("error", reject);
      });
      assert.strictEqual(await __testHooks.verifySpawnedProcess(shortLivedChild.pid, 50), false);
    });

    await test("queueOrStartBuild reclaims stale spawning entries that never produced a live PID", async () => {
      const priorStub = process.env.HIVERUNNER_E2E_BUILD_STUB;
      process.env.HIVERUNNER_E2E_BUILD_STUB = "1";

      try {
        const task = makeTask({
          buildState: "spawning",
          activeBuildId: "stale-build-entry",
          buildTriggeredAt: new Date(Date.now() - 30_000).toISOString(),
        });
        fixtureTaskIds.push(task.id);
        upsertTask(task);

        writeBuildLog({
          builds: [
            {
              id: "stale-build-entry",
              taskId: task.id,
              taskTitle: task.title,
              project: task.project,
              executionKey: "project:mission-control",
              status: "spawning",
              queuedAt: null,
              startedAt: new Date(Date.now() - 30_000).toISOString(),
              completedAt: null,
              agentType: "codex",
              workDir: process.cwd(),
              source: "test",
              routing: { tier: "gpt-5.4", modelId: "test", modelName: "Test", reason: "test" },
            },
          ],
        });

        const result = await queueOrStartBuild(task.id, { source: "test-reclaim-stale-spawn" });
        assert.strictEqual(result.kind, "started");
        if (result.kind !== "started") {
          throw new Error(`expected started result, received ${result.kind}`);
        }
        const startedResult = result as typeof result & { spawn?: { pid?: number | null } };
        assert.notStrictEqual(startedResult.build.id, "stale-build-entry");
        assert.strictEqual(typeof startedResult.spawn?.pid, "number");
        assert.strictEqual(startedResult.build.status, "running");
        assert.strictEqual(typeof startedResult.build.pid, "number");
        assert.strictEqual(startedResult.task.buildState, "running");
        assert.strictEqual(typeof startedResult.task.buildPid, "number");

        const builds = readBuildLog().builds;
        const staleBuild = builds.find((entry: any) => entry.id === "stale-build-entry");
        assert.ok(staleBuild);
        assert.strictEqual(staleBuild.status, "failed");
        assert.strictEqual(staleBuild.pid, null);
        assert.ok(String(staleBuild.error || "").includes("Builder process missing"));

        const runningBuild = builds.find((entry: any) => entry.id === startedResult.build.id);
        assert.ok(runningBuild);
        assert.strictEqual(runningBuild.status, "running");
        assert.strictEqual(typeof runningBuild.pid, "number");

        const runningTask = getTask(task.id);
        assert.strictEqual(runningTask.buildState, "running");
        assert.strictEqual(runningTask.activeBuildId, startedResult.build.id);
        assert.strictEqual(typeof runningTask.buildPid, "number");
      } finally {
        if (priorStub === undefined) {
          delete process.env.HIVERUNNER_E2E_BUILD_STUB;
        } else {
          process.env.HIVERUNNER_E2E_BUILD_STUB = priorStub;
        }
      }
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
