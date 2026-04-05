import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { enqueueWakeup } from "@/lib/orchestration/engine/engine";
import type { WakeupSource } from "@/lib/orchestration/engine/engine";

export const dynamic = "force-dynamic";

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
    const source = (typeof body.source === "string" ? body.source : "api") as WakeupSource;
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const payload = typeof body.payload === "object" && body.payload ? body.payload : undefined;

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
