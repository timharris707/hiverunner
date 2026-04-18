/**
 * Contract test for `create_task` action subtask wiring (2026-04-18).
 *
 * Prior state: subtasks existed at the schema + UI + backend-service level,
 * but the agent-facing `create_task` action didn't accept a `parent` field.
 * Net effect: agents had no way to express subtask intent — feature usage
 * died. Observed live: only 6 subtasks in the entire DB, all from one day
 * 3 days ago, likely from UI/API paths rather than agent actions.
 *
 * This test pins the new semantics:
 *   - `parent` (agent-facing) is a task_key, matching every other action.
 *   - Resolved parent dictates the subtask's project_id (inherit).
 *   - If agent specifies both parent and a conflicting project, the
 *     cross-project link is silently rejected — task is created as top-level.
 *   - Unknown parent task_key → silent drop, top-level task.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-create-task-subtask.db
 * npx tsx src/lib/__tests__/orchestration-create-task-subtask.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

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

console.log("\nOrchestration create_task Subtask Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { executeCreateTask } = await import("@/lib/orchestration/engine/engine");

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();

    function makeProject(tag: string) {
      return createProject({
        companyId,
        name: `Subtask ${tag} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Subtask fixture",
        color: "#10b981",
        emoji: "🌲",
        status: "active",
      }).project;
    }

    function makeAgent(projectId: string, tag: string, role = "Backend Engineer") {
      return createProjectAgent({
        projectId,
        name: `Subtask ${tag}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role,
        personality: "Deterministic",
        openclawAgentId: `subtask-${tag}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
    }

    function makeTask(projectId: string, assigneeId: string, titleTag: string) {
      return createTask({
        projectId,
        title: `Subtask fixture parent ${titleTag}`,
        description: "Parent task fixture",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: assigneeId,
        labels: [],
        createdBy: "subtask-test",
      }).task;
    }

    function clearWakes() {
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();
      db.prepare("DELETE FROM execution_runs").run();
      const stamp = new Date().toISOString();
      db.prepare("UPDATE tasks  SET archived_at = ? WHERE archived_at IS NULL").run(stamp);
      db.prepare("UPDATE agents SET archived_at = ? WHERE archived_at IS NULL").run(stamp);
    }

    await test("create_task with valid parent creates a subtask that inherits parent's project", async () => {
      clearWakes();
      const project = makeProject("inherit-project");
      const ceo = makeAgent(project.id, "ceo", "CEO");
      const parentTask = makeTask(project.id, ceo.id, `inherit-${Math.random().toString(36).slice(2, 6)}`);

      const childId = await executeCreateTask(
        {
          action: "create_task",
          title: `Child task ${Math.random().toString(36).slice(2, 8)}`,
          parent: parentTask.key,
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: project.companyId,
          taskKey: parentTask.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(childId, "subtask must be created");

      const row = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT parent_task_id, project_id FROM tasks WHERE id = ? LIMIT 1")
        .get(childId) as { parent_task_id: string | null; project_id: string } | undefined;
      assert.equal(row?.parent_task_id, parentTask.id, "child should have parent_task_id set");
      assert.equal(row?.project_id, project.id, "child should inherit parent's project");
    });

    await test("create_task with unknown parent task_key creates top-level task (silent drop)", async () => {
      clearWakes();
      const project = makeProject("unknown-parent");
      const ceo = makeAgent(project.id, "ceo", "CEO");
      // Seed a direction task so the fallback project resolver works.
      const directionTask = makeTask(project.id, ceo.id, `dir-${Math.random().toString(36).slice(2, 6)}`);

      const childId = await executeCreateTask(
        {
          action: "create_task",
          title: `Orphan candidate ${Math.random().toString(36).slice(2, 8)}`,
          parent: "NO-SUCH-KEY-9999",
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: project.companyId,
          taskKey: directionTask.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(childId, "task must be created (top-level) even when parent is unknown");

      const row = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT parent_task_id FROM tasks WHERE id = ? LIMIT 1")
        .get(childId) as { parent_task_id: string | null } | undefined;
      assert.equal(row?.parent_task_id, null, "parent_task_id must be NULL when parent unresolvable");
    });

    await test("create_task with parent + explicit different project rejects cross-project link (silent)", async () => {
      clearWakes();
      const projectA = makeProject("proj-A");
      const projectB = makeProject("proj-B");
      const ceo = makeAgent(projectA.id, "ceo", "CEO");
      const parentInA = makeTask(projectA.id, ceo.id, `cross-${Math.random().toString(36).slice(2, 6)}`);

      const childId = await executeCreateTask(
        {
          action: "create_task",
          title: `Cross-project candidate ${Math.random().toString(36).slice(2, 8)}`,
          parent: parentInA.key,
          project: projectB.slug,
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: projectA.companyId,
          taskKey: parentInA.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(childId, "task must be created (top-level in the specified project)");

      const row = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT parent_task_id, project_id FROM tasks WHERE id = ? LIMIT 1")
        .get(childId) as { parent_task_id: string | null; project_id: string } | undefined;
      assert.equal(row?.parent_task_id, null, "cross-project parent link must be rejected");
      assert.equal(row?.project_id, projectB.id, "task must be created in the explicitly requested project B");
    });

    await test("create_task with parent + matching project keeps the subtask link", async () => {
      clearWakes();
      const project = makeProject("match-project");
      const ceo = makeAgent(project.id, "ceo", "CEO");
      const parentTask = makeTask(project.id, ceo.id, `match-${Math.random().toString(36).slice(2, 6)}`);

      const childId = await executeCreateTask(
        {
          action: "create_task",
          title: `Same-project child ${Math.random().toString(36).slice(2, 8)}`,
          parent: parentTask.key,
          project: project.slug,
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: project.companyId,
          taskKey: parentTask.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(childId);

      const row = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT parent_task_id, project_id FROM tasks WHERE id = ? LIMIT 1")
        .get(childId) as { parent_task_id: string | null; project_id: string } | undefined;
      assert.equal(row?.parent_task_id, parentTask.id);
      assert.equal(row?.project_id, project.id);
    });

    await test("create_task without parent creates a top-level task (baseline unchanged)", async () => {
      clearWakes();
      const project = makeProject("baseline");
      const ceo = makeAgent(project.id, "ceo", "CEO");
      const directionTask = makeTask(project.id, ceo.id, `baseline-${Math.random().toString(36).slice(2, 6)}`);

      const childId = await executeCreateTask(
        {
          action: "create_task",
          title: `Standalone task ${Math.random().toString(36).slice(2, 8)}`,
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: project.companyId,
          taskKey: directionTask.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(childId);

      const row = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT parent_task_id FROM tasks WHERE id = ? LIMIT 1")
        .get(childId) as { parent_task_id: string | null } | undefined;
      assert.equal(row?.parent_task_id, null);
    });
  } finally {
    if (dbPath) rmSync(dbPath, { force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
