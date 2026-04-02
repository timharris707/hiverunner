import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  listCompanyHeartbeatSettingsQuerySchema,
  updateCompanyHeartbeatSettingsSchema,
} from "@/lib/orchestration/contracts";
import {
  listCompanyHeartbeatSettings,
  updateCompanyHeartbeatSettings,
} from "@/lib/orchestration/service/heartbeat-settings";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listCompanyHeartbeatSettingsQuerySchema.parse({
      includeNonProduction: req.nextUrl.searchParams.get("includeNonProduction") ?? undefined,
    });

    return NextResponse.json(
      await listCompanyHeartbeatSettings({
        companyIdOrSlug: slug,
        includeNonProduction: query.includeNonProduction,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid heartbeat settings query", error.flatten());
    }
    return handleRouteError(error, "company-heartbeat-settings:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanyHeartbeatSettingsSchema.parse(await req.json());

    return NextResponse.json(
      await updateCompanyHeartbeatSettings({
        companyIdOrSlug: slug,
        agentId: parsed.agentId,
        heartbeatEnabled: parsed.heartbeatEnabled,
        intervalSeconds: parsed.intervalSeconds,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid heartbeat settings update payload", error.flatten());
    }
    return handleRouteError(error, "company-heartbeat-settings:patch");
  }
}
