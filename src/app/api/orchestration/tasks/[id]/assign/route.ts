import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { assignTaskSchema } from "@/lib/orchestration/contracts";
import { assignTask } from "@/lib/orchestration/service";
import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import type { BridgeRuntimeProvider } from "@/lib/orchestration/bridge/types";
import { triggerTaskExecution } from "@/lib/orchestration/execution";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { executeHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";

export const dynamic = "force-dynamic";

function resolveTaskCompanyId(taskId: string): string | null {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT COALESCE(t.company_id, p.company_id) AS company_id
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?
       LIMIT 1`
    )
    .get(taskId) as { company_id: string | null } | undefined;
  return row?.company_id ?? null;
}

function triggerImmediateRunIfAllowed(taskId: string, runId: string | undefined): void {
  if (!runId) return;
  const companyId = resolveTaskCompanyId(taskId);
  if (!companyId || !canAutonomouslyExecuteCompany(companyId)) return;
  after(async () => {
    try {
      await executeHeartbeatRun(runId);
    } catch (error) {
      console.warn("[task-assign] immediate heartbeat execution failed:", error);
    }
  });
}

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

    if (result.assignmentChanged && result.task.assignee) {
      if (result.task.status !== "in-progress") {
        heartbeat = {
          attempted: false,
          queued: false,
          status: "skipped",
          reason: "task_not_in_progress",
        };
      } else {
        try {
          const execution = await triggerTaskExecution({
              taskId: id,
              idempotencyKey: `mc-task-assignment:${id}:${result.task.updated}`,
              reason: "task_assigned_in_progress",
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
          triggerImmediateRunIfAllowed(id, execution.runId);
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
