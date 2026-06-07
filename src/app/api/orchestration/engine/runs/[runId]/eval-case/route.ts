import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError, OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  createEvalCase,
  type EvalCaseRecord,
  type EvalCaseReviewOutcome,
} from "@/lib/orchestration/eval-cases";
import {
  listExecutionTranscriptEvents,
  type ExecutionTranscriptEvent,
} from "@/lib/orchestration/service/execution-transcript";
import {
  buildCanonicalCompanyPath,
  buildCanonicalActivityPath,
  buildCanonicalEvalCasePath,
  buildCanonicalEvalsPath,
  buildCanonicalGoalPath,
  buildTaskRunTracePath,
} from "@/lib/orchestration/route-paths";
import { resolveProviderPresentation } from "@/lib/orchestration/adapters/types";
import {
  buildRedactedRunTraceExport,
  type RunTraceCaptureQuality,
  type RunTraceEvidenceInput,
  type RunTraceMetricsEvidence,
  type RunTraceProviderEvidence,
  type RunTraceProviderExecutionEvidence,
  type RunTraceTimelineEventInput,
  type RunTraceTranscriptEvidence,
} from "@/lib/orchestration/run-trace";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";

export const dynamic = "force-dynamic";

type EvalCaseSourceRunRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  provider: string;
  execution_engine: "hiverunner" | "symphony" | "manual" | null;
  runner_provider: string | null;
  runner_model: string | null;
  session_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  token_usage_json: string;
  duration_ms: number | null;
  idempotency_key: string | null;
  metadata_json: string;
  created_at: string;
  task_title: string | null;
  task_key: string | null;
  task_status: string | null;
  task_priority: string | null;
  task_type: string | null;
  task_sprint_id: string | null;
  task_artifact_uri: string | null;
  task_artifact_kind: string | null;
  task_artifact_sha256: string | null;
  task_artifact_registered_at: string | null;
  project_id: string | null;
  project_slug: string | null;
  company_id: string | null;
  company_slug: string | null;
  company_code: string | null;
  agent_name: string | null;
  agent_slug: string | null;
  agent_emoji: string | null;
  sprint_key: string | null;
  company_goal_id: string | null;
  company_goal_key: string | null;
};

type EvalCaseSaveResponse = {
  ok: true;
  evalCase: EvalCaseRecord;
  links: {
    activity: string;
    evalCase: string;
    evalsLibrary: string;
    runTrace: string;
  };
  warnings: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function normalizeRunStatus(status: string): string {
  return status === "completed" ? "succeeded" : status;
}

function isTerminalExecutionStatus(status: string): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

function assertOutcome(value: unknown): EvalCaseReviewOutcome {
  if (value === "accepted" || value === "returned" || value === "rejected" || value === "blocked") {
    return value;
  }
  throw new OrchestrationApiError(
    400,
    "invalid_review_outcome",
    "review outcome must be accepted, returned, rejected, or blocked",
  );
}

function outcomeSpecificRationale(body: Record<string, unknown>, outcome: EvalCaseReviewOutcome): string | null {
  const review = asRecord(body.review) ?? {};
  const rationaleContainers = [
    asRecord(body.rationaleByOutcome),
    asRecord(body.rationales),
    asRecord(review.rationaleByOutcome),
    asRecord(review.rationales),
  ].filter((value): value is Record<string, unknown> => Boolean(value));

  for (const container of rationaleContainers) {
    const rationale = textValue(container[outcome]);
    if (rationale) return rationale;
  }

  return null;
}

function requestField(body: Record<string, unknown>, key: string): unknown {
  const review = asRecord(body.review) ?? {};
  return body[key] ?? review[key];
}

function confirmationFlag(body: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => booleanValue(requestField(body, key)));
}

