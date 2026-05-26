import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { resolveQueuedHeartbeatClaimCompanyId } from "@/lib/orchestration/service/dev-execution-test-mode";
import { deriveRunLiveness, probeRunnerPidAlive } from "@/lib/orchestration/live-run-liveness";

export const dynamic = "force-dynamic";

const RECENT_LIVE_INDICATOR_MS = 30_000;
const INACTIVE_TASK_STATUSES = new Set(["backlog", "done", "blocked", "cancelled"]);

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

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

    // Resolve company (alias-aware)
    const resolved = resolveCompanyIdBySlug(companySlug, db);
    if (!resolved) {
      return NextResponse.json({ runs: [], timestamp: new Date().toISOString() });
    }
    const company = { id: resolved.id };

    // Fetch active runs + recently completed (last 2 min).
    // In dev, queued heartbeats are only truly live for the company that currently
    // holds the dev-execution lease. Observer-only companies can accumulate queued
    // wakeups that are not claimable, so do not surface those as live runs.
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const queuedClaimCompanyId = resolveQueuedHeartbeatClaimCompanyId(db);
    const includeQueuedRuns = queuedClaimCompanyId === null || queuedClaimCompanyId === company.id;
    const liveStatusSql = includeQueuedRuns
      ? "hr.status IN ('queued', 'running')"
      : "hr.status = 'running'";

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
           hr.context_snapshot_json,
           hr.trigger_detail
         FROM heartbeat_runs hr
         INNER JOIN agents a ON a.id = hr.agent_id
         WHERE hr.company_id = ?
           AND (
             ${liveStatusSql}
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
        context_snapshot_json: string;
        trigger_detail: string | null;
      }>;

    // For each agent with runs, fetch recent transcript entries from multiple sources
    const activeAgentIds = [...new Set(runs.map((r) => r.agent_id))];
    const runIdsByAgent = new Map<string, string[]>();
    for (const r of runs) {
      const existing = runIdsByAgent.get(r.agent_id) ?? [];
      existing.push(r.run_id);
      runIdsByAgent.set(r.agent_id, existing);
    }

    type TranscriptEntry = { kind: "comment" | "event" | "action"; id: string; message: string; ts: string; type?: string };
    const transcriptByAgent = new Map<string, TranscriptEntry[]>();

    for (const agentId of activeAgentIds) {
      const agentRunIds = runIdsByAgent.get(agentId) ?? [];

      // Source 1: In-flight run events (from heartbeat_run_events table)
      const runEvents = agentRunIds.length > 0
        ? db
            .prepare(
              `SELECT id, event_type, detail, created_at
               FROM heartbeat_run_events
               WHERE run_id IN (${agentRunIds.map(() => "?").join(",")})
               ORDER BY created_at ASC LIMIT 20`
            )
            .all(...agentRunIds) as Array<{ id: string; event_type: string; detail: string; created_at: string }>
        : [];

      // Source 2: Recent comments by this agent. These are the most human-readable
      // pieces of the run; do not restrict them to OpenClaw because Codex, Hermes,
      // Anthropic, and other adapters write agent-authored comments with their own
      // source labels.
      const comments = db
        .prepare(
          `SELECT c.id, c.body, c.type, c.created_at
           FROM comments c
           WHERE c.author_agent_id = ?
           ORDER BY c.created_at DESC LIMIT 4`
        )
        .all(agentId) as Array<{ id: string; body: string; type: string; created_at: string }>;

      // Source 3: Recent task events by this agent
      const taskEvents = db
        .prepare(
          `SELECT te.id, te.event_type, te.from_status, te.to_status,
                  t.task_key, te.created_at
           FROM task_events te
           INNER JOIN tasks t ON t.id = te.task_id
           WHERE te.agent_id = ?
           ORDER BY te.created_at DESC LIMIT 4`
        )
        .all(agentId) as Array<{
          id: string; event_type: string; from_status: string | null;
          to_status: string | null; task_key: string; created_at: string;
        }>;

      const entries: TranscriptEntry[] = [
        // In-flight run events (highest priority — these are what's NEW)
        ...runEvents.map((e) => ({
          kind: "action" as const,
          id: e.id,
          message: e.detail || e.event_type,
          ts: e.created_at,
          type: e.event_type,
        })),
        // Comments
        ...comments.map((c) => ({
          kind: "comment" as const,
          id: c.id,
          message: c.body.slice(0, 1200),
          ts: c.created_at,
          type: c.type,
        })),
        // Task events
        ...taskEvents.map((e) => ({
          kind: "event" as const,
          id: e.id,
          message:
            e.event_type === "task.status_changed" && e.from_status && e.to_status
              ? `${e.task_key} ${e.from_status} → ${e.to_status}`
              : e.event_type === "task.comment_added"
                ? `${e.task_key} comment added`
                : `${e.task_key} ${e.event_type}`,
          ts: e.created_at,
        })),
      ]
        .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()) // chronological
        .slice(-12); // keep last 12

      transcriptByAgent.set(agentId, entries);
    }

    const result = runs.flatMap((r) => {
      let resultData = null;
      try {
        const parsed = JSON.parse(r.result_json || "{}");
        if (parsed && typeof parsed === "object" && parsed.actionsFound !== undefined) {
          resultData = parsed;
        }
      } catch { /* ignore parse errors */ }

      let contextSnapshot: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(r.context_snapshot_json || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          contextSnapshot = parsed as Record<string, unknown>;
        }
      } catch { /* ignore parse errors */ }
      const taskId = typeof contextSnapshot.taskId === "string" ? contextSnapshot.taskId : null;
      let runnerProvider = cleanString(contextSnapshot.runnerProvider);
      let runnerModel = cleanString(contextSnapshot.runnerModel);
      let runnerPid: number | null = null;
      if (taskId) {
        const taskState = db
          .prepare("SELECT status, archived_at FROM tasks WHERE id = ? LIMIT 1")
          .get(taskId) as { status: string; archived_at: string | null } | undefined;
        if (!taskState || taskState.archived_at || INACTIVE_TASK_STATUSES.has(taskState.status)) {
          return [];
        }
        const executionRun = db
          .prepare(
            `SELECT runner_provider, runner_model, process_pid
             FROM execution_runs
             WHERE task_id = ?
               AND status IN ('queued', 'pending', 'running')
             ORDER BY
               CASE WHEN status = 'running' THEN 0 ELSE 1 END,
               COALESCE(started_at, updated_at, created_at) DESC,
               rowid DESC
             LIMIT 1`
          )
          .get(taskId) as { runner_provider: string | null; runner_model: string | null; process_pid: number | null } | undefined;
        runnerProvider = runnerProvider ?? cleanString(executionRun?.runner_provider);
        runnerModel = runnerModel ?? cleanString(executionRun?.runner_model);
        runnerPid = typeof executionRun?.process_pid === "number" && executionRun.process_pid > 0
          ? executionRun.process_pid
          : null;
      }

      const startMs = r.started_at ? new Date(r.started_at).getTime() : null;
      const endMs = r.finished_at ? new Date(r.finished_at).getTime() : null;
      const durationMs = startMs
        ? (endMs ?? Date.now()) - startMs
        : 0;
      const isTerminal = r.status === "succeeded" || r.status === "failed" || r.status === "timed_out";
      const liveIndicatorUntil = isTerminal && endMs
        ? new Date(endMs + RECENT_LIVE_INDICATOR_MS).toISOString()
        : null;

      const transcript = transcriptByAgent.get(r.agent_id) ?? [];
      const latestReadable = [...transcript]
        .reverse()
        .find((entry) => entry.kind === "comment" || entry.type === "assistant_final");

      // Newest signal across all sources we showed in transcript — used for
      // liveness derivation so quiet-but-alive runs are distinguishable from
      // stalled ones. Falls back to started_at when transcript is empty.
      const transcriptLatestMs = transcript.reduce<number | null>((acc, entry) => {
        const ms = new Date(entry.ts).getTime();
        if (!Number.isFinite(ms)) return acc;
        return acc == null || ms > acc ? ms : acc;
      }, null);
      const lastEventMs = transcriptLatestMs ?? startMs;
      const lastEventAt = lastEventMs != null ? new Date(lastEventMs).toISOString() : null;

      const runnerPidAlive = probeRunnerPidAlive(runnerPid);
      const liveness = deriveRunLiveness({
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        lastEventAt,
        runnerPid,
        runnerPidAlive,
      });

      return [{
        runId: r.run_id,
        taskId,
        agentId: r.agent_id,
        agentName: r.agent_name,
        agentSlug: r.agent_slug,
        agentEmoji: r.agent_emoji,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        liveIndicatorUntil,
        runnerProvider,
        runnerModel,
        runnerPid,
        runnerPidAlive,
        durationMs,
        error: r.error,
        result: resultData,
        latestOutput: latestReadable?.message?.slice(0, 1200) ?? null,
        transcript,
        triggerDetail: r.trigger_detail,
        lastEventAt,
        lastEventAgeMs: liveness.lastEventAgeMs,
        liveness: liveness.liveness,
        livenessLabel: liveness.label,
      }];
    });

    return NextResponse.json({
      runs: result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error, "engine.live-runs");
  }
}
