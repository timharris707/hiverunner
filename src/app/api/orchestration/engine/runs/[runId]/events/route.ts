import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { getHeartbeatRun } from "@/lib/orchestration/engine/engine";
import { listExecutionTranscriptEvents } from "@/lib/orchestration/service/execution-transcript";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";
import { ObservabilityTier, PROVIDER_PRODUCT_DESCRIPTORS, resolveProviderPresentation } from "@/lib/orchestration/adapters/types";
import { getAdapter } from "@/lib/orchestration/adapters/registry";
import { listSkillEffectivenessForRun } from "@/lib/orchestration/skill-effectiveness";
import { getMemoryInjectionEvidenceForRun } from "@/lib/orchestration/memory-vault";

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
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const db = getOrchestrationDb();
    const includeMemoryDiagnostics = (() => {
      const truthy = (value: string | null) => {
        if (!value) return false;
        const normalized = value.trim().toLowerCase();
        return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
      };
      const searchParams = request.nextUrl.searchParams;
      return truthy(searchParams.get("includeDiagnostics")) ||
        truthy(searchParams.get("diagnostics")) ||
        truthy(searchParams.get("includeMemoryDiagnostics"));
    })();

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
      return buildExecutionRunResponse(execRun, runId, db, includeMemoryDiagnostics);
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
  wakeupRequestId: string | null;
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
  task_id: string | null;
  agent_id: string | null;
  provider: string;
  execution_engine: string | null;
  runner_provider: string | null;
  runner_model: string | null;
  model_lane: string | null;
  fallback_used: number | null;
  fallback_index: number | null;
  fallback_from_provider: string | null;
  route_attempts_json: string | null;
  session_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  token_usage_json: string;
  duration_ms: number | null;
  idempotency_key: string | null;
  created_at: string;
  task_title: string | null;
  task_key: string | null;
  agent_name: string | null;
  agent_slug: string | null;
  agent_emoji: string | null;
};

type WakeupRequestRow = {
  id: string;
  source: string;
  reason: string | null;
  trigger_detail: string | null;
  status: string;
  idempotency_key: string | null;
  requested_at: string;
  claimed_at: string | null;
  finished_at: string | null;
};

type LinkedHeartbeatRow = {
  id: string;
  invocation_source: string;
  trigger_detail: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  wakeup_request_id: string | null;
  session_id_before: string | null;
  session_id_after: string | null;
  usage_json: string;
  result_json: string;
  context_snapshot_json: string;
  created_at: string;
};

type TranscriptTimelineEvent = {
  id: string;
  kind: MCLiveEventKind;
  summary: string;
  ts: number;
  source: string;
  providerEventType?: string;
  commentSource?: string;
  commentType?: string;
  authorName?: string | null;
};

function normalizeWorkspaceRunVisibility(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.schema === "hiverunner.workspace_run_visibility.v1" ? record : null;
}

/* ── Heartbeat Run Response ── */

