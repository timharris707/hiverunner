import assert from "node:assert/strict";
import { buildTasksByStatus, shouldMirrorTaskIntoReviewColumn, type TaskBoardColumnStatus } from "@/lib/task-board";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error: any) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

const STATUSES: readonly TaskBoardColumnStatus[] = ["backlog", "on-deck", "in-progress", "review", "done"];

console.log("\nTask Board Review Lane Tests\n");

test("keeps active gater reviews visible in the review lane", () => {
  const task = {
    id: "TASK-ACTIVE-REVIEW",
    status: "in-progress" as const,
    updated: "2026-03-30T18:00:00.000Z",
    reviewStatus: "gater-reviewing",
  };

  assert.equal(shouldMirrorTaskIntoReviewColumn(task, Date.parse("2026-03-30T18:05:00.000Z")), true);

  const buckets = buildTasksByStatus([task], STATUSES, Date.parse("2026-03-30T18:05:00.000Z"));
  assert.equal(buckets.review.length, 1);
  assert.equal(buckets.review[0]?.id, task.id);
  assert.equal(buckets["in-progress"].length, 1);
});

test("mirrors recent approvals into review without removing done state", () => {
  const task = {
    id: "TASK-APPROVED",
    status: "done" as const,
    updated: "2026-03-30T18:10:00.000Z",
    reviewStatus: "approved",
    lastReviewVerdict: "APPROVED",
    lastReviewAt: "2026-03-30T18:09:00.000Z",
    reviewCompletedAt: "2026-03-30T18:09:00.000Z",
  };

  const buckets = buildTasksByStatus([task], STATUSES, Date.parse("2026-03-30T18:12:00.000Z"));
  assert.equal(buckets.done.length, 1);
  assert.equal(buckets.review.length, 1);
  assert.equal(buckets.review[0]?.id, task.id);
});

test("mirrors recent rejected verdicts into review without removing in-progress state", () => {
  const task = {
    id: "TASK-REJECTED",
    status: "in-progress" as const,
    updated: "2026-03-30T19:10:00.000Z",
    reviewStatus: "rejected",
    lastReviewVerdict: "NEEDS_FIX",
    lastReviewAt: "2026-03-30T19:09:00.000Z",
  };

  const buckets = buildTasksByStatus([task], STATUSES, Date.parse("2026-03-30T19:12:00.000Z"));
  assert.equal(buckets["in-progress"].length, 1);
  assert.equal(buckets.review.length, 1);
  assert.equal(buckets.review[0]?.id, task.id);
});

test("does not keep stale review verdicts mirrored forever", () => {
  const task = {
    id: "TASK-STALE",
    status: "done" as const,
    updated: "2026-03-27T10:00:00.000Z",
    reviewStatus: "approved",
    lastReviewVerdict: "APPROVED",
    lastReviewAt: "2026-03-27T10:00:00.000Z",
  };

  assert.equal(shouldMirrorTaskIntoReviewColumn(task, Date.parse("2026-03-30T19:12:00.000Z")), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
