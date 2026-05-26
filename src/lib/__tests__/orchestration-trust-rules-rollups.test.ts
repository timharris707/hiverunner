import assert from "node:assert";
import { rmSync } from "node:fs";

import { createCompany, listCompanies } from "@/lib/orchestration/company-service";
import {
  archiveTask,
  createProject,
  createProjectSprint,
  createTask,
  getTask,
  listProjects,
  listProjectSprints,
  listTasks,
  moveTask,
} from "@/lib/orchestration/service";

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
  console.log("\nOrchestration Trust Rules + Rollup Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required");
  }
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const realProject = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Operator Live Project ${Date.now()}`,
    description: "Production-facing workstream",
    color: "#0ea5e9",
    emoji: "\ud83d\ude80",
    status: "active",
  }).project;

  const demoProject = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Demo Sandbox ${Date.now()}`,
    description: "demo fixture project",
    color: "#f97316",
    emoji: "\ud83e\uddea",
    status: "active",
  }).project;

  const sprint = createProjectSprint({
    projectId: realProject.id,
    name: "Sprint Trust Rollup",
    goal: "Verify parent and sprint rollup behavior",
    status: "active",
  }).sprint;

  const parent = createTask({
    projectId: realProject.id,
    sprintId: sprint.id,
    title: "Parent aggregate task",
    description: "",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    labels: ["backend"],
    createdBy: "forge",
  }).task;

  createTask({
    projectId: realProject.id,
    sprintId: sprint.id,
    parentTaskId: parent.id,
    title: "Child complete",
    description: "",
    priority: "P1",
    type: "feature",
    status: "done",
    labels: ["backend"],
    createdBy: "forge",
  });

  const childInProgress = createTask({
    projectId: realProject.id,
    sprintId: sprint.id,
    parentTaskId: parent.id,
    title: "Child active",
    description: "",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    labels: ["backend"],
    createdBy: "forge",
  }).task;

  createTask({
    projectId: realProject.id,
    title: "Demo fixture task",
    description: "demo seed fixture",
    priority: "P2",
    type: "research",
    status: "backlog",
    labels: ["demo"],
    createdBy: "seed",
  });

  const realCompany = createCompany({
    name: `Operations Group ${Date.now()}`,
    description: "human production company",
    status: "active",
  }).company;

  const demoCompany = createCompany({
    name: `Demo Company ${Date.now()}`,
    description: "demo fixture",
    status: "active",
  }).company;

  await test("listProjects hides non-production projects by default", () => {
    const visible = listProjects().projects.map((project) => project.id);
    assert.ok(visible.includes(realProject.id));
    assert.ok(!visible.includes(demoProject.id));
  });

  await test("listProjects can opt in to non-production projects", () => {
    const visible = listProjects({ includeNonProduction: true }).projects.map((project) => project.id);
    assert.ok(visible.includes(realProject.id));
    assert.ok(visible.includes(demoProject.id));
  });

  await test("listTasks hides non-production tasks by default", () => {
    const tasks = listTasks({ projectId: realProject.id }).tasks;
    assert.ok(tasks.every((task) => !task.title.toLowerCase().includes("demo fixture")));
  });

  await test("listTasks can opt in to non-production tasks", () => {
    const tasks = listTasks({ projectId: realProject.id, includeNonProduction: true }).tasks;
    assert.ok(tasks.some((task) => task.title.toLowerCase().includes("demo fixture")));
  });

  await test("listCompanies hides non-production entries by default", () => {
    const companies = listCompanies().companies;
    assert.ok(companies.some((company) => company.id === realCompany.id));
    assert.ok(!companies.some((company) => company.id === demoCompany.id));
  });

  await test("listCompanies can opt in to non-production entries", () => {
    const companies = listCompanies({ includeNonProduction: true }).companies;
    assert.ok(companies.some((company) => company.id === realCompany.id));
    assert.ok(companies.some((company) => company.id === demoCompany.id));
  });

  await test("parent and sprint rollups close after child completion", () => {
    moveTask({
      taskId: childInProgress.id,
      status: "done",
      reviewNotes: "done",
      actorUserId: "test",
    });

    const updatedParent = getTask(parent.id).task;
    assert.strictEqual(updatedParent.status, "done");

    const sprintRow = listProjectSprints(realProject.id).sprints.find((entry) => entry.id === sprint.id);
    assert.ok(sprintRow);
    assert.strictEqual(sprintRow?.status, "done");
  });

  await test("archiving last child also closes parent rollup", () => {
    const parentTwo = createTask({
      projectId: realProject.id,
      sprintId: sprint.id,
      title: "Parent archive rollup",
      description: "",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      labels: ["backend"],
      createdBy: "forge",
    }).task;

    const onlyChild = createTask({
      projectId: realProject.id,
      sprintId: sprint.id,
      parentTaskId: parentTwo.id,
      title: "Only child",
      description: "",
      priority: "P2",
      type: "feature",
      status: "in-progress",
      labels: ["backend"],
      createdBy: "forge",
    }).task;

    archiveTask({ taskId: onlyChild.id, actorUserId: "test" });

    const updatedParent = getTask(parentTwo.id).task;
    assert.strictEqual(updatedParent.status, "done");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
