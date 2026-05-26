import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { createTaskCommentSchema } from "@/lib/orchestration/contracts";
import { executeHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { createTaskComment, listTaskComments } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

async function triggerCommentHeartbeatRun(runId: string) {
  try {
    const result = await executeHeartbeatRun(runId);
    if (result.status === "failed") {
      console.warn("[task-comments] immediate comment heartbeat failed:", result.error);
    }
  } catch (error) {
    console.warn("[task-comments] immediate comment heartbeat failed (non-fatal):", error);
  }
}

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
    const result = createTaskComment({ ...parsed, taskId: id });
    const heartbeat = result.wakeup
      ? {
          attempted: true,
          queued: true,
          status: "queued",
          mode: "local",
          runId: result.wakeup.heartbeatRunId,
          wakeupRequestId: result.wakeup.wakeupRequestId,
          reason: result.wakeup.reason,
        }
      : { attempted: false, queued: false, status: "skipped", reason: "comment_does_not_wake_assignee" };

    if (
      result.wakeup?.heartbeatRunId &&
      (result.wakeup.status === "queued" || result.wakeup.status === "coalesced") &&
      process.env.ORCHESTRATION_ENGINE_AUTORUN !== "0"
    ) {
      after(async () => {
        await triggerCommentHeartbeatRun(result.wakeup!.heartbeatRunId!);
      });
    }

    return NextResponse.json({ ...result, heartbeat }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid create comment payload", error.flatten());
    }
    return handleRouteError(error, "task-comments:post");
  }
}
