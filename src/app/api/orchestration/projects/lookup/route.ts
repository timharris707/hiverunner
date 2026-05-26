import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { projectLookupQuerySchema } from "@/lib/orchestration/contracts";
import { lookupProjectByName } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = projectLookupQuerySchema.parse({
      name: req.nextUrl.searchParams.get("name") ?? undefined,
      companyId: req.nextUrl.searchParams.get("companyId") ?? undefined,
    });

    const { project } = lookupProjectByName(query);
    return NextResponse.json({
      id: project.id,
      name: project.name,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid project lookup query", error.flatten());
    }
    return handleRouteError(error, "project-lookup:get");
  }
}
