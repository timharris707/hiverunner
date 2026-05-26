import assert from "node:assert";
import { rmSync } from "node:fs";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  createProject,
  createProjectAgent,
  lookupAgentByName,
  lookupProjectByName,
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
  console.log("\nOrchestration Lookup Service Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;

  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const project = createProject({
    companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
    name: `HiveRunner Lookup ${Date.now()}`,
    description: "lookup fixture",
    color: "#0ea5e9",
    emoji: "\ud83d\ude80",
    status: "active",
  }).project;

  createProjectAgent({
    projectId: project.id,
    name: "Forge Prime",
    emoji: "\ud83d\udd27",
    role: "Backend Engineer",
    personality: "Systematic",
    status: "idle",
    skills: [],
  });

  await test("project lookup resolves case-insensitive exact name match", () => {
    const result = lookupProjectByName({ name: project.name.toUpperCase() }).project;
    assert.strictEqual(result.id, project.id);
    assert.strictEqual(result.name, project.name);
  });

  await test("project lookup resolves fuzzy name match", () => {
    const token = project.name.split(" ")[1] ?? project.name;
    const result = lookupProjectByName({ name: token.toLowerCase() }).project;
    assert.strictEqual(result.id, project.id);
  });

  await test("project lookup resolves exact project id match", () => {
    const result = lookupProjectByName({ name: project.id }).project;
    assert.strictEqual(result.id, project.id);
  });

  await test("agent lookup resolves case-insensitive match in company scope", () => {
    const result = lookupAgentByName({
      name: "forge",
      companyId: project.companyId,
    }).agent;

    assert.strictEqual(result.name, "Forge Prime");
    assert.ok(result.id);
  });

  await test("agent lookup returns 404 when not found", () => {
    assert.throws(
      () => lookupAgentByName({ name: "missing-agent", companyId: project.companyId }),
      (error: unknown) =>
        error instanceof OrchestrationApiError &&
        error.status === 404 &&
        error.code === "agent_not_found"
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
