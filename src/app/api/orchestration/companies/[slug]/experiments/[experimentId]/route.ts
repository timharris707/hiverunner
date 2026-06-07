import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  approveExperimentVariants,
  createImproveRecommendationFromExperimentReport,
  getExperiment,
  markExperimentCancelled,
  markExperimentFailed,
  recordExperimentAttempt,
  saveExperimentReport,
} from "@/lib/orchestration/experiments";

export const dynamic = "force-dynamic";

const workspaceModeSchema = z.enum(["snapshot", "branch", "live"]);
const attemptStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "timed_out"]);
const reportStatusSchema = z.enum(["draft", "generated", "accepted", "returned", "superseded", "archived"]);

const updateExperimentSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve_variants"),
    variantIds: z.array(z.string().trim().min(1)).optional(),
    variantKeys: z.array(z.string().trim().min(1)).optional(),
    approvedByAgentId: z.string().trim().min(1).nullable().optional(),
    approvedByUserId: z.string().trim().min(1).nullable().optional(),
    liveWorkspaceConfirmed: z.boolean().optional(),
    liveWorkspaceReason: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    action: z.literal("record_attempt"),
    variantId: z.string().trim().min(1).nullable().optional(),
    variantKey: z.string().trim().min(1).nullable().optional(),
    attemptNumber: z.number().int(),
    status: attemptStatusSchema,
    workspaceMode: workspaceModeSchema.nullable().optional(),
    workspaceRef: z.string().max(2000).nullable().optional(),
    contextSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    comparisonSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    executionRunId: z.string().trim().min(1).nullable().optional(),
    evalCaseId: z.string().trim().min(1).nullable().optional(),
    traceRoute: z.string().trim().min(1).nullable().optional(),
    errorMessage: z.string().max(5000).nullable().optional(),
    liveWorkspaceConfirmed: z.boolean().optional(),
    liveWorkspaceReason: z.string().max(1000).nullable().optional(),
  }),
  z.object({
    action: z.literal("save_report"),
    id: z.string().trim().min(1).optional(),
    status: reportStatusSchema.optional(),
    summary: z.string().max(5000).nullable().optional(),
    report: z.record(z.string(), z.unknown()),
    conclusion: z.record(z.string(), z.unknown()).nullable().optional(),
    winningVariantId: z.string().trim().min(1).nullable().optional(),
    winningVariantKey: z.string().trim().min(1).nullable().optional(),
    recommendationId: z.string().trim().min(1).nullable().optional(),
    generatedByAgentId: z.string().trim().min(1).nullable().optional(),
    generatedByUserId: z.string().trim().min(1).nullable().optional(),
  }),
  z.object({
    action: z.literal("handoff_improve"),
    reportId: z.string().trim().min(1),
    trigger: z
      .object({
        configured: z.boolean().optional(),
        triggerKey: z.string().trim().min(1).nullable().optional(),
        reason: z.string().max(1000).nullable().optional(),
      })
      .nullable()
      .optional(),
    scopeType: z
      .enum(["company", "project", "template", "task_type", "agent", "runner", "recommendation"])
      .optional(),
    scopeKey: z.string().trim().min(1).nullable().optional(),
    title: z.string().max(500).nullable().optional(),
    rationale: z.string().max(5000).nullable().optional(),
    proposedChange: z.string().max(5000).nullable().optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    createdByAgentId: z.string().trim().min(1).nullable().optional(),
    createdByUserId: z.string().trim().min(1).nullable().optional(),
    idempotencyKey: z.string().trim().min(1).nullable().optional(),
  }),
  z.object({
    action: z.literal("cancel_experiment"),
    reason: z.string().max(5000).nullable().optional(),
  }),
  z.object({
    action: z.literal("fail_experiment"),
    reason: z.string().max(5000).nullable().optional(),
  }),
]);

