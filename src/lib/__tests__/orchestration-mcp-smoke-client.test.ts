import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import {
  createIsolatedOrchestrationWorkspace,
  resetSqliteDatabaseFiles,
} from "@/lib/__tests__/helpers/orchestration-workspace-isolation";
import { createCompany } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { RUN_TRACE_REDACTION_POLICY } from "@/lib/orchestration/eval-cases";
import { runHiveRunnerMcpSmokeClient } from "@/lib/orchestration/mcp/smoke-client";
import {
  createProject,
  createProjectAgent,
  createTask,
} from "@/lib/orchestration/service";
import { persistExecutionTranscriptEvents } from "@/lib/orchestration/service/execution-transcript";
import { createImprovementApprovalBridgeRecommendation } from "@/lib/orchestration/service/improvement-approval";

process.env.ORCHESTRATION_DB_PATH ||= path.join(
  os.tmpdir(),
  `orchestration-mcp-smoke-client-${process.pid}-${Date.now()}.db`,
);

const { finish, test } = createTestRunner({ passLabel: "pass", failLabel: "fail" });

const SECRET_FIXTURES = [
  "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
  "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "AKIA1234567890ABCDEF",
];

function insertExecutionRun(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  runId: string;
  taskId: string;
  agentId: string;
  startedAt: string;
  completedAt: string;
}) {
  input.db.prepare(
    `INSERT INTO execution_runs
       (id, task_id, agent_id, provider, session_id, status, started_at, completed_at,
        error_message, token_usage_json, duration_ms, idempotency_key, execution_engine,
        runner_provider, runner_model, model_lane, metadata_json, created_at, updated_at)
     VALUES
       (?, ?, ?, 'codex', ?, 'completed', ?, ?, NULL, ?, 120000, ?, 'hiverunner',
        'openai', 'gpt-5.5', 'default', '{}', ?, ?)`,
  ).run(
    input.runId,
    input.taskId,
    input.agentId,
    `${input.runId}-session`,
    input.startedAt,
    input.completedAt,
    JSON.stringify({
      runnerProvider: "openai",
      runnerModel: "gpt-5.5",
      inputTokens: 200,
      outputTokens: 80,
      totalCostUsd: 0.02,
      structuredTelemetry: true,
      observedLiveText: true,
      source: "mcp-smoke-fixture",
    }),
    input.runId,
    input.startedAt,
    input.completedAt,
  );

  persistExecutionTranscriptEvents({
    db: input.db,
    executionRunId: input.runId,
    provider: "codex",
    occurredAt: input.completedAt,
    events: [
      {
        kind: "assistant_text_final",
        role: "assistant",
        title: "MCP smoke redaction fixture",
        body: [
          "Finished the MCP smoke proof.",
          `The raw trace fixture includes ${SECRET_FIXTURES[0]}.`,
          `It also includes ${SECRET_FIXTURES[1]} and ${SECRET_FIXTURES[2]}.`,
        ].join(" "),
        occurredAt: input.completedAt,
      },
    ],
  });
}

function payloadFor<T>(payloads: Record<string, unknown>, key: string): T {
  const payload = payloads[key];
  assert.ok(payload, `missing payload for ${key}`);
  return payload as T;
}

function assertNoSecretFixtures(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of SECRET_FIXTURES) {
    assert.equal(serialized.includes(secret), false, `secret fixture leaked: ${secret}`);
  }
}

