import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

process.env.ORCHESTRATION_DB_PATH ??= path.join(
  os.tmpdir(),
  `orchestration-engine-live-runs-route-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "PASS", failLabel: "FAIL" });

type LiveRunsResponse = {
  runs: Array<{
    runId: string;
    taskId: string | null;
    status: string;
    runnerProvider: string | null;
    runnerModel: string | null;
    runnerPid: number | null;
    runnerPidAlive: boolean | null;
    latestOutput: string | null;
    transcript: Array<{ id: string; message: string; type?: string }>;
    startedAt: string | null;
    finishedAt: string | null;
    lastEventAt?: string | null;
    lastMeaningfulProgressAt?: string | null;
    lastMeaningfulProgressAgeMs?: number | null;
    suspiciousAfterAt?: string | null;
    liveness: string;
  }>;
};

function iso(base: number, offsetMs: number): string {
  return new Date(base + offsetMs).toISOString();
}

async function fetchLiveRuns(
  companySlug: string,
  getLiveRunsRoute: (request: NextRequest) => Promise<Response>,
): Promise<LiveRunsResponse> {
  const response = await getLiveRunsRoute(
    new NextRequest(`http://localhost/api/orchestration/engine/live-runs?company=${encodeURIComponent(companySlug)}`),
  );
  assert.equal(response.status, 200);
  return await response.json() as LiveRunsResponse;
}

function runById(body: LiveRunsResponse, runId: string) {
  const run = body.runs.find((candidate) => candidate.runId === runId);
  assert.ok(run, `expected live-runs response to include ${runId}`);
  return run;
}

