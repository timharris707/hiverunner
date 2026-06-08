import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type Database from "better-sqlite3";
import { z, ZodError } from "zod";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-resolver";
import {
  assertRedactedSnapshot,
  createEvalCase,
  RUN_TRACE_REDACTION_POLICY,
  type EvalCaseReviewOutcome,
} from "@/lib/orchestration/eval-cases";
import {
  attachImprovementEvidence,
  type ImproveEvidenceInput,
} from "@/lib/orchestration/improvement-recommendations";
import type { McpRequestContext } from "@/lib/orchestration/mcp/context";
import {
  type HiveRunnerMcpToolName,
  normalizeMcpCompanyCode,
} from "@/lib/orchestration/mcp/registry";
import {
  buildCanonicalActivityPath,
  buildCanonicalCompanyPath,
  buildApprovalDetailPath,
  buildCanonicalEvalCasePath,
  buildCanonicalEvalsPath,
  buildCanonicalImprovePath,
  buildTaskRunTracePath,
} from "@/lib/orchestration/route-paths";
import { createApproval } from "@/lib/orchestration/service/approval";
import {
  acceptImprovementRecommendationsForApproval,
  createImprovementApprovalBridgeRecommendation,
} from "@/lib/orchestration/service/improvement-approval";
import type {
  ApprovalType,
  OrchestrationImprovementConfidence,
  OrchestrationImprovementScopeType,
  OrchestrationImprovementSeverity,
  OrchestrationImprovementTriggerKey,
} from "@/lib/orchestration/types";
import type {
  RunTraceAnnotationSnapshot,
  RunTraceCaptureQuality,
  RunTraceEvidenceGap,
  RunTraceRedactedExport,
} from "@/lib/orchestration/run-trace";

type ToolInput = {
  name: HiveRunnerMcpToolName;
  args: Record<string, unknown>;
  context: McpRequestContext;
};

type McpEvalSourceRunRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  provider: string;
  execution_engine: "hiverunner" | "symphony" | "manual" | null;
  runner_provider: string | null;
  runner_model: string | null;
  status: string;
  token_usage_json: string;
  task_title: string | null;
  task_key: string | null;
  task_status: string | null;
  task_type: string | null;
  task_sprint_id: string | null;
  project_id: string | null;
  company_id: string | null;
  company_slug: string | null;
  company_code: string | null;
  agent_name: string | null;
  sprint_key: string | null;
  company_goal_id: string | null;
  company_goal_key: string | null;
  source_template_version_id: string | null;
  template_intake_answer_id: string | null;
};

const approvalTypes = [
  "hire_agent",
  "approve_ceo_strategy",
  "budget_override_required",
  "provider_switch",
  "protected_runtime_command",
] as const satisfies readonly ApprovalType[];

const triggerKeys = [
  "severe_single_failure",
  "repeated_review_return",
  "missing_capability",
  "missing_tool_runtime",
  "template_drift",
  "runner_mismatch",
  "reviewer_request",
] as const satisfies readonly OrchestrationImprovementTriggerKey[];

const scopeTypes = [
  "company",
  "project",
  "template",
  "task_type",
  "agent",
  "runner",
  "recommendation",
] as const satisfies readonly OrchestrationImprovementScopeType[];

const severities = ["low", "medium", "high", "critical"] as const satisfies readonly OrchestrationImprovementSeverity[];
const confidences = ["low", "medium", "high"] as const satisfies readonly OrchestrationImprovementConfidence[];
const captureQualities = ["complete", "partial", "minimal", "failed"] as const satisfies readonly RunTraceCaptureQuality[];
const reviewOutcomes = ["accepted", "returned", "rejected", "blocked"] as const satisfies readonly EvalCaseReviewOutcome[];

const unknownRecordSchema = z.record(z.string(), z.unknown());
const nullableTextSchema = z.string().trim().min(1).nullable().optional();

