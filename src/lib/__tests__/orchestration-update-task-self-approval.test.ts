/**
 * G1 — No self-approval guardrail (Phase G of orchestration-integrity lane).
 *
 * Trigger: WEA-282 / WEA-284 on 2026-04-26. Prism posted "Ready for review",
 * Sentinel rejected, Prism resubmitted byte-identical no-op, then Prism's
 * own next heartbeat ran update_task status=done and the engine accepted it
 * because the only checks were the status_transition_rules table. Same agent
 * authored both the latest "Ready for review" and the close-to-done.
 *
 * Rule: when a review→done transition is requested, look up the agent who
 * posted the most recent "Ready for review" comment in the *current* review
 * cycle (i.e. since the latest task.status_changed → review). If that agent
 * matches the actor on the update_task action, reject with reason
 * `self_approval_blocked`. Sweeper already routes review wakes to a fresh
 * reviewer (declared QA or CEO); this guardrail backstops the action path.
 *
 * Run:
 *   ORCHESTRATION_DB_PATH=/tmp/orchestration-self-approval.db \
 *     npx tsx src/lib/__tests__/orchestration-update-task-self-approval.test.ts
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

console.log("\nOrchestration update_task — No Self-Approval Guardrail (G1)\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask, moveTask, createTaskComment } =
      await import("@/lib/orchestration/service");
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

    const getLatestReviewSubmissionAuthor = (engineMod as unknown as {
      getLatestReviewSubmissionAuthor: (taskId: string, db: unknown) => string | null;
    }).getLatestReviewSubmissionAuthor;

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();

    function makeFixture(label: string) {
      const project = createProject({
        companyId,
        name: `SelfApproval ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Self-approval guardrail fixture",
        color: "#22d3ee",
        emoji: "🔐",
        status: "active",
      }).project;

      const producer = createProjectAgent({
        projectId: project.id,
        name: `Producer-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "💻",
        role: "Builder",
        personality: "Deterministic",
        openclawAgentId: `producer-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["build"],
      }).agent;

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

      const releaseSteward = createProjectAgent({
        projectId: project.id,
        name: `ReleaseSteward-${label}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🚢",
        role: "Release Steward",
        personality: "Deterministic",
        openclawAgentId: `release-${label}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["release"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: `Self-approval fixture ${label}`,
        description: "Self-approval guardrail fixture",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: producer.id,
        labels: [],
        createdBy: "g1-test",
      }).task;

      // Producer drives the task to review with a "Ready for review" comment,
      // mirroring the WEA-284 flow. moveTask records the status_changed event;
      // createTaskComment records the producer-authored submission.
      moveTask({ taskId: task.id, status: "review", actorUserId: "g1-test" });
      createTaskComment({
        taskId: task.id,
        authorAgentId: producer.id,
        body: "Ready for review. Delivered the artifact; acceptance criteria met.",
        type: "status_update",
      });

      return { project, producer, reviewer, releaseSteward, task };
    }

    await test("helper resolves the latest 'Ready for review' author scoped to current cycle", () => {
      const { producer, task } = makeFixture("helper-basic");
      const author = getLatestReviewSubmissionAuthor(task.id, db);
      assert.equal(author, producer.id, "producer authored the latest review submission");
    });

    await test("producer cannot self-approve review → done (G1 main path)", () => {
      const { project, producer, task } = makeFixture("producer-blocked");
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Approved." },
        { agentId: producer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      assert.equal(result.taskFound, true);
      assert.equal(result.statusRequested, true);
      assert.equal(result.statusApplied, false, "self-approval must not apply the status change");
      assert.equal(
        result.statusRejectedReason,
        "self_approval_blocked",
        "rejection reason must be self_approval_blocked",
      );
      // Partial-success: comment still lands so the rejection is auditable.
      assert.equal(result.commentApplied, true, "comment should still land on partial success");

      const post = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(task.id) as { status: string } | undefined;
      assert.equal(post?.status, "review", "task must remain in review");
    });

    await test("a different agent CAN approve review → done", () => {
      const { project, reviewer, task } = makeFixture("reviewer-approves");
      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "QA passed." },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      assert.equal(result.statusApplied, true, "non-producer reviewer must be able to close");
      assert.equal(result.statusRejectedReason, undefined);

      const post = (db as { prepare: (q: string) => { get: (...a: unknown[]) => unknown } })
        .prepare("SELECT status FROM tasks WHERE id = ?")
        .get(task.id) as { status: string } | undefined;
      assert.equal(post?.status, "done");
    });

    await test("service moveTask review → done returns release-stewarded tasks to producer", () => {
      const { producer, releaseSteward, task } = makeFixture("service-release-handoff");

      db.prepare(
        "UPDATE tasks SET assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?",
      ).run(releaseSteward.id, new Date().toISOString(), new Date().toISOString(), task.id);

      const moved = moveTask({
        taskId: task.id,
        status: "done",
        actorUserId: releaseSteward.id,
        reviewNotes: "Release steward shipped the reviewed change.",
      });
      assert.equal(moved.task.status, "done");

      const post = db.prepare("SELECT assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
        assignee_agent_id: string | null;
      } | undefined;
      assert.equal(post?.assignee_agent_id, producer.id, "done task should be reassigned to the original producer");

      const event = db
        .prepare(
          `SELECT metadata_json FROM task_events
           WHERE task_id = ? AND event_type = 'task.assigned'
           ORDER BY created_at DESC LIMIT 1`,
        )
        .get(task.id) as { metadata_json: string } | undefined;
      const metadata = event ? JSON.parse(event.metadata_json) as { source?: string; previousAssigneeId?: string } : {};
      assert.equal(metadata.source, "review_completion_return_to_producer");
      assert.equal(metadata.previousAssigneeId, releaseSteward.id);
    });

    await test("engine update_task review → done preserves producer attribution and records reviewer handoff", () => {
      const { project, producer, releaseSteward, task } = makeFixture("engine-release-handoff");

      db.prepare(
        "UPDATE tasks SET assignee_agent_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?",
      ).run(releaseSteward.id, new Date().toISOString(), new Date().toISOString(), task.id);

      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Release passed." },
        { agentId: releaseSteward.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );

      assert.equal(result.statusApplied, true, "release steward should be able to close review");
      assert.equal(result.assigneeApplied, true, "engine should restore producer attribution after approval");

      const post = db.prepare("SELECT status, assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
        status: string;
        assignee_agent_id: string | null;
      } | undefined;
      assert.equal(post?.status, "done");
      assert.equal(post?.assignee_agent_id, producer.id);

      const event = db
        .prepare(
          `SELECT metadata_json FROM task_events
           WHERE task_id = ?
             AND event_type = 'task.assigned'
             AND json_extract(metadata_json, '$.source') = 'engine_review_completion_return_to_producer'
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(task.id) as { metadata_json: string } | undefined;
      assert.ok(event, "producer-restoration assignment event should be recorded");
      const metadata = JSON.parse(event.metadata_json) as {
        reviewer?: string;
        status?: string;
        newAssignee?: string;
        previousAssignee?: string;
      };
      assert.equal(metadata.reviewer, releaseSteward.id);
      assert.equal(metadata.status, "done");
      assert.equal(metadata.newAssignee, producer.id);
      assert.equal(metadata.previousAssignee, releaseSteward.id);

      const reviewDecisionEvent = db
        .prepare(
          `SELECT agent_id, from_status, to_status
           FROM task_events
           WHERE task_id = ?
             AND event_type = 'task.status_changed'
             AND from_status = 'review'
             AND to_status = 'done'
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(task.id) as { agent_id: string | null; from_status: string; to_status: string } | undefined;
      assert.equal(reviewDecisionEvent?.agent_id, releaseSteward.id);
    });

    await test("rework cycle resets the producer (latest 'Ready for review' wins)", () => {
      const { project, producer, reviewer, task } = makeFixture("cycle-reset");

      // Reviewer rejects → task back to in_progress, then producer fixes and
      // resubmits. Now the latest "Ready for review" is again from producer,
      // so producer must again be blocked from self-closing. (Same agent,
      // new round — the guardrail still fires.)
      moveTask({ taskId: task.id, status: "in-progress", actorUserId: "g1-test", reviewNotes: "Send back" });
      moveTask({ taskId: task.id, status: "review", actorUserId: "g1-test" });
      createTaskComment({
        taskId: task.id,
        authorAgentId: producer.id,
        body: "Ready for review (round 2). Fixed the row counts.",
        type: "status_update",
      });

      const author = getLatestReviewSubmissionAuthor(task.id, db);
      assert.equal(author, producer.id, "producer is the latest submitter on round 2");

      // Producer self-approves → still blocked.
      const blocked = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done" },
        { agentId: producer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(blocked.statusRejectedReason, "self_approval_blocked");

      // Reviewer approves → succeeds.
      const ok = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Round 2 passed." },
        { agentId: reviewer.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(ok.statusApplied, true);
    });

    await test("to-do → done (no review cycle) is unaffected by the guardrail", () => {
      // CLAUDE.md product decision: direct to-do → done transitions are
      // legal. The guardrail must only fire on review → done.
      const project = createProject({
        companyId,
        name: `SelfApproval direct-close ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Direct to-do → done",
        color: "#a78bfa",
        emoji: "✅",
        status: "active",
      }).project;
      const agent = createProjectAgent({
        projectId: project.id,
        name: `Solo-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🧰",
        role: "Solo",
        personality: "Deterministic",
        openclawAgentId: `solo-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["build"],
      }).agent;
      const task = createTask({
        projectId: project.id,
        title: "Direct close fixture",
        description: "x",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: agent.id,
        labels: [],
        createdBy: "g1-test",
      }).task;

      const result = executeUpdateTask(
        { action: "update_task", taskKey: task.key as string, status: "done", comment: "Done." },
        { agentId: agent.id, companyId: project.companyId, runId: randomUUID() },
        db,
      );
      assert.equal(result.statusApplied, true, "to-do → done by sole agent must remain allowed");
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
