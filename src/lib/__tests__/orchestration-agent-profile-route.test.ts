import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import { GET as getCompanyAgentRoute } from "@/app/api/orchestration/companies/[slug]/agents/[agentId]/route";
import { GET as getAgentProfileRoute } from "@/app/api/orchestration/agents/[id]/profile/route";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Agent Profile Route Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const companyA = createCompany({
    name: `Agent Profile A ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const companyB = createCompany({
    name: `Agent Profile B ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const projectA = createProject({
    companyId: companyA.id,
    name: `Profile Project A ${Date.now()}`,
    description: "fixture",
    color: "#14b8a6",
    emoji: "\ud83d\udee0\ufe0f",
    status: "active",
  }).project;

  const projectB = createProject({
    companyId: companyB.id,
    name: `Profile Project B ${Date.now()}`,
    description: "fixture",
    color: "#6366f1",
    emoji: "\ud83e\uddf1",
    status: "active",
  }).project;

  const agentA = createProjectAgent({
    projectId: projectA.id,
    name: "Shared Name",
    emoji: "\ud83d\udd27",
    role: "Backend Engineer",
    personality: "Focused",
    status: "idle",
    skills: [],
  }).agent;

  createProjectAgent({
    projectId: projectB.id,
    name: "Shared Name",
    emoji: "\ud83d\udee1\ufe0f",
    role: "QA Engineer",
    personality: "Thorough",
    status: "idle",
    skills: [],
  });

  await test("GET resolves a profile by canonical agent id", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/agents/${agentA.id}/profile`),
    };

    const res = await getAgentProfileRoute(req as never, {
      params: Promise.resolve({ id: agentA.id }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      company: { id: string };
      agent: { id: string; name: string };
    };

    assert.strictEqual(payload.company.id, companyA.id);
    assert.strictEqual(payload.agent.id, agentA.id);
    assert.strictEqual(payload.agent.name, "Shared Name");
  });

  await test("GET returns 409 for ambiguous name lookups without company scope", async () => {
    const req = {
      nextUrl: new URL("http://localhost/api/orchestration/agents/Shared%20Name/profile"),
    };

    const res = await getAgentProfileRoute(req as never, {
      params: Promise.resolve({ id: "Shared Name" }),
    });

    assert.strictEqual(res.status, 409);
    const payload = (await res.json()) as { error: { code: string } };
    assert.strictEqual(payload.error.code, "ambiguous_agent_name");
  });

  await test("GET supports disambiguation using company query", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/agents/Shared%20Name/profile?company=${encodeURIComponent(companyA.slug)}`
      ),
    };

    const res = await getAgentProfileRoute(req as never, {
      params: Promise.resolve({ id: "Shared Name" }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as { company: { id: string }; agent: { id: string } };
    assert.strictEqual(payload.company.id, companyA.id);
    assert.strictEqual(payload.agent.id, agentA.id);
  });

  await test("GET validates query limits", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/agents/${agentA.id}/profile?executionLimit=999`),
    };

    const res = await getAgentProfileRoute(req as never, {
      params: Promise.resolve({ id: agentA.id }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.strictEqual(payload.error.code, "validation_error");
  });

  await test("company-scoped GET rejects malformed executionLimit with client-safe validation error", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${companyA.slug}/agents/${agentA.id}?executionLimit=abc`
      ),
    };

    const res = await getCompanyAgentRoute(req as never, {
      params: Promise.resolve({ slug: companyA.slug, agentId: agentA.id }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as {
      error: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
    };
    assert.strictEqual(payload.error.code, "validation_error");
    assert.strictEqual(payload.error.message, "Invalid agent profile query");
    assert.ok(payload.error.details?.fieldErrors?.executionLimit?.length);
  });

  await test("company-scoped GET rejects malformed activityLimit with client-safe validation error", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${companyA.slug}/agents/${agentA.id}?activityLimit=1.5`
      ),
    };

    const res = await getCompanyAgentRoute(req as never, {
      params: Promise.resolve({ slug: companyA.slug, agentId: agentA.id }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as {
      error: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
    };
    assert.strictEqual(payload.error.code, "validation_error");
    assert.strictEqual(payload.error.message, "Invalid agent profile query");
    assert.ok(payload.error.details?.fieldErrors?.activityLimit?.length);
  });

  await test("company-scoped GET rejects over-limit executionLimit with client-safe validation error", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${companyA.slug}/agents/${agentA.id}?executionLimit=101`
      ),
    };

    const res = await getCompanyAgentRoute(req as never, {
      params: Promise.resolve({ slug: companyA.slug, agentId: agentA.id }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as {
      error: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
    };
    assert.strictEqual(payload.error.code, "validation_error");
    assert.strictEqual(payload.error.message, "Invalid agent profile query");
    assert.ok(payload.error.details?.fieldErrors?.executionLimit?.length);
  });

  await test("company-scoped GET rejects over-limit activityLimit with client-safe validation error", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${companyA.slug}/agents/${agentA.id}?activityLimit=999`
      ),
    };

    const res = await getCompanyAgentRoute(req as never, {
      params: Promise.resolve({ slug: companyA.slug, agentId: agentA.id }),
    });

    assert.strictEqual(res.status, 400);
    const payload = (await res.json()) as {
      error: { code: string; message: string; details?: { fieldErrors?: Record<string, string[]> } };
    };
    assert.strictEqual(payload.error.code, "validation_error");
    assert.strictEqual(payload.error.message, "Invalid agent profile query");
    assert.ok(payload.error.details?.fieldErrors?.activityLimit?.length);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
