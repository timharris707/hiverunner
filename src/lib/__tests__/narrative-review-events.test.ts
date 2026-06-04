/**
 * Narrative review event tests.
 * Run: npx tsx src/lib/__tests__/narrative-review-events.test.ts
 */

import assert from "node:assert/strict";
import { buildNarrativeItems } from "@/lib/task-narrative";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

void (async () => {
console.log("\nNarrative Review Event Tests\n");

await test("keeps Gater review-in-progress item visible for review tasks", () => {
  const result = buildNarrativeItems([
    {
      id: "TASK-REVIEWING",
      title: "Make review step visible",
      status: "review",
      updated: "2026-03-30T15:00:00.000Z",
      assignedAgent: "pixel",
      reviewAssignedTo: "gater",
      reviewStatus: "gater-reviewing",
    },
  ]);

  const reviewItem = result.items.find((item) => item.id === "task-review-TASK-REVIEWING");
  assert.ok(reviewItem, "expected active review narrative item");
  assert.match(reviewItem!.text, /reviewing "Make review step visible"/);
});

await test("preserves review approval event even after task is done", () => {
  const result = buildNarrativeItems([
    {
      id: "TASK-APPROVED",
      title: "Ship review verdict",
      status: "done",
      updated: "2026-03-30T16:00:00.000Z",
      completedAt: "2026-03-30T16:00:00.000Z",
      assignedAgent: "pixel",
      reviewAssignedTo: "gater",
      reviewStatus: "approved",
      lastReviewVerdict: "APPROVED",
      lastReviewerAgent: "gater",
      lastReviewAt: "2026-03-30T15:59:00.000Z",
    },
  ]);

  assert.ok(result.items.some((item) => item.type === "task_review" && /approved/.test(item.text)));
  assert.ok(result.items.some((item) => item.type === "task_done" && /shipped/.test(item.text)));
});

await test("emits rejection narrative with reviewer notes", () => {
  const result = buildNarrativeItems([
    {
      id: "TASK-REJECTED",
      title: "Fix review banner",
      status: "in-progress",
      updated: "2026-03-30T17:00:00.000Z",
      assignedAgent: "pixel",
      reviewAssignedTo: "gater",
      reviewStatus: "rejected",
      lastReviewVerdict: "NEEDS_FIX",
      lastReviewerAgent: "gater",
      lastReviewAt: "2026-03-30T16:58:00.000Z",
      lastReviewNotes: "Missing the Gater verdict on the card",
    },
  ]);

  const rejection = result.items.find((item) => item.type === "task_review");
  assert.ok(rejection, "expected rejection narrative item");
  assert.match(rejection!.text, /sent "Fix review banner" back/);
  assert.match(rejection!.text, /Missing the Gater verdict/);
});

finish();
})().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