function fetchSourceRun(runId: string): EvalCaseSourceRunRow | null {
  return getOrchestrationDb()
    .prepare(
      `SELECT
         r.id, r.task_id, r.agent_id, r.provider, r.execution_engine, r.runner_provider,
         r.runner_model, r.session_id, r.status, r.started_at, r.completed_at,
         r.error_message, r.token_usage_json, r.duration_ms, r.idempotency_key,
         r.metadata_json, r.created_at,
         t.title AS task_title, t.task_key, t.status AS task_status,
         t.priority AS task_priority, t.type AS task_type, t.sprint_id AS task_sprint_id,
         t.artifact_uri AS task_artifact_uri, t.artifact_kind AS task_artifact_kind,
         t.artifact_sha256 AS task_artifact_sha256,
         t.artifact_registered_at AS task_artifact_registered_at,
         p.id AS project_id, p.slug AS project_slug,
         c.id AS company_id, c.slug AS company_slug, c.company_code,
         a.name AS agent_name, a.slug AS agent_slug, a.emoji AS agent_emoji,
         s.sprint_key AS sprint_key,
         parent_s.id AS company_goal_id, parent_s.goal_key AS company_goal_key
       FROM execution_runs r
       LEFT JOIN tasks t ON t.id = r.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN agents a ON a.id = r.agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
       WHERE r.id = ?
       LIMIT 1`,
    )
    .get(runId) as EvalCaseSourceRunRow | undefined ?? null;
}

function requireSourceRunContext(row: EvalCaseSourceRunRow): {
  companyId: string;
  companySlug: string;
  companyCode: string;
  projectId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
} {
  const companyId = textValue(row.company_id);
  const companySlug = textValue(row.company_slug);
  const companyCode = textValue(row.company_code) ?? companySlug?.toUpperCase();
  const projectId = textValue(row.project_id);
  const taskId = textValue(row.task_id);
  const taskKey = textValue(row.task_key) ?? taskId;
  const taskTitle = textValue(row.task_title);

  if (!companyId || !companySlug || !companyCode || !projectId || !taskId || !taskKey || !taskTitle) {
    throw new OrchestrationApiError(
      409,
      "ambiguous_run_context",
      "Run must resolve to one source task, project, and company before it can be saved as an eval case",
    );
  }

  return { companyId, companySlug, companyCode, projectId, taskId, taskKey, taskTitle };
}

function resolveReviewer(input: {
  companyId: string;
  reviewerAgentId: string | null;
  reviewerName: string | null;
}): { reviewerAgentId: string | null; reviewerName: string | null } {
  if (!input.reviewerAgentId && !input.reviewerName) {
    return { reviewerAgentId: null, reviewerName: null };
  }

  if (!input.reviewerAgentId) {
    return { reviewerAgentId: null, reviewerName: input.reviewerName };
  }

  const reviewer = getOrchestrationDb()
    .prepare(
      `SELECT id, name
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR slug = ? OR lower(name) = lower(?))
       LIMIT 1`,
    )
    .get(input.companyId, input.reviewerAgentId, input.reviewerAgentId, input.reviewerAgentId) as
    | { id: string; name: string }
    | undefined;

  if (!reviewer) {
    throw new OrchestrationApiError(404, "reviewer_not_found", "Reviewer agent not found in this company");
  }

  return {
    reviewerAgentId: reviewer.id,
    reviewerName: input.reviewerName ?? reviewer.name,
  };
}

function hasReturnedReviewEvent(row: EvalCaseSourceRunRow): boolean {
  if (!row.task_id) return false;
  const event = getOrchestrationDb()
    .prepare(
      `SELECT id
       FROM task_events
       WHERE task_id = ?
         AND event_type = 'task.status_changed'
         AND from_status = 'review'
         AND to_status IN ('in_progress', 'to-do')
         AND json_extract(metadata_json, '$.runId') = ?
       LIMIT 1`,
    )
    .get(row.task_id, row.id) as { id: string } | undefined;
  return Boolean(event);
}

