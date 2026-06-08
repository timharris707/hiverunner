import assert from "node:assert";
import os from "node:os";
import path from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { resetSqliteDatabaseFiles } from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { RUN_TRACE_REDACTION_POLICY } from "@/lib/orchestration/eval-cases";
import { resolveMcpRequestContext } from "@/lib/orchestration/mcp/context";
import { createHiveRunnerMcpServer } from "@/lib/orchestration/mcp/server";
import { createProject, createTask } from "@/lib/orchestration/service";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  os.tmpdir(),
  `orchestration-mcp-governed-tools-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

type ToolPayload = Record<string, unknown>;

function parseToolResult(result: CallToolResult): ToolPayload {
  const first = result.content[0];
  assert.ok(first && first.type === "text");
  return JSON.parse(first.text) as ToolPayload;
}

async function callTool(
  server: ReturnType<typeof createHiveRunnerMcpServer>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: CallToolResult; payload: ToolPayload }> {
  const handler = server.server._requestHandlers.get("tools/call");
  assert.ok(handler);
  const result = await handler(
    { method: "tools/call", params: { name, arguments: args } },
    {} as never,
  ) as CallToolResult;
  return { result, payload: parseToolResult(result) };
}

function redactedSnapshot(input: { runId: string; taskKey: string }) {
  return {
    schema: "hiverunner.run_trace_redacted_export.v1",
    summary: {
      copyText: "Accepted run with redacted evidence.",
      runId: input.runId,
      taskKey: input.taskKey,
      status: "succeeded",
      providerId: "codex",
      captureQuality: "complete",
      timelineEventCount: 1,
      evidenceGapCount: 0,
      annotationCount: 0,
    },
    redaction: {
      schema: "hiverunner.run_trace_redaction.v1",
      policy: RUN_TRACE_REDACTION_POLICY,
      location: "server",
      totalRedactions: 0,
      categories: {},
      notes: [],
    },
    run: { id: input.runId, status: "succeeded" },
    task: { key: input.taskKey },
    provider: { id: "codex" },
    metrics: {},
    timeline: [{ id: "event-1", summary: "Run completed" }],
    transcript: { entries: [] },
    providerExecution: null,
    workspaceRunVisibility: null,
    memoryEvidence: null,
    annotations: {
      schema: "hiverunner.run_trace_annotations.v1",
      state: "deferred",
      annotations: [],
    },
    evidenceGaps: [],
    captureQuality: {
      label: "complete",
      missingRequiredEvidence: [],
      notes: [],
    },
  };
}

function insertExecutionRun(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  id: string;
  taskId: string;
  agentId?: string | null;
  provider?: string;
  status?: "completed" | "running" | "failed" | "cancelled";
  executionEngine?: "hiverunner" | "symphony" | "manual";
  runnerProvider?: string;
  runnerModel?: string;
}) {
  const now = new Date().toISOString();
  input.db
    .prepare(
      `INSERT INTO execution_runs (
         id, task_id, agent_id, provider, status, started_at, completed_at,
         token_usage_json, duration_ms, execution_engine, runner_provider, runner_model
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.taskId,
      input.agentId ?? null,
      input.provider ?? "codex",
      input.status ?? "completed",
      now,
      input.status === "running" ? null : now,
      JSON.stringify({
        inputTokens: 10,
        outputTokens: 5,
        runnerProvider: input.runnerProvider ?? input.provider ?? "codex",
        runnerModel: input.runnerModel ?? "gpt-5.5",
      }),
      input.status === "running" ? null : 1,
      input.executionEngine ?? "hiverunner",
      input.runnerProvider ?? input.provider ?? "codex",
      input.runnerModel ?? "gpt-5.5",
    );
}

function saveCaseArgs(input: {
  projectId: string;
  task: { id: string; key?: string | null; title: string; type: string };
  taskKey: string;
  sourceRunId: string;
  companyCode: string;
  idempotencyKey: string;
}) {
  return {
    projectId: input.projectId,
    sourceTask: {
      id: input.task.id,
      key: input.taskKey,
      title: input.task.title,
      type: input.task.type,
    },
    sourceRun: {
      id: input.sourceRunId,
      traceRoute: `/${input.companyCode}/tasks/${input.taskKey}/runs/${input.sourceRunId}/trace`,
      executionEngine: "hiverunner",
      runnerProvider: "codex",
      providerId: "codex",
      runnerModel: "gpt-5.5",
    },
    review: {
      outcome: "accepted",
      rationale: "The reviewed run satisfies the task contract.",
      reviewerName: "Gator",
    },
    captureQuality: "complete",
    evidenceGaps: [],
    redactedSnapshot: redactedSnapshot({ runId: input.sourceRunId, taskKey: input.taskKey }),
    idempotencyKey: input.idempotencyKey,
    createdByUserId: "mcp-test",
  };
}

