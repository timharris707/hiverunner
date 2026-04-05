import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/orchestration/api";
import { tick } from "@/lib/orchestration/engine/engine";

export const dynamic = "force-dynamic";

/**
 * Engine tick endpoint — called automatically by server.js every 10 seconds.
 * Claims and executes the next queued heartbeat run.
 *
 * Also callable manually for debugging:
 *   POST /api/orchestration/engine/tick
 *
 * Returns the tick result including whether a run was claimed and executed.
 */
export async function POST(request: NextRequest) {
  // Verify this is an internal call (from server.js or manual debug)
  const internalToken = request.headers.get("x-engine-tick");
  if (internalToken !== "1" && internalToken !== "internal") {
    // Still allow it but log
    console.log("[engine:tick] external tick call");
  }

  try {
    const result = await tick();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handleRouteError(error, "engine.tick");
  }
}
