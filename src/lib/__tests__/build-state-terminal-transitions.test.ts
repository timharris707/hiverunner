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
  writeBuildLog,
} from "../build-queue";
import {
  type BuildTaskFixture,
  deleteBuildTaskFixtures,
  getBuildTaskFixture,
  makeBuildTaskFixture,
  upsertBuildTaskFixture,
} from "@/lib/__tests__/helpers/build-task-fixtures";
import { restoreEnvSnapshot, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

type BuildLogEntry = {
  id?: string;
  taskId?: string;
  status?: string;
  pid?: number | null;
  error?: string | null;
  [key: string]: unknown;
};

function makeTask(overrides: Record<string, unknown> = {}): BuildTaskFixture {
  return makeBuildTaskFixture({
    idPrefix: "test-build-state",
    title: "Verify buildState transitions",
    description: "Fixture task for queue lifecycle tests",
    priority: "P1",
    type: "feature",
    acceptanceCriteria: ["buildState transitions are persisted correctly"],
    overrides,
  });
}

const upsertTask = upsertBuildTaskFixture;
const deleteTaskFixtures = deleteBuildTaskFixtures;
const getTask = getBuildTaskFixture;

console.log("\nBuild State Terminal Transition Tests\n");

const PROJECT_META_ENV = ["WORKSPACE_ROOT", "MC_APP_ROOT"] as const;
const BUILD_STUB_ENV = ["HIVERUNNER_E2E_BUILD_STUB"] as const;
const originalBuildLog = JSON.parse(JSON.stringify(readBuildLog()));
const fixtureTaskIds: string[] = [];

function upsertTrackedTask(task: BuildTaskFixture) {
  fixtureTaskIds.push(task.id);
  upsertTask(task);
  return task;
}

function makeBuildLogEntry(task: BuildTaskFixture, overrides: BuildLogEntry): BuildLogEntry {
  return {
    id: overrides.id,
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
    ...overrides,
  };
}

function writeSingleBuild(task: BuildTaskFixture, overrides: BuildLogEntry) {
  const build = makeBuildLogEntry(task, overrides);
  writeBuildLog({ builds: [build] });
  return build;
}

async function run() {
  try {
    await test("projectDir resolves back to MC_APP_ROOT for legacy mission-control tasks when WORKSPACE_ROOT is unset", async () => {
      const envSnapshot = snapshotEnv(PROJECT_META_ENV);
      delete process.env.WORKSPACE_ROOT;
      process.env.MC_APP_ROOT = "/tmp/live-mission-control-app";

      try {
        const meta = __testHooks.getProjectMeta(makeTask({ project: "mission-control" }));
        assert.strictEqual(meta.projectDir, "/tmp/live-mission-control-app/projects/hiverunner");
      } finally {
        restoreEnvSnapshot(envSnapshot);
      }
    });

    await test("legacy mission-control tasks ignore nearby retired clones when MC_APP_ROOT is set", async () => {
      const envSnapshot = snapshotEnv(PROJECT_META_ENV);
      process.env.WORKSPACE_ROOT = "/Users/timharris/.openclaw/workspace";
      process.env.MC_APP_ROOT = "/Users/timharris/.mission-control/app";

      try {
        const meta = __testHooks.getProjectMeta(makeTask({ project: "mission-control-orchestration" }));
        assert.strictEqual(meta.projectDir, "/Users/timharris/.mission-control/app/projects/hiverunner");
      } finally {
        restoreEnvSnapshot(envSnapshot);
      }
    });

    await test("buildState is set on build start and updated while running", async () => {
      writeBuildLog({ builds: [] });

      const task = upsertTrackedTask(makeTask());

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

      const runningBuild = (readBuildLog().builds as BuildLogEntry[]).find((entry) => entry.id === decision.build.id);
      assert.ok(runningBuild);
      assert.strictEqual(runningBuild.status, "running");
      assert.strictEqual(runningBuild.pid, 42424);
    });

    await test("spawn failures move the task to blocked with the spawn error", async () => {
      const task = upsertTrackedTask(makeTask({
        buildState: "spawning",
        activeBuildId: "spawn-failed-build",
      }));
      writeSingleBuild(task, { id: "spawn-failed-build" });

      await __testHooks.blockTaskForSpawnFailure("spawn-failed-build", task.id, "spawn ENOENT codex");

      const blockedTask = getTask(task.id);
      assert.strictEqual(blockedTask.status, "blocked");
      assert.strictEqual(blockedTask.buildState, "blocked");
      assert.ok(String(blockedTask.buildError || "").includes("spawn ENOENT codex"));
      assert.ok(String(blockedTask.blockedReason || "").includes("spawn ENOENT codex"));
      assert.ok(!blockedTask.activeBuildId);
      assert.ok(!blockedTask.buildPid);

      const blockedBuild = (readBuildLog().builds as BuildLogEntry[]).find((entry) => entry.id === "spawn-failed-build");
      assert.ok(blockedBuild);
      assert.strictEqual(blockedBuild.status, "blocked");
      assert.strictEqual(blockedBuild.pid, null);
      assert.ok(String(blockedBuild.error || "").includes("spawn ENOENT codex"));
    });

    await test("spawnBuildProcess returns only after a real builder PID exists", async () => {
      writeBuildLog({ builds: [] });

      const envSnapshot = snapshotEnv(BUILD_STUB_ENV);
      process.env.HIVERUNNER_E2E_BUILD_STUB = "1";

      try {
        const task = upsertTrackedTask(makeTask({
          status: "done",
          buildState: "spawning",
          activeBuildId: "stubbed-spawn-build",
        }));
        const build = writeSingleBuild(task, { id: "stubbed-spawn-build" });

        const result = await __testHooks.spawnBuildProcess(
          task,
          build,
          "mission-control",
          process.cwd(),
        );
        assert.strictEqual(typeof result?.pid, "number");

        const runningTask = getTask(task.id);
        assert.strictEqual(runningTask.buildState, "running");
        assert.strictEqual(typeof runningTask.buildPid, "number");

        const runningBuild = (readBuildLog().builds as BuildLogEntry[]).find((entry) => entry.id === "stubbed-spawn-build");
        assert.ok(runningBuild);
        assert.strictEqual(runningBuild.status, "running");
        assert.strictEqual(typeof runningBuild.pid, "number");
      } finally {
        restoreEnvSnapshot(envSnapshot);
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
      const envSnapshot = snapshotEnv(BUILD_STUB_ENV);
      process.env.HIVERUNNER_E2E_BUILD_STUB = "1";

      try {
        const task = upsertTrackedTask(makeTask({
          buildState: "spawning",
          activeBuildId: "stale-build-entry",
          buildTriggeredAt: new Date(Date.now() - 30_000).toISOString(),
        }));
        writeSingleBuild(task, {
          id: "stale-build-entry",
          executionKey: "project:mission-control",
          startedAt: new Date(Date.now() - 30_000).toISOString(),
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

        const builds = readBuildLog().builds as BuildLogEntry[];
        const staleBuild = builds.find((entry) => entry.id === "stale-build-entry");
        assert.ok(staleBuild);
        assert.strictEqual(staleBuild.status, "failed");
        assert.strictEqual(staleBuild.pid, null);
        assert.ok(String(staleBuild.error || "").includes("Builder process missing"));

        const runningBuild = builds.find((entry) => entry.id === startedResult.build.id);
        assert.ok(runningBuild);
        assert.strictEqual(runningBuild.status, "running");
        assert.strictEqual(typeof runningBuild.pid, "number");

        const runningTask = getTask(task.id);
        assert.strictEqual(runningTask.buildState, "running");
        assert.strictEqual(runningTask.activeBuildId, startedResult.build.id);
        assert.strictEqual(typeof runningTask.buildPid, "number");
      } finally {
        restoreEnvSnapshot(envSnapshot);
      }
    });

    await test("buildState becomes completed and transient build tracking clears when task reaches done", async () => {
      const task = upsertTrackedTask(makeTask({
        status: "review",
        buildState: "running",
        activeBuildId: "gater-approved-build",
        buildQueuedAt: new Date().toISOString(),
        buildStartedAt: new Date().toISOString(),
      }));
      writeSingleBuild(task, {
        id: "gater-approved-build",
        executionKey: `${task.id}:review`,
        status: "running",
        agentType: "gater-qa",
        routing: { tier: "sonnet", modelId: "test", modelName: "Test", reason: "test" },
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
      const task = upsertTrackedTask(makeTask({
        status: "review",
        buildState: "running",
        activeBuildId: "gater-blocked-build",
        buildQueuedAt: new Date().toISOString(),
        buildStartedAt: new Date().toISOString(),
      }));
      writeSingleBuild(task, {
        id: "gater-blocked-build",
        executionKey: `${task.id}:review`,
        status: "running",
        agentType: "gater-qa",
        routing: { tier: "sonnet", modelId: "test", modelName: "Test", reason: "test" },
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

  finish();
}

run().catch((error) => {
  console.error(error);
  writeBuildLog(originalBuildLog);
  deleteTaskFixtures(fixtureTaskIds);
  process.exit(1);
});
