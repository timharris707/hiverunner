import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { isBridgeClientError, pullTaskBridgeStatus } from "@/lib/orchestration/bridge";
import { getOrchestrationExecutionProvider, isPaperclipBridgeEnabled } from "@/lib/orchestration/execution-provider";

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
    const result = await pullTaskBridgeStatus(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid task id", error.flatten());
    }
    if (isBridgeClientError(error)) {
      return errorResponse(error.status, error.code, error.message, { retriable: error.retriable });
    }
    return handleRouteError(error, "task-bridge:pull-status:get");
  }
}
