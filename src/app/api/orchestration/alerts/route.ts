import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listAlertsQuerySchema } from "@/lib/orchestration/contracts";
import { listStaleTaskAlerts } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = listAlertsQuerySchema.parse({
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
    });
    return NextResponse.json(listStaleTaskAlerts(query));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid alerts query", error.flatten());
    }
    return handleRouteError(error, "alerts:get");
  }
}
