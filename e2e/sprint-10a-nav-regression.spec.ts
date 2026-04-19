/**
 * Mission Control — Sprint 10A Navigation & Layout Regression Suite
 *
 * Covers the new company-scoped navigation hierarchy introduced in Sprint 10A
 * (NEVA-157 / NEVA-164). Verifies:
 *
 *   1.  Sidebar hierarchy — Primary nav renders with company header, Work section,
 *       Projects section, and Agents section loaded from real orchestration data.
 *   2.  Company dashboard (/companies/neveridle-core) — page loads, key sections visible.
 *   3.  Company board (/companies/neveridle-core/board) — loads, search filter works.
 *   4.  Company team (/companies/neveridle-core/team) — renders agent roster.
 *   5.  Company projects (/companies/neveridle-core/projects) — renders project list.
 *   6.  Agent detail route (/agents/[agentId]) — page loads with agent metadata.
 *   7.  Project board navigation — seeded test project, board columns visible.
 *   8.  Legacy redirect verification — /tasks, /agents, /projects redirect correctly.
 *   9.  Non-orchestration pages not regressed — /trading, /ideas, /search load.
 *
 * Strategy:
 *   - Uses real orchestration data (NeverIdle Core company + agents) for sections 1–6.
 *   - Creates an ephemeral [S10A-TEST] project for the project board test (section 7).
 *   - Cleans up the test project in afterAll.
 *   - Serial workers to prevent data races.
 *
 * Failure format per Gater spec: "ROUTE | TEST | expected → actual"
 */

import { test, expect, type APIRequestContext } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.BASE_URL || "http://localhost:3010";
const API = "/api/orchestration";
const TAG = "[S10A-TEST]";
const COMPANY_SLUG = "neveridle-core";

type LiveProject = {
  id: string;
  slug: string;
  name: string;
};

