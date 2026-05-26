/**
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-operator-comment-render.db
 * npx tsx src/lib/__tests__/orchestration-operator-comment-render.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import {
  createProject,
  createTask,
  createTaskComment,
  listTaskComments,
} from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`  FAIL ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

console.log("\nOperator Comment Render Tests\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) rmSync(dbPath, { force: true });

  await test("mission-control comment authored by sentinel me renders as operator-facing", () => {
    const project = createProject({
      companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
      name: `Operator Comment Project ${Date.now()}`,
      description: "Comment render fixture",
      color: "#0ea5e9",
      emoji: "💬",
      status: "active",
    }).project;
    const task = createTask({
      projectId: project.id,
      title: "Operator comment render task",
      description: "Task with operator-authored comment.",
      priority: "P2",
      type: "research",
      status: "to-do",
      labels: [],
      createdBy: "test-suite",
    }).task;

    createTaskComment({
      taskId: task.id,
      body: "Please discontinue work on this.",
      type: "comment",
      source: "mission_control",
      authorUserId: "me",
    });

    const comments = listTaskComments(task.id).comments;
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.author, "Operator");
    assert.equal(comments[0]?.source, "operator");
    assert.equal(comments[0]?.text, "Please discontinue work on this.");
  });

  if (failed > 0) {
    console.error(`\n${failed} failed, ${passed} passed`);
    process.exit(1);
  }

  console.log(`\n${passed} passed`);
}

void run();
