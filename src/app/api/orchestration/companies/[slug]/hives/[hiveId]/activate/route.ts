import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { activateCompanyExecutionHiveSchema } from "@/lib/orchestration/contracts";
import { activateCompanyExecutionHive } from "@/lib/orchestration/service";

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
    activateCompanyExecutionHiveSchema.parse(payload);
    return NextResponse.json(activateCompanyExecutionHive({ companyIdOrSlug: slug, hiveId }));
  } catch (error) {
    const validationError = executionHiveValidationErrorResponse(
      error,
      "Invalid execution hive activation payload",
    );
    if (validationError) {
      return validationError;
    }
    return handleRouteError(error, "company-execution-hives:activate");
  }
}
