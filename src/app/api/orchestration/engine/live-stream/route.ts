import { NextRequest } from "next/server";

import { subscribe, initGatewayStreamBridge, getBridgeStatus, type RunStreamEvent } from "@/lib/orchestration/gateway-stream-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Ensure the gateway bridge is initialized when this module loads.
// In dev mode, server.js can't import TypeScript directly, so this
// is the lazy initialization path.
initGatewayStreamBridge();

/**
 * SSE endpoint: GET /api/orchestration/engine/live-stream?company=<slug>
 *
 * Streams real-time gateway events for active heartbeat runs.
 * Events include assistant text deltas, tool calls, and lifecycle transitions
 * forwarded from the OpenClaw gateway WebSocket bridge.
 *
 * This is TRUE streaming — events arrive within ~150ms of the gateway emitting them,
 * not from polling completed artifacts.
 */
export async function GET(req: NextRequest) {
  const companySlug = req.nextUrl.searchParams.get("company") ?? "";

  // Diagnostic endpoint: ?company=__status__
  if (companySlug === "__status__") {
    return new Response(JSON.stringify(getBridgeStatus(), null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!companySlug) {
    return new Response(JSON.stringify({ error: "company query param required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve company ID for filtering
  let companyId: string | null = null;
  try {
    const { getOrchestrationDb } = await import("@/lib/orchestration/db");
    const db = getOrchestrationDb();
    const row = db
      .prepare("SELECT id FROM companies WHERE slug = ? AND archived_at IS NULL LIMIT 1")
      .get(companySlug) as { id: string } | undefined;
    companyId = row?.id ?? null;
  } catch {
    // If DB fails, we still start the stream but won't filter (no events will match)
  }

  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", company: companySlug, ts: Date.now() })}\n\n`)
      );

      // Subscribe to gateway bridge events
      unsubscribe = subscribe((event: RunStreamEvent) => {
        if (disposed) return;

        // Filter: only events for the requested company
        if (companyId && event.companyId !== companyId) return;

        try {
          const payload = {
            type: event.kind,
            agentId: event.agentId,
            runId: event.runId,
            detail: event.detail,
            text: event.text,
            delta: event.delta,
            toolName: event.toolName,
            seq: event.seq,
            ts: event.ts,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Controller closed — clean up
          disposed = true;
          unsubscribe?.();
        }
      });

      // Keepalive every 15 seconds
      const keepalive = setInterval(() => {
        if (disposed) {
          clearInterval(keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
          disposed = true;
          unsubscribe?.();
        }
      }, 15000);
    },
    cancel() {
      disposed = true;
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
