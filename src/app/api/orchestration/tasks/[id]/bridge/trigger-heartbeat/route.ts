import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  isBridgeClientError,
  triggerTaskAssignmentHeartbeat,
} from "@/lib/orchestration/bridge";
import { getOrchestrationExecutionProvider, isPaperclipBridgeEnabled } from "@/lib/orchestration/execution-provider";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().trim().min(1),
});

const bodySchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(300).optional(),
    reason: z.string().trim().min(1).max(300).optional(),
    forceFreshSession: z.boolean().optional(),
  })
  .optional()
  .default({});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = paramsSchema.parse(await params);
    if (!isPaperclipBridgeEnabled()) {
      return errorResponse(
        409,
        "bridge_disabled",
        "Paperclip bridge is disabled for current orchestration runtime",
        {
          executionProvider: getOrchestrationExecutionProvider(),
        }
      );
    }

    const bodyRaw = await req.text();
    const body = bodySchema.parse(bodyRaw ? JSON.parse(bodyRaw) : undefined);

    const result = await triggerTaskAssignmentHeartbeat({
      taskId: id,
      idempotencyKey: body.idempotencyKey,
      reason: body.reason,
      forceFreshSession: body.forceFreshSession,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid heartbeat trigger payload", error.flatten());
    }
    if (isBridgeClientError(error)) {
      return errorResponse(error.status, error.code, error.message, { retriable: error.retriable });
    }
    return handleRouteError(error, "task-bridge:trigger-heartbeat:post");
  }
}
