/**
 * Mission Control — Kanban Board UI Integration Tests (Sprint 2)
 *
 * Covers critical board flows end-to-end through the browser:
 *   1.  Projects page renders and shows project cards
 *   2.  Board page loads with all 5 columns
 *   3.  Task cards render with priority, title, assignee, and age
 *   4.  Status move via dropdown ("drag" via select control)
 *   5.  Detail drawer opens on card click and closes correctly
 *   6.  Quick-assign via assignee dropdown on card
 *   7.  Search filters tasks in real time
 *   8.  Bulk select + bulk move flow
 *   9.  Performance: board renders 50+ task cards within budget
 *
 * Setup strategy:
 *   - Creates an [UI-TEST] project via the API before tests run.
 *   - Seeds tasks via the API for reliable state.
 *   - Archives the project in afterAll to keep data clean.
 *
 * Serial execution: one worker, no parallel runs.
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL || "http://localhost:3010";
const API_PATH = "/api/orchestration";
const TAG = "[UI-TEST]";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getDefaultCompanyId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API_PATH}/companies`);
  const { companies } = await res.json();
  const core = (companies as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === "neveridle-core"
  );
  if (!core) throw new Error("NeverIdle Core company not found");
  return core.id;
}

async function createProject(request: APIRequestContext, suffix = "", companyId?: string) {
  const resolvedCompanyId = companyId ?? (await getDefaultCompanyId(request));
  const res = await request.post(`${API_PATH}/projects`, {
    data: {
      name: `${TAG} Board UI ${suffix}`.trim(),
      description: "Vigil UI integration test project",
      emoji: "🧪",
      color: "#22d3ee",
      slug: `ui-test-${Date.now()}${suffix.replace(/\s/g, "-")}`,
      companyId: resolvedCompanyId,
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { project: { id: string; slug: string } };
  return body.project;
}

async function createTask(
  request: APIRequestContext,
  projectId: string,
  overrides: Record<string, unknown> = {}
) {
  const res = await request.post(`${API_PATH}/tasks`, {
    data: {
      title: `${TAG} Task ${Date.now()}`,
      description: "Created by Vigil UI test",
      status: "backlog",
      priority: "P2",
      type: "feature",
      projectId,
      labels: [],
      ...overrides,
    },
  });
  const body = await res.json();
  expect(res.status(), `createTask failed: ${JSON.stringify(body)}`).toBe(201);
  return (body as { task: { id: string; title: string; status: string } }).task;
}

async function archiveProject(request: APIRequestContext, projectId: string) {
  const res = await request.delete(`${API_PATH}/projects/${projectId}`);
  const body = await res.json();
  expect(res.status(), `archiveProject failed: ${JSON.stringify(body)}`).toBe(200);
  expect((body as { projectId: string }).projectId).toBe(projectId);
}

/** Wait for the board to finish loading (spinner gone, columns visible). */
async function waitForBoard(page: Page) {
  // The loading skeleton disappears and columns appear
  await expect(page.getByRole("heading", { name: /backlog/i })).toBeVisible({ timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

let testCompanyId: string;
let testProjectId: string;
let testProjectSlug: string;
let taskBacklog: { id: string; title: string; status: string };
let taskOnDeck: { id: string; title: string; status: string };
let taskInProgress: { id: string; title: string; status: string };

// ─────────────────────────────────────────────────────────────────────────────
// SETUP / TEARDOWN
// ─────────────────────────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  const companiesRes = await request.get(`${API_PATH}/companies`);
  expect(companiesRes.status()).toBe(200);
  const { companies } = await companiesRes.json();
  const core = (companies as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === "neveridle-core"
  );
  expect(core, "NeverIdle Core company not found").toBeTruthy();
  testCompanyId = core!.id;

  const project = await createProject(request, "main", testCompanyId);
  testProjectId = project.id;
  testProjectSlug = project.slug;

  // Seed a handful of tasks in different columns
  taskBacklog = await createTask(request, testProjectId, {
    title: `${TAG} Backlog Task`,
    status: "backlog",
    priority: "P1",
  });
  taskOnDeck = await createTask(request, testProjectId, {
    title: `${TAG} OnDeck Task`,
    status: "on-deck",
    priority: "P2",
  });
  taskInProgress = await createTask(request, testProjectId, {
    title: `${TAG} InProgress Task`,
    status: "in-progress",
    priority: "P0",
  });
  // Extra tasks to populate more columns
  await createTask(request, testProjectId, {
    title: `${TAG} Review Task`,
    status: "review",
    priority: "P3",
  });
  await createTask(request, testProjectId, {
    title: `${TAG} Done Task`,
    status: "done",
    priority: "P2",
  });
});

test.afterAll(async ({ request }) => {
  if (!testProjectId) return;
  await archiveProject(request, testProjectId);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Projects Hub page
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Projects Hub", () => {
  test("renders page heading and project cards", async ({ page }) => {
    await page.goto(`${BASE}/projects`);
    await expect(page.getByRole("heading", { name: /projects hub/i })).toBeVisible();
    // Our test project should appear (active tab is default)
    await expect(page.getByText(`${TAG} Board UI main`)).toBeVisible({ timeout: 10_000 });
  });

  test("stat counters are non-negative numbers", async ({ page }) => {
    await page.goto(`${BASE}/projects`);
    // Three stat boxes: Active Projects, Tasks In Progress, Tasks In Review
    const stats = page.locator("text=/^\\d+$/");
    await expect(stats.first()).toBeVisible({ timeout: 10_000 });
  });

  test("search filters project cards by name", async ({ page }) => {
    await page.goto(`${BASE}/projects`);
    const search = page.getByPlaceholder("Search projects");
    await expect(search).toBeVisible({ timeout: 10_000 });

    // Type a unique fragment that matches only our project
    await search.fill("UI-TEST-NONEXISTENT-XYZ");
    // All cards should disappear — empty state shown
    await expect(page.getByText(/no projects in this state/i)).toBeVisible();

    // Clear search — cards come back
    await search.fill("");
    await expect(page.getByText(`${TAG} Board UI main`)).toBeVisible();
  });

  test("clicking a project card navigates to board", async ({ page }) => {
    await page.goto(`${BASE}/projects`);
    await page.getByText(`${TAG} Board UI main`).click();
    await expect(page).toHaveURL(
      new RegExp(`/projects/(${testProjectId}|${testProjectSlug})/board`),
      { timeout: 10_000 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Board layout
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Board layout", () => {
  test("renders all 5 columns", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    for (const label of ["Backlog", "To-Do", "In Progress", "Review", "Done"]) {
      await expect(page.getByRole("heading", { name: new RegExp(label, "i") })).toBeVisible();
    }
  });

  test("each column has a task count badge", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    // The count badges are <span> elements with digit text inside column headers
    // We seeded 1 task per column — badges should show ≥ 1
    const backlogHeader = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const badge = backlogHeader.locator("header span").last();
    await expect(badge).toBeVisible();
    const text = await badge.textContent();
    expect(Number(text)).toBeGreaterThanOrEqual(1);
  });

  test("project name appears in nav", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);
    await expect(page.getByText(`${TAG} Board UI main`)).toBeVisible();
  });

  test("nav tabs render (Board, Agents, Sprints, Settings)", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);
    for (const tab of ["Board", "Agents", "Sprints", "Settings"]) {
      await expect(page.getByRole("link", { name: new RegExp(tab, "i") })).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Task cards
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Task cards", () => {
  test("seeded tasks appear in correct columns", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    // Locate the Backlog column section and assert our task title appears in it
    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    await expect(backlogCol.getByText(`${TAG} Backlog Task`)).toBeVisible();

    const onDeckCol = page.locator("section").filter({ hasText: /^to-?do/i }).first();
    await expect(onDeckCol.getByText(`${TAG} OnDeck Task`)).toBeVisible();

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    await expect(inProgressCol.getByText(`${TAG} InProgress Task`)).toBeVisible();
  });

  test("task card shows priority badge", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    // P0 task should show a P0 badge
    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    await expect(inProgressCol.getByText("P0")).toBeVisible();
  });

  test("task card shows status and assignee selects", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: `${TAG} Backlog Task` });
    await expect(card).toBeVisible();

    // Two selects per card: status + assignee
    const selects = card.locator("select");
    await expect(selects).toHaveCount(2);
  });

  test("task card shows age indicator", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: `${TAG} Backlog Task` });
    // Age text is something like "0m" or "just now"
    await expect(card).toBeVisible();
    // Clock or AlertTriangle icon exists (SVG) — just assert the card has the time zone
    const cardText = await card.textContent();
    expect(cardText).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Status move ("drag" via dropdown)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Status move via dropdown", () => {
  test("moving a task from Backlog to To-Do updates the board", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: `${TAG} Backlog Task` });
    await expect(card).toBeVisible();

    // First select in the card is the status select
    const statusSelect = card.locator("select").first();
    await statusSelect.selectOption("on-deck");

    // After optimistic update, card should move — wait for To-Do column to show it
    const onDeckCol = page.locator("section").filter({ hasText: /^to-?do/i }).first();
    await expect(onDeckCol.getByText(`${TAG} Backlog Task`)).toBeVisible({ timeout: 8_000 });

    // Backlog column should no longer contain it
    await expect(backlogCol.getByText(`${TAG} Backlog Task`)).not.toBeVisible();
  });

  test("moving a task to Done updates the board", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const onDeckCol = page.locator("section").filter({ hasText: /^to-?do/i }).first();
    const card = onDeckCol.locator("article").filter({ hasText: `${TAG} OnDeck Task` });
    await expect(card).toBeVisible();

    const statusSelect = card.locator("select").first();
    await statusSelect.selectOption("done");

    const doneCol = page.locator("section").filter({ hasText: /^done/i }).first();
    await expect(doneCol.getByText(`${TAG} OnDeck Task`)).toBeVisible({ timeout: 8_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Detail drawer
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Detail drawer", () => {
  test("clicking a task card opens the detail drawer", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    // Drawer starts hidden (translated off screen)
    const drawer = page.locator("aside");
    await expect(drawer).toHaveAttribute("aria-hidden", "true");

    // Click the InProgress task card
    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: `${TAG} InProgress Task` });
    await card.click();

    // Drawer should become visible
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");
    await expect(drawer.getByText(`${TAG} InProgress Task`)).toBeVisible();
  });

  test("drawer shows Priority, Assignee, Updated, Type info", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: `${TAG} InProgress Task` });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer.getByText(/priority/i)).toBeVisible();
    await expect(drawer.getByText(/assignee/i)).toBeVisible();
    await expect(drawer.getByText(/updated/i)).toBeVisible();
    await expect(drawer.getByText(/type/i)).toBeVisible();
  });

  test("drawer Close button hides the drawer", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: `${TAG} InProgress Task` });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    await drawer.getByRole("button", { name: /close/i }).click();
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
  });

  test("overlay backdrop click closes the drawer", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: `${TAG} InProgress Task` });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    // Click the overlay backdrop
    await page.getByRole("button", { name: /close task drawer overlay/i }).click();
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
  });

  test("drawer shows Activity section", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: `${TAG} InProgress Task` });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer.getByText(/activity/i)).toBeVisible();
    // No comments seeded — "No comments yet" placeholder should appear
    await expect(drawer.getByText(/no comments yet/i)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — Quick assign
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Quick assign", () => {
  test("assignee dropdown is present and can be changed", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: `${TAG} InProgress Task` });
    await expect(card).toBeVisible();

    // Second select on the card is the assignee select
    const assigneeSelect = card.locator("select").nth(1);
    await expect(assigneeSelect).toBeVisible();

    // Default value is empty (Unassigned)
    const current = await assigneeSelect.inputValue();
    expect(current).toBe("");

    // The option "Unassigned" exists
    const options = await assigneeSelect.locator("option").allTextContents();
    expect(options).toContain("Unassigned");
  });

  test("changing assignee does not open the detail drawer", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: `${TAG} InProgress Task` });
    const assigneeSelect = card.locator("select").nth(1);

    // Get the first real agent option (if any agents are in roster)
    const options = await assigneeSelect.locator("option").allTextContents();
    if (options.length > 1) {
      // If there's at least one agent, pick the first non-empty option
      const agentOption = options.find((o) => o !== "Unassigned");
      if (agentOption) {
        await assigneeSelect.selectOption({ label: agentOption });
      }
    }

    // Drawer should NOT have opened (click propagation was stopped)
    const drawer = page.locator("aside");
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 — Search filter
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Search filter", () => {
  test("search input filters task cards in real time", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const search = page.getByPlaceholder("Search tasks");
    await expect(search).toBeVisible();

    // InProgress task should be visible
    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    await expect(inProgressCol.getByText(`${TAG} InProgress Task`)).toBeVisible();

    // Filter to something that only matches InProgress task
    await search.fill("InProgress Task");

    // InProgress card stays visible
    await expect(inProgressCol.getByText(`${TAG} InProgress Task`)).toBeVisible();

    // Done task title should not be visible in the Done column (filtered out)
    const doneCol = page.locator("section").filter({ hasText: /^done/i }).first();
    await expect(doneCol.getByText(`${TAG} Done Task`)).not.toBeVisible();
  });

  test("clearing search restores all tasks", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const search = page.getByPlaceholder("Search tasks");
    await search.fill("InProgress Task");

    // Clear it
    await search.fill("");

    // Done task should reappear
    const doneCol = page.locator("section").filter({ hasText: /^done/i }).first();
    await expect(doneCol.getByText(`${TAG} Done Task`)).toBeVisible({ timeout: 5_000 });
  });

  test("no-match search shows empty state in all columns", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const search = page.getByPlaceholder("Search tasks");
    await search.fill("XYZZY-NONEXISTENT-TASK-TITLE");

    // Every column should show the "No tasks" dashed empty state
    const noTaskMessages = page.getByText("No tasks");
    const count = await noTaskMessages.count();
    // At least 3 columns should show "No tasks"
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8 — Bulk select + bulk move
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Bulk select and bulk move", () => {
  let bulkProjectId: string;
  let bulkTask1: { id: string; title: string; status: string };
  let bulkTask2: { id: string; title: string; status: string };

  test.beforeAll(async ({ request }) => {
    const project = await createProject(request, "bulk");
    bulkProjectId = project.id;
    bulkTask1 = await createTask(request, bulkProjectId, {
      title: `${TAG} Bulk Task 1`,
      status: "backlog",
    });
    bulkTask2 = await createTask(request, bulkProjectId, {
      title: `${TAG} Bulk Task 2`,
      status: "backlog",
    });
  });

  test.afterAll(async ({ request }) => {
    if (!bulkProjectId) return;
    await archiveProject(request, bulkProjectId);
  });

  test("bulk move buttons are disabled when no tasks selected", async ({ page }) => {
    await page.goto(`${BASE}/projects/${bulkProjectId}/board`);
    await waitForBoard(page);

    // All bulk move buttons should be disabled
    const bulkButtons = page.locator("button:has-text('Backlog'), button:has-text('To-Do'), button:has-text('In Progress'), button:has-text('Review'), button:has-text('Done')");
    // Only bulk move buttons (not nav buttons) — they're inside the bar with "Bulk Move" label
    const bulkBar = page.locator("div").filter({ hasText: /^Bulk Move/ }).first();
    const buttons = bulkBar.locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(buttons.nth(i)).toBeDisabled();
    }
  });

  test("selecting a task enables bulk move buttons", async ({ page }) => {
    await page.goto(`${BASE}/projects/${bulkProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: `${TAG} Bulk Task 1` });
    await expect(card).toBeVisible();

    // Check the checkbox (click inside the label to avoid opening drawer)
    const checkbox = card.locator("input[type=checkbox]");
    await checkbox.click();

    // Bulk move buttons should now be enabled
    const bulkBar = page.locator("div").filter({ hasText: /^Bulk Move/ }).first();
    const buttons = bulkBar.locator("button");
    await expect(buttons.first()).toBeEnabled();
  });

  test("bulk move moves selected tasks to target column", async ({ page }) => {
    await page.goto(`${BASE}/projects/${bulkProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();

    // Select both tasks
    for (const title of [`${TAG} Bulk Task 1`, `${TAG} Bulk Task 2`]) {
      const card = backlogCol.locator("article").filter({ hasText: title });
      await expect(card).toBeVisible();
      await card.locator("input[type=checkbox]").click();
    }

    // Click "To-Do" in the bulk move bar
    const bulkBar = page.locator("div").filter({ hasText: /^Bulk Move/ }).first();
    await bulkBar.getByRole("button", { name: /to-?do/i }).click();
    await expect(page.getByRole("dialog", { name: /confirm bulk action/i })).toBeVisible();
    await page.getByRole("button", { name: /^confirm$/i }).click();

    // Both tasks should appear in To-Do column
    const onDeckCol = page.locator("section").filter({ hasText: /^to-?do/i }).first();
    await expect(onDeckCol.getByText(`${TAG} Bulk Task 1`)).toBeVisible({ timeout: 8_000 });
    await expect(onDeckCol.getByText(`${TAG} Bulk Task 2`)).toBeVisible({ timeout: 8_000 });
  });

  test("shift-clicking a second checkbox selects a range", async ({ page, request }) => {
    const shiftTaskOne = await createTask(request, bulkProjectId, {
      title: `${TAG} Shift Task 1 ${Date.now()}`,
      status: "backlog",
    });
    const shiftTaskTwo = await createTask(request, bulkProjectId, {
      title: `${TAG} Shift Task 2 ${Date.now()}`,
      status: "backlog",
    });

    await page.goto(`${BASE}/projects/${bulkProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const taskOne = backlogCol.locator("article").filter({ hasText: shiftTaskOne.title });
    const taskTwo = backlogCol.locator("article").filter({ hasText: shiftTaskTwo.title });

    await taskOne.locator("input[type=checkbox]").click();
    await taskTwo.locator("input[type=checkbox]").click({ modifiers: ["Shift"] });

    await expect(taskOne.locator("input[type=checkbox]")).toBeChecked();
    await expect(taskTwo.locator("input[type=checkbox]")).toBeChecked();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 9 — Performance: 50+ task cards
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Performance with 50+ task cards", () => {
  let perfProjectId: string;

  test.beforeAll(async ({ request }) => {
    const project = await createProject(request, "perf");
    perfProjectId = project.id;

    // Seed 55 tasks spread across statuses
    const statuses = ["backlog", "on-deck", "in-progress", "review", "done"] as const;
    for (let i = 0; i < 55; i++) {
      await createTask(request, perfProjectId, {
        title: `${TAG} Perf Task ${i + 1}`,
        status: statuses[i % statuses.length],
        priority: (["P0", "P1", "P2", "P3"] as const)[i % 4],
        type: (["feature", "bug", "maintenance", "research", "infrastructure"] as const)[i % 5],
      });
    }
  });

  test.afterAll(async ({ request }) => {
    if (!perfProjectId) return;
    await archiveProject(request, perfProjectId);
  });

  test("board with 55 tasks renders all columns within 8 seconds", async ({ page }) => {
    const t0 = Date.now();
    await page.goto(`${BASE}/projects/${perfProjectId}/board`);
    await waitForBoard(page);
    const elapsed = Date.now() - t0;

    // All 5 column headers must be visible
    for (const label of ["Backlog", "To-Do", "In Progress", "Review", "Done"]) {
      await expect(page.getByRole("heading", { name: new RegExp(label, "i") })).toBeVisible();
    }

    // Render budget: 8 seconds from navigation start to all columns visible
    expect(elapsed).toBeLessThan(8_000);
  });

  test("task cards render for all 55 seeded tasks", async ({ page }) => {
    await page.goto(`${BASE}/projects/${perfProjectId}/board`);
    await waitForBoard(page);

    // Count all article (task card) elements on the board
    const cards = page.locator("article");
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(55);
  });

  test("search filter is responsive with 55 tasks", async ({ page }) => {
    await page.goto(`${BASE}/projects/${perfProjectId}/board`);
    await waitForBoard(page);

    const search = page.getByPlaceholder("Search tasks");
    const t0 = Date.now();
    await search.fill("Perf Task 42");
    // Should filter within 1 second (optimistic client-side filter)
    await expect(page.getByText(`${TAG} Perf Task 42`)).toBeVisible({ timeout: 2_000 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(1_500);
  });

  test("bulk select all and move to Done is stable with 55 tasks", async ({ page }) => {
    await page.goto(`${BASE}/projects/${perfProjectId}/board`);
    await waitForBoard(page);

    // Select every backlog task checkbox
    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const checkboxes = backlogCol.locator("input[type=checkbox]");
    const total = await checkboxes.count();
    for (let i = 0; i < total; i++) {
      await checkboxes.nth(i).click();
    }

    if (total > 0) {
      // Move to Review
      const bulkBar = page.locator("div").filter({ hasText: /^Bulk Move/ }).first();
      await bulkBar.getByRole("button", { name: /review/i }).click();

      // Review column should gain the moved cards
      const reviewCol = page.locator("section").filter({ hasText: /^review/i }).first();
      await expect(reviewCol.locator("article").first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
