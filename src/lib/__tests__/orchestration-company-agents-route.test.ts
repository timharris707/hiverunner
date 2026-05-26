import assert from "node:assert";
import { rmSync } from "node:fs";

import { GET as listCompanyAgentsRoute } from "@/app/api/orchestration/companies/[slug]/agents/route";
import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Company Agents Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const stamp = Date.now();
  const company = createCompany({
    name: `Agent Route Scope ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Agent Route Project ${stamp}`,
    description: "fixture",
    color: "#22c55e",
    emoji: "AR",
    status: "active",
  }).project;

  const productionAgent = createProjectAgent({
    projectId: project.id,
    name: `Scoped Lead ${stamp}`,
    emoji: "SL",
    role: "Engineer",
    personality: "Production fixture",
    skills: [],
    status: "idle",
  }).agent;

  const testAgent = createProjectAgent({
    projectId: project.id,
    name: `[TEST] Smoke Agent ${stamp}`,
    emoji: "TS",
    role: "Engineer",
    personality: "Test fixture",
    skills: [],
    status: "idle",
  }).agent;

  await test("company-scoped agents route excludes non-production by default", async () => {
    const req = { nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.slug}/agents`) };
    const res = await listCompanyAgentsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });
    assert.strictEqual(res.status, 200);

    const payload = (await res.json()) as { agents: Array<{ id: string }> };
    const ids = payload.agents.map((agent) => agent.id);
    assert.ok(ids.includes(productionAgent.id), "Expected production agent in scoped response");
    assert.ok(!ids.includes(testAgent.id), "Expected default scoped response to hide test agents");
  });

  await test("company-scoped agents route supports includeNonProduction=true", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${company.slug}/agents?includeNonProduction=true`
      ),
    };
    const res = await listCompanyAgentsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });
    assert.strictEqual(res.status, 200);

    const payload = (await res.json()) as { agents: Array<{ id: string }> };
    const ids = payload.agents.map((agent) => agent.id);
    assert.ok(ids.includes(productionAgent.id), "Expected production agent in includeNonProduction response");
    assert.ok(ids.includes(testAgent.id), "Expected test agent included when includeNonProduction=true");
  });

  await test("company-scoped agents route rejects invalid includeNonProduction values", async () => {
    const req = {
      nextUrl: new URL(
        `http://localhost/api/orchestration/companies/${company.slug}/agents?includeNonProduction=maybe`
      ),
    };
    const res = await listCompanyAgentsRoute(req as never, {
      params: Promise.resolve({ slug: company.slug }),
    });
    assert.strictEqual(res.status, 400);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
