import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { agentLookupQuerySchema } from "@/lib/orchestration/contracts";
import { lookupAgentByName } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = agentLookupQuerySchema.parse({
      name: req.nextUrl.searchParams.get("name") ?? undefined,
      companyId: req.nextUrl.searchParams.get("companyId") ?? undefined,
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
    });

    const { agent } = lookupAgentByName(query);
    return NextResponse.json({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar ?? null,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent lookup query", error.flatten());
    }
    return handleRouteError(error, "agent-lookup:get");
  }
}
