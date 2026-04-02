import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = "/api/orchestration";
const COMPANY_SLUG = "neveridle-core";
const TAG = "[S11-NAV]";
const RUN_ID = process.env.PLAYWRIGHT_RUN_ID ?? String(Date.now());
const SEEDED_TASK_TITLE = `${TAG} Seeded Workflow Task ${RUN_ID}`;
const CREATED_TASK_TITLE = `${TAG} Created Task ${RUN_ID}`;

type CompanyAgent = {
  id: string;
  name: string;
  role?: string;
};

type CompanyProject = {
  id: string;
  name: string;
  slug?: string;
};

let companyId = "";
let projectId = "";
let projectName = "";
let seededAgent: CompanyAgent | null = null;
const createdTaskIds: string[] = [];

test.describe.configure({ mode: "serial" });

async function getJsonWithRetry<T>(
  request: APIRequestContext,
  url: string,
  attempts = 3
): Promise<{ status: number; body: T }> {
  let lastStatus = 0;
  let lastBody: unknown = null;

  for (let index = 0; index < attempts; index += 1) {
    const res = await request.get(url);
    lastStatus = res.status();
    lastBody = await res.json().catch(() => null);
    if (lastStatus === 200) {
      return { status: lastStatus, body: lastBody as T };
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (index + 1)));
  }

  return { status: lastStatus, body: lastBody as T };
}

async function getDefaultCompanyId(request: APIRequestContext): Promise<string> {
  const { status, body } = await getJsonWithRetry<{
    companies: Array<{ id: string; slug: string }>;
  }>(request, `${API}/companies`);
  expect(status).toBe(200);
  const company = body.companies.find((row) => row.slug === COMPANY_SLUG);
  expect(company, `Company ${COMPANY_SLUG} must exist for nav parity suite`).toBeTruthy();
  return company!.id;
}

async function listCompanyAgents(request: APIRequestContext): Promise<CompanyAgent[]> {
  const { status, body } = await getJsonWithRetry<{ agents: CompanyAgent[] }>(
    request,
    `${API}/companies/${COMPANY_SLUG}/agents`
  );
  expect(status).toBe(200);
  return body.agents;
}

async function listCompanyProjects(request: APIRequestContext): Promise<CompanyProject[]> {
  const { status, body } = await getJsonWithRetry<{ projects: CompanyProject[] }>(
    request,
    `${API}/projects?company=${encodeURIComponent(COMPANY_SLUG)}`
  );
  expect(status).toBe(200);
  return body.projects;
}

async function createTask(
  request: APIRequestContext,
  title: string,
  assignee?: string
): Promise<string> {
  const res = await request.post(`${API}/tasks`, {
    data: {
      projectId,
      title,
      description: "Seeded by Sprint 11 nav parity smoke suite.",
      priority: "P1",
      type: "feature",
      status: "backlog",
      ...(assignee ? { assignee } : {}),
    },
  });
  const body = await res.json();
  expect(res.status(), `createTask failed: ${JSON.stringify(body)}`).toBe(201);
  const taskId = (body as { task: { id: string } }).task.id;
  createdTaskIds.push(taskId);
  return taskId;
}

async function deleteCreatedTasks(request: APIRequestContext) {
  for (const taskId of createdTaskIds) {
    const res = await request.delete(`${API}/tasks/${taskId}`);
    expect([200, 404]).toContain(res.status());
  }
}

async function expectNoCrashShell(page: Page) {
  await expect(page.getByText(/company not found|dashboard unavailable|unable to load|profile not found/i)).toHaveCount(0);
}

test.beforeAll(async ({ request }) => {
  companyId = await getDefaultCompanyId(request);
  const projects = await listCompanyProjects(request);
  expect(projects.length, "Expected at least one seeded company project").toBeGreaterThan(0);
  projectId = projects[0].id;
  projectName = projects[0].name;
  const agents = await listCompanyAgents(request);
  expect(agents.length, "Expected at least one seeded company agent").toBeGreaterThan(0);
  seededAgent = agents[0];
  await createTask(request, SEEDED_TASK_TITLE, seededAgent?.id);
});

test.afterAll(async ({ request }) => {
  await deleteCreatedTasks(request);
});

