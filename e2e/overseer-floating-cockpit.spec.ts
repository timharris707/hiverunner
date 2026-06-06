import { expect, type Locator, type Page, type Route, test } from "@playwright/test";

const ENABLE_FLOATING_OVERSEER_E2E = process.env.HIVERUNNER_FLOATING_OVERSEER_E2E === "1";

const COMPANIES = [
  fixtureCompany("phase2-alpha", "P2A", "Phase 2 Alpha"),
  fixtureCompany("phase2-beta", "P2B", "Phase 2 Beta"),
];

const SESSIONS_BY_SLUG = new Map(
  COMPANIES.map((company) => [
    company.slug,
    {
      id: `session-${company.slug}`,
      title: `Shared ${company.name} Session`,
      status: "idle",
      codexSessionId: null,
      workspaceRoot: `/tmp/hiverunner/${company.slug}`,
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      scope: { fastMode: false, overseerProvider: "codex" },
      compaction: {
        policy: "ask",
        contextThreshold: 85,
        latestSummary: null,
        compactedAt: null,
        compactedBy: null,
        metadata: {},
      },
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, turnCount: 0 },
      quota: { status: "available", buckets: [] },
      lastError: null,
      updatedAt: "2026-06-06T12:00:00.000Z",
      messageCount: 1,
    },
  ]),
);

test.describe("Floating Overseer cockpit Phase 2", () => {
  test.skip(
    !ENABLE_FLOATING_OVERSEER_E2E,
    "Set HIVERUNNER_FLOATING_OVERSEER_E2E=1 after the floating cockpit selector contract is implemented.",
  );

  test.beforeEach(async ({ page }) => {
    await mockFloatingOverseerApis(page);
  });

  test("launcher appears on company routes and hides on the full Overseer route", async ({ page }) => {
    await page.goto(companyPath("phase2-alpha", "/dashboard"));
    await expect(floatingLauncher(page)).toBeVisible();
    await expect(floatingPanel(page)).toHaveCount(0);

    await page.goto(companyPath("phase2-alpha", "/tasks"));
    await expect(floatingLauncher(page)).toBeVisible();

    await page.goto(companyPath("phase2-alpha", "/overseer"));
    await expect(page.getByRole("heading", { name: "Overseer" })).toBeVisible();
    await expect(floatingLauncher(page)).toHaveCount(0);
    await expect(floatingPanel(page)).toHaveCount(0);
  });

  test("open panel persists across reloads and switches context on company change", async ({ page }) => {
    await page.goto(companyPath("phase2-alpha", "/dashboard"));
    await floatingLauncher(page).click();

    await expect(floatingPanel(page)).toBeVisible();
    await expect(floatingPanel(page)).toHaveAttribute("data-company-slug", "phase2-alpha");
    await expect(page.getByText("Shared Phase 2 Alpha Session")).toBeVisible();

    await page.goto(companyPath("phase2-alpha", "/tasks"));

    await expect(floatingPanel(page)).toBeVisible();
    await expect(floatingPanel(page)).toHaveAttribute("data-company-slug", "phase2-alpha");
    await expect(page.getByText("Shared Phase 2 Alpha Session")).toBeVisible();

    await page.goto(companyPath("phase2-beta", "/dashboard"));
    await expect(page.getByText("Shared Phase 2 Alpha Session")).toHaveCount(0);
    await floatingLauncher(page).click();
    await expect(floatingPanel(page)).toBeVisible();
    await expect(floatingPanel(page)).toHaveAttribute("data-company-slug", "phase2-beta");
    await expect(page.getByText("Shared Phase 2 Beta Session")).toBeVisible();
  });

  test("desktop drag and resize clamp the panel inside the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(companyPath("phase2-alpha", "/dashboard"));
    await floatingLauncher(page).click();

    const panel = floatingPanel(page);
    const dragHandle = page.getByTestId("floating-overseer-drag-handle");
    const resizeHandle = page.getByTestId("floating-overseer-resize-handle");

    await dragBy(dragHandle, -800, -800, page);
    await expectPanelInViewport(panel, page);

    await dragBy(dragHandle, 1800, 1200, page);
    await expectPanelInViewport(panel, page);

    await dragBy(resizeHandle, 1400, 900, page);
    await expectPanelInViewport(panel, page);

    const resized = await requireBox(panel);
    expect(resized.width).toBeGreaterThanOrEqual(360);
    expect(resized.height).toBeGreaterThanOrEqual(420);
  });

  test("mobile uses bottom sheet and keeps controls usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(companyPath("phase2-alpha", "/dashboard"));
    await floatingLauncher(page).click();

    const sheet = page.getByTestId("floating-overseer-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByPlaceholder("Ask the Overseer")).toBeVisible();

    const box = await requireBox(sheet);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(520);
  });

  test("floating surface does not expose secrets or HIV compact label", async ({ page }) => {
    await page.goto(companyPath("phase2-alpha", "/dashboard"));
    await floatingLauncher(page).click();

    await expect(page.getByText(/\bHIV\b/)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      /sk-[A-Za-z0-9_-]{10,}|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|provider key|secret value/i,
    );
  });
});

