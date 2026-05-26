import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Test DB isolation ──────────────────────────────────────────────
// Force a temp DB so this test NEVER writes to the production database,
// even when run directly via `npx tsx` without ORCHESTRATION_DB_PATH.
// Must be set before the orchestration service is imported (dynamic import below).
if (!process.env.ORCHESTRATION_DB_PATH) {
  process.env.ORCHESTRATION_DB_PATH = path.join(
    os.tmpdir(),
    `mc-type-mapping-test-${Date.now()}.db`,
  );
}

const originalWorkspaceRoot = process.env.MC_WORKSPACE_ROOT;
const tempWorkspaceRoot = mkdtempSync(path.join(os.tmpdir(), "mc-type-mapping-workspaces-"));
process.env.MC_WORKSPACE_ROOT = path.join(tempWorkspaceRoot, "workspaces");
mkdirSync(process.env.MC_WORKSPACE_ROOT, { recursive: true });

let passed = 0;
let failed = 0;

function cleanupWorkspaceRoot() {
  if (originalWorkspaceRoot === undefined) {
    delete process.env.MC_WORKSPACE_ROOT;
  } else {
    process.env.MC_WORKSPACE_ROOT = originalWorkspaceRoot;
  }
  rmSync(tempWorkspaceRoot, { recursive: true, force: true });
}

process.once("exit", cleanupWorkspaceRoot);

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
  const dbPath = process.env.ORCHESTRATION_DB_PATH!;

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  // Dynamic import so db.ts sees ORCHESTRATION_DB_PATH set above
  const {
    createProject,
    createProjectAgent,
    createTask,
    getTask,
    listProjectAgents,
  } = await import("@/lib/orchestration/service");

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
      name: `StatusCheck Agent ${Date.now()}`,
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
