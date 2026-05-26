import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

import {
  assignTask,
  createProject,
  createProjectAgent,
  createTask,
  getTask,
  listProjectAgents,
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
  console.log("\nOrchestration Agent Company Scoping Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;

  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const projectA = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Company Scope A ${Date.now()}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "\ud83d\ude80",
    status: "active",
  }).project;

  const projectB = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Company Scope B ${Date.now()}`,
    description: "fixture",
    color: "#f97316",
    emoji: "\ud83d\udd27",
    status: "active",
  }).project;

  const sharedAgent = createProjectAgent({
    projectId: projectA.id,
    name: "Cross Project Agent",
    emoji: "\ud83e\udd16",
    role: "Execution",
    personality: "Reliable",
    status: "idle",
    skills: [],
  }).agent;

  await test("project board can list company agents from another project", () => {
    const { agents } = listProjectAgents(projectB.id);
    const found = agents.find((agent) => agent.id === sharedAgent.id);
    assert.ok(found, "Expected company agent to be visible from another project board");
  });

  await test("task assignment accepts assignee from another project in same company", () => {
    const task = createTask({
      projectId: projectB.id,
      title: "Cross-project assignment",
      description: "Fixture",
      priority: "P1",
      type: "feature",
      status: "to-do",
      labels: [],
      createdBy: "test",
    }).task;

    const result = assignTask({ taskId: task.id, assignee: sharedAgent.id, actorUserId: "test" });
    assert.strictEqual(result.task.assignee, sharedAgent.name);

    const loaded = getTask(task.id).task;
    assert.strictEqual(loaded.assignee, sharedAgent.name);
  });

  await test("agent names are unique at company scope", () => {
    assert.throws(() => {
      createProjectAgent({
        projectId: projectB.id,
        name: "Cross Project Agent",
        emoji: "\ud83e\udd16",
        role: "Execution",
        personality: "Duplicate",
        status: "idle",
        skills: [],
      });
    }, /already exists in the company/);
  });

  await test("reportingTo accepts manager from another project in the same company", () => {
    const worker = createProjectAgent({
      projectId: projectB.id,
      name: `Cross Project Report ${Date.now()}`,
      emoji: "\ud83e\uddf0",
      role: "Implementation",
      personality: "Scoped",
      status: "idle",
      skills: [],
      reportingTo: sharedAgent.id,
    }).agent;

    assert.strictEqual(worker.reportingTo, sharedAgent.id);
  });

  await test("openclaw scaffold failure rolls back created agent row", () => {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "mc-openclaw-scaffold-fail-"));
    const openclawFile = path.join(tempRoot, "openclaw-file");
    writeFileSync(openclawFile, "not-a-directory", "utf8");
    const previousOpenclawDir = process.env.OPENCLAW_DIR;
    process.env.OPENCLAW_DIR = openclawFile;

    const failingName = `Scaffold Fail ${Date.now()}`;
    const failingAgentId = `scaffold-fail-${Math.random().toString(36).slice(2, 10)}`;

    try {
      assert.throws(() => {
        createProjectAgent({
          projectId: projectA.id,
          name: failingName,
          emoji: "\ud83d\udeab",
          role: "Failure Case",
          personality: "Rollback validation",
          status: "idle",
          skills: [],
          openclawAgentId: failingAgentId,
        });
      });

      const { agents } = listProjectAgents(projectA.id);
      assert.ok(
        !agents.some((agent) => agent.name === failingName || agent.openclawAgentId === failingAgentId),
        "Expected failed scaffold create to leave no agent record"
      );
    } finally {
      if (previousOpenclawDir === undefined) {
        delete process.env.OPENCLAW_DIR;
      } else {
        process.env.OPENCLAW_DIR = previousOpenclawDir;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
