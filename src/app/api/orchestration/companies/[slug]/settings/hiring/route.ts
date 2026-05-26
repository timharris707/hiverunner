import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateCompanyHiringSettingsSchema } from "@/lib/orchestration/contracts";
import {
  getCompanyHiringGovernanceSettings,
  updateCompanyHiringGovernanceSettings,
} from "@/lib/orchestration/service/hiring-governance";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(getCompanyHiringGovernanceSettings(slug));
  } catch (error) {
    return handleRouteError(error, "company-hiring-settings:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanyHiringSettingsSchema.parse(await req.json());
    return NextResponse.json(
      updateCompanyHiringGovernanceSettings({
        companyIdOrSlug: slug,
        autoApproveNewHires: parsed.autoApproveNewHires,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid hiring settings update payload", error.flatten());
    }
    return handleRouteError(error, "company-hiring-settings:patch");
  }
}
