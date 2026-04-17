/**
 * Contract test for passive-report history repair.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-passive-report-history-repair.db
 * npx tsx src/lib/__tests__/orchestration-passive-report-history-repair.test.ts
 */

import assert from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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

async function createFixture() {
  const { createProject, createProjectAgent, createTask } = await import("@/lib/orchestration/service");
  const { createCompany } = await import("@/lib/orchestration/company-service");
  const { getOrchestrationDb } = await import("@/lib/orchestration/db");

  const company = createCompany({
    name: `Passive Repair Company ${Date.now()}`,
    description: "Passive report history repair fixture company",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Passive Repair ${Date.now()}`,
    description: "Passive report history repair fixture",
    color: "#ef4444",
    emoji: "🧹",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Repair Agent ${Math.random().toString(36).slice(2, 6)}`,
    emoji: "🛠️",
    role: "Runtime Engineer",
    personality: "Deterministic",
    openclawAgentId: `repair-agent-${Math.random().toString(36).slice(2, 8)}`,
    status: "idle",
    skills: ["orchestration"],
  }).agent;

  const task = createTask({
    projectId: project.id,
    title: "[E2E] Passive report repair fixture",
    description: "Disposable proof task for passive report repair.",
    priority: "P1",
    type: "infrastructure",
    status: "in-progress",
    assignee: agent.id,
    labels: ["e2e", "repair"],
    createdBy: "test-suite",
  }).task;

  const db = getOrchestrationDb();
  return { db, project, agent, task };
}

function seedNoise(input: {
  db: ReturnType<typeof import("@/lib/orchestration/db")["getOrchestrationDb"]>;
  companyId: string;
  agentId: string;
  taskId: string;
  projectId: string;
}) {
  const { db, companyId, agentId, taskId, projectId } = input;
  const now = new Date().toISOString();
  const staleNow = "2026-01-01T00:00:00.000Z";
  const noReplyCommentId = randomUUID();
  const passiveRunId = randomUUID();
  const staleWakeA = randomUUID();
  const staleWakeB = randomUUID();
  const freshWake = randomUUID();
  const staleQueuedWake = randomUUID();
  const staleQueuedRun = randomUUID();
  const freshQueuedRun = randomUUID();
  const taskEventId = randomUUID();
  const heartbeatEventId = randomUUID();

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, status, context_snapshot_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'failed', '{}', '{}', ?, ?)`
  ).run(passiveRunId, agentId, companyId, now, now);

  db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, ?, 'NO_REPLY', 'status_update', 'openclaw', ?, ?, ?)`
  ).run(noReplyCommentId, taskId, agentId, `engine:comment:${taskId.slice(0, 8)}:470f75bfd21486f3`, now, now);

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`
  ).run(taskEventId, projectId, taskId, agentId, JSON.stringify({ source: "engine_heartbeat", runId: passiveRunId }), now);

  db.prepare(
    `INSERT INTO heartbeat_run_events (id, run_id, agent_id, event_type, detail, created_at)
     VALUES (?, ?, ?, 'action_executed', 'Queued continuation wake: continuation_passive_report_only', ?)`
  ).run(heartbeatEventId, passiveRunId, agentId, now);

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, payload_json, status, created_at, updated_at, finished_at)
     VALUES (?, ?, ?, 'api', 'continuation_passive_report_only', '{}', 'failed', ?, ?, ?)`
  ).run(staleWakeA, agentId, companyId, now, now, now);

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, payload_json, status, created_at, updated_at, finished_at)
     VALUES (?, ?, ?, 'api', 'continuation_passive_report_only', '{}', 'finished', ?, ?, ?)`
  ).run(staleWakeB, agentId, companyId, now, now, now);

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, payload_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'api', 'continuation_passive_report_only', '{}', 'queued', ?, ?)`
  ).run(freshWake, agentId, companyId, now, now);

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, status, wakeup_request_id, context_snapshot_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'queued', ?, '{}', '{}', ?, ?)`
  ).run(freshQueuedRun, agentId, companyId, freshWake, now, now);

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, payload_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'api', 'continuation_passive_report_only', '{}', 'queued', ?, ?)`
  ).run(staleQueuedWake, agentId, companyId, staleNow, staleNow);

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, status, wakeup_request_id, context_snapshot_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'queued', ?, '{}', '{}', ?, ?)`
  ).run(staleQueuedRun, agentId, companyId, staleQueuedWake, staleNow, staleNow);

  return { noReplyCommentId, taskEventId, heartbeatEventId, staleWakeA, staleWakeB, freshWake, staleQueuedWake, staleQueuedRun, freshQueuedRun };
}

function seedLegitimateNoReplyComment(input: {
  db: ReturnType<typeof import("@/lib/orchestration/db")["getOrchestrationDb"]>;
  companyId: string;
  agentId: string;
  taskId: string;
  projectId: string;
}) {
  const { db, companyId, agentId, taskId, projectId } = input;
  const now = new Date().toISOString();
  const runId = randomUUID();
  const commentId = randomUUID();
  const taskEventId = randomUUID();

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, status, context_snapshot_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'succeeded', '{}', ?, ?, ?)`
  ).run(
    runId,
    agentId,
    companyId,
    JSON.stringify({ actionsExecuted: 1, reportsImported: 0, errors: [] }),
    now,
    now,
  );

  db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, ?, 'NO_REPLY', 'comment', 'openclaw', ?, ?, ?)`
  ).run(commentId, taskId, agentId, `engine:comment:${taskId.slice(0, 8)}:470f75bfd21486f3`, now, now);

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`
  ).run(taskEventId, projectId, taskId, agentId, JSON.stringify({ source: "engine_heartbeat", runId }), now);

  return { runId, commentId, taskEventId };
}

