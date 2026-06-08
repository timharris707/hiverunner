import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { resolveQueuedHeartbeatClaimCompanyId } from "@/lib/orchestration/service/dev-execution-test-mode";
import { deriveRunLiveness, isRuntimeProgressDiagnostic, latestMeaningfulProgressMs, probeRunnerPidAlive } from "@/lib/orchestration/live-run-liveness";
import { getRuntimeLaneStatus } from "@/lib/orchestration/runtime-lane-status";

export const dynamic = "force-dynamic";

const RECENT_LIVE_INDICATOR_MS = 30_000;
const INACTIVE_TASK_STATUSES = new Set(["backlog", "done", "blocked", "cancelled"]);
const TERMINAL_HEARTBEAT_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* ignore parse errors */ }
  return {};
}

type ExecutionRunRow = {
  id: string;
  task_id: string | null;
  provider: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  runner_provider: string | null;
  runner_model: string | null;
  process_pid: number | null;
  metadata_json: string | null;
};

type HeartbeatRunRow = {
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
  created_at: string;
  updated_at: string;
};

type TranscriptEntry = { kind: "comment" | "event" | "action"; id: string; message: string; ts: string; type?: string };

type ExecutionTranscriptRow = {
  id: string;
  event_kind: string;
  title: string | null;
  body: string;
  occurred_at: string;
};

function resolveExecutionRunForHeartbeat(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    executionRunId: string | null;
    heartbeatRunId: string;
  },
): ExecutionRunRow | undefined {
  if (input.executionRunId) {
    return db
      .prepare(
        `SELECT id, task_id, provider, status, started_at, completed_at, runner_provider, runner_model, process_pid,
         metadata_json
         FROM execution_runs
         WHERE id = ?
         LIMIT 1`,
      )
      .get(input.executionRunId) as ExecutionRunRow | undefined;
  }

  // Older rows may only carry the heartbeat correlation in execution metadata.
  // Keep this strictly run-id scoped so task-level concurrent/retry runs cannot
  // donate their provider, model, PID, or output to the visible heartbeat row.
  return db
    .prepare(
      `SELECT id, task_id, provider, status, started_at, completed_at, runner_provider, runner_model, process_pid,
       metadata_json
       FROM execution_runs
       WHERE (
         (json_valid(token_usage_json) AND json_extract(token_usage_json, '$.heartbeatRunId') = ?)
         OR (json_valid(metadata_json) AND json_extract(metadata_json, '$.heartbeatRunId') = ?)
       )
       ORDER BY COALESCE(updated_at, created_at) DESC, rowid DESC
       LIMIT 1`,
    )
    .get(input.heartbeatRunId, input.heartbeatRunId) as ExecutionRunRow | undefined;
}

function effectiveHeartbeatStatus(heartbeatStatus: string, executionStatus: string | null | undefined): string {
  if (executionStatus === "completed") return "succeeded";
  if (executionStatus === "failed") return "failed";
  if (executionStatus === "cancelled") return "cancelled";
  if (heartbeatStatus === "queued" && executionStatus === "running") return "running";
  return heartbeatStatus;
}

function liveTranscriptType(eventKind: string): string {
  switch (eventKind) {
    case "assistant_text_final":
      return "assistant_final";
    case "assistant_text_delta":
      return "assistant_text";
    default:
      return eventKind;
  }
}

function taskEventMessage(event: {
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  task_key: string | null;
}): string {
  const taskKey = event.task_key ?? "task";
  if (event.event_type === "task.status_changed" && event.from_status && event.to_status) {
    return `${taskKey} ${event.from_status} -> ${event.to_status}`;
  }
  if (event.event_type === "task.comment_added") {
    return `${taskKey} comment added`;
  }
  return `${taskKey} ${event.event_type}`;
}

function parseResultData(resultJson: string): Record<string, unknown> | null {
  const parsed = parseJsonRecord(resultJson);
  return parsed.actionsFound !== undefined ? parsed : null;
}

function taskIsActiveForLiveRun(
  db: ReturnType<typeof getOrchestrationDb>,
  taskId: string,
): boolean {
  const taskState = db
    .prepare("SELECT status, archived_at FROM tasks WHERE id = ? LIMIT 1")
    .get(taskId) as { status: string; archived_at: string | null } | undefined;
  return Boolean(taskState && !taskState.archived_at && !INACTIVE_TASK_STATUSES.has(taskState.status));
}

