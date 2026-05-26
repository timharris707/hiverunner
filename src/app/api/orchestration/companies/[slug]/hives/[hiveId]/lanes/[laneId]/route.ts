import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import { updateCompanyExecutionHiveLaneSchema } from "@/lib/orchestration/contracts";
import { updateCompanyExecutionHiveLane } from "@/lib/orchestration/service";
import type { HiveRoutingLaneId } from "@/lib/orchestration/execution-hives";

export const dynamic = "force-dynamic";

const HIVE_LANE_IDS = new Set(["default", "fast", "mini", "deep", "vision", "local"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; hiveId: string; laneId: string }> },
) {
  try {
    const { slug, hiveId, laneId } = await params;
    if (!HIVE_LANE_IDS.has(laneId)) {
      throw new OrchestrationApiError(404, "execution_hive_lane_not_found", "Execution Hive lane not found");
    }
    const contentType = req.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await req.json() : {};
    const parsed = updateCompanyExecutionHiveLaneSchema.parse(payload);
    return NextResponse.json(updateCompanyExecutionHiveLane({
      companyIdOrSlug: slug,
      hiveId,
      laneId: laneId as HiveRoutingLaneId,
      primary: parsed.primary,
      fallbacks: parsed.fallbacks,
    }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid execution hive lane payload", error.flatten());
    }
    return handleRouteError(error, "company-execution-hives:lane-update");
  }
}