function seedAmbiguousPassiveAndLegitNoReplyComments(input: {
  db: ReturnType<typeof import("@/lib/orchestration/db")["getOrchestrationDb"]>;
  companyId: string;
  agentId: string;
  taskId: string;
  projectId: string;
}) {
  const { db, companyId, agentId, taskId, projectId } = input;
  const now = new Date().toISOString();
  const passiveRunId = randomUUID();
  const legitRunId = randomUUID();
  const passiveCommentId = randomUUID();
  const legitCommentId = randomUUID();
  const passiveTaskEventId = randomUUID();
  const legitTaskEventId = randomUUID();

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, status, context_snapshot_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'failed', '{}', ?, ?, ?)`
  ).run(
    passiveRunId,
    agentId,
    companyId,
    JSON.stringify({ actionsExecuted: 0, reportsImported: 1, errors: [] }),
    now,
    now,
  );

  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, status, context_snapshot_json, result_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'succeeded', '{}', ?, ?, ?)`
  ).run(
    legitRunId,
    agentId,
    companyId,
    JSON.stringify({ actionsExecuted: 1, reportsImported: 0, errors: [] }),
    now,
    now,
  );

  db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, ?, 'NO_REPLY', 'status_update', 'openclaw', ?, ?, ?)`
  ).run(passiveCommentId, taskId, agentId, `engine:comment:${taskId.slice(0, 8)}:470f75bfd21486f3`, now, now);

  db.prepare(
    `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, ?, 'NO_REPLY', 'comment', 'openclaw', ?, ?, ?)`
  ).run(legitCommentId, taskId, agentId, `engine:comment:${taskId.slice(0, 8)}:470f75bfd21486f3-legit`, now, now);

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`
  ).run(passiveTaskEventId, projectId, taskId, agentId, JSON.stringify({ source: "engine_heartbeat", runId: passiveRunId }), now);

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.comment_added', ?, ?)`
  ).run(legitTaskEventId, projectId, taskId, agentId, JSON.stringify({ source: "engine_heartbeat", runId: legitRunId }), now);

  return { passiveCommentId, legitCommentId, passiveTaskEventId, legitTaskEventId };
}

console.log("\nOrchestration Passive Report History Repair Contract Test\n");

