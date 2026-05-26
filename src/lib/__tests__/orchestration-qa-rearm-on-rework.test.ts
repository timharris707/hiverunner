/**
 * G3 — QA tasks stay alive while parent is open (Phase G of orchestration-
 * integrity lane).
 *
 * Trigger: WEA-285 on 2026-04-26. Sentinel did one round of validation,
 * posted a "send back" finding, and the validation task auto-closed as
 * `done`. When Prism resubmitted with no actual fix (a no-op), there was
 * no validator left to catch it; Prism self-approved (separately blocked
 * by G1) and the parent moved toward done with the row-count bug intact.
 *
 * Rule: when a build-style subtask transitions review → in_progress (rework
 * signal) via update_task, sibling QA-style subtasks that already closed
 * pointing at it via depends_on_json get cloned as round-N tasks so QA
 * actually re-runs.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-qa-rearm.db \
 *     npx tsx src/lib/__tests__/orchestration-qa-rearm-on-rework.test.ts
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

console.log("\nOrchestration update_task — QA Re-arm on Rework (G3)\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask, moveTask, createTaskComment } =
      await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const engineMod = await import("@/lib/orchestration/engine/engine");

    type CreateTaskAction = {
      action: "create_task";
      title: string;
      description?: string;
      assignee?: string;
      project?: string;
      parent?: string;
      type?: string;
      dependsOn?: string[];
    };
    const executeCreateTask = (engineMod as unknown as {
      executeCreateTask: (
        action: CreateTaskAction,
        input: { agentId: string; agentName: string; companyId: string; taskKey: string; runId: string },
        db: unknown,
      ) => Promise<string | null>;
    }).executeCreateTask;

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
      prepare: (q: string) => {
        get: (...a: unknown[]) => unknown;
        all: (...a: unknown[]) => unknown;
        run: (...a: unknown[]) => unknown;
      };
    };

    function makeChain(label: string) {
      const project = createProject({
        companyId,
        name: `QArearm ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "QA rearm fixture",
        color: "#fb7185",
        emoji: "🛡️",
        status: "active",
      }).project;

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

      const validator = createProjectAgent({
        projectId: project.id,
        name: `Validator-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🛡️",
        role: "Validator",
        personality: "Deterministic",
        openclawAgentId: `validator-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["validate"],
      }).agent;

      // Parent task (the user-filed direction) at the top of the chain.
      const parent = createTask({
        projectId: project.id,
        title: `Parent direction ${label}`,
        description: "x",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: builder.id,
        labels: [],
        createdBy: "g3-test",
      }).task;

      return { project, builder, validator, parent };
    }

    await test("rework on build clones the sibling QA task with round-2 title", async () => {
      const { project, builder, validator, parent } = makeChain("clone-once");

      // Build subtask via the engine path (so depends_on_json plumbing is live).
      const buildId = await executeCreateTask(
        {
          action: "create_task",
          title: `Build the report ${Date.now()}`,
          assignee: builder.name,
          parent: parent.key as string,
          type: "feature",
        },
        {
          agentId: builder.id,
          agentName: builder.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(buildId);

      // QA subtask depends on build, type=research (the heuristic match).
      const qaTitleBase = `Validate the report ${Date.now()}`;
      const buildKey = (db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(buildId) as { task_key: string }).task_key;
      const qaId = await executeCreateTask(
        {
          action: "create_task",
          title: qaTitleBase,
          assignee: validator.name,
          parent: parent.key as string,
          type: "research",
          dependsOn: [buildKey],
        },
        {
          agentId: builder.id,
          agentName: builder.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(qaId);

      // Build runs and submits — review → done (QA closes after validation).
      // We move the build through review → done first so we can move the QA
      // task to a fresh review cycle. Use moveTask (service path) to avoid the
      // self-approval check kicking in for fixtures that don't need it.
      moveTask({ taskId: buildId as string, status: "review", actorUserId: "g3-test" });
      moveTask({ taskId: buildId as string, status: "done", actorUserId: "g3-test", reviewNotes: "Build accepted (round 1)" });

      // QA runs and closes after posting a finding (this is the WEA-285 case
      // — the validator closes after one pass).
      moveTask({ taskId: qaId as string, status: "review", actorUserId: "g3-test" });
      moveTask({ taskId: qaId as string, status: "done", actorUserId: "g3-test", reviewNotes: "QA round 1 complete" });

      // Now Tim (or a reviewer) sends the build back: review → in_progress.
      // Re-open build to review first since it was 'done'; this mirrors the
      // case where you'd reject after the fact.
      moveTask({ taskId: buildId as string, status: "review", actorUserId: "g3-test" });
      // The actual rework signal must come through the engine action path so
      // G3's hook fires. Producer's run handles rejection → in_progress. Use
      // a different agent to avoid the (separate) self-approval guardrail.
      createTaskComment({
        taskId: buildId as string,
        authorAgentId: validator.id,
        body: "Sending back. Round 1 was a no-op.",
        type: "status_update",
      });
      const rework = executeUpdateTask(
        {
          action: "update_task",
          taskKey: buildKey,
          status: "in-progress",
          comment: "Reopening for fix.",
        },
        { agentId: validator.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(rework.statusApplied, true, "rework status change must apply");

      // Expect a fresh QA round-2 clone with the same base title.
      const clones = db
        .prepare(
          `SELECT id, title, status, depends_on_json, parent_task_id
           FROM tasks
           WHERE parent_task_id = ?
             AND id != ?
             AND title LIKE ?
             AND archived_at IS NULL`,
        )
        .all(parent.id, qaId, `${qaTitleBase} (round %`) as Array<{
          id: string;
          title: string;
          status: string;
          depends_on_json: string;
          parent_task_id: string;
        }>;
      assert.equal(clones.length, 1, "exactly one round-2 clone should exist");
      assert.match(clones[0].title, /\(round 2\)$/);
      assert.equal(clones[0].status, "to-do");
      const cloneDeps = JSON.parse(clones[0].depends_on_json) as string[];
      assert.ok(cloneDeps.includes(buildId as string), "clone must depend on the reworked build task");
    });

    await test("does not clone when no QA sibling is done (only build sibling)", async () => {
      const { project, builder, parent } = makeChain("no-qa-sibling");

      const buildId = await executeCreateTask(
        {
          action: "create_task",
          title: `Build with no QA ${Date.now()}`,
          assignee: builder.name,
          parent: parent.key as string,
          type: "feature",
        },
        {
          agentId: builder.id,
          agentName: builder.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(buildId);
      const buildKey = (db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(buildId) as { task_key: string }).task_key;

      moveTask({ taskId: buildId as string, status: "review", actorUserId: "g3-test" });

      const before = db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id = ? AND archived_at IS NULL")
        .get(parent.id) as { n: number };

      // Use a fresh agent so self-approval doesn't block. Build agent is the
      // assignee, but we're not posting "Ready for review" comments here,
      // so no self-approval gate fires.
      const rework = executeUpdateTask(
        { action: "update_task", taskKey: buildKey, status: "in-progress" },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(rework.statusApplied, true);

      const after = db
        .prepare("SELECT COUNT(*) AS n FROM tasks WHERE parent_task_id = ? AND archived_at IS NULL")
        .get(parent.id) as { n: number };
      assert.equal(after.n, before.n, "no clones should be created when there's no QA sibling");
    });

    await test("skips re-clone when a live (non-done) QA round already exists", async () => {
      const { project, builder, validator, parent } = makeChain("no-double-clone");

      const buildId = await executeCreateTask(
        {
          action: "create_task",
          title: `Build with stuck QA ${Date.now()}`,
          assignee: builder.name,
          parent: parent.key as string,
          type: "feature",
        },
        {
          agentId: builder.id,
          agentName: builder.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(buildId);
      const buildKey = (db.prepare("SELECT task_key FROM tasks WHERE id = ?").get(buildId) as { task_key: string }).task_key;

      const qaTitleBase = `Validate stuck ${Date.now()}`;
      const qaId = await executeCreateTask(
        {
          action: "create_task",
          title: qaTitleBase,
          assignee: validator.name,
          parent: parent.key as string,
          type: "research",
          dependsOn: [buildKey],
        },
        {
          agentId: builder.id,
          agentName: builder.name,
          companyId: project.companyId,
          taskKey: parent.id,
          runId: randomUUID(),
        },
        db,
      );
      assert.ok(qaId);

      moveTask({ taskId: buildId as string, status: "review", actorUserId: "g3-test" });
      moveTask({ taskId: buildId as string, status: "done", actorUserId: "g3-test", reviewNotes: "ok" });
      moveTask({ taskId: qaId as string, status: "review", actorUserId: "g3-test" });
      moveTask({ taskId: qaId as string, status: "done", actorUserId: "g3-test", reviewNotes: "round 1" });
      moveTask({ taskId: buildId as string, status: "review", actorUserId: "g3-test" });

      // First rework spawns clone #1.
      executeUpdateTask(
        { action: "update_task", taskKey: buildKey, status: "in-progress" },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      const clonesAfter1 = db
        .prepare(
          `SELECT COUNT(*) AS n FROM tasks
           WHERE parent_task_id = ? AND title LIKE ? AND archived_at IS NULL`,
        )
        .get(parent.id, `${qaTitleBase} (round %`) as { n: number };
      assert.equal(clonesAfter1.n, 1, "first rework should produce one clone");

      // Force build back into review without finishing the live clone.
      moveTask({ taskId: buildId as string, status: "review", actorUserId: "g3-test" });

      // Second rework — clone #1 is still to-do (live), so we should NOT
      // pile on another clone.
      executeUpdateTask(
        { action: "update_task", taskKey: buildKey, status: "in-progress" },
        { agentId: builder.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      const clonesAfter2 = db
        .prepare(
          `SELECT COUNT(*) AS n FROM tasks
           WHERE parent_task_id = ? AND title LIKE ? AND archived_at IS NULL`,
        )
        .get(parent.id, `${qaTitleBase} (round %`) as { n: number };
      assert.equal(clonesAfter2.n, 1, "no double-cloning while a clone is still live");
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
