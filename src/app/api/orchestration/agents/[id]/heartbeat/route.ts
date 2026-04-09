import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { agentHeartbeatSchema } from "@/lib/orchestration/contracts";
import { heartbeatProjectAgent } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().trim().min(1),
});

function authorizeHeartbeat(req: NextRequest) {
  const expected = process.env.ORCHESTRATION_HEARTBEAT_TOKEN?.trim();
  if (!expected) {
    return null;
  }
  const provided = req.headers.get("x-orchestration-heartbeat-token")?.trim();
  if (!provided || provided !== expected) {
    return errorResponse(401, "unauthorized", "Invalid heartbeat token");
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = authorizeHeartbeat(req);
    if (unauthorized) {
      return unauthorized;
    }

    const { id } = paramsSchema.parse(await params);
    const raw = await req.text();
    const parsed = agentHeartbeatSchema.parse(raw ? JSON.parse(raw) : undefined);

    const result = heartbeatProjectAgent({
      agentId: id,
      status: parsed.status,
      currentTaskId: parsed.currentTaskId,
      runtimeMinutesDelta: parsed.runtimeMinutesDelta,
      observedAt: parsed.observedAt,
      source: parsed.source,
      progressComment: parsed.progressComment,
    });

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent heartbeat payload", error.flatten());
    }
    return handleRouteError(error, "agent-heartbeat:post");
  }
}
