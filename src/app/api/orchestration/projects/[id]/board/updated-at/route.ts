import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getProjectBoardUpdatedAt } from "@/lib/orchestration/service";

const projectBoardUpdatedAtParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsed = projectBoardUpdatedAtParamsSchema.parse(await params);
    return NextResponse.json(getProjectBoardUpdatedAt(parsed.id));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid project identifier", error.flatten());
    }
    return handleRouteError(error, "project-board-updated-at:get");
  }
}
