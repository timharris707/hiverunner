import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  getImproveRecommendation,
  updateImproveRecommendation,
  type UpdateImproveRecommendationInput,
} from "@/lib/orchestration/improvement-recommendations";
import { acceptImprovementRecommendationsForApproval } from "@/lib/orchestration/service/improvement-approval";

export const dynamic = "force-dynamic";

const statusSchema = z.enum([
  "suggested",
  "needs-more-evidence",
  "accepted-for-approval",
  "dismissed",
  "superseded",
  "applied",
]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const confidenceSchema = z.enum(["low", "medium", "high"]);
const scopeTypeSchema = z.enum(["company", "project", "template", "task_type", "agent", "runner", "recommendation"]);

const editSchema = z.object({
  action: z.literal("edit"),
  title: z.string().trim().min(1).max(240).optional(),
  rationale: z.string().trim().max(4000).optional(),
  proposedChange: z.string().trim().max(4000).optional(),
  severity: severitySchema.optional(),
  confidence: confidenceSchema.optional(),
  category: z.string().trim().max(120).nullable().optional(),
  summary: z.string().trim().max(1000).nullable().optional(),
  riskNotes: z.string().trim().max(1000).nullable().optional(),
  rollbackNotes: z.string().trim().max(1000).nullable().optional(),
  groupKey: z.string().trim().max(160).nullable().optional(),
  groupLabel: z.string().trim().max(160).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(25).optional(),
});

const dismissSchema = z.object({
  action: z.literal("dismiss"),
  reason: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).nullable().optional(),
  actorAgentId: z.string().trim().min(1).max(160).nullable().optional(),
  actorUserId: z.string().trim().min(1).max(160).nullable().optional(),
});

const suppressSchema = z.object({
  action: z.literal("suppress"),
  reason: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(1000).nullable().optional(),
  scopeType: scopeTypeSchema.optional(),
  scopeKey: z.string().trim().min(1).max(240).optional(),
  expiresAt: z.string().trim().min(1).max(80).nullable().optional(),
  actorAgentId: z.string().trim().min(1).max(160).nullable().optional(),
  actorUserId: z.string().trim().min(1).max(160).nullable().optional(),
});

const acceptForApprovalSchema = z.object({
  action: z.literal("accept_for_approval"),
  approvalId: z.string().trim().min(1).max(160).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  title: z.string().trim().min(1).max(240).optional(),
  proposedChangeSummary: z.string().trim().max(4000).optional(),
  rationale: z.string().trim().max(4000).optional(),
  preview: z.record(z.string(), z.unknown()).optional(),
  riskNotes: z.string().trim().max(1000).nullable().optional(),
  rollbackNotes: z.string().trim().max(1000).nullable().optional(),
  actorAgentId: z.string().trim().min(1).max(160).nullable().optional(),
  actorUserId: z.string().trim().min(1).max(160).nullable().optional(),
});

const transitionSchema = z.object({
  action: z.literal("transition"),
  status: statusSchema,
  reason: z.string().trim().max(1000).nullable().optional(),
  approvalId: z.string().trim().min(1).max(160).nullable().optional(),
  supersededByRecommendationId: z.string().trim().min(1).max(160).nullable().optional(),
  actorAgentId: z.string().trim().min(1).max(160).nullable().optional(),
  actorUserId: z.string().trim().min(1).max(160).nullable().optional(),
});

const updateSchema = z.discriminatedUnion("action", [
  editSchema,
  dismissSchema,
  suppressSchema,
  acceptForApprovalSchema,
  transitionSchema,
]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; recommendationId: string }> },
) {
  try {
    const { slug, recommendationId } = await params;
    return NextResponse.json(getImproveRecommendation(slug, recommendationId));
  } catch (error) {
    return handleRouteError(error, "improve.recommendation:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; recommendationId: string }> },
) {
  try {
    const { slug, recommendationId } = await params;
    const parsed = updateSchema.parse(await req.json()) as UpdateImproveRecommendationInput;
    if (parsed.action === "accept_for_approval") {
      const result = acceptImprovementRecommendationsForApproval({
        companyIdOrSlug: slug,
        recommendationIds: [recommendationId],
        requestedByAgentId: parsed.actorAgentId ?? undefined,
        acceptedByUserId: parsed.actorUserId ?? undefined,
        acceptanceNote: parsed.note ?? null,
        title: parsed.title,
        proposedChangeSummary: parsed.proposedChangeSummary,
        rationale: parsed.rationale,
        preview: parsed.preview,
        riskNotes: parsed.riskNotes ?? undefined,
        rollbackNotes: parsed.rollbackNotes ?? undefined,
      });
      return NextResponse.json({
        recommendation: getImproveRecommendation(slug, recommendationId).recommendation,
        approval: result.approval,
        links: result.links,
      });
    }
    return NextResponse.json(updateImproveRecommendation(slug, recommendationId, parsed));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Improve recommendation mutation", error.flatten());
    }
    return handleRouteError(error, "improve.recommendation:patch");
  }
}
