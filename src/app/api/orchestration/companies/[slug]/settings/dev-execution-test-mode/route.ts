import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateDevExecutionTestModeSchema } from "@/lib/orchestration/contracts";
import {
  getDevExecutionTestModeView,
  isDevExecutionTestModeSupported,
  updateDevExecutionTestMode,
} from "@/lib/orchestration/service/dev-execution-test-mode";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    if (!isDevExecutionTestModeSupported()) {
      return errorResponse(404, "not_found", "Dev execution test mode is unavailable on this lane.");
    }
    const { slug } = await params;
    return NextResponse.json(getDevExecutionTestModeView(slug));
  } catch (error) {
    return handleRouteError(error, "company-dev-execution-test-mode:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    if (!isDevExecutionTestModeSupported()) {
      return errorResponse(404, "not_found", "Dev execution test mode is unavailable on this lane.");
    }
    const { slug } = await params;
    const parsed = updateDevExecutionTestModeSchema.parse(await req.json());
    return NextResponse.json(
      updateDevExecutionTestMode({
        companyIdOrSlug: slug,
        enabled: parsed.enabled,
        durationMinutes: parsed.durationMinutes,
        actor: parsed.actor,
        note: parsed.note,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid dev execution test mode payload", error.flatten());
    }
    return handleRouteError(error, "company-dev-execution-test-mode:patch");
  }
}