async function run() {
  console.log("\nHiveRunner MCP Smoke Client Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  resetSqliteDatabaseFiles(dbPath);
  const isolation = createIsolatedOrchestrationWorkspace({ prefix: "orchestration-mcp-smoke-" });

  try {
    const company = createCompany({
      name: "Insight MCP Smoke",
      description: "MCP smoke client test fixture.",
      status: "active",
    }).company;
    const otherCompany = createCompany({
      name: "Other MCP Smoke",
      description: "Company-scope negative fixture.",
      status: "active",
    }).company;
    const project = createProject({
      companyId: company.id,
      name: "MCP Smoke Project",
      description: "Fixture project for stdio smoke client verification.",
      color: "#2563eb",
      emoji: "icon:flame",
      status: "active",
    }).project;
    const agent = createProjectAgent({
      projectId: project.id,
      name: "MCP Smoke Agent",
      emoji: "icon:bot",
      role: "Smoke verifier",
      personality: "Verifies MCP smoke flows.",
      adapterType: "codex",
      skills: ["mcp"],
      status: "idle",
    }).agent;
    const task = createTask({
      projectId: project.id,
      title: "Verify MCP smoke client",
      description: "Fixture task for MCP smoke-client tests.",
      priority: "P1",
      type: "research",
      status: "review",
      assignee: agent.id,
      labels: ["mcp", "smoke"],
      createdBy: "test",
    }).task;

    const db = getOrchestrationDb();
    isolation.syncDatabase(db);

    const taskKey = task.key ?? task.id;
    const runId = `mcp-smoke-run-${randomUUID()}`;
    insertExecutionRun({
      db,
      runId,
      taskId: task.id,
      agentId: agent.id,
      startedAt: "2026-06-07T18:00:00.000Z",
      completedAt: "2026-06-07T18:02:00.000Z",
    });

    const existingRecommendation = createImprovementApprovalBridgeRecommendation({
      companyIdOrSlug: company.id,
      triggerKey: "reviewer_request",
      scopeType: "project",
      scopeKey: project.id,
      title: "Promote MCP smoke proof through approval",
      rationale: "The smoke client should demonstrate approval-safe recommendation promotion.",
      proposedChange: "Keep the MCP smoke transcript in the promotion package.",
      severity: "high",
      confidence: "high",
      evidence: [
        {
          id: "mcp-smoke-existing-evidence",
          sourceType: "trace",
          sourceId: runId,
          summary: "Existing recommendation fixture for approval request.",
          redactionPolicy: RUN_TRACE_REDACTION_POLICY,
        },
      ],
      idempotencyKey: "mcp-smoke-existing-recommendation",
    }, db).recommendation;

    const root = `hiverunner://${company.code}`;
    const traceExportUri = `${root}/runs/${encodeURIComponent(runId)}/trace/export`;
    const transcriptPath =
      process.env.HIVERUNNER_MCP_SMOKE_TRANSCRIPT_PATH
      ?? path.join(isolation.tempRoot, "artifacts", "mcp-smoke-transcript.json");

    const result = await runHiveRunnerMcpSmokeClient({
      company: company.code,
      actorName: "MCP Smoke Test",
      cwd: process.cwd(),
      env: {
        ORCHESTRATION_DB_PATH: dbPath,
        MC_WORKSPACE_ROOT: process.env.MC_WORKSPACE_ROOT,
        OPENCLAW_DIR: process.env.OPENCLAW_DIR,
        OPENCLAW_WORKSPACE_ROOT: process.env.OPENCLAW_WORKSPACE_ROOT,
        NODE_ENV: "test",
      },
      transcriptPath,
      readResourceUris: [
        `${root}/mcp/capabilities`,
        `${root}/tasks`,
        `${root}/tasks/${encodeURIComponent(taskKey)}`,
        traceExportUri,
      ],
      toolCalls: [
        {
          label: "positive-create-recommendation",
          name: "hiverunner.improve.create_recommendation",
          arguments: {
            triggerClass: "reviewer_request",
            scope: { type: "project", key: project.id },
            title: "Add deterministic MCP smoke transcript",
            rationale: "The MCP smoke client should leave operator-visible proof.",
            proposedChange: "Keep the stdio smoke transcript in the verification package.",
            severity: "medium",
            confidence: "high",
            evidence: [
              {
                id: "mcp-smoke-created-evidence",
                sourceType: "trace",
                sourceId: runId,
                summary: "Smoke client read the redacted trace export.",
                redactionPolicy: RUN_TRACE_REDACTION_POLICY,
              },
            ],
            idempotencyKey: "mcp-smoke-created-recommendation",
          },
        },
        {
          label: "positive-attach-evidence",
          name: "hiverunner.evidence.attach",
          arguments: {
            target: { kind: "recommendation", id: existingRecommendation.id },
            evidence: [
              {
                id: "mcp-smoke-attached-evidence",
                sourceType: "trace",
                sourceId: runId,
                title: "MCP smoke trace export",
                summary: "The smoke client attached redacted proof evidence.",
                redactionPolicy: RUN_TRACE_REDACTION_POLICY,
              },
            ],
            summary: "Attached smoke-client proof evidence.",
            createdByUserId: "mcp-smoke-test",
          },
        },
        {
          label: "positive-request-approval",
          name: "hiverunner.approval.request",
          arguments: {
            type: "approve_ceo_strategy",
            recommendationIds: [existingRecommendation.id],
            riskNotes: "Approval request only; MCP exposes no decision path.",
            rollbackNotes: "Leave the recommendation pending or reject it in the UI.",
          },
        },
        {
          label: "validation-error",
          name: "hiverunner.evidence.attach",
          arguments: {
            target: { kind: "recommendation", id: existingRecommendation.id },
            evidence: [{ summary: "Missing required redaction policy." }],
          },
        },
        {
          label: "company-scope-error",
          name: "hiverunner.improve.create_recommendation",
          arguments: {
            companyCode: otherCompany.code,
            scope: { type: "project", key: project.id },
            title: "Company mismatch should not write",
          },
        },
        {
          label: "approval-decision-forbidden",
          name: "hiverunner.approval.request",
          arguments: {
            type: "approve_ceo_strategy",
            status: "approved",
            payload: { title: "Forbidden decision attempt" },
          },
        },
      ],
    });

    await test("stdio smoke client captures initialize, resources, tools, and governed calls", () => {
      assert.equal(result.transcript.schema, "hiverunner.mcp.smoke_transcript.v1");
      assert.equal(result.transcript.server.name, "hiverunner");
      assert.equal(result.transcript.summary.resourceCount, 13);
      assert.equal(result.transcript.summary.toolCount, 4);
      assert.equal(result.transcript.summary.resourceReadCount, 4);
      assert.equal(result.transcript.summary.toolCallCount, 6);
      assert.equal(result.transcript.summary.successfulToolCallCount, 3);
      assert.equal(result.transcript.summary.errorToolCallCount, 3);
      assert.equal(result.transcript.summary.credentialFixturesPresent, false);

      const operationNames = result.transcript.operations.map((operation) => operation.name);
      assert.deepEqual(operationNames.slice(0, 4), [
        "initialize",
        "resources/list",
        "resources/read",
        "resources/read",
      ]);
      assert.ok(operationNames.includes("tools/list"));
      assert.equal(
        result.transcript.operations.filter((operation) => operation.name === "tools/call").length,
        6,
      );
    });

    await test("representative resource reads are company-scoped and redacted", () => {
      const capabilities = payloadFor<{ schema: string; company: { code: string } }>(
        result.resourcePayloads,
        `${root}/mcp/capabilities`,
      );
      const tasks = payloadFor<{ schema: string; tasks: Array<{ id: string }> }>(
        result.resourcePayloads,
        `${root}/tasks`,
      );
      const taskPayload = payloadFor<{ schema: string; task: { id: string } }>(
        result.resourcePayloads,
        `${root}/tasks/${encodeURIComponent(taskKey)}`,
      );
      const traceExport = payloadFor<{
        schema: string;
        summary: { runId: string };
        redaction: { policy: string; totalRedactions: number };
      }>(result.resourcePayloads, traceExportUri);

      assert.equal(capabilities.schema, "mcp.capabilities.v1");
      assert.equal(capabilities.company.code, company.code);
      assert.equal(tasks.schema, "mcp.tasks.v1");
      assert.ok(tasks.tasks.some((item) => item.id === task.id));
      assert.equal(taskPayload.schema, "mcp.task.v1");
      assert.equal(taskPayload.task.id, task.id);
      assert.equal(traceExport.schema, "hiverunner.run_trace_redacted_export.v1");
      assert.equal(traceExport.summary.runId, runId);
      assert.equal(traceExport.redaction.policy, RUN_TRACE_REDACTION_POLICY);
      assert.ok(traceExport.redaction.totalRedactions >= 4);
      assertNoSecretFixtures(traceExport);
    });

    await test("validation, company-scope, and approval governance errors are explicit", () => {
      const validation = payloadFor<{ schema: string; code: string }>(result.toolPayloads, "validation-error");
      const companyScope = payloadFor<{ schema: string; code: string }>(result.toolPayloads, "company-scope-error");
      const forbidden = payloadFor<{ schema: string; code: string }>(
        result.toolPayloads,
        "approval-decision-forbidden",
      );
      const approval = payloadFor<{
        schema: string;
        status: string;
        approvalId: string;
        governance: { mode: string; durableStateMutated: boolean; decisionExposed: boolean };
      }>(result.toolPayloads, "positive-request-approval");

      assert.equal(validation.schema, "mcp.tool.error.v1");
      assert.equal(validation.code, "validation_error");
      assert.equal(companyScope.schema, "mcp.tool.error.v1");
      assert.equal(companyScope.code, "company_mismatch");
      assert.equal(forbidden.schema, "mcp.tool.error.v1");
      assert.equal(forbidden.code, "approval_decision_forbidden");

      assert.equal(approval.schema, "mcp.tool.request_approval.output.v1");
      assert.equal(approval.status, "pending");
      assert.equal(approval.governance.mode, "approval_request");
      assert.equal(approval.governance.durableStateMutated, false);
      assert.equal(approval.governance.decisionExposed, false);

      const approvalRow = db
        .prepare("SELECT status, type FROM approvals WHERE id = ?")
        .get(approval.approvalId) as { status: string; type: string };
      assert.equal(approvalRow.status, "pending");
      assert.equal(approvalRow.type, "approve_ceo_strategy");

      const promotedRecommendation = db
        .prepare("SELECT status, approval_id, applied_at FROM improvement_recommendations WHERE id = ?")
        .get(existingRecommendation.id) as { status: string; approval_id: string; applied_at: string | null };
      assert.equal(promotedRecommendation.status, "accepted-for-approval");
      assert.equal(promotedRecommendation.approval_id, approval.approvalId);
      assert.equal(promotedRecommendation.applied_at, null);

      const mismatchWrites = db
        .prepare("SELECT COUNT(*) AS count FROM improvement_recommendations WHERE company_id = ? AND title = ?")
        .get(otherCompany.id, "Company mismatch should not write") as { count: number };
      assert.equal(mismatchWrites.count, 0);
    });

    await test("smoke transcript artifact is deterministic and safe to publish", () => {
      assert.equal(existsSync(transcriptPath), true);
      const transcript = JSON.parse(readFileSync(transcriptPath, "utf8")) as typeof result.transcript;
      assert.equal(transcript.schema, "hiverunner.mcp.smoke_transcript.v1");
      assert.equal(transcript.summary.resourceReadCount, 4);
      assert.equal(transcript.summary.successfulToolCallCount, 3);
      assert.equal(transcript.summary.credentialFixturesPresent, false);
      assertNoSecretFixtures(transcript);
    });
  } finally {
    isolation.dispose();
  }

  finish();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
