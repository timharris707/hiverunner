import assert from "node:assert/strict";
import { buildTasksByStatus, type TaskBoardColumnStatus } from "@/lib/task-board";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

const STATUSES: readonly TaskBoardColumnStatus[] = ["backlog", "to-do", "in-progress", "review", "done"];
const ALL_STATUSES: readonly TaskBoardColumnStatus[] = ["backlog", "to-do", "in-progress", "review", "blocked", "done"];

console.log("\nTask Board Review Lane Tests\n");

test("keeps review-lane tasks in the review lane", () => {
  const task = {
    id: "TASK-ACTIVE-REVIEW",
    status: "review" as const,
    updated: "2026-03-30T18:00:00.000Z",
    reviewStatus: "gater-reviewing",
  };

  const buckets = buildTasksByStatus([task], STATUSES);
  assert.equal(buckets.review.length, 1);
  assert.equal(buckets.review[0]?.id, task.id);
  assert.equal(buckets["in-progress"].length, 0);
});

test("does not mirror approved tasks into review", () => {
  const task = {
    id: "TASK-APPROVED",
    status: "done" as const,
    updated: "2026-03-30T18:10:00.000Z",
    reviewStatus: "approved",
    lastReviewVerdict: "APPROVED",
    lastReviewAt: "2026-03-30T18:09:00.000Z",
    reviewCompletedAt: "2026-03-30T18:09:00.000Z",
  };

  const buckets = buildTasksByStatus([task], STATUSES);
  assert.equal(buckets.done.length, 1);
  assert.equal(buckets.review.length, 0);
});

test("does not mirror rejected tasks into review", () => {
  const task = {
    id: "TASK-REJECTED",
    status: "in-progress" as const,
    updated: "2026-03-30T19:10:00.000Z",
    reviewStatus: "rejected",
    lastReviewVerdict: "NEEDS_FIX",
    lastReviewAt: "2026-03-30T19:09:00.000Z",
  };

  const buckets = buildTasksByStatus([task], STATUSES);
  assert.equal(buckets["in-progress"].length, 1);
  assert.equal(buckets.review.length, 0);
});

test("column counts match canonical task statuses exactly", () => {
  const tasks = [
    { id: "b1", status: "backlog" as const, updated: "2026-03-30T18:00:00.000Z" },
    { id: "d1", status: "done" as const, updated: "2026-03-30T18:00:00.000Z", reviewStatus: "approved" },
    { id: "p1", status: "in-progress" as const, updated: "2026-03-30T18:00:00.000Z", reviewStatus: "gater-reviewing" },
    { id: "r1", status: "review" as const, updated: "2026-03-30T18:00:00.000Z", reviewStatus: "pending" },
    { id: "x1", status: "blocked" as const, updated: "2026-03-30T18:00:00.000Z", lastReviewVerdict: "NEEDS_FIX" },
  ];

  const buckets = buildTasksByStatus(tasks, ALL_STATUSES);
  const counts = Object.fromEntries(ALL_STATUSES.map((status) => [status, buckets[status].length]));

  assert.deepEqual(counts, {
    backlog: 1,
    "to-do": 0,
    "in-progress": 1,
    review: 1,
    blocked: 1,
    done: 1,
  });
});

test("sorts non-done columns by priority, then active work, then agent activity", () => {
  const buckets = buildTasksByStatus([
    {
      id: "p1-no-activity",
      status: "to-do" as const,
      priority: "P1" as const,
      updated: "2026-03-30T19:00:00.000Z",
    },
    {
      id: "p1-agent-activity",
      status: "to-do" as const,
      priority: "P1" as const,
      buildTriggeredAt: "2026-03-30T19:10:00.000Z",
      updated: "2026-03-30T19:10:00.000Z",
    },
    {
      id: "p1-active-build",
      status: "to-do" as const,
      priority: "P1" as const,
      buildState: "running" as const,
      buildStartedAt: "2026-03-30T19:20:00.000Z",
      updated: "2026-03-30T19:20:00.000Z",
    },
    {
      id: "p0-passive",
      status: "to-do" as const,
      priority: "P0" as const,
      updated: "2026-03-30T18:00:00.000Z",
    },
    {
      id: "p2-active-build",
      status: "to-do" as const,
      priority: "P2" as const,
      buildState: "running" as const,
      buildStartedAt: "2026-03-30T19:30:00.000Z",
      updated: "2026-03-30T19:30:00.000Z",
    },
  ], ALL_STATUSES);

  assert.deepEqual(
    buckets["to-do"].map((task) => task.id),
    ["p0-passive", "p1-active-build", "p1-agent-activity", "p1-no-activity", "p2-active-build"],
  );
});

test("floats active gater review items to the top of the review column within priority", () => {
  const buckets = buildTasksByStatus([
    {
      id: "review-passive",
      status: "review" as const,
      priority: "P1" as const,
      reviewStatus: "pending",
      updated: "2026-03-30T18:00:00.000Z",
    },
    {
      id: "review-active",
      status: "review" as const,
      priority: "P1" as const,
      reviewStatus: "gater-reviewing",
      lastReviewAt: "2026-03-30T18:05:00.000Z",
      updated: "2026-03-30T18:05:00.000Z",
    },
  ], ALL_STATUSES);

  assert.deepEqual(buckets.review.slice(0, 2).map((task) => task.id), ["review-active", "review-passive"]);
});

test("includes blocked tasks in their own column and sorts them by the shared comparator", () => {
  const buckets = buildTasksByStatus([
    {
      id: "blocked-p1-active",
      status: "blocked" as const,
      priority: "P1" as const,
      reviewStatus: "gater-reviewing",
      updated: "2026-03-30T19:10:00.000Z",
    },
    {
      id: "blocked-p0",
      status: "blocked" as const,
      priority: "P0" as const,
      updated: "2026-03-30T19:00:00.000Z",
    },
  ], ALL_STATUSES);

  assert.deepEqual(buckets.blocked.map((task) => task.id), ["blocked-p0", "blocked-p1-active"]);
});

test("sorts done tasks by completion time descending", () => {
  const buckets = buildTasksByStatus([
    {
      id: "done-older",
      status: "done" as const,
      priority: "P0" as const,
      completedAt: "2026-03-30T18:00:00.000Z",
      updated: "2026-03-30T18:00:00.000Z",
    },
    {
      id: "done-newer",
      status: "done" as const,
      priority: "P2" as const,
      completedAt: "2026-03-30T19:00:00.000Z",
      updated: "2026-03-30T19:00:00.000Z",
    },
  ], ALL_STATUSES);

  assert.deepEqual(buckets.done.map((task) => task.id), ["done-newer", "done-older"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
