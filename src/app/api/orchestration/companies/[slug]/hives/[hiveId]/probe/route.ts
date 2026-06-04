import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { runCompanyExecutionHiveProbeSchema } from "@/lib/orchestration/contracts";
import { runCompanyExecutionHiveProbe } from "@/lib/orchestration/service";

import {
  executionHiveValidationErrorResponse,
  readExecutionHiveRouteInput,
  type ExecutionHiveRouteContext,
} from "../route-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: ExecutionHiveRouteContext,
) {
  try {
    const { slug, hiveId, payload } = await readExecutionHiveRouteInput(req, context);
    const parsed = runCompanyExecutionHiveProbeSchema.parse(payload);
    return NextResponse.json(runCompanyExecutionHiveProbe({
      companyIdOrSlug: slug,
      hiveId,
      laneId: parsed.laneId,
      kind: parsed.kind,
    }));
  } catch (error) {
    const validationError = executionHiveValidationErrorResponse(
      error,
      "Invalid execution hive probe payload",
    );
    if (validationError) {
      return validationError;
    }
    return handleRouteError(error, "company-execution-hives:probe");
  }
}
