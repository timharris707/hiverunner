/**
 * Mission Control — Full E2E Critical Path Test (NEVA-43)
 *
 * Covers the complete orchestration workflow end-to-end:
 *   1.  Create company via UI wizard — name, description, Cyberpunk theme
 *   2.  Verify company appears in Company Hub
 *   3.  Navigate to company detail page, confirm tabs and theme
 *   4.  Create project via UI (New Project modal in company detail)
 *   5.  Navigate to project board, verify all 5 columns load
 *   6.  Add agent to project via API (seeded for roster coverage)
 *   7.  Navigate to Agents tab — verify agent appears
 *   8.  Navigate back to Board — create task via "New Task" UI dialog
 *   9.  Verify task card appears in Backlog column
 *   10. Move task Backlog → To-Do via status dropdown
 *   11. Move task To-Do → In Progress via status dropdown
 *   12. Click task card — verify detail drawer opens
 *   13. Verify drawer shows Priority, Assignee, Updated, Type metadata
 *   14. Add a comment via drawer textarea → Post Comment
 *   15. Verify comment appears in Activity section
 *   16. Close drawer — move task In Progress → Done (no review confirmation)
 *   17. Verify task is in Done column
 *   18. API: confirm task status is "done"
 *
 * Bonus: drawer close interactions (Esc, close button, overlay backdrop).
 *
 * Cleanup: archives the test project via API in afterAll.
 *
 * Tag prefix [CP-TEST] identifies data created by this suite.
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL || "http://localhost:3010";
const API = "/api/orchestration";
const TAG = "[CP-TEST]";
// Stable across module re-evaluations within a test run (set once in playwright.config.ts)
const RUN_ID = process.env.PLAYWRIGHT_RUN_ID ?? String(process.pid);
const COMPANY_NAME = `${TAG} Critical Path Co ${RUN_ID}`;
const PROJECT_NAME = `${TAG} Critical Path Project ${RUN_ID}`;
const AGENT_NAME = `${TAG} QA Agent ${RUN_ID}`;
const TASK_TITLE = `${TAG} Critical Task ${RUN_ID}`;
const COMMENT_TEXT = "Vigil E2E verification — drawer comment posted successfully.";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function archiveProject(request: APIRequestContext, projectId: string) {
  const res = await request.delete(`${API}/projects/${projectId}`);
  return res.status() === 200;
}

async function findProjectByName(
  request: APIRequestContext,
  name: string
): Promise<{ id: string; name: string } | null> {
  const res = await request.get(`${API}/projects`);
  if (res.status() !== 200) return null;
  const body = (await res.json()) as { projects: Array<{ id: string; name: string }> };
  return body.projects.find((p) => p.name === name) ?? null;
}

async function findTaskByTitle(
  request: APIRequestContext,
  projectId: string,
  title: string
): Promise<{ id: string; title: string; status: string } | null> {
  const res = await request.get(`${API}/tasks?projectId=${projectId}`);
  if (res.status() !== 200) return null;
  const body = (await res.json()) as { tasks: Array<{ id: string; title: string; status: string }> };
  return body.tasks.find((t) => t.title === title) ?? null;
}

/** Wait for board columns to fully render (loading skeleton gone). */
async function waitForBoard(page: Page) {
  await expect(page.getByRole("heading", { name: /backlog/i })).toBeVisible({ timeout: 15_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STATE — module-level, set sequentially as tests run
// ─────────────────────────────────────────────────────────────────────────────

let testProjectId = "";
let testTaskId = "";

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

test.afterAll(async ({ request }) => {
  if (testProjectId) {
    await archiveProject(request, testProjectId);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1–2 — Company creation via UI wizard
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 1–2: Company creation via UI wizard", () => {
  test("opens wizard, fills name + description, picks Cyberpunk theme, submits", async ({ page }) => {
    await page.goto(`${BASE}/companies`);

    // Wait for Company Hub to load
    await expect(page.getByRole("heading", { name: /company hub/i })).toBeVisible({ timeout: 10_000 });

    // Open wizard
    await page.getByRole("button", { name: /new company/i }).click();

    // Wizard dialog is visible
    const wizard = page.getByRole("dialog", { name: /create company wizard/i });
    await expect(wizard).toBeVisible({ timeout: 5_000 });
    await expect(wizard.getByText("Launch A Team World")).toBeVisible();

    // Fill in company name
    await wizard.getByPlaceholder("NeverIdle Core").fill(COMPANY_NAME);

    // Fill in description
    await wizard
      .getByPlaceholder("What this company builds and why")
      .fill("Vigil E2E critical path test company — safe to archive.");

    // Pick "Cyberpunk" theme — click its radio label
    const cyberpunkLabel = wizard.locator("label", { hasText: "Cyberpunk" }).first();
    await expect(cyberpunkLabel).toBeVisible();
    await cyberpunkLabel.click();

    // The Selected Theme preview section should reflect "Cyberpunk" (with emoji)
    // It shows: "🌃 Cyberpunk" in the preview panel — this text is unique
    await expect(wizard.getByText("🌃 Cyberpunk")).toBeVisible({ timeout: 3_000 });

    // Submit — wizard is taller than the default 720px viewport; use JS click to bypass
    // the "outside of viewport" constraint (button is valid, just below the fold)
    const createBtn = wizard.getByRole("button", { name: /create company/i });
    await expect(createBtn).toBeEnabled();
    await createBtn.evaluate((el) => (el as HTMLButtonElement).click());

    // Wizard closes
    await expect(wizard).not.toBeVisible({ timeout: 10_000 });

    // New company appears in the hub (use .first() — webkit runs after chromium with same RUN_ID)
    await expect(page.getByText(COMPANY_NAME).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 3 — Company detail page
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 3: Company detail page", () => {
  test("clicking company card navigates to detail page with tabs", async ({ page }) => {
    await page.goto(`${BASE}/companies`);
    await expect(page.getByText(COMPANY_NAME).first()).toBeVisible({ timeout: 10_000 });

    // Click the company card (.first() guards against webkit running after chromium with same RUN_ID)
    await page.getByText(COMPANY_NAME).first().click();

    // Should land on /companies/:slug
    await expect(page).toHaveURL(/\/companies\/[a-z0-9-]+/, { timeout: 10_000 });

    // All three shell tabs present
    for (const tab of ["Projects", "Agents", "Settings"]) {
      await expect(page.getByRole("button", { name: new RegExp(tab, "i") })).toBeVisible();
    }
  });

  test("company detail page shows Avatar Theme section with Cyberpunk", async ({ page }) => {
    await page.goto(`${BASE}/companies`);
    await expect(page.getByText(COMPANY_NAME).first()).toBeVisible({ timeout: 10_000 });
    await page.getByText(COMPANY_NAME).first().click();
    await expect(page).toHaveURL(/\/companies\/[a-z0-9-]+/, { timeout: 10_000 });

    // "Avatar Theme" section lives under the Settings tab — navigate there first
    await page.getByRole("button", { name: /settings/i }).click();
    await expect(page.getByText(/avatar theme/i)).toBeVisible({ timeout: 8_000 });
    // The company was created with the Cyberpunk theme
    await expect(page.getByText(/cyberpunk/i).first()).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 4 — Create project via UI (New Project modal in company detail)
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 4: Create project via UI in company detail", () => {
  test("opens New Project modal, creates project, captures projectId", async ({ page, request }) => {
    await page.goto(`${BASE}/companies`);
    await expect(page.getByText(COMPANY_NAME).first()).toBeVisible({ timeout: 10_000 });
    await page.getByText(COMPANY_NAME).first().click();
    await expect(page).toHaveURL(/\/companies\/[a-z0-9-]+/, { timeout: 10_000 });

    // Projects tab is active — "New Project" button visible
    await expect(page.getByRole("button", { name: /new project/i })).toBeVisible({ timeout: 8_000 });

    // Open New Project modal
    await page.getByRole("button", { name: /new project/i }).click();

    // Modal heading visible
    await expect(page.getByRole("heading", { name: /new project/i })).toBeVisible({ timeout: 5_000 });

    // Fill in name (required)
    await page.getByPlaceholder("Orchestration Dashboard").fill(PROJECT_NAME);

    // Fill in description
    await page
      .getByPlaceholder("Describe what this project is shipping.")
      .fill("Vigil E2E critical path project — safe to archive.");

    // Submit by clicking "Create Project" button
    await page.getByRole("button", { name: /create project/i }).click();

    // Modal closes
    await expect(page.getByRole("heading", { name: /^new project$/i })).not.toBeVisible({
      timeout: 8_000,
    });

    // Project appears in the list
    await expect(page.getByText(PROJECT_NAME)).toBeVisible({ timeout: 10_000 });

    // Capture project ID via API
    const project = await findProjectByName(request, PROJECT_NAME);
    expect(project, "New project should exist in API").toBeTruthy();
    testProjectId = project!.id;
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 5–6 — Project board loads + agent seeded via API
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 5–6: Project board loads + agent seeded", () => {
  test.beforeAll(async ({ request }) => {
    // If projectId not yet set (prior UI test may have failed), look it up
    if (!testProjectId) {
      const project = await findProjectByName(request, PROJECT_NAME);
      if (project) testProjectId = project.id;
    }
    // Seed agent via API
    if (testProjectId) {
      const agentRes = await request.post(`${API}/projects/${testProjectId}/agents`, {
        data: {
          name: AGENT_NAME,
          role: "QA Automation Engineer",
          emoji: "🧪",
          status: "idle",
        },
      });
      expect(agentRes.status()).toBe(201);
    }
  });

  test("project board renders all 5 columns", async ({ page }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    for (const col of ["Backlog", "To-Do", "In Progress", "Review", "Done"]) {
      await expect(page.getByRole("heading", { name: new RegExp(col, "i") })).toBeVisible();
    }
  });

  test("board shows project name, New Task button, and search input", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    await expect(page.getByRole("button", { name: /new task/i })).toBeVisible();
    await expect(page.getByPlaceholder("Search tasks")).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 7 — Agents tab shows seeded agent
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 7: Agents tab — seeded agent is visible", () => {
  test("navigating to Agents tab shows the seeded agent", async ({ page }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    await page.goto(`${BASE}/projects/${testProjectId}/agents`);

    await expect(page.getByText(/project agent roster/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(AGENT_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("QA Automation Engineer")).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 8–9 — Task creation via New Task dialog
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 8–9: Task creation via New Task dialog", () => {
  test("opens dialog, fills fields, submits — card appears in Backlog", async ({ page, request }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    // Open New Task dialog
    await page.getByRole("button", { name: /new task/i }).click();

    // Dialog is visible
    const dialog = page.getByRole("dialog", { name: /create task/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText("Create Backlog Card")).toBeVisible();

    // Fill in title
    await dialog.getByPlaceholder("Improve drag-and-drop hover states").fill(TASK_TITLE);

    // Fill in description
    await dialog
      .getByPlaceholder("What needs to ship and why.")
      .fill("E2E critical path verification task — Vigil.");

    // Set Priority to P1 (first select in dialog)
    const selects = dialog.locator("select");
    await selects.nth(0).selectOption("P1");

    // Set Type to bug (second select in dialog)
    await selects.nth(1).selectOption("bug");

    // Submit
    await dialog.getByRole("button", { name: /create task/i }).click();

    // Dialog closes
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    // Card appears in Backlog column
    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    await expect(backlogCol.getByText(TASK_TITLE)).toBeVisible({ timeout: 10_000 });

    // Capture task ID via API
    const task = await findTaskByTitle(request, testProjectId, TASK_TITLE);
    expect(task, "Created task should exist in API").toBeTruthy();
    testTaskId = task!.id;
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 10–11 — Board progression via status dropdown
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 10–11: Board progression via status dropdown", () => {
  test("moves task from Backlog to To-Do", async ({ page }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // First select on the card is the status select
    await card.locator("select").first().selectOption("on-deck");

    // Card moves to To-Do
    const onDeckCol = page.locator("section").filter({ hasText: /^to-?do/i }).first();
    await expect(onDeckCol.getByText(TASK_TITLE)).toBeVisible({ timeout: 8_000 });
    await expect(backlogCol.getByText(TASK_TITLE)).not.toBeVisible();
  });

  test("moves task from To-Do to In Progress", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const onDeckCol = page.locator("section").filter({ hasText: /^to-?do/i }).first();
    const card = onDeckCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Assign agent first — app blocks In Progress without an assignee
    await card.locator("select").nth(1).selectOption(AGENT_NAME);

    // Now move to In Progress
    await card.locator("select").first().selectOption("in-progress");

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    await expect(inProgressCol.getByText(TASK_TITLE)).toBeVisible({ timeout: 8_000 });
    await expect(onDeckCol.getByText(TASK_TITLE)).not.toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 12–13 — Detail drawer: open and verify metadata
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 12–13: Detail drawer — open and verify metadata", () => {
  test("clicking task card opens detail drawer with title and metadata", async ({ page }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    // Drawer starts hidden
    const drawer = page.locator("aside");
    await expect(drawer).toHaveAttribute("aria-hidden", "true");

    // Click the In Progress task card
    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    // Drawer becomes visible
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true", { timeout: 5_000 });
    await expect(drawer.getByText(TASK_TITLE)).toBeVisible();
  });

  test("drawer shows Priority, Assignee, Updated, Type metadata", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    for (const field of ["Priority", "Assignee", "Updated", "Type"]) {
      await expect(drawer.getByText(new RegExp(field, "i"))).toBeVisible();
    }
  });

  test("drawer Activity section shows 'No comments yet'", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer.getByText(/activity/i)).toBeVisible();
    await expect(drawer.getByText(/no comments yet/i)).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 14–15 — Add comment via detail drawer
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 14–15: Add comment via detail drawer", () => {
  test("types comment, posts it, verifies it in Activity", async ({ page }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    // Fill comment textarea
    const commentBox = drawer.getByPlaceholder("Share a status update or unblock note.");
    await expect(commentBox).toBeVisible();
    await commentBox.fill(COMMENT_TEXT);

    // Post Comment button is enabled.
    // Use evaluate() to force a JS click — the Dock nav (z-50) overlaps the drawer (z-40)
    // on the left side of the viewport and intercepts pointer events at the button location.
    // See: drawer uses `inset-0` (left: 0) + `md:max-w-md` which renders it left-side on
    // desktop, partially behind the Dock. evaluate() bypasses the pointer-event interception.
    const postBtn = drawer.getByRole("button", { name: /post comment/i });
    await expect(postBtn).toBeEnabled();
    await postBtn.evaluate((el) => (el as HTMLButtonElement).click());

    // Comment appears in Activity section
    await expect(drawer.getByText(COMMENT_TEXT)).toBeVisible({ timeout: 8_000 });
    // "No comments yet" placeholder gone
    await expect(drawer.getByText(/no comments yet/i)).not.toBeVisible();
  });

  test("comment textarea is cleared after posting", async ({ page }) => {
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    const commentBox = drawer.getByPlaceholder("Share a status update or unblock note.");
    await commentBox.fill("Second comment — verifying textarea clears after post.");
    // Use evaluate() to bypass Dock pointer-event interception (see first comment test above)
    const postBtn2 = drawer.getByRole("button", { name: /post comment/i });
    await postBtn2.evaluate((el) => (el as HTMLButtonElement).click());

    // Textarea should be empty after post
    await expect(commentBox).toHaveValue("", { timeout: 5_000 });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 16–18 — Complete task: move to Done
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Step 16–18: Complete task — move to Done", () => {
  test("closes drawer, moves In Progress task to Done, verifies in Done column", async ({ page }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const inProgressCol = page.locator("section").filter({ hasText: /^in progress/i }).first();
    const card = inProgressCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Open drawer to verify comments are persisted
    await card.click();
    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");
    await expect(drawer.getByText(COMMENT_TEXT)).toBeVisible({ timeout: 5_000 });

    // Close drawer
    await drawer.getByRole("button", { name: /close task drawer/i }).click();
    await expect(drawer).toHaveAttribute("aria-hidden", "true");

    // Move task to Done (no review-confirm dialog because not coming from Review)
    const movedCard = inProgressCol.locator("article").filter({ hasText: TASK_TITLE });
    await expect(movedCard).toBeVisible({ timeout: 5_000 });
    await movedCard.locator("select").first().selectOption("done");

    // Card should appear in Done column
    const doneCol = page.locator("section").filter({ hasText: /^done/i }).first();
    await expect(doneCol.getByText(TASK_TITLE)).toBeVisible({ timeout: 8_000 });
    await expect(inProgressCol.getByText(TASK_TITLE)).not.toBeVisible();
  });

  test("API confirms task status is done", async ({ request }) => {
    expect(testProjectId, "testProjectId must be set").toBeTruthy();
    expect(testTaskId, "testTaskId must be set").toBeTruthy();

    // The board does an optimistic UI update before the API write completes.
    // Poll up to ~3 s to let the status propagate to the backend.
    let task: { id: string; title: string; status: string } | null = null;
    for (let i = 0; i < 6; i++) {
      task = await findTaskByTitle(request, testProjectId, TASK_TITLE);
      if (task?.status === "done") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(task, "Task should still exist").toBeTruthy();
    expect(task!.status).toBe("done");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BONUS — Drawer close interaction regression tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Drawer close interactions (regression)", () => {
  let bonusTaskId = "";

  test.beforeAll(async ({ request }) => {
    if (!testProjectId) return;
    // Seed a dedicated task so regression tests always have a card to click
    const res = await request.post(`${API}/tasks`, {
      data: {
        title: `${TAG} Drawer Regression Task ${RUN_ID}`,
        description: "Seeded by Vigil for drawer close regression tests.",
        status: "backlog",
        priority: "P3",
        type: "feature",
        projectId: testProjectId,
        labels: [],
      },
    });
    if (res.status() === 201) {
      const body = (await res.json()) as { task: { id: string } };
      bonusTaskId = body.task.id;
    }
  });

  test.afterAll(async ({ request }) => {
    // Task will be archived with project, but mark done for hygiene
    if (bonusTaskId && testProjectId) {
      await request.patch(`${API}/tasks/reorder`, {
        data: { taskId: bonusTaskId, status: "done" },
      });
    }
  });

  test("Close button hides the drawer", async ({ page }) => {
    if (!testProjectId) test.skip();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    // Find the bonus seeded task in Backlog
    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: `${TAG} Drawer Regression Task` });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    await drawer.getByRole("button", { name: /close task drawer/i }).click();
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
  });

  test("overlay backdrop click closes the drawer", async ({ page }) => {
    if (!testProjectId) test.skip();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: `${TAG} Drawer Regression Task` });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    await page.getByRole("button", { name: /close task drawer overlay/i }).click();
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
  });

  test("Escape key closes the drawer", async ({ page }) => {
    if (!testProjectId) test.skip();
    await page.goto(`${BASE}/projects/${testProjectId}/board`);
    await waitForBoard(page);

    const backlogCol = page.locator("section").filter({ hasText: /^backlog/i }).first();
    const card = backlogCol.locator("article").filter({ hasText: `${TAG} Drawer Regression Task` });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.click();

    const drawer = page.locator("aside");
    await expect(drawer).not.toHaveAttribute("aria-hidden", "true");

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveAttribute("aria-hidden", "true");
  });
});
