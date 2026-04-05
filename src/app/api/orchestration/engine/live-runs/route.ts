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

    // For each active agent, fetch their latest comment as "latest output"
    const activeAgentIds = [...new Set(runs.map((r) => r.agent_id))];
    const latestOutputByAgent = new Map<string, string>();

    for (const agentId of activeAgentIds) {
      const comment = db
        .prepare(
          `SELECT body FROM comments
           WHERE author_agent_id = ? AND source = 'openclaw'
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(agentId) as { body: string } | undefined;
      if (comment) {
        latestOutputByAgent.set(agentId, comment.body.slice(0, 500));
      }
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
        latestOutput: latestOutputByAgent.get(r.agent_id) ?? null,
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
