import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { listPendingSprintPlanDrafts } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(listPendingSprintPlanDrafts({ companyIdOrSlug: slug }));
  } catch (error) {
    return handleRouteError(error, "company-goal-drafts-pending:get");
  }
}
