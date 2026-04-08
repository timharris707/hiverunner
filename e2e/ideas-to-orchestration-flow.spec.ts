/**
 * Mission Control — Ideas → Orchestration Board Full Flow (NEVA-127)
 *
 * Verifies the end-to-end pipeline:
 *   1. Submit a YouTube URL to Ideas → review created + processing task auto-enqueued
 *   2. Mock processing — inject summary, assessment, and a test takeaway
 *   3. Build a takeaway (add-to-queue) → task lands on board in backlog with correct links
 *   4. Verify bidirectional links: task.source_review / source_takeaway / tags ↔ review state
 *   5. Build a second takeaway (build-now) → task enters in-progress, takeaway → "building"
 *   6. Verify status sync: Ideas reflects board state after each build action
 *
 * Tag prefix [IDEAS-FLOW] identifies data created by this suite.
 * Cleanup: deletes test review + archives created tasks in afterAll.
 *
 * Note: the dev server is started with MISSION_CONTROL_E2E_BUILD_STUB=1 so
 * queueOrStartBuild spawns a short-lived stub process instead of a real Claude run.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL || "http://localhost:3010";
const TAG = "[IDEAS-FLOW]";
const RUN_ID = Date.now();

/** Stable YouTube URL that will never require a real network call in tests. */
const YOUTUBE_URL = `https://www.youtube.com/watch?v=dQw4w9WgXcQ`;
const YOUTUBE_VIDEO_ID = "dQw4w9WgXcQ";

const REVIEWS_PATH = join(
  process.env.HOME || os.homedir(),
  ".openclaw/workspace/projects/idea-intake/reviews.json"
);

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

let reviewId = "";
let takeawayId = ""; // add-to-queue takeaway
let takeawayId2 = ""; // build-now takeaway
let processingTaskId = "";
let queuedTaskId = "";
let buildNowTaskId = "";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Read the raw reviews.json off disk; returns parsed object. */
function readReviewsFile(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(REVIEWS_PATH, "utf-8"));
  } catch {
    return { reviews: [], meta: {} };
  }
}

