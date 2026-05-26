import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { reviewSprintPlanDraftSchema } from "@/lib/orchestration/contracts";
import { approveSprintPlanDraft, approveSprintPlanDraftGroup, rejectSprintPlanDraft, updateSprintPlanDraft } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; goalId: string; draftId: string }> }
) {
  try {
    const { slug, goalId, draftId } = await params;
    const parsed = reviewSprintPlanDraftSchema.parse(await req.json());
    const tasks = parsed.tasks?.map((task, index) => ({
      ...task,
      id: task.id ?? `task-${index + 1}`,
    }));
    if (parsed.action === "update") {
      return NextResponse.json(updateSprintPlanDraft({
        companyIdOrSlug: slug,
        companyGoalId: goalId,
        draftId,
        sprint: parsed.sprint,
        tasks,
      }));
    }
    if (parsed.action === "reject") {
      return NextResponse.json(rejectSprintPlanDraft({
        companyIdOrSlug: slug,
        companyGoalId: goalId,
        draftId,
        reason: parsed.reason ?? "",
        actorUserId: "operator",
      }));
    }
    if (parsed.action === "approve_all") {
      return NextResponse.json(approveSprintPlanDraftGroup({
        companyIdOrSlug: slug,
        companyGoalId: goalId,
        draftId,
        actorUserId: "operator",
      }));
    }
    return NextResponse.json(approveSprintPlanDraft({
      companyIdOrSlug: slug,
      companyGoalId: goalId,
      draftId,
      sprint: parsed.sprint,
      tasks,
      actorUserId: "operator",
    }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid sprint plan review payload", error.flatten());
    }
    return handleRouteError(error, "company-goal-draft:patch");
  }
}
