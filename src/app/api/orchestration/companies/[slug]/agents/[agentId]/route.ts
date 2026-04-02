import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { agentProfileQuerySchema } from "@/lib/orchestration/contracts";
import { getCompanyAgentProfile } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; agentId: string }> }
) {
  try {
    const { slug, agentId } = await params;
    const query = agentProfileQuerySchema.parse({
      executionLimit: req.nextUrl.searchParams.get("executionLimit") ?? undefined,
      activityLimit: req.nextUrl.searchParams.get("activityLimit") ?? undefined,
    });

    return NextResponse.json(
      getCompanyAgentProfile({
        companyIdOrSlug: slug,
        agentId,
        executionLimit: query.executionLimit,
        activityLimit: query.activityLimit,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent profile query", error.flatten());
    }
    return handleRouteError(error, "company-agent-profile:get");
  }
}
