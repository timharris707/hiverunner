import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  createProject,
  createProjectAgent,
  createTask,
  createTaskComment,
  getTaskDetail,
} from "@/lib/orchestration/service";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [PASS] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [FAIL] ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nOrchestration Task Detail Tests\n");
  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const company = createCompany({
    name: `Detail Co ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;

  const project = createProject({
    companyId: company.id,
    name: `Detail Project ${Date.now()}`,
    description: "fixture",
    color: "#2563eb",
    emoji: "🧪",
    status: "active",
  }).project;

  const agent = createProjectAgent({
    projectId: project.id,
    name: `Detail Agent ${Date.now()}`,
    emoji: "🤖",
    role: "Backend Engineer",
    personality: "Careful",
    status: "idle",
    skills: [],
  }).agent;

  const parent = createTask({
    projectId: project.id,
    title: "Parent task",
    description: "parent",
    priority: "P1",
    type: "feature",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  const child = createTask({
    projectId: project.id,
    title: "Child task",
    description: "child",
    priority: "P2",
    type: "bug",
    status: "review",
    assignee: agent.id,
    parentTaskId: parent.id,
    labels: [],
    createdBy: "test",
  }).task;

  createTaskComment({
    taskId: parent.id,
    body: "Human operator note",
    type: "comment",
    authorUserId: "tim",
  });

  createTaskComment({
    taskId: parent.id,
    body: "Imported run report",
    type: "status_update",
    source: "openclaw",
    authorAgentId: agent.id,
    externalRef: "run-report-1",
  });

  const db = getOrchestrationDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, 'task.status_changed', 'to-do', 'in_progress', ?, ?)`
  ).run(randomUUID(), project.id, parent.id, agent.id, "tim", JSON.stringify({ source: "test" }), now);

  const approvalId = randomUUID();
  db.prepare(
    `INSERT INTO approvals (id, company_id, type, status, requested_by_agent_id, payload_json, linked_task_id, created_at, updated_at)
     VALUES (?, ?, 'hire_agent', 'pending', ?, '{}', ?, ?, ?)`
  ).run(approvalId, company.id, agent.id, parent.id, now, now);

  const wakeId = randomUUID();
  const heartbeatRunId = randomUUID();
  db.prepare(
    `INSERT INTO agent_wakeup_requests (id, agent_id, company_id, source, reason, payload_json, status, run_id, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'detail_test', ?, 'finished', ?, ?, ?, ?)`
  ).run(wakeId, agent.id, company.id, JSON.stringify({ taskId: parent.id }), heartbeatRunId, now, now, now);

  db.prepare(
    `INSERT INTO heartbeat_runs (id, agent_id, company_id, invocation_source, status, wakeup_request_id, started_at, finished_at, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'succeeded', ?, ?, ?, ?, ?, ?)`
  ).run(heartbeatRunId, agent.id, company.id, wakeId, now, now, JSON.stringify({ taskId: parent.id }), now, now);

  db.prepare(
    `INSERT INTO heartbeat_run_events (id, run_id, agent_id, event_type, detail, created_at)
     VALUES (?, ?, ?, 'create_task', 'Created a follow-up task', ?)`
  ).run(randomUUID(), heartbeatRunId, agent.id, now);

  db.prepare(
    `INSERT INTO execution_runs (id, task_id, agent_id, provider, status, started_at, completed_at, token_usage_json, created_at, updated_at)
     VALUES (?, ?, ?, 'openclaw', 'completed', ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    parent.id,
    agent.id,
    now,
    now,
    JSON.stringify({
      provider: "openclaw",
      model: "fixture-model",
      workspaceRoot: "/tmp/hiverunner-fixture",
      runtimeSlug: "fixture-runtime",
    }),
    now,
    now,
  );

  await test("getTaskDetail merges timeline sources and hierarchy", () => {
    const result = getTaskDetail(parent.id);
    assert.strictEqual(result.task.id, parent.id);
    assert.ok(result.detail.parentTask === undefined);
    assert.strictEqual(result.detail.childTasks.length, 1);
    assert.strictEqual(result.detail.childTasks[0]?.id, child.id);

    const provenances = new Set(result.detail.timeline.map((item) => item.provenance));
    assert.ok(provenances.has("comment"));
    assert.ok(provenances.has("imported_report"));
    assert.ok(provenances.has("status_change"));
    assert.ok(provenances.has("run_event"));
    assert.ok(provenances.has("approval_event"));
    assert.ok(provenances.has("subtask_event"));

    assert.strictEqual(result.detail.runSummary.totalRuns, 1);
    assert.ok(result.detail.runSummary.structuredActionCount >= 1);
    assert.strictEqual(result.detail.runSummary.importedReportCount, 1);
    assert.ok(result.detail.plannedExecution);
    assert.strictEqual(result.detail.runSummary.latestRun?.resolvedExecution?.model, "fixture-model");
    assert.strictEqual(result.detail.runSummary.latestRun?.resolvedExecution?.workspaceRoot, "/tmp/hiverunner-fixture");
    assert.strictEqual(result.detail.runSummary.latestRun?.resolvedExecution?.provider, "openclaw");
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

void run();
