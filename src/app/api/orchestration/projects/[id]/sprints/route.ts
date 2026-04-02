import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { createSprintSchema } from "@/lib/orchestration/contracts";
import { createProjectSprint, listProjectSprints } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(listProjectSprints(id));
  } catch (error) {
    return handleRouteError(error, "project-sprints:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = createSprintSchema.parse(await req.json());
    return NextResponse.json(createProjectSprint({ ...parsed, projectId: id }), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create sprint payload", error.flatten());
    }
    return handleRouteError(error, "project-sprints:post");
  }
}
