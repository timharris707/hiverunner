import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { createProject, createTask } from "@/lib/orchestration/service";

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
  console.log("\nOrchestration Task Key Allocation Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const db = getOrchestrationDb();
  const company = createCompany({
    name: `Task Key Allocation ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Operations",
    description: "fixture",
    color: "#22c55e",
    emoji: "TK",
    status: "active",
  }).project;
  const otherCompany = createCompany({
    name: `Other Task Key Allocation ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  await test("task key allocation advances past rows with key but missing task_number", () => {
    const first = createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Recovered task with missing number",
      description: "Fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    assert.ok(first.key, "fixture should have a human-readable task key");
    db.prepare("UPDATE tasks SET task_number = NULL WHERE id = ?").run(first.id);

    const second = createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Next task after recovered key",
      description: "Fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    const [, firstNumberRaw] = first.key.split("-");
    const [, secondNumberRaw] = second.key.split("-");
    assert.strictEqual(Number(secondNumberRaw), Number(firstNumberRaw) + 1);
  });

  await test("task key allocation trusts project company when task company_id drifted", () => {
    const first = createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Recovered task with drifted company",
      description: "Fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    assert.ok(first.key, "fixture should have a human-readable task key");
    db.prepare("UPDATE tasks SET task_number = NULL, company_id = ? WHERE id = ?").run(otherCompany.id, first.id);

    const second = createTask({
      companyIdOrSlug: company.id,
      projectId: project.id,
      title: "Next task after drifted company key",
      description: "Fixture",
      priority: "P2",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    const [, firstNumberRaw] = first.key.split("-");
    const [, secondNumberRaw] = second.key.split("-");
    assert.strictEqual(Number(secondNumberRaw), Number(firstNumberRaw) + 1);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
