import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateCompanyRuntimeGovernanceSettingsSchema } from "@/lib/orchestration/contracts";
import {
  getCompanyRuntimeGovernanceSettings,
  updateCompanyRuntimeGovernanceSettings,
} from "@/lib/orchestration/service/runtime-governance";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    return NextResponse.json(getCompanyRuntimeGovernanceSettings(slug));
  } catch (error) {
    return handleRouteError(error, "company-runtime-governance-settings:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanyRuntimeGovernanceSettingsSchema.parse(await req.json());
    return NextResponse.json(
      updateCompanyRuntimeGovernanceSettings({
        companyIdOrSlug: slug,
        requireProtectedRuntimeApprovals: parsed.requireProtectedRuntimeApprovals,
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "validation_error",
        "Invalid runtime governance settings update payload",
        error.flatten(),
      );
    }
    return handleRouteError(error, "company-runtime-governance-settings:patch");
  }
}
