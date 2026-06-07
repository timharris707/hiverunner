import assert from "node:assert";

import { GET as listCompanyAgentsRoute } from "@/app/api/orchestration/companies/[slug]/agents/route";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";
import { getOrchestrationDb } from "@/lib/orchestration/db";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

function finish(): never {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

function listCompanyAgents(companySlug: string, query = "") {
  const suffix = query ? `?${query}` : "";
  const req = { nextUrl: new URL(`http://localhost/api/orchestration/companies/${companySlug}/agents${suffix}`) };

  return listCompanyAgentsRoute(req as never, {
    params: Promise.resolve({ slug: companySlug }),
  });
}

async function responseAgentIds(response: Response): Promise<string[]> {
  const payload = (await response.json()) as { agents: Array<{ id: string }> };
  return payload.agents.map((agent) => agent.id);
}

async function run() {
  console.log("\nOrchestration Company Agents Route Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

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

  const workingAgent = createProjectAgent({
    projectId: project.id,
    name: `Working Builder ${stamp}`,
    emoji: "WB",
    role: "Engineer",
    personality: "Working fixture",
    skills: [],
    status: "working",
  }).agent;

  const offlineBenchAgent = createProjectAgent({
    projectId: project.id,
    name: `Offline Bench ${stamp}`,
    emoji: "OB",
    role: "Engineer",
    personality: "Offline bench fixture",
    skills: [],
    status: "offline",
  }).agent;

  const errorBenchAgent = createProjectAgent({
    projectId: project.id,
    name: `Error Bench ${stamp}`,
    emoji: "EB",
    role: "Engineer",
    personality: "Error bench fixture",
    skills: [],
    status: "error",
  }).agent;

  const pausedAgent = createProjectAgent({
    projectId: project.id,
    name: `Paused Operator ${stamp}`,
    emoji: "PO",
    role: "Engineer",
    personality: "Paused fixture",
    skills: [],
    status: "paused",
  }).agent;

  const archivedAgent = createProjectAgent({
    projectId: project.id,
    name: `Archived Operator ${stamp}`,
    emoji: "AO",
    role: "Engineer",
    personality: "Archived fixture",
    skills: [],
    status: "idle",
  }).agent;
  const archivedAt = new Date().toISOString();
  getOrchestrationDb()
    .prepare("UPDATE agents SET archived_at = ?, updated_at = ? WHERE id = ?")
    .run(archivedAt, archivedAt, archivedAgent.id);

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
    const res = await listCompanyAgents(company.slug);
    assert.strictEqual(res.status, 200);

    const payload = (await res.json()) as { agents: Array<{ id: string }> };
    const ids = payload.agents.map((agent) => agent.id);
    assert.ok(ids.includes(productionAgent.id), "Expected production agent in scoped response");
    assert.ok(!ids.includes(testAgent.id), "Expected default scoped response to hide test agents");
  });

  await test("company-scoped agents route supports includeNonProduction=true", async () => {
    const res = await listCompanyAgents(company.slug, "includeNonProduction=true");
    assert.strictEqual(res.status, 200);

    const payload = (await res.json()) as { agents: Array<{ id: string }> };
    const ids = payload.agents.map((agent) => agent.id);
    assert.ok(ids.includes(productionAgent.id), "Expected production agent in includeNonProduction response");
    assert.ok(ids.includes(testAgent.id), "Expected test agent included when includeNonProduction=true");
  });

  await test("company-scoped agents route filters active roster state", async () => {
    const res = await listCompanyAgents(company.slug, "includeNonProduction=true&rosterState=active");
    assert.strictEqual(res.status, 200);

    const ids = await responseAgentIds(res);
    assert.ok(ids.includes(productionAgent.id), "Expected idle agent in active roster");
    assert.ok(ids.includes(workingAgent.id), "Expected working agent in active roster");
    assert.ok(!ids.includes(offlineBenchAgent.id), "Expected offline bench agent excluded from active roster");
    assert.ok(!ids.includes(errorBenchAgent.id), "Expected error bench agent excluded from active roster");
    assert.ok(!ids.includes(pausedAgent.id), "Expected paused agent excluded from active roster");
    assert.ok(!ids.includes(archivedAgent.id), "Expected archived agent excluded from active roster");
  });

  await test("company-scoped agents route filters bench roster state", async () => {
    const res = await listCompanyAgents(company.slug, "includeNonProduction=true&rosterState=bench");
    assert.strictEqual(res.status, 200);

    const ids = await responseAgentIds(res);
    assert.deepStrictEqual(
      ids.filter((id) => [offlineBenchAgent.id, errorBenchAgent.id].includes(id)).sort(),
      [errorBenchAgent.id, offlineBenchAgent.id].sort(),
      "Expected offline and error agents in bench roster",
    );
    assert.ok(!ids.includes(productionAgent.id), "Expected active agent excluded from bench roster");
    assert.ok(!ids.includes(pausedAgent.id), "Expected paused agent excluded from bench roster");
    assert.ok(!ids.includes(archivedAgent.id), "Expected archived agent excluded from bench roster");
  });

  await test("company-scoped agents route filters paused roster state", async () => {
    const res = await listCompanyAgents(company.slug, "includeNonProduction=true&rosterState=paused");
    assert.strictEqual(res.status, 200);

    const ids = await responseAgentIds(res);
    assert.ok(ids.includes(pausedAgent.id), "Expected paused agent in paused roster");
    assert.ok(!ids.includes(productionAgent.id), "Expected active agent excluded from paused roster");
    assert.ok(!ids.includes(offlineBenchAgent.id), "Expected bench agent excluded from paused roster");
    assert.ok(!ids.includes(archivedAgent.id), "Expected archived agent excluded from paused roster");
  });

  await test("company-scoped agents route filters archived roster state", async () => {
    const res = await listCompanyAgents(company.slug, "includeNonProduction=true&rosterState=archived");
    assert.strictEqual(res.status, 200);

    const ids = await responseAgentIds(res);
    assert.deepStrictEqual(ids, [archivedAgent.id], "Expected only archived agents in archived roster");
  });

  await test("company-scoped agents route returns full team roster for rosterState=all", async () => {
    const res = await listCompanyAgents(company.slug, "includeNonProduction=true&rosterState=all");
    assert.strictEqual(res.status, 200);

    const ids = await responseAgentIds(res);
    for (const expected of [productionAgent, workingAgent, offlineBenchAgent, errorBenchAgent, pausedAgent, archivedAgent]) {
      assert.ok(ids.includes(expected.id), `Expected ${expected.name} in full team roster`);
    }
  });

  await test("company-scoped agents route rejects invalid includeNonProduction values", async () => {
    const res = await listCompanyAgents(company.slug, "includeNonProduction=maybe");
    assert.strictEqual(res.status, 400);
  });

  await test("company-scoped agents route rejects invalid rosterState values", async () => {
    const res = await listCompanyAgents(company.slug, "rosterState=vacation");
    assert.strictEqual(res.status, 400);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
