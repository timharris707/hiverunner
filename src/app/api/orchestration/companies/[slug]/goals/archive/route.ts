import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { archiveCompanyGoal } from "@/lib/orchestration/company-service";
import { archiveCompanyGoalSchema } from "@/lib/orchestration/contracts";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = archiveCompanyGoalSchema.parse(await req.json());
    return NextResponse.json(
      archiveCompanyGoal({
        companyIdOrSlug: slug,
        sprintId: parsed.sprintId,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company goal archive payload", error.flatten());
    }
    return handleRouteError(error, "company-goals:archive");
  }
}
