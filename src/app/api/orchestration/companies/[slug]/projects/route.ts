import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listProjectsQuerySchema } from "@/lib/orchestration/contracts";
import { listProjects } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listProjectsQuerySchema.parse({
      company: slug,
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
      includeNonProduction: req.nextUrl.searchParams.get("includeNonProduction") ?? undefined,
    });

    return NextResponse.json(
      listProjects({
        companyIdOrSlug: query.company,
        includeArchived: query.includeArchived,
        includeNonProduction: query.includeNonProduction,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company project list query", error.flatten());
    }
    return handleRouteError(error, "company-projects:get");
  }
}

