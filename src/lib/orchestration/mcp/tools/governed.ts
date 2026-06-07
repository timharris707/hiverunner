import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
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
  buildApprovalDetailPath,
  buildCanonicalEvalCasePath,
  buildCanonicalEvalsPath,
  buildCanonicalImprovePath,
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

  const evalCase = createEvalCase({
    companyId: toolContext.companyId,
    projectId: parsed.projectId ?? null,
    sourceTask: parsed.sourceTask,
    sourceRun: parsed.sourceRun,
    sourceSprint: parsed.sourceSprint,
    sourceGoal: parsed.sourceGoal,
    templateContext: parsed.templateContext,
    sourceTemplateVersionId: parsed.sourceTemplateVersionId,
    templateIntakeAnswerId: parsed.templateIntakeAnswerId,
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

  return jsonResult({
    schema: "mcp.tool.save_eval_case.output.v1",
    evalCaseId: evalCase.id,
    snapshotSha256: evalCase.snapshotSha256,
    links: evalLinks({
      context: toolContext,
      evalCaseId: evalCase.id,
      traceRoute: evalCase.sourceRun.traceRoute,
    }),
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
