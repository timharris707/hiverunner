import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { agentProfileQuerySchema } from "@/lib/orchestration/contracts";
import { getAgentProfile } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().trim().min(1),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const query = agentProfileQuerySchema.parse({
      company: req.nextUrl.searchParams.get("company") ?? undefined,
      executionLimit: req.nextUrl.searchParams.get("executionLimit") ?? undefined,
      activityLimit: req.nextUrl.searchParams.get("activityLimit") ?? undefined,
    });

    return NextResponse.json(
      getAgentProfile({
        agentId: id,
        companyIdOrSlug: query.company,
        executionLimit: query.executionLimit,
        activityLimit: query.activityLimit,
      })
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent profile query", error.flatten());
    }
    return handleRouteError(error, "agent-profile:get");
  }
}
