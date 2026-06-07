import assert from "node:assert";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import {
  createFixtureAgent,
  createFixtureProject,
} from "@/lib/__tests__/helpers/orchestration-create-task-fixtures";
import { createCompany } from "@/lib/orchestration/company-service";
import { createEvalCase, RUN_TRACE_REDACTION_POLICY } from "@/lib/orchestration/eval-cases";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveMcpRequestContext } from "@/lib/orchestration/mcp/context";
import { createHiveRunnerMcpServer } from "@/lib/orchestration/mcp/server";
import { buildRedactedRunTraceExport } from "@/lib/orchestration/run-trace";
import {
  createProject,
  createProjectAgent,
  createProjectSprint,
  createTask,
} from "@/lib/orchestration/service";
import { persistExecutionTranscriptEvents } from "@/lib/orchestration/service/execution-transcript";
import { createImprovementApprovalBridgeRecommendation } from "@/lib/orchestration/service/improvement-approval";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  os.tmpdir(),
  `orchestration-mcp-resource-read-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

// Secret-pattern fixtures spanning every redaction category. Several of these
// (ghp_, AIza, xox) were NOT caught by the legacy eval-case credential list and
// are only redacted now that trace and eval exports share the Run Trace policy.
const SECRET_FIXTURES = [
  "sk-proj-AAAABBBBCCCCDDDDEEEE1234567890",
  "ghp_AAAABBBBCCCCDDDDEEEEFFFF1234567890",
  "AIzaSyAAAABBBBCCCCDDDDEEEEFFFF1234567",
  "xoxb-1234567890-ABCDEFGHIJKLMNOPQRST",
  "AKIAIOSFODNN7EXAMPLE",
];

function parseResource(result: ReadResourceResult) {
  const first = result.contents[0];
  assert.ok(first && "text" in first);
  return JSON.parse(first.text);
}

async function readResource(server: ReturnType<typeof createHiveRunnerMcpServer>, uri: string) {
  const handler = server.server._requestHandlers.get("resources/read");
  assert.ok(handler);
  const result = await handler(
    { method: "resources/read", params: { uri } },
    {} as never,
  ) as ReadResourceResult;
  return parseResource(result);
}

async function run() {
  console.log("\nHiveRunner MCP Resource Read Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
  process.env.MC_WORKSPACE_ROOT = path.join(os.tmpdir(), `mcp-resource-workspaces-${process.pid}`);

  const company = createCompany({
    name: "Insight MCP Resources",
    description: "MCP resource read fixture.",
    status: "active",
  }).company;
  const project = createFixtureProject(createProject, {
    companyId: company.id,
    namePrefix: "MCP Resource",
    label: "Read",
    description: "MCP resource project fixture.",
    color: "#2563eb",
    emoji: "icon:network",
  });
  const agent = createFixtureAgent(createProjectAgent, {
    projectId: project.id,
    namePrefix: "MCP Reader",
    emoji: "icon:search",
    role: "MCP Reader",
    adapterType: "codex",
    skills: ["mcp"],
    status: "idle",
  });
  const benchAgent = createFixtureAgent(createProjectAgent, {
    projectId: project.id,
    namePrefix: "MCP Bench",
    emoji: "icon:pause",
    role: "Bench Reader",
    adapterType: "codex",
    skills: ["mcp"],
    status: "offline",
  });
  const sprint = createProjectSprint({
    projectId: project.id,
    name: "MCP Resource Sprint",
    goal: "Expose redacted MCP reads.",
    status: "active",
  }).sprint;
  const task = createTask({
    projectId: project.id,
    title: "Expose redacted MCP resource",
    description: "Fixture task for MCP resource reads.",
    priority: "P1",
    type: "feature",
    status: "review",
    assignee: agent.id,
    labels: ["mcp"],
    createdBy: "test",
  }).task;
  const db = getOrchestrationDb();
  db.prepare("UPDATE tasks SET sprint_id = ? WHERE id = ?").run(sprint.id, task.id);

  const runId = `mcp-resource-run-${randomUUID()}`;
  const startedAt = "2026-06-07T15:00:00.000Z";
  const completedAt = "2026-06-07T15:01:00.000Z";
  db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
        error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
        runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
     VALUES
       (?, ?, ?, 'codex', ?, 'completed', ?, ?, NULL, ?, 60000, ?, 'symphony',
        'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
  ).run(
    runId,
    task.id,
    agent.id,
    "mcp-resource-session",
    startedAt,
    completedAt,
    JSON.stringify({
      runnerProvider: "openai",
      runnerModel: "gpt-5.5",
      inputTokens: 120,
      outputTokens: 45,
      structuredTelemetry: true,
      observedLiveText: true,
    }),
    "mcp-resource-run",
    startedAt,
    completedAt,
  );
  persistExecutionTranscriptEvents({
    db,
    executionRunId: runId,
    provider: "codex",
    occurredAt: completedAt,
    events: [
      {
        kind: "assistant_text_final",
        role: "assistant",
        title: "MCP read proof",
        body: "Implemented redacted resource reads.",
        occurredAt: completedAt,
      },
      {
        kind: "tool_result",
        role: "tool",
        title: "Provider call dump",
        body: SECRET_FIXTURES.join(" "),
        occurredAt: completedAt,
        metadata: { authorization: `Bearer ${SECRET_FIXTURES[0]}`, env: { OPENAI_API_KEY: SECRET_FIXTURES[1] } },
      },
    ],
  });

  const traceSnapshot = buildRedactedRunTraceExport({
    run: {
      id: runId,
      status: "succeeded",
      providerId: "codex",
      startedAt,
      finishedAt: completedAt,
      durationMs: 60000,
    },
    task: {
      id: task.id,
      key: task.key ?? task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
    },
    provider: {
      id: "openai",
      displayName: "OpenAI",
    },
    transcript: {
      entries: [{ body: "No secret in this fixture." }],
      provenance: { label: "Fixture", fullTranscriptAvailable: true },
    },
    timeline: [
      {
        id: "timeline-1",
        kind: "assistant_text_final",
        summary: "MCP resource proof completed.",
        ts: new Date(completedAt).getTime(),
        source: "test",
      },
    ],
  });
  const evalCase = createEvalCase({
    companyId: company.id,
    projectId: project.id,
    sourceTask: {
      id: task.id,
      key: task.key ?? task.id,
      title: task.title,
      type: task.type,
    },
    sourceRun: {
      id: runId,
      traceRoute: `/${company.code}/tasks/${task.key ?? task.id}/runs/${runId}`,
      executionEngine: "symphony",
      runnerProvider: "openai",
      providerId: "codex",
      runnerModel: "gpt-5.5",
      agentId: agent.id,
      agentName: agent.name,
    },
    review: {
      outcome: "accepted",
      rationale: "The MCP resource fixture was accepted.",
      reviewerName: "Gator",
    },
    captureQuality: traceSnapshot.captureQuality.label,
    evidenceGaps: traceSnapshot.evidenceGaps,
    redactedSnapshot: traceSnapshot,
    idempotencyKey: "mcp-resource-eval",
    createdByUserId: "mcp-test",
  }, db);
  const recommendation = createImprovementApprovalBridgeRecommendation({
    companyIdOrSlug: company.id,
    triggerKey: "reviewer_request",
    scopeType: "project",
    scopeKey: project.id,
    title: "Keep MCP resources redacted",
    rationale: "The MCP resource reader should keep sharing redacted snapshots only.",
    proposedChange: "Retain redaction parity tests for MCP resources.",
    severity: "high",
    confidence: "high",
    evidence: [
      {
        id: "mcp-resource-evidence",
        sourceType: "eval",
        sourceId: evalCase.id,
        summary: "Eval case confirmed the MCP resource path uses a redacted snapshot.",
        redactionPolicy: RUN_TRACE_REDACTION_POLICY,
      },
    ],
    idempotencyKey: "mcp-resource-recommendation",
  }, db).recommendation;
  const experimentId = `experiment-${randomUUID()}`;
  const experimentSourceId = `experiment-source-${randomUUID()}`;
  const variantId = `variant-${randomUUID()}`;
  const reportId = `report-${randomUUID()}`;
  db.prepare(
    `INSERT INTO experiments
       (id, company_id, project_id, source_kind, primary_source_run_id,
        primary_source_eval_case_id, source_task_id, source_trace_route,
        objective, objective_kind, definition_of_better, hypothesis,
        workspace_mode, workspace_snapshot_json, limit_snapshot_json,
        status, created_by_user_id, created_at, updated_at)
     VALUES
       (?, ?, ?, 'eval_case', ?, ?, ?, ?, ?, 'evidence_quality', ?, ?,
        'snapshot', '{}', '{}', 'completed', 'mcp-test', ?, ?)`,
  ).run(
    experimentId,
    company.id,
    project.id,
    runId,
    evalCase.id,
    task.id,
    `/${company.code}/tasks/${task.key ?? task.id}/runs/${runId}`,
    "Compare evidence quality for MCP redaction proof.",
    "A better variant keeps report evidence readable while preserving redaction.",
    "Variant A should produce clearer report evidence.",
    completedAt,
    completedAt,
  );
  db.prepare(
    `INSERT INTO experiment_sources
       (id, experiment_id, company_id, source_type, source_run_id,
        source_eval_case_id, source_task_id, trace_route, source_snapshot_json,
        redaction_policy, redaction_summary_json, created_at)
     VALUES
       (?, ?, ?, 'eval_case', ?, ?, ?, ?, '{}', ?, '{}', ?)`,
  ).run(
    experimentSourceId,
    experimentId,
    company.id,
    runId,
    evalCase.id,
    task.id,
    `/${company.code}/tasks/${task.key ?? task.id}/runs/${runId}`,
    RUN_TRACE_REDACTION_POLICY,
    completedAt,
  );
  db.prepare(
    `INSERT INTO experiment_variants
       (id, experiment_id, company_id, variant_key, name, description,
        change_type, planned_change_json, status, approval_snapshot_json,
        limit_snapshot_json, proposed_by_user_id, approved_by_user_id,
        approved_at, created_at, updated_at)
     VALUES
       (?, ?, ?, 'variant-a', 'Evidence-focused variant', 'Fixture variant.',
        'prompt', '{}', 'completed', '{}', '{}', 'mcp-test', 'mcp-test',
        ?, ?, ?)`,
  ).run(variantId, experimentId, company.id, completedAt, completedAt, completedAt);
  db.prepare(
    `INSERT INTO experiment_comparison_reports
       (id, experiment_id, company_id, status, summary, report_json,
        conclusion_json, winning_variant_id, recommendation_id, report_sha256,
        generated_by_user_id, accepted_by_user_id, accepted_at, created_at, updated_at)
     VALUES
       (?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, 'mcp-test', 'mcp-test', ?, ?, ?)`,
  ).run(
    reportId,
    experimentId,
    company.id,
    "Variant A kept the evidence readable after redaction.",
    JSON.stringify({
      schema: "hiverunner.experiment_comparison_report.v1",
      title: "MCP comparison report",
      notes: `Provider payload included ${SECRET_FIXTURES[0]}`,
    }),
    JSON.stringify({
      winner: "variant-a",
      authorization: `Bearer ${SECRET_FIXTURES[1]}`,
    }),
    variantId,
    recommendation.id,
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    completedAt,
    completedAt,
    completedAt,
  );

  const context = resolveMcpRequestContext({ company: company.code, db, actorName: "MCP Resource Test" });
  const server = createHiveRunnerMcpServer({ context });
  const root = `hiverunner://${company.code}`;
  const taskKey = task.key ?? task.id;

  await test("reads work, team, template, eval, improve, and trace resources", async () => {
    const payloads = await Promise.all([
      readResource(server, `${root}/goals`),
      readResource(server, `${root}/tasks`),
      readResource(server, `${root}/tasks/${encodeURIComponent(taskKey)}`),
      readResource(server, `${root}/runs/${encodeURIComponent(runId)}/trace`),
      readResource(server, `${root}/runs/${encodeURIComponent(runId)}/trace/export`),
      readResource(server, `${root}/eval-cases`),
      readResource(server, `${root}/eval-cases/${encodeURIComponent(evalCase.id)}`),
      readResource(server, `${root}/experiment-reports`),
      readResource(server, `${root}/experiment-reports/${encodeURIComponent(reportId)}`),
      readResource(server, `${root}/improve`),
      readResource(server, `${root}/improve/${encodeURIComponent(recommendation.id)}`),
      readResource(server, `${root}/team`),
      readResource(server, `${root}/team/bench`),
      readResource(server, `${root}/templates`),
      readResource(server, `${root}/templates/build-something@1.0.0`),
    ]);

    assert.deepEqual(payloads.map((payload) => payload.schema), [
      "mcp.goals.v1",
      "mcp.tasks.v1",
      "mcp.task.v1",
      "hiverunner.run_trace_view.v1",
      "hiverunner.run_trace_redacted_export.v1",
      "mcp.eval_cases.v1",
      "mcp.eval_case.v1",
      "mcp.experiment_reports.v1",
      "mcp.experiment_report.v1",
      "mcp.improve.v1",
      "mcp.improvement.v1",
      "mcp.team.v1",
      "mcp.team.v1",
      "mcp.templates.v1",
      "mcp.template.v1",
    ]);
    assert.equal(payloads[0].goals[0].id, sprint.id);
    assert.equal(payloads[1].tasks[0].id, task.id);
    assert.equal(payloads[2].task.id, task.id);
    assert.equal(payloads[3].runId, runId);
    assert.equal(payloads[3].experimentReports[0].id, reportId);
    assert.equal(payloads[4].summary.runId, runId);
    assert.equal(payloads[4].redaction.policy, RUN_TRACE_REDACTION_POLICY);
    assert.equal(payloads[5].cases[0].id, evalCase.id);
    assert.equal(payloads[5].cases[0].experimentReports[0].id, reportId);
    assert.equal(payloads[6].evalCase.id, evalCase.id);
    assert.equal(payloads[6].evalCase.experimentReports[0].id, reportId);
    assert.equal(payloads[7].reports[0].id, reportId);
    assert.equal(payloads[8].report.id, reportId);
    assert.equal(payloads[10].recommendation.id, recommendation.id);
    assert.ok(payloads[11].agents.some((item: { id: string }) => item.id === agent.id));
    assert.ok(payloads[12].agents.some((item: { id: string }) => item.id === benchAgent.id));
    assert.ok(payloads[13].templates.some((item: { id: string }) => item.id === "build-something"));
    assert.equal(payloads[14].template.id, "build-something");
    const reportSerialized = JSON.stringify([payloads[7], payloads[8]]);
    for (const fixture of SECRET_FIXTURES) {
      assert.ok(!reportSerialized.includes(fixture), `experiment report leaked ${fixture}`);
    }
  });

  await test("MCP trace reads redact secret fixtures and keep evidence-gap parity", async () => {
    const view = await readResource(server, `${root}/runs/${encodeURIComponent(runId)}/trace`);
    const exported = await readResource(server, `${root}/runs/${encodeURIComponent(runId)}/trace/export`);

    const viewSerialized = JSON.stringify(view);
    const exportSerialized = JSON.stringify(exported);
    for (const fixture of SECRET_FIXTURES) {
      assert.ok(!viewSerialized.includes(fixture), `trace view leaked ${fixture}`);
      assert.ok(!exportSerialized.includes(fixture), `trace export leaked ${fixture}`);
    }

    // Both export paths carry a redaction summary with per-category counts under
    // the shared Run Trace policy.
    assert.equal(view.redaction.policy, RUN_TRACE_REDACTION_POLICY);
    assert.equal(exported.redaction.policy, RUN_TRACE_REDACTION_POLICY);
    assert.ok(view.redaction.totalRedactions > 0, "view model redaction count > 0");
    assert.ok(exported.redaction.totalRedactions > 0, "export redaction count > 0");
    assert.equal(typeof view.redaction.categories.api_key.count, "number");
    assert.equal(typeof view.redaction.categories.bearer_token.count, "number");

    // Evidence gaps are identical between the view model and the redacted export
    // for the same run.
    assert.deepEqual(view.evidenceGaps, exported.evidenceGaps);
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
