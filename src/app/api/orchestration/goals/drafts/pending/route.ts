import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { listPendingSprintPlanDrafts } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = listPendingSprintPlanDrafts();
    return NextResponse.json({
      ...result,
      pendingDrafts: result.drafts.length,
    });
  } catch (error) {
    return handleRouteError(error, "goal-drafts-pending:get");
  }
}