function shouldSuppressNoTaskStaleApprovalRun(input: {
  taskId: string | null;
  contextSnapshot: Record<string, unknown>;
}): boolean {
  if (input.taskId) return false;
  return input.contextSnapshot.wakeReason === "approval_requested" && input.contextSnapshot.staleApprovalSweep === true;
}

function loadExecutionTranscript(
  db: ReturnType<typeof getOrchestrationDb>,
  executionRunId: string | null,
): ExecutionTranscriptRow[] {
  if (!executionRunId) return [];
  return db
    .prepare(
      `SELECT id, event_kind, title, body, occurred_at
       FROM execution_run_transcript_events
       WHERE execution_run_id = ?
       ORDER BY sequence ASC, occurred_at ASC
       LIMIT 40`,
    )
    .all(executionRunId) as ExecutionTranscriptRow[];
}

function buildTranscript(
  heartbeatEntries: TranscriptEntry[],
  executionTranscript: ExecutionTranscriptRow[],
): TranscriptEntry[] {
  return [
    ...heartbeatEntries,
    ...executionTranscript.map((event) => ({
      kind: "action" as const,
      id: event.id,
      message: event.body || event.title || event.event_kind,
      ts: event.occurred_at,
      type: liveTranscriptType(event.event_kind),
    })),
  ]
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
    .slice(-12);
}

function latestReadableOutput(transcript: TranscriptEntry[]): string | null {
  const entry = [...transcript]
    .reverse()
    .find((candidate) => (
      candidate.kind === "comment" ||
      candidate.type === "assistant_final" ||
      candidate.type === "assistant_text"
    ));
  return entry?.message?.slice(0, 1200) ?? null;
}

function isProgressOnlyDiagnostic(entry: TranscriptEntry): boolean {
  return isRuntimeProgressDiagnostic({ type: entry.type, message: entry.message });
}

function latestTranscriptSignalMs(transcript: TranscriptEntry[]): number | null {
  return transcript.reduce<number | null>((acc, entry) => {
    if (isProgressOnlyDiagnostic(entry)) return acc;
    const ms = new Date(entry.ts).getTime();
    if (!Number.isFinite(ms)) return acc;
    return acc == null || ms > acc ? ms : acc;
  }, null);
}

function latestExternalRunnerMeaningfulOutputMs(metadataJson: string | null | undefined): number | null {
  const metadata = parseJsonRecord(metadataJson);
  const externalRunner = metadata.externalRunner;
  if (!externalRunner || typeof externalRunner !== "object" || Array.isArray(externalRunner)) return null;
  const value = (externalRunner as Record<string, unknown>).lastMeaningfulOutputAt;
  const ms = typeof value === "string" ? new Date(value).getTime() : null;
  return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
}

function shouldSuppressMirroredTerminalRun(input: {
  heartbeatFinishedAt: string | null;
  effectiveFinishedAt: string | null;
  isTerminal: boolean;
  cutoff: string;
}): boolean {
  if (input.heartbeatFinishedAt !== null || !input.effectiveFinishedAt || !input.isTerminal) return false;
  return new Date(input.effectiveFinishedAt).getTime() <= new Date(input.cutoff).getTime();
}

