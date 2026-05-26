import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listCompanyExecutionHivesQuerySchema } from "@/lib/orchestration/contracts";
import { ensureCompanyExecutionHives } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    listCompanyExecutionHivesQuerySchema.parse({
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
    });
    return NextResponse.json(ensureCompanyExecutionHives({ companyIdOrSlug: slug }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid execution hives query", error.flatten());
    }
    return handleRouteError(error, "company-execution-hives:get");
  }
}
