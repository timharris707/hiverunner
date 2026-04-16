import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3010";
const API = "/api/orchestration";
const PREFERRED_COMPANY_SLUG = "neveridle-core";

type FixtureProject = {
  id: string;
  slug: string;
  name: string;
};

type FixtureAgent = {
  id: string;
  name: string;
};

type FixtureTask = {
  id: string;
  key: string;
  title: string;
};

let companyId = "";
let companySlug = "";
let fixtureProject: FixtureProject;
let fixtureAgent: FixtureAgent;
let fixtureTask: FixtureTask;

async function getCompanyFixture(request: APIRequestContext): Promise<{ id: string; slug: string }> {
  const res = await request.get(`${API}/companies`);
  expect(res.status()).toBe(200);

  const body = await res.json();
  const companies = body.companies as Array<{ id: string; slug: string }>;
  const company = companies.find((entry) => entry.slug === PREFERRED_COMPANY_SLUG) ?? companies[0];

  expect(company, "Expected at least one company to exist for Henry Voice launch coverage").toBeTruthy();
  return {
    id: company!.id,
    slug: company!.slug,
  };
}

async function openVoiceFromTask(page: Page) {
  await page.getByRole("link", { name: "Talk to Agent" }).click();
  await expect(page).toHaveURL(/\/voice\?/);

  const url = new URL(page.url());
  expect(url.pathname).toBe("/voice");
  expect(url.searchParams.get("companySlug")).toBe(companySlug);
  expect(url.searchParams.get("projectId")).toBe(fixtureProject.id);
  expect(url.searchParams.get("projectSlug")).toBe(fixtureProject.slug);
  expect(url.searchParams.get("taskId")).toBe(fixtureTask.id);
  expect(url.searchParams.get("taskKey")).toBe(fixtureTask.key);
  expect(url.searchParams.get("agentId")).toBe(fixtureAgent.id);
  expect(url.searchParams.get("mode")).toBe("discuss");
  expect(url.searchParams.get("source")).toBe("task-detail");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const company = await getCompanyFixture(request);
  companyId = company.id;
  companySlug = company.slug;

  const suffix = Date.now();

  const projectRes = await request.post(`${API}/projects`, {
    data: {
      companyId,
      name: `[HENRY-VOICE] Launch Project ${suffix}`,
      description: "Playwright coverage for Henry Voice launch entry points.",
      emoji: "🎙️",
      color: "#f59e0b",
    },
  });
  expect(projectRes.status()).toBe(201);
  const projectBody = await projectRes.json();
  fixtureProject = {
    id: projectBody.project.id as string,
    slug: projectBody.project.slug as string,
    name: projectBody.project.name as string,
  };

  const agentRes = await request.post(`${API}/projects/${fixtureProject.id}/agents`, {
    data: {
      name: `[HENRY-VOICE] Agent ${suffix}`,
      emoji: "🧠",
      role: "Product Strategist",
      personality: "Validates Henry Voice launch context.",
    },
  });
  expect(agentRes.status()).toBe(201);
  const agentBody = await agentRes.json();
  fixtureAgent = {
    id: agentBody.agent.id as string,
    name: agentBody.agent.name as string,
  };

  const taskRes = await request.post(`${API}/tasks`, {
    data: {
      projectId: fixtureProject.id,
      title: `[HENRY-VOICE] Task ${suffix}`,
      description: "Verify task-bound Henry Voice launch routing.",
      priority: "P1",
      type: "feature",
    },
  });
  expect(taskRes.status()).toBe(201);
  const taskBody = await taskRes.json();
  fixtureTask = {
    id: taskBody.task.id as string,
    key: (taskBody.task.key as string | undefined) ?? (taskBody.task.id as string),
    title: taskBody.task.title as string,
  };

  const assignRes = await request.patch(`${API}/tasks/${fixtureTask.id}/assign`, {
    data: {
      assignee: fixtureAgent.id,
    },
  });
  expect(assignRes.status()).toBe(200);
});

test.afterAll(async ({ request }) => {
  if (!fixtureProject?.id) {
    return;
  }

  const res = await request.delete(`${API}/projects/${fixtureProject.id}`);
  expect([200, 404]).toContain(res.status());
});

test("task detail launches Henry Voice with task-bound query params and visible context", async ({ page }) => {
  await page.goto(`${BASE}/companies/${companySlug}/tasks/${encodeURIComponent(fixtureTask.key)}`);

  await expect(page.getByRole("link", { name: "Talk to Agent" })).toBeVisible({ timeout: 15_000 });
  await openVoiceFromTask(page);

  await page.route("**/api/voice/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        wsUrl: "wss://voice.test.invalid/ws",
        systemPrompt: "Scoped Henry Voice test prompt",
        voiceName: "Charon",
        binding: {
          scope: "task",
          companySlug: companySlug,
          projectId: fixtureProject.id,
          projectSlug: fixtureProject.slug,
          projectName: fixtureProject.name,
          taskId: fixtureTask.id,
          taskKey: fixtureTask.key,
          taskTitle: fixtureTask.title,
          taskStatus: "backlog",
          agentId: fixtureAgent.id,
          agentName: fixtureAgent.name,
          mode: "discuss",
          source: "task-detail",
        },
      }),
    });
  });

  await page.getByRole("button", { name: /start bound session/i }).click();
  await expect(page.getByText(`[${fixtureTask.key}] ${fixtureTask.title}`)).toBeVisible();
});

test("project overview launches Henry Voice with project-bound query params and visible context", async ({ page }) => {
  await page.goto(`${BASE}/companies/${companySlug}/projects/${encodeURIComponent(fixtureProject.slug)}/overview`);

  const talkToProject = page.getByRole("link", { name: "Talk to Project" });
  await expect(talkToProject).toBeVisible({ timeout: 15_000 });

  await talkToProject.click();
  await expect(page).toHaveURL(/\/voice\?/);

  const url = new URL(page.url());
  expect(url.pathname).toBe("/voice");
  expect(url.searchParams.get("companySlug")).toBe(companySlug);
  expect(url.searchParams.get("projectId")).toBe(fixtureProject.id);
  expect(url.searchParams.get("projectSlug")).toBe(fixtureProject.slug);
  expect(url.searchParams.get("mode")).toBe("discuss");
  expect(url.searchParams.get("source")).toBe("project-overview");
  expect(url.searchParams.get("taskId")).toBeNull();
  expect(url.searchParams.get("agentId")).toBeNull();

  await expect(page.getByText("Project session", { exact: false })).toBeVisible();
  await expect(page.getByText(fixtureProject.name, { exact: false })).toBeVisible();
});
