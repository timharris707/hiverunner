import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { getHeartbeatRun } from "@/lib/orchestration/engine/engine";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/engine/runs/{runId}/events
 *
 * Returns run metadata and a persisted event timeline.
 *
 * Supports two run tables:
 *  1. heartbeat_runs — engine-level runs with in-flight events
 *     (heartbeat_run_events table). Richest timeline.
 *  2. execution_runs — orchestration-level runs.
 *     No in-flight events table; timeline comes from comments only.
 *
 * The API tries heartbeat_runs first, then falls back to execution_runs.
 *
 * Limitations:
 *  - Streaming assistant text deltas are ephemeral and not included.
 *  - Tool call details are not available from the current provider.
 *  - The timeline may have gaps while the agent was thinking.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const db = getOrchestrationDb();

    // Try heartbeat_runs first (richest event data)
    const heartbeatRun = getHeartbeatRun(runId, db);

    if (heartbeatRun) {
      return buildHeartbeatRunResponse(heartbeatRun, runId, db);
    }

    // Fall back to execution_runs
    const execRun = db
      .prepare(
        `SELECT r.*, t.title AS task_title, a.name AS agent_name, a.slug AS agent_slug, a.emoji AS agent_emoji
         FROM execution_runs r
         LEFT JOIN tasks t ON r.task_id = t.id
         LEFT JOIN agents a ON r.agent_id = a.id
         WHERE r.id = ? LIMIT 1`
      )
      .get(runId) as ExecutionRunRow | undefined;

    if (execRun) {
      return buildExecutionRunResponse(execRun, runId, db);
    }

    return errorResponse(404, "run_not_found", `Run '${runId}' not found`);
  } catch (error) {
    return handleRouteError(error, "engine.runs.events");
  }
}

/* ── Heartbeat Run Response ── */

interface HeartbeatRunShape {
  id: string;
  agentId: string;
  companyId: string;
  invocationSource: string;
  triggerDetail: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  sessionIdBefore: string | null;
  sessionIdAfter: string | null;
  usage: Record<string, unknown>;
  result: Record<string, unknown>;
  exitCode: number | null;
  error: string | null;
  createdAt: string;
}

function buildHeartbeatRunResponse(
  run: HeartbeatRunShape,
  runId: string,
  db: ReturnType<typeof getOrchestrationDb>
) {
  // Engine-side in-flight events
  const engineEvents = db
    .prepare(
      `SELECT id, event_type, detail, created_at
       FROM heartbeat_run_events WHERE run_id = ?
       ORDER BY created_at ASC`
    )
    .all(runId) as Array<{ id: string; event_type: string; detail: string; created_at: string }>;

  // Comments during the run window
  const comments = queryCommentsInWindow(db, run.startedAt, run.finishedAt);

  // Map to canonical timeline
  const canonicalEvents = engineEvents.map((e) => ({
    id: e.id,
    kind: mapEngineEventType(e.event_type),
    summary: e.detail,
    ts: new Date(e.created_at).getTime(),
    source: "engine" as const,
    providerEventType: e.event_type,
  }));

  const canonicalComments = comments.map((c) => ({
    id: c.id,
    kind: "comment_written" as MCLiveEventKind,
    summary: c.body.length > 200 ? c.body.slice(0, 197) + "..." : c.body,
    ts: new Date(c.created_at).getTime(),
    source: "comment" as const,
    commentSource: c.source,
    commentType: c.type,
    authorName: c.agent_name,
  }));

  const timeline = [...canonicalEvents, ...canonicalComments].sort((a, b) => a.ts - b.ts);

  // Agent metadata
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
      note: "Timeline from engine milestones (heartbeat_run_events) and comments. Streaming text deltas are ephemeral and not persisted. Structured tool events not available from this provider.",
      sources: ["heartbeat_run_events", "comments"],
      runTable: "heartbeat_runs",
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
}

/* ── Execution Run Response ── */

type ExecutionRunRow = {
  id: string;
  task_id: string;
  agent_id: string | null;
  provider: string;
  session_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  token_usage_json: string;
  duration_ms: number | null;
  created_at: string;
  task_title: string | null;
  agent_name: string | null;
  agent_slug: string | null;
  agent_emoji: string | null;
};