const saveEvalCaseSchema = z.object({
  companyCode: z.string().trim().min(1).optional(),
  projectId: nullableTextSchema,
  sourceTask: z.object({
    id: z.string().trim().min(1),
    key: z.string().trim().min(1),
    title: z.string().trim().min(1),
    type: nullableTextSchema,
  }),
  sourceRun: z.object({
    id: z.string().trim().min(1),
    traceRoute: z.string().trim().min(1),
    executionEngine: z.enum(["hiverunner", "symphony", "manual"]).nullable().optional(),
    runnerProvider: nullableTextSchema,
    providerId: nullableTextSchema,
    runnerModel: nullableTextSchema,
    agentId: nullableTextSchema,
    agentName: nullableTextSchema,
  }),
  sourceSprint: z.object({
    id: nullableTextSchema,
    key: nullableTextSchema,
  }).nullable().optional(),
  sourceGoal: z.object({
    id: nullableTextSchema,
    key: nullableTextSchema,
  }).nullable().optional(),
  templateContext: unknownRecordSchema.nullable().optional(),
  sourceTemplateVersionId: nullableTextSchema,
  templateIntakeAnswerId: nullableTextSchema,
  review: z.object({
    outcome: z.enum(reviewOutcomes),
    rationale: z.string().trim().min(1),
    notes: nullableTextSchema,
    reviewerAgentId: nullableTextSchema,
    reviewerName: nullableTextSchema,
    reviewedAt: nullableTextSchema,
  }),
  captureQuality: z.enum(captureQualities),
  evidenceGaps: z.array(z.unknown()).optional().default([]),
  annotationSnapshot: z.unknown().nullable().optional(),
  redactedSnapshot: z.unknown(),
  version: z.number().int().positive().optional(),
  parentEvalCaseId: nullableTextSchema,
  idempotencyKey: nullableTextSchema,
  createdByAgentId: nullableTextSchema,
  createdByUserId: nullableTextSchema,
});

const evidenceItemSchema = z.object({
  id: nullableTextSchema,
  sourceType: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  sourceId: nullableTextSchema,
  title: nullableTextSchema,
  summary: z.string().trim().min(1),
  redactionPolicy: z.literal(RUN_TRACE_REDACTION_POLICY),
  occurredAt: nullableTextSchema,
  route: nullableTextSchema,
  href: nullableTextSchema,
  metadata: unknownRecordSchema.optional(),
}).passthrough();

const attachEvidenceSchema = z.object({
  companyCode: z.string().trim().min(1).optional(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("recommendation"), id: z.string().trim().min(1) }),
    z.object({ kind: z.literal("eval_case"), id: z.string().trim().min(1) }),
  ]),
  evidence: z.array(evidenceItemSchema).min(1),
  summary: nullableTextSchema,
  evidenceStrength: z.enum(["single", "pattern", "manual", "unknown"]).optional(),
  createdByAgentId: nullableTextSchema,
  createdByUserId: nullableTextSchema,
});

const createRecommendationSchema = z.object({
  companyCode: z.string().trim().min(1).optional(),
  triggerClass: z.enum(triggerKeys).optional(),
  triggerKey: z.enum(triggerKeys).optional(),
  scope: z.object({
    type: z.enum(scopeTypes),
    key: z.string().trim().min(1),
  }),
  title: z.string().trim().min(1).max(240),
  rationale: z.string().trim().max(4000).optional(),
  proposedChange: z.string().trim().max(4000).optional(),
  severity: z.enum(severities).optional(),
  confidence: z.enum(confidences).optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).optional(),
  originalRecommendation: unknownRecordSchema.optional(),
  currentRecommendation: unknownRecordSchema.optional(),
  idempotencyKey: nullableTextSchema,
  createdByAgentId: nullableTextSchema,
  createdByUserId: nullableTextSchema,
});

const requestApprovalSchema = z.object({
  companyCode: z.string().trim().min(1).optional(),
  type: z.enum(approvalTypes),
  payload: unknownRecordSchema.optional(),
  linkedTaskId: nullableTextSchema,
  linkedTaskKey: nullableTextSchema,
  recommendationIds: z.array(z.string().trim().min(1)).optional(),
  riskNotes: z.string().trim().min(1).optional(),
  rollbackNotes: z.string().trim().min(1).optional(),
  acceptanceNote: nullableTextSchema,
  title: z.string().trim().min(1).max(240).optional(),
  proposedChangeSummary: z.string().trim().max(4000).optional(),
  rationale: z.string().trim().max(4000).optional(),
  preview: unknownRecordSchema.optional(),
  requestedByAgentId: nullableTextSchema,
  acceptedByUserId: nullableTextSchema,
  approverAgentId: nullableTextSchema,
  approvalRouteReason: nullableTextSchema,
}).passthrough();

