/**
 * Bundle 4 amendment: Bundle 3 approval wake regression tests.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-bundle3-regression-wakeup.db \
 *   npx tsx src/lib/__tests__/orchestration-bundle3-regression-wakeup.test.ts
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { buildHeartbeatPrompt, executeHeartbeatRun, type TaskSession } from "@/lib/orchestration/engine/engine";
import { sweepOpenTasks } from "@/lib/orchestration/engine/sweeper";
import { backfillApprovalRoutes, createApproval } from "@/lib/orchestration/service/approval";
import { createProject, createProjectAgent, createTask } from "@/lib/orchestration/service";

const { finish, test } = createTestRunner({ passLabel: "✓", failLabel: "✗", errorStackLines: 3 });

async function run() {
  console.log("\nBundle 3 Regression Wakeup Tests\n");
  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);

  const db = getOrchestrationDb();
  const company = createCompany({
    name: `Bundle 4 Wake Regression ${Date.now()}`,
    description: "Approval wake regression fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "Wake Regression Project",
    description: "Approval wake regression fixture",
    color: "#60a5fa",
    emoji: "icon:activity",
    status: "active",
  }).project;
  const approver = createProjectAgent({
    projectId: project.id,
    name: "Ralph",
    emoji: "icon:bot",
    role: "Repo Steward / Release Engineer",
    personality: "Deterministic fixture",
    model: "gemini-3-flash-preview",
    skills: [],
    status: "idle",
  }).agent;
  db.prepare("UPDATE agents SET adapter_type = 'manual' WHERE id = ?").run(approver.id);

  await test("approval wake prompt records injected memory hash without ReferenceError", () => {
    const task = createTask({
      projectId: project.id,
      title: "Approval wake prompt fixture",
      description: "Prompt should include memory and record hash.",
      priority: "P2",
      type: "research",
      status: "to-do",
      assignee: approver.id,
      createdBy: "bundle-4-test",
      labels: [],
      executionEngine: "symphony",
    }).task;
    const executionRunId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO execution_runs
        (id, task_id, agent_id, provider, status, started_at, created_at, updated_at, execution_engine)
       VALUES (?, ?, ?, 'symphony', 'running', ?, ?, ?, 'symphony')`,
    ).run(executionRunId, task.id, approver.id, now, now, now);
    db.prepare(
      `INSERT INTO company_memory_records
        (id, company_id, slug, title, body, kind, scope, status, source, confidence, review_required, review_state, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'workflow_note', 'company', 'active', 'manual', 1, 0, 'approved', '{}', ?, ?)`,
    ).run(randomUUID(), company.id, `wake-regression-${Date.now()}`, "Wake regression memory", "Approval wakeups must build prompts without undefined run variables.", now, now);
    const agentRow = db.prepare(
      `SELECT id, name, role, personality, company_id, openclaw_agent_id, adapter_type,
              adapter_config_json, runtime_config_json, capabilities, NULL AS runtime_workspace_root
       FROM agents WHERE id = ?`,
    ).get(approver.id) as Parameters<typeof buildHeartbeatPrompt>[0];
    const session: TaskSession = {
      id: randomUUID(),
      agentId: approver.id,
      companyId: company.id,
      adapterType: "manual",
      taskKey: task.id,
      sessionParams: {},
      sessionDisplayId: null,
      lastRunId: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    const prompt = buildHeartbeatPrompt(agentRow, { reason: "approval_requested" }, session, db, executionRunId);
    assert.match(prompt, /Injected Company Memory/);
    const metadata = db.prepare("SELECT metadata_json FROM execution_runs WHERE id = ?").get(executionRunId) as { metadata_json: string };
    assert.match(metadata.metadata_json, /injected_memory_sha256/);
  });

  await test("stale orphan approvals are skipped or auto-cancelled while linked approvals still wake", async () => {
    const linkedTask = createTask({
      projectId: project.id,
      title: "Linked approval task",
      description: "Linked stale approvals should still wake the approver.",
      priority: "P2",
      type: "research",
      status: "review",
      assignee: approver.id,
      createdBy: "bundle-4-test",
      labels: [],
      executionEngine: "hiverunner",
    }).task;
    const linked = createApproval({
      companyIdOrSlug: company.slug,
      type: "protected_runtime_command",
      approverAgentId: approver.id,
      linkedTaskId: linkedTask.id,
      payload: { command: "linked approval" },
      db,
    }).approval;
    const orphanSkip = createApproval({
      companyIdOrSlug: company.slug,
      type: "protected_runtime_command",
      approverAgentId: approver.id,
      payload: { command: "orphan skip approval" },
      db,
    }).approval;
    const orphanCancel = createApproval({
      companyIdOrSlug: company.slug,
      type: "protected_runtime_command",
      approverAgentId: approver.id,
      payload: { command: "orphan cancel approval" },
      db,
    }).approval;
    db.prepare("DELETE FROM agent_wakeup_requests").run();
    db.prepare("DELETE FROM heartbeat_runs").run();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE approvals SET created_at = ?, updated_at = ? WHERE id = ?").run(twoHoursAgo, twoHoursAgo, linked.id);
    db.prepare("UPDATE approvals SET created_at = ?, updated_at = ? WHERE id = ?").run(twentyFiveHoursAgo, twentyFiveHoursAgo, orphanSkip.id);
    db.prepare("UPDATE approvals SET created_at = ?, updated_at = ? WHERE id = ?").run(eightDaysAgo, eightDaysAgo, orphanCancel.id);

    const sweep = sweepOpenTasks(db, { companySlugs: [company.slug] });
    assert.ok((sweep.skippedReasons.stale_approval_wakes ?? 0) >= 1);
    const cancelled = db.prepare("SELECT status, decision_note FROM approvals WHERE id = ?").get(orphanCancel.id) as { status: string; decision_note: string | null };
    assert.equal(cancelled.status, "cancelled");
    assert.match(cancelled.decision_note ?? "", /stale orphan approval/);
    const orphanWake = db.prepare("SELECT COUNT(*) AS count FROM agent_wakeup_requests WHERE payload_json LIKE ?").get(`%${orphanSkip.id}%`) as { count: number };
    assert.equal(Number(orphanWake.count), 0);
    const linkedWake = db.prepare("SELECT run_id FROM agent_wakeup_requests WHERE payload_json LIKE ? LIMIT 1").get(`%${linked.id}%`) as { run_id: string } | undefined;
    assert.ok(linkedWake?.run_id);
    let runError: string | null = null;
    try {
      const result = await executeHeartbeatRun(linkedWake.run_id, db);
      runError = result.error ?? null;
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
    }
    assert.doesNotMatch(runError ?? "", /executionRunId is not defined/);
    if (runError) assert.match(runError, /No active execution hive|Runtime|skipped|blocked/i);
  });

  await test("stale approval sweep does not repeat no-task owner wakes during cooldown", () => {
    const approval = createApproval({
      companyIdOrSlug: company.slug,
      type: "protected_runtime_command",
      approverAgentId: approver.id,
      payload: { command: "release orphan stale runtime command" },
      db,
    }).approval;
    db.prepare("DELETE FROM agent_wakeup_requests").run();
    db.prepare("DELETE FROM heartbeat_runs").run();

    const base = new Date("2026-06-06T18:00:00.000Z");
    const staleCreatedAt = new Date(base.getTime() - 2 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE approvals SET created_at = ?, updated_at = ? WHERE id = ?").run(staleCreatedAt, staleCreatedAt, approval.id);

    const firstSweep = sweepOpenTasks(db, { now: base, companySlugs: [company.slug] });
    assert.equal(firstSweep.skippedReasons.stale_approval_wakes, 1, JSON.stringify(firstSweep.skippedReasons));

    const firstWake = db.prepare(
      `SELECT id, run_id, idempotency_key
       FROM agent_wakeup_requests
       WHERE json_extract(payload_json, '$.approvalId') = ?
         AND json_extract(payload_json, '$.staleApprovalSweep') = 1
       LIMIT 1`,
    ).get(approval.id) as { id: string; run_id: string | null; idempotency_key: string | null } | undefined;
    assert.ok(firstWake?.run_id);
    assert.equal(firstWake.idempotency_key, `stale-approval:${approval.id}:${approver.id}`);

    const finishedAt = new Date(base.getTime() + 60_000).toISOString();
    db.prepare(
      `UPDATE heartbeat_runs
       SET status = 'succeeded',
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(finishedAt, finishedAt, firstWake.run_id);
    db.prepare(
      `UPDATE agent_wakeup_requests
       SET status = 'finished',
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(finishedAt, finishedAt, firstWake.id);

    const secondSweep = sweepOpenTasks(db, {
      now: new Date(base.getTime() + 5 * 60 * 1000),
      companySlugs: [company.slug],
    });
    assert.equal(secondSweep.skippedReasons.stale_approval_wake_cooldown, 1, JSON.stringify(secondSweep.skippedReasons));

    const staleWakeCount = db.prepare(
      `SELECT COUNT(*) AS count
       FROM agent_wakeup_requests
       WHERE json_extract(payload_json, '$.approvalId') = ?
         AND json_extract(payload_json, '$.staleApprovalSweep') = 1`,
    ).get(approval.id) as { count: number };
    assert.equal(Number(staleWakeCount.count), 1);

    const released = db.prepare("SELECT idempotency_key FROM agent_wakeup_requests WHERE id = ?").get(firstWake.id) as { idempotency_key: string | null };
    assert.equal(released.idempotency_key, null, "cooldown should not keep the approval idempotency key locked");

    backfillApprovalRoutes({ companyIdOrSlug: company.slug, status: "pending", force: true, db });
    const explicitRouteWake = db.prepare(
      `SELECT id
       FROM agent_wakeup_requests
       WHERE json_extract(payload_json, '$.approvalId') = ?
         AND COALESCE(json_extract(payload_json, '$.staleApprovalSweep'), 0) = 0
       LIMIT 1`,
    ).get(approval.id) as { id: string } | undefined;
    assert.ok(explicitRouteWake?.id, "explicit approval routing should still be able to notify the approver");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
