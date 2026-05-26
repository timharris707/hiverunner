import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { executeHeartbeatRun, getHeartbeatRun } from "@/lib/orchestration/engine/engine";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const run = getHeartbeatRun(runId);
    if (!run) {
      return errorResponse(404, "heartbeat_run_not_found", `Heartbeat run '${runId}' not found`);
    }
    return NextResponse.json(run);
  } catch (error) {
    return handleRouteError(error, "engine.heartbeat-runs.get");
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const result = await executeHeartbeatRun(runId);
    return NextResponse.json(result, {
      status: result.error && result.status === "running" ? 409 : 200,
    });
  } catch (error) {
    return handleRouteError(error, "engine.heartbeat-runs.execute");
  }
}
