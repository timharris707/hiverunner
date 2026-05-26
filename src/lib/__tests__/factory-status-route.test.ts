/**
 * Contract test for GET /api/factory/status.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/factory-status-route.test.ts
 */

import assert from "node:assert";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "@/app/api/factory/status/route";
import { __testHooks, readBuildLog, readTasks, writeBuildLog } from "../build-queue";
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
    .catch((error: unknown) => {
      failed++;
      console.error(`  \u2717 ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

function upsertTask(task: Record<string, unknown> & {
  id: string;
  status: string;
  project?: string;
  updated?: string;
  created?: string;
}) {
  const db = getDb();
  const updated = task.updated || task.created || new Date().toISOString();
  db.prepare(`
    INSERT INTO tasks (id, data, status, project, updated)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      data = excluded.data,
      status = excluded.status,
      project = excluded.project,
      updated = excluded.updated
  `).run(task.id, JSON.stringify({ ...task, updated }), task.status, task.project || null, updated);
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

function makeTask(status: string, overrides: Record<string, unknown> = {}) {
  const id = `test-factory-status-${status}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    title: `Factory status ${status}`,
    description: "Fixture task for factory status contract test",
    project: "mission-control",
    status,
    priority: "P1",
    type: "feature",
    acceptance_criteria: ["endpoint status contract is correct"],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    ...overrides,
  };
}

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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
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
