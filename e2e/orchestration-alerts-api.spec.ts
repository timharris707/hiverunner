import { expect, test } from "@playwright/test";
import { z } from "zod";

const AlertsResponseSchema = z.object({
  generatedAt: z.iso.datetime(),
  defaults: z.object({
    review: z.number().min(0),
    inProgress: z.number().min(0),
    blocked: z.number().min(0),
  }),
  alerts: z.array(
    z.object({
      taskId: z.string().uuid(),
      taskTitle: z.string().min(1),
      taskStatus: z.enum(["backlog", "on-deck", "in-progress", "review", "done", "blocked"]),
      projectId: z.string().uuid(),
      projectSlug: z.string().min(1),
      projectName: z.string().min(1),
      companyId: z.string().uuid().optional(),
      companySlug: z.string().min(1).optional(),
      companyName: z.string().min(1).optional(),
      assignee: z.string().min(1).optional(),
      lastUpdatedAt: z.iso.datetime(),
      staleMinutes: z.number().int().min(0),
      thresholdMinutes: z.number().int().min(0),
      exceededMinutes: z.number().int().min(0),
    })
  ),
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

test.describe("GET /api/orchestration/alerts", () => {
  const createdProjectIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const projectId of createdProjectIds) {
      const res = await request.delete(`/api/orchestration/projects/${projectId}`);
      expect([200, 404]).toContain(res.status());
    }
  });

  test("returns stale alerts using configurable project thresholds", async ({ request }) => {
    const suffix = Date.now();

    const createProjectRes = await request.post("/api/orchestration/projects", {
      data: {
        companyId,
        name: `[ORCH-ALERTS] Project ${suffix}`,
        description: "Stale alert API test",
        color: "#0891b2",
        emoji: "🚨",
      },
    });
    expect(createProjectRes.status()).toBe(201);
    const project = (await createProjectRes.json()).project as { id: string };
    createdProjectIds.push(project.id);

    const patchSettingsRes = await request.patch(`/api/orchestration/projects/${project.id}`, {
      data: {
        staleAlertThresholdsHours: {
          review: 0,
          inProgress: 0,
          blocked: 0,
        },
      },
    });
    expect(patchSettingsRes.status()).toBe(200);

    const createAgentRes = await request.post(`/api/orchestration/projects/${project.id}/agents`, {
      data: {
        name: `[ORCH-ALERTS] Agent ${suffix}`,
        role: "Backend Engineer",
        emoji: "🤖",
      },
    });
    expect(createAgentRes.status()).toBe(201);
    const agentId = (await createAgentRes.json()).agent.id as string;

    const createTaskRes = await request.post("/api/orchestration/tasks", {
      data: {
        projectId: project.id,
        title: `[ORCH-ALERTS] Task ${suffix}`,
        description: "Should appear in stale alerts immediately with 0h threshold",
        priority: "P2",
        type: "feature",
      },
    });
    expect(createTaskRes.status()).toBe(201);
    const taskId = (await createTaskRes.json()).task.id as string;

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

    const alertsRes = await request.get(`/api/orchestration/alerts?projectId=${project.id}`);
    expect(alertsRes.status()).toBe(200);
    const body = AlertsResponseSchema.parse(await alertsRes.json());
    const stale = body.alerts.find((alert) => alert.taskId === taskId);
    expect(stale).toBeTruthy();
    expect(stale?.taskStatus).toBe("in-progress");
    expect(stale?.thresholdMinutes).toBe(0);
  });

  test("returns 404 for unknown project filter", async ({ request }) => {
    const res = await request.get(
      "/api/orchestration/alerts?projectId=00000000-0000-0000-0000-000000000001"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("project_not_found");
  });
});
