import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateTaskSchema } from "@/lib/orchestration/contracts";
import { archiveTask, getTaskDetail, updateTask } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(getTaskDetail(id));
  } catch (error) {
    return handleRouteError(error, "task:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = updateTaskSchema.parse(await req.json());
    return NextResponse.json(updateTask({ taskId: id, ...parsed }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid task update payload", error.flatten());
    }
    return handleRouteError(error, "task:patch");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actorUserId = req.nextUrl.searchParams.get("actorUserId") ?? undefined;
    return NextResponse.json(archiveTask({ taskId: id, actorUserId }));
  } catch (error) {
    return handleRouteError(error, "task:delete");
  }
}
