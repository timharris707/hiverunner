import assert from "node:assert";
import { rmSync } from "node:fs";

import {
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
  console.log("\nOrchestration Type Mapping Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;

  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `Type Mapping ${Date.now()}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "\ud83d\udd27",
    status: "active",
  }).project;

  await test("task type maintenance round-trips without collapsing to infrastructure", () => {
    const created = createTask({
      projectId: project.id,
      title: "Maintenance mapping fixture",
      description: "Check round-trip",
      priority: "P2",
      type: "maintenance",
      status: "backlog",
      labels: [],
      createdBy: "test",
      sourceReviewId: "review-fixture-1",
      sourceTakeawayId: "takeaway-fixture-1",
    }).task;

    assert.strictEqual(created.type, "maintenance");
    assert.strictEqual(created.sourceReviewId, "review-fixture-1");
    assert.strictEqual(created.sourceTakeawayId, "takeaway-fixture-1");

    const loaded = getTask(created.id).task;
    assert.strictEqual(loaded.type, "maintenance");
    assert.strictEqual(loaded.sourceReviewId, "review-fixture-1");
    assert.strictEqual(loaded.sourceTakeawayId, "takeaway-fixture-1");
  });

  await test("agent status error is exposed as error in API layer", () => {
    const created = createProjectAgent({
      projectId: project.id,
      name: `Error Agent ${Date.now()}`,
      emoji: "\ud83e\udd16",
      role: "Backend Engineer",
      personality: "Strict",
      status: "error",
      skills: [],
    }).agent;

    assert.strictEqual(created.status, "error");

    const list = listProjectAgents(project.id).agents;
    const loaded = list.find((agent) => agent.id === created.id);
    assert.ok(loaded, "Created agent should be present in listProjectAgents");
    assert.strictEqual(loaded?.status, "error");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