async function run() {
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  const backupRoot = mkdtempSync(path.join(os.tmpdir(), "passive-report-history-repair-"));

  try {
    if (dbPath) rmSync(dbPath, { force: true });

    await test("Dry-run reports passive noise without mutating data", async () => {
      const { inspectPassiveReportHistory, repairPassiveReportHistory } = await import(
        "@/lib/orchestration/repairs/passive-report-history"
      );
      const { db, project, agent, task } = await createFixture();
      seedNoise({ db, companyId: project.companyId, agentId: agent.id, taskId: task.id, projectId: project.id });

      const inspection = inspectPassiveReportHistory(db);
      assert.strictEqual(inspection.noReplyComments.length, 1);
      assert.strictEqual(inspection.noReplyTaskEvents.length, 1);
      assert.strictEqual(inspection.passiveContinuationWakeRows.length, 3);
      assert.strictEqual(inspection.passiveContinuationHeartbeatEvents.length, 1);

      const result = repairPassiveReportHistory({ db, backupDir: backupRoot, apply: false });
      assert.strictEqual(result.applied, false);
      assert.strictEqual(result.summary.noReplyComments, 1);
      assert.strictEqual(result.summary.noReplyTaskEvents, 1);
      assert.strictEqual(result.summary.passiveContinuationWakeRows, 3);
      assert.strictEqual(result.summary.passiveContinuationHeartbeatEvents, 1);

      const commentCount = db.prepare("SELECT COUNT(*) AS count FROM comments WHERE trim(body) = 'NO_REPLY'").get() as { count: number };
      assert.strictEqual(commentCount.count, 1, "dry-run must not delete NO_REPLY comments");
    });

    await test("Apply deletes stale passive noise, preserves active wake rows, and writes a backup artifact", async () => {
      const { inspectPassiveReportHistory, repairPassiveReportHistory } = await import(
        "@/lib/orchestration/repairs/passive-report-history"
      );
      const { db, project, agent, task } = await createFixture();
      const seeded = seedNoise({ db, companyId: project.companyId, agentId: agent.id, taskId: task.id, projectId: project.id });

      const result = repairPassiveReportHistory({
        db,
        backupDir: backupRoot,
        apply: true,
        now: new Date("2026-01-01T00:30:00.000Z"),
      });
      assert.strictEqual(result.applied, true);
      assert.ok(existsSync(result.backupPath), "expected repair backup artifact");

      const backup = JSON.parse(readFileSync(result.backupPath, "utf8")) as {
        noReplyComments: Array<{ id: string }>;
        passiveContinuationWakeRows: Array<{ id: string }>;
        stalePassiveContinuationHeartbeatRuns: Array<{ id: string }>;
      };
      assert.ok(backup.noReplyComments.some((row) => row.id === seeded.noReplyCommentId));
      assert.ok(backup.passiveContinuationWakeRows.some((row) => row.id === seeded.staleWakeA));
      assert.ok(backup.passiveContinuationWakeRows.some((row) => row.id === seeded.staleWakeB));
      assert.ok(backup.passiveContinuationWakeRows.some((row) => row.id === seeded.staleQueuedWake));
      assert.ok(backup.stalePassiveContinuationHeartbeatRuns.some((row) => row.id === seeded.staleQueuedRun));

      const remainingInspection = inspectPassiveReportHistory(db, new Date("2026-01-01T00:30:00.000Z"));
      assert.strictEqual(remainingInspection.noReplyComments.length, 0);
      assert.strictEqual(remainingInspection.noReplyTaskEvents.length, 0);
      assert.strictEqual(remainingInspection.passiveContinuationWakeRows.length, 0);
      assert.strictEqual(remainingInspection.passiveContinuationHeartbeatEvents.length, 0);
      assert.strictEqual(remainingInspection.stalePassiveContinuationHeartbeatRuns.length, 0);

      const freshWake = db.prepare(
        "SELECT status FROM agent_wakeup_requests WHERE id = ? LIMIT 1"
      ).get(seeded.freshWake) as { status: string } | undefined;
      assert.ok(freshWake, "fresh queued wake row should be preserved");
      assert.strictEqual(freshWake?.status, "queued");

      const staleQueuedWake = db.prepare(
        "SELECT status FROM agent_wakeup_requests WHERE id = ? LIMIT 1"
      ).get(seeded.staleQueuedWake) as { status: string } | undefined;
      assert.strictEqual(staleQueuedWake, undefined, "stale queued passive wake row should be removed");

      const staleQueuedRun = db.prepare(
        "SELECT status FROM heartbeat_runs WHERE id = ? LIMIT 1"
      ).get(seeded.staleQueuedRun) as { status: string } | undefined;
      assert.strictEqual(staleQueuedRun, undefined, "stale queued heartbeat run should be removed");

      const freshQueuedRun = db.prepare(
        "SELECT status FROM heartbeat_runs WHERE id = ? LIMIT 1"
      ).get(seeded.freshQueuedRun) as { status: string } | undefined;
      assert.ok(freshQueuedRun, "fresh queued heartbeat run should be preserved");
      assert.strictEqual(freshQueuedRun?.status, "queued");
    });

    await test("Apply preserves legitimate explicit NO_REPLY comments emitted through real actions", async () => {
      const { inspectPassiveReportHistory, repairPassiveReportHistory } = await import(
        "@/lib/orchestration/repairs/passive-report-history"
      );
      const { db, project, agent, task } = await createFixture();
      const legit = seedLegitimateNoReplyComment({
        db,
        companyId: project.companyId,
        agentId: agent.id,
        taskId: task.id,
        projectId: project.id,
      });

      const inspection = inspectPassiveReportHistory(db, new Date("2026-01-01T00:30:00.000Z"));
      assert.strictEqual(inspection.noReplyComments.length, 0, "legitimate NO_REPLY comment must not be flagged as passive noise");

      const result = repairPassiveReportHistory({
        db,
        backupDir: backupRoot,
        apply: true,
        now: new Date("2026-01-01T00:30:00.000Z"),
      });
      assert.strictEqual(result.summary.noReplyComments, 0);

      const preservedComment = db.prepare(
        "SELECT body, type, source FROM comments WHERE id = ? LIMIT 1"
      ).get(legit.commentId) as { body: string; type: string; source: string } | undefined;
      assert.ok(preservedComment, "legitimate NO_REPLY comment should remain after repair");
      assert.strictEqual(preservedComment?.body, "NO_REPLY");
      assert.strictEqual(preservedComment?.type, "comment");
      assert.strictEqual(preservedComment?.source, "openclaw");
    });

    await test("Ambiguous NO_REPLY collisions are skipped instead of deleting legitimate history", async () => {
      const { inspectPassiveReportHistory, repairPassiveReportHistory } = await import(
        "@/lib/orchestration/repairs/passive-report-history"
      );
      const { db, project, agent, task } = await createFixture();
      const seeded = seedAmbiguousPassiveAndLegitNoReplyComments({
        db,
        companyId: project.companyId,
        agentId: agent.id,
        taskId: task.id,
        projectId: project.id,
      });

      const inspection = inspectPassiveReportHistory(db, new Date("2026-01-01T00:30:00.000Z"));
      assert.strictEqual(inspection.noReplyComments.length, 0, "ambiguous NO_REPLY rows should be skipped for safety");
      assert.strictEqual(inspection.noReplyTaskEvents.length, 0, "ambiguous matching task events should not be selected");

      repairPassiveReportHistory({
        db,
        backupDir: backupRoot,
        apply: true,
        now: new Date("2026-01-01T00:30:00.000Z"),
      });

      const remainingPassiveComment = db.prepare(
        "SELECT id FROM comments WHERE id = ? LIMIT 1"
      ).get(seeded.passiveCommentId) as { id: string } | undefined;
      const remainingLegitComment = db.prepare(
        "SELECT id FROM comments WHERE id = ? LIMIT 1"
      ).get(seeded.legitCommentId) as { id: string } | undefined;
      const remainingPassiveEvent = db.prepare(
        "SELECT id FROM task_events WHERE id = ? LIMIT 1"
      ).get(seeded.passiveTaskEventId) as { id: string } | undefined;
      const remainingLegitEvent = db.prepare(
        "SELECT id FROM task_events WHERE id = ? LIMIT 1"
      ).get(seeded.legitTaskEventId) as { id: string } | undefined;

      assert.ok(remainingPassiveComment, "ambiguous passive NO_REPLY comment should be preserved rather than risk over-deletion");
      assert.ok(remainingLegitComment, "legitimate NO_REPLY comment should remain");
      assert.ok(remainingPassiveEvent, "ambiguous passive task event should remain");
      assert.ok(remainingLegitEvent, "legitimate task event should remain");
    });
  } finally {
    rmSync(backupRoot, { force: true, recursive: true });
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
