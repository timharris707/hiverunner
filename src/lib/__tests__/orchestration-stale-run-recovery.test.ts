/**
 * Contract test for stale heartbeat recovery clearing execution truth.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-stale-run-recovery.db
 * npx tsx src/lib/__tests__/orchestration-stale-run-recovery.test.ts
 */

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

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

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code !== "ESRCH";
  }
}

function missingPidFixture(): number {
  const candidates = [2147483647, 1073741823, 999999999, 99999999, 9999999];
  const missing = candidates.find((pid) => !pidIsAlive(pid));
  assert.ok(missing, "expected at least one high fake PID to be missing");
  return missing;
}

console.log("\nOrchestration Stale Run Recovery Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const originalSweepSetting = process.env.MC_ORCHESTRATION_SWEEP;
  const originalHeartbeatTimeout = process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS;
  const originalDevExecutionTestMode = process.env.MC_DEV_EXECUTION_TEST_MODE;
  const originalPort = process.env.PORT;
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.MC_ORCHESTRATION_SWEEP = "0";
  process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS = String(25 * 60 * 1000);
  process.env.MC_DEV_EXECUTION_TEST_MODE = "1";
  process.env.PORT = "3010";
  process.env.NODE_ENV = "development";
  try {
    if (dbPath) rmSync(dbPath, { force: true });

    await test("tick() times out stale heartbeat runs and clears active execution truth", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const { createProject, createProjectAgent, createTask, listCompanyAgents } = await import("@/lib/orchestration/service");
      const { tick } = await import("@/lib/orchestration/engine/engine");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Stale Recovery ${Date.now()}`,
        description: "Stale recovery fixture",
        color: "#0ea5e9",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Recovery Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🛠️",
        role: "Backend Engineer",
        personality: "Reliable",
        openclawAgentId: `recovery-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "working",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Recover stale execution run",
        description: "Disposable stale-run fixture.",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["stale-recovery"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const staleStartedAt = new Date(Date.now() - 26 * 60 * 1000).toISOString();
      const staleRunId = randomUUID();
      const executionRunId = randomUUID();

      db.prepare(
        `UPDATE tasks
         SET execution_mode = 'openclaw', execution_session_id = ?, updated_at = ?
         WHERE id = ?`
      ).run("session-stale-123", new Date().toISOString(), task.id);

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'openclaw', 'running', ?, ?, ?)`
      ).run(executionRunId, task.id, agent.id, staleStartedAt, staleStartedAt, staleStartedAt);

      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, status, started_at, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'running', ?, ?, ?, ?)`
      ).run(
        staleRunId,
        agent.id,
        project.companyId,
        staleStartedAt,
        JSON.stringify({ taskId: task.id, taskStatus: "in_progress" }),
        staleStartedAt,
        staleStartedAt,
      );

      const tickResult = await tick(db);
      assert.strictEqual(tickResult.staleRunsRecovered, 1);
      assert.strictEqual(tickResult.claimed, false);

      const heartbeatRow = db.prepare(
        `SELECT status, error FROM heartbeat_runs WHERE id = ? LIMIT 1`
      ).get(staleRunId) as { status: string; error: string | null } | undefined;
      assert.strictEqual(heartbeatRow?.status, "timed_out");
      assert.match(heartbeatRow?.error ?? "", /Timed out/);

      const execRow = db.prepare(
        `SELECT status, error_message, completed_at FROM execution_runs WHERE id = ? LIMIT 1`
      ).get(executionRunId) as { status: string; error_message: string | null; completed_at: string | null } | undefined;
      assert.strictEqual(execRow?.status, "failed");
      assert.match(execRow?.error_message ?? "", /Timed out/);
      assert.ok(execRow?.completed_at);

      const taskRow = db.prepare(
        `SELECT execution_session_id FROM tasks WHERE id = ? LIMIT 1`
      ).get(task.id) as { execution_session_id: string | null } | undefined;
      assert.strictEqual(taskRow?.execution_session_id, null);

      const refreshedAgent = listCompanyAgents(project.companyId, { includeNonProduction: true }).agents.find((candidate) => candidate.id === agent.id);
      assert.ok(refreshedAgent);
      assert.strictEqual(refreshedAgent?.status, "idle");
    });

    await test("tick() cancels stale pending execution runs that never started", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
      const { tick } = await import("@/lib/orchestration/engine/engine");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Pending Recovery ${Date.now()}`,
        description: "Pending recovery fixture",
        color: "#f97316",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Pending Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🛠️",
        role: "Runtime Tester",
        personality: "Reliable",
        openclawAgentId: `pending-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Recover stale pending execution run",
        description: "Disposable pending-run fixture.",
        priority: "P2",
        type: "infrastructure",
        status: "done",
        assignee: agent.id,
        labels: ["stale-recovery"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const staleCreatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
      const executionRunId = randomUUID();

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, status, created_at, updated_at)
         VALUES (?, ?, ?, 'symphony', 'pending', ?, ?)`
      ).run(executionRunId, task.id, agent.id, staleCreatedAt, staleCreatedAt);

      const tickResult = await tick(db);
      assert.strictEqual(tickResult.staleExecutionRunsRecovered, 1);
      assert.strictEqual(tickResult.claimed, false);

      const execRow = db.prepare(
        `SELECT status, error_message, completed_at FROM execution_runs WHERE id = ? LIMIT 1`
      ).get(executionRunId) as { status: string; error_message: string | null; completed_at: string | null } | undefined;
      assert.strictEqual(execRow?.status, "cancelled");
      assert.match(execRow?.error_message ?? "", /not started|terminal status/);
      assert.ok(execRow?.completed_at);

      const timeoutComments = db.prepare(
        `SELECT COUNT(*) AS count
           FROM comments
          WHERE task_id = ?
            AND source = 'symphony'
            AND body LIKE '%execution run was not started%'`
      ).get(task.id) as { count: number };
      assert.strictEqual(timeoutComments.count, 0);
    });

    await test("sweepOpenTasks() fails running execution runs whose process PID is gone", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
      const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Missing PID Recovery ${Date.now()}`,
        description: "Missing process recovery fixture",
        color: "#ef4444",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Missing PID Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🛠️",
        role: "Runtime Tester",
        personality: "Reliable",
        openclawAgentId: `missing-pid-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "working",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Repair missing execution process",
        description: "Disposable missing-process fixture.",
        priority: "P1",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["stale-recovery"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const now = new Date().toISOString();
      const wakeupId = randomUUID();
      const heartbeatRunId = randomUUID();
      const executionRunId = randomUUID();
      const missingPid = missingPidFixture();

      db.prepare(
        `UPDATE tasks
         SET execution_session_id = ?, updated_at = ?
         WHERE id = ?`
      ).run("session-missing-pid", now, task.id);

      db.prepare(
        `INSERT INTO agent_wakeup_requests
           (id, agent_id, company_id, source, reason, payload_json, status, idempotency_key, run_id, requested_at, claimed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'stale_process_test', ?, 'claimed', ?, ?, ?, ?, ?, ?)`
      ).run(
        wakeupId,
        agent.id,
        project.companyId,
        JSON.stringify({ taskId: task.id }),
        `sweep:${task.id}:in_progress`,
        heartbeatRunId,
        now,
        now,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, trigger_detail, status, started_at, wakeup_request_id, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'stale_process_test', 'running', ?, ?, ?, ?, ?)`
      ).run(
        heartbeatRunId,
        agent.id,
        project.companyId,
        now,
        wakeupId,
        JSON.stringify({ taskId: task.id, taskStatus: "in_progress" }),
        now,
        now,
      );

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, execution_engine, runner_provider, status, session_id, started_at, token_usage_json, idempotency_key, process_pid, created_at, updated_at)
         VALUES (?, ?, ?, 'symphony', 'symphony', 'symphony', 'running', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        executionRunId,
        task.id,
        agent.id,
        "session-missing-pid",
        now,
        JSON.stringify({ heartbeatRunId }),
        `execution:${task.id}:missing-pid`,
        missingPid,
        now,
        now,
      );

      const result = sweepOpenTasks(db, { cap: 0 });
      assert.strictEqual(result.skippedReasons.stale_process_missing, 1);

      const execRow = db.prepare(
        `SELECT status, error_message, failure_class, process_pid, completed_at, idempotency_key, metadata_json
         FROM execution_runs WHERE id = ? LIMIT 1`
      ).get(executionRunId) as {
        status: string;
        error_message: string | null;
        failure_class: string | null;
        process_pid: number | null;
        completed_at: string | null;
        idempotency_key: string | null;
        metadata_json: string | null;
      } | undefined;
      assert.strictEqual(execRow?.status, "failed");
      assert.match(execRow?.error_message ?? "", /process is no longer alive/);
      assert.strictEqual(execRow?.failure_class, "stale_process_missing");
      assert.strictEqual(execRow?.process_pid, null);
      assert.ok(execRow?.completed_at);
      assert.strictEqual(execRow?.idempotency_key, null);
      const execMetadata = JSON.parse(execRow?.metadata_json ?? "{}") as {
        heartbeatRunId?: string | null;
        staleProcessRepair?: {
          recordedPid?: number | null;
          heartbeatRunId?: string | null;
          likelyAppRestart?: boolean;
          reason?: string;
        };
      };
      assert.strictEqual(execMetadata.heartbeatRunId, heartbeatRunId);
      assert.strictEqual(execMetadata.staleProcessRepair?.reason, "stale_process_missing");
      assert.strictEqual(execMetadata.staleProcessRepair?.recordedPid, missingPid);
      assert.strictEqual(execMetadata.staleProcessRepair?.heartbeatRunId, heartbeatRunId);
      assert.strictEqual(execMetadata.staleProcessRepair?.likelyAppRestart, true);

      const heartbeatRow = db.prepare(
        `SELECT status, error, finished_at FROM heartbeat_runs WHERE id = ? LIMIT 1`
      ).get(heartbeatRunId) as { status: string; error: string | null; finished_at: string | null } | undefined;
      assert.strictEqual(heartbeatRow?.status, "failed");
      assert.match(heartbeatRow?.error ?? "", /process is no longer alive/);
      assert.ok(heartbeatRow?.finished_at);

      const wakeupRow = db.prepare(
        `SELECT status, finished_at, idempotency_key FROM agent_wakeup_requests WHERE id = ? LIMIT 1`
      ).get(wakeupId) as { status: string; finished_at: string | null; idempotency_key: string | null } | undefined;
      assert.strictEqual(wakeupRow?.status, "failed");
      assert.ok(wakeupRow?.finished_at);
      assert.strictEqual(wakeupRow?.idempotency_key, null);

      const taskRow = db.prepare(
        `SELECT execution_session_id FROM tasks WHERE id = ? LIMIT 1`
      ).get(task.id) as { execution_session_id: string | null } | undefined;
      assert.strictEqual(taskRow?.execution_session_id, null);

      const agentRow = db.prepare(
        `SELECT status, current_task_id FROM agents WHERE id = ? LIMIT 1`
      ).get(agent.id) as { status: string; current_task_id: string | null } | undefined;
      assert.strictEqual(agentRow?.status, "idle");
      assert.strictEqual(agentRow?.current_task_id, null);

      const comment = db.prepare(
        `SELECT body, type, source
         FROM comments
         WHERE task_id = ?
           AND external_ref = ?
         LIMIT 1`
      ).get(task.id, `engine:stale_process_missing:${executionRunId}`) as { body: string; type: string; source: string } | undefined;
      assert.ok(comment, "expected stale process repair comment");
      assert.strictEqual(comment?.type, "status_update");
      assert.strictEqual(comment?.source, "engine");
      assert.match(comment?.body ?? "", /Stale execution repaired/);
    });

    await test("sweepOpenTasks() replaces stale claimed review wakes for the current reviewer", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
      const { updateDevExecutionTestMode } = await import("@/lib/orchestration/service/dev-execution-test-mode");
      const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");
      const { __testHooks } = await import("@/lib/orchestration/engine/engine");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Review Stale Repair ${Date.now()}`,
        description: "Review stale repair fixture",
        color: "#6366f1",
        emoji: "R",
        status: "active",
      }).project;

      const producer = createProjectAgent({
        projectId: project.id,
        name: `Review Producer ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "P",
        role: "Builder",
        personality: "Reliable",
        openclawAgentId: `review-producer-${Math.random().toString(36).slice(2, 8)}`,
        status: "idle",
        skills: ["orchestration"],
      }).agent;

      const reviewer = createProjectAgent({
        projectId: project.id,
        name: `Review Repairer ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "Q",
        role: "QA",
        personality: "Reliable",
        openclawAgentId: `review-repairer-${Math.random().toString(36).slice(2, 8)}`,
        status: "working",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Repair stale review execution wake",
        description: "Disposable review stale-process fixture.",
        priority: "P1",
        type: "review",
        status: "review",
        assignee: reviewer.id,
        labels: ["stale-recovery", "review"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      updateDevExecutionTestMode({
        companyIdOrSlug: project.companyId,
        enabled: true,
        durationMinutes: 15,
        actor: "stale-run-recovery-test",
      }, db);
      const now = new Date().toISOString();
      const submissionAt = new Date(Date.now() - 60_000).toISOString();
      const wakeupId = randomUUID();
      const heartbeatRunId = randomUUID();
      const historicalFailedWakeId = randomUUID();
      const historicalFailedHeartbeatId = randomUUID();
      const executionRunId = randomUUID();
      const missingPid = missingPidFixture();
      const staleReviewAssigneeKey = `review_assignee:${task.id}:${reviewer.id}`;

      db.prepare(
        `INSERT INTO task_events
           (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.status_changed', 'in_progress', 'review', ?, ?)`,
      ).run(
        randomUUID(),
        project.id,
        task.id,
        producer.id,
        JSON.stringify({ source: "test_review_submission" }),
        submissionAt,
      );

      db.prepare(
        `INSERT INTO agent_wakeup_requests
           (id, agent_id, company_id, source, reason, payload_json, status, idempotency_key, run_id, requested_at, claimed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'sweep_review_to_assignee', ?, 'claimed', ?, ?, ?, ?, ?, ?)`,
      ).run(
        wakeupId,
        reviewer.id,
        project.companyId,
        JSON.stringify({ taskId: task.id, taskStatus: "review" }),
        staleReviewAssigneeKey,
        heartbeatRunId,
        now,
        now,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, trigger_detail, status, started_at, wakeup_request_id, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'sweep_review_to_assignee', 'running', ?, ?, ?, ?, ?)`,
      ).run(
        heartbeatRunId,
        reviewer.id,
        project.companyId,
        now,
        wakeupId,
        JSON.stringify({ taskId: task.id, taskStatus: "review" }),
        now,
        now,
      );

      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, trigger_detail, status, finished_at, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'older_failed_review_wake', 'failed', ?, ?, ?, ?)`,
      ).run(
        historicalFailedHeartbeatId,
        reviewer.id,
        project.companyId,
        submissionAt,
        JSON.stringify({ taskId: task.id, taskStatus: "review" }),
        submissionAt,
        submissionAt,
      );

      db.prepare(
        `INSERT INTO agent_wakeup_requests
           (id, agent_id, company_id, source, reason, payload_json, status, idempotency_key, run_id, requested_at, finished_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'older_failed_review_wake', ?, 'failed', NULL, ?, ?, ?, ?, ?)`,
      ).run(
        historicalFailedWakeId,
        reviewer.id,
        project.companyId,
        JSON.stringify({ taskId: task.id, taskStatus: "review" }),
        historicalFailedHeartbeatId,
        submissionAt,
        submissionAt,
        submissionAt,
        submissionAt,
      );

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, execution_engine, runner_provider, status, session_id, started_at, token_usage_json, idempotency_key, process_pid, created_at, updated_at)
         VALUES (?, ?, ?, 'symphony', 'symphony', 'symphony', 'running', ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        executionRunId,
        task.id,
        reviewer.id,
        "session-review-missing-pid",
        now,
        JSON.stringify({ heartbeatRunId }),
        `execution:${task.id}:review-missing-pid`,
        missingPid,
        now,
        now,
      );

      const result = sweepOpenTasks(db, { cap: 0 });
      assert.strictEqual(result.skippedReasons.stale_process_missing, 1);

      const staleWake = db.prepare(
        `SELECT status, idempotency_key
         FROM agent_wakeup_requests
         WHERE id = ?
         LIMIT 1`,
      ).get(wakeupId) as { status: string; idempotency_key: string | null } | undefined;
      assert.strictEqual(staleWake?.status, "failed");
      assert.strictEqual(staleWake?.idempotency_key, null);

      const replacement = db.prepare(
        `SELECT awr.id, awr.status, awr.reason, awr.idempotency_key, awr.run_id, hr.status AS heartbeat_status
         FROM agent_wakeup_requests awr
         INNER JOIN heartbeat_runs hr ON hr.id = awr.run_id
         WHERE awr.agent_id = ?
           AND awr.reason = 'stale_review_execution_repaired'
           AND awr.payload_json LIKE ?
         LIMIT 1`,
      ).get(reviewer.id, `%${executionRunId}%`) as
        | {
            id: string;
            status: string;
            reason: string;
            idempotency_key: string | null;
            run_id: string;
            heartbeat_status: string;
          }
        | undefined;
      assert.ok(replacement, "expected replacement review wake");
      assert.strictEqual(replacement?.status, "queued");
      assert.strictEqual(replacement?.heartbeat_status, "queued");
      assert.strictEqual(
        replacement?.idempotency_key,
        `review_repair:${task.id}:${reviewer.id}:${executionRunId}`,
      );

      const reviewedByStaleFailure = db.prepare(
        `SELECT 1 AS present
         FROM execution_runs
         WHERE task_id = ?
           AND agent_id = ?
           AND status = 'failed'
           AND failure_class = 'stale_process_missing'
         LIMIT 1`,
      ).get(task.id, reviewer.id) as { present: number } | undefined;
      assert.strictEqual(reviewedByStaleFailure?.present, 1);

      const claimed = __testHooks.claimNextQueuedRun(db);
      assert.ok(claimed, "expected replacement wake to be claimable");
      assert.strictEqual(claimed?.id, replacement?.run_id);

      const claimedWake = db.prepare(
        `SELECT status, claimed_at
         FROM agent_wakeup_requests
         WHERE id = ?
         LIMIT 1`,
      ).get(replacement?.id) as { status: string; claimed_at: string | null } | undefined;
      assert.strictEqual(claimedWake?.status, "claimed");
      assert.ok(claimedWake?.claimed_at);
    });

    await test("sweepOpenTasks() leaves running execution runs with live process PIDs alone", async () => {
      const { getOrchestrationDb } = await import("@/lib/orchestration/db");
      const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
      const { sweepOpenTasks } = await import("@/lib/orchestration/engine/sweeper");

      const project = createProject({
        companyId: "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f",
        name: `Live PID Guard ${Date.now()}`,
        description: "Live process guard fixture",
        color: "#22c55e",
        emoji: "🧪",
        status: "active",
      }).project;

      const agent = createProjectAgent({
        projectId: project.id,
        name: `Live PID Agent ${Math.random().toString(36).slice(2, 6)}`,
        emoji: "🛠️",
        role: "Runtime Tester",
        personality: "Reliable",
        openclawAgentId: `live-pid-agent-${Math.random().toString(36).slice(2, 8)}`,
        status: "working",
        skills: ["orchestration"],
      }).agent;

      const task = createTask({
        projectId: project.id,
        title: "Keep live execution process",
        description: "Disposable live-process fixture.",
        priority: "P2",
        type: "infrastructure",
        status: "in-progress",
        assignee: agent.id,
        labels: ["stale-recovery"],
        createdBy: "test-suite",
      }).task;

      const db = getOrchestrationDb();
      const now = new Date().toISOString();
      const wakeupId = randomUUID();
      const heartbeatRunId = randomUUID();
      const executionRunId = randomUUID();

      db.prepare(
        `INSERT INTO agent_wakeup_requests
           (id, agent_id, company_id, source, reason, payload_json, status, idempotency_key, run_id, requested_at, claimed_at, created_at, updated_at)
         VALUES (?, ?, ?, 'api', 'live_process_test', ?, 'claimed', ?, ?, ?, ?, ?, ?)`
      ).run(
        wakeupId,
        agent.id,
        project.companyId,
        JSON.stringify({ taskId: task.id }),
        `sweep:${task.id}:in_progress`,
        heartbeatRunId,
        now,
        now,
        now,
        now,
      );

      db.prepare(
        `INSERT INTO heartbeat_runs
           (id, agent_id, company_id, invocation_source, trigger_detail, status, started_at, wakeup_request_id, context_snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 'wakeup_request', 'live_process_test', 'running', ?, ?, ?, ?, ?)`
      ).run(
        heartbeatRunId,
        agent.id,
        project.companyId,
        now,
        wakeupId,
        JSON.stringify({ taskId: task.id, taskStatus: "in_progress" }),
        now,
        now,
      );

      db.prepare(
        `INSERT INTO execution_runs
           (id, task_id, agent_id, provider, execution_engine, runner_provider, status, session_id, started_at, token_usage_json, idempotency_key, process_pid, created_at, updated_at)
         VALUES (?, ?, ?, 'symphony', 'symphony', 'symphony', 'running', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        executionRunId,
        task.id,
        agent.id,
        "session-live-pid",
        now,
        JSON.stringify({ heartbeatRunId }),
        `execution:${task.id}:live-pid`,
        process.pid,
        now,
        now,
      );

      const result = sweepOpenTasks(db, { cap: 0 });
      assert.strictEqual(result.skippedReasons.stale_process_missing ?? 0, 0);

      const execRow = db.prepare(
        `SELECT status, failure_class, process_pid, completed_at, idempotency_key
         FROM execution_runs WHERE id = ? LIMIT 1`
      ).get(executionRunId) as {
        status: string;
        failure_class: string | null;
        process_pid: number | null;
        completed_at: string | null;
        idempotency_key: string | null;
      } | undefined;
      assert.strictEqual(execRow?.status, "running");
      assert.strictEqual(execRow?.failure_class, null);
      assert.strictEqual(execRow?.process_pid, process.pid);
      assert.strictEqual(execRow?.completed_at, null);
      assert.strictEqual(execRow?.idempotency_key, `execution:${task.id}:live-pid`);

      const heartbeatRow = db.prepare(
        `SELECT status, finished_at FROM heartbeat_runs WHERE id = ? LIMIT 1`
      ).get(heartbeatRunId) as { status: string; finished_at: string | null } | undefined;
      assert.strictEqual(heartbeatRow?.status, "running");
      assert.strictEqual(heartbeatRow?.finished_at, null);

      const commentCount = db.prepare(
        `SELECT COUNT(*) AS count
         FROM comments
         WHERE task_id = ?
           AND external_ref = ?`
      ).get(task.id, `engine:stale_process_missing:${executionRunId}`) as { count: number };
      assert.strictEqual(commentCount.count, 0);
    });
  } finally {
    if (originalSweepSetting == null) {
      delete process.env.MC_ORCHESTRATION_SWEEP;
    } else {
      process.env.MC_ORCHESTRATION_SWEEP = originalSweepSetting;
    }
    if (originalHeartbeatTimeout == null) {
      delete process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS;
    } else {
      process.env.MC_HEARTBEAT_RUN_TIMEOUT_MS = originalHeartbeatTimeout;
    }
    if (originalDevExecutionTestMode == null) {
      delete process.env.MC_DEV_EXECUTION_TEST_MODE;
    } else {
      process.env.MC_DEV_EXECUTION_TEST_MODE = originalDevExecutionTestMode;
    }
    if (originalPort == null) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
    if (originalNodeEnv == null) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
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
