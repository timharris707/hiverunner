import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { kickoffCompany } from "@/lib/orchestration/engine/engine";
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
  console.log("\nOrchestration Kickoff Task Company Scope Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

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

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