type LiveAgent = {
  id: string;
  name: string;
  role: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getDefaultCompanyId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/companies`);
  const body = await res.json();
  const core = (body.companies as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === COMPANY_SLUG
  );
  if (!core) throw new Error(`Company "${COMPANY_SLUG}" not found in orchestration DB`);
  return core.id;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getCompanyProjects(
  request: APIRequestContext,
  companySlug: string
): Promise<LiveProject[]> {
  const res = await request.get(`${API}/projects?company=${encodeURIComponent(companySlug)}`);
  expect(res.status(), "getCompanyProjects: expected 200").toBe(200);
  const body = await res.json();
  return (body.projects as Array<{ id: string; slug?: string; name: string }>).map((project) => ({
    id: project.id,
    slug: project.slug || project.id,
    name: project.name,
  }));
}

async function getCompanyAgents(
  request: APIRequestContext,
  companySlug: string
): Promise<LiveAgent[]> {
  const res = await request.get(`${API}/companies/${encodeURIComponent(companySlug)}/agents`);
  expect(res.status(), "getCompanyAgents: expected 200").toBe(200);
  const body = await res.json();
  return (body.agents as Array<{ id: string; name: string; role?: string }>).map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role || "",
  }));
}

async function createTestProject(request: APIRequestContext, companyId: string) {
  const slug = `s10a-test-${Date.now()}`;
  const res = await request.post(`${API}/projects`, {
    data: {
      name: `${TAG} Nav Regression`,
      description: "Ephemeral project seeded for Sprint 10A nav regression tests.",
      emoji: "🧭",
      color: "#7c3aed",
      slug,
      companyId,
    },
  });
  expect(res.status(), "createTestProject: expected 201").toBe(201);
  const body = await res.json();
  return body.project as { id: string; slug: string };
}

async function archiveTestProject(request: APIRequestContext, projectId: string) {
  const res = await request.delete(`${API}/projects/${projectId}`);
  // Best-effort — don't fail the run if already gone
  if (res.status() !== 200 && res.status() !== 404) {
    console.warn(`archiveTestProject: unexpected status ${res.status()} for ${projectId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STATE
// ─────────────────────────────────────────────────────────────────────────────

let testProjectId = "";
let testProjectSlug = "";
let testCompanyId = "";
let liveProject: LiveProject | null = null;
let liveAgent: LiveAgent | null = null;

test.beforeAll(async ({ request }) => {
  testCompanyId = await getDefaultCompanyId(request);
  const [projects, agents] = await Promise.all([
    getCompanyProjects(request, COMPANY_SLUG),
    getCompanyAgents(request, COMPANY_SLUG),
  ]);

  if (projects.length === 0) {
    throw new Error(`No live projects found for ${COMPANY_SLUG}`);
  }
  if (agents.length === 0) {
    throw new Error(`No live agents found for ${COMPANY_SLUG}`);
  }

  liveProject = projects[0];
  liveAgent = agents[0];

  const project = await createTestProject(request, testCompanyId);
  testProjectId = project.id;
  testProjectSlug = project.slug;
});

test.afterAll(async ({ request }) => {
  if (testProjectId) await archiveTestProject(request, testProjectId);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Sidebar Hierarchy
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Sidebar hierarchy", () => {
  test("Primary nav renders on company dashboard", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);

    const nav = page.locator("nav[aria-label='Primary']");
    await expect(nav, "SIDEBAR | Primary nav not found").toBeVisible({ timeout: 15_000 });

    // Company header shows company name
    await expect(
      nav.getByText("NeverIdle Core", { exact: false }),
      "SIDEBAR | company name not visible in nav"
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Work section contains Tasks, Routines, Goals links", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);
    const nav = page.locator("nav[aria-label='Primary']");
    await expect(nav).toBeVisible({ timeout: 15_000 });

    // Wait for nav content to hydrate
    await expect(nav.getByText("NeverIdle Core", { exact: false })).toBeVisible({ timeout: 10_000 });

    await expect(nav.getByRole("link", { name: /tasks/i }), "SIDEBAR | Tasks link missing").toBeVisible();
    await expect(nav.getByRole("link", { name: /routines/i }), "SIDEBAR | Routines link missing").toBeVisible();
    await expect(nav.getByRole("link", { name: /goals/i }), "SIDEBAR | Goals link missing").toBeVisible();
  });

  test("Core shell links remain visible and clickable from the live dock", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);
    const nav = page.locator("nav[aria-label='Primary']");
    await expect(nav).toBeVisible({ timeout: 15_000 });

    const expectations = [
      { label: "Sessions", href: "/sessions" },
      { label: "Logs", href: "/logs" },
      { label: "Files", href: "/files" },
    ];

    for (const item of expectations) {
      const link = nav.getByRole("link", { name: item.label });
      await expect(link, `SIDEBAR | ${item.label} link missing from live dock`).toBeVisible();
      await link.click();
      await expect(page, `SIDEBAR | ${item.label} did not navigate`).toHaveURL(
        new RegExp(`${item.href.replace("/", "\\/")}$`),
        { timeout: 10_000 }
      );
      await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);
      await expect(nav).toBeVisible({ timeout: 15_000 });
    }
  });

  test("Projects section loads real projects", async ({ page }) => {
    if (!liveProject) throw new Error("Live project seed missing");
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);
    const nav = page.locator("nav[aria-label='Primary']");
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByText("NeverIdle Core", { exact: false })).toBeVisible({ timeout: 10_000 });

    await expect(
      nav.getByRole("link", { name: new RegExp(escapeRegExp(liveProject.name), "i") }),
      `SIDEBAR | live project "${liveProject.name}" not found in Projects section`
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Agents section loads real agents from orchestration", async ({ page }) => {
    if (!liveAgent) throw new Error("Live agent seed missing");
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);
    const nav = page.locator("nav[aria-label='Primary']");
    await expect(nav).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByText("NeverIdle Core", { exact: false })).toBeVisible({ timeout: 10_000 });

    await expect(
      nav.getByRole("link", { name: new RegExp(escapeRegExp(liveAgent.name), "i") }),
      `SIDEBAR | live agent "${liveAgent.name}" not found in Agents section`
    ).toBeVisible({ timeout: 15_000 });
  });

  test("New Task button in header links to company new task route", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);
    const nav = page.locator("nav[aria-label='Primary']");
    await expect(nav).toBeVisible({ timeout: 15_000 });

    const newTaskLink = nav.getByRole("link", { name: /new task/i });
    await expect(newTaskLink, "SIDEBAR | New Task button missing").toBeVisible({ timeout: 10_000 });
    const href = await newTaskLink.getAttribute("href");
    expect(href, "SIDEBAR | New Task href should be company-scoped new task route").toBe(
      `/companies/${COMPANY_SLUG}/issues/new`
    );
  });

  test("System dock links click through to Sessions, Logs, and Files", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);

    const nav = page.locator("nav[aria-label='Primary']");
    await expect(nav, "SIDEBAR | Primary nav not found").toBeVisible({ timeout: 15_000 });

    await nav.getByRole("button", { name: /systems/i }).click();

    await nav.getByRole("link", { name: /^sessions$/i }).first().click();
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(
      page.getByRole("heading", { name: /session history/i }),
      "DOCK | Sessions click should open the live Sessions page"
    ).toBeVisible({ timeout: 15_000 });

    await expect(nav.getByRole("link", { name: /^logs$/i }).first()).toBeVisible({ timeout: 15_000 });
    await nav.getByRole("link", { name: /^logs$/i }).first().click();
    await expect(page).toHaveURL(/\/logs$/);
    await expect(
      page.getByRole("heading", { name: /log viewer/i }),
      "DOCK | Logs click should open the live Logs page"
    ).toBeVisible({ timeout: 15_000 });

    await nav.getByRole("link", { name: /^files$/i }).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(
      page.getByRole("heading", { name: /file browser/i }),
      "DOCK | Files click should open the live Files page"
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Company Dashboard
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Company dashboard", () => {
  test("loads heading and key content sections", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);

    // Should render before timeout without error banner
    await expect(
      page.getByRole("heading", { name: /neveridle core/i }),
      `COMPANY-DASH | /companies/${COMPANY_SLUG} heading not found`
    ).toBeVisible({ timeout: 15_000 });

    // No fatal error state
    await expect(
      page.getByText(/company not found|failed to load/i),
      "COMPANY-DASH | error state visible"
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("shows project count stat", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i })
    ).toBeVisible({ timeout: 15_000 });

    // Projects stat card should render (value may be 0+)
    await expect(
      page.getByText(/projects/i).first(),
      "COMPANY-DASH | Projects stat section missing"
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Company Board (Tasks page)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Company board (tasks page)", () => {
  test("loads all kanban columns", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/board`);

    // Board should render its 5 columns
    for (const col of ["Backlog", "To-Do", "In Progress", "Review", "Done"]) {
      await expect(
        page.getByRole("heading", { name: new RegExp(col, "i") }).first(),
        `COMPANY-BOARD | column "${col}" not found`
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("search filter narrows visible tasks", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/board`);

    // Wait for board to finish loading
    await expect(
      page.getByRole("heading", { name: /backlog/i }).first()
    ).toBeVisible({ timeout: 20_000 });

    const searchBox = page.getByRole("textbox").first();
    await expect(searchBox, "COMPANY-BOARD | search input not found").toBeVisible({ timeout: 5_000 });

    // Type a query unlikely to match anything — card count should drop to 0
    await searchBox.fill("zzz-no-match-xyzzy");
    await page.waitForTimeout(400); // debounce

    await expect(
      page.getByText(/no tasks|0 tasks|nothing here/i).first(),
      "COMPANY-BOARD | empty state not shown after nonsense query — filter may be broken"
    ).toBeVisible({ timeout: 8_000 });
  });

  test("project filter dropdown exists", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/board`);
    await expect(
      page.getByRole("heading", { name: /backlog/i }).first()
    ).toBeVisible({ timeout: 20_000 });

    // Company board has a project filter selector
    const projectSelect = page.locator("select").first();
    await expect(projectSelect, "COMPANY-BOARD | project filter select not found").toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Company Team (Agents roster)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Company team page", () => {
  test("loads team heading", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/team`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i }),
      `COMPANY-TEAM | /companies/${COMPANY_SLUG}/team heading not found`
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(/company not found|failed to load/i),
      "COMPANY-TEAM | error state visible"
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("renders at least one agent card", async ({ page }) => {
    if (!liveAgent) throw new Error("Live agent seed missing");
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/team`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i })
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("link", { name: new RegExp(escapeRegExp(liveAgent.name), "i") }).first(),
      `COMPANY-TEAM | live agent "${liveAgent.name}" not found in team roster`
    ).toBeVisible({ timeout: 12_000 });
  });

  test("status filter control renders", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/team`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i })
    ).toBeVisible({ timeout: 15_000 });

    const select = page.locator("select").first();
    await expect(select, "COMPANY-TEAM | status filter select not found").toBeVisible({ timeout: 5_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Company Projects list
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Company projects list", () => {
  test("renders heading and Active tab", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/projects`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i }),
      `COMPANY-PROJECTS | /companies/${COMPANY_SLUG}/projects heading not found`
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("button", { name: /active/i }),
      "COMPANY-PROJECTS | Active tab button missing"
    ).toBeVisible({ timeout: 8_000 });
  });

  test("live company project appears in active list", async ({ page }) => {
    if (!liveProject) throw new Error("Live project seed missing");
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/projects`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i })
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByRole("link", { name: new RegExp(escapeRegExp(liveProject.name), "i") }).first(),
      `COMPANY-PROJECTS | live project "${liveProject.name}" not visible`
    ).toBeVisible({ timeout: 12_000 });
  });

  test("search filter narrows project cards", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/projects`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i })
    ).toBeVisible({ timeout: 15_000 });

    const search = page.getByRole("textbox").first();
    await expect(search, "COMPANY-PROJECTS | search input not found").toBeVisible({ timeout: 5_000 });

    await search.fill("zzz-nothing-matches-xyzzy");
    await page.waitForTimeout(400);

    await expect(
      page.getByText(/no company projects matched this filter/i),
      "COMPANY-PROJECTS | empty state not shown after nonsense search"
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — Agent Detail Route
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Agent detail route", () => {
  test("loads a live company agent page without error", async ({ page }) => {
    if (!liveAgent) throw new Error("Live agent seed missing");
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/agents/${liveAgent.id}`);

    await expect(
      page.getByText(new RegExp(escapeRegExp(liveAgent.name), "i")).first(),
      `AGENT-DETAIL | /companies/${COMPANY_SLUG}/agents/${liveAgent.id} — agent name not found`
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(/failed to load agent|agent not found/i),
      "AGENT-DETAIL | error state visible on agent page"
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("shows stable metadata on agent page", async ({ page }) => {
    if (!liveAgent) throw new Error("Live agent seed missing");
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/agents/${liveAgent.id}`);
    await expect(
      page.getByText(new RegExp(escapeRegExp(liveAgent.name), "i")).first()
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(/^assigned tasks$/i),
      `AGENT-DETAIL | Assigned Tasks metadata missing on ${liveAgent.name} agent page`
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByText(/^execution runs$/i),
      `AGENT-DETAIL | Execution Runs metadata missing on ${liveAgent.name} agent page`
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 — Project Board Navigation
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Project board navigation", () => {
  test("seeded project board renders all 5 columns", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/projects/${testProjectSlug}/board`);

    for (const col of ["Backlog", "To-Do", "In Progress", "Review", "Done"]) {
      await expect(
        page.getByRole("heading", { name: new RegExp(col, "i") }).first(),
        `PROJECT-BOARD | /companies/${COMPANY_SLUG}/projects/${testProjectSlug}/board — column "${col}" not found`
      ).toBeVisible({ timeout: 20_000 });
    }
  });

  test("project board does not render error state", async ({ page }) => {
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/projects/${testProjectSlug}/board`);
    await expect(
      page.getByRole("heading", { name: /backlog/i }).first()
    ).toBeVisible({ timeout: 20_000 });

    await expect(
      page.getByText(/project not found|failed to load|error loading/i),
      "PROJECT-BOARD | error state visible"
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test("project board accessible from company projects list", async ({ page }) => {
    if (!liveProject) throw new Error("Live project seed missing");
    await page.goto(`${BASE}/companies/${COMPANY_SLUG}/projects`);
    await expect(
      page.getByRole("heading", { name: /neveridle core/i })
    ).toBeVisible({ timeout: 15_000 });

    const projectCard = page.getByRole("link", { name: new RegExp(escapeRegExp(liveProject.name), "i") }).first();
    await expect(projectCard).toBeVisible({ timeout: 12_000 });
    await projectCard.click();

    await expect(page).toHaveURL(
      new RegExp(`/projects/${escapeRegExp(liveProject.slug)}/board`),
      { timeout: 10_000 }
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8 — Legacy Redirect Verification
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Legacy route redirects", () => {
  test("/tasks redirects to /companies/neveridle-core/issues", async ({ page }) => {
    await page.goto(`${BASE}/tasks`);
    await expect(page).toHaveURL(
      new RegExp(`/companies/${COMPANY_SLUG}/issues`),
      { timeout: 10_000 }
    );
    await expect(
      page.getByRole("heading", { name: /neveridle core issues/i }),
      "LEGACY-REDIRECT | /tasks redirect — issues page not visible"
    ).toBeVisible({ timeout: 20_000 });
  });

  test("/agents redirects to /companies/neveridle-core/team", async ({ page }) => {
    await page.goto(`${BASE}/agents`);
    await expect(page).toHaveURL(
      new RegExp(`/companies/${COMPANY_SLUG}/team`),
      { timeout: 10_000 }
    );
    await expect(
      page.getByRole("heading", { name: /neveridle core/i }),
      "LEGACY-REDIRECT | /agents redirect — team page not visible"
    ).toBeVisible({ timeout: 15_000 });
  });

  test("/projects still loads the top-level project hub", async ({ page }) => {
    await page.goto(`${BASE}/projects`);
    await expect(page).toHaveURL(/\/projects$/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /mission control projects/i }),
      "LEGACY-REDIRECT | /projects page not visible"
    ).toBeVisible({ timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 9 — Non-Orchestration Pages Not Regressed
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Non-orchestration pages not regressed", () => {
  const NON_ORCH_ROUTES: { route: string; label: string }[] = [
    { route: "/trading", label: "Trading" },
    { route: "/ideas", label: "Ideas" },
    { route: "/search", label: "Search" },
    { route: "/activity", label: "Activity" },
    { route: "/settings", label: "Settings" },
  ];

  for (const { route, label } of NON_ORCH_ROUTES) {
    test(`${label} page (${route}) loads without crash`, async ({ page }) => {
      await page.goto(`${BASE}${route}`);

      // No unhandled React error boundary
      await expect(
        page.getByText(/application error|something went wrong/i),
        `NON-ORCH | ${route} — React error boundary triggered`
      ).not.toBeVisible({ timeout: 10_000 });

      // Page should not be blank — at least the nav is present
      await expect(
        page.locator("nav").first(),
        `NON-ORCH | ${route} — no nav element rendered (blank page?)`
      ).toBeVisible({ timeout: 15_000 });
    });
  }
});
