import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  listCompanyExecutionSettingsQuerySchema,
  updateCompanyExecutionSettingsSchema,
} from "@/lib/orchestration/contracts";
import {
  listCompanyExecutionSettings,
  updateCompanyExecutionSettings,
} from "@/lib/orchestration/service/execution-settings";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listCompanyExecutionSettingsQuerySchema.parse({
      includeNonProduction: req.nextUrl.searchParams.get("includeNonProduction") ?? undefined,
    });

    return NextResponse.json(
      await listCompanyExecutionSettings({
        companyIdOrSlug: slug,
        includeNonProduction: query.includeNonProduction,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid execution settings query", error.flatten());
    }
    return handleRouteError(error, "company-execution-settings:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanyExecutionSettingsSchema.parse(await req.json());

    return NextResponse.json(
      await updateCompanyExecutionSettings({
        companyIdOrSlug: slug,
        agentId: parsed.agentId,
        modelId: parsed.modelId,
        timeoutSeconds: parsed.timeoutSeconds,
        graceSeconds: parsed.graceSeconds,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid execution settings update payload", error.flatten());
    }
    return handleRouteError(error, "company-execution-settings:patch");
  }
}
