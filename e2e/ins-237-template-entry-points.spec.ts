import { expect, type Page, type Route, test } from "@playwright/test";

const COMPANY = {
  id: "cd9607f7-24bd-4596-9bcb-b3c013a75b7b",
  slug: "insight",
  code: "INS",
  name: "Insight",
  description: "Fixture company for template entry point checks.",
  status: "active",
  created: "2026-06-06T12:00:00.000Z",
};

const PROJECT = {
  id: "ins-237-project-fixture",
  companyId: COMPANY.id,
  slug: "hiverunner",
  name: "HiveRunner",
  description: "Fixture project for template entry point checks.",
  status: "active",
  color: "#14b8a6",
  created: "2026-06-06T12:00:00.000Z",
};

const EXISTING_GOAL = goalFixture("goal-existing", "Existing template goal", PROJECT.id);

type DraftPost = {
  pathname: string;
  payload: Record<string, unknown>;
};

test.describe("INS-237 template creation entry points", () => {
  test("first-run onboarding exposes template draft creation as the default first-work path", async ({ page }) => {
    page.on("console", (msg) => console.log("BROWSER LOG:", msg.text()));
    await mockTemplateEntryApis(page, { draftPosts: [], taskPosts: [] });

    await page.goto("/companies/new");
    await page.getByRole("textbox", { name: /^Company Name/ }).fill("Browser Template Co");
    await page.getByLabel("Your Name").fill("Operator");
    await page.getByLabel("Your Email").fill("operator@example.test");
    await page.getByRole("button", { name: /Next/ }).click();
    await page.getByRole("button", { name: /Next/ }).click();
    await page.getByRole("button", { name: /Next/ }).click();
    await page.getByLabel("CEO Name").fill("Template CEO");
    await page.getByRole("button", { name: /Next/ }).click();

    await expect(page.getByTestId("first-work-template-mode")).toHaveAttribute("data-testid", "first-work-template-mode");
    await expect(page.getByTestId("first-work-template-picker")).toBeVisible();
    await expect(page.locator('[data-template-question-id="vibeOrConstraint"] input')).toBeVisible();
    await expect(page.getByText("Draft plan only. The generated sprint and board tasks wait for operator approval or valid Delegated Signoff.")).toBeVisible();
  });

  test("Goals, goal detail, Projects, and project detail launch draft-only template plans", async ({ page }) => {
    const draftPosts: DraftPost[] = [];
    const taskPosts: string[] = [];
    await mockTemplateEntryApis(page, { draftPosts, taskPosts });

    const entries = [
      { source: "goals", path: "/companies/insight/goals" },
      { source: "goal-detail", path: "/companies/insight/goals/goal-existing" },
      { source: "projects", path: "/companies/insight/projects" },
      { source: "project-detail", path: "/companies/insight/projects/hiverunner/overview" },
    ] as const;

    for (const entry of entries) {
      await page.goto(entry.path);
      const trigger = page.locator(`[data-testid="template-launch-trigger"][data-template-entry-point="${entry.source}"]`).first();
      await expect(trigger).toBeVisible();
      await trigger.click();

      const dialog = page.locator(`[data-testid="template-launch-dialog"][data-template-entry-point="${entry.source}"]`);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Draft plan only. Board tasks are created after approval.")).toBeVisible();
      await dialog.locator('[data-template-question-id="vibeOrConstraint"] input').fill(`${entry.source} browser draft`);
      const previousDraftCount = draftPosts.length;
      await dialog.getByRole("button", { name: "Create draft" }).click();

      await expect.poll(() => draftPosts.length).toBe(previousDraftCount + 1);
      expect(draftPosts.at(-1)?.payload).toMatchObject({
        templateId: "build-something",
        answers: {
          buildType: "arcade-mini-game",
          vibeOrConstraint: `${entry.source} browser draft`,
          ambitionLevel: "single-screen",
        },
      });
      expect(taskPosts, `${entry.source} must not create board tasks before approval`).toHaveLength(0);
    }
  });
});