function floatingLauncher(page: Page): Locator {
  return page.getByTestId("floating-overseer-launcher");
}

function floatingPanel(page: Page): Locator {
  return page.getByTestId("floating-overseer-panel");
}

function companyPath(slug: string, path: string): string {
  return `/companies/${encodeURIComponent(slug)}${path}`;
}

async function dragBy(locator: Locator, deltaX: number, deltaY: number, page: Page): Promise<void> {
  const box = await requireBox(locator);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
  await page.mouse.up();
}

async function expectPanelInViewport(locator: Locator, page: Page): Promise<void> {
  const box = await requireBox(locator);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport!.height);
}

async function requireBox(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function mockFloatingOverseerApis(page: Page): Promise<void> {
  await page.route("**/api/live/snapshot", async (route) => {
    await fulfillJson(route, { generatedAt: "2026-06-06T12:00:00.000Z", agents: [], tasks: [] });
  });

  await page.route("**/api/orchestration/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/orchestration/companies") {
      await fulfillJson(route, { companies: COMPANIES });
      return;
    }

    if (pathname === "/api/orchestration/events/stream" || pathname === "/api/orchestration/engine/live-stream") {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: "",
      });
      return;
    }

    const companyMatch = pathname.match(/^\/api\/orchestration\/companies\/([^/]+)(?:\/(.*))?$/);
    if (companyMatch) {
      const slug = decodeURIComponent(companyMatch[1]);
      const rest = companyMatch[2] ?? "";
      await fulfillCompanyRoute(route, slug, rest);
      return;
    }

    if (/^\/api\/orchestration\/projects\/[^/]+\/sprints$/.test(pathname)) {
      await fulfillJson(route, { sprints: [] });
      return;
    }

    if (pathname === "/api/orchestration/tasks") {
      await fulfillJson(route, { tasks: [] });
      return;
    }

    if (pathname === "/api/orchestration/activity") {
      await fulfillJson(route, { events: [] });
      return;
    }

    if (pathname === "/api/orchestration/engine/active-agent-runs") {
      await fulfillJson(route, { runs: [] });
      return;
    }

    await fulfillJson(route, {});
  });
}

