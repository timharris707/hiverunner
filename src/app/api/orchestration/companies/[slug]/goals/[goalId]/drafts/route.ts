import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { getPendingSprintPlanDraft, listPendingSprintPlanDraftsForGoal } from "@/lib/orchestration/company-service";

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