function assertReviewedSource(input: {
  row: EvalCaseSourceRunRow;
  body: Record<string, unknown>;
  outcome: EvalCaseReviewOutcome;
  reviewerAgentId: string | null;
  reviewerName: string | null;
}): void {
  const taskStatus = input.row.task_status;
  const reviewedByState = taskStatus === "review" || taskStatus === "done" || taskStatus === "blocked";
  const returnedByReviewEvent = input.outcome === "returned" && hasReturnedReviewEvent(input.row);
  const hasReviewer = Boolean(input.reviewerAgentId || input.reviewerName || textValue(requestField(input.body, "createdByUserId")));

  if (!hasReviewer) {
    throw new OrchestrationApiError(
      400,
      "unreviewed_run",
      "Saving an eval case requires reviewer identity or operator user identity",
    );
  }

  if (!reviewedByState && !returnedByReviewEvent) {
    throw new OrchestrationApiError(
      409,
      "unreviewed_run",
      "Run must be reviewed before it can be saved as an eval case",
    );
  }
}

function assertTraceConfirmation(input: {
  row: EvalCaseSourceRunRow;
  body: Record<string, unknown>;
  captureQuality: RunTraceCaptureQuality;
}): string[] {
  if (!isTerminalExecutionStatus(input.row.status)) {
    throw new OrchestrationApiError(
      409,
      "run_not_terminal",
      "Run must be terminal before it can be saved as an eval case",
    );
  }

  const warnings: string[] = [];
  const runFailed = input.row.status === "failed" || input.row.status === "cancelled";
  if (runFailed && !confirmationFlag(input.body, "confirmFailedTrace", "confirmFailedRun")) {
    throw new OrchestrationApiError(
      409,
      "failed_trace_confirmation_required",
      "Failed or cancelled runs require explicit failed-trace confirmation before saving an eval case",
    );
  }
  if (runFailed) {
    warnings.push("Saved from a failed or cancelled execution run.");
  }

  if (input.captureQuality !== "complete") {
    const confirmed = input.captureQuality === "failed"
      ? confirmationFlag(input.body, "confirmFailedTrace", "confirmFailedRun")
      : confirmationFlag(input.body, "confirmPartialCapture", "confirmLowCaptureQuality");
    if (!confirmed) {
      throw new OrchestrationApiError(
        409,
        "capture_quality_confirmation_required",
        "Partial, minimal, or failed trace capture requires explicit confirmation before saving an eval case",
      );
    }
    warnings.push(`Saved with ${input.captureQuality} trace capture quality.`);
  }

  return warnings;
}

const LIVE_EVENT_KINDS = new Set<string>([
  "run_start",
  "run_end",
  "run_error",
  "run_progress",
  "assistant_text_delta",
  "assistant_text_final",
  "thinking_delta",
  "thinking_summary",
  "tool_call_start",
  "tool_call_end",
  "tool_result",
  "action_detected",
  "comment_written",
  "task_updated",
  "report_written",
  "error",
  "heartbeat",
]);

const TOOL_EVENT_KINDS = new Set(["tool_call_start", "tool_call_end", "tool_result"]);
const ASSISTANT_TEXT_EVENT_KINDS = new Set(["assistant_text_delta", "assistant_text_final"]);
const THINKING_EVENT_KINDS = new Set(["thinking_delta", "thinking_summary"]);

function transcriptEventKind(kind: string): MCLiveEventKind {
  return LIVE_EVENT_KINDS.has(kind) ? kind as MCLiveEventKind : "run_progress";
}

function eventSummary(event: ExecutionTranscriptEvent): string {
  return event.title
    ? `${event.title}${event.body ? `: ${event.body.slice(0, 260)}` : ""}`
    : event.body.slice(0, 300);
}

