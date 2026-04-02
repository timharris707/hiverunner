import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { cancelTaskExecution, pollTaskExecutionStatus } from "@/lib/orchestration/execution";
import { cancelTaskExecutionSchema } from "@/lib/orchestration/contracts";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().trim().min(1),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const result = await pollTaskExecutionStatus(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid task id", error.flatten());
    }
    return handleRouteError(error, "task-execution:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    const parsed = cancelTaskExecutionSchema.parse(await req.json());
    const result = await cancelTaskExecution({
      taskId: id,
      actorUserId: parsed.actorUserId,
      note: parsed.note,
      targetStatus: parsed.targetStatus,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid task execution cancel payload", error.flatten());
    }
    return handleRouteError(error, "task-execution:patch");
  }
}
