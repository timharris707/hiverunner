import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listActivityQuerySchema } from "@/lib/orchestration/contracts";
import { listActivityFeed } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = listActivityQuerySchema.parse({
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
      cursor: req.nextUrl.searchParams.get("cursor") ?? undefined,
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
      agentId: req.nextUrl.searchParams.get("agentId") ?? undefined,
    });

    return NextResponse.json(listActivityFeed(query));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid activity query", error.flatten());
    }
    return handleRouteError(error, "activity:get");
  }
}