function buildTraceTimeline(
  row: EvalCaseSourceRunRow,
  transcriptEvents: ExecutionTranscriptEvent[],
): RunTraceTimelineEventInput[] {
  const startedAt = row.started_at ?? row.created_at;
  const finishedAt = row.completed_at;
  return [
    {
      id: `${row.id}:run-start`,
      kind: "run_start" as MCLiveEventKind,
      summary: "Run started",
      ts: new Date(startedAt).getTime(),
      source: "execution_runs",
    },
    ...transcriptEvents.map((event) => ({
      id: event.id,
      kind: transcriptEventKind(event.kind),
      summary: eventSummary(event),
      ts: new Date(event.occurredAt).getTime(),
      source: "execution_transcript",
      providerEventType: event.kind,
      commentSource: event.provider,
      commentType: event.role ?? event.kind,
      authorName: event.role === "assistant" ? row.agent_name : event.provider,
      title: event.title,
      metadata: event.metadata,
    })),
    ...(finishedAt ? [{
      id: `${row.id}:run-end`,
      kind: row.status === "failed" || row.status === "cancelled" ? "run_error" as MCLiveEventKind : "run_end" as MCLiveEventKind,
      summary: row.error_message ?? "Run completed",
      ts: new Date(finishedAt).getTime(),
      source: "execution_runs",
    }] : []),
  ].filter((event) => Number.isFinite(event.ts));
}

function buildTraceProvider(row: EvalCaseSourceRunRow, transcriptEvents: ExecutionTranscriptEvent[]): RunTraceProviderEvidence {
  const providerPresentation = resolveProviderPresentation(row.provider);
  return {
    id: row.provider,
    displayName: providerPresentation.displayName,
    capabilities: {
      ...providerPresentation.capabilities,
      persistedTranscript: transcriptEvents.length > 0 || providerPresentation.capabilities.persistedTranscript,
    },
  };
}

function buildTraceMetrics(row: EvalCaseSourceRunRow, usage: Record<string, unknown>): RunTraceMetricsEvidence {
  return {
    durationMs: row.duration_ms ?? numberValue(usage.durationMs),
    inputTokens: numberValue(usage.inputTokens),
    outputTokens: numberValue(usage.outputTokens),
    cacheReadInputTokens: numberValue(usage.cacheReadInputTokens),
    cacheCreationInputTokens: numberValue(usage.cacheCreationInputTokens),
    totalCostUsd: numberValue(usage.totalCostUsd),
    messagesImported: numberValue(usage.messagesImported),
    actionsFound: numberValue(usage.actionsFound),
    actionsExecuted: numberValue(usage.actionsExecuted),
    reportsImported: numberValue(usage.reportsImported),
    approvalsCreated: Array.isArray(usage.approvalsCreated) ? usage.approvalsCreated.length : numberValue(usage.approvalsCreated),
    tasksCreated: Array.isArray(usage.tasksCreated) ? usage.tasksCreated.length : numberValue(usage.tasksCreated),
    errorCount: row.error_message ? 1 : numberValue(usage.errorCount),
  };
}

function buildTraceTranscript(
  row: EvalCaseSourceRunRow,
  transcriptEvents: ExecutionTranscriptEvent[],
): RunTraceTranscriptEvidence {
  return {
    entries: transcriptEvents.map((event) => ({
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
    })),
    provenance: {
      label: transcriptEvents.length > 0 ? "Provider transcript events" : "Post-run metadata only",
      note: row.error_message && /capture failed|trace capture failed|capture_failed/i.test(row.error_message)
        ? row.error_message
        : transcriptEvents.length > 0
          ? "Provider output was normalized into HiveRunner transcript events for this execution run."
          : "No provider transcript events were persisted for this run.",
      totalEntries: transcriptEvents.length,
      source: transcriptEvents.length > 0 ? "execution_run_transcript_events" : "execution_runs",
      fullTranscriptAvailable: transcriptEvents.length > 0,
    },
  };
}

function hasAnyTranscriptKind(transcriptEvents: ExecutionTranscriptEvent[], kinds: Set<string>): boolean {
  return transcriptEvents.some((event) => kinds.has(event.kind));
}

