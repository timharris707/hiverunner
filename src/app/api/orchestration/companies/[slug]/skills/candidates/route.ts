import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { generateCompanySkillCandidates } from "@/lib/orchestration/skill-candidate-generator";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const limit = typeof body.limit === "number" ? body.limit : undefined;
    const minEvidence = typeof body.minEvidence === "number" ? body.minEvidence : undefined;
    const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : undefined;
    const includeDraftEvidence = typeof body.includeDraftEvidence === "boolean" ? body.includeDraftEvidence : undefined;
    if (body.minEvidence !== undefined && (typeof body.minEvidence !== "number" || body.minEvidence < 2)) {
      return errorResponse(400, "invalid_min_evidence", "minEvidence must be a number greater than or equal to 2");
    }

    return NextResponse.json(generateCompanySkillCandidates(slug, {
      limit,
      minEvidence,
      dryRun,
      includeDraftEvidence,
    }));
  } catch (error) {
    return handleRouteError(error, "company.skills.candidates:post");
  }
}
