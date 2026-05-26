import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { createSprintPlanningTaskSchema } from "@/lib/orchestration/contracts";
import { createSprintPlanningTask } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; goalId: string }> }
) {
  try {
    const { slug, goalId } = await params;
    const parsed = createSprintPlanningTaskSchema.parse(await req.json());
    return NextResponse.json(
      createSprintPlanningTask({
        companyIdOrSlug: slug,
        companyGoalId: goalId,
        leadAgentId: parsed.leadAgentId,
        actorUserId: "operator",
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid sprint planning payload", error.flatten());
    }
    return handleRouteError(error, "company-goal-plan:post");
  }
}
