/**
 * G7 — engine update_task propagates to parent reconciliation.
 *
 * Observed on WEA-282 (2026-04-26): parent task stayed in `review` even after
 * all three children moved to `done` via mc-action update_task. The
 * service-layer moveTask path calls reconcileTaskHierarchy on every status
 * change; the engine action path (executeUpdateTask) was skipping it. So
 * agent-driven status changes never propagated up the tree.
 *
 * Rule: after a successful status change in executeUpdateTask, call
 * reconcileTaskHierarchy with the task's parent_task_id and sprint_id so the
 * parent re-evaluates and auto-flips to `done` when every child is done.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-engine-reconcile.db \
 *     npx tsx src/lib/__tests__/orchestration-engine-update-task-reconcile-parent.test.ts
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
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration update_task — Parent Reconciliation (G7)\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask, moveTask } =
      await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const engineMod = await import("@/lib/orchestration/engine/engine");

    type UpdateTaskAction = {
      action: "update_task";
      taskKey: string;
      status?: string;
      assignee?: string;
      comment?: string;
    };
    const executeUpdateTask = (engineMod as unknown as {
      executeUpdateTask: (
        action: UpdateTaskAction,
        input: { agentId: string; companyId: string; runId: string },
        db: unknown,
      ) => { statusApplied: boolean; statusRejectedReason?: string };
    }).executeUpdateTask;

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb() as unknown as {
      prepare: (q: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown };
    };

    function makeTree(label: string) {
      const project = createProject({
        companyId,
        name: `G7 ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "G7 fixture",
        color: "#06b6d4",
        emoji: "🌳",
        status: "active",
      }).project;
      const reviewer = createProjectAgent({
        projectId: project.id,
        name: `Reviewer-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🛡️",
        role: "Reviewer",
        personality: "Deterministic",
        openclawAgentId: `reviewer-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["review"],
      }).agent;
      const builder = createProjectAgent({
        projectId: project.id,
        name: `Builder-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role: "Builder",
        personality: "Deterministic",
        openclawAgentId: `builder-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["build"],
      }).agent;
      const parent = createTask({
        projectId: project.id,
        title: `Parent ${label}`,
        description: "x",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: reviewer.id,
        labels: [],
        createdBy: "g7-test",
      }).task;
      const childA = createTask({
        projectId: project.id,
        title: `Child A ${label}`,
        description: "x",
        priority: "P2",
        type: "feature",
        status: "review",
        assignee: builder.id,
        parentTaskId: parent.id,
        labels: [],
        createdBy: "g7-test",
      }).task;
      const childB = createTask({
        projectId: project.id,
        title: `Child B ${label}`,
        description: "x",
        priority: "P2",
        type: "feature",
        status: "review",
        assignee: builder.id,
        parentTaskId: parent.id,
        labels: [],
        createdBy: "g7-test",
      }).task;
      return { project, reviewer, builder, parent, childA, childB };
    }

    await test("parent stays in review until ALL children are done (single child closing is not enough)", () => {
      const { project, reviewer, parent, childA } = makeTree("partial");
      // Move parent to review so reconciliation can flip it to done later.
      moveTask({ taskId: parent.id, status: "review", actorUserId: "g7-test" });
      const result = executeUpdateTask(
        { action: "update_task", taskKey: childA.key as string, status: "done", comment: "ok" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true);
      const post = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string };
      assert.equal(post.status, "review", "parent must stay in review while sibling is still open");
    });

    await test("when the LAST child closes via update_task, parent auto-flips to done", () => {
      const { project, reviewer, parent, childA, childB } = makeTree("final");
      moveTask({ taskId: parent.id, status: "review", actorUserId: "g7-test" });

      executeUpdateTask(
        { action: "update_task", taskKey: childA.key as string, status: "done", comment: "ok" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      const mid = db.prepare("SELECT status FROM tasks WHERE id = ?").get(parent.id) as { status: string };
      assert.equal(mid.status, "review", "intermediate state: parent still review (childB pending)");

      executeUpdateTask(
        { action: "update_task", taskKey: childB.key as string, status: "done", comment: "ok" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      const post = db
        .prepare("SELECT status, completed_at FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string; completed_at: string | null };
      assert.equal(post.status, "done", "parent must auto-flip to done after the last child closes");
      assert.ok(post.completed_at, "parent.completed_at must be set when the auto-flip fires");

      const parentAudit = db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM task_events WHERE task_id = ? AND event_type = 'task.status_changed' AND to_status = 'done') AS done_events,
             (SELECT COUNT(*) FROM comments WHERE task_id = ? AND source = 'mission_control' AND external_ref = ?) AS rollup_comments`,
        )
        .get(parent.id, parent.id, `hierarchy:auto-complete:${parent.id}`) as {
          done_events: number;
          rollup_comments: number;
        };
      assert.equal(parentAudit.done_events, 1, "parent auto-flip must leave a task.status_changed audit event");
      assert.equal(parentAudit.rollup_comments, 1, "parent auto-flip must leave a visible roll-up comment");
    });

    await test("parent auto-completion assigns an unowned parent to the completion actor", () => {
      const { project, reviewer, parent, childA, childB } = makeTree("owner");
      db.prepare("UPDATE tasks SET assignee_agent_id = NULL, assigned_at = NULL, status = 'review' WHERE id = ?").run(parent.id);

      executeUpdateTask(
        { action: "update_task", taskKey: childA.key as string, status: "done", comment: "child A done" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      executeUpdateTask(
        { action: "update_task", taskKey: childB.key as string, status: "done", comment: "child B done" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      const post = db
        .prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string; assignee_agent_id: string | null };
      assert.equal(post.status, "done");
      assert.equal(post.assignee_agent_id, reviewer.id, "unowned completed parents should show an accountable agent");
    });

    await test("rework on a child (review → in_progress) flips parent back to in_progress", () => {
      const { project, reviewer, parent, childA, childB } = makeTree("rework");
      moveTask({ taskId: parent.id, status: "review", actorUserId: "g7-test" });

      executeUpdateTask(
        { action: "update_task", taskKey: childA.key as string, status: "done", comment: "ok" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      executeUpdateTask(
        { action: "update_task", taskKey: childB.key as string, status: "in-progress", comment: "send back" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      const post = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string };
      // Parent remains active while a child is back in progress.
      // childA=done + childB=in_progress → in_progress wins.
      assert.equal(post.status, "in_progress", "rework on a child must reflect on the parent");
    });

    await test("parent stays active when one child is review but downstream siblings are still queued", () => {
      const project = createProject({
        companyId,
        name: `G7 queued sibling ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "G7 fixture",
        color: "#06b6d4",
        emoji: "🌳",
        status: "active",
      }).project;
      const reviewer = createProjectAgent({
        projectId: project.id,
        name: `Reviewer-queued-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🛡️",
        role: "Reviewer",
        personality: "Deterministic",
        openclawAgentId: `reviewer-queued-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["review"],
      }).agent;
      const builder = createProjectAgent({
        projectId: project.id,
        name: `Builder-queued-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role: "Builder",
        personality: "Deterministic",
        openclawAgentId: `builder-queued-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["build"],
      }).agent;
      const parent = createTask({
        projectId: project.id,
        title: "Parent queued sibling",
        description: "x",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: reviewer.id,
        labels: [],
        createdBy: "g7-test",
      }).task;
      const reviewedChild = createTask({
        projectId: project.id,
        title: "Reviewed child",
        description: "x",
        priority: "P2",
        type: "feature",
        status: "review",
        assignee: builder.id,
        parentTaskId: parent.id,
        labels: [],
        createdBy: "g7-test",
      }).task;
      createTask({
        projectId: project.id,
        title: "Queued downstream child",
        description: "x",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: builder.id,
        parentTaskId: parent.id,
        labels: [],
        createdBy: "g7-test",
      });

      moveTask({ taskId: parent.id, status: "review", actorUserId: "g7-test" });
      executeUpdateTask(
        { action: "update_task", taskKey: reviewedChild.key as string, status: "done", comment: "ok" },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      const post = db
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(parent.id) as { status: string };
      assert.equal(post.status, "in_progress", "queued downstream children keep the parent active");
    });

    const total = passed + failed;
    console.log(`\nResult: ${passed}/${total} passed`);
    if (failed > 0) process.exitCode = 1;
  } catch (err) {
    console.error("Test harness crashed:", err);
    process.exitCode = 1;
  }
}

run();
