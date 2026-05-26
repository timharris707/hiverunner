import { NextRequest } from "next/server";

import { subscribe, initAdapterRegistry, getRegistryStatus } from "@/lib/orchestration/adapters/registry";
import { toLegacyWireEvent } from "@/lib/orchestration/live-events";
import type { MCLiveEvent } from "@/lib/orchestration/live-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Ensure the adapter registry is initialized when this module loads.
// In dev mode, server.js can't import TypeScript directly, so this
// is the lazy initialization path.
initAdapterRegistry();

/**
 * SSE endpoint: GET /api/orchestration/engine/live-stream?company=<slug>
 *
 * Streams real-time canonical live events for active agent runs.
 * Events arrive from all registered provider adapters through the
 * adapter registry, mapped to a backward-compatible SSE wire format.
 *
 * This is TRUE streaming — events arrive within ~150ms of the provider emitting them,
 * not from polling completed artifacts.
 */
export async function GET(req: NextRequest) {
  const companySlug = req.nextUrl.searchParams.get("company") ?? "";

  // Diagnostic endpoint: ?company=__status__
  if (companySlug === "__status__") {
    return new Response(JSON.stringify(getRegistryStatus(), null, 2), {
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
    // Accept both slug and company code (uppercased code in `company_code` column)
    const row = db
      .prepare("SELECT id FROM companies WHERE (slug = ? OR UPPER(company_code) = UPPER(?)) AND archived_at IS NULL LIMIT 1")
      .get(companySlug, companySlug) as { id: string } | undefined;
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

      // Subscribe to canonical events from all registered adapters
      unsubscribe = subscribe((event: MCLiveEvent) => {
        if (disposed) return;

        // Filter: only events for the requested company
        if (companyId && event.companyId !== companyId) return;

        try {
          // Map canonical MCLiveEvent → backward-compatible wire format
          const payload = toLegacyWireEvent(event);
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