async function run() {
  console.log("\nHiveRunner MCP Governed Tool Tests\n");

  resetSqliteDatabaseFiles(process.env.ORCHESTRATION_DB_PATH);
  process.env.MC_WORKSPACE_ROOT = path.join(os.tmpdir(), `mcp-governed-workspaces-${process.pid}`);

  const company = createCompany({
    name: "Insight MCP Governed Tools",
    description: "MCP governed tools test fixture.",
    status: "active",
  }).company;
  const project = createProject({
    companyId: company.id,
    name: "MCP Tool Project",
    description: "fixture",
    color: "#2563eb",
    emoji: "icon:wrench",
    status: "active",
  }).project;
  const task = createTask({
    projectId: project.id,
    title: "Review governed MCP tools",
    description: "Fixture task for eval-case MCP save.",
    priority: "P1",
    type: "feature",
    status: "review",
    labels: [],
    createdBy: "test",
  }).task;

  const db = getOrchestrationDb();
  const context = resolveMcpRequestContext({ company: company.code, db, actorName: "MCP Governed Tool Test" });
  const server = createHiveRunnerMcpServer({ context });
  const taskKey = task.key ?? task.id;
  const sourceRunId = "mcp-governed-run-1";
  insertExecutionRun({
    db,
    id: sourceRunId,
    taskId: task.id,
    agentId: task.assigneeAgentId ?? null,
  });

  await test("save_case creates the same immutable eval case record shape as the eval service", async () => {
    const { result, payload } = await callTool(server, "hiverunner.eval.save_case", saveCaseArgs({
      projectId: project.id,
      task,
      taskKey,
      sourceRunId,
      companyCode: company.code,
      idempotencyKey: "mcp-governed-eval-save",
    }));

    assert.equal(result.isError, false);
    assert.equal(payload.schema, "mcp.tool.save_eval_case.output.v1");
    assert.equal(typeof payload.evalCaseId, "string");
    assert.equal(typeof payload.snapshotSha256, "string");

    const row = db
      .prepare("SELECT source_run_id, project_id, review_outcome, snapshot_sha256 FROM eval_cases WHERE id = ?")
      .get(payload.evalCaseId) as { source_run_id: string; project_id: string; review_outcome: string; snapshot_sha256: string };
    assert.equal(row.source_run_id, sourceRunId);
    assert.equal(row.project_id, project.id);
    assert.equal(row.review_outcome, "accepted");
    assert.equal(row.snapshot_sha256, payload.snapshotSha256);

    const activity = db
      .prepare("SELECT event_type, metadata_json FROM task_events WHERE task_id = ? AND event_type = 'task.eval_case_saved'")
      .get(task.id) as { event_type: string; metadata_json: string };
    assert.equal(activity.event_type, "task.eval_case_saved");
    assert.match(activity.metadata_json, /mcp_tool/);
    assert.match(activity.metadata_json, /mcp-governed-run-1/);
  });

  await test("save_case rejects a source run that does not exist in the company", async () => {
    const { result, payload } = await callTool(server, "hiverunner.eval.save_case", saveCaseArgs({
      projectId: project.id,
      task,
      taskKey,
      sourceRunId: "missing-mcp-run",
      companyCode: company.code,
      idempotencyKey: "mcp-governed-missing-run",
    }));

    assert.equal(result.isError, true);
    assert.equal(payload.schema, "mcp.tool.error.v1");
    assert.equal(payload.code, "run_not_found");
  });

  await test("save_case rejects non-terminal source runs", async () => {
    const runningRunId = "mcp-governed-running-run";
    insertExecutionRun({
      db,
      id: runningRunId,
      taskId: task.id,
      status: "running",
    });

    const { result, payload } = await callTool(server, "hiverunner.eval.save_case", saveCaseArgs({
      projectId: project.id,
      task,
      taskKey,
      sourceRunId: runningRunId,
      companyCode: company.code,
      idempotencyKey: "mcp-governed-running-run",
    }));

    assert.equal(result.isError, true);
    assert.equal(payload.schema, "mcp.tool.error.v1");
    assert.equal(payload.code, "run_not_terminal");
  });

  await test("save_case rejects unreviewed source tasks", async () => {
    const unreviewedTask = createTask({
      projectId: project.id,
      title: "Unreviewed MCP save source",
      description: "Fixture task that should not be eligible for eval save.",
      priority: "P1",
      type: "feature",
      status: "in-progress",
      labels: [],
      createdBy: "test",
    }).task;
    const unreviewedTaskKey = unreviewedTask.key ?? unreviewedTask.id;
    const unreviewedRunId = "mcp-governed-unreviewed-run";
    insertExecutionRun({
      db,
      id: unreviewedRunId,
      taskId: unreviewedTask.id,
    });

    const { result, payload } = await callTool(server, "hiverunner.eval.save_case", saveCaseArgs({
      projectId: project.id,
      task: unreviewedTask,
      taskKey: unreviewedTaskKey,
      sourceRunId: unreviewedRunId,
      companyCode: company.code,
      idempotencyKey: "mcp-governed-unreviewed-run",
    }));

    assert.equal(result.isError, true);
    assert.equal(payload.schema, "mcp.tool.error.v1");
    assert.equal(payload.code, "unreviewed_run");
  });

  let recommendationId = "";

  await test("create_recommendation creates a visible suggested Improve recommendation", async () => {
    const { result, payload } = await callTool(server, "hiverunner.improve.create_recommendation", {
      triggerClass: "reviewer_request",
      scope: { type: "project", key: project.id },
      title: "Add MCP governance proof to sprint validation",
      rationale: "MCP governed writes should preserve approval routing evidence.",
      proposedChange: "Add a focused MCP governed tool smoke check to the sprint validation package.",
      severity: "high",
      confidence: "high",
      evidence: [{
        id: "mcp-evidence-1",
        sourceType: "eval",
        sourceId: "eval-fixture",
        summary: "Reviewed trace showed the governed MCP tool path works.",
      }],
      currentRecommendation: {
        rollbackNotes: "Remove the extra smoke check if it proves redundant.",
      },
    });

    assert.equal(result.isError, false);
    assert.equal(payload.schema, "mcp.tool.create_recommendation.output.v1");
    assert.equal(payload.status, "suggested");
    recommendationId = String(payload.recommendationId);

    const row = db
      .prepare("SELECT status, title FROM improvement_recommendations WHERE id = ?")
      .get(recommendationId) as { status: string; title: string };
    assert.equal(row.status, "suggested");
    assert.equal(row.title, "Add MCP governance proof to sprint validation");
  });

  await test("attach_evidence creates an evidence set and links it to the recommendation", async () => {
    const { result, payload } = await callTool(server, "hiverunner.evidence.attach", {
      target: { kind: "recommendation", id: recommendationId },
      evidence: [{
        id: "mcp-attached-evidence-1",
        sourceType: "eval",
        sourceId: "mcp-eval-case",
        title: "MCP governed tool proof",
        summary: "Evidence was attached through the governed MCP adapter.",
        redactionPolicy: RUN_TRACE_REDACTION_POLICY,
      }],
      summary: "Attached MCP proof evidence.",
      createdByUserId: "mcp-test",
    });

    assert.equal(result.isError, false);
    assert.equal(payload.schema, "mcp.tool.attach_evidence.output.v1");
    assert.equal(payload.attached, 1);

    const row = db
      .prepare("SELECT evidence_set_id, evidence_json FROM improvement_recommendations WHERE id = ?")
      .get(recommendationId) as { evidence_set_id: string; evidence_json: string };
    assert.equal(row.evidence_set_id, payload.evidenceSetId);
    assert.match(row.evidence_json, /mcp-attached-evidence-1/);
  });

  await test("request_approval promotes recommendations through the existing pending approval bridge only", async () => {
    const { result, payload } = await callTool(server, "hiverunner.approval.request", {
      type: "approve_ceo_strategy",
      recommendationIds: [recommendationId],
      riskNotes: "Low risk because no durable apply step is exposed by MCP.",
      rollbackNotes: "Correction path is to leave the recommendation un-applied.",
      requestedByAgentId: undefined,
    });

    assert.equal(result.isError, false);
    assert.equal(payload.schema, "mcp.tool.request_approval.output.v1");
    assert.equal(payload.status, "pending");

    const approval = db
      .prepare("SELECT status, type, payload_json FROM approvals WHERE id = ?")
      .get(payload.approvalId) as { status: string; type: string; payload_json: string };
    assert.equal(approval.status, "pending");
    assert.equal(approval.type, "approve_ceo_strategy");
    assert.match(approval.payload_json, /improvementRecommendationIds/);

    const recommendation = db
      .prepare("SELECT status, approval_id, applied_at FROM improvement_recommendations WHERE id = ?")
      .get(recommendationId) as { status: string; approval_id: string; applied_at: string | null };
    assert.equal(recommendation.status, "accepted-for-approval");
    assert.equal(recommendation.approval_id, payload.approvalId);
    assert.equal(recommendation.applied_at, null);
  });

  await test("invalid calls return structured MCP tool errors", async () => {
    const { result, payload } = await callTool(server, "hiverunner.approval.request", {
      type: "approve_ceo_strategy",
      status: "approved",
      payload: { title: "Forbidden decision attempt" },
    });

    assert.equal(result.isError, true);
    assert.equal(payload.schema, "mcp.tool.error.v1");
    assert.equal(payload.code, "approval_decision_forbidden");
  });

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