async function mockTemplateEntryApis(
  page: Page,
  captures: { draftPosts: DraftPost[]; taskPosts: string[] },
): Promise<void> {
  let createdGoalIndex = 0;
  let createdProjectIndex = 0;

  await page.route("**/api/live/snapshot", async (route) => {
    await fulfillJson(route, { generatedAt: "2026-06-06T12:00:00.000Z", agents: [], tasks: [] });
  });

  await page.route("**/api/orchestration/models", async (route) => {
    await fulfillJson(route, { models: [{ value: "openai-codex/gpt-5.5", label: "Powerful - Recommended" }] });
  });

  await page.route("**/api/orchestration/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === "/api/orchestration/events/stream" || pathname === "/api/orchestration/engine/live-stream") {
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
      return;
    }

    if (pathname === "/api/orchestration/models") {
      await fulfillJson(route, { models: [{ value: "openai-codex/gpt-5.5", label: "Powerful - Recommended" }] });
      return;
    }

    if (pathname === "/api/orchestration/companies") {
      await fulfillJson(route, { companies: [COMPANY] });
      return;
    }

    if (pathname === "/api/orchestration/tasks") {
      if (request.method() === "POST") captures.taskPosts.push(request.postData() ?? "");
      await fulfillJson(route, { tasks: [] });
      return;
    }

    if (pathname === "/api/orchestration/projects") {
      if (request.method() === "POST") {
        createdProjectIndex += 1;
        const body = request.postDataJSON() as Record<string, unknown>;
        await fulfillJson(route, {
          project: {
            ...PROJECT,
            id: `created-project-${createdProjectIndex}`,
            slug: `created-project-${createdProjectIndex}`,
            name: String(body.name ?? `Created Project ${createdProjectIndex}`),
          },
        }, 201);
        return;
      }
      await fulfillJson(route, { projects: [PROJECT] });
      return;
    }

    const companyMatch = pathname.match(/^\/api\/orchestration\/companies\/([^/]+)(?:\/(.*))?$/);
    if (!companyMatch) {
      await fulfillJson(route, {});
      return;
    }

    const rest = companyMatch[2] ?? "";
    if (!rest) {
      await fulfillJson(route, { company: COMPANY });
      return;
    }

    if (rest === "projects") {
      await fulfillJson(route, { projects: [PROJECT] });
      return;
    }

    if (rest === "agents") {
      await fulfillJson(route, { agents: [] });
      return;
    }

    if (rest === "goals") {
      if (request.method() === "POST") {
        createdGoalIndex += 1;
        const body = request.postDataJSON() as Record<string, unknown>;
        await fulfillJson(route, {
          goal: goalFixture(
            `created-goal-${createdGoalIndex}`,
            String(body.name ?? `Created Goal ${createdGoalIndex}`),
            typeof body.projectId === "string" ? body.projectId : PROJECT.id,
          ),
        }, 201);
        return;
      }
      await fulfillJson(route, {
        goals: [EXISTING_GOAL],
        summary: { total: 1, planned: 1, active: 0, done: 0, completionPercent: 0 },
      });
      return;
    }

    if (rest === "goals/drafts/pending") {
      await fulfillJson(route, { drafts: [] });
      return;
    }

    const draftMatch = rest.match(/^goals\/([^/]+)\/drafts$/);
    if (draftMatch) {
      if (request.method() === "POST") {
        captures.draftPosts.push({
          pathname,
          payload: request.postDataJSON() as Record<string, unknown>,
        });
        await fulfillJson(route, { ...draftPlanResponse(draftMatch[1] ?? "goal-existing"), created: true }, 201);
        return;
      }
      await fulfillJson(route, { drafts: [] });
      return;
    }

    await fulfillJson(route, {});
  });
}

function goalFixture(id: string, name: string, projectId: string) {
  return {
    sprint: {
      id,
      projectId,
      name,
      goal: "Create a template-backed draft.",
      goalKind: "company",
      status: "planned",
      startDate: "2026-06-06T12:00:00.000Z",
      created: "2026-06-06T12:00:00.000Z",
      updated: "2026-06-06T12:00:00.000Z",
      taskCount: 0,
      defaultExecutionEngine: "symphony",
      defaultModelLane: "default",
    },
    projectId,
    projectSlug: PROJECT.slug,
    projectName: PROJECT.name,
    projectColor: PROJECT.color,
    completionPercent: 0,
    planPendingSprintCount: 0,
  };
}

function draftPlanResponse(goalId: string) {
  return {
    createsBoardTasksImmediately: false,
    template: {
      id: "build-something",
      templateVersionId: "build-something@1.0.0",
      version: "1.0.0",
      name: "Build Something",
      summary: "Turn a constrained creative brief into a small reviewable build sprint.",
    },
    intakeAnswer: {
      id: `intake-${goalId}`,
      answers: {},
      normalizedAnswers: {},
    },
    draftGoal: {
      title: "Build a small reviewable project",
      objective: "Create a scoped prototype or feature.",
    },
    draft: {
      id: `draft-${goalId}`,
      companyId: COMPANY.id,
      companyGoalId: goalId,
      companyGoalName: "Template goal",
      planningTaskId: null,
      status: "pending",
      sprint: {
        name: "Build Something Sprint",
        objective: "Shape, build, verify, and review the selected small project.",
        defaultExecutionEngine: "symphony",
        defaultModelLane: "default",
        sourceTemplateVersionId: "build-something@1.0.0",
        templateIntakeAnswerId: `intake-${goalId}`,
      },
      tasks: [],
      sourceTemplateVersionId: "build-something@1.0.0",
      intakeAnswerId: `intake-${goalId}`,
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z",
    },
    validationChecklist: ["Draft stays reviewable before board work exists"],
    reviewCriteria: {
      title: "Review draft before creating tasks",
      description: "Confirm scope before starting board work.",
      evidence: ["Browser proof"],
      blockedIf: ["Board tasks would be created before draft approval"],
    },
    crewRecommendation: {
      summary: "Start with implementation and verification.",
      autoApproveNewHires: false,
      materializedNewAgentCount: 0,
      approvalRequiredNewAgentCount: 0,
      required: [],
      useful: [],
      later: [],
    },
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
