/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server";
import { subscribe, getLatestEvents } from "@/lib/activity-stream";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/activity/stream?taskId=X — SSE endpoint.
 * Streams live build activity events for a specific task.
 * Sends existing events as initial burst, then streams new ones.
 */
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return new Response("Missing taskId query parameter", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send existing events as initial burst
      const existing = getLatestEvents(taskId, 50);
      for (const event of existing) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // Subscribe to new events
      const unsubscribe = subscribe(taskId, controller);

      // Send keepalive every 15s to prevent connection drop
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, 15_000);

      // Cleanup on close — the request signal aborts when client disconnects
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(keepalive);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
