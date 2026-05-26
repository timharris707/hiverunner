/**
 * Regression test for the silent-rejection bug surfaced on stable 2026-04-19
 * (WEA-274). When `executeUpdateTask` was asked to apply a status transition
 * that no rule allowed, it returned `true` and the engine logged the action
 * as `executed`, even though the status never changed. Kelvin's "Ready for
 * review" handoff stayed in `to-do` and Tim was waiting for the kanban to
 * reflect what had actually been delivered.
 *
 * Fix:
 * - executeUpdateTask now returns a structured result with statusApplied +
 *   statusRejectedReason.
 * - The engine call site reports `skipped` (not `executed`) and pushes a
 *   visible error string into results.errors when a transition is rejected.
 * - Migration v47 fills the gap that triggered the WEA-274 incident
 *   (to-do → review and to-do → done were missing).
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-update-task-status-rejection.db \
 *     npx tsx src/lib/__tests__/orchestration-update-task-status-rejection.test.ts
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

console.log("\nOrchestration update_task Status Transition Rejection Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const engineMod = await import("@/lib/orchestration/engine/engine");

    type UpdateTaskResult = {
      taskFound: boolean;
      statusRequested: boolean;
      statusApplied: boolean;
      statusRejectedReason?: string;
      assigneeRequested: boolean;
      assigneeApplied: boolean;
      commentRequested: boolean;
      commentApplied: boolean;
    };
    const executeUpdateTask = (engineMod as unknown as {
      executeUpdateTask: (
        action: { action: "update_task"; taskKey: string; status?: string; assignee?: string; comment?: string },
        input: { agentId: string; companyId: string; runId: string },
        db: unknown,
      ) => UpdateTaskResult;
    }).executeUpdateTask;

    // Default seeded company from db.ts (auto-created by the boot migration).
    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();

    function makeFixture(label: string) {
      const project = createProject({
        companyId,
        name: `Rejection ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Status rejection fixture",
        color: "#ef4444",
        emoji: "🚦",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Worker-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "👷",
        role: "Backend Engineer",
        personality: "Deterministic",
        openclawAgentId: `worker-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: `Rejection fixture task ${label}`,
        description: "Status rejection fixture",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: agent.id,
        labels: [],
        createdBy: "rejection-test",
      }).task;

      return { project, agent, task };
    }

    await test("to-do → review is allowed (migration v47 added the rule)", () => {
      const { project, agent, task } = makeFixture("to-do-to-review");
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "review" },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.taskFound, true);
      assert.equal(result.statusRequested, true);
      assert.equal(result.statusApplied, true, "to-do → review must apply (rule added in migration v47)");
      assert.equal(result.statusRejectedReason, undefined);

      const post = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(task.id) as { status: string } | undefined;
      assert.equal(post?.status, "review");
    });

    await test("to-do → done without a visible comment is rejected", () => {
      const { project, agent, task } = makeFixture("to-do-to-done-no-comment");
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done" },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, false, "done transitions must not apply without a visible comment");
      assert.equal(result.statusRejectedReason, "done_requires_comment");

      const post = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(task.id) as { status: string } | undefined;
      assert.equal(post?.status, "to-do");
    });

    await test("to-do → done is allowed when the update includes a comment", () => {
      const { project, agent, task } = makeFixture("to-do-to-done-comment");
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Completed with verification notes." },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, "done transition must apply when it carries visible closure notes");
      assert.equal(result.commentApplied, true);

      const post = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(task.id) as { status: string } | undefined;
      assert.equal(post?.status, "done");
    });

    await test("blocked → review is allowed for successful retry runs", () => {
      const { project, agent, task } = makeFixture("blocked-to-review");
      db.prepare("UPDATE tasks SET status = 'blocked', blocked_reason = 'Retry fixture' WHERE id = ?").run(task.id);

      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "review", comment: "Retry completed; ready for review." },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, "blocked → review must apply after a successful retry");
      assert.equal(result.statusRejectedReason, undefined);
      assert.equal(result.commentApplied, true);

      const post = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT status, blocked_reason FROM tasks WHERE id = ?")
        .get(task.id) as { status: string; blocked_reason: string | null } | undefined;
      assert.equal(post?.status, "review");
      assert.equal(post?.blocked_reason, null);
    });

    await test("review → to-do queues a rework wake for the assigned worker", () => {
      const { project, agent, task } = makeFixture("review-rework-wake");
      const reviewer = createProjectAgent({
        projectId: project.id,
        name: `Reviewer-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🧪",
        role: "CEO",
        personality: "Deterministic",
        openclawAgentId: `reviewer-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
      db.prepare("UPDATE tasks SET status = 'review' WHERE id = ?").run(task.id);

      const runId = randomUUID();
      const result = executeUpdateTask(
        {
          action: "update_task",
          taskKey: task.key as string,
          status: "to-do",
          comment: "Needs rework before approval.",
        },
        { agentId: reviewer.id, companyId: project.companyId, runId },
        db,
      );
      assert.equal(result.statusApplied, true);
      assert.equal(result.commentApplied, true);

      const wake = db
        .prepare(
          `SELECT agent_id, reason, payload_json
           FROM agent_wakeup_requests
           WHERE json_extract(payload_json, '$.taskId') = ?
           LIMIT 1`,
        )
        .get(task.id) as { agent_id: string; reason: string; payload_json: string } | undefined;
      assert.equal(wake?.agent_id, agent.id);
      assert.equal(wake?.reason, "review_rework_requested");
      assert.equal(JSON.parse(wake?.payload_json ?? "{}").requestedByAgentId, reviewer.id);
    });

    await test("rejected transition surfaces statusRejectedReason instead of silent success", () => {
      const { project, agent, task } = makeFixture("rejected-transition");

      // Drop the to-do → review rule for this single test to simulate the
      // pre-fix state (this is the exact failure mode that bit WEA-274).
      db.prepare("DELETE FROM status_transition_rules WHERE from_status='to-do' AND to_status='review'").run();
      try {
        const result = executeUpdateTask(
          { action: "update_task", taskKey: task.key as string, status: "review", comment: "Ready for review." },
          { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
          db,
        );

        assert.equal(result.taskFound, true);
        assert.equal(result.statusRequested, true);
        assert.equal(result.statusApplied, false, "rejected transition must NOT report applied");
        assert.equal(
          result.statusRejectedReason,
          "no_transition_rule",
          "rejection reason must be surfaced so the engine can mark the action skipped",
        );
        // Comment should still land — partial-success semantics are intentional.
        assert.equal(result.commentApplied, true, "comment lands even when status is rejected");

        const post = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .get(task.id) as { status: string } | undefined;
        assert.equal(post?.status, "to-do", "task status must be unchanged after rejected transition");

        const events = (db as { prepare: (q: string) => { all: (...a: unknown[]) => unknown } })
          .prepare(
            `SELECT COUNT(*) AS n FROM task_events
             WHERE task_id = ? AND event_type = 'task.status_changed'`,
          )
          .get(task.id) as { n: number } | undefined;
        assert.equal(events?.n ?? 0, 0, "no task.status_changed event must be emitted on rejection");
      } finally {
        // Restore the rule so later tests in the same DB stay sane.
        db.prepare(
          `INSERT OR IGNORE INTO status_transition_rules (from_status, to_status, requires_assignee, requires_review, is_terminal)
           VALUES ('to-do','review',0,0,0)`,
        ).run();
      }
    });

    await test("invalid status string surfaces invalid_status reason", () => {
      const { project, agent, task } = makeFixture("invalid-status");
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "ship-it" },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, false);
      assert.equal(result.statusRejectedReason, "invalid_status");
    });

    await test("status that already matches current is reported as already_at_status", () => {
      const { project, agent, task } = makeFixture("already-at-status");
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "to-do" },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, false);
      assert.equal(result.statusRejectedReason, "already_at_status");
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