function buildTraceProviderExecution(
  usage: Record<string, unknown>,
  transcriptEvents: ExecutionTranscriptEvent[],
): RunTraceProviderExecutionEvidence {
  return {
    source: textValue(usage.source),
    structuredTelemetry: booleanValue(usage.structuredTelemetry) || transcriptEvents.length > 0,
    observedLiveText: booleanValue(usage.observedLiveText) || hasAnyTranscriptKind(transcriptEvents, ASSISTANT_TEXT_EVENT_KINDS),
    observedThinking: booleanValue(usage.observedThinking) || hasAnyTranscriptKind(transcriptEvents, THINKING_EVENT_KINDS),
    observedStructuredTools: booleanValue(usage.observedStructuredTools) || hasAnyTranscriptKind(transcriptEvents, TOOL_EVENT_KINDS),
    assistantSummary: textValue(usage.assistantSummary) ?? textValue(usage.resultText),
    thinkingSummary: textValue(usage.thinkingSummary),
    resultErrors: stringArrayValue(usage.resultErrors),
    linkedHeartbeatCount: numberValue(usage.linkedHeartbeatCount),
    note: textValue(usage.note),
  };
}

function workspaceRunVisibilityFromUsage(usage: Record<string, unknown>): unknown {
  return asRecord(usage.workspaceRunVisibility)?.schema === "hiverunner.workspace_run_visibility.v1"
    ? usage.workspaceRunVisibility
    : null;
}

function buildTraceInput(row: EvalCaseSourceRunRow): RunTraceEvidenceInput {
  const usage = parseJsonRecord(row.token_usage_json);
  const metadata = parseJsonRecord(row.metadata_json);
  const transcriptEvents = listExecutionTranscriptEvents(getOrchestrationDb(), row.id);
  const hasTranscriptEvents = transcriptEvents.length > 0;

  return {
    run: {
      id: row.id,
      status: normalizeRunStatus(row.status),
      providerId: row.provider,
      invocationSource: row.provider,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
      durationMs: row.duration_ms,
      error: row.error_message,
    },
    task: row.task_id
      ? {
          id: row.task_id,
          title: row.task_title,
          key: row.task_key,
          status: row.task_status,
          priority: row.task_priority,
        }
      : null,
    provider: buildTraceProvider(row, transcriptEvents),
    metrics: buildTraceMetrics(row, usage),
    transcript: buildTraceTranscript(row, transcriptEvents),
    timeline: buildTraceTimeline(row, transcriptEvents),
    providerExecution: buildTraceProviderExecution(usage, transcriptEvents),
    workspaceRunVisibility: workspaceRunVisibilityFromUsage(usage),
    memoryEvidence: usage.memoryEvidence ?? metadata.memoryEvidence ?? null,
    skillEffectiveness: Array.isArray(usage.skillEffectivenessEvents)
      ? { events: usage.skillEffectivenessEvents }
      : { events: [] },
    rawPayload: usage.rawPayload ?? metadata.rawPayload,
    provenance: {
      timeline: {
        label: hasTranscriptEvents ? "Provider transcript events" : "Post-run metadata",
        note: row.error_message,
        sources: hasTranscriptEvents
          ? ["execution_runs", "execution_run_transcript_events"]
          : ["execution_runs"],
      },
      runTable: "execution_runs",
    },
    invocation: {
      runTable: "execution_runs",
      linkedHeartbeatCount: numberValue(usage.linkedHeartbeatCount),
    },
  };
}

function linkSet(input: {
  companyCode: string;
  companySlug: string;
  taskKey: string;
  runId: string;
  evalCaseId: string;
}) {
  const activityBase = buildCanonicalActivityPath(input.companyCode);
  return {
    activity: `${activityBase}?evalCase=${encodeURIComponent(input.evalCaseId)}`,
    evalCase: buildCanonicalEvalCasePath(input.companyCode, input.evalCaseId),
    evalsLibrary: buildCanonicalEvalsPath(input.companyCode),
    runTrace: buildTaskRunTracePath({
      companyCode: input.companyCode,
      companySlug: input.companySlug,
      taskKey: input.taskKey,
      runId: input.runId,
    }),
  };
}

