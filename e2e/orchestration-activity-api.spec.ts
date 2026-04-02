import { expect, test } from "@playwright/test";
import { z } from "zod";

const OrchErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

const ActivityItemSchema = z.object({
  id: z.string().min(1),
  eventType: z.enum([
    "task.status_changed",
    "task.assigned",
    "task.unassigned",
    "sprint.created",
    "sprint.updated",
    "sprint.completed",
  ]),
  projectId: z.string().uuid(),
  projectSlug: z.string().min(1),
  projectName: z.string().min(1),
  companyId: z.string().uuid().optional(),
  companySlug: z.string().min(1).optional(),
  companyName: z.string().min(1).optional(),
  taskId: z.string().uuid().optional(),
  taskTitle: z.string().min(1).optional(),
  sprintId: z.string().uuid().optional(),
  sprintName: z.string().min(1).optional(),
  oldStatus: z.enum(["backlog", "on-deck", "in-progress", "review", "done", "blocked"]).optional(),
  newStatus: z.enum(["backlog", "on-deck", "in-progress", "review", "done", "blocked"]).optional(),
  message: z.string().min(1),
  agentId: z.string().uuid().optional(),
  agentName: z.string().min(1).optional(),
  timestamp: z.iso.datetime(),
});

const ActivityResponseSchema = z.object({
  activity: z.array(ActivityItemSchema),
  page: z.object({
    limit: z.number().int().min(1),
    nextCursor: z.string().min(1).optional(),
    hasMore: z.boolean(),
  }),
});

let companyId: string;

test.beforeAll(async ({ request }) => {
  const res = await request.get("/api/orchestration/companies");
  expect(res.status()).toBe(200);
  const { companies } = await res.json();
  const core = (companies as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === "neveridle-core"
  );
  expect(core, "NeverIdle Core company not found").toBeTruthy();
  companyId = core!.id;
});

test.describe("GET /api/orchestration/activity", () => {
  const createdProjectIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const projectId of createdProjectIds) {
      const res = await request.delete(`/api/orchestration/projects/${projectId}`);
      expect([200, 404]).toContain(res.status());
    }
  });

  test("returns paginated status-change activity across projects", async ({ request }) => {
    const suffix = Date.now();

    const projectRes = await request.post("/api/orchestration/projects", {
      data: {
        companyId,
        name: `[ORCH-ACTIVITY] Project ${suffix}`,
        description: "Activity feed pagination test project",
        emoji: "📡",
        color: "#2563eb",
      },
    });
    expect(projectRes.status()).toBe(201);
    const projectId = (await projectRes.json()).project.id as string;
    createdProjectIds.push(projectId);

    const agentRes = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[ORCH-ACTIVITY] Agent ${suffix}`,
        emoji: "🤖",
        role: "Backend Engineer",
        personality: "Test worker",
      },
    });
    expect(agentRes.status()).toBe(201);
    const agentId = (await agentRes.json()).agent.id as string;

    const taskRes = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: `[ORCH-ACTIVITY] Task ${suffix}`,
        description: "Create status transitions to generate activity feed events",
        priority: "P1",
        type: "feature",
      },
    });
    expect(taskRes.status()).toBe(201);
    const taskId = (await taskRes.json()).task.id as string;

    const assignRes = await request.patch(`/api/orchestration/tasks/${taskId}/assign`, {
      data: { assignee: agentId },
    });
    expect(assignRes.status()).toBe(200);

    const toOnDeck = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "on-deck" },
    });
    expect(toOnDeck.status()).toBe(200);

    const toInProgress = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "in-progress" },
    });
    expect(toInProgress.status()).toBe(200);

    const toReview = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "review" },
    });
    expect(toReview.status()).toBe(200);

    const toDone = await request.patch("/api/orchestration/tasks/reorder", {
      data: {
        taskId,
        status: "done",
        reviewNotes: "approved",
      },
    });
    expect(toDone.status()).toBe(200);

    const sprintRes = await request.post(`/api/orchestration/projects/${projectId}/sprints`, {
      data: {
        name: `[ORCH-ACTIVITY] Sprint ${suffix}`,
        goal: "Emit sprint events for feed coverage",
      },
    });
    expect(sprintRes.status()).toBe(201);
    const sprintId = (await sprintRes.json()).sprint.id as string;

    const updateSprintRes = await request.patch(`/api/orchestration/sprints/${sprintId}`, {
      data: {
        status: "done",
        goal: "Sprint completed",
      },
    });
    expect(updateSprintRes.status()).toBe(200);

    const firstPageRes = await request.get(`/api/orchestration/activity?limit=2&projectId=${projectId}`);
    expect(firstPageRes.status()).toBe(200);
    const firstPage = ActivityResponseSchema.parse(await firstPageRes.json());
    expect(firstPage.page.limit).toBe(2);
    expect(firstPage.activity.length).toBeLessThanOrEqual(2);
    expect(firstPage.activity.length).toBeGreaterThan(0);
    const ids = new Set(firstPage.activity.map((item) => item.id));
    expect(ids.size).toBe(firstPage.activity.length);

    if (firstPage.page.hasMore) {
      expect(firstPage.page.nextCursor).toBeTruthy();
      const secondPageRes = await request.get(
        `/api/orchestration/activity?limit=2&cursor=${encodeURIComponent(firstPage.page.nextCursor as string)}`
      );
      expect(secondPageRes.status()).toBe(200);
      const secondPage = ActivityResponseSchema.parse(await secondPageRes.json());
      const firstPageEventIds = new Set(firstPage.activity.map((item) => item.id));
      const overlap = secondPage.activity.some((item) => firstPageEventIds.has(item.id));
      expect(overlap).toBe(false);
    }

    const projectFilterRes = await request.get(`/api/orchestration/activity?limit=50&projectId=${projectId}`);
    expect(projectFilterRes.status()).toBe(200);
    const projectFiltered = ActivityResponseSchema.parse(await projectFilterRes.json());
    expect(projectFiltered.activity.length).toBeGreaterThan(0);
    expect(projectFiltered.activity.every((item) => item.projectId === projectId)).toBe(true);

    const hasSprintEvent = projectFiltered.activity.some((item) => item.eventType.startsWith("sprint."));
    expect(hasSprintEvent).toBe(true);

    const agentFilterRes = await request.get(`/api/orchestration/activity?limit=50&agentId=${agentId}`);
    expect(agentFilterRes.status()).toBe(200);
    const agentFiltered = ActivityResponseSchema.parse(await agentFilterRes.json());
    expect(agentFiltered.activity.length).toBeGreaterThan(0);
    expect(agentFiltered.activity.every((item) => item.agentId === agentId)).toBe(true);

    const invalidCursorRes = await request.get("/api/orchestration/activity?cursor=!!!not-base64!!!");
    expect(invalidCursorRes.status()).toBe(400);
    const invalidCursorBody = await invalidCursorRes.json();
    OrchErrorSchema.parse(invalidCursorBody);
    expect(invalidCursorBody.error.code).toBe("invalid_cursor");

    const missingProjectRes = await request.get("/api/orchestration/activity?projectId=missing-project");
    expect(missingProjectRes.status()).toBe(404);
    const missingProjectBody = await missingProjectRes.json();
    OrchErrorSchema.parse(missingProjectBody);
    expect(missingProjectBody.error.code).toBe("project_not_found");
  });
});