function buildExecutionRunResponse(
  row: ExecutionRunRow,
  runId: string,
  db: ReturnType<typeof getOrchestrationDb>
) {
  // No heartbeat_run_events for execution_runs — try to find
  // corresponding heartbeat runs by session_id for events
  let timeline: Array<{
    id: string; kind: MCLiveEventKind; summary: string;
    ts: number; source: string; providerEventType?: string;
    commentSource?: string; commentType?: string; authorName?: string | null;
  }> = [];

  if (row.session_id) {
    // Find heartbeat runs that share this session
    const hbRuns = db
      .prepare(
        `SELECT id FROM heartbeat_runs
         WHERE session_id_after = ? OR session_id_before = ?
         ORDER BY created_at DESC LIMIT 5`
      )
      .all(row.session_id, row.session_id) as Array<{ id: string }>;

    for (const hbRun of hbRuns) {
      const events = db
        .prepare(
          `SELECT id, event_type, detail, created_at
           FROM heartbeat_run_events WHERE run_id = ?
           ORDER BY created_at ASC`
        )
        .all(hbRun.id) as Array<{ id: string; event_type: string; detail: string; created_at: string }>;

      for (const e of events) {
        timeline.push({
          id: e.id,
          kind: mapEngineEventType(e.event_type),
          summary: e.detail,
          ts: new Date(e.created_at).getTime(),
          source: "engine",
          providerEventType: e.event_type,
        });
      }
    }
  }

  // Comments during the run window
  const comments = queryCommentsInWindow(db, row.started_at, row.completed_at);
  for (const c of comments) {
    timeline.push({
      id: c.id,
      kind: "comment_written",
      summary: c.body.length > 200 ? c.body.slice(0, 197) + "..." : c.body,
      ts: new Date(c.created_at).getTime(),
      source: "comment",
      commentSource: c.source,
      commentType: c.type,
      authorName: c.agent_name,
    });
  }

  timeline.sort((a, b) => a.ts - b.ts);

  // Deduplicate by id
  const seen = new Set<string>();
  timeline = timeline.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  // Resolve company ID
  const companyRow = row.agent_id
    ? db.prepare("SELECT company_id FROM agents WHERE id = ? LIMIT 1").get(row.agent_id) as { company_id: string } | undefined
    : undefined;

  const usage = safeJsonParse(row.token_usage_json);

  return NextResponse.json({
    run: {
      id: row.id,
      agentId: row.agent_id ?? "",
      agentName: row.agent_name ?? "Unknown",
      agentSlug: row.agent_slug ?? "",
      agentEmoji: row.agent_emoji ?? null,
      companyId: companyRow?.company_id ?? "",
      status: row.status === "completed" ? "succeeded" : row.status,
      invocationSource: row.provider,
      triggerDetail: null,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
      sessionIdBefore: null,
      sessionIdAfter: row.session_id,
      usage,
      result: {},
      exitCode: null,
      error: row.error_message,
      createdAt: row.created_at,
    },
    timeline,
    provenance: {
      note: timeline.length > 0
        ? "Timeline reconstructed from linked heartbeat run events and comments. This is a best-effort reconstruction — some events may be from adjacent heartbeat cycles sharing this session."
        : "No in-flight events available for this execution run. Only post-run metadata is shown.",
      sources: timeline.length > 0 ? ["heartbeat_run_events", "comments"] : ["execution_runs"],
      runTable: "execution_runs",
    },
    provider: {
      id: "openclaw-heartbeat",
      displayName: "OpenClaw Heartbeat",
      tier: timeline.length > 0 ? 3 : 1,
      tierLabel: timeline.length > 0 ? "Action Detection" : "Milestones",
      capabilities: {
        liveText: true,
        structuredTools: false,
        thinking: false,
        runSteering: false,
      },
    },
  });
}

/* ── Shared Helpers ── */

function queryCommentsInWindow(
  db: ReturnType<typeof getOrchestrationDb>,
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
) {
  if (!startedAt) return [];
  return db
    .prepare(
      `SELECT c.id, c.body, c.type, c.source, a.name AS agent_name, c.created_at
       FROM comments c
       LEFT JOIN agents a ON c.author_agent_id = a.id
       WHERE c.created_at >= ? AND c.created_at <= ?
       ORDER BY c.created_at ASC
       LIMIT 50`
    )
    .all(startedAt, finishedAt ?? new Date().toISOString()) as Array<{
      id: string; body: string; type: string; source: string;
      agent_name: string | null; created_at: string;
    }>;
}

function mapEngineEventType(eventType: string): MCLiveEventKind {
  switch (eventType) {
    case "session_start": return "run_start";
    case "waiting": return "assistant_text_delta";
    case "parsing_complete": return "assistant_text_final";
    case "action_executed": return "action_detected";
    case "actions_complete": return "run_end";
    case "error": return "run_error";
    default: return "action_detected";
  }
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}
