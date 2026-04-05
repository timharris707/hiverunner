import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { getHeartbeatRun } from "@/lib/orchestration/engine/engine";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/engine/runs/{runId}/events
 *
 * Returns the persisted event history for a heartbeat run,
 * mapped to canonical MCLiveEvent-compatible shapes.
 *
 * Data sources (honest provenance):
 *  1. heartbeat_run_events — in-flight engine events (session_start, waiting,
 *     parsing_complete, action_executed, actions_complete)
 *  2. comments authored during the run window — collaboration artifacts
 *
 * Limitations:
 *  - These are persisted engine-side events, NOT reconstructed SSE deltas.
 *  - No assistant text deltas are persisted; streaming text is ephemeral.
 *  - Tool call start/end pairs are not available from the current provider.
 *  - The timeline may have gaps between events when the agent was thinking.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const db = getOrchestrationDb();

    // Verify run exists
    const run = getHeartbeatRun(runId, db);
    if (!run) {
      return errorResponse(404, "run_not_found", `Run '${runId}' not found`);
    }

    // 1. Engine-side in-flight events
    const engineEvents = db
      .prepare(
        `SELECT id, event_type, detail, created_at
         FROM heartbeat_run_events
         WHERE run_id = ?
         ORDER BY created_at ASC`
      )
      .all(runId) as Array<{
        id: string;
        event_type: string;
        detail: string;
        created_at: string;
      }>;

    // 2. Comments authored during the run window
    const comments = run.startedAt
      ? (db
          .prepare(
            `SELECT id, body, type, source, author_name, created_at
             FROM comments
             WHERE created_at >= ? AND created_at <= ?
             ORDER BY created_at ASC
             LIMIT 50`
          )
          .all(
            run.startedAt,
            run.finishedAt ?? new Date().toISOString()
          ) as Array<{
            id: string;
            body: string;
            type: string;
            source: string;
            author_name: string | null;
            created_at: string;
          }>)
      : [];

    // Map engine events to canonical shape
    const canonicalEvents = engineEvents.map((e) => ({
      id: e.id,
      kind: mapEngineEventType(e.event_type),
      summary: e.detail,
      ts: new Date(e.created_at).getTime(),
      source: "engine" as const,
      providerEventType: e.event_type,
    }));

    // Map comments to canonical shape
    const canonicalComments = comments.map((c) => ({
      id: c.id,
      kind: "comment_written" as MCLiveEventKind,
      summary: c.body.length > 200 ? c.body.slice(0, 197) + "..." : c.body,
      ts: new Date(c.created_at).getTime(),
      source: "comment" as const,
      commentSource: c.source,
      commentType: c.type,
      authorName: c.author_name,
    }));

    // Merge and sort chronologically
    const timeline = [...canonicalEvents, ...canonicalComments].sort(
      (a, b) => a.ts - b.ts
    );

    // Run metadata
    const agent = db
      .prepare("SELECT name, slug, emoji FROM agents WHERE id = ? LIMIT 1")
      .get(run.agentId) as { name: string; slug: string; emoji: string | null } | undefined;

    return NextResponse.json({
      run: {
        id: run.id,
        agentId: run.agentId,
        agentName: agent?.name ?? "Unknown",
        agentSlug: agent?.slug ?? "",
        agentEmoji: agent?.emoji ?? null,
        companyId: run.companyId,
        status: run.status,
        invocationSource: run.invocationSource,
        triggerDetail: run.triggerDetail,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        sessionIdBefore: run.sessionIdBefore,
        sessionIdAfter: run.sessionIdAfter,
        usage: run.usage,
        result: run.result,
        exitCode: run.exitCode,
        error: run.error,
        createdAt: run.createdAt,
      },
      timeline,
      provenance: {
        note: "Timeline events come from persisted engine milestones and comments. Streaming assistant text deltas are ephemeral and not included. Tool call details are not available from the current provider.",
        sources: ["heartbeat_run_events", "comments"],
      },
      provider: {
        id: "openclaw-heartbeat",
        displayName: "OpenClaw Heartbeat",
        tier: 3,
        tierLabel: "Action Detection",
        capabilities: {
          liveText: true,
          structuredTools: false,
          thinking: false,
          runSteering: false,
        },
      },
    });
  } catch (error) {
    return handleRouteError(error, "engine.runs.events");
  }
}

/**
 * Map engine event_type to canonical MCLiveEventKind.
 * Preserves honest provenance: these are engine milestones, not streaming events.
 */
function mapEngineEventType(eventType: string): MCLiveEventKind {
  switch (eventType) {
    case "session_start":
      return "run_start";
    case "waiting":
      return "assistant_text_delta"; // agent is thinking
    case "parsing_complete":
      return "assistant_text_final";
    case "action_executed":
      return "action_detected";
    case "actions_complete":
      return "run_end";
    case "error":
      return "run_error";
    default:
      return "action_detected";
  }
}