function loadHeartbeatRuns(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  runtime: ReturnType<typeof getRuntimeLaneStatus>;
  cutoff: string;
}): HeartbeatRunRow[] {
  const { db, companyId, runtime, cutoff } = input;
  const queuedClaimCompanyId = resolveQueuedHeartbeatClaimCompanyId(db);
  const includeQueuedRuns = runtime.engineTickActive && (queuedClaimCompanyId === null || queuedClaimCompanyId === companyId);
  const liveStatusSql = includeQueuedRuns
    ? "hr.status IN ('queued', 'running')"
    : runtime.engineTickActive
      ? "hr.status = 'running'"
      : "0";

  return db
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
         hr.trigger_detail,
         hr.created_at,
         hr.updated_at
       FROM heartbeat_runs hr
       INNER JOIN agents a ON a.id = hr.agent_id
       WHERE hr.company_id = ?
         AND (
           ${liveStatusSql}
           OR (hr.status IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND hr.finished_at > ?)
         )
       ORDER BY hr.created_at DESC
       LIMIT 20`,
    )
    .all(companyId, cutoff) as HeartbeatRunRow[];
}

function appendTranscriptEntry(
  transcriptByRun: Map<string, TranscriptEntry[]>,
  runId: string,
  entry: TranscriptEntry,
): void {
  const entries = transcriptByRun.get(runId) ?? [];
  entries.push(entry);
  transcriptByRun.set(runId, entries);
}

function loadHeartbeatTranscriptEntries(
  db: ReturnType<typeof getOrchestrationDb>,
  runIds: string[],
): Map<string, TranscriptEntry[]> {
  const transcriptByRun = new Map<string, TranscriptEntry[]>();
  if (runIds.length === 0) return transcriptByRun;

  const placeholders = runIds.map(() => "?").join(",");
  const runEvents = db
    .prepare(
      `SELECT run_id, id, event_type, detail, created_at
       FROM heartbeat_run_events
       WHERE run_id IN (${placeholders})
       ORDER BY created_at ASC
       LIMIT 200`,
    )
    .all(...runIds) as Array<{ run_id: string; id: string; event_type: string; detail: string; created_at: string }>;
  for (const event of runEvents) {
    appendTranscriptEntry(transcriptByRun, event.run_id, {
      kind: "action",
      id: event.id,
      message: event.detail || event.event_type,
      ts: event.created_at,
      type: event.event_type,
    });
  }

  const linkedComments = db
    .prepare(
      `SELECT
         CAST(json_extract(te.metadata_json, '$.runId') AS TEXT) AS run_id,
         c.id,
         c.body,
         c.type,
         c.created_at
       FROM task_events te
       INNER JOIN comments c
         ON c.task_id = te.task_id
        AND c.created_at = te.created_at
        AND ((c.author_agent_id IS NULL AND te.agent_id IS NULL) OR c.author_agent_id = te.agent_id)
       WHERE te.event_type = 'task.comment_added'
         AND json_valid(te.metadata_json)
         AND CAST(json_extract(te.metadata_json, '$.runId') AS TEXT) IN (${placeholders})
       ORDER BY c.created_at ASC
       LIMIT 120`,
    )
    .all(...runIds) as Array<{
      run_id: string | null;
      id: string;
      body: string;
      type: string;
      created_at: string;
    }>;
  for (const comment of linkedComments) {
    if (!comment.run_id) continue;
    appendTranscriptEntry(transcriptByRun, comment.run_id, {
      kind: "comment",
      id: comment.id,
      message: comment.body.slice(0, 1200),
      ts: comment.created_at,
      type: comment.type,
    });
  }

  const taskEvents = db
    .prepare(
      `SELECT
         CAST(json_extract(te.metadata_json, '$.runId') AS TEXT) AS run_id,
         te.id,
         te.event_type,
         te.from_status,
         te.to_status,
         t.task_key,
         te.created_at
       FROM task_events te
       INNER JOIN tasks t ON t.id = te.task_id
       WHERE json_valid(te.metadata_json)
         AND CAST(json_extract(te.metadata_json, '$.runId') AS TEXT) IN (${placeholders})
       ORDER BY te.created_at ASC
       LIMIT 120`,
    )
    .all(...runIds) as Array<{
      run_id: string | null;
      id: string;
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      task_key: string | null;
      created_at: string;
    }>;
  for (const event of taskEvents) {
    if (!event.run_id) continue;
    appendTranscriptEntry(transcriptByRun, event.run_id, {
      kind: "event",
      id: event.id,
      message: taskEventMessage(event),
      ts: event.created_at,
      type: event.event_type,
    });
  }

  return transcriptByRun;
}

function buildLiveRunResponseRow(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  run: HeartbeatRunRow;
  transcriptByRun: Map<string, TranscriptEntry[]>;
  cutoff: string;
}) {
  const { db, run, transcriptByRun, cutoff } = input;
  const contextSnapshot = parseJsonRecord(run.context_snapshot_json);
  const executionRun = resolveExecutionRunForHeartbeat(db, {
    executionRunId: cleanString(contextSnapshot.executionRunId),
    heartbeatRunId: run.run_id,
  });
  const taskId = cleanString(contextSnapshot.taskId) ?? cleanString(executionRun?.task_id);
  if (taskId && !taskIsActiveForLiveRun(db, taskId)) return null;
  if (shouldSuppressNoTaskStaleApprovalRun({ taskId, contextSnapshot })) return null;

  const status = effectiveHeartbeatStatus(run.status, executionRun?.status);
  const isTerminal = TERMINAL_HEARTBEAT_STATUSES.has(status);
  const effectiveFinishedAt = run.finished_at ?? (isTerminal ? executionRun?.completed_at ?? null : null);
  if (shouldSuppressMirroredTerminalRun({
    heartbeatFinishedAt: run.finished_at,
    effectiveFinishedAt,
    isTerminal,
    cutoff,
  })) {
    return null;
  }

  const runnerProvider =
    cleanString(contextSnapshot.runnerProvider) ??
    cleanString(executionRun?.runner_provider) ??
    cleanString(executionRun?.provider);
  const runnerModel = cleanString(contextSnapshot.runnerModel) ?? cleanString(executionRun?.runner_model);
  const runnerPid = !isTerminal && typeof executionRun?.process_pid === "number" && executionRun.process_pid > 0
    ? executionRun.process_pid
    : null;
  const startedAt = run.started_at ?? executionRun?.started_at ?? null;
  const signalFloorAt = startedAt ?? run.created_at;
  const startMs = signalFloorAt ? new Date(signalFloorAt).getTime() : null;
  const endMs = effectiveFinishedAt ? new Date(effectiveFinishedAt).getTime() : null;
  const durationMs = startMs ? Math.max(0, (endMs ?? Date.now()) - startMs) : 0;
  const liveIndicatorUntil = isTerminal && endMs
    ? new Date(endMs + RECENT_LIVE_INDICATOR_MS).toISOString()
    : null;
  const transcript = buildTranscript(
    transcriptByRun.get(run.run_id) ?? [],
    loadExecutionTranscript(db, executionRun?.id ?? null),
  );
  const lastEventMs = latestTranscriptSignalMs(transcript) ?? startMs;
  const lastEventAt = lastEventMs != null ? new Date(lastEventMs).toISOString() : null;
  const transcriptProgressMs = latestMeaningfulProgressMs(transcript);
  const metadataProgressMs = latestExternalRunnerMeaningfulOutputMs(executionRun?.metadata_json);
  const lastMeaningfulProgressMs = Math.max(transcriptProgressMs ?? 0, metadataProgressMs ?? 0) || null;
  const lastMeaningfulProgressAt = lastMeaningfulProgressMs != null
    ? new Date(lastMeaningfulProgressMs).toISOString()
    : null;
  const runnerPidAlive = probeRunnerPidAlive(runnerPid);
  const liveness = deriveRunLiveness({
    status,
    startedAt: signalFloorAt,
    finishedAt: effectiveFinishedAt,
    lastEventAt,
    lastMeaningfulProgressAt,
    runnerPid,
    runnerPidAlive,
  });

  return {
    runId: run.run_id,
    taskId,
    agentId: run.agent_id,
    agentName: run.agent_name,
    agentSlug: run.agent_slug,
    agentEmoji: run.agent_emoji,
    status,
    startedAt,
    finishedAt: effectiveFinishedAt,
    liveIndicatorUntil,
    runnerProvider,
    runnerModel,
    runnerPid,
    runnerPidAlive,
    durationMs,
    error: run.error,
    result: parseResultData(run.result_json),
    latestOutput: latestReadableOutput(transcript),
    transcript,
    triggerDetail: run.trigger_detail,
    lastEventAt,
    lastEventAgeMs: liveness.lastEventAgeMs,
    lastMeaningfulProgressAt,
    lastMeaningfulProgressAgeMs: liveness.lastMeaningfulProgressAgeMs,
    suspiciousAfterAt: liveness.suspiciousAfterAt,
    liveness: liveness.liveness,
    livenessLabel: liveness.label,
  };
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
    const runtime = getRuntimeLaneStatus();

    // Fetch active runs + recently completed (last 2 min).
    // In dev, queued heartbeats are only truly live for the company that currently
    // holds the dev-execution lease. Observer-only companies can accumulate queued
    // wakeups that are not claimable, so do not surface those as live runs.
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const runs = loadHeartbeatRuns({ db, companyId: company.id, runtime, cutoff });
    const transcriptByRun = loadHeartbeatTranscriptEntries(db, runs.map((r) => r.run_id));

    const result = runs.flatMap((run) => {
      const row = buildLiveRunResponseRow({ db, run, transcriptByRun, cutoff });
      return row ? [row] : [];
    });

    return NextResponse.json({
      runs: result,
      runtime: {
        role: runtime.role,
        engineTick: runtime.engineTick,
        observerOnly: runtime.observerOnly,
        executionDisabledReason: runtime.executionDisabledReason,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error, "engine.live-runs");
  }
}
