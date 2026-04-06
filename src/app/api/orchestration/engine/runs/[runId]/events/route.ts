import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { getHeartbeatRun } from "@/lib/orchestration/engine/engine";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";
import { ObservabilityTier, resolveProviderPresentation } from "@/lib/orchestration/adapters/types";
import { getAdapter } from "@/lib/orchestration/adapters/registry";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/engine/runs/{runId}/events
 *
 * Returns run metadata, task context, persisted event timeline,
 * agent comments as transcript proxy, and provider capabilities.
 *
 * Supports two run tables:
 *  1. heartbeat_runs — engine-level runs with in-flight events
 *  2. execution_runs — orchestration-level runs (fallback)
 *
 * Data provenance is explicit: each section states what it comes from
 * and what is NOT included.
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
        `SELECT r.*, t.title AS task_title, t.task_key, a.name AS agent_name,
                a.slug AS agent_slug, a.emoji AS agent_emoji
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

/* ── Types ── */

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
  contextSnapshot: Record<string, unknown>;
  createdAt: string;
}

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
  task_key: string | null;
  agent_name: string | null;
  agent_slug: string | null;
  agent_emoji: string | null;
};

/* ── Heartbeat Run Response ── */

function buildHeartbeatRunResponse(
  run: HeartbeatRunShape,
  runId: string,
  db: ReturnType<typeof getOrchestrationDb>
) {
  // Agent metadata
  const agent = db
    .prepare("SELECT name, slug, emoji FROM agents WHERE id = ? LIMIT 1")
    .get(run.agentId) as { name: string; slug: string; emoji: string | null } | undefined;

  // Task association via agent_task_sessions
  const taskAssoc = db
    .prepare(
      `SELECT s.task_key AS task_id, t.title AS task_title, t.task_key AS task_key,
              t.status AS task_status, t.priority AS task_priority
       FROM agent_task_sessions s
       LEFT JOIN tasks t ON s.task_key = t.id
       WHERE s.agent_id = ? AND s.last_run_id = ?
       LIMIT 1`
    )
    .get(run.agentId, runId) as {
      task_id: string; task_title: string | null; task_key: string | null;
      task_status: string | null; task_priority: string | null;
    } | undefined;

  // Engine-side in-flight events
  const engineEvents = db
    .prepare(
      `SELECT id, event_type, detail, created_at
       FROM heartbeat_run_events WHERE run_id = ?
       ORDER BY created_at ASC`
    )
    .all(runId) as Array<{ id: string; event_type: string; detail: string; created_at: string }>;

  // Agent-authored comments during the run window (filtered by agent_id)
  const agentComments = queryAgentComments(db, run.agentId, run.startedAt, run.finishedAt);

  // Map engine events to canonical timeline
  const timelineEvents = engineEvents.map((e) => ({
    id: e.id,
    kind: mapEngineEventType(e.event_type),
    summary: e.detail,
    ts: new Date(e.created_at).getTime(),
    source: "engine_milestone" as const,
    providerEventType: e.event_type,
  }));

  // Map comments to canonical timeline
  const timelineComments = agentComments.map((c) => ({
    id: c.id,
    kind: "comment_written" as MCLiveEventKind,
    summary: c.body.length > 300 ? c.body.slice(0, 297) + "..." : c.body,
    ts: new Date(c.created_at).getTime(),
    source: "persisted_comment" as const,
    commentSource: c.source,
    commentType: c.type,
    authorName: c.agent_name,
  }));

  const timeline = [...timelineEvents, ...timelineComments].sort((a, b) => a.ts - b.ts);

  // Context snapshot — summarize, don't dump raw JSON
  const context = buildContextSummary(run.contextSnapshot);

  // Provider tier for heartbeat runs
  const tier = ObservabilityTier.ActionDetection;

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
    task: taskAssoc
      ? {
          id: taskAssoc.task_id,
          title: taskAssoc.task_title,
          key: taskAssoc.task_key,
          status: taskAssoc.task_status,
          priority: taskAssoc.task_priority,
        }
      : null,
    context,
    transcript: {
      entries: agentComments.map((c) => ({
        id: c.id,
        body: c.body,
        type: c.type,
        source: c.source,
        authorName: c.agent_name,
        ts: new Date(c.created_at).getTime(),
      })),
      provenance: {
        label: "Persisted agent comments",
        note: "These are comments the agent wrote during execution. They are NOT the full assistant transcript — reasoning, internal decisions, and text between actions are not persisted. This is a partial proxy for what the agent said.",
        totalEntries: agentComments.length,
        source: "comments",
        fullTranscriptAvailable: false,
      },
    },
    timeline,
    provenance: {
      timeline: {
        label: "Engine milestones + persisted comments",
        note: "Engine events record when actions started/completed. Comments capture what the agent wrote. Streaming text deltas are ephemeral and not included. Gaps between events represent agent thinking time.",
        sources: ["heartbeat_run_events", "comments"],
      },
      runTable: "heartbeat_runs",
    },
    provider: providerForWire("openclaw-heartbeat", tier),
  });
}

/* ── Execution Run Response ── */

function buildExecutionRunResponse(
  row: ExecutionRunRow,
  runId: string,
  db: ReturnType<typeof getOrchestrationDb>
) {
  // Reconstruct timeline from linked heartbeat runs
  let timeline: Array<{
    id: string; kind: MCLiveEventKind; summary: string;
    ts: number; source: string; providerEventType?: string;
    commentSource?: string; commentType?: string; authorName?: string | null;
  }> = [];

  if (row.session_id) {
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
          source: "engine_milestone",
          providerEventType: e.event_type,
        });
      }
    }
  }

  // Agent-filtered comments
  const agentComments = row.agent_id
    ? queryAgentComments(db, row.agent_id, row.started_at, row.completed_at)
    : [];

  for (const c of agentComments) {
    timeline.push({
      id: c.id,
      kind: "comment_written",
      summary: c.body.length > 300 ? c.body.slice(0, 297) + "..." : c.body,
      ts: new Date(c.created_at).getTime(),
      source: "persisted_comment",
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

  // Resolve company
  const companyRow = row.agent_id
    ? db.prepare("SELECT company_id FROM agents WHERE id = ? LIMIT 1").get(row.agent_id) as { company_id: string } | undefined
    : undefined;

  const usage = safeJsonParse(row.token_usage_json);

  // Determine effective tier: cap at the adapter's declared maximum
  const adapter = getAdapter(row.provider) ?? getAdapter("openclaw-heartbeat");
  const adapterMaxTier = adapter?.maxTier ?? ObservabilityTier.PostRun;
  const dataTier = timeline.length > 0 ? ObservabilityTier.ActionDetection : ObservabilityTier.Milestones;
  const effectiveTier = Math.min(dataTier, adapterMaxTier) as ObservabilityTier;

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
    task: row.task_title
      ? { id: row.task_id, title: row.task_title, key: row.task_key, status: null, priority: null }
      : null,
    context: null,
    transcript: {
      entries: agentComments.map((c) => ({
        id: c.id,
        body: c.body,
        type: c.type,
        source: c.source,
        authorName: c.agent_name,
        ts: new Date(c.created_at).getTime(),
      })),
      provenance: {
        label: row.provider === "paperclip"
          ? "Paperclip issue comments"
          : "Persisted agent comments",
        note: row.provider === "paperclip"
          ? agentComments.length > 0
            ? "Comments imported from the Paperclip issue via bridge sync. These reflect what the agent wrote on the Paperclip side."
            : "No comments synced from Paperclip for this run."
          : agentComments.length > 0
            ? "Partial proxy for agent output. Full transcript is not persisted."
            : "No agent comments found for this run window.",
        totalEntries: agentComments.length,
        source: row.provider === "paperclip" ? "paperclip_bridge" : "comments",
        fullTranscriptAvailable: false,
      },
    },
    timeline,
    provenance: {
      timeline: {
        label: row.provider === "paperclip"
          ? "Paperclip bridge sync"
          : timeline.length > 0
            ? "Reconstructed from linked heartbeat cycles"
            : "Post-run metadata only",
        note: row.provider === "paperclip"
          ? "Events from Paperclip issue comments imported via bridge sync. Paperclip is poll-based — no live streaming. Comments represent what the agent wrote on the Paperclip issue."
          : timeline.length > 0
            ? "Events may be from adjacent heartbeat cycles sharing this session. Not all runs have engine events."
            : "No in-flight events available. Only run status is known.",
        sources: row.provider === "paperclip"
          ? ["execution_runs", "comments (source=paperclip)"]
          : timeline.length > 0 ? ["heartbeat_run_events", "comments"] : ["execution_runs"],
      },
      runTable: "execution_runs",
    },
    provider: resolveProviderInfo(row.provider, effectiveTier),
  });
}

/* ── Provider Resolution ── */

/**
 * Resolve provider identity for API wire format.
 *
 * Uses the adapter registry to get the runtime-correct effective tier,
 * then delegates to resolveProviderPresentation() for canonical identity.
 * Maps `providerId` → `id` for backward-compatible JSON response shape.
 */
function resolveProviderInfo(providerName: string, effectiveTier?: ObservabilityTier) {
  // If no effective tier was provided, try the adapter registry for runtime truth
  if (effectiveTier === undefined) {
    const adapter = getAdapter(providerName) ?? getAdapter("openclaw-heartbeat");
    if (adapter) {
      effectiveTier = adapter.maxTier;
    }
  }

  // Delegate to the shared canonical resolution
  const pres = resolveProviderPresentation(providerName, effectiveTier);

  // Wire format: `id` (not `providerId`) for backward compat with run detail page
  return {
    id: pres.providerId,
    displayName: pres.displayName,
    tier: pres.tier,
    tierLabel: pres.tierLabel,
    capabilities: pres.capabilities,
  };
}

/**
 * Shorthand: resolve for wire format from provider ID + tier.
 * Used by buildHeartbeatRunResponse where we don't need registry lookup.
 */
function providerForWire(providerId: string, tier: ObservabilityTier) {
  const pres = resolveProviderPresentation(providerId, tier);
  return {
    id: pres.providerId,
    displayName: pres.displayName,
    tier: pres.tier,
    tierLabel: pres.tierLabel,
    capabilities: pres.capabilities,
  };
}

/* ── Shared Helpers ── */

function queryAgentComments(
  db: ReturnType<typeof getOrchestrationDb>,
  agentId: string,
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
) {
  if (!startedAt) return [];
  return db
    .prepare(
      `SELECT c.id, c.body, c.type, c.source, a.name AS agent_name, c.created_at
       FROM comments c
       LEFT JOIN agents a ON c.author_agent_id = a.id
       WHERE c.author_agent_id = ?
         AND c.created_at >= ? AND c.created_at <= ?
       ORDER BY c.created_at ASC
       LIMIT 50`
    )
    .all(agentId, startedAt, finishedAt ?? new Date().toISOString()) as Array<{
      id: string; body: string; type: string; source: string;
      agent_name: string | null; created_at: string;
    }>;
}

/**
 * Maps engine event_type to canonical MCLiveEventKind.
 * Honest mapping: engine milestones are NOT assistant text events.
 */
function mapEngineEventType(eventType: string): MCLiveEventKind {
  switch (eventType) {
    case "session_start": return "run_start";
    case "waiting": return "run_progress";        // honestly: agent is processing, no text emitted
    case "parsing_complete": return "assistant_text_final"; // response received and parsed
    case "action_executed": return "action_detected";
    case "actions_complete": return "run_end";
    case "error": return "run_error";
    default: return "action_detected";
  }
}

function buildContextSummary(snapshot: Record<string, unknown>): {
  wakeSource: string | null;
  wakeReason: string | null;
} | null {
  if (!snapshot || Object.keys(snapshot).length === 0) return null;
  return {
    wakeSource: typeof snapshot.wakeSource === "string" ? snapshot.wakeSource : null,
    wakeReason: typeof snapshot.wakeReason === "string" ? snapshot.wakeReason : null,
  };
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}
