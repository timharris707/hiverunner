import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { reviewSprintPlanDraftSchema } from "@/lib/orchestration/contracts";
import { approveSprintPlanDraft, approveSprintPlanDraftGroup, rejectSprintPlanDraft, resolveCompanyIdBySlug, updateSprintPlanDraft } from "@/lib/orchestration/company-service";
import { executeHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";

export const dynamic = "force-dynamic";

function triggerImmediateSprintRunsIfAllowed(slug: string, runIds: string[] | undefined): void {
  if (!runIds?.length) return;
  const company = resolveCompanyIdBySlug(slug);
  if (!company || !canAutonomouslyExecuteCompany(company.id)) return;
  after(async () => {
    await Promise.allSettled(
      runIds.map(async (runId) => {
        try {
          await executeHeartbeatRun(runId);
        } catch (error) {
          console.warn("[company-goal-draft:patch] immediate sprint heartbeat execution failed:", error);
        }
      }),
    );
  });
}

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
      const result = approveSprintPlanDraftGroup({
        companyIdOrSlug: slug,
        companyGoalId: goalId,
        draftId,
        actorUserId: "operator",
      });
      triggerImmediateSprintRunsIfAllowed(slug, result.sprintStartRunIds);
      return NextResponse.json(result);
    }
    const result = approveSprintPlanDraft({
      companyIdOrSlug: slug,
      companyGoalId: goalId,
      draftId,
      sprint: parsed.sprint,
      tasks,
      actorUserId: "operator",
    });
    triggerImmediateSprintRunsIfAllowed(slug, result.sprintStartRunIds);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid sprint plan review payload", error.flatten());
    }
    return handleRouteError(error, "company-goal-draft:patch");
  }
}
