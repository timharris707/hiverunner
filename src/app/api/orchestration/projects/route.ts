import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { createProjectSchema, listProjectsQuerySchema } from "@/lib/orchestration/contracts";
import { handleRouteError, errorResponse } from "@/lib/orchestration/api";
import { createProject, listProjects } from "@/lib/orchestration/service";
import { resolveRequestCompanyOwnerUserId } from "@/lib/orchestration/request-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const query = listProjectsQuerySchema.parse({
      company: req.nextUrl.searchParams.get("company") ?? undefined,
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
      includeNonProduction: req.nextUrl.searchParams.get("includeNonProduction") ?? undefined,
    });
    const ownerUserId = await resolveRequestCompanyOwnerUserId(req);
    return NextResponse.json(
      listProjects({
        companyIdOrSlug: query.company,
        includeArchived: query.includeArchived,
        includeNonProduction: query.includeNonProduction,
        ownerUserId,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid project list query", error.flatten());
    }
    return handleRouteError(error, "projects:get");
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createProjectSchema.parse(await req.json());
    return NextResponse.json(createProject(parsed), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create project payload", error.flatten());
    }
    return handleRouteError(error, "projects:post");
  }
}