async function fulfillCompanyRoute(route: Route, slug: string, rest: string): Promise<void> {
  const request = route.request();
  const company = COMPANIES.find((candidate) => candidate.slug === slug) ?? COMPANIES[0];
  const session = SESSIONS_BY_SLUG.get(company.slug)!;

  if (!rest) {
    await fulfillJson(route, { company });
    return;
  }

  if (rest === "projects") {
    await fulfillJson(route, { projects: [fixtureProject(company.slug)] });
    return;
  }

  if (rest === "agents") {
    await fulfillJson(route, { agents: [] });
    return;
  }

  if (rest === "engine") {
    await fulfillJson(route, { ready: true, status: "idle", activeRuns: 0 });
    return;
  }

  if (rest === "goals") {
    await fulfillJson(route, { goals: [] });
    return;
  }

  if (rest === "approvals") {
    await fulfillJson(route, { approvals: [] });
    return;
  }

  if (rest === "settings/overseer") {
    await fulfillJson(route, {
      ready: false,
      codex: {
        installed: false,
        authReady: false,
        authMode: "none",
        version: null,
        loginStatus: "not_configured",
      },
      workspace: {
        root: `/tmp/hiverunner/${company.slug}`,
        writable: true,
        source: "manual",
      },
      quota: { status: "available" },
      modelCatalog: [],
    });
    return;
  }

  if (rest === "overseer/sessions" && request.method() === "GET") {
    await fulfillJson(route, { sessions: [session] });
    return;
  }

  if (rest === "overseer/sessions" && request.method() === "POST") {
    await fulfillJson(route, { session, messages: [] }, 201);
    return;
  }

  const sessionDetailMatch = rest.match(/^overseer\/sessions\/([^/]+)$/);
  if (sessionDetailMatch) {
    await fulfillJson(route, {
      session,
      messages: [fixtureMessage(session.id)],
      events: [],
      continuityProof: fixtureContinuityProof(),
    });
    return;
  }

  const sessionMessagesMatch = rest.match(/^overseer\/sessions\/([^/]+)\/messages$/);
  if (sessionMessagesMatch) {
    await fulfillJson(route, {
      session,
      messages: [
        fixtureMessage(session.id),
        {
          id: `assistant-${session.id}`,
          sessionId: session.id,
          turnId: "turn-fixture",
          role: "assistant",
          content: "Fixture answer without provider credentials.",
          metadata: {},
          sequence: 2,
          createdAt: "2026-06-06T12:00:01.000Z",
        },
      ],
      events: [],
    });
    return;
  }

  await fulfillJson(route, {});
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function fixtureCompany(slug: string, code: string, name: string) {
  return {
    id: `company-${slug}`,
    slug,
    workspaceSlug: slug,
    runtimeSlug: slug,
    code,
    name,
    description: `${name} floating Overseer fixture`,
    status: "active",
    created: "2026-06-06T12:00:00.000Z",
    workspace: {
      root: `/tmp/hiverunner/${slug}`,
      source: "manual",
    },
    theme: {
      name: "Neutral command center",
      promptTemplate: "Neutral local fixture.",
      keywords: ["neutral", "command-center"],
    },
    stats: {
      projects: 1,
      agents: 0,
      activeTasks: 0,
    },
  };
}

function fixtureProject(companySlug: string) {
  return {
    id: `project-${companySlug}`,
    companyId: `company-${companySlug}`,
    slug: "qa-project",
    name: "QA Project",
    description: "Floating Overseer QA fixture",
    emoji: "icon:bot",
    color: "#64748b",
    status: "active",
    created: "2026-06-06T12:00:00.000Z",
    taskCount: 0,
    inProgress: 0,
    backlog: 0,
    review: 0,
    completed: 0,
    activeAgents: 0,
  };
}

function fixtureMessage(sessionId: string) {
  return {
    id: `message-${sessionId}`,
    sessionId,
    turnId: null,
    role: "user",
    content: "Fixture message",
    metadata: {},
    sequence: 1,
    createdAt: "2026-06-06T12:00:00.000Z",
  };
}

function fixtureContinuityProof() {
  return {
    status: "verified",
    sourceRowCounts: {
      turns: 0,
      messages: 1,
      events: 0,
      snapshots: 0,
      approvals: 0,
      attachmentManifest: 0,
      costEvents: 0,
    },
    hashes: {},
    snapshotVersions: [],
    latestSnapshotVersion: null,
    latestCompactionApprovalId: null,
    latestCompaction: {
      compactedAt: null,
      compactedBy: null,
      snapshotId: null,
      snapshotVersion: null,
      snapshotSummaryHash: null,
    },
  };
}
