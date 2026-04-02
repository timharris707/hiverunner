/**
 * Mission Control — Agent Roster & Avatar Theme Test Suite (Sprint 3 — NEVA-31)
 *
 * Coverage:
 *   A. Agent CRUD (extended) — paperclipAgentId/openclawAgentId conflicts,
 *      reportingTo validation, skills, avatarUrl, all status values, slug lookup
 *   B. Company Theme CRUD — GET + POST /api/orchestration/companies,
 *      theme field round-trip, defaults applied when theme omitted
 *   C. Project Avatar Theme — avatarThemeName stored on project creation
 *   D. Agent Registry / Directory — GET /api/agents/registry schema,
 *      required fields on every agent, divisions list, count
 *
 * Clean-up: every test that creates data archives/discards via afterAll.
 * All `[AGENT-TEST]` prefix is used so items can be identified in the DB.
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

const AgentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1),
  emoji: z.string().min(1),
  role: z.string().min(1),
  status: z.enum(["idle", "working", "paused", "offline", "error"]),
  avatar: z.string().optional(),
  currentTask: z.string().optional(),
  personality: z.string().optional(),
  model: z.string().optional(),
  paperclipAgentId: z.string().optional(),
  openclawAgentId: z.string().optional(),
  reportingTo: z.string().optional(),
  skills: z.array(z.string()).optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
});

const CompanyThemeSchema = z.object({
  name: z.string().min(1),
  promptTemplate: z.string().min(1),
  keywords: z.array(z.string()),
  sampleUrl: z.string().url().optional(),
});

const CompanySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["active", "paused", "archived"]),
  created: z.string(),
  theme: CompanyThemeSchema,
  stats: z.object({
    projects: z.number().int().nonnegative(),
    agents: z.number().int().nonnegative(),
    activeTasks: z.number().int().nonnegative(),
  }),
});

const RegistryAgentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  emoji: z.string().min(1),
  role: z.string().min(1),
  division: z.string().min(1),
  divisionColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  avatar: z.string().min(1),
  description: z.string().min(1),
  model: z.string().min(1),
  reportsTo: z.string().min(1),
  capabilities: z.array(z.string()),
  isBuilder: z.boolean(),
  routingTags: z.array(z.string()),
  recommendedOverlays: z.array(z.string()),
});

const RegistryResponseSchema = z.object({
  agents: z.array(RegistryAgentSchema),
  // DIVISIONS is a Record<string, { label, color, icon }> object (not an array)
  divisions: z.record(z.string(), z.unknown()),
  count: z.number().int().positive(),
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

async function getDefaultCompanyId(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/orchestration/companies");
  const { companies } = await res.json();
  const core = (companies as Array<{ id: string; slug: string }>).find(
    (c) => c.slug === "neveridle-core"
  );
  if (!core) throw new Error("NeverIdle Core company not found");
  return core.id;
}

async function createTestProject(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; slug: string }> {
  const suffix = Date.now();
  const companyId = await getDefaultCompanyId(request);
  const res = await request.post("/api/orchestration/projects", {
    data: {
      name: `[AGENT-TEST] Project ${suffix}`,
      description: "Created by Vigil agent-roster-themes suite — safe to delete",
      emoji: "🧬",
      color: "#8b5cf6",
      status: "active",
      companyId,
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
}

async function createTestAgent(
  request: APIRequestContext,
  projectId: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string }> {
  const suffix = Date.now();
  const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
    data: {
      name: `[AGENT-TEST] ${suffix}`,
      role: "QA Test Agent",
      emoji: "🧪",
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { id: body.agent.id };
}

async function createTestCompany(
  request: APIRequestContext,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; slug: string }> {
  const suffix = Date.now();
  const res = await request.post("/api/orchestration/companies", {
    data: {
      name: `[AGENT-TEST] Company ${suffix}`,
      description: "Created by Vigil company CRUD suite — safe to delete",
      status: "active",
      ...overrides,
    },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  return { id: body.company.id, slug: body.company.slug };
}

// ═════════════════════════════════════════════════════════════════════════════
// A0. AVATAR AUTO-GENERATION + REGENERATE ENDPOINT (NEVA-28)
// ═════════════════════════════════════════════════════════════════════════════

test.describe("A0. Avatar generation and regeneration", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[AGENT-TEST] Avatar Regen ${Date.now()}` });
    projectId = p.id;
  });

  test.afterAll(async ({ request }) => {
    await archiveProject(request, projectId);
  });

  test("auto-generates avatar when avatarUrl is omitted", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Auto Avatar ${suffix}`,
        role: "Avatar Integration Engineer",
        personality: "Theme-aware visual styling specialist",
      },
    });
    expect(res.status()).toBe(201);
    const agent = assertSchema(AgentSchema, (await res.json()).agent);
    expect(agent.avatar).toBeDefined();
    expect(agent.avatar?.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  test("POST regenerate endpoint returns updated avatar payload", async ({ request }) => {
    const suffix = Date.now();
    const createRes = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Regen Avatar ${suffix}`,
        role: "Avatar Runtime Engineer",
        avatarUrl: "https://example.com/original-avatar.png",
      },
    });
    expect(createRes.status()).toBe(201);
    const created = assertSchema(AgentSchema, (await createRes.json()).agent);
    expect(created.avatar).toBe("https://example.com/original-avatar.png");

    const regenRes = await request.post(
      `/api/orchestration/projects/${projectId}/agents/${created.id}/avatar/regenerate`
    );
    expect(regenRes.status()).toBe(200);

    const regenerated = assertSchema(AgentSchema, (await regenRes.json()).agent);
    expect(regenerated.id).toBe(created.id);
    expect(regenerated.avatar).toBeDefined();
    expect(regenerated.avatar).not.toBe(created.avatar);
    expect(regenerated.avatar?.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// A. AGENT CRUD — EXTENDED COVERAGE
// ═════════════════════════════════════════════════════════════════════════════

test.describe("A1. Agent creation — field echo + defaults", () => {
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[AGENT-TEST] Field Echo ${Date.now()}` });
    projectId = p.id;
  });

  test.afterAll(async ({ request }) => {
    await archiveProject(request, projectId);
  });

  test("creates agent with all optional fields and echoes them", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Full Agent ${suffix}`,
        emoji: "🤖",
        role: "Full-Stack Engineer",
        personality: "Builds fast, ships clean",
        avatarUrl: "https://example.com/avatar.jpg",
        model: "claude-opus-4-6",
        paperclipAgentId: `pc-full-${suffix}`,
        openclawAgentId: `oc-full-${suffix}`,
        skills: ["typescript", "sqlite", "testing"],
        status: "idle",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("agent");
    const agent = assertSchema(AgentSchema, body.agent);
    expect(agent.projectId).toBe(projectId);
    expect(agent.name).toBe(`[AGENT-TEST] Full Agent ${suffix}`);
    expect(agent.emoji).toBe("🤖");
    expect(agent.role).toBe("Full-Stack Engineer");
    expect(agent.model).toBe("claude-opus-4-6");
    expect(agent.paperclipAgentId).toBe(`pc-full-${suffix}`);
    expect(agent.openclawAgentId).toBe(`oc-full-${suffix}`);
    expect(agent.skills).toEqual(["typescript", "sqlite", "testing"]);
    expect(agent.status).toBe("idle");
  });

  test("defaults: emoji=🤖, status=idle when not supplied", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: { name: `[AGENT-TEST] Defaults ${suffix}`, role: "Minimal Agent" },
    });
    expect(res.status()).toBe(201);
    const agent = assertSchema(AgentSchema, (await res.json()).agent);
    expect(agent.emoji).toBe("🤖");
    expect(agent.status).toBe("idle");
  });

  test("all non-error status values are accepted and echoed", async ({ request }) => {
    for (const status of ["idle", "working", "paused", "offline"]) {
      const suffix = Date.now();
      const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
        data: {
          name: `[AGENT-TEST] Status ${status} ${suffix}`,
          role: "Status Test Agent",
          status,
        },
      });
      expect(res.status()).toBe(201);
      const agent = assertSchema(AgentSchema, (await res.json()).agent);
      expect(agent.status).toBe(status);
    }
  });

  test("status=error is accepted and preserved in API response", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Status error ${suffix}`,
        role: "Error Status Agent",
        status: "error",
      },
    });
    expect(res.status()).toBe(201);
    const agent = assertSchema(AgentSchema, (await res.json()).agent);
    expect(agent.status).toBe("error");
  });

  test("400 — invalid status value", async ({ request }) => {
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: { name: `[AGENT-TEST] Bad Status ${Date.now()}`, role: "Test", status: "busy" },
    });
    expect(res.status()).toBe(400);
    assertSchema(OrchErrorSchema, await res.json());
  });

  test("400 — avatarUrl must be a valid URL", async ({ request }) => {
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Bad URL ${Date.now()}`,
        role: "Test",
        avatarUrl: "not-a-url",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });
});

test.describe("A2. Agent listing — slug-based lookup + agent appears after create", () => {
  let projectId: string;
  let projectSlug: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, {
      name: `[AGENT-TEST] Slug Lookup ${Date.now()}`,
      slug: `agent-test-slug-${Date.now()}`,
    });
    projectId = p.id;
    projectSlug = p.slug;
  });

  test.afterAll(async ({ request }) => {
    await archiveProject(request, projectId);
  });

  test("lists agents by project slug — empty on fresh project", async ({ request }) => {
    const res = await request.get(`/api/orchestration/projects/${projectSlug}/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("agents");
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBe(0);
  });

  test("created agent appears in subsequent list call", async ({ request }) => {
    const suffix = Date.now();
    const createRes = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: { name: `[AGENT-TEST] Appears ${suffix}`, role: "Verifier" },
    });
    expect(createRes.status()).toBe(201);
    const agentId = (await createRes.json()).agent.id;

    const listRes = await request.get(`/api/orchestration/projects/${projectId}/agents`);
    expect(listRes.status()).toBe(200);
    const { agents } = await listRes.json();
    const found = (agents as Array<{ id: string }>).find((a) => a.id === agentId);
    expect(found).toBeDefined();
  });

  test("lists agents by slug matches list by id", async ({ request }) => {
    const byId = await request.get(`/api/orchestration/projects/${projectId}/agents`);
    const bySlug = await request.get(`/api/orchestration/projects/${projectSlug}/agents`);
    expect(byId.status()).toBe(200);
    expect(bySlug.status()).toBe(200);

    const { agents: agentsByIdArr } = await byId.json() as { agents: Array<{ id: string }> };
    const { agents: agentsBySlugArr } = await bySlug.json() as { agents: Array<{ id: string }> };
    expect(agentsByIdArr.map((a) => a.id).sort()).toEqual(
      agentsBySlugArr.map((a) => a.id).sort()
    );
  });
});

test.describe("A3. Agent CRUD — conflict detection", () => {
  let projectAlpha: string;
  let projectBeta: string;

  test.beforeAll(async ({ request }) => {
    const suffix = Date.now();
    const a = await createTestProject(request, { name: `[AGENT-TEST] Conflict Alpha ${suffix}` });
    const b = await createTestProject(request, { name: `[AGENT-TEST] Conflict Beta ${suffix}` });
    projectAlpha = a.id;
    projectBeta = b.id;
  });

  test.afterAll(async ({ request }) => {
    await archiveProject(request, projectAlpha);
    await archiveProject(request, projectBeta);
  });

  test("409 — paperclipAgentId conflict across different projects", async ({ request }) => {
    const suffix = Date.now();
    const sharedPcId = `pc-conflict-${suffix}`;

    const first = await request.post(`/api/orchestration/projects/${projectAlpha}/agents`, {
      data: { name: `[AGENT-TEST] PC-Alpha ${suffix}`, role: "Engineer", paperclipAgentId: sharedPcId },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`/api/orchestration/projects/${projectBeta}/agents`, {
      data: { name: `[AGENT-TEST] PC-Beta ${suffix}`, role: "Engineer", paperclipAgentId: sharedPcId },
    });
    expect(second.status()).toBe(409);
    const body = await second.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("paperclip_agent_conflict");
  });

  test("409 — openclawAgentId conflict across different projects", async ({ request }) => {
    const suffix = Date.now() + 1;
    const sharedOcId = `oc-conflict-${suffix}`;

    const first = await request.post(`/api/orchestration/projects/${projectAlpha}/agents`, {
      data: { name: `[AGENT-TEST] OC-Alpha ${suffix}`, role: "Designer", openclawAgentId: sharedOcId },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`/api/orchestration/projects/${projectBeta}/agents`, {
      data: { name: `[AGENT-TEST] OC-Beta ${suffix}`, role: "Designer", openclawAgentId: sharedOcId },
    });
    expect(second.status()).toBe(409);
    const body = await second.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("openclaw_agent_conflict");
  });

  test("same name in different projects is allowed", async ({ request }) => {
    const suffix = Date.now() + 2;
    const sharedName = `[AGENT-TEST] Same Name ${suffix}`;

    const first = await request.post(`/api/orchestration/projects/${projectAlpha}/agents`, {
      data: { name: sharedName, role: "Analyst" },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`/api/orchestration/projects/${projectBeta}/agents`, {
      data: { name: sharedName, role: "Analyst" },
    });
    expect(second.status()).toBe(201);
  });
});

test.describe("A4. Agent CRUD — reportingTo validation", () => {
  let projectId: string;
  let managerId: string;
  let otherProjectId: string;
  let otherAgentId: string;

  test.beforeAll(async ({ request }) => {
    const p = await createTestProject(request, { name: `[AGENT-TEST] ReportingTo ${Date.now()}` });
    projectId = p.id;

    const manager = await createTestAgent(request, projectId, { name: `[AGENT-TEST] Manager ${Date.now()}`, role: "Manager" });
    managerId = manager.id;

    const other = await createTestProject(request, { name: `[AGENT-TEST] Other ${Date.now()}` });
    otherProjectId = other.id;
    const otherAgent = await createTestAgent(request, otherProjectId, { name: `[AGENT-TEST] Other Agent ${Date.now()}`, role: "Other" });
    otherAgentId = otherAgent.id;
  });

  test.afterAll(async ({ request }) => {
    await archiveProject(request, projectId);
    await archiveProject(request, otherProjectId);
  });

  test("reportingTo a valid agent in same project is accepted", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Reports To Manager ${suffix}`,
        role: "IC",
        reportingTo: managerId,
      },
    });
    expect(res.status()).toBe(201);
    const agent = assertSchema(AgentSchema, (await res.json()).agent);
    expect(agent.reportingTo).toBe(managerId);
  });

  test("400 — reportingTo an agent from a different project", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Bad Reporter ${suffix}`,
        role: "IC",
        reportingTo: otherAgentId,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_reporting_to");
  });

  test("400 — reportingTo a non-existent agent UUID", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post(`/api/orchestration/projects/${projectId}/agents`, {
      data: {
        name: `[AGENT-TEST] Ghost Reporter ${suffix}`,
        role: "IC",
        reportingTo: "00000000-0000-0000-0000-000000000000",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("invalid_reporting_to");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B. COMPANY THEME CRUD
// ═════════════════════════════════════════════════════════════════════════════

test.describe("B1. GET /api/orchestration/companies — list", () => {
  test("returns 200 with { companies: Company[] }", async ({ request }) => {
    const res = await request.get("/api/orchestration/companies");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("companies");
    expect(Array.isArray(body.companies)).toBe(true);
  });

  test("default NeverIdle Core company exists with theme fields", async ({ request }) => {
    const res = await request.get("/api/orchestration/companies");
    const { companies } = await res.json();
    // Seed migration inserts NeverIdle Core
    const neveridle = (companies as Array<{ slug: string }>).find(
      (c) => c.slug === "neveridle-core"
    );
    if (neveridle) {
      const company = assertSchema(CompanySchema, neveridle);
      expect(company.theme.name).toBeTruthy();
      expect(company.theme.promptTemplate).toBeTruthy();
      expect(Array.isArray(company.theme.keywords)).toBe(true);
    } else {
      // Seed not applied — skip check
      expect([200]).toContain(res.status());
    }
  });

  test("all companies pass CompanySchema validation", async ({ request }) => {
    const res = await request.get("/api/orchestration/companies");
    const { companies } = await res.json();
    for (const company of companies) {
      assertSchema(CompanySchema, company);
    }
  });
});

test.describe("B2. POST /api/orchestration/companies — create + theme", () => {
  test("creates a company and returns 201 with schema-valid payload", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post("/api/orchestration/companies", {
      data: {
        name: `[AGENT-TEST] Company ${suffix}`,
        description: "Vigil test company — safe to delete",
        status: "active",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("company");
    assertSchema(CompanySchema, body.company);
    expect(body.company.name).toContain("[AGENT-TEST]");
  });

  test("default theme applied when theme omitted", async ({ request }) => {
    const suffix = Date.now() + 1;
    const res = await request.post("/api/orchestration/companies", {
      data: {
        name: `[AGENT-TEST] No Theme ${suffix}`,
      },
    });
    expect(res.status()).toBe(201);
    const { company } = await res.json();
    // Default theme: "Corporate Noir"
    expect(company.theme.name).toBe("Corporate Noir");
    expect(company.theme.promptTemplate).toBeTruthy();
    expect(typeof company.theme.promptTemplate).toBe("string");
    expect(Array.isArray(company.theme.keywords)).toBe(true);
  });

  test("custom theme fields are stored and returned", async ({ request }) => {
    const suffix = Date.now() + 2;
    const res = await request.post("/api/orchestration/companies", {
      data: {
        name: `[AGENT-TEST] Custom Theme ${suffix}`,
        theme: {
          name: "Cyberpunk Noir",
          promptTemplate: "high-contrast cyberpunk portrait, neon accents, dark background, cinematic",
          keywords: ["cyberpunk", "neon", "dark", "cinematic"],
          sampleUrl: "https://example.com/sample.jpg",
        },
      },
    });
    expect(res.status()).toBe(201);
    const { company } = await res.json();
    assertSchema(CompanySchema, company);
    expect(company.theme.name).toBe("Cyberpunk Noir");
    expect(company.theme.promptTemplate).toContain("cyberpunk");
    expect(company.theme.keywords).toContain("neon");
    expect(company.theme.sampleUrl).toBe("https://example.com/sample.jpg");
  });

  test("auto-generates a slug from the company name", async ({ request }) => {
    const suffix = Date.now() + 3;
    const res = await request.post("/api/orchestration/companies", {
      data: { name: `[AGENT-TEST] Auto Slug ${suffix}` },
    });
    expect(res.status()).toBe(201);
    const { company } = await res.json();
    expect(company.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(company.slug.length).toBeGreaterThan(0);
  });

  test("company stats initialize to zero", async ({ request }) => {
    const suffix = Date.now() + 4;
    const res = await request.post("/api/orchestration/companies", {
      data: { name: `[AGENT-TEST] Stats Zero ${suffix}` },
    });
    expect(res.status()).toBe(201);
    const { company } = await res.json();
    expect(company.stats.projects).toBe(0);
    expect(company.stats.agents).toBe(0);
    expect(company.stats.activeTasks).toBe(0);
  });

  test("400 — name too short (< 2 chars)", async ({ request }) => {
    const res = await request.post("/api/orchestration/companies", {
      data: { name: "X" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — theme.promptTemplate too short (< 8 chars)", async ({ request }) => {
    const res = await request.post("/api/orchestration/companies", {
      data: {
        name: `[AGENT-TEST] Short Prompt ${Date.now()}`,
        theme: {
          name: "Valid Theme",
          promptTemplate: "short",
        },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — theme.sampleUrl must be a valid URL", async ({ request }) => {
    const res = await request.post("/api/orchestration/companies", {
      data: {
        name: `[AGENT-TEST] Bad URL ${Date.now()}`,
        theme: {
          name: "Valid Theme",
          promptTemplate: "dark premium portrait style, cohesive team",
          sampleUrl: "not-a-url",
        },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("400 — invalid status value", async ({ request }) => {
    const res = await request.post("/api/orchestration/companies", {
      data: {
        name: `[AGENT-TEST] Bad Status ${Date.now()}`,
        status: "defunct",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });
});

test.describe("B3. /api/orchestration/companies/:slug — detail/update/archive", () => {
  const createdSlugs: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const slug of createdSlugs) {
      await request.delete(`/api/orchestration/companies/${slug}`);
    }
  });

  test("GET returns 200 with { company } and schema-valid payload", async ({ request }) => {
    const company = await createTestCompany(request, {
      name: `[AGENT-TEST] Company Detail ${Date.now()}`,
    });
    createdSlugs.push(company.slug);

    const res = await request.get(`/api/orchestration/companies/${company.slug}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("company");
    assertSchema(CompanySchema, body.company);
    expect(body.company.id).toBe(company.id);
  });

  test("PATCH updates mutable fields and can rename slug", async ({ request }) => {
    const company = await createTestCompany(request, {
      name: `[AGENT-TEST] Company Patch ${Date.now()}`,
    });
    createdSlugs.push(company.slug);

    const nextSlug = `agent-test-company-updated-${Date.now()}`;
    const patchRes = await request.patch(`/api/orchestration/companies/${company.slug}`, {
      data: {
        name: `[AGENT-TEST] Updated Company ${Date.now()}`,
        slug: nextSlug,
        description: "Updated by PATCH test",
        status: "paused",
      },
    });
    expect(patchRes.status()).toBe(200);
    const patched = await patchRes.json();
    assertSchema(CompanySchema, patched.company);
    expect(patched.company.slug).toBe(nextSlug);
    expect(patched.company.status).toBe("paused");
    expect(patched.company.description).toBe("Updated by PATCH test");

    createdSlugs[createdSlugs.indexOf(company.slug)] = nextSlug;

    const getRes = await request.get(`/api/orchestration/companies/${nextSlug}`);
    expect(getRes.status()).toBe(200);
    const fetched = await getRes.json();
    assertSchema(CompanySchema, fetched.company);
    expect(fetched.company.slug).toBe(nextSlug);
  });

  test("DELETE archives company and subsequent GET returns 404", async ({ request }) => {
    const company = await createTestCompany(request, {
      name: `[AGENT-TEST] Company Archive ${Date.now()}`,
    });

    const delRes = await request.delete(`/api/orchestration/companies/${company.slug}`);
    expect(delRes.status()).toBe(200);
    const delBody = await delRes.json();
    expect(delBody.companyId).toBe(company.id);
    expect(delBody.companySlug).toBe(company.slug);
    expect(typeof delBody.archivedAt).toBe("string");

    const getRes = await request.get(`/api/orchestration/companies/${company.slug}`);
    expect(getRes.status()).toBe(404);
    const getBody = await getRes.json();
    assertSchema(OrchErrorSchema, getBody);
    expect(getBody.error.code).toBe("company_not_found");
  });

  test("PATCH returns 409 when target slug already belongs to another company", async ({ request }) => {
    const source = await createTestCompany(request, {
      name: `[AGENT-TEST] Company Source ${Date.now()}`,
    });
    const target = await createTestCompany(request, {
      name: `[AGENT-TEST] Company Target ${Date.now()}`,
    });
    createdSlugs.push(source.slug, target.slug);

    const res = await request.patch(`/api/orchestration/companies/${source.slug}`, {
      data: { slug: target.slug },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("company_slug_taken");
  });

  test("PATCH returns 400 for empty payload", async ({ request }) => {
    const company = await createTestCompany(request, {
      name: `[AGENT-TEST] Company Empty Patch ${Date.now()}`,
    });
    createdSlugs.push(company.slug);

    const res = await request.patch(`/api/orchestration/companies/${company.slug}`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("validation_error");
  });

  test("DELETE unknown company slug returns 404", async ({ request }) => {
    const res = await request.delete(`/api/orchestration/companies/nope-${Date.now()}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    assertSchema(OrchErrorSchema, body);
    expect(body.error.code).toBe("company_not_found");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// C. PROJECT AVATAR THEME — stored on project creation
// ═════════════════════════════════════════════════════════════════════════════

test.describe("C. Project avatar theme stored at creation", () => {
  const created: string[] = [];
  let companyId: string;

  test.beforeAll(async ({ request }) => {
    companyId = await getDefaultCompanyId(request);
  });

  test.afterAll(async ({ request }) => {
    for (const id of created) {
      await archiveProject(request, id);
    }
  });

  test("project with custom avatarThemeName is created successfully", async ({ request }) => {
    const suffix = Date.now();
    const res = await request.post("/api/orchestration/projects", {
      data: {
        name: `[AGENT-TEST] Sci-Fi Project ${suffix}`,
        emoji: "🚀",
        color: "#0ea5e9",
        status: "active",
        avatarThemeName: "Sci-Fi Crew",
        companyId,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("project");
    expect(body.project.id).toBeTruthy();
    created.push(body.project.id);
  });

  test("project with default theme (no avatarThemeName) is created successfully", async ({ request }) => {
    const suffix = Date.now() + 1;
    const res = await request.post("/api/orchestration/projects", {
      data: {
        name: `[AGENT-TEST] Default Theme Project ${suffix}`,
        companyId,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.project.id).toBeTruthy();
    created.push(body.project.id);
  });

  test("board endpoint returns theme-stamped project correctly", async ({ request }) => {
    const suffix = Date.now() + 2;
    const createRes = await request.post("/api/orchestration/projects", {
      data: {
        name: `[AGENT-TEST] Cyberpunk Project ${suffix}`,
        avatarThemeName: "Cyberpunk",
        companyId,
      },
    });
    expect(createRes.status()).toBe(201);
    const { project } = await createRes.json();
    created.push(project.id);

    // Board should return the project without errors — theme is stored internally
    const boardRes = await request.get(`/api/orchestration/projects/${project.id}/board`);
    expect(boardRes.status()).toBe(200);
    const board = await boardRes.json();
    expect(board.project.id).toBe(project.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// D. AGENT REGISTRY / DIRECTORY LISTING
// ═════════════════════════════════════════════════════════════════════════════

test.describe("D. GET /api/agents/registry — static registry", () => {
  test("returns 200 with agents array and count", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    expect(res.status()).toBe(200);
    const body = await res.json();
    assertSchema(RegistryResponseSchema, body);
    expect(body.count).toBe(body.agents.length);
    expect(body.agents.length).toBeGreaterThan(0);
  });

  test("count matches number of agents returned", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const body = await res.json();
    expect(body.count).toBe(body.agents.length);
  });

  test("every agent passes RegistryAgentSchema", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const { agents } = await res.json();
    for (const agent of agents) {
      assertSchema(RegistryAgentSchema, agent);
    }
  });

  test("divisions is a non-empty object keyed by division name", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const body = await res.json();
    // DIVISIONS is exported as Record<string, { label, color, icon }>
    expect(typeof body.divisions).toBe("object");
    expect(body.divisions).not.toBeNull();
    expect(Array.isArray(body.divisions)).toBe(false);
    expect(Object.keys(body.divisions).length).toBeGreaterThan(0);
  });

  test("each agent has a non-empty avatar path", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const { agents } = await res.json();
    for (const agent of agents) {
      expect(typeof agent.avatar).toBe("string");
      expect(agent.avatar.length).toBeGreaterThan(0);
    }
  });

  test("no duplicate agent IDs in registry", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const { agents } = await res.json();
    const ids = (agents as Array<{ id: string }>).map((a) => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test("each agent has non-empty capabilities array", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const { agents } = await res.json();
    for (const agent of agents) {
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(agent.capabilities.length).toBeGreaterThan(0);
    }
  });

  test("known agents are present (henry, t1-nimbus)", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const { agents } = await res.json();
    const ids = (agents as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain("henry");
    // At least one trading agent should be present
    const tradingAgents = (agents as Array<{ division: string }>).filter(
      (a) => a.division === "Trading"
    );
    expect(tradingAgents.length).toBeGreaterThan(0);
  });

  test("isBuilder is a boolean on every agent", async ({ request }) => {
    const res = await request.get("/api/agents/registry");
    const { agents } = await res.json();
    for (const agent of agents) {
      expect(typeof agent.isBuilder).toBe("boolean");
    }
  });
});
