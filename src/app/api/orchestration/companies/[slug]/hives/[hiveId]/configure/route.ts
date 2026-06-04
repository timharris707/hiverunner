import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { configureCompanyExecutionHiveSchema } from "@/lib/orchestration/contracts";
import { configureCompanyExecutionHive } from "@/lib/orchestration/service";

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
    const parsed = configureCompanyExecutionHiveSchema.parse(payload);
    return NextResponse.json(configureCompanyExecutionHive({ companyIdOrSlug: slug, hiveId, ...parsed }));
  } catch (error) {
    const validationError = executionHiveValidationErrorResponse(
      error,
      "Invalid execution hive configuration payload",
    );
    if (validationError) {
      return validationError;
    }
    return handleRouteError(error, "company-execution-hives:configure");
  }
}
