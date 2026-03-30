/**
 * Mission Control — API Contract Tests
 *
 * Schema validation on every core endpoint. Uses Zod for schema definitions —
 * if a field is renamed, removed, or its type changes, the schema parse throws
 * with a precise, field-level error message before Gater sees the broken UI.
 *
 * Coverage:
 *   1.  GET  /api/health
 *   2.  GET  /api/tasks
 *   3.  POST /api/tasks
 *   4.  PATCH /api/tasks — ALL valid state machine transitions
 *   5.  PATCH /api/tasks — ALL invalid state machine transitions (by source state)
 *   6.  GET  /api/tasks/[id]/comments
 *   7.  POST /api/tasks/[id]/comments
 *   8.  GET  /api/projects
 *   9.  GET  /api/agents
 *   10. GET  /api/notifications
 *   11. POST /api/notifications
 *   12. PATCH /api/notifications
 *   13. DELETE /api/notifications
 *   14. GET  /api/factory/pipelines
 *   15. POST /api/factory/pipelines
 *   16. POST /api/tasks/build — validation only (no real build triggered)
 *
 * All tests create clearly-labelled [CONTRACT] test data and clean up in afterAll.
 * Serial execution (1 worker) is enforced by playwright.config.ts.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMAS — authoritative field-level contracts for each endpoint
// ─────────────────────────────────────────────────────────────────────────────

/** Every non-2xx response MUST match this — no exceptions */
const ErrorSchema = z.object({ error: z.string() });

/** Core task fields that must ALWAYS be present */
const TaskSchema = z.object({
  id: z.string().regex(/^TASK-\d+$/, "id must be TASK-{timestamp}"),
  status: z.enum(["backlog", "on-deck", "in-progress", "review", "blocked", "done"]),
  created: z.iso.datetime(),
  updated: z.iso.datetime(),
});

const CommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  authorEmoji: z.string(),
  text: z.string(),
  timestamp: z.iso.datetime(),
  type: z.enum(["note", "review", "rejection", "resolution"]),
});

const ServiceCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["up", "down", "degraded", "unknown"]),
  latency: z.number().optional(),
  details: z.string().optional(),
  url: z.string().optional(),
});

const HealthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "critical"]),
  checks: z.array(ServiceCheckSchema),
  timestamp: z.iso.datetime(),
  uptime: z.number(),
});

