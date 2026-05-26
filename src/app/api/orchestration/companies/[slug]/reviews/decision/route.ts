import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import {
  submitCompanyReviewDecision,
  type ReviewDecision,
  type ReviewDecisionTargetType,
} from "@/lib/orchestration/review-decision";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return NextResponse.json(submitCompanyReviewDecision(slug, {
      targetType: body.targetType as ReviewDecisionTargetType,
      targetId: typeof body.targetId === "string" ? body.targetId : "",
      decision: body.decision as ReviewDecision,
      reviewerAgentId: typeof body.reviewerAgentId === "string" ? body.reviewerAgentId : "",
      note: typeof body.note === "string" ? body.note : undefined,
      confidence: typeof body.confidence === "number" ? body.confidence : undefined,
      source: body.source === "operator" || body.source === "system" ? body.source : "agent",
    }));
  } catch (error) {
    return handleRouteError(error, "company.reviews.decision:post");
  }
}