type UpdateExperimentInput = z.infer<typeof updateExperimentSchema>;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; experimentId: string }> },
) {
  try {
    const { slug, experimentId } = await params;
    const db = getOrchestrationDb();
    return NextResponse.json({
      experiment: getExperiment(slug, experimentId, db),
    });
  } catch (error) {
    return handleRouteError(error, "company-experiment:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; experimentId: string }> },
) {
  try {
    const { slug, experimentId } = await params;
    const parsed = updateExperimentSchema.parse(await req.json());
    const db = getOrchestrationDb();
    const result = applyExperimentUpdate(slug, experimentId, parsed, db);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid experiment update payload", error.flatten());
    }
    return handleRouteError(error, "company-experiment:patch");
  }
}

function applyExperimentUpdate(
  slug: string,
  experimentId: string,
  parsed: UpdateExperimentInput,
  db: ReturnType<typeof getOrchestrationDb>,
) {
  if (parsed.action === "approve_variants") {
    return {
      experiment: approveExperimentVariants({
        companyIdOrSlug: slug,
        experimentId,
        variantIds: parsed.variantIds,
        variantKeys: parsed.variantKeys,
        approvedByAgentId: parsed.approvedByAgentId,
        approvedByUserId: parsed.approvedByUserId,
        liveWorkspaceConfirmed: parsed.liveWorkspaceConfirmed,
        liveWorkspaceReason: parsed.liveWorkspaceReason,
      }, db),
    };
  }
  if (parsed.action === "record_attempt") {
    return {
      experiment: recordExperimentAttempt({
        companyIdOrSlug: slug,
        experimentId,
        variantId: parsed.variantId,
        variantKey: parsed.variantKey,
        attemptNumber: parsed.attemptNumber,
        status: parsed.status,
        workspaceMode: parsed.workspaceMode,
        workspaceRef: parsed.workspaceRef,
        contextSnapshot: parsed.contextSnapshot,
        comparisonSnapshot: parsed.comparisonSnapshot,
        executionRunId: parsed.executionRunId,
        evalCaseId: parsed.evalCaseId,
        traceRoute: parsed.traceRoute,
        errorMessage: parsed.errorMessage,
        liveWorkspaceConfirmed: parsed.liveWorkspaceConfirmed,
        liveWorkspaceReason: parsed.liveWorkspaceReason,
      }, db),
    };
  }
  if (parsed.action === "save_report") {
    return {
      report: saveExperimentReport({
        companyIdOrSlug: slug,
        experimentId,
        id: parsed.id,
        status: parsed.status,
        summary: parsed.summary,
        report: parsed.report,
        conclusion: parsed.conclusion,
        winningVariantId: parsed.winningVariantId,
        winningVariantKey: parsed.winningVariantKey,
        recommendationId: parsed.recommendationId,
        generatedByAgentId: parsed.generatedByAgentId,
        generatedByUserId: parsed.generatedByUserId,
      }, db),
      experiment: getExperiment(slug, experimentId, db),
    };
  }
  if (parsed.action === "handoff_improve") {
    const handoff = createImproveRecommendationFromExperimentReport({
      companyIdOrSlug: slug,
      experimentId,
      reportId: parsed.reportId,
      trigger: parsed.trigger,
      scopeType: parsed.scopeType,
      scopeKey: parsed.scopeKey,
      title: parsed.title,
      rationale: parsed.rationale,
      proposedChange: parsed.proposedChange,
      severity: parsed.severity,
      confidence: parsed.confidence,
      createdByAgentId: parsed.createdByAgentId,
      createdByUserId: parsed.createdByUserId,
      idempotencyKey: parsed.idempotencyKey,
    }, db);
    return {
      recommendation: handoff.recommendation,
      report: handoff.report,
      pathway: handoff.pathway,
      experiment: getExperiment(slug, experimentId, db),
    };
  }
  if (parsed.action === "cancel_experiment") {
    return {
      experiment: markExperimentCancelled({
        companyIdOrSlug: slug,
        experimentId,
        reason: parsed.reason,
      }, db),
    };
  }
  return {
    experiment: markExperimentFailed({
      companyIdOrSlug: slug,
      experimentId,
      reason: parsed.reason,
    }, db),
  };
}
