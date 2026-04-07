import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { assignTaskSchema } from "@/lib/orchestration/contracts";
import { assignTask } from "@/lib/orchestration/service";
import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import { isBridgeClientError } from "@/lib/orchestration/bridge";
import { triggerTaskExecution, triggerTaskNudge } from "@/lib/orchestration/execution";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = assignTaskSchema.parse(await req.json());
    const result = assignTask({ ...parsed, taskId: id });

    let heartbeat:
      | {
          attempted: boolean;
          queued: boolean;
          status: "queued" | "running" | "skipped";
          mode?: "openclaw" | "paperclip";
          runId?: string;
          sessionId?: string;
          reason?: string;
        }
      | {
          attempted: boolean;
          queued: false;
          status: "skipped";
          mode?: "openclaw" | "paperclip";
          reason: string;
          error?: { code: string; message: string; retriable?: boolean };
        }
      | undefined;

    if (result.assignmentChanged && result.task.assignee) {
      try {
        const execution = result.task.status === "in-progress"
          ? await triggerTaskExecution({
              taskId: id,
              idempotencyKey: `mc-task-assignment:${id}:${result.task.updated}`,
              reason: "task_assigned_in_progress",
            })
          : await triggerTaskNudge({
              taskId: id,
              idempotencyKey: `mc-task-nudge:${id}:${result.task.updated}`,
              reason: "task_assigned",
            });
        heartbeat = {
          attempted: true,
          queued: execution.queued,
          status: execution.status,
          mode: execution.mode,
          runId: execution.runId,
          sessionId: execution.sessionId,
          reason: execution.reason,
        };
      } catch (error) {
        if (isBridgeClientError(error)) {
          heartbeat = {
            attempted: true,
            queued: false,
            status: "skipped",
            mode: "paperclip",
            reason: "paperclip_wakeup_failed",
            error: {
              code: error.code,
              message: error.message,
              retriable: error.retriable,
            },
          };
        } else if (error instanceof OrchestrationApiError) {
          heartbeat = {
            attempted: true,
            queued: false,
            status: "skipped",
            mode: "openclaw",
            reason: "openclaw_spawn_failed",
            error: {
              code: error.code,
              message: error.message,
            },
          };
        } else {
          heartbeat = {
            attempted: true,
            queued: false,
            status: "skipped",
            reason: "execution_trigger_failed",
          };
        }
      }
    } else {
      heartbeat = {
        attempted: false,
        queued: false,
        status: "skipped",
        reason: "no_assignment_change",
      };
    }

    return NextResponse.json({
      task: result.task,
      assignmentChanged: result.assignmentChanged,
      heartbeat,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid assign payload", error.flatten());
    }
    return handleRouteError(error, "task-assign:patch");
  }
}