const NotificationSchema = z.object({
  id: z.uuid(),
  timestamp: z.iso.datetime(),
  title: z.string(),
  message: z.string(),
  type: z.enum(["info", "success", "warning", "error"]),
  read: z.boolean(),
  link: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ProjectSchema = z.object({
  id: z.string(),
  status: z.enum(["active", "inactive", "archived"]),
  taskCount: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  backlog: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
});

const AgentSchema = z.object({
  id: z.string(),
  emoji: z.string(),
  color: z.string(),
  model: z.string(),
  workspace: z.string(),
  status: z.enum(["online", "offline"]),
  activeSessions: z.number(),
});

const PipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: z.enum(["manual", "reddit", "idea-intake"]),
  stage: z.enum(["idea", "architecture", "build", "test", "deploy"]),
  status: z.enum(["active", "completed", "failed", "paused"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Parse via schema; throws with Zod's field-level diagnostic on failure */
function assertSchema<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Schema validation failed:\n${JSON.stringify(result.error.flatten(), null, 2)}`
    );
  }
  return result.data;
}

/** Walk a task to 'done' for cleanup — swallows errors on invalid transitions */
async function cleanupTask(request: APIRequestContext, taskId: string) {
  const steps: [string, Record<string, unknown>][] = [
    ["on-deck",     {}],
    ["in-progress", { acceptance_criteria: ["Cleanup criterion"] }],
    ["review",      {}],
    ["done",        { reviewAssignedTo: "Gater", reviewStatus: "approved" }],
  ];
  for (const [status, extra] of steps) {
    await request
      .patch("/api/tasks", { data: { id: taskId, status, ...extra } })
      .catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/health
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/health — response schema", () => {
  test("returns 200 with { status, checks[], timestamp, uptime }", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    const parsed = assertSchema(HealthResponseSchema, body);
    expect(["healthy", "degraded", "critical"]).toContain(parsed.status);
    expect(parsed.checks.length).toBeGreaterThan(0);
    expect(typeof parsed.uptime).toBe("number");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /api/tasks — response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/tasks — response schema", () => {
  test("returns { tasks: Task[] } with required fields on every item", async ({
    request,
  }) => {
    const res = await request.get("/api/tasks");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tasks");
    expect(Array.isArray(body.tasks)).toBe(true);
    for (const task of body.tasks) {
      // Only deep-validate tasks using the new TASK-{timestamp} format.
      // Legacy tasks (TASK-W*, TASK-C*, task-new-* etc.) predate required fields
      // and are excluded from schema enforcement here.
      if (/^TASK-\d+$/.test(task.id)) {
        assertSchema(TaskSchema, task);
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /api/tasks — request/response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/tasks — response schema", () => {
  const created: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of created) {
      await cleanupTask(request, id);
    }
  });

  test("returns { task: Task } with TASK-{timestamp} id format", async ({
    request,
  }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] POST schema test",
        description: "Contract test — safe to delete",
        status: "backlog",
        priority: "P3",
        type: "maintenance",
        project: "mission-control",
        tags: ["contract-test"],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("task");
    const task = assertSchema(TaskSchema, body.task);
    expect(task.status).toBe("backlog");
    created.push(task.id);
  });

  test("echoes back submitted fields in the response", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] Field echo test",
        status: "backlog",
        priority: "P2",
        project: "mission-control",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const task = assertSchema(TaskSchema, body.task);
    expect(body.task.title).toBe("[CONTRACT] Field echo test");
    expect(body.task.priority).toBe("P2");
    created.push(task.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. PATCH /api/tasks — valid state machine transitions (full happy path)
// ═════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/tasks — valid transitions (full lifecycle)", () => {
  test.describe.configure({ mode: "serial" });

  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] State machine — valid transitions",
        status: "backlog",
        priority: "P3",
        project: "mission-control",
        tags: ["contract-test"],
      },
    });
    taskId = (await res.json()).task.id;
  });

  test("backlog → on-deck: 200, status updated", async ({ request }) => {
    const res = await request.patch("/api/tasks", {
      data: { id: taskId, status: "on-deck" },
    });
    expect(res.status()).toBe(200);
    expect(assertSchema(TaskSchema, (await res.json()).task).status).toBe(
      "on-deck"
    );
  });

  test("on-deck → in-progress: 200, status updated", async ({ request }) => {
    const res = await request.patch("/api/tasks", {
      data: {
        id: taskId,
        status: "in-progress",
        acceptance_criteria: ["Contract test: task must reach done state"],
      },
    });
    expect(res.status()).toBe(200);
    expect(assertSchema(TaskSchema, (await res.json()).task).status).toBe(
      "in-progress"
    );
  });

  test("in-progress → review: 200 + reviewRequired + reviewStatus=pending + reviewRequestedAt", async ({
    request,
  }) => {
    const res = await request.patch("/api/tasks", {
      data: { id: taskId, status: "review" },
    });
    expect(res.status()).toBe(200);
    const { task } = await res.json();
    assertSchema(TaskSchema, task);
    expect(task.status).toBe("review");
    expect(task.reviewRequired).toBe(true);
    expect(task.reviewStatus).toBe("pending");
    expect(task).toHaveProperty("reviewRequestedAt");
  });

  test("review → in-progress: 200 (rejection path) + reviewStatus=changes-requested", async ({
    request,
  }) => {
    const res = await request.patch("/api/tasks", {
      data: {
        id: taskId,
        status: "in-progress",
        reviewStatus: "changes-requested",
      },
    });
    expect(res.status()).toBe(200);
    const { task } = await res.json();
    assertSchema(TaskSchema, task);
    expect(task.status).toBe("in-progress");
    expect(task.reviewStatus).toBe("changes-requested");
  });

  test("in-progress → review: 200 (re-submission after rejection)", async ({
    request,
  }) => {
    const res = await request.patch("/api/tasks", {
      data: { id: taskId, status: "review" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).task.status).toBe("review");
  });

  test("review → done: 200 (approval) + completedAt set + reviewStatus=approved", async ({
    request,
  }) => {
    const res = await request.patch("/api/tasks", {
      data: {
        id: taskId,
        status: "done",
        reviewStatus: "approved",
        reviewAssignedTo: "Gater",
      },
    });
    expect(res.status()).toBe(200);
    const { task } = await res.json();
    assertSchema(TaskSchema, task);
    expect(task.status).toBe("done");
    expect(task).toHaveProperty("completedAt");
    expect(task.reviewStatus).toBe("approved");
  });

  test("done → any transition: ALL rejected (terminal state)", async ({
    request,
  }) => {
    for (const target of [
      "backlog",
      "on-deck",
      "in-progress",
      "review",
      "blocked",
    ]) {
      const res = await request.patch("/api/tasks", {
        data: { id: taskId, status: target },
      });
      expect(res.status(), `done → ${target} should be 400`).toBe(400);
      assertSchema(ErrorSchema, await res.json());
    }
  });
});

test.describe("PATCH /api/tasks — valid blocked/unblocked path", () => {
  test.describe.configure({ mode: "serial" });

  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] State machine — blocked path",
        status: "backlog",
        project: "mission-control",
      },
    });
    taskId = (await res.json()).task.id;
    await request.patch("/api/tasks", { data: { id: taskId, status: "on-deck" } });
    await request.patch("/api/tasks", {
      data: {
        id: taskId,
        status: "in-progress",
        acceptance_criteria: ["Contract test: blocked path criterion"],
      },
    });
  });

  test.afterAll(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
  });

  test("in-progress → blocked: 200", async ({ request }) => {
    const res = await request.patch("/api/tasks", {
      data: { id: taskId, status: "blocked" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).task.status).toBe("blocked");
  });

  test("blocked → in-progress: 200", async ({ request }) => {
    const res = await request.patch("/api/tasks", {
      data: { id: taskId, status: "in-progress" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).task.status).toBe("in-progress");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. PATCH /api/tasks — invalid transitions (all source states)
// ═════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/tasks — invalid transitions from backlog", () => {
  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] Invalid from backlog",
        status: "backlog",
        project: "mission-control",
      },
    });
    taskId = (await res.json()).task.id;
  });

  test.afterAll(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
  });

  for (const target of ["in-progress", "review", "blocked", "done"]) {
    test(`backlog → ${target}: 400 with { error } matching /invalid status transition/`, async ({
      request,
    }) => {
      const res = await request.patch("/api/tasks", {
        data: { id: taskId, status: target },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      assertSchema(ErrorSchema, body);
      expect(body.error).toMatch(/invalid status transition/i);
    });
  }
});

test.describe("PATCH /api/tasks — invalid transitions from on-deck", () => {
  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] Invalid from on-deck",
        status: "backlog",
        project: "mission-control",
      },
    });
    taskId = (await res.json()).task.id;
    await request.patch("/api/tasks", {
      data: { id: taskId, status: "on-deck" },
    });
  });

  test.afterAll(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
  });

  for (const target of ["backlog", "review", "blocked", "done"]) {
    test(`on-deck → ${target}: 400 with { error } matching /invalid status transition/`, async ({
      request,
    }) => {
      const res = await request.patch("/api/tasks", {
        data: { id: taskId, status: target },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      assertSchema(ErrorSchema, body);
      expect(body.error).toMatch(/invalid status transition/i);
    });
  }
});

test.describe("PATCH /api/tasks — invalid transitions from in-progress", () => {
  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] Invalid from in-progress",
        status: "backlog",
        project: "mission-control",
      },
    });
    taskId = (await res.json()).task.id;
    await request.patch("/api/tasks", {
      data: { id: taskId, status: "on-deck" },
    });
    await request.patch("/api/tasks", {
      data: {
        id: taskId,
        status: "in-progress",
        acceptance_criteria: ["Contract test: invalid transitions from in-progress"],
      },
    });
  });

  test.afterAll(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
  });

  for (const target of ["backlog", "on-deck", "done"]) {
    test(`in-progress → ${target}: 400 with { error } matching /invalid status transition/`, async ({
      request,
    }) => {
      const res = await request.patch("/api/tasks", {
        data: { id: taskId, status: target },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      assertSchema(ErrorSchema, body);
      expect(body.error).toMatch(/invalid status transition/i);
    });
  }
});

test.describe("PATCH /api/tasks — invalid transitions from review", () => {
  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] Invalid from review",
        status: "backlog",
        project: "mission-control",
      },
    });
    taskId = (await res.json()).task.id;
    await request.patch("/api/tasks", {
      data: { id: taskId, status: "on-deck" },
    });
    await request.patch("/api/tasks", {
      data: {
        id: taskId,
        status: "in-progress",
        acceptance_criteria: ["Contract test: invalid transitions from review"],
      },
    });
    await request.patch("/api/tasks", {
      data: { id: taskId, status: "review" },
    });
  });

  test.afterAll(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
  });

  for (const target of ["backlog", "on-deck", "blocked"]) {
    test(`review → ${target}: 400 with { error } matching /invalid status transition/`, async ({
      request,
    }) => {
      const res = await request.patch("/api/tasks", {
        data: { id: taskId, status: target },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      assertSchema(ErrorSchema, body);
      expect(body.error).toMatch(/invalid status transition/i);
    });
  }
});

test.describe("PATCH /api/tasks — 404 on unknown task id", () => {
  test("returns 404 with { error } for non-existent task", async ({
    request,
  }) => {
    const res = await request.patch("/api/tasks", {
      data: { id: "TASK-0000000000000", status: "on-deck" },
    });
    expect(res.status()).toBe(404);
    assertSchema(ErrorSchema, await res.json());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. GET /api/tasks/[id]/comments — response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/tasks/[id]/comments — response schema", () => {
  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] GET comments schema",
        status: "backlog",
        project: "mission-control",
      },
    });
    taskId = (await res.json()).task.id;
  });

  test.afterAll(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
  });

  test("returns { comments: [] } for task with no comments", async ({
    request,
  }) => {
    const res = await request.get(`/api/tasks/${taskId}/comments`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("comments");
    expect(Array.isArray(body.comments)).toBe(true);
  });

  test("returns 404 with { error } for non-existent task", async ({
    request,
  }) => {
    const res = await request.get("/api/tasks/TASK-0000000000000/comments");
    expect(res.status()).toBe(404);
    assertSchema(ErrorSchema, await res.json());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. POST /api/tasks/[id]/comments — request validation + response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/tasks/[id]/comments — validation + response schema", () => {
  let taskId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/tasks", {
      data: {
        title: "[CONTRACT] POST comments",
        status: "backlog",
        project: "mission-control",
      },
    });
    taskId = (await res.json()).task.id;
  });

  test.afterAll(async ({ request }) => {
    if (taskId) await cleanupTask(request, taskId);
  });

  test("returns { comment, comments[] } with correct field shapes", async ({
    request,
  }) => {
    const res = await request.post(`/api/tasks/${taskId}/comments`, {
      data: {
        author: "Forge",
        authorEmoji: "🔧",
        text: "Contract test comment",
        type: "note",
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("comment");
    expect(body).toHaveProperty("comments");
    assertSchema(CommentSchema, body.comment);
    expect(Array.isArray(body.comments)).toBe(true);
    expect(body.comment.author).toBe("Forge");
    expect(body.comment.text).toBe("Contract test comment");
  });

  test("all valid comment types are accepted (note, review, rejection, resolution)", async ({
    request,
  }) => {
    for (const type of ["note", "review", "rejection", "resolution"]) {
      const res = await request.post(`/api/tasks/${taskId}/comments`, {
        data: { author: "Forge", text: `Type test: ${type}`, type },
      });
      expect(res.status(), `type="${type}" should be 200`).toBe(200);
      assertSchema(CommentSchema, (await res.json()).comment);
    }
  });

  test("missing required fields returns 400 with { error }", async ({
    request,
  }) => {
    const res = await request.post(`/api/tasks/${taskId}/comments`, {
      data: { author: "Forge" }, // missing text + type
    });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });

  test("invalid comment type returns 400 with { error }", async ({
    request,
  }) => {
    const res = await request.post(`/api/tasks/${taskId}/comments`, {
      data: { author: "Forge", text: "Test", type: "invalid-type" },
    });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });

  test("comment on non-existent task returns 404 with { error }", async ({
    request,
  }) => {
    const res = await request.post("/api/tasks/TASK-0000000000000/comments", {
      data: { author: "Forge", text: "Test", type: "note" },
    });
    expect(res.status()).toBe(404);
    assertSchema(ErrorSchema, await res.json());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. GET /api/projects — response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/projects — response schema", () => {
  test("returns { projects: Project[] } with all numeric counters present", async ({
    request,
  }) => {
    const res = await request.get("/api/projects");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("projects");
    expect(Array.isArray(body.projects)).toBe(true);
    for (const project of body.projects) {
      assertSchema(ProjectSchema, project);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. GET /api/agents — response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/agents — response schema", () => {
  test("returns { agents: Agent[] } with status + activeSessions fields", async ({
    request,
  }) => {
    const res = await request.get("/api/agents");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("agents");
    expect(Array.isArray(body.agents)).toBe(true);
    for (const agent of body.agents) {
      assertSchema(AgentSchema, agent);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. GET /api/notifications — response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/notifications — response schema", () => {
  test("returns { notifications: Notification[], unreadCount: number }", async ({
    request,
  }) => {
    const res = await request.get("/api/notifications");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("notifications");
    expect(body).toHaveProperty("unreadCount");
    expect(typeof body.unreadCount).toBe("number");
    expect(Array.isArray(body.notifications)).toBe(true);
    for (const n of body.notifications) {
      assertSchema(NotificationSchema, n);
    }
  });

  test("?unread=true returns only unread notifications", async ({ request }) => {
    const res = await request.get("/api/notifications?unread=true");
    expect(res.status()).toBe(200);
    const { notifications } = await res.json();
    for (const n of notifications) {
      expect(n.read, `notification ${n.id} should be unread`).toBe(false);
    }
  });

  test("?limit=2 caps the result count at 2", async ({ request }) => {
    const res = await request.get("/api/notifications?limit=2");
    expect(res.status()).toBe(200);
    const { notifications } = await res.json();
    expect(notifications.length).toBeLessThanOrEqual(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. POST /api/notifications — request validation + response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/notifications — validation + response schema", () => {
  const created: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of created) {
      await request.delete(`/api/notifications?id=${id}`).catch(() => {});
    }
  });

  test("returns created notification directly (201) — not wrapped in { notification }", async ({
    request,
  }) => {
    const res = await request.post("/api/notifications", {
      data: {
        title: "[CONTRACT] POST notification schema",
        message: "Created by contract test suite",
        type: "info",
      },
    });
    expect(res.status()).toBe(201);
    const n = assertSchema(NotificationSchema, await res.json());
    expect(n.title).toBe("[CONTRACT] POST notification schema");
    expect(n.type).toBe("info");
    expect(n.read).toBe(false);
    created.push(n.id);
  });

  test("all valid types accepted: info, success, warning, error", async ({
    request,
  }) => {
    for (const type of ["info", "success", "warning", "error"] as const) {
      const res = await request.post("/api/notifications", {
        data: { title: `[CONTRACT] type=${type}`, message: "Type test", type },
      });
      expect(res.status(), `type="${type}" should return 201`).toBe(201);
      const n = assertSchema(NotificationSchema, await res.json());
      expect(n.type).toBe(type);
      created.push(n.id);
    }
  });

  test("missing title returns 400 with { error }", async ({ request }) => {
    const res = await request.post("/api/notifications", {
      data: { message: "No title provided", type: "info" },
    });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });

  test("missing message returns 400 with { error }", async ({ request }) => {
    const res = await request.post("/api/notifications", {
      data: { title: "No message provided", type: "info" },
    });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });

  test("invalid type 'critical' returns 400 with { error }", async ({
    request,
  }) => {
    const res = await request.post("/api/notifications", {
      data: {
        title: "[CONTRACT] Invalid type",
        message: "Test",
        type: "critical",
      },
    });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. PATCH /api/notifications — read/unread toggle + markAllRead
// ═════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/notifications — validation + response schema", () => {
  test.describe.configure({ mode: "serial" });

  let notificationId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/notifications", {
      data: {
        title: "[CONTRACT] PATCH notification test",
        message: "For PATCH testing",
        type: "warning",
      },
    });
    notificationId = (await res.json()).id;
  });

  test.afterAll(async ({ request }) => {
    if (notificationId) {
      await request
        .delete(`/api/notifications?id=${notificationId}`)
        .catch(() => {});
    }
  });

  test("marks as read — returns updated Notification with read=true", async ({
    request,
  }) => {
    const res = await request.patch("/api/notifications", {
      data: { id: notificationId, read: true },
    });
    expect(res.status()).toBe(200);
    const n = assertSchema(NotificationSchema, await res.json());
    expect(n.read).toBe(true);
  });

  test("marks as unread — returns updated Notification with read=false", async ({
    request,
  }) => {
    const res = await request.patch("/api/notifications", {
      data: { id: notificationId, read: false },
    });
    expect(res.status()).toBe(200);
    const n = assertSchema(NotificationSchema, await res.json());
    expect(n.read).toBe(false);
  });

  test("markAllRead returns { success: true, updated: number }", async ({
    request,
  }) => {
    const res = await request.patch("/api/notifications", {
      data: { action: "markAllRead" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("updated");
    expect(typeof body.updated).toBe("number");
  });

  test("unknown id returns 404 with { error }", async ({ request }) => {
    const res = await request.patch("/api/notifications", {
      data: { id: "00000000-0000-0000-0000-000000000000", read: true },
    });
    expect(res.status()).toBe(404);
    assertSchema(ErrorSchema, await res.json());
  });

  test("empty body returns 400 with { error }", async ({ request }) => {
    const res = await request.patch("/api/notifications", { data: {} });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. DELETE /api/notifications — delete by id + clearRead
// ═════════════════════════════════════════════════════════════════════════════

test.describe("DELETE /api/notifications — validation + response schema", () => {
  test.describe.configure({ mode: "serial" });

  let notificationId = "";

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/notifications", {
      data: {
        title: "[CONTRACT] DELETE notification test",
        message: "For DELETE testing",
        type: "error",
      },
    });
    notificationId = (await res.json()).id;
  });

  test("deletes by id — returns { success: true }", async ({ request }) => {
    const res = await request.delete(
      `/api/notifications?id=${notificationId}`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("success", true);
    notificationId = ""; // consumed
  });

  test("unknown id returns 404 with { error }", async ({ request }) => {
    const res = await request.delete(
      "/api/notifications?id=00000000-0000-0000-0000-000000000000"
    );
    expect(res.status()).toBe(404);
    assertSchema(ErrorSchema, await res.json());
  });

  test("clearRead returns { success: true, deleted: number }", async ({
    request,
  }) => {
    const res = await request.delete("/api/notifications?action=clearRead");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("success", true);
    expect(body).toHaveProperty("deleted");
    expect(typeof body.deleted).toBe("number");
  });

  test("no id or action returns 400 with { error }", async ({ request }) => {
    const res = await request.delete("/api/notifications");
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. GET /api/factory/pipelines — response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/factory/pipelines — response schema", () => {
  test("returns { pipelines: Pipeline[] } with required fields", async ({
    request,
  }) => {
    const res = await request.get("/api/factory/pipelines");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("pipelines");
    expect(Array.isArray(body.pipelines)).toBe(true);
    for (const p of body.pipelines) {
      assertSchema(PipelineSchema, p);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. POST /api/factory/pipelines — request validation + response schema
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/factory/pipelines — validation + response schema", () => {
  test("returns { pipeline } (201) with stage=idea + status=active", async ({
    request,
  }) => {
    const res = await request.post("/api/factory/pipelines", {
      data: {
        name: "[CONTRACT] Test pipeline",
        description: "Created by contract test suite — safe to delete",
        source: "manual",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("pipeline");
    const pipeline = assertSchema(PipelineSchema, body.pipeline);
    expect(pipeline.name).toBe("[CONTRACT] Test pipeline");
    expect(pipeline.source).toBe("manual");
    expect(pipeline.stage).toBe("idea");
    expect(pipeline.status).toBe("active");
  });

  test("all valid source values accepted (manual, reddit, idea-intake)", async ({
    request,
  }) => {
    for (const source of ["manual", "reddit", "idea-intake"] as const) {
      const res = await request.post("/api/factory/pipelines", {
        data: {
          name: `[CONTRACT] source=${source}`,
          description: "Source type test",
          source,
        },
      });
      expect(res.status(), `source="${source}" should return 201`).toBe(201);
      const pipeline = assertSchema(
        PipelineSchema,
        (await res.json()).pipeline
      );
      expect(pipeline.source).toBe(source);
    }
  });

  test("missing name returns 400 with { error }", async ({ request }) => {
    const res = await request.post("/api/factory/pipelines", {
      data: { description: "No name provided" },
    });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });

  test("missing description returns 400 with { error }", async ({
    request,
  }) => {
    const res = await request.post("/api/factory/pipelines", {
      data: { name: "No description provided" },
    });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. POST /api/tasks/build — request validation
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/tasks/build — request validation", () => {
  test("missing taskId returns 400 with { error }", async ({ request }) => {
    const res = await request.post("/api/tasks/build", { data: {} });
    expect(res.status()).toBe(400);
    assertSchema(ErrorSchema, await res.json());
  });

  test("non-existent taskId returns 404 with { error }", async ({ request }) => {
    const res = await request.post("/api/tasks/build", {
      data: { taskId: "TASK-0000000000000" },
    });
    expect(res.status()).toBe(404);
    assertSchema(ErrorSchema, await res.json());
  });
});
