/**
 * Contract test for GET /api/factory/status.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/factory-status-route.test.ts
 */

import assert from "node:assert";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "@/app/api/factory/status/route";
import {
  deleteBuildTaskFixtures,
  makeBuildTaskFixture,
  upsertBuildTaskFixture,
} from "@/lib/__tests__/helpers/build-task-fixtures";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { __testHooks, readBuildLog, readTasks, writeBuildLog } from "../build-queue";
import { getDb } from "../tasks-db";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

function makeTask(status: string, overrides: Record<string, unknown> = {}) {
  return makeBuildTaskFixture({
    idPrefix: `test-factory-status-${status}`,
    title: `Factory status ${status}`,
    description: "Fixture task for factory status contract test",
    status,
    priority: "P1",
    type: "feature",
    acceptanceCriteria: ["endpoint status contract is correct"],
    overrides,
  });
}

const upsertTask = upsertBuildTaskFixture;
const deleteTaskFixtures = deleteBuildTaskFixtures;

console.log("\nFactory Status Route Contract Test\n");

const buildLogPath = join(process.cwd(), "data", "build-log.json");
const lockPath = join(process.cwd(), "data", "locks", "factory.lock");
const originalBuildLog = JSON.parse(JSON.stringify(readBuildLog()));
const originalTasks = readTasks();
const fixtureTaskIds: string[] = [];

async function run() {
  try {
    await test("GET returns the required factory status fields with ISO timestamps and no lock holder", async () => {
      const db = getDb();
      db.prepare("DELETE FROM tasks").run();

      writeBuildLog({
        builds: [
          {
            id: "queued-build-fixture",
            taskId: "queued-task-fixture",
            taskTitle: "Queued build fixture",
            project: "mission-control",
            executionKey: "project:mission-control",
            assignedAgent: "backend",
            status: "queued",
            queuedAt: new Date().toISOString(),
            startedAt: null,
            completedAt: null,
            agentType: "codex",
            workDir: process.cwd(),
            source: "test",
            routing: {
              tier: "gpt-5.4",
              modelId: "openai/gpt-5.4",
              modelName: "GPT-5.4",
              reason: "test fixture",
            },
          },
        ],
      });

      try {
        unlinkSync(lockPath);
      } catch {}

      const onDeck = makeTask("to-do");
      const backlog = makeTask("backlog");
      fixtureTaskIds.push(onDeck.id, backlog.id);
      upsertTask(onDeck);
      upsertTask(backlog);

      const lastReconcileAt = Date.now() - 5_000;
      __testHooks.setLastReconcileAt(lastReconcileAt);

      const startedAt = process.hrtime.bigint();
      const response = await GET();
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const payload = await response.json();

      assert.ok(elapsedMs < 100, `expected response under 100ms, got ${elapsedMs.toFixed(2)}ms`);
      assert.strictEqual(response.status, 200);
      assert.match(payload.lastReconcileAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.match(payload.nextScheduledReconcileAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.strictEqual(payload.currentLockHolder, "none");
      assert.strictEqual(payload.queueDepth, 1);
      assert.deepStrictEqual(payload.pendingPromotions, {
        toInProgress: 1,
        toOnDeck: 1,
        total: 2,
      });
      assert.ok(Array.isArray(payload.recentPromotionEvents));
    });

    await test("GET surfaces the active lock holder when the factory lock is held", async () => {
      writeFileSync(lockPath, JSON.stringify({
        holder: "reconcile:test-suite",
        acquiredAt: new Date().toISOString(),
        timestampMs: Date.now(),
      }));

      const response = await GET();
      const payload = await response.json();

      assert.strictEqual(payload.currentLockHolder, "reconcile:test-suite");
    });
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {}
    writeFileSync(buildLogPath, JSON.stringify(originalBuildLog, null, 2));
    const db = getDb();
    db.prepare("DELETE FROM tasks").run();
    for (const task of originalTasks) {
      upsertTask(task);
    }
    deleteTaskFixtures(fixtureTaskIds);
    __testHooks.setLastReconcileAt(0);
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  try {
    unlinkSync(lockPath);
  } catch {}
  writeFileSync(buildLogPath, JSON.stringify(originalBuildLog, null, 2));
  __testHooks.setLastReconcileAt(0);
  process.exit(1);
});
