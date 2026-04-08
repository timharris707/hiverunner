import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type APIRequestContext, type TestInfo } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3010";
const API = "/api/orchestration";
const COMPANY_SLUG = "neveridle-core";
const TAG = "[VIGIL-TASKS]";
const RUN_ID = process.env.PLAYWRIGHT_RUN_ID ?? String(Date.now());
const SEEDED_TASK_TITLE = `${TAG} Dense Tasks Regression ${RUN_ID}`;
const SCREENSHOT_DIR = path.join(process.cwd(), "docs", "screenshots", "vigil-tasks-density-2026-04-02");

let projectId = "";
let createdTaskId = "";

test.describe.configure({ mode: "serial" });

async function listCompanyProjects(request: APIRequestContext) {
  const res = await request.get(`${API}/projects?company=${encodeURIComponent(COMPANY_SLUG)}`);
  const body = (await res.json()) as {
    projects: Array<{ id: string; name: string; archived?: boolean }>;
  };

  expect(res.status(), `listCompanyProjects failed: ${JSON.stringify(body)}`).toBe(200);
  return body.projects;
}

async function createTask(request: APIRequestContext, resolvedProjectId: string) {
  const res = await request.post(`${API}/tasks`, {
    data: {
      projectId: resolvedProjectId,
      title: SEEDED_TASK_TITLE,
      description: "Seeded by Vigil to verify the dense company tasks registry.",
      priority: "P1",
      type: "feature",
      status: "backlog",
    },
  });
  const body = await res.json();
  expect(res.status(), `createTask failed: ${JSON.stringify(body)}`).toBe(201);
  return (body as { task: { id: string } }).task.id;
}

async function deleteTask(request: APIRequestContext, taskId: string) {
  const res = await request.delete(`${API}/tasks/${taskId}`);
  expect([200, 404], `deleteTask failed with ${res.status()}`).toContain(res.status());
}

async function saveScreenshot(testInfo: TestInfo, name: string) {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  return path.join(SCREENSHOT_DIR, `${testInfo.project.name}-${name}.png`);
}

test.beforeAll(async ({ request }) => {
  const projects = await listCompanyProjects(request);
  const firstLiveProject = projects.find((project) => !project.archived);

  expect(firstLiveProject, `Expected at least one live project for ${COMPANY_SLUG}`).toBeTruthy();
  projectId = firstLiveProject!.id;
  createdTaskId = await createTask(request, projectId);
});

test.afterAll(async ({ request }) => {
  if (createdTaskId) {
    await deleteTask(request, createdTaskId);
  }
});

test("dense tasks page keeps Paperclip-style naming and compact shell", async ({ page }, testInfo) => {
  await page.goto(`${BASE}/companies/${COMPANY_SLUG}/issues`);

  await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_SLUG}/issues$`), {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: /neveridle core tasks/i })).toBeVisible({
    timeout: 15_000,
  });

  const nav = page.locator("nav[aria-label='Primary']");
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: /^tasks$/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^new task$/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^issues$/i })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: /^new issue$/i })).toHaveCount(0);
  await expect(nav.getByText(/operator rail/i)).toHaveCount(0);

  for (const legacyToggle of ["Work", "Projects", "Agents", "Systems", "Company"]) {
    await expect(nav.getByRole("button", { name: new RegExp(`^${legacyToggle}$`, "i") })).toHaveCount(0);
  }

  await expect(page.getByPlaceholder(/search tasks, projects, assignees/i)).toBeVisible();
  await expect(page.getByText(SEEDED_TASK_TITLE).first()).toBeVisible();

  for (const compactColumn of ["Task", "Status", "Assignee", "Project", "Priority", "Updated"]) {
    await expect(page.getByRole("columnheader", { name: new RegExp(`^${compactColumn}$`, "i") })).toBeVisible();
  }

  for (const oversizedStat of ["Total Tasks", "In Progress", "Review Queue", "Blocked"]) {
    await expect(page.getByText(new RegExp(`^${oversizedStat}$`, "i"))).toHaveCount(0);
  }

  const screenshotPath = await saveScreenshot(testInfo, "tasks-page");
  await page.screenshot({ path: screenshotPath, fullPage: true });
});
