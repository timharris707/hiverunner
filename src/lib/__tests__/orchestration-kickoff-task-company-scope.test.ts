import assert from "node:assert";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { kickoffCompany } from "@/lib/orchestration/engine/engine";
import { createProject, createProjectAgent } from "@/lib/orchestration/service";

const { finish, test } = createTestRunner();

async function run() {
  console.log("\nOrchestration Kickoff Task Company Scope Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const db = getOrchestrationDb();
  const company = createCompany({
    name: `Kickoff Scope ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Operations",
    description: "fixture",
    color: "#22c55e",
    emoji: "KO",
    status: "active",
  }).project;
  const ceo = createProjectAgent({
    projectId: project.id,
    name: "Scope CEO",
    emoji: "SC",
    role: "CEO",
    personality: "Fixture",
    status: "idle",
    skills: [],
  }).agent;

  await test("kickoff direction tasks store company_id", () => {
    const result = kickoffCompany({
      companyId: company.id,
      direction: "Create a scoped operating plan.",
      requestedBy: "test",
    });

    assert.strictEqual(result.status, "queued");
    assert.ok(result.directionTaskId);

    const task = db
      .prepare("SELECT company_id, project_id, task_key, assignee_agent_id FROM tasks WHERE id = ?")
      .get(result.directionTaskId) as {
        company_id: string | null;
        project_id: string;
        task_key: string;
        assignee_agent_id: string | null;
      };

    assert.strictEqual(task.company_id, company.id);
    assert.strictEqual(task.project_id, project.id);
    assert.strictEqual(task.assignee_agent_id, ceo.id);
    assert.ok(task.task_key.startsWith(`${company.code}-`));
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
