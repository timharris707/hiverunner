import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { generateTemplateDraftPlanSchema } from "@/lib/orchestration/contracts";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { generateTemplateDraftPlan, getPendingSprintPlanDraft, listPendingSprintPlanDraftsForGoal, resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { materializeTemplateCrewRecommendationGaps } from "@/lib/orchestration/template-crew-materialization";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; goalId: string }> }
) {
  try {
    const { slug, goalId } = await params;
    const first = getPendingSprintPlanDraft({
      companyIdOrSlug: slug,
      companyGoalId: goalId,
    });
    const all = listPendingSprintPlanDraftsForGoal({
      companyIdOrSlug: slug,
      companyGoalId: goalId,
    });
    return NextResponse.json({ ...first, ...all });
  } catch (error) {
    return handleRouteError(error, "company-goal-drafts:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; goalId: string }> }
) {
  try {
    const { slug, goalId } = await params;
    const parsed = generateTemplateDraftPlanSchema.parse(await req.json());
    let result = generateTemplateDraftPlan({
      companyIdOrSlug: slug,
      companyGoalId: goalId,
      templateId: parsed.templateId,
      templateVersionId: parsed.templateVersionId,
      answers: parsed.answers,
      idempotencyKey: parsed.idempotencyKey,
      submittedByAgentId: parsed.submittedByAgentId,
      submittedByUserId: parsed.submittedByUserId,
      defaultExecutionEngine: parsed.defaultExecutionEngine,
      defaultModelLane: parsed.defaultModelLane,
    });
    if (parsed.materializeCrewRecommendations) {
      const db = getOrchestrationDb();
      const company = resolveCompanyIdBySlug(slug, db);
      if (!company) {
        return errorResponse(404, "company_not_found", "Company not found");
      }
      result = materializeTemplateCrewRecommendationGaps({
        db,
        companyId: company.id,
        requestedByAgentId: parsed.submittedByAgentId,
        draftPlan: result,
        lanes: parsed.materializeCrewRecommendationLanes,
      });
    }
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid template draft plan payload", error.flatten());
    }
    return handleRouteError(error, "company-goal-drafts:post");
  }
}
