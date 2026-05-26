import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { routeCompanyReviewCandidates, type ReviewRoutingTarget } from "@/lib/orchestration/review-routing";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const target = typeof body.target === "string" ? body.target : undefined;
    if (target !== undefined && target !== "all" && target !== "memory" && target !== "skills") {
      return errorResponse(400, "invalid_target", "target must be all, memory, or skills");
    }

    return NextResponse.json(routeCompanyReviewCandidates(slug, {
      target: target as ReviewRoutingTarget | undefined,
      dryRun: typeof body.dryRun === "boolean" ? body.dryRun : undefined,
      reroute: typeof body.reroute === "boolean" ? body.reroute : undefined,
      createTasks: typeof body.createTasks === "boolean" ? body.createTasks : undefined,
    }));
  } catch (error) {
    return handleRouteError(error, "company.reviews:post");
  }
}