function sourceArtifact(row: EvalCaseSourceRunRow) {
  const uri = textValue(row.task_artifact_uri);
  if (!uri) return null;

  return {
    uri,
    kind: textValue(row.task_artifact_kind),
    sha256: textValue(row.task_artifact_sha256),
    registeredAt: textValue(row.task_artifact_registered_at),
  };
}

function recordEvalCaseActivity(input: {
  evalCase: EvalCaseRecord;
  row: EvalCaseSourceRunRow;
  companyCode: string;
  projectId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  links: EvalCaseSaveResponse["links"];
}): void {
  const evalCase = input.evalCase;
  const sprintRoute = evalCase.sourceSprint.key || evalCase.sourceSprint.id
    ? buildCanonicalGoalPath(input.companyCode, evalCase.sourceSprint.key ?? evalCase.sourceSprint.id ?? "")
    : null;
  const goalRoute = evalCase.sourceGoal.key || evalCase.sourceGoal.id
    ? buildCanonicalGoalPath(input.companyCode, evalCase.sourceGoal.key ?? evalCase.sourceGoal.id ?? "")
    : null;
  const metadata = {
    schema: "hiverunner.eval_case_activity.v1",
    evalCaseId: evalCase.id,
    evalCaseVersion: evalCase.version,
    reviewOutcome: evalCase.review.outcome,
    links: input.links,
    sourceTask: {
      id: input.taskId,
      key: input.taskKey,
      title: input.taskTitle,
      route: buildCanonicalCompanyPath(input.companyCode, `/tasks/${encodeURIComponent(input.taskKey)}`),
    },
    sourceRun: {
      id: evalCase.sourceRun.id,
      traceRoute: evalCase.sourceRun.traceRoute,
      executionEngine: evalCase.sourceRun.executionEngine,
      runnerProvider: evalCase.sourceRun.runnerProvider,
      providerId: evalCase.sourceRun.providerId,
      runnerModel: evalCase.sourceRun.runnerModel,
      agentId: evalCase.sourceRun.agentId,
      agentName: evalCase.sourceRun.agentName,
    },
    sourceSprint: {
      id: evalCase.sourceSprint.id,
      key: evalCase.sourceSprint.key,
      route: sprintRoute,
    },
    sourceGoal: {
      id: evalCase.sourceGoal.id,
      key: evalCase.sourceGoal.key,
      route: goalRoute,
    },
    reviewer: {
      agentId: evalCase.review.reviewerAgentId,
      name: evalCase.review.reviewerName,
      reviewedAt: evalCase.review.reviewedAt,
      createdByAgentId: evalCase.createdByAgentId,
      createdByUserId: evalCase.createdByUserId,
    },
    sourceArtifact: sourceArtifact(input.row),
    snapshotEvidence: {
      schema: evalCase.redactedSnapshot.schema,
      sha256: evalCase.snapshotSha256,
      route: `${input.links.evalCase}#snapshot`,
      redactionPolicy: evalCase.redactedSnapshot.redaction?.policy ?? null,
      redactionCount: evalCase.redactedSnapshot.redaction?.totalRedactions ?? 0,
      captureQuality: evalCase.captureQuality,
      evidenceGapCount: evalCase.evidenceGaps.length,
      annotationState: evalCase.annotationSnapshot.state,
    },
  };

  getOrchestrationDb()
    .prepare(
      `INSERT OR IGNORE INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, 'task.eval_case_saved', ?, ?)`,
    )
    .run(
      `eval-case:${evalCase.id}:saved`,
      input.projectId,
      input.taskId,
      evalCase.review.reviewerAgentId ?? evalCase.createdByAgentId,
      evalCase.createdByUserId,
      JSON.stringify(metadata),
      evalCase.createdAt,
    );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const row = fetchSourceRun(runId);
    if (!row) {
      return errorResponse(404, "run_not_found", `Run '${runId}' not found`);
    }

    const context = requireSourceRunContext(row);
    const outcome = assertOutcome(requestField(body, "outcome") ?? requestField(body, "reviewOutcome"));
    const rationale = outcomeSpecificRationale(body, outcome);
    if (!rationale) {
      throw new OrchestrationApiError(
        400,
        "missing_rationale",
        `A reviewer rationale is required for the ${outcome} outcome`,
      );
    }

    const reviewer = resolveReviewer({
      companyId: context.companyId,
      reviewerAgentId: textValue(requestField(body, "reviewerAgentId")),
      reviewerName: textValue(requestField(body, "reviewerName")),
    });
    assertReviewedSource({
      row,
      body,
      outcome,
      reviewerAgentId: reviewer.reviewerAgentId,
      reviewerName: reviewer.reviewerName,
    });

    const traceInput = buildTraceInput(row);
    const redactedSnapshot = buildRedactedRunTraceExport(traceInput);
    const warnings = assertTraceConfirmation({
      row,
      body,
      captureQuality: redactedSnapshot.captureQuality.label,
    });
    const traceRoute = buildTaskRunTracePath({
      companyCode: context.companyCode,
      companySlug: context.companySlug,
      taskKey: context.taskKey,
      runId: row.id,
    });
    const usageForSourceRun = parseJsonRecord(row.token_usage_json);
    const evalCase = createEvalCase({
      companyId: context.companyId,
      projectId: context.projectId,
      sourceTask: {
        id: context.taskId,
        key: context.taskKey,
        title: context.taskTitle,
        type: row.task_type,
      },
      sourceRun: {
        id: row.id,
        traceRoute,
        executionEngine: row.execution_engine ?? (row.provider === "symphony" ? "symphony" : "hiverunner"),
        runnerProvider: row.runner_provider ?? textValue(usageForSourceRun.runnerProvider) ?? row.provider,
        providerId: row.provider,
        runnerModel: row.runner_model ?? textValue(usageForSourceRun.runnerModel),
        agentId: row.agent_id,
        agentName: row.agent_name,
      },
      sourceSprint: {
        id: row.task_sprint_id,
        key: row.sprint_key,
      },
      sourceGoal: {
        id: row.company_goal_id,
        key: row.company_goal_key,
      },
      templateContext: asRecord(requestField(body, "templateContext")) ?? null,
      review: {
        outcome,
        rationale,
        notes: textValue(requestField(body, "notes")) ?? textValue(requestField(body, "reviewerNotes")),
        reviewerAgentId: reviewer.reviewerAgentId,
        reviewerName: reviewer.reviewerName,
        reviewedAt: textValue(requestField(body, "reviewedAt")) ?? new Date().toISOString(),
      },
      captureQuality: redactedSnapshot.captureQuality.label,
      evidenceGaps: redactedSnapshot.evidenceGaps,
      annotationSnapshot: redactedSnapshot.annotations,
      redactedSnapshot,
      idempotencyKey: textValue(requestField(body, "idempotencyKey")) ?? `source-run:${row.id}:outcome:${outcome}`,
      createdByAgentId: textValue(requestField(body, "createdByAgentId")) ?? reviewer.reviewerAgentId,
      createdByUserId: textValue(requestField(body, "createdByUserId")),
    });

    const links = linkSet({
      companyCode: context.companyCode,
      companySlug: context.companySlug,
      taskKey: context.taskKey,
      runId: row.id,
      evalCaseId: evalCase.id,
    });
    recordEvalCaseActivity({
      evalCase,
      row,
      companyCode: context.companyCode,
      projectId: context.projectId,
      taskId: context.taskId,
      taskKey: context.taskKey,
      taskTitle: context.taskTitle,
      links,
    });

    return NextResponse.json({
      ok: true,
      evalCase,
      links,
      warnings,
    } satisfies EvalCaseSaveResponse);
  } catch (error) {
    return handleRouteError(error, "engine.runs.eval-case:post");
  }
}
