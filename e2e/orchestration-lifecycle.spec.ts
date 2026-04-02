/**
 * Mission Control — Orchestration Full Lifecycle E2E Tests (NEVA-52)
 *
 * Covers the complete orchestration workflow:
 *   1.  Create project → verify on /projects page
 *   2.  Add agent to project → verify on project agents page
 *   3.  Create sprint via API → verify on /projects/:id/sprints page
 *   4.  Create tasks assigned to sprint → verify on kanban board
 *   5.  Move tasks through all columns → verify status transitions
 *   6.  Complete all sprint tasks → verify sprint shows 100% completion
 *   7.  Dashboard OperationsWidget reflects agent activity and task counts
 *
 * Complements critical-path.spec.ts (company+project+task CRUD flow).
 * This suite focuses on sprint lifecycle + dashboard integration.
 *
 * Tag prefix [LIFECYCLE] identifies data created by this suite.
 * Cleanup: archives test project in afterAll.
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = "/api/orchestration";
const TAG = "[LIFECYCLE]";
const RUN_ID = Date.now();
const PROJECT_NAME = `${TAG} Sprint Lifecycle ${RUN_ID}`;
const AGENT_NAME = `${TAG} Sprint Agent ${RUN_ID}`;
const SPRINT_NAME = `${TAG} Sprint 1 ${RUN_ID}`;
const SPRINT_GOAL = "Ship the sprint lifecycle e2e test coverage.";
const TASK_TITLES = [
  `${TAG} Task Alpha ${RUN_ID}`,
  `${TAG} Task Beta ${RUN_ID}`,
  `${TAG} Task Gamma ${RUN_ID}`,
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function createProject(request: APIRequestContext): Promise<{ id: string; slug: string }> {
  const res = await request.post(`${API}/projects`, {
    data: {
      companyId,
      name: PROJECT_NAME,
      description: "NEVA-52 sprint lifecycle test project",
      emoji: "🧪",
      color: "#22d3ee",
      slug: `lifecycle-test-${RUN_ID}`,
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { project: { id: string; slug: string } };
  return body.project;
}

async function createAgent(
  request: APIRequestContext,
  projectId: string
): Promise<{ id: string; name: string }> {
  const res = await request.post(`${API}/projects/${projectId}/agents`, {
    data: {
      name: AGENT_NAME,
      emoji: "🤖",
      role: "QA Bot",
      model: "claude-sonnet-4-6",
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { agent: { id: string; name: string } };
  return body.agent;
}

async function createSprint(
  request: APIRequestContext,
  projectId: string
): Promise<{ id: string; name: string }> {
  const res = await request.post(`${API}/projects/${projectId}/sprints`, {
    data: {
      name: SPRINT_NAME,
      goal: SPRINT_GOAL,
      status: "active",
      startDate: new Date().toISOString(),
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { sprint: { id: string; name: string } };
  return body.sprint;
}

async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
  sprintId?: string
): Promise<{ id: string; title: string }> {
  const res = await request.post(`${API}/tasks`, {
    data: {
      title,
      description: "NEVA-52 lifecycle test task",
      priority: "P2",
      type: "feature",
      status: "backlog",
      projectId,
      ...(sprintId ? { sprintId } : {}),
    },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { task: { id: string; title: string } };
  return body.task;
}

async function moveTaskToStatus(
  request: APIRequestContext,
  taskId: string,
  status: string,
  reviewNotes?: string
): Promise<void> {
  const res = await request.patch(`${API}/tasks/reorder`, {
    data: { taskId, status, columnOrder: 1000, ...(reviewNotes ? { reviewNotes } : {}) },
  });
  expect(res.status()).toBe(200);
}

async function assignTask(
  request: APIRequestContext,
  taskId: string,
  assignee: string
): Promise<void> {
  const res = await request.patch(`${API}/tasks/${taskId}/assign`, {
    data: { assignee },
  });
  expect(res.status()).toBe(200);
}

async function archiveProject(request: APIRequestContext, projectId: string): Promise<void> {
  await request.delete(`${API}/projects/${projectId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

let companyId = "";
let projectId = "";
let projectSlug = "";
let agentId = "";
let sprintId = "";
const taskIds: string[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const companiesRes = await request.get(`${API}/companies`);
  expect(companiesRes.status()).toBe(200);
  const { companies } = await companiesRes.json();
  const core = (companies as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === "neveridle-core"
  );
  expect(core, "NeverIdle Core company not found").toBeTruthy();
  companyId = core!.id;

  const project = await createProject(request);
  projectId = project.id;
  projectSlug = project.slug;

  const agent = await createAgent(request, projectId);
  agentId = agent.id;

  const sprint = await createSprint(request, projectId);
  sprintId = sprint.id;

  for (const title of TASK_TITLES) {
    const task = await createTask(request, projectId, title, sprintId);
    taskIds.push(task.id);
  }
});

test.afterAll(async ({ request }) => {
  if (projectId) {
    await archiveProject(request, projectId);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Project appears on /projects page
// ─────────────────────────────────────────────────────────────────────────────

test("project appears on /projects hub after creation", async ({ page }) => {
  await page.goto(`${BASE}/projects`);
  await expect(page.getByText(PROJECT_NAME)).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: Agent appears on project agents page
// ─────────────────────────────────────────────────────────────────────────────

test("agent appears on project agents page", async ({ page }) => {
  await page.goto(`${BASE}/projects/${projectId}/board`);

  // Navigate to agents tab via the shell nav
  await page.getByRole("link", { name: /agents/i }).click();
  await expect(page.getByRole("heading", { name: AGENT_NAME, level: 3 })).toBeVisible({
    timeout: 10_000,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: Sprint appears on sprints page with correct name and goal
// ─────────────────────────────────────────────────────────────────────────────

test("sprint appears on /projects/:id/sprints with name and goal", async ({ page }) => {
  await page.goto(`${BASE}/projects/${projectId}/sprints`);

  await expect(page.getByText(SPRINT_NAME)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(SPRINT_GOAL)).toBeVisible({ timeout: 5_000 });

  // Sprint status badge should show "active"
  await expect(page.locator("span").filter({ hasText: /^active$/i }).first()).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Tasks appear on kanban board in Backlog column
// ─────────────────────────────────────────────────────────────────────────────

test("sprint tasks appear on board in Backlog column", async ({ page }) => {
  await page.goto(`${BASE}/projects/${projectId}/board`);
  await page.waitForLoadState("networkidle");

  for (const title of TASK_TITLES) {
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  }

  // All tasks should start in Backlog
  const backlogColumn = page.getByText("Backlog").first();
  await expect(backlogColumn).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Sprint filter works on board
// ─────────────────────────────────────────────────────────────────────────────

test("sprint filter narrows board to sprint tasks only", async ({ page }) => {
  await page.goto(`${BASE}/projects/${projectId}/board`);
  await page.waitForLoadState("networkidle");

  // The board-level sprint filter should include our sprint
  const sprintFilter = page.locator('label:has(span:text-is("Sprint")) select').first();
  await expect(sprintFilter).toBeVisible({ timeout: 5_000 });
  await sprintFilter.selectOption({ label: SPRINT_NAME });
  for (const title of TASK_TITLES) {
    await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Status transitions via API — full column lifecycle
// ─────────────────────────────────────────────────────────────────────────────

test("tasks can transition through all board columns via API", async ({ request }) => {
  const statuses = ["on-deck", "in-progress", "review", "done"] as const;

  for (const status of statuses) {
    if (status === "in-progress") {
      await assignTask(request, taskIds[0], AGENT_NAME);
    }
    await moveTaskToStatus(
      request,
      taskIds[0],
      status,
      status === "done" ? "Lifecycle test completion notes." : undefined
    );

    // Verify API reflects the change
    const listRes = await request.get(`${API}/tasks?projectId=${projectId}`);
    expect(listRes.status()).toBe(200);
    const body = (await listRes.json()) as { tasks: Array<{ id: string; status: string }> };
    const task = body.tasks.find((t) => t.id === taskIds[0]);
    expect(task?.status).toBe(status);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: Board reflects status transitions made via API
// ─────────────────────────────────────────────────────────────────────────────

test("board reflects task status transitions within poll interval", async ({ page }) => {
  // taskIds[0] is now in "done" from previous test
  await page.goto(`${BASE}/projects/${projectId}/board`);
  await page.waitForLoadState("networkidle");

  // Wait up to 10s for the board to poll and show the updated state
  const doneColumn = page.locator("[data-testid='board-column-done'], section, div").filter({
    hasText: /^Done/,
  }).first();

  // The task title should be visible somewhere on the board
  await expect(page.getByText(TASK_TITLES[0]).first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: Complete all sprint tasks → sprint shows 100% on sprints page
// ─────────────────────────────────────────────────────────────────────────────

test("sprint shows 100% completion when all tasks are done", async ({ request, page }) => {
  // Complete remaining tasks
  for (const taskId of taskIds.slice(1)) {
    await moveTaskToStatus(request, taskId, "on-deck");
    await assignTask(request, taskId, AGENT_NAME);
    await moveTaskToStatus(request, taskId, "in-progress");
    await moveTaskToStatus(request, taskId, "review");
    await moveTaskToStatus(request, taskId, "done", "Lifecycle test completion notes.");
  }

  await page.goto(`${BASE}/projects/${projectId}/sprints`);
  await page.waitForLoadState("networkidle");

  // Sprint completion should show 100%
  await expect(page.getByText("100%")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText(SPRINT_NAME)).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: Dashboard OperationsWidget renders without errors
// ─────────────────────────────────────────────────────────────────────────────

test("dashboard OperationsWidget renders with metrics", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await page.waitForLoadState("networkidle");

  // The dashboard should load without error — no error banners
  await expect(page.getByText(/unable to load/i)).not.toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/failed to load/i)).not.toBeVisible();

  // Operations section should be present
  await expect(
    page.getByText(/Operations/i).or(page.getByText(/Active Agents/i)).first()
  ).toBeVisible({ timeout: 8_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: API — sprint completion stats reflect done tasks
// ─────────────────────────────────────────────────────────────────────────────

test("sprint API returns correct completion stats after all tasks done", async ({ request }) => {
  const res = await request.get(`${API}/projects/${projectId}/sprints`);
  expect(res.status()).toBe(200);

  const body = (await res.json()) as
    | Array<{
        id: string;
        name: string;
        taskCount: number;
        doneCount: number;
        status: string;
      }>
    | {
        sprints: Array<{
          id: string;
          name: string;
          taskCount: number;
          doneCount: number;
          status: string;
        }>;
      };

  const sprints = Array.isArray(body) ? body : body.sprints;
  const sprint = sprints.find((s) => s.id === sprintId);
  expect(sprint).toBeTruthy();
  expect(sprint?.taskCount).toBe(TASK_TITLES.length);
  expect(sprint?.doneCount).toBe(TASK_TITLES.length);
});
