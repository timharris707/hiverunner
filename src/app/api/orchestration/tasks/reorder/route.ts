import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { reorderTaskSchema } from "@/lib/orchestration/contracts";
import { moveTask } from "@/lib/orchestration/service";
import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import type { BridgeRuntimeProvider } from "@/lib/orchestration/bridge/types";
import { triggerTaskExecution } from "@/lib/orchestration/execution";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  try {
    const parsed = reorderTaskSchema.parse(await req.json());
    const result = moveTask(parsed);

    let heartbeat:
      | {
          attempted: boolean;
          queued: boolean;
          status: "queued" | "running" | "skipped";
          mode?: BridgeRuntimeProvider;
          runId?: string;
          sessionId?: string;
          reason?: string;
        }
      | {
          attempted: boolean;
          queued: false;
          status: "skipped";
          mode?: BridgeRuntimeProvider;
          reason: string;
          error?: { code: string; message: string; retriable?: boolean };
        }
      | undefined;

    const movedIntoInProgress =
      result.transition.statusChanged &&
      result.transition.from !== "in-progress" &&
      result.transition.to === "in-progress";

    if (movedIntoInProgress && result.task.assignee) {
      try {
        const execution = await triggerTaskExecution({
          taskId: result.task.id,
          idempotencyKey: `mc-task-transition:${result.task.id}:${result.transition.from}->${result.transition.to}:${result.task.updated}`,
          reason: "task_moved_to_in_progress",
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
        if (error instanceof OrchestrationApiError) {
          heartbeat = {
            attempted: true,
            queued: false,
            status: "skipped",
            reason: "execution_trigger_failed",
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
        reason: "no_in_progress_transition",
      };
    }

    return NextResponse.json({
      task: result.task,
      transition: result.transition,
      heartbeat,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid reorder payload", error.flatten());
    }
    return handleRouteError(error, "tasks-reorder:patch");
  }
}
