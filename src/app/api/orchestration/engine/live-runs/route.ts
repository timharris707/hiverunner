import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/engine/live-runs?company=<slug>
 *
 * Returns active and recently-completed heartbeat runs (last 2 min)
 * with their result data and latest agent output. Designed for fast
 * polling (3s) by the dashboard to show live run progress.
 */
export async function GET(request: NextRequest) {
  try {
    const companySlug = request.nextUrl.searchParams.get("company");
    if (!companySlug) {
      return NextResponse.json({ error: "company query param required" }, { status: 400 });
    }

    const db = getOrchestrationDb();

    // Resolve company
    const company = db
      .prepare("SELECT id FROM companies WHERE slug = ? AND archived_at IS NULL LIMIT 1")
      .get(companySlug) as { id: string } | undefined;

    if (!company) {
      return NextResponse.json({ runs: [], timestamp: new Date().toISOString() });
    }

    // Fetch active runs + recently completed (last 2 min)
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const runs = db
      .prepare(
        `SELECT
           hr.id AS run_id,
           hr.agent_id,
           a.name AS agent_name,
           a.slug AS agent_slug,
           a.emoji AS agent_emoji,
           hr.status,
           hr.started_at,
           hr.finished_at,
           hr.error,
           hr.result_json,
           hr.trigger_detail
         FROM heartbeat_runs hr
         INNER JOIN agents a ON a.id = hr.agent_id
         WHERE hr.company_id = ?
           AND (
             hr.status IN ('queued', 'running')
             OR (hr.status IN ('succeeded', 'failed', 'timed_out') AND hr.finished_at > ?)
           )
         ORDER BY hr.created_at DESC
         LIMIT 20`
      )
      .all(company.id, cutoff) as Array<{
        run_id: string;
        agent_id: string;
        agent_name: string;
        agent_slug: string;
        agent_emoji: string | null;
        status: string;
        started_at: string | null;
        finished_at: string | null;
        error: string | null;
        result_json: string;
        trigger_detail: string | null;
      }>;

    // For each agent with runs, fetch recent transcript entries (comments + events)
    const activeAgentIds = [...new Set(runs.map((r) => r.agent_id))];
    type TranscriptEntry = { kind: "comment" | "event"; id: string; message: string; ts: string; type?: string };
    const transcriptByAgent = new Map<string, TranscriptEntry[]>();

    for (const agentId of activeAgentIds) {
      const comments = db
        .prepare(
          `SELECT c.id, c.body, c.type, c.created_at
           FROM comments c
           WHERE c.author_agent_id = ? AND c.source = 'openclaw'
           ORDER BY c.created_at DESC LIMIT 6`
        )
        .all(agentId) as Array<{ id: string; body: string; type: string; created_at: string }>;

      const events = db
        .prepare(
          `SELECT te.id, te.event_type, te.from_status, te.to_status,
                  t.task_key, t.title AS task_title, te.created_at
           FROM task_events te
           INNER JOIN tasks t ON t.id = te.task_id
           WHERE te.agent_id = ?
           ORDER BY te.created_at DESC LIMIT 4`
        )
        .all(agentId) as Array<{
          id: string; event_type: string; from_status: string | null;
          to_status: string | null; task_key: string; task_title: string; created_at: string;
        }>;

      const entries: TranscriptEntry[] = [
        ...comments.map((c) => ({
          kind: "comment" as const,
          id: c.id,
          message: c.body.slice(0, 500),
          ts: c.created_at,
          type: c.type,
        })),
        ...events.map((e) => ({
          kind: "event" as const,
          id: e.id,
          message:
            e.event_type === "task.status_changed" && e.from_status && e.to_status
              ? `${e.task_key} ${e.from_status} → ${e.to_status}`
              : e.event_type === "task.assigned"
                ? `${e.task_key} assigned`
                : e.event_type === "task.comment_added"
                  ? `${e.task_key} comment added`
                  : `${e.task_key} ${e.event_type}`,
          ts: e.created_at,
        })),
      ]
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()) // chronological (oldest first)
        .slice(-8); // keep last 8

      transcriptByAgent.set(agentId, entries);
    }

    const result = runs.map((r) => {
      let resultData = null;
      try {
        const parsed = JSON.parse(r.result_json || "{}");
        if (parsed && typeof parsed === "object" && parsed.actionsFound !== undefined) {
          resultData = parsed;
        }
      } catch { /* ignore parse errors */ }

      const startMs = r.started_at ? new Date(r.started_at).getTime() : null;
      const endMs = r.finished_at ? new Date(r.finished_at).getTime() : null;
      const durationMs = startMs
        ? (endMs ?? Date.now()) - startMs
        : 0;

      return {
        runId: r.run_id,
        agentId: r.agent_id,
        agentName: r.agent_name,
        agentSlug: r.agent_slug,
        agentEmoji: r.agent_emoji,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        durationMs,
        error: r.error,
        result: resultData,
        latestOutput: transcriptByAgent.get(r.agent_id)?.[transcriptByAgent.get(r.agent_id)!.length - 1]?.message?.slice(0, 500) ?? null,
        transcript: transcriptByAgent.get(r.agent_id) ?? [],
        triggerDetail: r.trigger_detail,
      };
    });

    return NextResponse.json({
      runs: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error, "engine.live-runs");
  }
}
