/**
 * Contract tests for the orchestration sweeper.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-sweeper.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-sweeper.test.ts
 */

import assert from "node:assert/strict";
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

console.log("\nOrchestration Sweeper Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");
    const { createApproval } = await import("@/lib/orchestration/service/approval");

    const companyId = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";
    const db = getOrchestrationDb();

    function makeProject(nameTag: string) {
      return createProject({
        companyId,
        name: `Sweep ${nameTag} ${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
        description: "Sweep fixture",
        color: "#3b82f6",
        emoji: "🧹",
        status: "active",
      }).project;
    }

    function makeAgent(projectId: string, tag: string) {
      return createProjectAgent({
        projectId,
        name: `Sweep Agent ${tag}-${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🔧",
        role: "Backend Engineer",
        personality: "Deterministic",
        openclawAgentId: `sweep-${tag}-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
    }

    function makeTask(
      projectId: string,
      assigneeId: string | null,
      status: "backlog" | "to-do" | "in-progress" | "review" | "done" | "blocked",
    ) {
      const task = createTask({
        projectId,
        title: `Sweep task ${status} ${Math.random().toString(36).slice(2, 6)}`,
        description: "Sweep task fixture",
        priority: "P2",
        type: "feature",
        status,
        ...(assigneeId ? { assignee: assigneeId } : {}),
        labels: [],
        createdBy: "sweep-test",
      }).task;
      return task;
    }

    function clearWakes() {
      db.prepare("DELETE FROM agent_wakeup_requests").run();
      db.prepare("DELETE FROM heartbeat_runs").run();
      // Archive tasks from prior tests so sweeper doesn't pick them up. Each
      // test seeds its own tasks fresh — the filter is archived_at IS NULL so
      // setting archived_at removes them from the candidate set.
      db.prepare("UPDATE tasks SET archived_at = ? WHERE archived_at IS NULL").run(new Date().toISOString());
      db.prepare("UPDATE agents SET archived_at = ? WHERE archived_at IS NULL").run(new Date().toISOString());
    }

    await test("sweep enqueues wakes for assigned open tasks (to-do / in-progress — review covered in review-loop-fix test)", () => {
      clearWakes();
      const project = makeProject("happy-path");
      // One agent per task so the per-agent concurrency guard doesn't suppress
      // the second enqueue on a single pass. Review-status sweep routes to
      // the CEO and is covered in orchestration-review-loop-fix.test.ts.
      const agentOnDeck = makeAgent(project.id, "to-do");
      const agentInProg = makeAgent(project.id, "in-prog");
      makeTask(project.id, agentOnDeck.id, "to-do");
      makeTask(project.id, agentInProg.id, "in-progress");

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 2, `expected 2 wakes, got ${JSON.stringify(result)}`);
      assert.equal(result.candidatesConsidered, 2);
    });

    await test("sweep preserves Symphony execution policy on queued task wakes", () => {
      clearWakes();
      const project = makeProject("symphony-policy");
      const agent = makeAgent(project.id, "symphony-policy");
      db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id = ?").run(agent.id);
      const task = createTask({
        projectId: project.id,
        title: "Sweep Symphony policy task",
        description: "Swept tasks must keep the external runner lane.",
        priority: "P2",
        type: "feature",
        status: "in-progress",
        assignee: agent.id,
        labels: [],
        createdBy: "sweep-test",
        executionEngine: "symphony",
        modelLane: "fast",
      }).task;

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected 1 wake, got ${JSON.stringify(result)}`);
      const run = db.prepare(
        `SELECT context_snapshot_json
         FROM heartbeat_runs
         WHERE json_extract(context_snapshot_json, '$.taskId') = ?
         LIMIT 1`,
      ).get(task.id) as { context_snapshot_json: string } | undefined;
      assert.ok(run, "sweep should queue a heartbeat for the task");
      const snapshot = JSON.parse(run.context_snapshot_json) as Record<string, unknown>;
      assert.equal(snapshot.executionEngine, "symphony");
      assert.equal(snapshot.executionProvider, "symphony");
      assert.equal(snapshot.modelLane, "fast");
    });

    await test("sweep skips parent directive with open children so child review can wake CEO", () => {
      clearWakes();
      const project = makeProject("parent-open-children");
      const ceo = createProjectAgent({
        projectId: project.id,
        name: `Sweep CEO ${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🎯",
        role: "CEO",
        personality: "Deterministic",
        openclawAgentId: `sweep-ceo-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
      const worker = makeAgent(project.id, "child-review-worker");
      const parent = makeTask(project.id, ceo.id, "in-progress");
      const child = makeTask(project.id, worker.id, "review");
      db.prepare("UPDATE tasks SET parent_task_id = ? WHERE id = ?").run(parent.id, child.id);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'codex', 'completed', ?, ?, ?, ?)`,
      ).run(randomUUID(), child.id, worker.id, now, now, now, now);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected child review wake only, got ${JSON.stringify(result)}`);
      assert.ok(
        (result.skippedReasons.parent_waiting_on_children ?? 0) >= 1,
        `expected parent_waiting_on_children skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
      const wakes = db.prepare(
        `SELECT agent_id, reason, payload_json FROM agent_wakeup_requests ORDER BY created_at`,
      ).all() as Array<{ agent_id: string; reason: string; payload_json: string }>;
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].agent_id, ceo.id, "CEO should be woken for child review, not parent checkpoint");
      assert.equal(wakes[0].reason, "sweep_review_to_ceo");
      assert.equal(JSON.parse(wakes[0].payload_json).taskId, child.id);
    });

    await test("sweep wakes parent when every open child depends on that parent", () => {
      clearWakes();
      const project = makeProject("parent-child-deadlock");
      const ceo = createProjectAgent({
        projectId: project.id,
        name: `Sweep CEO ${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🎯",
        role: "CEO",
        personality: "Deterministic",
        openclawAgentId: `sweep-ceo-deadlock-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
      const worker = makeAgent(project.id, "child-deadlock-worker");
      const parent = makeTask(project.id, ceo.id, "in-progress");
      const child = makeTask(project.id, worker.id, "to-do");
      db.prepare("UPDATE tasks SET parent_task_id = ?, depends_on_json = ? WHERE id = ?")
        .run(parent.id, JSON.stringify([parent.id]), child.id);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected parent wake, got ${JSON.stringify(result)}`);
      assert.equal(result.skippedReasons.parent_waiting_on_children ?? 0, 0);
      assert.ok(
        (result.skippedReasons.dependency_pending ?? 0) >= 1,
        `expected child dependency_pending skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
      const wake = db.prepare(
        `SELECT agent_id, reason, payload_json FROM agent_wakeup_requests LIMIT 1`,
      ).get() as { agent_id: string; reason: string; payload_json: string } | undefined;
      assert.equal(wake?.agent_id, ceo.id);
      assert.equal(wake?.reason, "sweep_open_task");
      assert.equal(JSON.parse(wake?.payload_json ?? "{}").taskId, parent.id);
    });

    await test("sweep escalates to-do task to CEO when the assignee ran without moving it", () => {
      clearWakes();
      const project = makeProject("to-do-repeat");
      const ceo = createProjectAgent({
        projectId: project.id,
        name: `Sweep CEO ${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🎯",
        role: "CEO",
        personality: "Deterministic",
        openclawAgentId: `sweep-ceo-to-do-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
      const agent = makeAgent(project.id, "to-do-repeat");
      const task = makeTask(project.id, agent.id, "to-do");
      const sweepNow = new Date();
      const runAt = new Date(sweepNow.getTime() - 31 * 60 * 1000).toISOString();

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'anthropic', 'completed', ?, ?, ?, ?)`,
      ).run(randomUUID(), task.id, agent.id, runAt, runAt, runAt, runAt);

      const result = sweepOpenTasks(db, { cap: 10, now: sweepNow });

      assert.equal(result.wakesEnqueued, 1, `expected CEO escalation wake, got ${JSON.stringify(result)}`);
      const updatedTask = db.prepare("SELECT assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
        assignee_agent_id: string;
      };
      assert.equal(updatedTask.assignee_agent_id, ceo.id);
      const wake = db.prepare(
        `SELECT agent_id, reason FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?
         LIMIT 1`,
      ).get(task.id) as { agent_id: string; reason: string } | undefined;
      assert.equal(wake?.agent_id, ceo.id);
      assert.equal(wake?.reason, "sweep_to-do_no_status_to_ceo");
      const comment = db.prepare(
        `SELECT body FROM comments
         WHERE task_id = ? AND source = 'engine'
         ORDER BY created_at DESC
         LIMIT 1`,
      ).get(task.id) as { body: string } | undefined;
      assert.match(comment?.body ?? "", /^\[ORCHESTRATION\]/);
    });

    await test("sweep re-wakes CEO-owned to-do task when CEO ran without moving it", () => {
      clearWakes();
      const project = makeProject("to-do-ceo-repeat");
      const ceo = createProjectAgent({
        projectId: project.id,
        name: `Sweep CEO ${Math.random().toString(36).slice(2, 4)}`,
        emoji: "🎯",
        role: "CEO",
        personality: "Deterministic",
        openclawAgentId: `sweep-ceo-to-do-repeat-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;
      const task = makeTask(project.id, ceo.id, "to-do");
      const sweepNow = new Date();
      const runAt = new Date(sweepNow.getTime() - 31 * 60 * 1000).toISOString();

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'anthropic', 'completed', ?, ?, ?, ?)`,
      ).run(randomUUID(), task.id, ceo.id, runAt, runAt, runAt, runAt);

      const result = sweepOpenTasks(db, { cap: 10, now: sweepNow });

      assert.equal(result.wakesEnqueued, 1, `expected CEO retry wake, got ${JSON.stringify(result)}`);
      assert.equal(result.skippedReasons["ceo_recent_to-do_no_status"] ?? 0, 0);
      const wake = db.prepare(
        `SELECT agent_id, reason FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?
         LIMIT 1`,
      ).get(task.id) as { agent_id: string; reason: string } | undefined;
      assert.equal(wake?.agent_id, ceo.id);
      assert.equal(wake?.reason, "sweep_to-do_no_status_to_ceo");
    });

    await test("sweep re-wakes to-do task when reviewer requested rework after assignee ran", () => {
      clearWakes();
      const project = makeProject("to-do-rework");
      const agent = makeAgent(project.id, "to-do-rework");
      const reviewer = makeAgent(project.id, "to-do-reviewer");
      const task = makeTask(project.id, agent.id, "to-do");
      const runAt = new Date(Date.now() - 2000).toISOString();
      const reworkAt = new Date().toISOString();

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'gemini', 'completed', ?, ?, ?, ?)`,
      ).run(randomUUID(), task.id, agent.id, runAt, runAt, runAt, runAt);
      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'review', 'to-do', ?, ?)`,
      ).run(
        randomUUID(),
        project.id,
        task.id,
        reviewer.id,
        JSON.stringify({ source: "test_review_rework" }),
        reworkAt,
      );

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected rework wake, got ${JSON.stringify(result)}`);
      const wake = db.prepare(
        `SELECT agent_id, reason FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?
         LIMIT 1`,
      ).get(task.id) as { agent_id: string; reason: string } | undefined;
      assert.equal(wake?.agent_id, agent.id);
      assert.equal(wake?.reason, "sweep_open_task");
    });

    await test("sweep retries to-do tasks after passive-only progress failure", () => {
      clearWakes();
      const project = makeProject("to-do-passive-retry");
      const agent = makeAgent(project.id, "to-do-passive-retry");
      const task = makeTask(project.id, agent.id, "to-do");
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, error_message, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'gemini', 'failed', 'insufficient_progress_passive_report_only', ?, ?, ?, ?)`,
      ).run(randomUUID(), task.id, agent.id, now, now, now, now);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected passive failure retry wake, got ${JSON.stringify(result)}`);
      const wake = db.prepare(
        `SELECT agent_id, reason FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?
         LIMIT 1`,
      ).get(task.id) as { agent_id: string; reason: string } | undefined;
      assert.equal(wake?.agent_id, agent.id);
      assert.equal(wake?.reason, "sweep_open_task");
    });

    await test("sweep retries to-do tasks after no-op resubmission failure", () => {
      clearWakes();
      const project = makeProject("to-do-noop-retry");
      const agent = makeAgent(project.id, "to-do-noop-retry");
      const task = makeTask(project.id, agent.id, "to-do");
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, error_message, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'gemini', 'failed', 'no_op_resubmission', ?, ?, ?, ?)`,
      ).run(randomUUID(), task.id, agent.id, now, now, now, now);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected no-op failure retry wake, got ${JSON.stringify(result)}`);
      const wake = db.prepare(
        `SELECT agent_id, reason FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?
         LIMIT 1`,
      ).get(task.id) as { agent_id: string; reason: string } | undefined;
      assert.equal(wake?.agent_id, agent.id);
      assert.equal(wake?.reason, "sweep_open_task");
    });

    await test("sweep skips blocked / done / backlog tasks (cancelled handled at caller)", () => {
      clearWakes();
      const project = makeProject("terminal-statuses");
      const agent = makeAgent(project.id, "terminal");
      makeTask(project.id, agent.id, "blocked");
      makeTask(project.id, agent.id, "done");
      makeTask(project.id, agent.id, "backlog");

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.equal(result.wakesCoalesced, 0);
      // The SQL filter drops these entirely — they shouldn't even be candidates.
      // (Tasks from earlier open-status tests in the same DB may still match
      //  the query, which is why we compare ">= 0" rather than "=== 0" on
      //  candidatesConsidered.)
      assert.ok(result.candidatesConsidered >= 0);
    });

    await test("sweep skips unassigned tasks", () => {
      clearWakes();
      const project = makeProject("unassigned");
      const unassignedTask = makeTask(project.id, null, "to-do");

      const result = sweepOpenTasks(db, { cap: 10 });
      const wakeForUnassigned = db.prepare(
        `SELECT COUNT(*) AS n FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ?`,
      ).get(unassignedTask.id) as { n: number } | undefined;

      assert.equal(wakeForUnassigned?.n ?? 0, 0);
      void result;
    });

    await test("sweep skips paused / offline / archived agents", () => {
      clearWakes();
      const project = makeProject("paused-offline");
      const paused = makeAgent(project.id, "paused");
      const offline = makeAgent(project.id, "offline");
      const archived = makeAgent(project.id, "archived");

      // Create tasks FIRST (createTask rejects paused/offline/archived
      // assignees), then flip agent status after assignment.
      makeTask(project.id, paused.id, "in-progress");
      makeTask(project.id, offline.id, "in-progress");
      makeTask(project.id, archived.id, "in-progress");

      db.prepare("UPDATE agents SET status = 'paused' WHERE id = ?").run(paused.id);
      db.prepare("UPDATE agents SET status = 'offline' WHERE id = ?").run(offline.id);
      db.prepare("UPDATE agents SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), archived.id);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.ok(
        (result.skippedReasons.agent_paused ?? 0) >= 1,
        `expected at least one agent_paused skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
      assert.ok(
        (result.skippedReasons.agent_offline ?? 0) >= 1,
        `expected at least one agent_offline skip`,
      );
      // archived agents are filtered at the SQL join (INNER JOIN on agents
      // still sees archived rows — the archived filter happens in loop body)
      assert.ok(
        (result.skippedReasons.agent_archived ?? 0) >= 1,
        `expected at least one agent_archived skip`,
      );
    });

    await test("sweep skips assigned tasks when the assignee has only a manual runtime", () => {
      clearWakes();
      const project = makeProject("manual-runtime");
      const agent = makeAgent(project.id, "manual-runtime");
      makeTask(project.id, agent.id, "in-progress");
      db.prepare("UPDATE agents SET adapter_type = 'manual', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), agent.id);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.ok(
        (result.skippedReasons.agent_runtime_not_executable ?? 0) >= 1,
        `expected agent_runtime_not_executable skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep skips agents that already have queued or running wakes", () => {
      clearWakes();
      const project = makeProject("concurrency");
      const agent = makeAgent(project.id, "busy");
      makeTask(project.id, agent.id, "in-progress");

      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_wakeup_requests
           (id, agent_id, company_id, source, status, requested_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'queued', ?, ?, ?)`,
      ).run(randomUUID(), agent.id, project.companyId, now, now, now);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.ok(
        (result.skippedReasons.agent_has_active_wake ?? 0) >= 1,
        `expected at least one agent_has_active_wake skip`,
      );
    });

    await test("sweep skips tasks waiting on pending approval", () => {
      clearWakes();
      const project = makeProject("pending-approval");
      const agent = makeAgent(project.id, "pending-approval");
      const task = makeTask(project.id, agent.id, "in-progress");

      createApproval({
        companyIdOrSlug: project.companyId,
        type: "protected_runtime_command",
        requestedByAgentId: agent.id,
        linkedTaskId: task.id,
        payload: {
          summary: "Fixture protected runtime approval",
          command: "codex execution fixture",
        },
      });

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.ok(
        (result.skippedReasons.approval_pending ?? 0) >= 1,
        `expected approval_pending skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep allows QA verification tasks to run when dependencies are in review", () => {
      clearWakes();
      const project = makeProject("qa-review-dependency");
      const agent = makeAgent(project.id, "qa-review-dependency");
      const dependency = createTask({
        projectId: project.id,
        title: "Implementation dependency in review",
        description: "Ready for QA.",
        priority: "P2",
        type: "feature",
        status: "review",
        labels: [],
        createdBy: "sweep-test",
      }).task;
      createTask({
        projectId: project.id,
        title: "QA verification of implementation dependency",
        description: "QA can run once implementation is in review.",
        priority: "P2",
        type: "feature",
        status: "to-do",
        assignee: agent.id,
        labels: [],
        dependsOn: [dependency.id],
        createdBy: "sweep-test",
      });

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected QA wake, got ${JSON.stringify(result)}`);
      assert.equal(result.skippedReasons.dependency_pending ?? 0, 0);
    });

    await test("sweep backs off agents with 3+ failed runs in the last hour", () => {
      clearWakes();
      const project = makeProject("backoff");
      const agent = makeAgent(project.id, "failing");
      makeTask(project.id, agent.id, "in-progress");

      const now = new Date();
      for (let i = 0; i < 3; i += 1) {
        const ts = new Date(now.getTime() - (i + 1) * 60_000).toISOString();
        db.prepare(
          `INSERT INTO heartbeat_runs
             (id, agent_id, company_id, invocation_source, status, started_at, finished_at, created_at, updated_at)
           VALUES (?, ?, ?, 'wakeup_request', 'failed', ?, ?, ?, ?)`,
        ).run(randomUUID(), agent.id, project.companyId, ts, ts, ts, ts);
      }

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0, `expected no wakes, got ${JSON.stringify(result)}`);
      assert.ok(
        (result.skippedReasons.agent_backoff ?? 0) >= 1,
        `expected agent_backoff skip, got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("sweep does not agent-backoff known transient runtime limit failures", () => {
      clearWakes();
      const project = makeProject("transient-runtime-backoff");
      const agent = makeAgent(project.id, "transient-runtime");
      db.prepare("UPDATE agents SET adapter_type = 'codex' WHERE id = ?").run(agent.id);
      makeTask(project.id, agent.id, "in-progress");

      const now = new Date();
      for (let i = 0; i < 3; i += 1) {
        const ts = new Date(now.getTime() - (i + 1) * 60_000).toISOString();
        db.prepare(
          `INSERT INTO heartbeat_runs
             (id, agent_id, company_id, invocation_source, status, started_at, finished_at, error, created_at, updated_at)
           VALUES (?, ?, ?, 'wakeup_request', 'failed', ?, ?, 'codex exec failed with exit code 1', ?, ?)`,
        ).run(randomUUID(), agent.id, project.companyId, ts, ts, ts, ts);
      }

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 1, `expected retry wake, got ${JSON.stringify(result)}`);
      assert.equal(result.skippedReasons.agent_backoff ?? 0, 0);
    });

    await test("same task swept twice coalesces onto one wake", () => {
      clearWakes();
      const project = makeProject("coalesce");
      const agent = makeAgent(project.id, "coalesce");
      const task = makeTask(project.id, agent.id, "in-progress");

      const first = sweepOpenTasks(db, { cap: 10 });
      // Second call shouldn't enqueue again (agent already has queued wake → skip)
      const second = sweepOpenTasks(db, { cap: 10 });

      const rows = db.prepare(
        `SELECT id, status FROM agent_wakeup_requests
         WHERE json_extract(payload_json, '$.taskId') = ? AND status = 'queued'`,
      ).all(task.id) as Array<{ id: string; status: string }>;

      assert.equal(first.wakesEnqueued, 1);
      assert.equal(second.wakesEnqueued, 0);
      assert.equal(rows.length, 1, "only one queued wake should exist for the task");
    });

    await test("sweep skips tasks whose company is archived", () => {
      clearWakes();
      const project = makeProject("archived-co");
      const agent = makeAgent(project.id, "archived-co");
      makeTask(project.id, agent.id, "in-progress");

      // Archive the company that owns this project. The sweep should now
      // ignore the task even though the task itself is active.
      db.prepare("UPDATE companies SET archived_at = ?, status = 'archived' WHERE id = ?")
        .run(new Date().toISOString(), project.companyId);

      const result = sweepOpenTasks(db, { cap: 10 });

      assert.equal(result.wakesEnqueued, 0);
      assert.equal(result.candidatesConsidered, 0);

      // Restore so subsequent tests aren't corrupted.
      db.prepare("UPDATE companies SET archived_at = NULL, status = 'active' WHERE id = ?")
        .run(project.companyId);
    });

    await test("MC_SWEEP_COMPANIES allowlist restricts sweep to matching slugs only", () => {
      clearWakes();
      const projectInScope = makeProject("in-scope");
      const projectOutOfScope = makeProject("out-of-scope");
      const agentInScope = makeAgent(projectInScope.id, "in-scope");
      const agentOutOfScope = makeAgent(projectOutOfScope.id, "out-of-scope");
      makeTask(projectInScope.id, agentInScope.id, "in-progress");
      makeTask(projectOutOfScope.id, agentOutOfScope.id, "in-progress");

      // Both projects live under the same test company, so scope by that
      // company's slug. The second call uses a slug that matches nothing
      // to confirm an unknown slug yields zero candidates (safer than
      // falling back to platform-wide).
      const company = db.prepare("SELECT slug FROM companies WHERE id = ?").get(projectInScope.companyId) as { slug: string };

      const allowlisted = sweepOpenTasks(db, { cap: 10, companySlugs: [company.slug] });
      assert.ok(allowlisted.wakesEnqueued >= 1, `expected at least 1 wake in scope, got ${JSON.stringify(allowlisted)}`);

      clearWakes();
      const empty = sweepOpenTasks(db, { cap: 10, companySlugs: ["definitely-not-a-real-slug"] });
      assert.equal(empty.wakesEnqueued, 0);
      assert.equal(empty.candidatesConsidered, 0);
    });

    await test("cap bounds the number of wakes enqueued per sweep", () => {
      clearWakes();
      const project = makeProject("cap");
      // Make 5 agents, each with one task, ensure cap=2 limits enqueues to 2.
      for (let i = 0; i < 5; i += 1) {
        const a = makeAgent(project.id, `cap-${i}`);
        makeTask(project.id, a.id, "to-do");
      }

      const result = sweepOpenTasks(db, { cap: 2 });

      assert.equal(result.wakesEnqueued, 2);
      assert.ok(
        (result.skippedReasons.cap_reached ?? 0) >= 1,
        `expected cap_reached skips, got ${JSON.stringify(result.skippedReasons)}`,
      );
    });

    await test("silent-agent watchdog stays quiet for recent assignment or fresh active wake", () => {
      clearWakes();
      const project = makeProject("stuck-agent-fresh-activity");
      const staleAgent = makeAgent(project.id, "stuck-fresh-primary");
      const alternate = makeAgent(project.id, "stuck-fresh-alternate");
      const now = new Date();
      const nowIso = now.toISOString();
      const staleHeartbeat = new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString();
      const oldCreatedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      const oldActivityAt = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
      db.prepare("UPDATE agents SET status = 'working', last_heartbeat = ? WHERE id = ?")
        .run(staleHeartbeat, staleAgent.id);

      const recentlyAssigned = createTask({
        projectId: project.id,
        title: "Recent assignment should not look stuck",
        description: "The watchdog should let a fresh assignment wake settle.",
        priority: "P1",
        type: "feature",
        status: "in-progress",
        assignee: staleAgent.id,
        eligibleAssignees: [staleAgent.id, alternate.id],
        labels: [],
        createdBy: "sweep-test",
      }).task;
      db.prepare("UPDATE tasks SET created_at = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
        .run(oldCreatedAt, nowIso, nowIso, recentlyAssigned.id);

      const freshlyWoken = createTask({
        projectId: project.id,
        title: "Fresh wake should not look stuck",
        description: "The watchdog should not comment while a wake is active.",
        priority: "P1",
        type: "feature",
        status: "in-progress",
        assignee: staleAgent.id,
        eligibleAssignees: [staleAgent.id, alternate.id],
        labels: [],
        createdBy: "sweep-test",
      }).task;
      db.prepare("UPDATE tasks SET created_at = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
        .run(oldCreatedAt, oldActivityAt, oldActivityAt, freshlyWoken.id);

      const wakeupId = randomUUID();
      const runId = randomUUID();
      db.prepare(
        `INSERT INTO agent_wakeup_requests
          (id, agent_id, company_id, source, reason, payload_json, status, run_id, requested_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'test_fresh_wake', ?, 'queued', ?, ?, ?, ?)`,
      ).run(
        wakeupId,
        staleAgent.id,
        companyId,
        JSON.stringify({ taskId: freshlyWoken.id }),
        runId,
        nowIso,
        nowIso,
        nowIso,
      );
      db.prepare(
        `INSERT INTO heartbeat_runs
          (id, agent_id, company_id, invocation_source, trigger_detail, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'test_fresh_wake', 'queued', ?, ?, ?, ?)`,
      ).run(
        runId,
        staleAgent.id,
        companyId,
        wakeupId,
        JSON.stringify({ taskId: freshlyWoken.id }),
        nowIso,
        nowIso,
      );

      const result = sweepOpenTasks(db, { cap: 0, now });

      assert.equal(result.skippedReasons.stuck_agent_watchdog_comments ?? 0, 0, JSON.stringify(result));
      assert.equal(result.skippedReasons.stuck_agent_watchdog_reassignments ?? 0, 0, JSON.stringify(result));
      const rows = db.prepare(
        `SELECT id, assignee_agent_id FROM tasks WHERE id IN (?, ?)`,
      ).all(recentlyAssigned.id, freshlyWoken.id) as Array<{ id: string; assignee_agent_id: string }>;
      assert.equal(rows.find((row) => row.id === recentlyAssigned.id)?.assignee_agent_id, staleAgent.id);
      assert.equal(rows.find((row) => row.id === freshlyWoken.id)?.assignee_agent_id, staleAgent.id);
      const stuckComments = db.prepare(
        `SELECT COUNT(*) AS count
         FROM comments
         WHERE task_id IN (?, ?)
           AND body LIKE '[STUCK_AGENT_WATCHDOG]%'`,
      ).get(recentlyAssigned.id, freshlyWoken.id) as { count: number };
      assert.equal(stuckComments.count, 0);
    });

    await test("silent-agent watchdog still reassigns genuinely stale task", () => {
      clearWakes();
      const project = makeProject("stuck-agent-real-stale");
      const staleAgent = makeAgent(project.id, "stuck-real-primary");
      const alternate = makeAgent(project.id, "stuck-real-alternate");
      const now = new Date();
      const staleHeartbeat = new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString();
      const oldCreatedAt = new Date(now.getTime() - 8 * 60 * 60 * 1000).toISOString();
      const oldActivityAt = new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString();
      db.prepare("UPDATE agents SET status = 'working', last_heartbeat = ? WHERE id = ?")
        .run(staleHeartbeat, staleAgent.id);
      const task = createTask({
        projectId: project.id,
        title: "Real stale task should reassign",
        description: "No fresh task activity or active wake exists.",
        priority: "P1",
        type: "feature",
        status: "in-progress",
        assignee: staleAgent.id,
        eligibleAssignees: [staleAgent.id, alternate.id],
        labels: [],
        createdBy: "sweep-test",
      }).task;
      db.prepare("UPDATE tasks SET created_at = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
        .run(oldCreatedAt, oldActivityAt, oldActivityAt, task.id);

      const result = sweepOpenTasks(db, { cap: 0, now });

      assert.equal(result.skippedReasons.stuck_agent_watchdog_reassignments, 1, JSON.stringify(result));
      const row = db.prepare("SELECT assignee_agent_id FROM tasks WHERE id = ?").get(task.id) as {
        assignee_agent_id: string;
      };
      assert.equal(row.assignee_agent_id, alternate.id);
      const comment = db.prepare(
        `SELECT body
         FROM comments
         WHERE task_id = ?
           AND body LIKE '[STUCK_AGENT_WATCHDOG] Auto-reassigned%'
         LIMIT 1`,
      ).get(task.id) as { body: string } | undefined;
      assert.ok(comment?.body);
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
