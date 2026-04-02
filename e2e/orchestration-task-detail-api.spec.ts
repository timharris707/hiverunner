import { expect, test } from "@playwright/test";
import { z } from "zod";

const OrchestrationErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),
  status: z.enum(["backlog", "on-deck", "in-progress", "review", "done", "blocked"]),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  type: z.enum(["feature", "bug", "maintenance", "research", "infrastructure", "directive"]),
  project: z.string().uuid(),
  tags: z.array(z.string()),
  created: z.iso.datetime(),
  updated: z.iso.datetime(),
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

test.describe("Task Detail CRUD API", () => {
  const createdProjectIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const projectId of createdProjectIds) {
      const res = await request.delete(`/api/orchestration/projects/${projectId}`);
      expect([200, 404]).toContain(res.status());
    }
  });

  test("GET/PATCH/DELETE /api/orchestration/tasks/:id", async ({ request }) => {
    const suffix = Date.now();

    const projectRes = await request.post("/api/orchestration/projects", {
      data: {
        companyId,
        name: `[ORCH-TASK-DETAIL] Project ${suffix}`,
        description: "Task detail CRUD API coverage",
        color: "#0ea5e9",
        emoji: "🧱",
      },
    });
    expect(projectRes.status()).toBe(201);
    const projectId = (await projectRes.json()).project.id as string;
    createdProjectIds.push(projectId);

    const taskRes = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: `[ORCH-TASK-DETAIL] Task ${suffix}`,
        description: "Initial description",
        priority: "P2",
        type: "feature",
        labels: ["api"],
      },
    });
    expect(taskRes.status()).toBe(201);
    const taskId = (await taskRes.json()).task.id as string;

    const getTaskRes = await request.get(`/api/orchestration/tasks/${taskId}`);
    expect(getTaskRes.status()).toBe(200);
    const getTaskBody = await getTaskRes.json();
    TaskSchema.parse(getTaskBody.task);
    expect(getTaskBody.task.id).toBe(taskId);

    const patchTaskRes = await request.patch(`/api/orchestration/tasks/${taskId}`, {
      data: {
        title: `[ORCH-TASK-DETAIL] Updated ${suffix}`,
        description: "Updated description",
        priority: "P1",
        type: "infrastructure",
        labels: ["api", "update"],
        blockedReason: null,
        reviewNotes: "Ready for review",
      },
    });
    expect(patchTaskRes.status()).toBe(200);
    const patchTaskBody = await patchTaskRes.json();
    TaskSchema.parse(patchTaskBody.task);
    expect(patchTaskBody.task.title).toContain("Updated");
    expect(patchTaskBody.task.description).toBe("Updated description");
    expect(patchTaskBody.task.priority).toBe("P1");
    expect(patchTaskBody.task.type).toBe("infrastructure");
    expect(patchTaskBody.task.tags).toEqual(["api", "update"]);

    const patchEmptyRes = await request.patch(`/api/orchestration/tasks/${taskId}`, {
      data: {},
    });
    expect(patchEmptyRes.status()).toBe(400);
    const patchEmptyBody = await patchEmptyRes.json();
    OrchestrationErrorSchema.parse(patchEmptyBody);
    expect(patchEmptyBody.error.code).toBe("validation_error");

    const deleteTaskRes = await request.delete(`/api/orchestration/tasks/${taskId}`);
    expect(deleteTaskRes.status()).toBe(200);
    const deleteTaskBody = await deleteTaskRes.json();
    expect(deleteTaskBody.taskId).toBe(taskId);
    expect(typeof deleteTaskBody.archivedAt).toBe("string");

    const getArchivedTaskRes = await request.get(`/api/orchestration/tasks/${taskId}`);
    expect(getArchivedTaskRes.status()).toBe(404);
    const getArchivedTaskBody = await getArchivedTaskRes.json();
    OrchestrationErrorSchema.parse(getArchivedTaskBody);
    expect(getArchivedTaskBody.error.code).toBe("task_not_found");
  });
});