function buildHeartbeatRunResponse(
  run: HeartbeatRunShape,
  runId: string,
  db: ReturnType<typeof getOrchestrationDb>
) {
  const wakeupRequest = queryWakeupRequest(db, run.wakeupRequestId);

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
  const metrics = buildRunMetrics(run.usage, run.result, computeDurationMs(run.startedAt, run.finishedAt));
  const invocation = buildInvocationDetails({
    providerId: "openclaw-heartbeat",
    runTable: "heartbeat_runs",
    wakeupRequest,
    linkedHeartbeatCount: 1,
    note: wakeupRequest
      ? "This page shows a single OpenClaw heartbeat cycle with its own wakeup request provenance."
      : "This page shows a single OpenClaw heartbeat cycle. No linked wakeup request record was found.",
  });
  const providerExecution = buildProviderExecutionSummary("openclaw-heartbeat", run.usage, {
    linkedHeartbeatCount: 1,
  });

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
      providerId: "openclaw-heartbeat",
      invocationSource: run.invocationSource,
      triggerDetail: run.triggerDetail,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: metrics.durationMs,
      wakeupRequestId: run.wakeupRequestId,
      idempotencyKey: wakeupRequest?.idempotency_key ?? null,
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
    invocation,
    metrics,
    providerExecution,
    skillEffectiveness: { events: [], totals: emptySkillEffectivenessTotals() },
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
  db: ReturnType<typeof getOrchestrationDb>,
  includeMemoryDiagnostics: boolean
) {
  // Reconstruct timeline from linked heartbeat runs
  const linkedHeartbeatRuns = row.session_id ? queryLinkedHeartbeatRuns(db, row.session_id) : [];
  const singleLinkedHeartbeat = linkedHeartbeatRuns.length === 1 ? linkedHeartbeatRuns[0] : null;
  const linkedWakeupRequest = singleLinkedHeartbeat
    ? queryWakeupRequest(db, singleLinkedHeartbeat.wakeup_request_id)
    : null;
  let timeline: TranscriptTimelineEvent[] = [];

  for (const hbRun of linkedHeartbeatRuns) {
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
  const memoryEvidence = companyRow?.company_id
    ? (() => {
        try {
          return getMemoryInjectionEvidenceForRun(companyRow.company_id, row.id, {
            db,
            limit: 20,
            includeDiagnostics: includeMemoryDiagnostics,
          });
        } catch {
          return null;
        }
      })()
    : null;

  const usage = safeJsonParse(row.token_usage_json);
  const workspaceRunVisibility = normalizeWorkspaceRunVisibility(usage.workspaceRunVisibility);
  const transcriptEvents = listExecutionTranscriptEvents(db, row.id);
  for (const event of transcriptEvents) {
    timeline.push({
      id: event.id,
      kind: toLiveEventKind(event.kind),
      summary: event.title
        ? `${event.title}${event.body ? `: ${event.body.slice(0, 260)}` : ""}`
        : event.body.slice(0, 300),
      ts: new Date(event.occurredAt).getTime(),
      source: "execution_transcript",
      providerEventType: event.kind,
      commentSource: event.provider,
      commentType: event.role ?? event.kind,
      authorName: event.role === "assistant" ? row.agent_name : event.provider,
    });
  }
  timeline.sort((a, b) => a.ts - b.ts);
  const transcriptSeen = new Set<string>();
  timeline = timeline.filter((event) => {
    if (transcriptSeen.has(event.id)) return false;
    transcriptSeen.add(event.id);
    return true;
  });

  const context = singleLinkedHeartbeat
    ? buildContextSummary(safeJsonParse(singleLinkedHeartbeat.context_snapshot_json))
    : null;
  const metrics = buildRunMetrics(usage, {}, row.duration_ms);
  const anthropicStructuredTelemetry =
    row.provider === "anthropic" &&
    !!usage &&
    typeof usage === "object" &&
    (usage as Record<string, unknown>).structuredTelemetry === true;
  const anthropicSummaryText =
    row.provider === "anthropic" &&
    !!usage &&
    typeof usage === "object" &&
    typeof (usage as Record<string, unknown>).resultText === "string"
      ? String((usage as Record<string, unknown>).resultText).trim()
      : "";
  const transcriptEntries = transcriptEvents.length > 0
    ? transcriptEvents.map((event) => ({
        id: event.id,
        body: event.body,
        type: event.kind,
        source: event.provider,
        authorName: event.role === "assistant" ? row.agent_name : event.provider,
        ts: new Date(event.occurredAt).getTime(),
        eventKind: event.kind,
        role: event.role,
        title: event.title,
        metadata: event.metadata,
      }))
    : [
      ...agentComments.map((c) => ({
        id: c.id,
        body: c.body,
        type: c.type,
        source: c.source,
        authorName: c.agent_name,
        ts: new Date(c.created_at).getTime(),
      })),
      ...(row.provider === "anthropic" && agentComments.length === 0 && anthropicSummaryText
      ? [{
          id: `${row.id}:anthropic-summary`,
          body: anthropicSummaryText,
          type: "comment",
          source: "anthropic",
          authorName: row.agent_name ?? "Anthropic",
          ts: row.completed_at ? new Date(row.completed_at).getTime() : new Date(row.created_at).getTime(),
        }]
      : []),
    ];
  const skillEffectiveness = listSkillEffectivenessForRun(db, row.id);

  // Determine effective tier: cap at the adapter's declared maximum.
  // Try runtime registry first, fall back to static product descriptors
  // (registry may not be initialized in all server contexts).
  const adapter = getAdapter(row.provider);
  const adapterMaxTier = adapter?.maxTier
    ?? PROVIDER_PRODUCT_DESCRIPTORS.find((p) => p.providerId === row.provider)?.maxTier
    ?? ObservabilityTier.PostRun;
  const transcriptHasStructuredTools = transcriptEvents.some((event) =>
    event.kind === "tool_call_start" || event.kind === "tool_call_end" || event.kind === "tool_result",
  );
  const transcriptHasAssistantText = transcriptEvents.some((event) =>
    event.kind === "assistant_text_delta" || event.kind === "assistant_text_final",
  );
  const dataTier = transcriptHasStructuredTools || anthropicStructuredTelemetry
    ? ObservabilityTier.StructuredTools
    : transcriptHasAssistantText
      ? ObservabilityTier.LiveText
      : timeline.length > 0
        ? ObservabilityTier.ActionDetection
        : ObservabilityTier.Milestones;
  const effectiveTier = Math.min(dataTier, adapterMaxTier) as ObservabilityTier;
  const invocation = buildInvocationDetails({
    providerId: row.provider,
    runTable: "execution_runs",
    wakeupRequest: linkedWakeupRequest,
    idempotencyKey: row.idempotency_key,
    linkedHeartbeatCount: linkedHeartbeatRuns.length,
    note: buildExecutionInvocationNote(row.provider, linkedHeartbeatRuns.length),
  });
  const providerExecution = buildProviderExecutionSummary(
    row.provider,
    singleLinkedHeartbeat && row.provider === "openclaw"
      ? safeJsonParse(singleLinkedHeartbeat.usage_json)
      : usage,
    { linkedHeartbeatCount: linkedHeartbeatRuns.length }
  );
  const resolvedExecution = buildExecutionRunResolvedExecution(row, usage);

  return NextResponse.json({
    run: {
      id: row.id,
      agentId: row.agent_id ?? "",
      agentName: row.agent_name ?? "Unknown",
      agentSlug: row.agent_slug ?? "",
      agentEmoji: row.agent_emoji ?? null,
      companyId: companyRow?.company_id ?? "",
      status: row.status === "completed" ? "succeeded" : row.status,
      providerId: row.provider,
      executionEngine: row.execution_engine ?? (row.provider === "symphony" ? "symphony" : "hiverunner"),
      runnerProvider: row.runner_provider ?? row.provider,
      runnerModel: row.runner_model ?? textValue(usage.runnerModel) ?? textValue(usage.model) ?? null,
      fallbackUsed: row.fallback_used === 1,
      fallbackIndex: row.fallback_index,
      fallbackFromProvider: row.fallback_from_provider,
      routeAttempts: safeJsonParseArray(row.route_attempts_json),
      invocationSource: row.provider,
      triggerDetail: null,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
      durationMs: metrics.durationMs,
      wakeupRequestId: linkedWakeupRequest?.id ?? null,
      idempotencyKey: row.idempotency_key,
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
    context,
    transcript: {
      entries: transcriptEntries,
      provenance: {
        label: transcriptEvents.length > 0
          ? "Provider transcript events"
          : row.provider === "codex"
            ? "Codex CLI transcript"
            : row.provider === "anthropic"
              ? "Claude Code CLI summary"
            : "Persisted agent comments",
        note: transcriptEvents.length > 0
          ? "Provider output was normalized into HiveRunner transcript events for this execution run. Raw provider payloads remain summarized and bounded for storage."
          : row.provider === "codex"
            ? "No Codex JSON transcript events were persisted for this run; final output may still be available from the adapter fallback path."
            : row.provider === "anthropic"
              ? anthropicSummaryText
                ? "Structured Claude Code telemetry was captured from stream-json output. This transcript entry is the final assistant summary, not a full replay log."
                : "Claude Code emitted structured stream-json telemetry for this run, but a full transcript is not persisted."
            : agentComments.length > 0
              ? "Partial proxy for agent output. Full transcript is not persisted."
              : "No agent comments found for this run window.",
        totalEntries: transcriptEntries.length,
        source: transcriptEvents.length > 0 ? "execution_run_transcript_events"
          : row.provider === "codex" ? "codex_cli"
          : row.provider === "anthropic" ? "anthropic_cli"
          : "comments",
        fullTranscriptAvailable: transcriptEvents.length > 0,
      },
    },
    invocation,
    metrics,
    workspaceRunVisibility,
    resolvedExecution: {
      before: resolvedExecution,
      after: resolvedExecution,
    },
    providerExecution,
    skillEffectiveness,
    memoryEvidence,
    timeline,
    provenance: {
      timeline: {
        label: transcriptEvents.length > 0
          ? "Provider transcript events"
          : row.provider === "codex"
            ? "Codex CLI execution"
            : row.provider === "anthropic"
              ? "Claude Code CLI stream-json"
            : timeline.length > 0
              ? "Reconstructed from linked heartbeat cycles"
              : "Post-run metadata only",
        note: transcriptEvents.length > 0
          ? "Timeline includes normalized post-run provider transcript events plus any linked engine milestones or comments."
          : row.provider === "codex"
            ? "Codex CLI execution via codex exec --json when available. HiveRunner persists normalized JSON events as transcript evidence; exact token/cost detail depends on event payloads."
            : row.provider === "anthropic"
              ? "Run lifecycle and structured telemetry came from Claude Code CLI stream-json output. Live text/tool/thinking data was available during execution; this run detail view only persists summarized post-run telemetry."
            : timeline.length > 0
              ? "Events may be from adjacent heartbeat cycles sharing this session. Not all runs have engine events."
              : "No in-flight events available. Only run status is known.",
        sources: transcriptEvents.length > 0
          ? ["execution_runs", "execution_run_transcript_events"]
          : row.provider === "codex"
            ? ["execution_runs"]
            : row.provider === "anthropic"
              ? ["execution_runs (structured telemetry)"]
            : timeline.length > 0 ? ["heartbeat_run_events", "comments"] : ["execution_runs"],
      },
      runTable: "execution_runs",
    },
    provider: resolveProviderInfo(row.provider, effectiveTier),
  });
}

function usageRuntimePolicyValue(usage: Record<string, unknown>, key: "sandbox" | "approvalPolicy"): string | null {
  const capabilities = usage.runtimeCapabilities && typeof usage.runtimeCapabilities === "object" && !Array.isArray(usage.runtimeCapabilities)
    ? usage.runtimeCapabilities as Record<string, unknown>
    : {};
  const runnerEnv = usage.runnerEnv && typeof usage.runnerEnv === "object" && !Array.isArray(usage.runnerEnv)
    ? usage.runnerEnv as Record<string, unknown>
    : {};
  if (key === "sandbox") {
    return textValue(capabilities.sandbox) ?? textValue(runnerEnv.HIVERUNNER_SYMPHONY_SANDBOX);
  }
  return textValue(capabilities.approvalPolicy) ?? textValue(runnerEnv.HIVERUNNER_SYMPHONY_APPROVAL_POLICY);
}

function buildExecutionRunResolvedExecution(row: ExecutionRunRow, usage: Record<string, unknown>) {
  return {
    executionEngine: textValue(usage.executionEngine) ?? row.execution_engine ?? (row.provider === "symphony" ? "symphony" : "hiverunner"),
    provider: textValue(usage.provider) ?? row.provider,
    runnerProvider: row.runner_provider ?? textValue(usage.runnerProvider),
    runnerModel: row.runner_model ?? textValue(usage.runnerModel),
    model: textValue(usage.model) ?? textValue(usage.modelId) ?? textValue(usage.cliModel) ?? textValue(usage.runnerModel),
    modelLane: row.model_lane ?? textValue(usage.taskModelLane),
    fallbackUsed: row.fallback_used === 1,
    fallbackIndex: row.fallback_index,
    fallbackFromProvider: row.fallback_from_provider,
    workspaceRoot: textValue(usage.workspaceRoot) ?? textValue(usage.cwd),
    companyWorkspaceRoot: textValue(usage.companyWorkspaceRoot),
    sourceWorkspaceRoot: textValue(usage.sourceWorkspaceRoot),
    sandbox: usageRuntimePolicyValue(usage, "sandbox"),
    approvalPolicy: usageRuntimePolicyValue(usage, "approvalPolicy"),
    runtimeSlug: textValue(usage.runtimeSlug),
    runtimeDisplayName: textValue(usage.runtimeDisplayName),
    command: textValue(usage.command) ?? textValue(usage.cli),
    configSource: textValue(usage.configSource) ?? (textValue(usage.runtimeSlug) ? "runtime" : "run telemetry"),
    phase: "run",
  };
}

function emptySkillEffectivenessTotals() {
  return {
    availableCount: 0,
    explicitUseCount: 0,
    passCount: 0,
    failCount: 0,
    blockedCount: 0,
    unknownCount: 0,
  };
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
  // If no effective tier was provided, try the adapter registry for runtime truth,
  // then fall back to static product descriptors (registry may not be initialized).
  if (effectiveTier === undefined) {
    const adapter = getAdapter(providerName);
    if (adapter) {
      effectiveTier = adapter.maxTier;
    } else {
      const desc = PROVIDER_PRODUCT_DESCRIPTORS.find((p) => p.providerId === providerName);
      if (desc) effectiveTier = desc.maxTier;
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

function queryWakeupRequest(
  db: ReturnType<typeof getOrchestrationDb>,
  wakeupRequestId: string | null | undefined,
) {
  if (!wakeupRequestId) return null;
  return db
    .prepare(
      `SELECT id, source, reason, trigger_detail, status, idempotency_key,
              requested_at, claimed_at, finished_at
       FROM agent_wakeup_requests
       WHERE id = ?
       LIMIT 1`
    )
    .get(wakeupRequestId) as WakeupRequestRow | undefined ?? null;
}

function queryLinkedHeartbeatRuns(
  db: ReturnType<typeof getOrchestrationDb>,
  sessionId: string,
) {
  return db
    .prepare(
      `SELECT id, invocation_source, trigger_detail, status,
              started_at, finished_at, wakeup_request_id,
              session_id_before, session_id_after,
              usage_json, result_json, context_snapshot_json, created_at
       FROM heartbeat_runs
       WHERE session_id_after = ? OR session_id_before = ?
       ORDER BY created_at DESC
       LIMIT 32`
    )
    .all(sessionId, sessionId) as LinkedHeartbeatRow[];
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

function toLiveEventKind(eventKind: string): MCLiveEventKind {
  switch (eventKind) {
    case "run_start":
    case "run_end":
    case "run_error":
    case "run_progress":
    case "assistant_text_delta":
    case "assistant_text_final":
    case "thinking_delta":
    case "thinking_summary":
    case "tool_call_start":
    case "tool_call_end":
    case "tool_result":
    case "action_detected":
    case "comment_written":
    case "task_updated":
    case "report_written":
    case "error":
    case "heartbeat":
      return eventKind;
    default:
      return "run_progress";
  }
}

function buildContextSummary(snapshot: Record<string, unknown>): {
  wakeSource: string | null;
  wakeReason: string | null;
  direction: string | null;
  directionTaskId: string | null;
  issueId: string | null;
  taskKey: string | null;
} | null {
  if (!snapshot || Object.keys(snapshot).length === 0) return null;
  return {
    wakeSource: textValue(snapshot.wakeSource),
    wakeReason: textValue(snapshot.wakeReason),
    direction: textValue(snapshot.direction),
    directionTaskId: textValue(snapshot.directionTaskId),
    issueId: textValue(snapshot.issueId),
    taskKey: textValue(snapshot.taskKey),
  };
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function safeJsonParseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildInvocationDetails(input: {
  providerId: string;
  runTable: "heartbeat_runs" | "execution_runs";
  wakeupRequest: WakeupRequestRow | null;
  idempotencyKey?: string | null;
  linkedHeartbeatCount?: number;
  note?: string | null;
}) {
  return {
    providerId: input.providerId,
    runTable: input.runTable,
    wakeupRequestId: input.wakeupRequest?.id ?? null,
    idempotencyKey: input.wakeupRequest?.idempotency_key ?? input.idempotencyKey ?? null,
    wakeupStatus: input.wakeupRequest?.status ?? null,
    requestedAt: input.wakeupRequest?.requested_at ?? null,
    claimedAt: input.wakeupRequest?.claimed_at ?? null,
    completedAt: input.wakeupRequest?.finished_at ?? null,
    linkedHeartbeatCount: input.linkedHeartbeatCount ?? 0,
    note: input.note ?? null,
  };
}

function buildExecutionInvocationNote(provider: string, linkedHeartbeatCount: number) {
  if (provider === "openclaw") {
    if (linkedHeartbeatCount > 1) {
      return `This execution session links to ${linkedHeartbeatCount} OpenClaw heartbeat cycles. Timeline and session context are shown as session-level evidence, not a single authoritative transcript for the full run.`;
    }
    if (linkedHeartbeatCount === 1) {
      return "This execution run links to one OpenClaw heartbeat cycle, so engine context is shown directly.";
    }
    return "No linked OpenClaw heartbeat cycle was found for this execution run.";
  }
  if (provider === "codex") {
    return "Codex runs come from CLI execution. HiveRunner uses codex exec --json when available and stores normalized assistant, tool, lifecycle, and final-output evidence for runs executed through the heartbeat adapter.";
  }
  if (provider === "anthropic") {
    return "Claude Code runs come from CLI stream-json telemetry. HiveRunner stores normalized assistant, thinking, tool, and lifecycle events when available.";
  }
  return linkedHeartbeatCount > 0
    ? `This run links to ${linkedHeartbeatCount} engine cycle${linkedHeartbeatCount === 1 ? "" : "s"}.`
    : null;
}

function buildRunMetrics(
  usage: Record<string, unknown>,
  result: Record<string, unknown>,
  fallbackDurationMs: number | null,
) {
  const errors = Array.isArray(result.errors) ? result.errors.filter((value): value is string => typeof value === "string") : [];
  return {
    durationMs: fallbackDurationMs ?? numberValue(usage.totalDurationMs),
    promptChars: numberValue(usage.promptChars),
    promptBuildMs: numberValue(usage.promptBuildMs),
    totalDurationMs: numberValue(usage.totalDurationMs),
    thinkingDurationMs: numberValue(usage.thinkingDurationMs),
    actionExecutionMs: numberValue(usage.actionExecutionMs) ?? numberValue(result.actionExecutionMs),
    importDurationMs: numberValue(usage.importDurationMs),
    messageCountBefore: numberValue(usage.messageCountBefore),
    sessionReused: booleanValue(usage.sessionReused),
    inputTokens: numberValue(usage.inputTokens),
    outputTokens: numberValue(usage.outputTokens),
    cacheReadInputTokens: numberValue(usage.cacheReadInputTokens),
    cacheCreationInputTokens: numberValue(usage.cacheCreationInputTokens),
    totalCostUsd: numberValue(usage.totalCostUsd),
    messagesImported: numberValue(result.messagesImported),
    actionsFound: numberValue(result.actionsFound),
    actionsExecuted: numberValue(result.actionsExecuted),
    actionsSkippedDedup: numberValue(result.actionsSkippedDedup),
    reportsImported: numberValue(result.reportsImported),
    approvalsCreated: arrayLength(result.approvalsCreated),
    tasksCreated: arrayLength(result.tasksCreated),
    assistantTextLength: numberValue(result.assistantTextLength),
    plainTextLength: numberValue(result.plainTextLength),
    errorCount: errors.length > 0 ? errors.length : null,
  };
}

function buildProviderExecutionSummary(
  providerId: string,
  usage: Record<string, unknown>,
  options: { linkedHeartbeatCount?: number } = {},
) {
  const linkedHeartbeatCount = options.linkedHeartbeatCount ?? 0;
  const note = textValue(usage.note) ?? defaultProviderExecutionNote(providerId, linkedHeartbeatCount);
  return {
    source: textValue(usage.source),
    cliCommand: textValue(usage.cli),
    modelId: textValue(usage.modelId) ?? textValue(usage.cliModel),
    modelName: textValue(usage.modelName),
    factoryBuildId: textValue(usage.factoryBuildId),
    factoryTaskId: textValue(usage.factoryTaskId),
    factoryTaskTitle: textValue(usage.factoryTaskTitle),
    openclawRunId: textValue(usage.openclawRunId),
    openclawStatus: textValue(usage.openclawStatus),
    structuredTelemetry: booleanValue(usage.structuredTelemetry),
    observedLiveText: booleanValue(usage.observedLiveText),
    observedThinking: booleanValue(usage.observedThinking),
    observedStructuredTools: booleanValue(usage.observedStructuredTools),
    toolCallNames: stringArrayValue(usage.toolCallNames),
    assistantSummary: textValue(usage.assistantSummary),
    thinkingSummary: textValue(usage.thinkingSummary),
    resultSubtype: textValue(usage.resultSubtype),
    resultErrors: stringArrayValue(usage.resultErrors),
    linkedHeartbeatCount,
    note,
  };
}

function defaultProviderExecutionNote(providerId: string, linkedHeartbeatCount: number) {
  if (providerId === "codex") {
    return "Codex CLI runs use codex exec --json when available. HiveRunner persists normalized assistant, tool, lifecycle, structured-action, and final-output evidence; exact token/cost detail depends on event payloads.";
  }
  if (providerId === "anthropic") {
    return "Claude Code CLI emitted structured stream-json telemetry. HiveRunner persists normalized assistant, thinking, tool, usage, token, and cost evidence when available.";
  }
  if (providerId === "openclaw" && linkedHeartbeatCount > 1) {
    return `This OpenClaw execution run reuses a long-lived session with ${linkedHeartbeatCount} linked heartbeat cycles. Engine events are session-level evidence, not a complete transcript for one discrete run.`;
  }
  if (providerId === "openclaw" || providerId === "openclaw-heartbeat") {
    return "OpenClaw heartbeat telemetry captures engine milestones, prompt size, session reuse, and action execution summaries when available.";
  }
  return null;
}

function computeDurationMs(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : null;
}
