/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import { pushEvent, getActiveTaskIds, getLatestEvents, type ActivityEvent } from "@/lib/activity-stream";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/activity — Agents push build activity events here.
 * Body: { taskId, action, description, status?, agent? }
 *
 * GET /api/tasks/activity — Returns recent events for all active tasks
 *        ?taskId=X — Returns recent events for a specific task
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { taskId, action, description, status, agent } = body;

    if (!taskId || !action || !description) {
      return NextResponse.json(
        { error: "Missing required fields: taskId, action, description" },
        { status: 400 }
      );
    }

    const validActions = ["READ", "WRITE", "RUN", "THINK", "SEARCH", "REVIEW", "DONE"];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    const event: ActivityEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskId,
      action,
      description,
      status: status || "completed",
      timestamp: new Date().toISOString(),
      agent: agent || undefined,
    };

    pushEvent(event);
    return NextResponse.json({ ok: true, event });
  } catch (error: any) {
    console.error("Activity POST error:", error);
    return NextResponse.json({ error: "Failed to push activity event" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const taskId = req.nextUrl.searchParams.get("taskId");

    if (taskId) {
      return NextResponse.json({ events: getLatestEvents(taskId, 50) });
    }

    // Return events for all active tasks
    const activeIds = getActiveTaskIds();
    const allEvents: Record<string, ActivityEvent[]> = {};
    for (const id of activeIds) {
      allEvents[id] = getLatestEvents(id, 20);
    }
    return NextResponse.json({ activeTaskIds: activeIds, events: allEvents });
  } catch (error: any) {
    console.error("Activity GET error:", error);
    return NextResponse.json({ error: "Failed to get activity events" }, { status: 500 });
  }
}