function jsonResult(payload: unknown, isError = false): CallToolResult {
  return {
    isError,
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(code: string, message: string, details?: unknown): CallToolResult {
  return jsonResult({
    schema: "mcp.tool.error.v1",
    code,
    message,
    ...(details === undefined ? {} : { details }),
  }, true);
}

function parseArgs<T>(schema: z.ZodType<T>, args: Record<string, unknown>): T {
  return schema.parse(args);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function resolveToolCompany(input: { requestedCompany?: string; context: McpRequestContext }): McpRequestContext {
  const requested = input.requestedCompany?.trim();
  if (!requested) return input.context;

  const normalized = normalizeMcpCompanyCode(requested);
  const matchesLaunchCompany = requested === input.context.companyId
    || requested === input.context.companySlug
    || normalized === input.context.companyCode;
  if (matchesLaunchCompany) return input.context;

  const resolved = resolveCompanyIdBySlug(requested, input.context.db, { includeArchived: false });
  if (resolved?.id === input.context.companyId) return input.context;

  throw new OrchestrationApiError(
    400,
    "company_mismatch",
    "MCP tool calls must target the company selected when the local MCP server was launched",
  );
}

function evalLinks(input: {
  context: McpRequestContext;
  evalCaseId: string;
  traceRoute: string;
}) {
  return {
    evalCase: buildCanonicalEvalCasePath(input.context.companyCode, input.evalCaseId),
    evalsLibrary: buildCanonicalEvalsPath(input.context.companyCode),
    runTrace: input.traceRoute,
  };
}

function fetchMcpEvalSourceRun(input: {
  db: Database.Database;
  companyId: string;
  runId: string;
}): McpEvalSourceRunRow | null {
  return input.db
    .prepare(
      `SELECT
         r.id, r.task_id, r.agent_id, r.provider, r.execution_engine, r.runner_provider,
         r.runner_model, r.status, r.token_usage_json,
         t.title AS task_title, t.task_key, t.status AS task_status, t.type AS task_type,
         t.sprint_id AS task_sprint_id,
         p.id AS project_id,
         c.id AS company_id, c.slug AS company_slug, c.company_code,
         a.name AS agent_name,
         s.sprint_key AS sprint_key,
         parent_s.id AS company_goal_id, parent_s.goal_key AS company_goal_key,
         COALESCE(r.source_template_version_id, t.source_template_version_id, s.source_template_version_id, parent_s.source_template_version_id) AS source_template_version_id,
         COALESCE(r.template_intake_answer_id, t.template_intake_answer_id, s.template_intake_answer_id, parent_s.template_intake_answer_id) AS template_intake_answer_id
       FROM execution_runs r
       LEFT JOIN tasks t ON t.id = r.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN agents a ON a.id = r.agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
       WHERE r.id = ?
         AND c.id = ?
       LIMIT 1`,
    )
    .get(input.runId, input.companyId) as McpEvalSourceRunRow | undefined ?? null;
}

function requireMcpEvalSourceContext(row: McpEvalSourceRunRow): {
  companyId: string;
  companySlug: string;
  companyCode: string;
  projectId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
} {
  const companyId = textValue(row.company_id);
  const companySlug = textValue(row.company_slug);
  const companyCode = textValue(row.company_code) ?? companySlug?.toUpperCase();
  const projectId = textValue(row.project_id);
  const taskId = textValue(row.task_id);
  const taskKey = textValue(row.task_key) ?? taskId;
  const taskTitle = textValue(row.task_title);

  if (!companyId || !companySlug || !companyCode || !projectId || !taskId || !taskKey || !taskTitle) {
    throw new OrchestrationApiError(
      409,
      "ambiguous_run_context",
      "Run must resolve to one source task, project, and company before it can be saved as an eval case",
    );
  }

  return { companyId, companySlug, companyCode, projectId, taskId, taskKey, taskTitle };
}

function assertMcpSourcePayloadMatches(input: {
  row: McpEvalSourceRunRow;
  sourceTask: { id: string; key: string };
}): void {
  if (input.row.task_id !== input.sourceTask.id || input.row.task_key !== input.sourceTask.key) {
    throw new OrchestrationApiError(
      409,
      "source_mismatch",
      "MCP eval save sourceTask must match the persisted source run task",
    );
  }
}

function isTerminalExecutionStatus(status: string): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function hasReturnedReviewEvent(input: {
  db: Database.Database;
  taskId: string | null;
  runId: string;
}): boolean {
  if (!input.taskId) return false;
  const event = input.db
    .prepare(
      `SELECT id
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.status_changed'
         AND from_status = 'review'
         AND to_status IN ('in_progress', 'to-do')
         AND json_extract(metadata_json, '$.runId') = ?
       LIMIT 1`,
    )
    .get(input.taskId, input.runId) as { id: string } | undefined;
  return Boolean(event);
}

function assertMcpEvalSaveGovernance(input: {
  db: Database.Database;
  row: McpEvalSourceRunRow;
  review: {
    outcome: EvalCaseReviewOutcome;
    reviewerAgentId?: string | null;
    reviewerName?: string | null;
  };
  createdByUserId?: string | null;
}): void {
  if (!isTerminalExecutionStatus(input.row.status)) {
    throw new OrchestrationApiError(
      409,
      "run_not_terminal",
      "Run must be terminal before it can be saved as an eval case",
    );
  }

  const taskStatus = input.row.task_status;
  const reviewedByState = taskStatus === "review" || taskStatus === "done" || taskStatus === "blocked";
  const returnedByReviewEvent = input.review.outcome === "returned"
    && hasReturnedReviewEvent({ db: input.db, taskId: input.row.task_id, runId: input.row.id });
  const hasReviewer = Boolean(
    textValue(input.review.reviewerAgentId)
    || textValue(input.review.reviewerName)
    || textValue(input.createdByUserId),
  );

  if (!hasReviewer) {
    throw new OrchestrationApiError(
      400,
      "unreviewed_run",
      "Saving an eval case requires reviewer identity or operator user identity",
    );
  }

  if (!reviewedByState && !returnedByReviewEvent) {
    throw new OrchestrationApiError(
      409,
      "unreviewed_run",
      "Run must be reviewed before it can be saved as an eval case",
    );
  }
}

function assertMcpSnapshotMatchesSource(input: {
  redactedSnapshot: RunTraceRedactedExport;
  runId: string;
  taskKey: string;
}): void {
  const snapshotRunId = textValue(input.redactedSnapshot.summary?.runId)
    ?? textValue(input.redactedSnapshot.run?.id);
  const snapshotTaskKey = textValue(input.redactedSnapshot.summary?.taskKey)
    ?? textValue(input.redactedSnapshot.task?.key);

  if (snapshotRunId && snapshotRunId !== input.runId) {
    throw new OrchestrationApiError(
      409,
      "source_mismatch",
      "MCP eval save redactedSnapshot run id must match the persisted source run",
    );
  }
  if (snapshotTaskKey && snapshotTaskKey !== input.taskKey) {
    throw new OrchestrationApiError(
      409,
      "source_mismatch",
      "MCP eval save redactedSnapshot task key must match the persisted source task",
    );
  }
}

function recordMcpEvalCaseActivity(input: {
  db: Database.Database;
  evalCase: ReturnType<typeof createEvalCase>;
  row: McpEvalSourceRunRow;
  projectId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  companyCode: string;
  links: {
    activity: string;
    evalCase: string;
    evalsLibrary: string;
    runTrace: string;
  };
}): void {
  const evalCase = input.evalCase;
  const metadata = {
    schema: "hiverunner.eval_case_activity.v1",
    source: "mcp_tool",
    evalCaseId: evalCase.id,
    evalCaseVersion: evalCase.version,
    reviewOutcome: evalCase.review.outcome,
    links: input.links,
    sourceTask: {
      id: input.taskId,
      key: input.taskKey,
      title: input.taskTitle,
      route: buildCanonicalCompanyPath(input.companyCode, `/tasks/${encodeURIComponent(input.taskKey)}`),
    },
    sourceRun: {
      id: evalCase.sourceRun.id,
      traceRoute: evalCase.sourceRun.traceRoute,
      executionEngine: evalCase.sourceRun.executionEngine,
      runnerProvider: evalCase.sourceRun.runnerProvider,
      providerId: evalCase.sourceRun.providerId,
      runnerModel: evalCase.sourceRun.runnerModel,
      agentId: evalCase.sourceRun.agentId,
      agentName: evalCase.sourceRun.agentName,
    },
    reviewer: {
      agentId: evalCase.review.reviewerAgentId,
      name: evalCase.review.reviewerName,
      reviewedAt: evalCase.review.reviewedAt,
      createdByAgentId: evalCase.createdByAgentId,
      createdByUserId: evalCase.createdByUserId,
    },
    snapshotEvidence: {
      schema: evalCase.redactedSnapshot.schema,
      sha256: evalCase.snapshotSha256,
      route: `${input.links.evalCase}#snapshot`,
      redactionPolicy: evalCase.redactedSnapshot.redaction?.policy ?? null,
      redactionCount: evalCase.redactedSnapshot.redaction?.totalRedactions ?? 0,
      captureQuality: evalCase.captureQuality,
      evidenceGapCount: evalCase.evidenceGaps.length,
      annotationState: evalCase.annotationSnapshot.state,
    },
  };

  input.db
    .prepare(
      `INSERT OR IGNORE INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'task.eval_case_saved', ?, ?)`,
    )
    .run(
      `eval-case:${evalCase.id}:saved`,
      input.projectId,
      input.taskId,
      evalCase.review.reviewerAgentId ?? evalCase.createdByAgentId,
      evalCase.createdByUserId,
      JSON.stringify(metadata),
      evalCase.createdAt,
    );
}

function improveLink(context: McpRequestContext, recommendationId?: string | null): string {
  const base = buildCanonicalImprovePath(context.companyCode);
  return recommendationId ? `${base}?recommendation=${encodeURIComponent(recommendationId)}` : base;
}

function resolveLinkedTaskId(input: {
  context: McpRequestContext;
  linkedTaskId?: string | null;
  linkedTaskKey?: string | null;
}): string | undefined {
  if (input.linkedTaskId) {
    const row = input.context.db
      .prepare(
        `SELECT t.id
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.id = ?
           AND p.company_id = ?
           AND t.archived_at IS NULL
           AND p.archived_at IS NULL
         LIMIT 1`,
      )
      .get(input.linkedTaskId, input.context.companyId) as { id: string } | undefined;
    if (!row) {
      throw new OrchestrationApiError(404, "linked_task_not_found", "Linked task not found in this company");
    }
    return row.id;
  }

  if (!input.linkedTaskKey) return undefined;
  const row = input.context.db
    .prepare(
      `SELECT t.id
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.task_key = ?
         AND p.company_id = ?
         AND t.archived_at IS NULL
         AND p.archived_at IS NULL
       LIMIT 1`,
    )
    .get(input.linkedTaskKey, input.context.companyId) as { id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "linked_task_not_found", "Linked task not found in this company");
  }
  return row.id;
}

function saveEvalCase(args: Record<string, unknown>, context: McpRequestContext): CallToolResult {
  const parsed = parseArgs(saveEvalCaseSchema, args);
  const toolContext = resolveToolCompany({ requestedCompany: parsed.companyCode, context });
  const redactedSnapshot = parsed.redactedSnapshot as RunTraceRedactedExport;
  assertRedactedSnapshot(redactedSnapshot, safeJson(redactedSnapshot));
  const row = fetchMcpEvalSourceRun({
    db: toolContext.db,
    companyId: toolContext.companyId,
    runId: parsed.sourceRun.id,
  });
  if (!row) {
    throw new OrchestrationApiError(404, "run_not_found", "Source run not found in this company");
  }
  const sourceContext = requireMcpEvalSourceContext(row);
  assertMcpSourcePayloadMatches({ row, sourceTask: parsed.sourceTask });
  assertMcpEvalSaveGovernance({
    db: toolContext.db,
    row,
    review: parsed.review,
    createdByUserId: parsed.createdByUserId,
  });
  assertMcpSnapshotMatchesSource({
    redactedSnapshot,
    runId: row.id,
    taskKey: sourceContext.taskKey,
  });
  const usageForSourceRun = parseJsonRecord(row.token_usage_json);
  const traceRoute = buildTaskRunTracePath({
    companyCode: sourceContext.companyCode,
    companySlug: sourceContext.companySlug,
    taskKey: sourceContext.taskKey,
    runId: row.id,
  });
  const sourceTemplateVersionId = parsed.sourceTemplateVersionId ?? row.source_template_version_id;
  const templateIntakeAnswerId = parsed.templateIntakeAnswerId ?? row.template_intake_answer_id;

  const evalCase = createEvalCase({
    companyId: toolContext.companyId,
    projectId: sourceContext.projectId,
    sourceTask: {
      id: sourceContext.taskId,
      key: sourceContext.taskKey,
      title: sourceContext.taskTitle,
      type: row.task_type,
    },
    sourceRun: {
      id: row.id,
      traceRoute,
      executionEngine: row.execution_engine ?? (row.provider === "symphony" ? "symphony" : "hiverunner"),
      runnerProvider: row.runner_provider ?? textValue(usageForSourceRun.runnerProvider) ?? row.provider,
      providerId: row.provider,
      runnerModel: row.runner_model ?? textValue(usageForSourceRun.runnerModel),
      agentId: row.agent_id,
      agentName: row.agent_name,
    },
    sourceSprint: {
      id: row.task_sprint_id,
      key: row.sprint_key,
    },
    sourceGoal: {
      id: row.company_goal_id,
      key: row.company_goal_key,
    },
    templateContext: parsed.templateContext,
    sourceTemplateVersionId,
    templateIntakeAnswerId,
    review: parsed.review,
    captureQuality: parsed.captureQuality,
    evidenceGaps: parsed.evidenceGaps as RunTraceEvidenceGap[],
    annotationSnapshot: parsed.annotationSnapshot as RunTraceAnnotationSnapshot | null | undefined,
    redactedSnapshot,
    version: parsed.version,
    parentEvalCaseId: parsed.parentEvalCaseId,
    idempotencyKey: parsed.idempotencyKey,
    createdByAgentId: parsed.createdByAgentId,
    createdByUserId: parsed.createdByUserId,
  }, toolContext.db);
  const links = {
    activity: `${buildCanonicalActivityPath(sourceContext.companyCode)}?evalCase=${encodeURIComponent(evalCase.id)}`,
    ...evalLinks({
      context: toolContext,
      evalCaseId: evalCase.id,
      traceRoute,
    }),
  };
  recordMcpEvalCaseActivity({
    db: toolContext.db,
    evalCase,
    row,
    projectId: sourceContext.projectId,
    taskId: sourceContext.taskId,
    taskKey: sourceContext.taskKey,
    taskTitle: sourceContext.taskTitle,
    companyCode: sourceContext.companyCode,
    links,
  });

  return jsonResult({
    schema: "mcp.tool.save_eval_case.output.v1",
    evalCaseId: evalCase.id,
    snapshotSha256: evalCase.snapshotSha256,
    links,
    governance: {
      mode: "append_only",
      durableStateMutated: true,
      approvalRequired: false,
    },
  });
}

function attachEvidence(args: Record<string, unknown>, context: McpRequestContext): CallToolResult {
  const parsed = parseArgs(attachEvidenceSchema, args);
  const toolContext = resolveToolCompany({ requestedCompany: parsed.companyCode, context });
  const result = attachImprovementEvidence({
    companyId: toolContext.companyId,
    target: parsed.target,
    evidence: parsed.evidence as ImproveEvidenceInput[],
    summary: parsed.summary ?? undefined,
    evidenceStrength: parsed.evidenceStrength,
    createdByAgentId: parsed.createdByAgentId ?? undefined,
    createdByUserId: parsed.createdByUserId ?? undefined,
  }, toolContext.db);

  return jsonResult({
    schema: "mcp.tool.attach_evidence.output.v1",
    evidenceSetId: result.evidenceSet.id,
    attached: result.evidenceSet.evidenceItems.length,
    target: result.target,
    links: {
      target: result.target.kind === "recommendation"
        ? improveLink(toolContext, result.target.id)
        : buildCanonicalEvalCasePath(toolContext.companyCode, result.target.id),
      improve: improveLink(toolContext, result.recommendation?.id),
    },
    governance: {
      mode: "append_only",
      durableStateMutated: true,
      approvalRequired: false,
    },
  });
}

function createRecommendation(args: Record<string, unknown>, context: McpRequestContext): CallToolResult {
  const parsed = parseArgs(createRecommendationSchema, args);
  const toolContext = resolveToolCompany({ requestedCompany: parsed.companyCode, context });
  const triggerKey = parsed.triggerKey ?? parsed.triggerClass ?? "reviewer_request";
  const result = createImprovementApprovalBridgeRecommendation({
    companyIdOrSlug: toolContext.companyId,
    triggerKey,
    scopeType: parsed.scope.type,
    scopeKey: parsed.scope.key,
    title: parsed.title,
    rationale: parsed.rationale,
    proposedChange: parsed.proposedChange,
    severity: parsed.severity,
    confidence: parsed.confidence,
    evidence: parsed.evidence,
    originalRecommendation: parsed.originalRecommendation,
    currentRecommendation: {
      ...(parsed.currentRecommendation ?? {}),
      source: "mcp_tool",
      triggerClass: parsed.triggerClass ?? triggerKey,
    },
    createdByAgentId: parsed.createdByAgentId ?? undefined,
    createdByUserId: parsed.createdByUserId ?? undefined,
    idempotencyKey: parsed.idempotencyKey ?? undefined,
    db: toolContext.db,
  });

  return jsonResult({
    schema: "mcp.tool.create_recommendation.output.v1",
    recommendationId: result.recommendation.id,
    status: result.recommendation.status,
    improveHref: improveLink(toolContext, result.recommendation.id),
    governance: {
      mode: "append_only_suggestion",
      durableStateMutated: true,
      approvalRequiredForApply: true,
    },
  });
}

function requestApproval(args: Record<string, unknown>, context: McpRequestContext): CallToolResult {
  const parsed = parseArgs(requestApprovalSchema, args);
  const toolContext = resolveToolCompany({ requestedCompany: parsed.companyCode, context });
  if ("status" in args && args.status !== undefined && args.status !== "pending") {
    return errorResult(
      "approval_decision_forbidden",
      "MCP can only request pending approvals; approval decisions stay in the HiveRunner UI",
    );
  }

  const recommendationIds = parsed.recommendationIds?.filter(Boolean) ?? [];
  const result = recommendationIds.length > 0
    ? acceptImprovementRecommendationsForApproval({
        companyIdOrSlug: toolContext.companyId,
        recommendationIds,
        requestedByAgentId: parsed.requestedByAgentId ?? undefined,
        acceptedByUserId: parsed.acceptedByUserId ?? undefined,
        acceptanceNote: parsed.acceptanceNote ?? null,
        title: parsed.title,
        proposedChangeSummary: parsed.proposedChangeSummary,
        rationale: parsed.rationale,
        preview: parsed.preview,
        riskNotes: parsed.riskNotes,
        rollbackNotes: parsed.rollbackNotes,
        db: toolContext.db,
      }).approval
    : createApproval({
        companyIdOrSlug: toolContext.companyId,
        type: parsed.type,
        requestedByAgentId: parsed.requestedByAgentId ?? undefined,
        approverAgentId: parsed.approverAgentId ?? undefined,
        approvalRouteReason: parsed.approvalRouteReason ?? undefined,
        linkedTaskId: resolveLinkedTaskId({
          context: toolContext,
          linkedTaskId: parsed.linkedTaskId,
          linkedTaskKey: parsed.linkedTaskKey,
        }),
        payload: {
          ...(parsed.payload ?? {}),
          source: parsed.payload?.source ?? "mcp_tool",
        },
        db: toolContext.db,
      }).approval;

  if (result.status !== "pending") {
    throw new OrchestrationApiError(
      409,
      "approval_not_pending",
      "Existing approval request was reused but is no longer pending",
    );
  }

  return jsonResult({
    schema: "mcp.tool.request_approval.output.v1",
    approvalId: result.id,
    status: result.status,
    approverAgentName: result.approverAgentName,
    approvalHref: buildApprovalDetailPath({
      companyCode: toolContext.companyCode,
      companySlug: toolContext.companySlug,
      approvalId: result.id,
      linkedTaskKey: result.linkedTaskKey,
    }),
    governance: {
      mode: "approval_request",
      durableStateMutated: false,
      decisionExposed: false,
    },
  });
}

export function executeGovernedMcpTool(input: ToolInput): CallToolResult {
  try {
    switch (input.name) {
      case "hiverunner.eval.save_case":
        return saveEvalCase(input.args, input.context);
      case "hiverunner.evidence.attach":
        return attachEvidence(input.args, input.context);
      case "hiverunner.improve.create_recommendation":
        return createRecommendation(input.args, input.context);
      case "hiverunner.approval.request":
        return requestApproval(input.args, input.context);
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResult("validation_error", "Invalid HiveRunner MCP tool payload", error.flatten());
    }
    if (error instanceof OrchestrationApiError) {
      return errorResult(error.code, error.message, error.details);
    }
    return errorResult(
      "tool_execution_failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
