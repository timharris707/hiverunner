import assert from "node:assert";
import { rmSync } from "node:fs";

import {
  createProject,
  createTask,
  createTaskComment,
  listTaskComments,
  listTasks,
} from "@/lib/orchestration/service";

const DEFAULT_COMPANY = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

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

async function run() {
  console.log("\nPaperclip Comment Filter Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const project = createProject({
    companyId: DEFAULT_COMPANY,
    name: `PaperclipFilter ${stamp}`,
    description: "fixture",
    color: "#ef4444",
    emoji: "📎",
    status: "active",
  }).project;

  const task = createTask({
    projectId: project.id,
    title: `Filter fixture ${stamp}`,
    description: "fixture",
    priority: "P2",
    type: "feature",
    status: "on-deck",
    labels: [],
    createdBy: "test",
  }).task;

  createTaskComment({
    taskId: task.id,
    body: "mission_control comment should stay visible",
    type: "comment",
    authorUserId: "test-user",
    source: "mission_control",
  });

  createTaskComment({
    taskId: task.id,
    body: "paperclip-sourced noise that should be hidden",
    type: "comment",
    authorUserId: "paperclip-agent:0000-test",
    source: "paperclip",
    externalRef: "paperclip-fixture-1",
  });

  createTaskComment({
    taskId: task.id,
    body: "openclaw comment should also stay visible",
    type: "comment",
    authorUserId: "test-user",
    source: "openclaw",
  });

  await test("listTaskComments filters out paperclip-sourced rows", () => {
    const { comments } = listTaskComments(task.id);
    const bodies = comments.map((c) => c.text);
    assert.ok(
      bodies.includes("mission_control comment should stay visible"),
      `mission_control comment must be present, got: ${JSON.stringify(bodies)}`
    );
    assert.ok(
      bodies.includes("openclaw comment should also stay visible"),
      `openclaw comment must be present, got: ${JSON.stringify(bodies)}`
    );
    assert.ok(
      !bodies.some((b) => b.includes("paperclip-sourced noise")),
      `paperclip comment must be filtered out, got: ${JSON.stringify(bodies)}`
    );
    assert.strictEqual(
      comments.length,
      2,
      `expected 2 comments after filtering, got: ${comments.length}`
    );
  });

  await test("listTasks comment bundle also excludes paperclip rows", () => {
    const { tasks } = listTasks({ projectId: project.id, includeNonProduction: true });
    const reloaded = tasks.find((t) => t.id === task.id);
    assert.ok(reloaded, "task must be listed");
    const commentBodies = (reloaded!.comments ?? []).map((c) => c.text);
    assert.ok(
      !commentBodies.some((b) => b.includes("paperclip-sourced noise")),
      `listTasks must not surface paperclip comments, got: ${JSON.stringify(commentBodies)}`
    );
  });

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
