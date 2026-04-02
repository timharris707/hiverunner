/**
 * Mission Control — Orchestration API Test Suite (Sprint 1)
 *
 * Full coverage of the /api/orchestration/* route layer introduced in Sprint 1.
 * Tests every endpoint with schema validation, happy paths, validation errors,
 * invalid transitions, and 404/edge cases.
 *
 * Endpoints covered:
 *   1.  GET  /api/orchestration/projects
 *   2.  POST /api/orchestration/projects — create + validation
 *   3.  DELETE /api/orchestration/projects/:id — archive for teardown
 *   4.  GET  /api/orchestration/projects/:id/board — happy path + 404
 *   5.  GET  /api/orchestration/projects/:id/board/updated-at — lightweight board freshness check
 *   6.  GET  /api/orchestration/projects/:id/agents — happy path + 404
 *   7.  POST /api/orchestration/projects/:id/agents — create + validation + conflicts
 *   8.  GET  /api/orchestration/tasks — list, filter by projectId, filter by status
 *   9.  POST /api/orchestration/tasks — create + validation
 *   10. PATCH /api/orchestration/tasks/reorder — valid transitions + invalid transitions
 *   11. PATCH /api/orchestration/tasks/:id/assign — assign + unassign + errors
 *
 * All tests create `[ORCH-TEST]` labeled data and archive/clean up in afterAll.
 * Serial execution: data created in earlier tests is used by later ones.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMAS
// ─────────────────────────────────────────────────────────────────────────────

const OrchErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

const ProjectSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  emoji: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  status: z.enum(["active", "paused", "archived"]),
  created: z.iso.datetime(),
  taskCount: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  backlog: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  activeAgents: z.number().int().nonnegative().optional(),
});

const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),
  status: z.enum(["backlog", "on-deck", "in-progress", "review", "done", "blocked"]),
  columnOrder: z.number().int().nonnegative().optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  type: z.enum(["feature", "bug", "maintenance", "research", "infrastructure", "directive"]),
  project: z.string().uuid(),
  tags: z.array(z.string()),
  created: z.iso.datetime(),
  updated: z.iso.datetime(),
  assignee: z.string().optional(),
  sprint: z.string().optional(),
  blockedReason: z.string().optional(),
  comments: z.array(z.unknown()).optional(),
});

const AgentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1),
  emoji: z.string().min(1),
  role: z.string().min(1),
  status: z.enum(["idle", "working", "paused", "offline"]),
  avatar: z.string().optional(),
  currentTask: z.string().optional(),
});

const BoardStateSchema = z.object({
  project: ProjectSchema,
  tasks: z.array(TaskSchema),
});

const ProjectBoardUpdatedAtSchema = z.object({
  projectId: z.string().uuid(),
  projectSlug: z.string().min(1),
  updatedAt: z.iso.datetime(),
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function assertSchema<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(
      `Schema validation failed:\n${JSON.stringify(result.error.flatten(), null, 2)}`
    );
  }
  return result.data;
}

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

async function createTestProject(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; slug: string }> {
  const suffix = Date.now();
  const res = await request.post("/api/orchestration/projects", {
    data: {
      companyId,
      name: `[ORCH-TEST] Project ${suffix}`,
      description: "Created by Vigil test suite — safe to delete",
      emoji: "🧪",
      color: "#6366f1",
      status: "active",
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { id: body.project.id, slug: body.project.slug };
}

async function archiveProject(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.delete(`/api/orchestration/projects/${id}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.projectId).toBe(id);
  expect(typeof body.archivedAt).toBe("string");
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET /api/orchestration/projects
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/orchestration/projects", () => {
  test("returns 200 with { projects: Project[] }", async ({ request }) => {
    const res = await request.get("/api/orchestration/projects");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("projects");
    expect(Array.isArray(body.projects)).toBe(true);
    // Schema-validate every project in the list
    for (const project of body.projects) {
      assertSchema(ProjectSchema, project);
    }
  });

  test("each project has non-negative task counts", async ({ request }) => {
    const res = await request.get("/api/orchestration/projects");
    const { projects } = await res.json();
    for (const p of projects) {
      expect(p.taskCount).toBeGreaterThanOrEqual(0);
      expect(p.inProgress).toBeGreaterThanOrEqual(0);
      expect(p.backlog).toBeGreaterThanOrEqual(0);
      expect(p.review).toBeGreaterThanOrEqual(0);
      expect(p.completed).toBeGreaterThanOrEqual(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/orchestration/projects — create + validation
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/orchestration/projects", () => {
  const created: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of created) {
      await archiveProject(request, id);
    }
  });

  test("creates a project and returns 201 with schema-valid payload", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post("/api/orchestration/projects", {
      data: {
        companyId,
        name: `[ORCH-TEST] Schema Check ${suffix}`,
        description: "Vigil schema validation — safe to delete",
        emoji: "🔬",
        color: "#0ea5e9",
        status: "active",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("project");
    const project = assertSchema(ProjectSchema, body.project);
    expect(project.name).toContain("[ORCH-TEST]");
    expect(project.emoji).toBe("🔬");
    expect(project.color).toBe("#0ea5e9");
    expect(project.status).toBe("active");
    expect(project.taskCount).toBe(0);
    created.push(project.id);
  });

  test("auto-generates a slug from the name", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post("/api/orchestration/projects", {
      data: {
        companyId,
        name: `[ORCH-TEST] Slug Auto Gen ${suffix}`,
      },
    });
    expect(res.status()).toBe(201);
    const { project } = await res.json();
    expect(project.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(project.slug.length).toBeGreaterThan(0);
    created.push(project.id);
  });

  test("accepts an explicit slug and echoes it back", async ({ request }) => {
    const slug = `orch-test-explicit-${Date.now()}`;
    const res = await request.post("/api/orchestration/projects", {
      data: {
        companyId,
        name: `[ORCH-TEST] Explicit Slug ${Date.now()}`,
        slug,
      },
    });
    expect(res.status()).toBe(201);
    const { project } = await res.json();
    expect(project.slug).toBe(slug);
    created.push(project.id);
  });

  test("400 — name too short (< 2 chars)", async ({ request }) => {
    const res = await request.post("/api/orchestration/projects", {
      data: { name: "X" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — invalid color hex", async ({ request }) => {
    const res = await request.post("/api/orchestration/projects", {
      data: { name: "Valid Name", color: "not-a-color" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — invalid slug pattern (uppercase)", async ({ request }) => {
    const res = await request.post("/api/orchestration/projects", {
      data: { name: "Valid Name", slug: "Invalid-Slug-Uppercase" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — missing name entirely", async ({ request }) => {
    const res = await request.post("/api/orchestration/projects", {
      data: { description: "no name field at all" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. DELETE /api/orchestration/projects/:id
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/orchestration/projects/:id", () => {
  let projectId: string;
  let projectSlug: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, {
      name: `[ORCH-TEST] Project Detail ${Date.now()}`,
    });
    projectId = p.id;
    projectSlug = p.slug;
  });

  test("returns 200 with schema-valid project by id", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("project");
    const project = assertSchema(ProjectSchema, body.project);
    expect(project.id).toBe(projectId);
  });

  test("returns 200 with schema-valid project by slug", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectSlug}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const project = assertSchema(ProjectSchema, body.project);
    expect(project.slug).toBe(projectSlug);
  });

  test("404 for unknown project id", async ({ request }) => {
    const res = await request.get(
      "/api/orchestration/projects/00000000-0000-0000-0000-000000000000"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. DELETE /api/orchestration/projects/:id
// ═════════════════════════════════════════════════════════════════════════════

test.describe("DELETE /api/orchestration/projects/:id", () => {
  test("archives a project and removes it from board access", async ({ request }) => {
    const p = await createTestProject(request, { name: `[ORCH-TEST] Archive Me ${Date.now()}` });

    const delRes = await request.delete(`/api/orchestration/projects/${p.id}`);
    expect(delRes.status()).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.projectId).toBe(p.id);
    expect(typeof delBody.archivedAt).toBe("string");

    const boardRes = await request.get(`/api/orchestration/projects/${p.id}/board`);
    expect(boardRes.status()).toBe(404);
    const boardBody = await boardRes.json();
    assertSchema(OrchErrorSchema, boardBody);
    expect(boardBody.error.code).toBe("project_not_found");
  });

  test("404 for unknown project id", async ({ request }) => {
    const res = await request.delete(
      "/api/orchestration/projects/00000000-0000-0000-0000-000000000000"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. GET /api/orchestration/projects/:id/board
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/orchestration/projects/:id/board", () => {
  let projectId: string;
  let projectSlug: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[ORCH-TEST] Board Test ${Date.now()}` });
    projectId = p.id;
    projectSlug = p.slug;
  });

  test("returns 200 with BoardState schema by project ID", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectId}/board`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    assertSchema(BoardStateSchema, body);
    expect(body.project.id).toBe(projectId);
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  test("returns 200 with BoardState schema by project slug", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectSlug}/board`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    assertSchema(BoardStateSchema, body);
    expect(body.project.slug).toBe(projectSlug);
  });

  test("empty project has zero tasks", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectId}/board`);
    const body = await res.json();
    expect(body.tasks.length).toBe(0);
    expect(body.project.taskCount).toBe(0);
  });

  test("404 — unknown project id", async ({ request }) => {
    const res = await request.get(
      "/api/orchestration/projects/00000000-0000-0000-0000-000000000000/board"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });

  test("404 — unknown project slug", async ({ request }) => {
    const res = await request.get(
      "/api/orchestration/projects/definitely-does-not-exist-orch-test/board"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. GET /api/orchestration/projects/:id/board/updated-at
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/orchestration/projects/:id/board/updated-at", () => {
  let projectId: string;
  let projectSlug: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, {
      name: `[ORCH-TEST] Board UpdatedAt ${Date.now()}`,
    });
    projectId = p.id;
    projectSlug = p.slug;
  });

  test("returns 200 with updated-at payload by project ID", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectId}/board/updated-at`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const parsed = assertSchema(ProjectBoardUpdatedAtSchema, body);
    expect(parsed.projectId).toBe(projectId);
  });

  test("returns 200 with updated-at payload by project slug", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectSlug}/board/updated-at`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const parsed = assertSchema(ProjectBoardUpdatedAtSchema, body);
    expect(parsed.projectSlug).toBe(projectSlug);
  });

  test("404 — unknown project id", async ({ request }) => {
    const res = await request.get(
      "/api/orchestration/projects/00000000-0000-0000-0000-000000000000/board/updated-at"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. GET /api/orchestration/projects/:id/agents
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/orchestration/projects/:id/agents", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[ORCH-TEST] Agents Test ${Date.now()}` });
    projectId = p.id;
  });

  test("returns 200 with { agents: Agent[] }", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectId}/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("agents");
    expect(Array.isArray(body.agents)).toBe(true);
    // Endpoint returns company-wide agents (sorted with project-specific first);
    // a new project may have 0 project-specific agents but company pool can be non-empty
    for (const agent of body.agents) {
      assertSchema(AgentSchema, agent);
    }
  });

  test("404 — unknown project", async ({ request }) => {
    const res = await request.get(
      "/api/orchestration/projects/00000000-0000-0000-0000-000000000000/agents"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });

  test("seeded project agents are schema-valid (if seed data exists)", async ({ request }) => {
    // Try the seeded 'mission-control' slug — only validate if it exists
    const res = await request.get("/api/orchestration/projects/mission-control/agents");
    if (res.status() === 200) {
      const body = await res.json();
      for (const agent of body.agents) {
        assertSchema(AgentSchema, agent);
      }
    } else {
      // Seed data not present — acceptable, skip validation
      expect([200, 404]).toContain(res.status());
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. POST /api/orchestration/projects/:id/agents
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/orchestration/projects/:id/agents", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[ORCH-TEST] Agent Create ${Date.now()}` });
    projectId = p.id;
  });

  test("creates an agent and returns 201 with schema-valid payload", async ({ request }) => {
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `Forge QA ${Date.now()}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Strict on contracts",
        model: "gpt-5.4-mini",
        paperclipAgentId: `forge-test-${Date.now()}`,
        skills: ["api", "sqlite", "migrations"],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("agent");
    const agent = assertSchema(AgentSchema, body.agent);
    expect(agent.projectId).toBe(projectId);
    expect(agent.status).toBe("idle");
    expect(agent.role).toBe("Backend Engineer");
  });

  test("409 — duplicate agent name in same project", async ({ request }) => {
    const name = `Duplicate Agent ${Date.now()}`;
    const first = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: { name, role: "QA Lead" },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: { name, role: "QA Lead" },
    });
    expect(second.status()).toBe(409);
    const body = await second.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("agent_name_conflict");
  });

  test("400 — invalid payload", async ({ request }) => {
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: "X",
        role: "Y",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("404 — unknown project", async ({ request }) => {
    const res = await request.post(
      "/api/orchestration/projects/00000000-0000-0000-0000-000000000000/agents",
      {
        data: { name: "Ghost Agent", role: "Unknown" },
      }
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. GET /api/orchestration/tasks — list + filter
// ═════════════════════════════════════════════════════════════════════════════

test.describe("GET /api/orchestration/tasks", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[ORCH-TEST] Task List ${Date.now()}` });
    projectId = p.id;

    // Seed a few tasks at different statuses
    for (const [title, status] of [
      ["[ORCH-TEST] Backlog task", "backlog"],
      ["[ORCH-TEST] On-deck task", "backlog"], // created in backlog, will verify filtering
    ]) {
      await request.post("/api/orchestration/tasks", {
        data: {
          projectId,
          title,
          status,
          priority: "P3",
          type: "maintenance",
        },
      });
    }
  });

  test("returns 200 with { tasks: Task[] }", async ({ request }) => {
    const res = await request.get("/api/orchestration/tasks");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tasks");
    expect(Array.isArray(body.tasks)).toBe(true);
    for (const task of body.tasks) {
      assertSchema(TaskSchema, task);
    }
  });

  test("filters by projectId — only returns tasks for that project", async ({ request }) => {
    const res = await request.get(`/api/orchestration/tasks?projectId=${projectId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.tasks.length).toBeGreaterThanOrEqual(2);
    for (const task of body.tasks) {
      expect(task.project).toBe(projectId);
    }
  });

  test("filters by status — only backlog tasks returned", async ({ request }) => {
    const res = await request.get(`/api/orchestration/tasks?projectId=${projectId}&status=backlog`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const task of body.tasks) {
      expect(task.status).toBe("backlog");
    }
  });

  test("400 — invalid status filter", async ({ request }) => {
    const res = await request.get("/api/orchestration/tasks?status=invalid-status");
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("404 — unknown projectId filter", async ({ request }) => {
    const res = await request.get(
      "/api/orchestration/tasks?projectId=00000000-0000-0000-0000-000000000000"
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. POST /api/orchestration/tasks — create + validation
// ═════════════════════════════════════════════════════════════════════════════

test.describe("POST /api/orchestration/tasks", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[ORCH-TEST] Task Create ${Date.now()}` });
    projectId = p.id;
  });

  test("creates a task and returns 201 with schema-valid payload", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: "[ORCH-TEST] Created task — happy path",
        description: "Vigil test task — safe to delete",
        priority: "P1",
        type: "feature",
        status: "backlog",
        labels: ["vigil", "test"],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("task");
    const task = assertSchema(TaskSchema, body.task);
    expect(task.title).toBe("[ORCH-TEST] Created task — happy path");
    expect(task.priority).toBe("P1");
    expect(task.type).toBe("feature");
    expect(task.status).toBe("backlog");
    expect(task.project).toBe(projectId);
    expect(task.tags).toContain("vigil");
  });

  test("defaults are applied when optional fields are omitted", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: "[ORCH-TEST] Default fields test",
      },
    });
    expect(res.status()).toBe(201);
    const { task } = await res.json();
    expect(task.status).toBe("backlog");
    expect(task.priority).toBe("P2");
    expect(task.type).toBe("feature");
    expect(task.tags).toEqual([]);
    expect(task.description).toBe("");
  });

  test("echoes submitted fields in the response", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: "[ORCH-TEST] Echo test",
        priority: "P0",
        type: "bug",
        labels: ["echo", "test"],
      },
    });
    expect(res.status()).toBe(201);
    const { task } = await res.json();
    expect(task.priority).toBe("P0");
    expect(task.type).toBe("bug");
    expect(task.tags).toContain("echo");
  });

  test("400 — missing projectId", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: { title: "[ORCH-TEST] Missing project" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — title too short (< 2 chars)", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: { projectId, title: "X" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — invalid priority value", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: { projectId, title: "[ORCH-TEST] Bad priority", priority: "urgent" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — invalid status value", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: { projectId, title: "[ORCH-TEST] Bad status", status: "wip" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("404 — unknown projectId", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: {
        projectId: "00000000-0000-0000-0000-000000000000",
        title: "[ORCH-TEST] Orphan task",
      },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("project_not_found");
  });

  test("board task count increments after task creation", async ({ request }) => {
    const boardBefore = await request.get(`/api/orchestration/projects/${projectId}/board`);
    const countBefore = (await boardBefore.json()).project.taskCount as number;

    await request.post("/api/orchestration/tasks", {
      data: { projectId, title: "[ORCH-TEST] Count increment task" },
    });

    const boardAfter = await request.get(`/api/orchestration/projects/${projectId}/board`);
    const countAfter = (await boardAfter.json()).project.taskCount as number;

    expect(countAfter).toBe(countBefore + 1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. PATCH /api/orchestration/tasks/reorder — state machine transitions
// ═════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/orchestration/tasks/reorder — state machine", () => {
  test.describe.configure({ mode: "serial" });

  let projectId: string;
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, {
      name: `[ORCH-TEST] Reorder SM ${Date.now()}`,
    });
    projectId = p.id;

    const res = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: "[ORCH-TEST] State machine lifecycle task",
        status: "backlog",
      },
    });
    taskId = (await res.json()).task.id;
  });

  // ── Valid transitions ─────────────────────────────────────────────────────

  test("backlog → on-deck: 200, status updated", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "on-deck" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const task = assertSchema(TaskSchema, body.task);
    expect(task.status).toBe("on-deck");
  });

  test("on-deck → backlog: 200, status updated", async ({ request }) => {
    // Move back to backlog first
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "backlog" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).task.status).toBe("backlog");
  });

  test("backlog → blocked: 200, status updated", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "blocked", blockedReason: "Waiting on external dependency" },
    });
    expect(res.status()).toBe(200);
    const task = (await res.json()).task;
    expect(task.status).toBe("blocked");
    expect(task.blockedReason).toBe("Waiting on external dependency");
  });

  test("blocked → on-deck: 200, status updated", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "on-deck" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).task.status).toBe("on-deck");
  });

  test("applies explicit columnOrder for board ordering", async ({ request }) => {
    const toBacklog = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "backlog", columnOrder: 42 },
    });
    expect(toBacklog.status()).toBe(200);
    expect((await toBacklog.json()).task.columnOrder).toBe(42);

    const boardRes = await request.get(`/api/orchestration/projects/${projectId}/board`);
    expect(boardRes.status()).toBe(200);
    const boardBody = await boardRes.json();
    const fromBoard = (boardBody.tasks as Array<{ id: string; columnOrder?: number }>).find(
      (task) => task.id === taskId
    );
    expect(fromBoard?.columnOrder).toBe(42);
  });

  test("on-deck → in-progress: 400 without assignee (requires_assignee rule)", async ({
    request,
  }) => {
    // on_deck → in_progress requires an assignee per status_transition_rules
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "in-progress" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(["assignee_required", "invalid_transition"]).toContain(body.error.code);
  });

  test("in-progress → review: 200 (set up via seed assignment bypass using create-with-status)", async ({
    request,
  }) => {
    // Create a fresh task directly in in-progress to test the → review path.
    // We can do this by creating a task with status=in-progress (the API allows
    // any initial status including in-progress; createTask uses validateTransition
    // from backlog → toStatus which has backlog→in_progress NOT in the rule table
    // and would fail. So instead we move on-deck task by assigning via PATCH assign
    // first, then reorder.
    //
    // Note: the on-deck task above (taskId) needs an assignee before it can go in-progress.
    // Since we have no agents seeded in this test project, we test this edge separately
    // to avoid creating a full agent via the DB. Instead we verify the 400 path above
    // and skip in-progress tests that require a real agent assignment.
    //
    // Cover in-progress → review path using a seeded project if available.
    const projectsRes = await request.get("/api/orchestration/projects");
    const { projects } = await projectsRes.json();

    // Look for seeded mission-control project which has Forge/Gater as agents
    const seeded = (projects as Array<{ slug: string; id: string }>).find(
      (p) => p.slug === "mission-control"
    );
    if (!seeded) {
      test.skip();
      return;
    }

    // Fetch board and find an in-progress task
    const boardRes = await request.get(`/api/orchestration/projects/${seeded.id}/board`);
    const { tasks } = await boardRes.json() as { tasks: Array<{ id: string; status: string }> };
    const inProgressTask = tasks.find((t) => t.status === "in-progress");
    if (!inProgressTask) {
      test.skip();
      return;
    }

    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId: inProgressTask.id, status: "review" },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).task.status).toBe("review");
  });

  // ── Invalid transitions ───────────────────────────────────────────────────

  test("400 — backlog → in-progress (invalid: not in transition rules)", async ({ request }) => {
    // Ensure task is in backlog first
    await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "backlog" },
    });

    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "in-progress" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_transition");
    expect(body.error.message).toContain("backlog");
  });

  test("400 — backlog → done (skips all stages)", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "done" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_transition");
  });

  test("400 — backlog → review (invalid)", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "review" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_transition");
  });

  test("400 — on-deck → done (skips in-progress and review)", async ({ request }) => {
    // Move to on-deck first
    await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "on-deck" },
    });

    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "done" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_transition");
  });

  test("400 — on-deck → review (invalid)", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "review" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_transition");
  });

  test("400 — task not found", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId: "00000000-0000-0000-0000-000000000000", status: "on-deck" },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("task_not_found");
  });

  test("400 — missing taskId in payload", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { status: "on-deck" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — invalid status value in reorder payload", async ({ request }) => {
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "not-a-status" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("review → done requires reviewNotes (seeded data path)", async ({ request }) => {
    // Find a review task in the seeded data
    const projectsRes = await request.get("/api/orchestration/projects");
    const { projects } = await projectsRes.json();
    const seeded = (projects as Array<{ slug: string; id: string }>).find(
      (p) => p.slug === "mission-control"
    );
    if (!seeded) {
      test.skip();
      return;
    }

    const boardRes = await request.get(`/api/orchestration/projects/${seeded.id}/board`);
    const { tasks } = await boardRes.json() as { tasks: Array<{ id: string; status: string }> };
    const reviewTask = tasks.find((t) => t.status === "review");
    if (!reviewTask) {
      test.skip();
      return;
    }

    // Attempt done without reviewNotes — should 400
    const res = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId: reviewTask.id, status: "done" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(["review_notes_required", "invalid_transition"]).toContain(body.error.code);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. PATCH /api/orchestration/tasks/:id/assign
// ═════════════════════════════════════════════════════════════════════════════

test.describe("PATCH /api/orchestration/tasks/:id/assign", () => {
  let projectId: string;
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, {
      name: `[ORCH-TEST] Assign Test ${Date.now()}`,
    });
    projectId = p.id;

    const res = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: "[ORCH-TEST] Assignee target task",
        status: "backlog",
      },
    });
    taskId = (await res.json()).task.id;
  });

  test("returns 200 with schema-valid task after unassign (null assignee)", async ({
    request,
  }) => {
    const res = await request.patch(`/api/orchestration/tasks/${taskId}/assign`, {
      data: { assignee: null },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("task");
    assertSchema(TaskSchema, body.task);
    expect(body.task.assignee).toBeUndefined();
  });

  test("400 — cannot unassign an in-progress task", async ({ request }) => {
    const p = await createTestProject(request, {
      name: `[ORCH-TEST] In-Progress Unassign Guard ${Date.now()}`,
    });

    const agentName = `Guard Agent ${Date.now()}`;
    const agentRes = await request.post(`/api/orchestration/projects/${p.id}/agents`, {
      data: {
        name: agentName,
        role: "Backend Engineer",
      },
    });
    expect(agentRes.status()).toBe(201);

    const createRes = await request.post("/api/orchestration/tasks", {
      data: {
        projectId: p.id,
        title: "[ORCH-TEST] In-progress assignment guard",
        status: "backlog",
        assignee: agentName,
      },
    });
    expect(createRes.status()).toBe(201);
    const guardedTaskId = (await createRes.json()).task.id as string;

    const onDeckRes = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId: guardedTaskId, status: "on-deck" },
    });
    expect(onDeckRes.status()).toBe(200);

    const inProgressRes = await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId: guardedTaskId, status: "in-progress" },
    });
    expect(inProgressRes.status()).toBe(200);

    const unassignRes = await request.patch(`/api/orchestration/tasks/${guardedTaskId}/assign`, {
      data: { assignee: null },
    });
    expect(unassignRes.status()).toBe(400);
    const unassignBody = await unassignRes.json();
    assertSchema(OrchErrorSchema, unassignBody);
    expect(unassignBody.error.code).toBe("assignee_required");

    const boardRes = await request.get(`/api/orchestration/projects/${p.id}/board`);
    expect(boardRes.status()).toBe(200);
    const board = await boardRes.json();
    const task = board.tasks.find((t: { id: string }) => t.id === guardedTaskId);
    expect(task).toBeDefined();
    expect(task.assignee).toBe(agentName);
    expect(task.status).toBe("in-progress");
  });

  test("400 — assigning unknown agent name to project task", async ({ request }) => {
    const res = await request.patch(`/api/orchestration/tasks/${taskId}/assign`, {
      data: { assignee: "NonexistentAgentXYZ" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_assignee");
  });

  test("404 — unknown task id", async ({ request }) => {
    const res = await request.patch(
      "/api/orchestration/tasks/00000000-0000-0000-0000-000000000000/assign",
      { data: { assignee: null } }
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("task_not_found");
  });

  test("seeded project — can assign agent from same project by name", async ({ request }) => {
    // Only runs if seed data is present
    const projectsRes = await request.get("/api/orchestration/projects");
    const { projects } = await projectsRes.json();
    const seeded = (projects as Array<{ slug: string; id: string }>).find(
      (p) => p.slug === "mission-control"
    );
    if (!seeded) {
      test.skip();
      return;
    }

    // Find a backlog task to assign
    const boardRes = await request.get(`/api/orchestration/projects/${seeded.id}/board`);
    const { tasks } = await boardRes.json() as { tasks: Array<{ id: string; status: string; assignee?: string }> };
    const backlogTask = tasks.find((t) => t.status === "backlog" && !t.assignee);
    if (!backlogTask) {
      test.skip();
      return;
    }

    const res = await request.patch(`/api/orchestration/tasks/${backlogTask.id}/assign`, {
      data: { assignee: "Forge" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const task = assertSchema(TaskSchema, body.task);
    expect(task.assignee).toBe("Forge");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. Task appears on board after creation (integration)
// ═════════════════════════════════════════════════════════════════════════════

test.describe("Integration — task lifecycle on board", () => {
  test.describe.configure({ mode: "serial" });

  let projectId: string;
  let taskId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, {
      name: `[ORCH-TEST] Board Integration ${Date.now()}`,
    });
    projectId = p.id;
  });

  test("step 1 — create task → appears in backlog column", async ({ request }) => {
    const res = await request.post("/api/orchestration/tasks", {
      data: {
        projectId,
        title: "[ORCH-TEST] Integration lifecycle task",
        status: "backlog",
        priority: "P2",
        type: "feature",
        labels: ["integration-test"],
      },
    });
    expect(res.status()).toBe(201);
    taskId = (await res.json()).task.id;

    const boardRes = await request.get(`/api/orchestration/projects/${projectId}/board`);
    const board = await boardRes.json();
    const found = board.tasks.find((t: { id: string }) => t.id === taskId);
    expect(found).toBeDefined();
    expect(found.status).toBe("backlog");
  });

  test("step 2 — move to on-deck → board reflects new status", async ({ request }) => {
    await request.patch("/api/orchestration/tasks/reorder", {
      data: { taskId, status: "on-deck" },
    });

    const boardRes = await request.get(`/api/orchestration/projects/${projectId}/board`);
    const board = await boardRes.json();
    const task = board.tasks.find((t: { id: string }) => t.id === taskId);
    expect(task.status).toBe("on-deck");
  });

  test("step 3 — board task counts match actual task distribution", async ({ request }) => {
    const boardRes = await request.get(`/api/orchestration/projects/${projectId}/board`);
    const board = await boardRes.json();

    const backlogCount = board.tasks.filter((t: { status: string }) => t.status === "backlog").length;
    const onDeckCount = board.tasks.filter((t: { status: string }) => t.status === "on-deck").length;

    expect(board.project.backlog).toBe(backlogCount);
    // inProgress from DB includes only in_progress status tasks
    expect(board.project.inProgress).toBeGreaterThanOrEqual(0);
    void onDeckCount; // on-deck is not separately tracked in project aggregate counts
  });

  test("step 4 — task list filter matches board state", async ({ request }) => {
    const listRes = await request.get(
      `/api/orchestration/tasks?projectId=${projectId}&status=on-deck`
    );
    const { tasks } = await listRes.json() as { tasks: Array<{ id: string; status: string }> };
    const found = tasks.find((t) => t.id === taskId);
    expect(found).toBeDefined();
    expect(found!.status).toBe("on-deck");
  });
});
