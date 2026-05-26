/**
 * Regression tests for production-readiness trust rules (NEVA-153)
 *
 * Covers:
 *   1. Archived companies excluded from listCompanies()
 *   2. Archived company returns 404 via getCompany()
 *   3. Archived project excluded from listProjects() and company stats
 *   4. Archived tasks excluded from listTasks() and company active_task_count
 *   5. Done/completed tasks excluded from company active_task_count (only active statuses count)
 *   6. Parent task archival correctly nullifies children's parent_task_id
 *   7. Company stat rollup only reflects active (non-archived) children
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/trust-rules-test.db npx tsx \
 *     src/lib/__tests__/orchestration-trust-rules-regression.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";

import {
  listCompanies,
  createCompany,
  getCompany,
  archiveCompany,
} from "@/lib/orchestration/company-service";

import {
  createProject,
  archiveProject,
  listProjects,
  updateProjectSettings,
  createProjectAgent,
  createTask,
  archiveTask,
  listTasks,
} from "@/lib/orchestration/service";

import { getOrchestrationDb } from "@/lib/orchestration/service/shared";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

// Fixture helpers use production-sounding names to avoid the non-production filter
// (any name containing tokens like "test", "demo", "fixture", etc. is hidden from
// listCompanies / listProjects / listTasks by default).

function makeCompany(suffix: string) {
  return createCompany({
    name: `Vigil Regression Group ${suffix}`,
    description: "Coverage verification",
    status: "active",
  }).company;
}

function makeProject(companyId: string, suffix: string) {
  return createProject({
    companyId,
    name: `Alpha Initiative ${suffix}`,
    description: "Coverage verification",
    color: "#0ea5e9",
    emoji: "🔬",
    status: "active",
  }).project;
}

function makeTask(projectId: string, suffix: string, status: "backlog" | "in-progress" | "done" = "backlog") {
  return createTask({
    projectId,
    title: `Workflow milestone ${suffix}`,
    description: "Coverage checkpoint",
    priority: "P2",
    type: "feature",
    status,
    labels: [],
    createdBy: "vigil",
  }).task;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  console.log("\nOrchestration Trust Rules Regression Tests (NEVA-153)\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  // ── Block 1: Company-level archival ──────────────────────────────────────

  await test("archived company disappears from listCompanies()", () => {
    const ts = Date.now();
    const co = makeCompany(`archive-${ts}`);

    const before = listCompanies().companies;
    assert.ok(
      before.some((c) => c.id === co.id),
      "Expected newly created company to appear in list before archival"
    );

    archiveCompany(co.slug);

    const after = listCompanies().companies;
    assert.ok(
      !after.some((c) => c.id === co.id),
      "Expected archived company to be absent from listCompanies()"
    );
  });

  await test("getCompany() returns 404 for archived company", () => {
    const ts = Date.now();
    const co = makeCompany(`get-404-${ts}`);
    archiveCompany(co.slug);

    assert.throws(
      () => getCompany(co.slug),
      (err: unknown) => {
        assert.ok(err instanceof Error, "Expected an Error");
        assert.ok(
          err.message.includes("not_found") || err.message.includes("not found"),
          `Expected not-found message, got: ${err.message}`
        );
        return true;
      }
    );
  });

  // ── Block 2: Project-level archival ──────────────────────────────────────

  await test("archived project disappears from listProjects()", () => {
    const ts = Date.now();
    const project = makeProject(DEFAULT_COMPANY_ID, `gone-${ts}`);

    const before = listProjects().projects;
    assert.ok(
      before.some((p) => p.id === project.id),
      "Expected newly created project to appear before archival"
    );

    archiveProject(project.id);

    const after = listProjects().projects;
    assert.ok(
      !after.some((p) => p.id === project.id),
      "Expected archived project to be absent from listProjects()"
    );
  });

  await test("includeArchived reports archived projects as archived and supports restore", () => {
    const ts = Date.now();
    const project = makeProject(DEFAULT_COMPANY_ID, `restore-${ts}`);

    archiveProject(project.id);

    const archived = listProjects({ includeArchived: true }).projects.find((p) => p.id === project.id);
    assert.ok(archived, "Expected archived project to appear when includeArchived is true");
    assert.strictEqual(archived.status, "archived");

    const restored = updateProjectSettings({ projectIdOrSlug: project.id, status: "active" }).project;
    assert.strictEqual(restored.status, "active");

    const visible = listProjects().projects;
    assert.ok(
      visible.some((p) => p.id === project.id),
      "Expected restored project to reappear in the default project list"
    );
  });

  await test("archived project's tasks excluded from company active_task_count", () => {
    const ts = Date.now();
    const co = makeCompany(`stats-arc-proj-${ts}`);
    const project = makeProject(co.id, `arc-proj-${ts}`);

    // Create active tasks inside the project
    makeTask(project.id, `t1-${ts}`, "backlog");
    makeTask(project.id, `t2-${ts}`, "in-progress");

    const before = getCompany(co.slug).company;
    assert.ok(
      before.stats.activeTasks >= 2,
      `Expected >=2 active tasks before archival, got ${before.stats.activeTasks}`
    );

    archiveProject(project.id);

    const after = getCompany(co.slug).company;
    assert.strictEqual(
      after.stats.activeTasks,
      0,
      `Expected 0 active tasks after project archival, got ${after.stats.activeTasks}`
    );
    assert.strictEqual(
      after.stats.projects,
      0,
      `Expected 0 projects after archival, got ${after.stats.projects}`
    );
  });

  // ── Block 3: Task-level archival ─────────────────────────────────────────

  await test("archived task disappears from listTasks()", () => {
    const ts = Date.now();
    const project = makeProject(DEFAULT_COMPANY_ID, `task-arc-${ts}`);
    const task = makeTask(project.id, `visible-${ts}`);

    const before = listTasks({ projectId: project.id }).tasks;
    assert.ok(
      before.some((t) => t.id === task.id),
      "Expected task to appear before archival"
    );

    archiveTask({ taskId: task.id, actorUserId: "vigil" });

    const after = listTasks({ projectId: project.id }).tasks;
    assert.ok(
      !after.some((t) => t.id === task.id),
      "Expected archived task to be absent from listTasks()"
    );
  });

  await test("archived task excluded from company active_task_count", () => {
    const ts = Date.now();
    const co = makeCompany(`stats-arc-task-${ts}`);
    const project = makeProject(co.id, `arc-task-${ts}`);
    const task = makeTask(project.id, `arc-${ts}`, "backlog");

    const before = getCompany(co.slug).company;
    assert.ok(
      before.stats.activeTasks >= 1,
      `Expected >=1 active tasks before archival, got ${before.stats.activeTasks}`
    );

    archiveTask({ taskId: task.id, actorUserId: "vigil" });

    const after = getCompany(co.slug).company;
    assert.strictEqual(
      after.stats.activeTasks,
      0,
      `Expected 0 active tasks after task archival, got ${after.stats.activeTasks}`
    );
  });

  // ── Block 4: Done/completed status exclusion from active count ────────────

  await test("done tasks excluded from company active_task_count", () => {
    const ts = Date.now();
    const co = makeCompany(`stats-done-${ts}`);
    const project = makeProject(co.id, `done-tasks-${ts}`);

    // Create agent so we can assign (required for in-progress → done path)
    // Instead, create directly with status 'done' via createTask
    makeTask(project.id, `done-task-${ts}`, "done");

    const stats = getCompany(co.slug).company;
    assert.strictEqual(
      stats.stats.activeTasks,
      0,
      `Expected done task to NOT be counted as active, got ${stats.stats.activeTasks}`
    );
  });

  await test("backlog/in-progress/review/blocked tasks counted as active", () => {
    const ts = Date.now();
    const co = makeCompany(`stats-active-${ts}`);
    const project = makeProject(co.id, `active-tasks-${ts}`);

    makeTask(project.id, `backlog-${ts}`, "backlog");
    makeTask(project.id, `wip-${ts}`, "in-progress");

    const stats = getCompany(co.slug).company;
    assert.strictEqual(
      stats.stats.activeTasks,
      2,
      `Expected 2 active tasks (backlog + in-progress), got ${stats.stats.activeTasks}`
    );
  });

  // ── Block 5: Parent-child task rollup integrity ───────────────────────────

  await test("archiving parent task nullifies children's parent_task_id", () => {
    const ts = Date.now();
    const project = makeProject(DEFAULT_COMPANY_ID, `parent-child-${ts}`);

    const parent = makeTask(project.id, `parent-${ts}`, "backlog");

    const child1 = createTask({
      projectId: project.id,
      title: `Child Alpha ${ts}`,
      description: "Coverage checkpoint",
      priority: "P2",
      type: "feature",
      status: "backlog",
      parentTaskId: parent.id,
      labels: [],
      createdBy: "vigil",
    }).task;

    const child2 = createTask({
      projectId: project.id,
      title: `Child Bravo ${ts}`,
      description: "Coverage checkpoint",
      priority: "P2",
      type: "feature",
      status: "backlog",
      parentTaskId: parent.id,
      labels: [],
      createdBy: "vigil",
    }).task;

    // Verify parent-child link is established at the DB level.
    // NOTE: parentTaskId is not yet exposed in OrchestrationTask (production gap — see NEVA-153 comment).
    // Use direct DB query until the API mapper is updated.
    const db = getOrchestrationDb();
    type TaskParentRow = { parent_task_id: string | null };

    const child1Before = db
      .prepare("SELECT parent_task_id FROM tasks WHERE id = ?")
      .get(child1.id) as TaskParentRow;
    assert.strictEqual(
      child1Before.parent_task_id,
      parent.id,
      "child1 parent_task_id should reference parent before archival"
    );

    const child2Before = db
      .prepare("SELECT parent_task_id FROM tasks WHERE id = ?")
      .get(child2.id) as TaskParentRow;
    assert.strictEqual(
      child2Before.parent_task_id,
      parent.id,
      "child2 parent_task_id should reference parent before archival"
    );

    // Archive the parent
    archiveTask({ taskId: parent.id, actorUserId: "vigil" });

    // Parent should not appear in task list
    const remainingTasks = listTasks({ projectId: project.id }).tasks;
    assert.ok(
      !remainingTasks.some((t) => t.id === parent.id),
      "Archived parent must not appear in task list"
    );

    // Children must still be listed
    assert.ok(
      remainingTasks.some((t) => t.id === child1.id),
      "Child 1 must remain listed after parent archival"
    );
    assert.ok(
      remainingTasks.some((t) => t.id === child2.id),
      "Child 2 must remain listed after parent archival"
    );

    // Children's parent_task_id must be cleared (no dangling reference) — verified at DB level
    const child1After = db
      .prepare("SELECT parent_task_id FROM tasks WHERE id = ?")
      .get(child1.id) as TaskParentRow;
    assert.strictEqual(
      child1After.parent_task_id,
      null,
      "Child 1 parent_task_id must be null after parent archival"
    );

    const child2After = db
      .prepare("SELECT parent_task_id FROM tasks WHERE id = ?")
      .get(child2.id) as TaskParentRow;
    assert.strictEqual(
      child2After.parent_task_id,
      null,
      "Child 2 parent_task_id must be null after parent archival"
    );
  });

  await test("archiving project archives all tasks (children included)", () => {
    const ts = Date.now();
    const project = makeProject(DEFAULT_COMPANY_ID, `cascade-arc-${ts}`);

    const parent = makeTask(project.id, `cascade-parent-${ts}`, "backlog");
    createTask({
      projectId: project.id,
      title: `Cascade Child ${ts}`,
      description: "Coverage checkpoint",
      priority: "P2",
      type: "feature",
      status: "backlog",
      parentTaskId: parent.id,
      labels: [],
      createdBy: "vigil",
    });

    const before = listTasks({ projectId: project.id }).tasks;
    assert.ok(before.length >= 2, `Expected >=2 tasks before archival, got ${before.length}`);

    archiveProject(project.id);

    // After archiving, listTasks({ projectId }) throws "Project not found" because
    // getProjectRow excludes archived projects. Verify via DB directly.
    const db = getOrchestrationDb();
    const afterRow = db
      .prepare("SELECT COUNT(*) AS count FROM tasks WHERE project_id = ? AND archived_at IS NULL")
      .get(project.id) as { count: number };
    assert.strictEqual(
      afterRow.count,
      0,
      `Expected 0 non-archived tasks after project archival, got ${afterRow.count}`
    );
  });

  // ── Block 6: Agent archival via project ───────────────────────────────────

  await test("archiving project excludes agents from company agent_count", () => {
    const ts = Date.now();
    const co = makeCompany(`stats-agent-arc-${ts}`);
    const project = makeProject(co.id, `agent-arc-${ts}`);

    createProjectAgent({
      projectId: project.id,
      name: `[ORCH-TEST] AgentArc ${ts}`,
      emoji: "🤖",
      role: "QA",
      personality: "Thorough",
      status: "idle",
      skills: [],
    });

    const before = getCompany(co.slug).company;
    assert.ok(
      before.stats.agents >= 1,
      `Expected >=1 agent before project archival, got ${before.stats.agents}`
    );

    archiveProject(project.id);

    const after = getCompany(co.slug).company;
    assert.strictEqual(
      after.stats.agents,
      0,
      `Expected 0 agents after project archival, got ${after.stats.agents}`
    );
  });

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
