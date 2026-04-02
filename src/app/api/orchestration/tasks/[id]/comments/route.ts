import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { createTaskCommentSchema } from "@/lib/orchestration/contracts";
import { createTaskComment, listTaskComments } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(listTaskComments(id));
  } catch (error) {
    return handleRouteError(error, "task-comments:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = createTaskCommentSchema.parse(await req.json());
    return NextResponse.json(createTaskComment({ ...parsed, taskId: id }), { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create comment payload", error.flatten());
    }
    return handleRouteError(error, "task-comments:post");
  }
}