test("Dashboard route opens a real company dashboard", async ({ page }) => {
  await page.goto(`${BASE}/companies/${COMPANY_SLUG}/dashboard`);

  await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_SLUG}/dashboard$`));
  await expect(page.getByRole("heading", { level: 1, name: /neveridle core/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/company dashboard/i)).toBeVisible();
  await expect(page.getByText(/company agents/i)).toBeVisible();
  await expect(page.getByText(/recent company activity/i)).toBeVisible();
  await expectNoCrashShell(page);
});

test("Inbox route shows seeded work with meaningful board content", async ({ page }) => {
  await page.goto(`${BASE}/companies/${COMPANY_SLUG}/dashboard`);

  const nav = page.locator("nav[aria-label='Primary']");
  await expect(nav).toBeVisible({ timeout: 15_000 });
  await nav.getByRole("link", { name: /^inbox$/i }).click();

  await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_SLUG}/board$`));
  await expect(page.getByPlaceholder(/search company board/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^backlog$/i })).toBeVisible();
  await expectNoCrashShell(page);
});

test("Left rail cleanup keeps section structure and wording stable", async ({ page }) => {
  await page.goto(`${BASE}/companies/${COMPANY_SLUG}/dashboard`);

  const nav = page.locator("nav[aria-label='Primary']");
  await expect(nav).toBeVisible({ timeout: 15_000 });

  await expect(nav.getByText(/^core$/i)).toHaveCount(0);
  await expect(nav.getByRole("link", { name: /^new task$/i })).toBeVisible();
  await expect(nav.getByRole("link", { name: /^new issue$/i })).toHaveCount(0);

  const projectsToggle = nav.getByRole("button", { name: /^projects$/i });
  await expect(projectsToggle).toBeVisible();
  await expect(nav.getByRole("button", { name: /^create project$/i })).toBeVisible();

  const agentsToggle = nav.getByRole("button", { name: /^agents$/i });
  await expect(agentsToggle).toBeVisible();
  await expect(nav.getByRole("button", { name: /^create agent$/i })).toBeVisible();

  const systemsToggle = nav.getByRole("button", { name: /^systems$/i });
  await expect(systemsToggle).toBeVisible();
  await systemsToggle.click();

  const systemsLinks = [
    { label: "Sessions", href: "/sessions" },
    { label: "Logs", href: "/logs" },
    { label: "Files", href: "/files" },
    { label: "Costs", href: "/costs" },
    { label: "Reliability", href: "/reliability" },
    { label: "Cron", href: "/cron" },
  ];

  for (const item of systemsLinks) {
    await expect(
      nav.locator(`a[href="${item.href}"]`).last(),
      `SYSTEMS | ${item.label} link missing from grouped systems rail`
    ).toBeVisible();
  }
});

test("New Task route creates a real task and lands in the company registry", async ({ page }) => {
  await page.goto(`${BASE}/companies/${COMPANY_SLUG}/dashboard`);

  const nav = page.locator("nav[aria-label='Primary']");
  await expect(nav).toBeVisible({ timeout: 15_000 });
  await nav.getByRole("link", { name: /new task/i }).click();

  await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_SLUG}/issues/new$`));
  await expect(page.getByRole("heading", { level: 1, name: /create task/i })).toBeVisible();

  await page.getByPlaceholder(/implement company inbox endpoint/i).fill(CREATED_TASK_TITLE);
  await page
    .getByPlaceholder(/acceptance criteria, context, and expected outcomes/i)
    .fill("Created by the Sprint 11 nav parity suite.");
  await page.getByRole("combobox", { name: /^project$/i }).selectOption({
    label: projectName,
  });
  await page.getByRole("button", { name: /create task/i }).click();

  await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_SLUG}/issues\\?created=`), {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: /neveridle core tasks/i })).toBeVisible();
  await expect(page.getByText(CREATED_TASK_TITLE).first()).toBeVisible();
  await expectNoCrashShell(page);
});

test("Tasks route resolves to the company issue registry instead of a blank shell", async ({
  page,
}) => {
  await page.goto(`${BASE}/tasks`);

  await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_SLUG}/issues$`), {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: /neveridle core issues/i })).toBeVisible();
  await expect(page.getByPlaceholder(/search issues, projects, assignees/i)).toBeVisible();
  await expect(page.getByText(SEEDED_TASK_TITLE).first()).toBeVisible();
  await expectNoCrashShell(page);
});

test("Agent detail route opens a real profile with assigned work", async ({ page }) => {
  expect(seededAgent, "Seeded agent must be available").toBeTruthy();

  await page.goto(`${BASE}/companies/${COMPANY_SLUG}/agents/${seededAgent!.id}`);

  await expect(page).toHaveURL(
    new RegExp(`/companies/${COMPANY_SLUG}/agents/${seededAgent!.id}$`)
  );
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(seededAgent!.name, "i") })
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/agent profile/i)).toBeVisible();
  await expect(page.getByText(/current assigned tasks/i)).toBeVisible();
  await expect(page.getByText(SEEDED_TASK_TITLE).first()).toBeVisible();
  await expectNoCrashShell(page);
});
