import { expect, test } from "@playwright/test";
import { z } from "zod";

const OrchErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

const InboxEventSchema = z.object({
  id: z.string().min(1),
  eventType: z.enum([
    "task.created",
    "task.updated",
    "task.archived",
    "task.reordered",
    "task.status_changed",
    "task.assigned",
    "task.unassigned",
    "task.comment_added",
    "execution.pending",
    "execution.running",
    "execution.completed",
    "execution.failed",
    "execution.cancelled",
  ]),
  kind: z.enum(["task", "execution"]),
  companyId: z.string().uuid(),
  companySlug: z.string().min(1),
  companyName: z.string().min(1),
  projectId: z.string().uuid(),
  projectSlug: z.string().min(1),
  projectName: z.string().min(1),
  taskId: z.string().uuid().optional(),
  taskTitle: z.string().min(1).optional(),
  status: z.enum(["backlog", "on-deck", "in-progress", "review", "done", "blocked"]).optional(),
  agentId: z.string().uuid().optional(),
  agentName: z.string().min(1).optional(),
  provider: z.enum(["openclaw", "paperclip"]).optional(),
  message: z.string().min(1),
  timestamp: z.iso.datetime(),
});

const InboxResponseSchema = z.object({
  company: z.object({
    id: z.string().uuid(),
    slug: z.string().min(1),
    name: z.string().min(1),
  }),
  events: z.array(InboxEventSchema),
  page: z.object({
    limit: z.number().int().min(1),
    nextCursor: z.string().min(1).optional(),
    hasMore: z.boolean(),
  }),
  unreadCount: z.number().int().min(0),
  unreadSince: z.iso.datetime().optional(),
  tasks: z.array(z.unknown()),
  totals: z.object({
    backlog: z.number().int().min(0),
    "on-deck": z.number().int().min(0),
    "in-progress": z.number().int().min(0),
    review: z.number().int().min(0),
    done: z.number().int().min(0),
    blocked: z.number().int().min(0),
  }),
});

let companySlug: string;
let companyId: string;

test.beforeAll(async ({ request }) => {
  const res = await request.get("/api/orchestration/companies");
  expect(res.status()).toBe(200);
  const { companies } = await res.json();
  const core = (companies as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === "neveridle-core"
  );
  expect(core, "NeverIdle Core company not found").toBeTruthy();
  companySlug = core!.slug;
  companyId = core!.id;
});

test.describe("GET /api/orchestration/companies/[slug]/inbox", () => {
  const createdProjectIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const projectId of createdProjectIds) {
      const res = await request.delete(`/api/orchestration/projects/${projectId}`);
      expect([200, 404]).toContain(res.status());
    }
  });

  test("returns paginated task/agent activity with unread count", async ({ request }) => {
    const suffix = Date.now();

    const projectRes = await request.post("/api/orchestration/projects", {
      data: {
        companyId,
        name: `[ORCH-INBOX] Project ${suffix}`,
        description: "Company inbox activity test",
        emoji: "📥",
        color: "#0ea5e9",
      },
    });
    expect(projectRes.status()).toBe(201);
    const project = await projectRes.json();
    const projectId = project.project.id as string;
    createdProjectIds.push(projectId);

    const agentRes = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[ORCH-INBOX] Agent ${suffix}`,
        emoji: "🤖",
        role: "Backend Engineer",
        personality: "Inbox endpoint validator",
      },
    });
    expect(agentRes.status()).toBe(201);
    const agentId = (await agentRes.json()).agent.id as string;

    const taskRes = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: `[ORCH-INBOX] Task ${suffix}`,
        description: "Generate company inbox events",
        priority: "P1",
        type: "feature",
      },
    });
    expect(taskRes.status()).toBe(201);
    const taskId = (await taskRes.json()).task.id as string;

    expect(
      (
        await request.patch(`/api/orchestration/tasks/${taskId}/assign`, {
          data: { assignee: agentId },
        })
      ).status()
    ).toBe(200);

    expect(
      (
        await request.patch("/api/orchestration/tasks/reorder", {
          data: { taskId, status: "on-deck" },
        })
      ).status()
    ).toBe(200);

    expect(
      (
        await request.patch("/api/orchestration/tasks/reorder", {
          data: { taskId, status: "in-progress" },
        })
      ).status()
    ).toBe(200);

    expect(
      (
        await request.post(`/api/orchestration/tasks/${taskId}/comments`, {
          data: {
            body: "Inbox feed comment coverage",
            type: "comment",
            authorAgentId: agentId,
          },
        })
      ).status()
    ).toBe(201);

    const firstPageRes = await request.get(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox?projectId=${encodeURIComponent(projectId)}&includeTaskSnapshot=false&limit=2`
    );
    expect(firstPageRes.status()).toBe(200);
    const firstPage = InboxResponseSchema.parse(await firstPageRes.json());

    expect(firstPage.page.limit).toBe(2);
    expect(firstPage.events.length).toBeLessThanOrEqual(2);
    expect(firstPage.events.length).toBeGreaterThan(0);
    expect(firstPage.events.every((event) => event.projectId === projectId)).toBe(true);
    expect(firstPage.tasks.length).toBe(0);
    expect(firstPage.unreadCount).toBeGreaterThan(0);

    if (firstPage.page.hasMore) {
      expect(firstPage.page.nextCursor).toBeTruthy();

      const secondPageRes = await request.get(
        `/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox?projectId=${encodeURIComponent(projectId)}&includeTaskSnapshot=false&limit=2&cursor=${encodeURIComponent(firstPage.page.nextCursor as string)}`
      );
      expect(secondPageRes.status()).toBe(200);
      const secondPage = InboxResponseSchema.parse(await secondPageRes.json());

      const firstPageIds = new Set(firstPage.events.map((event) => event.id));
      const overlap = secondPage.events.some((event) => firstPageIds.has(event.id));
      expect(overlap).toBe(false);
    }

    const latestTimestamp = firstPage.events[0]?.timestamp;
    expect(latestTimestamp).toBeTruthy();

    const unreadSinceRes = await request.get(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox?projectId=${encodeURIComponent(projectId)}&includeTaskSnapshot=false&unreadSince=${encodeURIComponent(latestTimestamp as string)}`
    );
    expect(unreadSinceRes.status()).toBe(200);
    const unreadSinceBody = InboxResponseSchema.parse(await unreadSinceRes.json());
    expect(unreadSinceBody.unreadCount).toBe(0);

    const invalidCursorRes = await request.get(
      `/api/orchestration/companies/${encodeURIComponent(companySlug)}/inbox?cursor=!!!bad!!!`
    );
    expect(invalidCursorRes.status()).toBe(400);
    const invalidCursorBody = await invalidCursorRes.json();
    OrchErrorSchema.parse(invalidCursorBody);
    expect(invalidCursorBody.error.code).toBe("invalid_cursor");
  });
});
