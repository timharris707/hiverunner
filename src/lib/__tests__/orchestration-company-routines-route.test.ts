import assert from "node:assert";
import { rmSync } from "node:fs";

import {
  GET as getCompanyRoutinesRoute,
  POST as postCompanyRoutinesRoute,
} from "@/app/api/orchestration/companies/[slug]/routines/route";
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
  console.log("\nOrchestration Company Routines Route Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const stamp = Date.now();
  const company = createCompany({
    name: `Routine Scope ${stamp}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Routine Project ${stamp}`,
    description: "fixture",
    color: "#22c55e",
    emoji: "RT",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Routine Agent ${stamp}`,
    emoji: "RA",
    role: "Operator",
    personality: "Fixture",
    skills: [],
    status: "idle",
  }).agent;

  let routineId = "";

  await test("POST creates a routine through the stable company code route", async () => {
    const req = {
      async json() {
        return {
          title: "Daily health check",
          description: "Check current work and report blockers.",
          projectId: project.id,
          assigneeAgentId: agent.id,
          priority: "medium",
        };
      },
    };

    const res = await postCompanyRoutinesRoute(req as never, {
      params: Promise.resolve({ slug: company.code }),
    });

    assert.strictEqual(res.status, 201);
    const payload = (await res.json()) as {
      routine: { id: string; companyId: string; title: string; projectId: string; assigneeAgentId: string };
    };

    assert.strictEqual(payload.routine.companyId, company.id);
    assert.strictEqual(payload.routine.projectId, project.id);
    assert.strictEqual(payload.routine.assigneeAgentId, agent.id);
    assert.strictEqual(payload.routine.title, "Daily health check");
    routineId = payload.routine.id;
  });

  await test("GET lists routines through the stable company code route", async () => {
    const req = {
      nextUrl: new URL(`http://localhost/api/orchestration/companies/${company.code}/routines`),
    };

    const res = await getCompanyRoutinesRoute(req as never, {
      params: Promise.resolve({ slug: company.code }),
    });

    assert.strictEqual(res.status, 200);
    const payload = (await res.json()) as {
      routines: Array<{ id: string; title: string; agentName: string | null }>;
    };

    const routine = payload.routines.find((item) => item.id === routineId);
    assert.ok(routine, "Expected created routine in company-code response");
    assert.strictEqual(routine.title, "Daily health check");
    assert.strictEqual(routine.agentName, agent.name);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
