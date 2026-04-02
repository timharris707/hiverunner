import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateSprintSchema } from "@/lib/orchestration/contracts";
import { updateSprint } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateSprintSchema.parse(await req.json());
    return NextResponse.json(updateSprint({ ...parsed, sprintId: id }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid sprint update payload", error.flatten());
    }
    return handleRouteError(error, "sprint:patch");
  }
}