async function run() {
  console.log("\nOrchestration Engine Live Runs Route Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
  process.env.PORT = "3999";
  process.env.MC_ENGINE_TICK = "on";
  createIsolatedOrchestrationWorkspace({ prefix: "mc-live-runs-route-" });
  const [
    { GET: getLiveRunsRoute },
    { createCompany },
    { getOrchestrationDb },
    { createProject, createProjectAgent, createTask },
  ] = await Promise.all([
    import("@/app/api/orchestration/engine/live-runs/route"),
    import("@/lib/orchestration/company-service"),
    import("@/lib/orchestration/db"),
    import("@/lib/orchestration/service"),
  ]);

  const company = createCompany({
    name: `Live Runs Route ${Date.now()}`,
    description: "fixture",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: `Live Runs Project ${Date.now()}`,
    description: "fixture",
    color: "#0ea5e9",
    emoji: "icon:folder",
    status: "active",
  }).project;
  const agent = createProjectAgent({
    projectId: project.id,
    name: `Live Runs Agent ${Date.now()}`,
    emoji: "icon:bot",
    role: "Operator",
    personality: "Precise",
    model: "openai-codex/gpt-5.5",
    skills: [],
    status: "idle",
  }).agent;
  const task = createTask({
    projectId: project.id,
    title: "Live run reporting fixture",
    description: "fixture",
    priority: "P2",
    type: "bug",
    status: "in-progress",
    assignee: agent.id,
    labels: [],
    createdBy: "test",
  }).task;

  const db = getOrchestrationDb();
  const base = Date.now() - 45_000;
  const clarityRunId = "live-route-clarity-run";
  const clarityExecId = "live-route-clarity-exec";
  const lensRunId = "live-route-lens-run";
  const lensExecId = "live-route-lens-exec";
  const progressOnlyRunId = "live-route-progress-only-run";
  const progressOnlyExecId = "live-route-progress-only-exec";
  const cancelledRunId = "live-route-cancelled-run";
  const cancelledExecId = "live-route-cancelled-exec";
  const packageRunId = "live-route-package-run";
  const packageWakeupId = "live-route-package-wakeup";
  const queuedSameTaskRunId = "live-route-queued-same-task-run";
  const queuedSameTaskWakeupId = "live-route-queued-same-task-wakeup";
  const commentWakeRunId = "live-route-comment-wake-run";
  const commentWakeupId = "live-route-comment-wakeup";
  const staleApprovalRunId = "live-route-stale-approval-run";
  const staleApprovalWakeupId = "live-route-stale-approval-wakeup";

  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
        status, started_at, completed_at, token_usage_json, metadata_json, process_pid, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'hiverunner', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clarityExecId,
    task.id,
    agent.id,
    "anthropic",
    "anthropic",
    "claude-sonnet-4-6",
    "completed",
    iso(base, 1_000),
    iso(base, 12_000),
    JSON.stringify({ heartbeatRunId: clarityRunId }),
    JSON.stringify({ heartbeatRunId: clarityRunId }),
    process.pid,
    iso(base, 1_000),
    iso(base, 12_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        started_at, finished_at, result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'clarity', 'succeeded', ?, ?, '{}', ?, ?, ?)`,
  ).run(
    clarityRunId,
    agent.id,
    company.id,
    iso(base, 1_000),
    iso(base, 12_000),
    JSON.stringify({ taskId: task.id, executionRunId: clarityExecId }),
    iso(base, 0),
    iso(base, 12_000),
  );
  db.prepare(
    `INSERT INTO execution_run_transcript_events
       (id, execution_run_id, provider, event_kind, role, title, body, sequence, occurred_at, created_at)
     VALUES (?, ?, 'anthropic', 'assistant_text_final', 'assistant', 'assistant final', ?, 1, ?, ?)`,
  ).run(
    "live-route-clarity-transcript",
    clarityExecId,
    "Clarity completed with Anthropic output.",
    iso(base, 11_000),
    iso(base, 11_000),
  );

  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
        status, started_at, token_usage_json, metadata_json, process_pid, created_at, updated_at)
     VALUES (?, ?, ?, 'gemini', 'hiverunner', 'gemini', 'gemini-3-pro-preview',
        'running', ?, ?, ?, ?, ?, ?)`,
  ).run(
    lensExecId,
    task.id,
    agent.id,
    iso(base, 28_000),
    JSON.stringify({ heartbeatRunId: lensRunId }),
    JSON.stringify({ heartbeatRunId: lensRunId }),
    process.pid,
    iso(base, 28_000),
    iso(base, 31_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        started_at, result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'lens', 'running', ?, '{}', ?, ?, ?)`,
  ).run(
    lensRunId,
    agent.id,
    company.id,
    iso(base, 28_000),
    JSON.stringify({ taskId: task.id, executionRunId: lensExecId }),
    iso(base, 27_000),
    iso(base, 31_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_run_events (id, run_id, agent_id, event_type, detail, created_at)
     VALUES (?, ?, ?, 'waiting', 'Dispatching Gemini execution', ?)`,
  ).run("live-route-lens-event", lensRunId, agent.id, iso(base, 31_000));

  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
        status, started_at, token_usage_json, metadata_json, process_pid, created_at, updated_at)
     VALUES (?, ?, ?, 'symphony', 'symphony', 'codex', 'gpt-5.5',
        'running', ?, ?, ?, NULL, ?, ?)`,
  ).run(
    progressOnlyExecId,
    task.id,
    agent.id,
    iso(base, 1_000),
    JSON.stringify({ heartbeatRunId: progressOnlyRunId }),
    JSON.stringify({ heartbeatRunId: progressOnlyRunId }),
    iso(base, 1_000),
    iso(base, 44_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        started_at, result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'progress-only', 'running', ?, '{}', ?, ?, ?)`,
  ).run(
    progressOnlyRunId,
    agent.id,
    company.id,
    iso(base, 1_000),
    JSON.stringify({ taskId: task.id, executionRunId: progressOnlyExecId }),
    iso(base, 1_000),
    iso(base, 44_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_run_events (id, run_id, agent_id, event_type, detail, created_at)
     VALUES (?, ?, ?, 'waiting', ?, ?)`,
  ).run(
    "live-route-progress-only-event",
    progressOnlyRunId,
    agent.id,
    "External runner still active after 43.0s; 43.0s since last stdout/stderr.",
    iso(base, 44_000),
  );

  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, execution_engine, runner_provider, runner_model,
        status, started_at, completed_at, token_usage_json, metadata_json, process_pid, created_at, updated_at)
     VALUES (?, ?, ?, 'codex', 'hiverunner', 'codex', 'gpt-5.5',
        'cancelled', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    cancelledExecId,
    task.id,
    agent.id,
    iso(base, 34_000),
    iso(base, 36_000),
    JSON.stringify({ heartbeatRunId: cancelledRunId }),
    JSON.stringify({ heartbeatRunId: cancelledRunId }),
    process.pid,
    iso(base, 34_000),
    iso(base, 36_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'cancelled', 'queued', '{}', ?, ?, ?)`,
  ).run(
    cancelledRunId,
    agent.id,
    company.id,
    JSON.stringify({ taskId: task.id, executionRunId: cancelledExecId }),
    iso(base, 33_000),
    iso(base, 36_000),
  );

  db.prepare(
    `INSERT INTO comments
       (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES ('live-route-stale-comment', ?, ?, 'Stale prior comment should not appear', 'status_update', 'mission_control', 'stale-output', ?, ?)`,
  ).run(task.id, agent.id, iso(base, 38_000), iso(base, 38_000));

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json,
        status, run_id, requested_at, claimed_at, finished_at, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'package fixture', 'package', '{}',
        'finished', ?, ?, ?, ?, ?, ?)`,
  ).run(
    packageWakeupId,
    agent.id,
    company.id,
    packageRunId,
    iso(base, 17_000),
    iso(base, 18_000),
    iso(base, 20_000),
    iso(base, 17_000),
    iso(base, 20_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        started_at, finished_at, wakeup_request_id, result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'package', 'succeeded', ?, ?, ?, '{}', ?, ?, ?)`,
  ).run(
    packageRunId,
    agent.id,
    company.id,
    iso(base, 18_000),
    iso(base, 20_000),
    packageWakeupId,
    JSON.stringify({ taskId: task.id }),
    iso(base, 17_000),
    iso(base, 20_000),
  );
  db.prepare(
    `INSERT INTO comments
       (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
     VALUES ('live-route-package-comment', ?, ?, 'Prior package output should stay with package run only', 'status_update', 'mission_control', 'package-output', ?, ?)`,
  ).run(task.id, agent.id, iso(base, 20_000), iso(base, 20_000));
  db.prepare(
    `INSERT INTO task_events
       (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
     VALUES ('live-route-package-comment-event', ?, ?, ?, 'task.comment_added', ?, ?)`,
  ).run(
    project.id,
    task.id,
    agent.id,
    JSON.stringify({ source: "engine_heartbeat", runId: packageRunId, wakeupRequestId: packageWakeupId }),
    iso(base, 20_000),
  );

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json,
        status, run_id, requested_at, created_at, updated_at)
     VALUES (?, ?, ?, 'issue_assigned', 'queued same task fixture', 'queued', '{}',
        'queued', ?, ?, ?, ?)`,
  ).run(
    queuedSameTaskWakeupId,
    agent.id,
    company.id,
    queuedSameTaskRunId,
    iso(base, 41_000),
    iso(base, 41_000),
    iso(base, 41_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        wakeup_request_id, result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'queued', 'queued', ?, '{}', ?, ?, ?)`,
  ).run(
    queuedSameTaskRunId,
    agent.id,
    company.id,
    queuedSameTaskWakeupId,
    JSON.stringify({ taskId: task.id }),
    iso(base, 41_000),
    iso(base, 41_000),
  );

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json,
        status, run_id, requested_at, claimed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'api', 'comment wake fixture', 'comment-wake', '{}',
        'claimed', ?, ?, ?, ?, ?)`,
  ).run(
    commentWakeupId,
    agent.id,
    company.id,
    commentWakeRunId,
    iso(base, 42_000),
    iso(base, 43_000),
    iso(base, 42_000),
    iso(base, 43_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        started_at, wakeup_request_id, result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', 'comment-wake', 'running', ?, ?, '{}', ?, ?, ?)`,
  ).run(
    commentWakeRunId,
    agent.id,
    company.id,
    iso(base, 43_000),
    commentWakeupId,
    JSON.stringify({ taskId: task.id }),
    iso(base, 42_000),
    iso(base, 43_000),
  );

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json,
        status, run_id, requested_at, claimed_at, created_at, updated_at)
     VALUES (?, ?, ?, 'api', 'approval_requested', NULL, ?,
        'claimed', ?, ?, ?, ?, ?)`,
  ).run(
    staleApprovalWakeupId,
    agent.id,
    company.id,
    JSON.stringify({
      approvalId: "live-route-stale-approval",
      approvalType: "protected_runtime_command",
      staleApprovalSweep: true,
    }),
    staleApprovalRunId,
    iso(base, 44_000),
    iso(base, 44_000),
    iso(base, 44_000),
    iso(base, 44_000),
  );
  db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status,
        started_at, wakeup_request_id, result_json, context_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'wakeup_request', NULL, 'running', ?, ?, '{}', ?, ?, ?)`,
  ).run(
    staleApprovalRunId,
    agent.id,
    company.id,
    iso(base, 44_000),
    staleApprovalWakeupId,
    JSON.stringify({
      wakeSource: "api",
      wakeReason: "approval_requested",
      approvalId: "live-route-stale-approval",
      approvalType: "protected_runtime_command",
      staleApprovalSweep: true,
    }),
    iso(base, 44_000),
    iso(base, 44_000),
  );

  await test("does not use prior comments as latest output for active runs", async () => {
    const body = await fetchLiveRuns(company.slug, getLiveRunsRoute);
    const lensRun = runById(body, lensRunId);

    assert.equal(lensRun.latestOutput, null);
    assert.equal(lensRun.transcript.some((entry) => entry.message.includes("Stale prior comment")), false);
  });

  await test("does not let external runner progress diagnostics refresh live-run liveness", async () => {
    const body = await fetchLiveRuns(company.slug, getLiveRunsRoute);
    const progressOnlyRun = runById(body, progressOnlyRunId);

    assert.equal(progressOnlyRun.latestOutput, null);
    assert.equal(progressOnlyRun.lastEventAt, iso(base, 1_000));
    assert.equal(progressOnlyRun.lastMeaningfulProgressAt, null);
    assert.equal(progressOnlyRun.liveness, "quiet");
    assert.equal(
      progressOnlyRun.transcript.some((entry) => entry.message.includes("External runner still active after")),
      true,
    );
  });

  await test("does not count stale no-task approval reminders as live runs", async () => {
    const body = await fetchLiveRuns(company.slug, getLiveRunsRoute);
    assert.equal(body.runs.some((run) => run.runId === staleApprovalRunId), false);
  });

  await test("keeps same-task package output scoped to its heartbeat run", async () => {
    const body = await fetchLiveRuns(company.slug, getLiveRunsRoute);
    const packageRun = runById(body, packageRunId);
    const queuedRun = runById(body, queuedSameTaskRunId);
    const commentWakeRun = runById(body, commentWakeRunId);

    assert.equal(packageRun.latestOutput, "Prior package output should stay with package run only");
    assert.equal(queuedRun.status, "queued");
    assert.equal(queuedRun.liveness, "queued");
    assert.equal(queuedRun.startedAt, null);
    assert.equal(queuedRun.latestOutput, null);
    assert.equal(queuedRun.transcript.some((entry) => entry.message.includes("Prior package output")), false);

    assert.equal(commentWakeRun.status, "running");
    assert.equal(commentWakeRun.latestOutput, null);
    assert.equal(commentWakeRun.transcript.some((entry) => entry.message.includes("Prior package output")), false);
  });

  await test("keeps runner attribution scoped to each run id", async () => {
    const body = await fetchLiveRuns(company.slug, getLiveRunsRoute);
    const clarityRun = runById(body, clarityRunId);
    const lensRun = runById(body, lensRunId);

    assert.equal(clarityRun.status, "succeeded");
    assert.equal(clarityRun.runnerProvider, "anthropic");
    assert.equal(clarityRun.runnerModel, "claude-sonnet-4-6");
    assert.equal(clarityRun.runnerPid, null);
    assert.equal(clarityRun.latestOutput, "Clarity completed with Anthropic output.");
    assert.equal(clarityRun.lastMeaningfulProgressAt, iso(base, 11_000));
    assert.equal(clarityRun.suspiciousAfterAt, null);

    assert.equal(lensRun.status, "running");
    assert.equal(lensRun.runnerProvider, "gemini");
    assert.equal(lensRun.runnerModel, "gemini-3-pro-preview");
    assert.equal(lensRun.runnerPid, process.pid);
    assert.equal(lensRun.runnerPidAlive, true);
    assert.equal(lensRun.lastMeaningfulProgressAt, null);
  });

  await test("surfaces cancelled execution status for stale queued heartbeat rows", async () => {
    const body = await fetchLiveRuns(company.slug, getLiveRunsRoute);
    const cancelledRun = runById(body, cancelledRunId);

    assert.equal(cancelledRun.status, "cancelled");
    assert.equal(cancelledRun.finishedAt, iso(base, 36_000));
    assert.equal(cancelledRun.liveness, "completed");
    assert.equal(cancelledRun.runnerProvider, "codex");
    assert.equal(cancelledRun.runnerPid, null);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