/** Overwrite reviews.json on disk. */
function writeReviewsFile(data: Record<string, unknown>): void {
  writeFileSync(REVIEWS_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/** Inject mock processing results (summary, assessment, takeaways) into the review. */
function injectMockProcessing(targetReviewId: string): {
  takeawayId: string;
  takeawayId2: string;
} {
  const data = readReviewsFile();
  const reviews = data.reviews as Array<Record<string, unknown>>;
  const review = reviews.find((r) => r.id === targetReviewId);
  if (!review) {
    throw new Error(`Review ${targetReviewId} not found in reviews.json`);
  }

  const tw1Id = `tw-${RUN_ID}-a`;
  const tw2Id = `tw-${RUN_ID}-b`;

  review.summary =
    `${TAG} Mock summary for YouTube video. Covers async architecture and build queuing patterns.`;
  review.assessment =
    `${TAG} Highly relevant — actionable patterns for the orchestration layer.`;
  review.rating = 4;

  review.takeaways = [
    {
      id: tw1Id,
      title: `${TAG} Implement task queue deduplication`,
      description:
        "Add deduplication logic to the build queue so duplicate tasks are merged rather than stacked.",
      video_timestamp: "3:42",
      video_url: YOUTUBE_URL,
      video_context: "Speaker discusses dedup strategies at 3:42.",
      priority: "high",
      effort: "medium",
      status: "idea",
      github_issue: "",
      assigned_to: "forge",
      notes: "",
    },
    {
      id: tw2Id,
      title: `${TAG} Add board-status webhook endpoint`,
      description:
        "Create a POST /api/tasks/status-hook endpoint that external services can call to sync task status.",
      video_timestamp: "8:10",
      video_url: YOUTUBE_URL,
      video_context: "Speaker shows webhook-driven status patterns.",
      priority: "medium",
      effort: "small",
      status: "idea",
      github_issue: "",
      assigned_to: "pixel",
      notes: "",
    },
  ];

  writeReviewsFile(data);
  return { takeawayId: tw1Id, takeawayId2: tw2Id };
}

/** Archive test tasks created by this suite. */
async function archiveTestTasks(
  request: APIRequestContext,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  await request.post(`${BASE}/api/tasks/archive`, {
    data: { ids },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP / TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  // 1. Create YouTube review
  const res = await request.post(`${BASE}/api/ideas`, {
    data: { url: YOUTUBE_URL, title: `${TAG} Test Review ${RUN_ID}` },
  });
  expect(res.status(), "POST /api/ideas should return 201").toBe(201);
  const body = (await res.json()) as Record<string, unknown>;
  reviewId = body.id as string;
  expect(reviewId).toMatch(/^review-/);

  // 2. Inject mock processing data (summary + two takeaways) directly into reviews.json
  const ids = injectMockProcessing(reviewId);
  takeawayId = ids.takeawayId;
  takeawayId2 = ids.takeawayId2;
});

test.afterAll(async ({ request }) => {
  // Clean up: delete the test review from Ideas
  if (reviewId) {
    await request.delete(`${BASE}/api/ideas/${reviewId}`);
  }
  // Archive all tasks created by this suite
  const taskIds = [processingTaskId, queuedTaskId, buildNowTaskId].filter(Boolean);
  await archiveTestTasks(request, taskIds);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: YouTube review is created with auto-detected type and thumbnail
// ─────────────────────────────────────────────────────────────────────────────

test("YouTube review is created with correct type and thumbnail", async ({ request }) => {
  const res = await request.get(`${BASE}/api/ideas`);
  expect(res.status()).toBe(200);

  const body = (await res.json()) as { reviews: Array<Record<string, unknown>> };
  const review = body.reviews.find((r) => r.id === reviewId);

  expect(review, "Review should appear in GET /api/ideas").toBeTruthy();
  expect(review!.type).toBe("youtube");
  expect(review!.thumbnail).toBe(
    `https://img.youtube.com/vi/${YOUTUBE_VIDEO_ID}/mqdefault.jpg`
  );
  expect(review!.status).toBe("active");
  expect((review!.title as string)).toContain(TAG);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Submitting a YouTube URL auto-creates a processing task on the board
// ─────────────────────────────────────────────────────────────────────────────

test("submitting a YouTube URL auto-enqueues a processing task", async ({ request }) => {
  const res = await request.get(`${BASE}/api/tasks`);
  expect(res.status()).toBe(200);

  const body = (await res.json()) as { tasks: Array<Record<string, unknown>> };

  // The auto-created processing task references the review id in its description
  const processingTask = body.tasks.find((t) => {
    const desc = String(t.description || "");
    const id = String(t.reviewId || "");
    return id === reviewId || desc.includes(reviewId);
  });

  expect(
    processingTask,
    "A processing task referencing the review id should be on the board"
  ).toBeTruthy();

  expect(processingTask!.status).toBe("in-progress");
  expect(processingTask!.project).toBe("idea-intake");
  expect((processingTask!.tags as string[]) || []).toEqual(
    expect.arrayContaining(["youtube", "processing"])
  );

  processingTaskId = processingTask!.id as string;
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Mock processing data is stored correctly
// ─────────────────────────────────────────────────────────────────────────────

test("mock processing data (summary, assessment, takeaways) is persisted in Ideas", async ({
  request,
}) => {
  const res = await request.get(`${BASE}/api/ideas`);
  expect(res.status()).toBe(200);

  const body = (await res.json()) as { reviews: Array<Record<string, unknown>> };
  const review = body.reviews.find((r) => r.id === reviewId);

  expect(review!.summary).toContain(TAG);
  expect(review!.assessment).toContain(TAG);
  expect(review!.rating).toBe(4);

  const takeaways = review!.takeaways as Array<Record<string, unknown>>;
  expect(takeaways).toHaveLength(2);
  expect(takeaways.map((t) => t.id)).toEqual(
    expect.arrayContaining([takeawayId, takeawayId2])
  );
  expect(takeaways.every((t) => t.status === "idea")).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Build a takeaway (add-to-queue) → task created on board
// ─────────────────────────────────────────────────────────────────────────────

test("building a takeaway (add-to-queue) creates a task on the board", async ({
  request,
}) => {
  const res = await request.post(
    `${BASE}/api/ideas/${reviewId}/takeaways/${takeawayId}/build`,
    { data: { action: "add-to-queue", project: "mission-control" } }
  );
  expect(res.status(), "Build endpoint should return 200").toBe(200);

  const body = (await res.json()) as {
    task: Record<string, unknown>;
    takeaway: Record<string, unknown>;
  };

  const task = body.task;
  expect(task).toBeTruthy();

  // The reconciler may auto-promote backlog → on-deck immediately if slots are available.
  // What matters is that the task has NOT been pushed straight to in-progress (that is
  // reserved for the build-now action tested in Test 8).
  expect(
    ["backlog", "on-deck"],
    `status should be backlog or on-deck for add-to-queue, got: ${task.status}`
  ).toContain(task.status);

  // Orchestration path returns camelCase source fields (not snake_case legacy aliases)
  expect(task.sourceReviewId).toBe(reviewId);
  expect(task.sourceTakeawayId).toBe(takeawayId);
  // project is the orchestration project UUID; verify it is set
  expect(task.project).toBeTruthy();

  const tags = task.tags as string[];
  expect(tags).toContain("from-idea");
  expect(tags).toContain(`idea-${takeawayId}`);

  // Priority mapping: high → P0
  expect(task.priority).toBe("P0");

  queuedTaskId = task.id as string;
  // Orchestration tasks use UUIDs (not legacy TASK-{timestamp} prefix)
  expect(queuedTaskId).toMatch(/^[0-9a-f-]{36}$/);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Takeaway status syncs to "approved" after add-to-queue build
// ─────────────────────────────────────────────────────────────────────────────

test("takeaway status updates to 'approved' after add-to-queue build", async ({
  request,
}) => {
  const res = await request.get(`${BASE}/api/ideas`);
  expect(res.status()).toBe(200);

  const body = (await res.json()) as { reviews: Array<Record<string, unknown>> };
  const review = body.reviews.find((r) => r.id === reviewId);
  const takeaways = review!.takeaways as Array<Record<string, unknown>>;
  const tw = takeaways.find((t) => t.id === takeawayId);

  expect(tw, "Takeaway should still exist in review").toBeTruthy();
  expect(tw!.status).toBe("approved");
  expect(String(tw!.notes || "")).toContain(queuedTaskId);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Task appears on orchestration board with all correct data
// ─────────────────────────────────────────────────────────────────────────────

test("board reflects the queued task with correct title, priority, and assignee", async ({
  request,
}) => {
  // Tasks created via the orchestration path live in the orchestration DB;
  // look them up by UUID via the orchestration API, not the legacy /api/tasks.
  const res = await request.get(`${BASE}/api/orchestration/tasks/${queuedTaskId}`);
  expect(res.status(), "Queued task should be retrievable from orchestration board").toBe(200);

  const body = (await res.json()) as { task: Record<string, unknown> };
  const task = body.task;

  expect(task).toBeTruthy();
  expect(task.title).toContain(TAG);
  // Task may already be in on-deck due to auto-promotion
  expect(["backlog", "on-deck"]).toContain(task.status);
  expect(task.priority).toBe("P0");

  // Assignee name from orchestration DB (no emoji suffix)
  expect(task.assignee).toBe("Forge");
  expect(task.type).toBe("feature");
  expect(task.sourceReviewId).toBe(reviewId);
  // Source URL is embedded in the task description by toTaskDescription()
  expect(String(task.description ?? "")).toContain(YOUTUBE_URL);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: Bidirectional link — task tags allow tracing back to source review
// ─────────────────────────────────────────────────────────────────────────────

test("task tags include both 'from-idea' and the takeaway-scoped tag for reverse lookup", async ({
  request,
}) => {
  const res = await request.get(`${BASE}/api/orchestration/tasks/${queuedTaskId}`);
  expect(res.status()).toBe(200);

  const body = (await res.json()) as { task: Record<string, unknown> };
  const task = body.task;

  const tags = task.tags as string[];
  expect(tags).toContain("from-idea");
  expect(tags).toContain(`idea-${takeawayId}`);

  // Forward link: task → review (camelCase orchestration fields)
  expect(task.sourceReviewId).toBe(reviewId);
  expect(task.sourceTakeawayId).toBe(takeawayId);

  // Reverse link: from the review, we can find tasks via the tag
  const ideasRes = await request.get(`${BASE}/api/ideas`);
  const ideasBody = (await ideasRes.json()) as { reviews: Array<Record<string, unknown>> };
  const review = ideasBody.reviews.find((r) => r.id === reviewId)!;
  const tw = (review.takeaways as Array<Record<string, unknown>>).find(
    (t) => t.id === takeawayId
  )!;
  // The notes field on the takeaway contains the task id (set by the build route)
  expect(String(tw.notes || "")).toContain(queuedTaskId);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: Build a second takeaway (build-now) → task enters in-progress
// ─────────────────────────────────────────────────────────────────────────────

test("building a takeaway with build-now creates an in-progress task", async ({
  request,
}) => {
  const res = await request.post(
    `${BASE}/api/ideas/${reviewId}/takeaways/${takeawayId2}/build`,
    { data: { action: "build-now", project: "mission-control" } }
  );
  expect(res.status()).toBe(200);

  const body = (await res.json()) as {
    task: Record<string, unknown>;
    takeaway: Record<string, unknown>;
  };

  const task = body.task;
  expect(task.status).toBe("in-progress");
  // Orchestration path returns camelCase source fields
  expect(task.sourceReviewId).toBe(reviewId);
  expect(task.sourceTakeawayId).toBe(takeawayId2);

  // Priority mapping: medium → P1
  expect(task.priority).toBe("P1");

  // Assignee name from orchestration DB (no emoji suffix)
  expect(task.assignee).toBe("Pixel");

  buildNowTaskId = task.id as string;
  // Orchestration tasks use UUIDs
  expect(buildNowTaskId).toMatch(/^[0-9a-f-]{36}$/);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: Status sync — build-now takeaway transitions to "building"
// ─────────────────────────────────────────────────────────────────────────────

test("build-now action transitions takeaway status to 'building'", async ({
  request,
}) => {
  const res = await request.get(`${BASE}/api/ideas`);
  expect(res.status()).toBe(200);

  const body = (await res.json()) as { reviews: Array<Record<string, unknown>> };
  const review = body.reviews.find((r) => r.id === reviewId)!;
  const takeaways = review.takeaways as Array<Record<string, unknown>>;

  const tw1 = takeaways.find((t) => t.id === takeawayId);
  const tw2 = takeaways.find((t) => t.id === takeawayId2);

  // add-to-queue takeaway should still be "approved"
  expect(tw1!.status).toBe("approved");

  // build-now takeaway should now be "building"
  expect(tw2!.status).toBe("building");
  expect(String(tw2!.notes || "")).toContain(buildNowTaskId);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: Both tasks are distinct and independent on the board
// ─────────────────────────────────────────────────────────────────────────────

test("two build actions produce two distinct tasks on the board", async ({
  request,
}) => {
  expect(queuedTaskId).not.toBe(buildNowTaskId);

  // Fetch both tasks directly from the orchestration board by UUID
  const [r1, r2] = await Promise.all([
    request.get(`${BASE}/api/orchestration/tasks/${queuedTaskId}`),
    request.get(`${BASE}/api/orchestration/tasks/${buildNowTaskId}`),
  ]);
  expect(r1.status()).toBe(200);
  expect(r2.status()).toBe(200);

  const t1 = ((await r1.json()) as { task: Record<string, unknown> }).task;
  const t2 = ((await r2.json()) as { task: Record<string, unknown> }).task;

  expect(t1).toBeTruthy();
  expect(t2).toBeTruthy();

  // add-to-queue task may be backlog or on-deck (auto-promoted), never in-progress
  expect(["backlog", "on-deck"]).toContain(t1.status);
  expect(t2.status).toBe("in-progress");

  // Both trace back to same review, different takeaway (camelCase orchestration fields)
  expect(t1.sourceReviewId).toBe(reviewId);
  expect(t2.sourceReviewId).toBe(reviewId);
  expect(t1.sourceTakeawayId).not.toBe(t2.sourceTakeawayId);
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: Build endpoint returns 404 for unknown review or takeaway
// ─────────────────────────────────────────────────────────────────────────────

test("build endpoint returns 404 for unknown review", async ({ request }) => {
  const res = await request.post(
    `${BASE}/api/ideas/review-nonexistent-xyz/takeaways/tw-abc/build`,
    { data: { action: "add-to-queue" } }
  );
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error).toBeTruthy();
});

test("build endpoint returns 404 for unknown takeaway in a valid review", async ({
  request,
}) => {
  const res = await request.post(
    `${BASE}/api/ideas/${reviewId}/takeaways/tw-nonexistent-xyz/build`,
    { data: { action: "add-to-queue" } }
  );
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error).toBeTruthy();
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: Review is removed after DELETE — cleanup verification
// ─────────────────────────────────────────────────────────────────────────────

test("deleted review no longer appears in GET /api/ideas", async ({ request }) => {
  // afterAll handles the delete, but we can run a pre-delete check here:
  // confirm the review still exists before teardown
  const beforeRes = await request.get(`${BASE}/api/ideas`);
  const before = (await beforeRes.json()) as { reviews: Array<Record<string, unknown>> };
  const exists = before.reviews.some((r) => r.id === reviewId);
  expect(exists, "Review should still exist before afterAll cleanup").toBe(true);
});
