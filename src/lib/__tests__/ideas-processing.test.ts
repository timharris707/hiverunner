/**
 * Ideas processing tests.
 * Run: node --experimental-strip-types src/lib/__tests__/ideas-processing.test.ts
 */

import assert from "node:assert/strict";
// @ts-expect-error Direct .ts import keeps this test runnable via Node strip-types.
import { getUnprocessedReviewIds, reviewIsFullyProcessed, takeawayHasTask } from "../ideas-processing.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error: unknown) {
    failed++;
    console.error(`  ✗ ${name}`);
    const message = error instanceof Error ? error.message : String(error);
    console.error(`    ${message}`);
  }
}

console.log("\nIdeas Processing Tests\n");

test("treats approved, building, and shipped takeaways as processed", () => {
  assert.equal(takeawayHasTask({ status: "approved" }), true);
  assert.equal(takeawayHasTask({ status: "building" }), true);
  assert.equal(takeawayHasTask({ status: "shipped" }), true);
});

test("treats rejected takeaways as processed at the review level", () => {
  assert.equal(reviewIsFullyProcessed({
    summary: "done",
    assessment: "done",
    takeaways: [{ status: "rejected" }],
  }), true);
});

test("keeps active reviews with idea takeaways in the unprocessed set", () => {
  const result = getUnprocessedReviewIds([
    {
      id: "review-1",
      status: "active",
      summary: "done",
      assessment: "done",
      takeaways: [{ status: "idea" }],
    },
  ] as Array<{ id: string; status: string; summary: string; assessment: string; takeaways: Array<{ status: string }> }>);

  assert.deepEqual(result.map((review) => (review as { id: string }).id), ["review-1"]);
});

test("ignores archived reviews when counting unprocessed items for the badge", () => {
  const result = getUnprocessedReviewIds([
    {
      id: "review-1",
      status: "archived",
      summary: "",
      assessment: "",
      takeaways: [],
    },
    {
      id: "review-2",
      status: "active",
      summary: "done",
      assessment: "done",
      takeaways: [{ status: "approved" }],
    },
  ] as Array<{ id: string; status: string; summary: string; assessment: string; takeaways: Array<{ status: string }> }>);

  assert.deepEqual(result.map((review) => (review as { id: string }).id), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
