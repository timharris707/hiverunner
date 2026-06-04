import assert from "node:assert";

import {
  GET as getCompanyRoutinesRoute,
  POST as postCompanyRoutinesRoute,
} from "@/app/api/orchestration/companies/[slug]/routines/route";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createCompany } from "@/lib/orchestration/company-service";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";

const { finish, test } = createTestRunner();

async function run() {
  console.log("\nOrchestration Company Routines Route Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

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

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
