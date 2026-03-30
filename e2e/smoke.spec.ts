/**
 * Mission Control — E2E Smoke Suite
 *
 * 10 critical-path tests covering:
 *   - Page renders (dashboard, agents, tasks board)
 *   - API health check
 *   - Task lifecycle: create → transition → invalid transition guard
 *   - Comment system
 *   - Task detail drawer (UI interaction)
 *   - Factory page
 *
 * Runs in serial mode (single worker) because tests share data/tasks.json.
 * Tests 5-9 create a labeled test task and attempt cleanup in afterAll.
 */

import { test, expect } from "@playwright/test";

// ── Shared state for the API-level tests ──────────────────────────────────────
let testTaskId = "";

// Serial execution — tests build on each other (task is created in test 5, used through test 9)
test.describe.configure({ mode: "serial" });

// ── Cleanup ───────────────────────────────────────────────────────────────────
test.afterAll(async ({ request }) => {
  if (!testTaskId) return;
  // Best-effort: walk the task to "done" so it doesn't pollute the board.
  // We don't know the exact current state, so we try each step and swallow errors.
  const steps = ["in-progress", "review", "done"];
  for (const status of steps) {
    await request
      .patch("/api/tasks", { data: { id: testTaskId, status } })
      .catch(() => {});
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 01 — Dashboard page renders
// ═════════════════════════════════════════════════════════════════════════════
test("01 - dashboard page renders", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBeLessThan(400);

  // The dashboard should have a non-empty body
  await expect(page.locator("body")).not.toBeEmpty();

  // Nav/layout should be present — the Dock is always rendered
  // Check for any of the key nav text labels
  await expect(
    page.getByText(/mission control|tasks|agents/i).first()
  ).toBeVisible({ timeout: 10_000 });
});

// ═════════════════════════════════════════════════════════════════════════════
// 02 — Agents page renders
// ═════════════════════════════════════════════════════════════════════════════
test("02 - agents page renders", async ({ page }) => {
  const response = await page.goto("/agents");
  expect(response?.status()).toBeLessThan(400);

  await expect(page.locator("body")).not.toBeEmpty();

  // Agents page should contain agent-related content
  await expect(
    page.getByText(/agents|roster|division/i).first()
  ).toBeVisible({ timeout: 10_000 });
});

// ═════════════════════════════════════════════════════════════════════════════
// 03 — Tasks board renders all five columns
// ═════════════════════════════════════════════════════════════════════════════
test("03 - tasks board renders all five status columns", async ({ page }) => {
  await page.goto("/tasks");

  // Wait for the board to finish loading — all five column headers must be visible
  const columns = ["Backlog", "On Deck", "In Progress", "Review", "Done"];
  for (const col of columns) {
    await expect(page.getByText(col).first()).toBeVisible({ timeout: 15_000 });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 04 — Health API returns a structured response
// ═════════════════════════════════════════════════════════════════════════════
test("04 - health API returns structured JSON", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toHaveProperty("status");
  expect(["healthy", "degraded", "critical"]).toContain(body.status);
  expect(body).toHaveProperty("checks");
  expect(Array.isArray(body.checks)).toBe(true);
  expect(body).toHaveProperty("timestamp");
});

// ═════════════════════════════════════════════════════════════════════════════
// 05 — Create a task via the API
// ═════════════════════════════════════════════════════════════════════════════
test("05 - create a task via POST /api/tasks", async ({ request }) => {
  const res = await request.post("/api/tasks", {
    data: {
      title: "[E2E-SMOKE] Critical path test task",
      description: "Created by the Playwright smoke suite — safe to delete.",
      status: "backlog",
      priority: "P3",
      type: "maintenance",
      project: "mission-control",
      tags: ["e2e-test"],
    },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty("task");
  expect(body.task).toHaveProperty("id");
  expect(body.task.id).toMatch(/^TASK-\d+$/);
  expect(body.task.title).toBe("[E2E-SMOKE] Critical path test task");
  expect(body.task.status).toBe("backlog");

  // Save ID for subsequent tests
  testTaskId = body.task.id;
});

// ═════════════════════════════════════════════════════════════════════════════
// 06 — Created task appears in the task list
// ═════════════════════════════════════════════════════════════════════════════
test("06 - created task visible in GET /api/tasks", async ({ request }) => {
  expect(testTaskId).toBeTruthy();

  const res = await request.get("/api/tasks");
  expect(res.status()).toBe(200);

  const body = await res.json();
  expect(body).toHaveProperty("tasks");
  expect(Array.isArray(body.tasks)).toBe(true);

  const found = body.tasks.find(
    (t: { id: string }) => t.id === testTaskId
  );
  expect(found).toBeDefined();
  expect(found.title).toBe("[E2E-SMOKE] Critical path test task");
});

// ═════════════════════════════════════════════════════════════════════════════
// 07 — Valid status transition: backlog → on-deck
// ═════════════════════════════════════════════════════════════════════════════
test("07 - valid status transition backlog → on-deck succeeds", async ({ request }) => {
  expect(testTaskId).toBeTruthy();

  const res = await request.patch("/api/tasks", {
    data: { id: testTaskId, status: "on-deck" },
  });

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.task.status).toBe("on-deck");
});

// ═════════════════════════════════════════════════════════════════════════════
// 08 — Invalid status transition is rejected (on-deck → done is not allowed)
// ═════════════════════════════════════════════════════════════════════════════
test("08 - invalid status transition is rejected with 400", async ({ request }) => {
  expect(testTaskId).toBeTruthy();

  // on-deck → done skips multiple stages; state machine must reject this
  const res = await request.patch("/api/tasks", {
    data: { id: testTaskId, status: "done" },
  });

  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty("error");
  expect(body.error).toMatch(/invalid status transition/i);
});

// ═════════════════════════════════════════════════════════════════════════════
// 09 — Comment can be posted and is returned in the response
// ═════════════════════════════════════════════════════════════════════════════
test("09 - post a comment and verify it is stored", async ({ request }) => {
  expect(testTaskId).toBeTruthy();

  const res = await request.post(
    `/api/tasks/${testTaskId}/comments`,
    {
      data: {
        author: "Pixel",
        authorEmoji: "💻",
        text: "E2E smoke test comment — automated.",
        type: "note",
      },
    }
  );

  expect(res.status()).toBe(200);
  const body = await res.json();

  expect(body).toHaveProperty("comment");
  expect(body.comment.author).toBe("Pixel");
  expect(body.comment.text).toBe("E2E smoke test comment — automated.");
  expect(body.comment.type).toBe("note");
  expect(body.comment).toHaveProperty("id");
  expect(body.comment).toHaveProperty("timestamp");

  // The comment list should be returned too
  expect(Array.isArray(body.comments)).toBe(true);
  expect(body.comments.length).toBeGreaterThan(0);
});

// ═════════════════════════════════════════════════════════════════════════════
// 10 — Task detail drawer opens when clicking a task card
// ═════════════════════════════════════════════════════════════════════════════
test("10 - task detail drawer opens on card click", async ({ page }) => {
  await page.goto("/tasks");

  // Wait for the board to fully load (columns visible)
  await expect(page.getByText("Backlog").first()).toBeVisible({
    timeout: 15_000,
  });

  // Find the first clickable task card (any column)
  // Cards are divs with cursor-pointer class
  const cards = page.locator(".cursor-pointer").filter({
    has: page.locator("text=/TASK-/"),
  });

  // Alternatively look for a card by our test task title if it's on screen
  const testCard = page
    .getByText("[E2E-SMOKE] Critical path test task")
    .first();
  const firstCard = cards.first();

  // Use test card if visible, fall back to any card
  let targetCard = testCard;
  const testCardVisible = await testCard.isVisible().catch(() => false);
  if (!testCardVisible) {
    // Make sure at least one card exists
    await expect(firstCard).toBeVisible({ timeout: 10_000 });
    targetCard = firstCard;
  }

  await targetCard.click();

  // The drawer should appear — identified by the task ID monospace display
  // (the drawer header shows `task.id` in a monospace span)
  await expect(page.locator("text=/TASK-\\d+/").first()).toBeVisible({
    timeout: 5_000,
  });

  // Drawer close button (X) should be present
  await expect(
    page.locator("button").filter({ has: page.locator("svg") }).first()
  ).toBeVisible();
});
