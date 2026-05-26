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
    const { executeCreateTask, importAssistantTextAndExecuteActions } = await import("@/lib/orchestration/engine/engine");

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
      const parentTask = createTask({
        projectId: project.id,
        title: `Subtask fixture parent inherit-${Math.random().toString(36).slice(2, 6)}`,
        description: "Parent task fixture",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: ceo.id,
        labels: ["parent-label"],
        executionEngine: "symphony",
        executionRuntimeProvider: "anthropic",
        executionRuntimeLabel: "Claude Code",
        executionModelRouting: "runtime-managed",
        executionModelRoutingLabel: "Runtime managed",
        createdBy: "subtask-test",
      }).task;

      const childId = await executeCreateTask(
        {
          action: "create_task",
          title: `Child task ${Math.random().toString(36).slice(2, 8)}`,
          parent: parentTask.key!,
          labels: ["symphony-confidence", "ui-created"],
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: companyId,
          taskKey: parentTask.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(childId, "subtask must be created");

      const row = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare(
          `SELECT
             parent_task_id,
             project_id,
             execution_engine,
             execution_runtime_provider,
             execution_runtime_label,
             execution_model_routing,
             execution_model_routing_label,
             labels_json
           FROM tasks WHERE id = ? LIMIT 1`
        )
        .get(childId) as {
          parent_task_id: string | null;
          project_id: string;
          execution_engine: string | null;
          execution_runtime_provider: string | null;
          execution_runtime_label: string | null;
          execution_model_routing: string | null;
          execution_model_routing_label: string | null;
          labels_json: string;
        } | undefined;
      assert.equal(row?.parent_task_id, parentTask.id, "child should have parent_task_id set");
      assert.equal(row?.project_id, project.id, "child should inherit parent's project");
      assert.equal(row?.execution_engine, "symphony", "child should inherit parent's execution engine");
      assert.equal(row?.execution_runtime_provider, "anthropic", "child should inherit parent's runner provider");
      assert.equal(row?.execution_runtime_label, "Claude Code", "child should inherit parent's runner label");
      assert.equal(row?.execution_model_routing, "runtime-managed", "child should inherit parent's model routing");
      assert.equal(row?.execution_model_routing_label, "Runtime managed", "child should inherit parent's model routing label");
      assert.deepEqual(JSON.parse(row?.labels_json ?? "[]"), ["symphony-confidence", "ui-created"], "child should preserve create_task labels");

      // Happy path: no drop — metadata should NOT carry attemptedParent.
      const ev = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.created' LIMIT 1")
        .get(childId) as { metadata_json: string } | undefined;
      const meta = ev ? JSON.parse(ev.metadata_json) as Record<string, unknown> : {};
      assert.equal(meta.attemptedParent, undefined, "attemptedParent should be absent on happy path");
      assert.equal(meta.parentDropReason, undefined, "parentDropReason should be absent on happy path");
      assert.deepEqual(meta.labels, ["symphony-confidence", "ui-created"], "labels should be visible in task.created metadata");
      assert.equal(meta.executionEngine, "symphony", "inherited execution engine should be visible in task.created metadata");
      assert.equal(meta.executionEngineInheritedFromParent, true, "metadata should show parent execution inheritance");
      assert.equal(meta.executionRuntimeProvider, "anthropic", "metadata should show inherited runtime provider");
      assert.equal(meta.executionRuntimeProviderInheritedFromParent, true, "metadata should show parent runtime provider inheritance");
      assert.equal(meta.executionModelRouting, "runtime-managed", "metadata should show inherited model routing");
      assert.equal(meta.executionModelRoutingInheritedFromParent, true, "metadata should show parent model routing inheritance");
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
          companyId: companyId,
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

      // Observability check (2026-04-19): silent drop should leave an
      // auditable trail on the task.created event so a typo'd parent
      // ref is distinguishable from a correctly-authored top-level task.
      const ev = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.created' LIMIT 1")
        .get(childId) as { metadata_json: string } | undefined;
      const meta = ev ? JSON.parse(ev.metadata_json) as Record<string, unknown> : {};
      assert.equal(meta.attemptedParent, "NO-SUCH-KEY-9999", "attemptedParent must be captured in task.created metadata");
      assert.equal(meta.parentDropReason, "parent_unresolved", "parentDropReason must be parent_unresolved");
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
          parent: parentInA.key!,
          project: projectB.slug,
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: companyId,
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

      // Observability: cross-project drop should also leave a trail.
      const ev = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.created' LIMIT 1")
        .get(childId) as { metadata_json: string } | undefined;
      const meta = ev ? JSON.parse(ev.metadata_json) as Record<string, unknown> : {};
      assert.equal(meta.attemptedParent, parentInA.key, "attemptedParent must be captured");
      assert.equal(meta.parentDropReason, "parent_cross_project", "parentDropReason must be parent_cross_project");
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
          parent: parentTask.key!,
          project: project.slug,
        },
        {
          agentId: ceo.id,
          agentName: ceo.name,
          companyId: companyId,
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
          companyId: companyId,
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

    await test("deferred parent closure is tracked separately from errors", async () => {
      clearWakes();
      const project = makeProject("deferred-review");
      const ceo = makeAgent(project.id, "ceo", "CEO");
      const parentTask = createTask({
        projectId: project.id,
        title: `Subtask fixture parent deferred-${Math.random().toString(36).slice(2, 6)}`,
        description: "Parent task fixture",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: ceo.id,
        labels: [],
        executionEngine: "symphony",
        createdBy: "subtask-test",
      }).task;

      const result = await importAssistantTextAndExecuteActions({
        assistantTexts: [
          [
            "```mc-action",
            JSON.stringify({
              action: "create_task",
              title: `Deferred child ${Math.random().toString(36).slice(2, 8)}`,
              parent: parentTask.key!,
              labels: ["symphony-confidence"],
            }),
            "```",
            "```mc-action",
            JSON.stringify({ action: "update_task", taskKey: parentTask.key!, status: "review" }),
            "```",
          ].join("\n"),
        ],
        agentId: ceo.id,
        agentName: ceo.name,
        companyId: companyId,
        taskKey: parentTask.id,
        runId: randomUUID(),
        db,
      });

      assert.equal(result.actionsExecuted, 1, "child create_task should execute");
      assert.equal(result.actionsDeferred, 1, "parent review update should be deferred");
      assert.deepEqual(result.errors, [], "expected parent closure deferral should not be counted as an error");
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
