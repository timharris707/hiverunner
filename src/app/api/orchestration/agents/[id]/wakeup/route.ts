import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { enqueueWakeup } from "@/lib/orchestration/engine/engine";
import type { WakeupSource } from "@/lib/orchestration/engine/engine";

export const dynamic = "force-dynamic";

const VALID_WAKEUP_SOURCES: readonly WakeupSource[] = [
  "timer",
  "issue_assigned",
  "routine",
  "explicit",
  "api",
  "kickoff",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params;
    const db = getOrchestrationDb();

    const agent = db
      .prepare("SELECT id, company_id FROM agents WHERE id = ? AND archived_at IS NULL LIMIT 1")
      .get(agentId) as { id: string; company_id: string } | undefined;

    if (!agent) {
      return errorResponse(404, "agent_not_found", `Agent '${agentId}' not found`);
    }

    const body = await request.json().catch(() => ({}));
    const rawSource = typeof body.source === "string" ? body.source : "api";
    if (!VALID_WAKEUP_SOURCES.includes(rawSource as WakeupSource)) {
      return errorResponse(
        400,
        "invalid_wakeup_source",
        `source must be one of: ${VALID_WAKEUP_SOURCES.join(", ")}`,
        { received: rawSource }
      );
    }
    const source = rawSource as WakeupSource;
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const payload = typeof body.payload === "object" && body.payload ? body.payload : undefined;

    // Important: payload.taskKey is consumed later by resolveTaskKey() as a
    // canonical task identifier, which currently means the internal tasks.id
    // UUID, not the human-facing task_key like "VIR-5". If callers only want
    // to wake the agent on its current assignment, omit payload.taskKey and let
    // the engine resolve the active task automatically.

    const result = enqueueWakeup(
      {
        agentId: agent.id,
        companyId: agent.company_id,
        source,
        reason,
        payload,
      },
      db
    );

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return handleRouteError(error, "agents.wakeup");
  }
}
