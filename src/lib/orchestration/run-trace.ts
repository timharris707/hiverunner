import {
  PROVIDER_PRODUCT_DESCRIPTORS,
  type ProviderCapabilities,
} from "@/lib/orchestration/adapters/types";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";

const RUN_TRACE_VIEW_MODEL_SCHEMA = "hiverunner.run_trace_view.v1" as const;
export const RUN_TRACE_REDACTED_EXPORT_SCHEMA = "hiverunner.run_trace_redacted_export.v1" as const;
export const RUN_TRACE_REDACTION_POLICY = "hiverunner.run_trace_redaction.v1" as const;
const RUN_TRACE_ANNOTATION_SNAPSHOT_SCHEMA = "hiverunner.run_trace_annotations.v1" as const;
const RUN_TRACE_PROOF_ATTACHMENT_SCHEMA = "hiverunner.run_trace_proof_attachment.v1" as const;
const RUN_TRACE_ANNOTATION_DEFERRAL_REASON =
  "Trace annotations are deferred for Run Trace v1 because the Sprint 1 gate did not confirm a clean run-scoped persistence/API path, and existing marker systems are voice-session or task-comment scoped rather than execution-run evidence markers.";

const RUN_TRACE_TIMELINE_CATEGORIES = [
  "handoff",
  "runner_status",
  "message",
  "tool",
  "process_io",
  "action",
  "artifact",
  "usage",
  "memory",
  "review",
] as const;

const RUN_TRACE_REDACTION_CATEGORIES = [
  "bearer_token",
  "api_key",
  "sensitive_field",
  "private_credential",
] as const;

export type RunTraceTimelineCategory = typeof RUN_TRACE_TIMELINE_CATEGORIES[number];
export type RunTraceCaptureQuality = "complete" | "partial" | "minimal" | "failed";
export type RunTraceEvidenceGapLabel = "not_captured" | "not_available" | "capture_failed";
export type RunTraceRedactionCategory = typeof RUN_TRACE_REDACTION_CATEGORIES[number];
export type RunTraceAnnotationMarkerType = "note" | "important";
export type RunTraceAnnotationSnapshotState = "available" | "deferred";

export type RunTraceEvidenceGapId =
  | "missing_cost"
  | "missing_transcript"
  | "missing_raw_payload"
  | "missing_memory_evidence"
  | "missing_workspace_visibility"
  | "manual_or_minimal_runner"
  | "trace_capture_failed"
  | "missing_timeline";

export interface RunTraceTimelineEventInput {
  id: string;
  kind: MCLiveEventKind | string;
  summary?: string | null;
  ts: number;
  source?: string | null;
  providerEventType?: string | null;
  commentSource?: string | null;
  commentType?: string | null;
  authorName?: string | null;
  title?: string | null;
  payload?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface RunTraceTimelineEvent extends RunTraceTimelineEventInput {
  category: RunTraceTimelineCategory;
  categoryLabel: string;
  rawKind: string;
  order: number;
  isTerminal: boolean;
}

export interface RunTraceRunEvidence {
  id: string;
  status: string;
  providerId?: string | null;
  invocationSource?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastMeaningfulProgressAt?: string | null;
  suspiciousAfterAt?: string | null;
  durationMs?: number | null;
  usage?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

export interface RunTraceMetricsEvidence {
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
  totalCostUsd?: number | null;
  messagesImported?: number | null;
  actionsFound?: number | null;
  actionsExecuted?: number | null;
  reportsImported?: number | null;
  approvalsCreated?: number | null;
  tasksCreated?: number | null;
  errorCount?: number | null;
  [key: string]: unknown;
}

export interface RunTraceTranscriptEvidence {
  entries?: unknown[];
  provenance?: {
    label?: string | null;
    note?: string | null;
    totalEntries?: number | null;
    source?: string | null;
    fullTranscriptAvailable?: boolean | null;
  } | null;
}

export interface RunTraceProviderEvidence {
  id: string;
  displayName?: string | null;
  capabilities?: Partial<ProviderCapabilities> | null;
}

export interface RunTraceProviderExecutionEvidence {
  source?: string | null;
  structuredTelemetry?: boolean | null;
  observedLiveText?: boolean | null;
  observedThinking?: boolean | null;
  observedStructuredTools?: boolean | null;
  assistantSummary?: string | null;
  thinkingSummary?: string | null;
  resultErrors?: string[] | null;
  linkedHeartbeatCount?: number | null;
  note?: string | null;
}

export interface RunTraceProofAttachment {
  schema: typeof RUN_TRACE_PROOF_ATTACHMENT_SCHEMA;
  id: string;
  source: "browser_proof";
  status: "succeeded" | "failed";
  taskId?: string | null;
  taskKey?: string | null;
  heartbeatRunId?: string | null;
  executionRunId?: string | null;
  manifest: {
    path: string;
    uri: string;
    sha256: string;
  };
  artifactDir: string;
  artifactCount: number;
  screenshotCount: number;
  videoCount: number;
  exitCode: number;
  durationMs: number;
  baseUrl: string;
  project: string;
  command: string;
  specs: unknown[];
  urls: unknown[];
  artifacts?: RunTraceProofArtifactSummary[];
  createdAt: string;
  taskArtifact?: {
    uri: string;
    kind: string | null;
    sha256: string | null;
    registeredAt: string | null;
  } | null;
}

export interface RunTraceProofArtifactSummary {
  path: string;
  uri: string;
  kind: "image" | "video" | "file";
  label: string;
  size: number | null;
  sha256: string | null;
}

export interface RunTraceEvidenceInput {
  run: RunTraceRunEvidence;
  task?: {
    id?: string | null;
    key?: string | null;
    title?: string | null;
    status?: string | null;
    priority?: string | null;
  } | null;
  provider: RunTraceProviderEvidence;
  metrics?: RunTraceMetricsEvidence | null;
  transcript?: RunTraceTranscriptEvidence | null;
  timeline?: RunTraceTimelineEventInput[] | null;
  providerExecution?: RunTraceProviderExecutionEvidence | null;
  proofAttachments?: RunTraceProofAttachment[] | null;
  workspaceRunVisibility?: unknown;
  memoryEvidence?: unknown;
  template?: {
    sourceTemplateVersionId?: string | null;
    templateIntakeAnswerId?: string | null;
    provenance?: Record<string, unknown> | null;
  } | null;
  skillEffectiveness?: { events?: unknown[] | null } | null;
  rawPayload?: unknown;
  provenance?: {
    timeline?: {
      label?: string | null;
      note?: string | null;
      sources?: string[] | null;
    } | null;
    runTable?: string | null;
  } | null;
  invocation?: {
    runTable?: string | null;
    linkedHeartbeatCount?: number | null;
  } | null;
}

export interface RunTraceEvidenceSummary {
  hasRunMetadata: boolean;
  hasTimeline: boolean;
  hasTranscript: boolean;
  hasFullTranscript: boolean;
  hasUsage: boolean;
  hasCost: boolean;
  hasWorkspaceVisibility: boolean;
  hasMemoryEvidence: boolean;
  hasSkillEvidence: boolean;
  hasProofAttachments: boolean;
  hasProviderSummary: boolean;
  hasRawPayload: boolean;
  transcriptEntryCount: number;
  timelineEventCount: number;
  proofAttachmentCount: number;
  categoryCounts: Record<RunTraceTimelineCategory, number>;
}

export interface RunTraceEvidenceGap {
  id: RunTraceEvidenceGapId;
  label: RunTraceEvidenceGapLabel;
  title: string;
  detail: string;
  affectsCaptureQuality: boolean;
}

export interface RunTraceCaptureQualitySummary {
  label: RunTraceCaptureQuality;
  title: string;
  detail: string;
  missingRequiredEvidence: RunTraceEvidenceGapId[];
}

export interface RunTraceAnnotation {
  id: string;
  runId: string;
  timelineEventId?: string | null;
  markerType: RunTraceAnnotationMarkerType;
  body: string;
  authorName?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface RunTraceAnnotationDecision {
  status: "deferred";
  reason: string;
  decidedAt: string;
  migrationRequired: boolean;
  persistencePath: string | null;
  apiPath: string | null;
  notes: string[];
}

export interface RunTraceAnnotationSnapshot {
  schema: typeof RUN_TRACE_ANNOTATION_SNAPSHOT_SCHEMA;
  state: RunTraceAnnotationSnapshotState;
  annotations: RunTraceAnnotation[];
  decision: RunTraceAnnotationDecision;
}

export interface RunTraceViewModel {
  schema: typeof RUN_TRACE_VIEW_MODEL_SCHEMA;
  runId: string;
  status: string;
  providerId: string;
  timeline: RunTraceTimelineEvent[];
  proofAttachments: RunTraceProofAttachment[];
  evidenceSummary: RunTraceEvidenceSummary;
  evidenceGaps: RunTraceEvidenceGap[];
  captureQuality: RunTraceCaptureQualitySummary;
  annotations: RunTraceAnnotationSnapshot;
}

export interface RunTraceRedactionCategorySummary {
  count: number;
  paths: string[];
}

export interface RunTraceRedactionSummary {
  policy: typeof RUN_TRACE_REDACTION_POLICY;
  location: "server";
  totalRedactions: number;
  categories: Record<RunTraceRedactionCategory, RunTraceRedactionCategorySummary>;
  notes: string[];
}

export interface RunTraceRedactedExport {
  schema: typeof RUN_TRACE_REDACTED_EXPORT_SCHEMA;
  summary: {
    copyText: string;
    runId: string;
    taskKey: string | null;
    status: string;
    providerId: string;
    captureQuality: RunTraceCaptureQuality;
    timelineEventCount: number;
    proofAttachmentCount: number;
    evidenceGapCount: number;
    annotationCount: number;
  };
  redaction: RunTraceRedactionSummary;
  run: Record<string, unknown>;
  task: Record<string, unknown> | null;
  provider: Record<string, unknown>;
  metrics: Record<string, unknown>;
  timeline: Array<Record<string, unknown>>;
  proofAttachments: RunTraceProofAttachment[];
  transcript: Record<string, unknown>;
  providerExecution: RunTraceProviderExecutionEvidence | null;
  workspaceRunVisibility: unknown;
  memoryEvidence: unknown;
  template?: Record<string, unknown> | null;
  annotations: RunTraceAnnotationSnapshot;
  rawPayload?: unknown;
  evidenceGaps: RunTraceEvidenceGap[];
  captureQuality: RunTraceCaptureQualitySummary;
}

const CATEGORY_LABELS: Record<RunTraceTimelineCategory, string> = {
  handoff: "Handoff",
  runner_status: "Runner status",
  message: "Message",
  tool: "Tool",
  process_io: "Process I/O",
  action: "Action",
  artifact: "Artifact",
  usage: "Usage",
  memory: "Memory",
  review: "Review",
};

const RUNNER_STATUS_KINDS = new Set<string>([
  "run_start",
  "run_end",
  "run_error",
  "run_progress",
  "heartbeat",
  "error",
]);

const MESSAGE_KINDS = new Set<string>([
  "assistant_text_delta",
  "assistant_text_final",
  "thinking_delta",
  "thinking_summary",
]);

const TOOL_KINDS = new Set<string>([
  "tool_call_start",
  "tool_call_end",
  "tool_result",
]);

const ACTION_KINDS = new Set<string>([
  "action_detected",
  "comment_written",
  "task_updated",
  "report_written",
]);

const TERMINAL_STATUSES = new Set(["succeeded", "completed", "failed", "cancelled", "timed_out"]);
const MANUAL_OR_MINIMAL_PROVIDERS = new Set(["manual", "none", "byo-webhook"]);
const WORKSPACE_VISIBILITY_PROVIDERS = new Set(["codex", "symphony"]);

export function buildRunTraceViewModel(input: RunTraceEvidenceInput): RunTraceViewModel {
  const timeline = normalizeRunTraceTimeline(input.timeline ?? []);
  const proofAttachments = normalizeRunTraceProofAttachments(input.proofAttachments);
  const evidenceSummary = summarizeRunTraceEvidence(input, timeline);
  const evidenceGaps = deriveRunTraceEvidenceGaps(input, evidenceSummary);
  const captureQuality = deriveRunTraceCaptureQuality(input, evidenceSummary, evidenceGaps);
  const providerId = normalizeProviderId(input.provider.id || input.run.providerId || input.run.invocationSource || "unknown");
  const annotations = buildRunTraceAnnotationSnapshot();

  return {
    schema: RUN_TRACE_VIEW_MODEL_SCHEMA,
    runId: input.run.id,
    status: input.run.status,
    providerId,
    timeline,
    proofAttachments,
    evidenceSummary,
    evidenceGaps,
    captureQuality,
    annotations,
  };
}

export function buildRedactedRunTraceExport(input: RunTraceEvidenceInput): RunTraceRedactedExport {
  const trace = buildRunTraceViewModel(input);
  const redactor = new RunTraceRedactor();
  const exportBody: Omit<RunTraceRedactedExport, "redaction"> = {
    schema: RUN_TRACE_REDACTED_EXPORT_SCHEMA,
    summary: {
      copyText: buildRunTraceCopySummary(input, trace),
      runId: input.run.id,
      taskKey: input.task?.key ?? null,
      status: input.run.status,
      providerId: trace.providerId,
      captureQuality: trace.captureQuality.label,
      timelineEventCount: trace.timeline.length,
      proofAttachmentCount: trace.proofAttachments.length,
      evidenceGapCount: trace.evidenceGaps.length,
      annotationCount: trace.annotations.annotations.length,
    },
    run: {
      id: input.run.id,
      status: input.run.status,
      providerId: input.run.providerId ?? null,
      invocationSource: input.run.invocationSource ?? null,
      startedAt: input.run.startedAt ?? null,
      finishedAt: input.run.finishedAt ?? null,
      durationMs: input.run.durationMs ?? null,
      error: input.run.error ?? null,
    },
    task: input.task
      ? {
          id: input.task.id ?? null,
          key: input.task.key ?? null,
          title: input.task.title ?? null,
          status: input.task.status ?? null,
          priority: input.task.priority ?? null,
        }
      : null,
    provider: {
      id: input.provider.id,
      displayName: input.provider.displayName ?? null,
      capabilities: input.provider.capabilities ?? null,
    },
    metrics: compactMetricsForExport(input.metrics ?? {}),
    timeline: trace.timeline.map((event) => ({
      id: event.id,
      kind: event.kind,
      rawKind: event.rawKind,
      category: event.category,
      categoryLabel: event.categoryLabel,
      summary: event.summary ?? null,
      ts: event.ts,
      source: event.source ?? null,
      providerEventType: event.providerEventType ?? null,
      commentSource: event.commentSource ?? null,
      commentType: event.commentType ?? null,
      authorName: event.authorName ?? null,
      title: event.title ?? null,
      metadata: event.metadata ?? null,
      order: event.order,
      isTerminal: event.isTerminal,
    })),
    proofAttachments: trace.proofAttachments,
    transcript: {
      provenance: input.transcript?.provenance ?? null,
      entries: input.transcript?.entries ?? [],
    },
    providerExecution: input.providerExecution ?? null,
    workspaceRunVisibility: input.workspaceRunVisibility ?? null,
    memoryEvidence: input.memoryEvidence ?? null,
    template: input.template ?? null,
    annotations: trace.annotations,
    ...(input.rawPayload !== undefined ? { rawPayload: input.rawPayload } : {}),
    evidenceGaps: trace.evidenceGaps,
    captureQuality: trace.captureQuality,
  };
  const redactedBody = redactStructuredValue(exportBody, "$", redactor) as Omit<RunTraceRedactedExport, "redaction">;

  return {
    schema: redactedBody.schema,
    summary: redactedBody.summary,
    redaction: redactor.summary(),
    run: redactedBody.run,
    task: redactedBody.task,
    provider: redactedBody.provider,
    metrics: redactedBody.metrics,
    timeline: redactedBody.timeline,
    proofAttachments: redactedBody.proofAttachments,
    transcript: redactedBody.transcript,
    providerExecution: redactedBody.providerExecution,
    workspaceRunVisibility: redactedBody.workspaceRunVisibility,
    memoryEvidence: redactedBody.memoryEvidence,
    template: redactedBody.template,
    annotations: redactedBody.annotations,
    ...(redactedBody.rawPayload !== undefined ? { rawPayload: redactedBody.rawPayload } : {}),
    evidenceGaps: redactedBody.evidenceGaps,
    captureQuality: redactedBody.captureQuality,
  };
}

function buildRunTraceAnnotationSnapshot(): RunTraceAnnotationSnapshot {
  return {
    schema: RUN_TRACE_ANNOTATION_SNAPSHOT_SCHEMA,
    state: "deferred",
    annotations: [],
    decision: {
      status: "deferred",
      reason: RUN_TRACE_ANNOTATION_DEFERRAL_REASON,
      decidedAt: "2026-06-06",
      migrationRequired: true,
      persistencePath: null,
      apiPath: null,
      notes: [
        "Run Trace v1 keeps annotations in the trace/export contract as an empty snapshot so later persisted annotations can be added without changing consumers.",
        "Do not reuse task comments for trace annotations; task comments are discussion, while trace annotations are evidence markers.",
        "A future implementation should either add a small execution_run_annotations table or reuse a proven run-scoped evidence marker system after the migration/API path is approved.",
      ],
    },
  };
}

export function normalizeRunTraceTimeline(events: RunTraceTimelineEventInput[]): RunTraceTimelineEvent[] {
  return [...events]
    .sort((a, b) => {
      const tsDelta = safeNumber(a.ts) - safeNumber(b.ts);
      if (tsDelta !== 0) return tsDelta;
      return String(a.id).localeCompare(String(b.id));
    })
    .map((event, index) => {
      const rawKind = String(event.kind || "");
      const category = mapRunTraceTimelineCategory(event);
      return {
        ...event,
        rawKind,
        category,
        categoryLabel: CATEGORY_LABELS[category],
        order: index,
        isTerminal: rawKind === "run_end" || rawKind === "run_error" || rawKind === "error",
      };
    });
}

function normalizeRunTraceProofAttachments(
  attachments: RunTraceProofAttachment[] | null | undefined,
): RunTraceProofAttachment[] {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((attachment) => attachment && attachment.source === "browser_proof" && textValue(attachment.id))
    .map((attachment) => ({
      ...attachment,
      schema: RUN_TRACE_PROOF_ATTACHMENT_SCHEMA,
      artifactCount: Math.max(0, Math.trunc(safeNumber(attachment.artifactCount))),
      screenshotCount: Math.max(0, Math.trunc(safeNumber(attachment.screenshotCount))),
      videoCount: Math.max(0, Math.trunc(safeNumber(attachment.videoCount))),
      exitCode: Math.trunc(safeNumber(attachment.exitCode)),
      durationMs: Math.max(0, Math.trunc(safeNumber(attachment.durationMs))),
      specs: Array.isArray(attachment.specs) ? attachment.specs : [],
      urls: Array.isArray(attachment.urls) ? attachment.urls : [],
      artifacts: normalizeRunTraceProofArtifactSummaries(attachment.artifacts),
      taskArtifact: attachment.taskArtifact ?? null,
    }))
    .sort((a, b) => {
      const createdDelta = safeDateMs(b.createdAt) - safeDateMs(a.createdAt);
      if (createdDelta !== 0) return createdDelta;
      return a.id.localeCompare(b.id);
    });
}

function normalizeRunTraceProofArtifactSummaries(
  artifacts: RunTraceProofAttachment["artifacts"] | null | undefined,
): RunTraceProofArtifactSummary[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .map((artifact) => {
      if (!artifact || typeof artifact !== "object") return null;
      const record = artifact as unknown as Record<string, unknown>;
      const artifactPath = textValue(record.path);
      const uri = textValue(record.uri);
      const kind = record.kind === "image" || record.kind === "video" || record.kind === "file"
        ? record.kind
        : null;
      const label = textValue(record.label) ?? artifactPath?.split(/[\\/]/).pop() ?? null;
      if (!artifactPath || !uri || !kind || !label) return null;
      const size = isFiniteNumber(record.size) ? Math.max(0, Math.trunc(record.size)) : null;
      const sha = textValue(record.sha256);
      return {
        path: artifactPath,
        uri,
        kind,
        label,
        size,
        sha256: sha,
      };
    })
    .filter((artifact): artifact is RunTraceProofArtifactSummary => Boolean(artifact))
    .slice(0, 12);
}

function mapRunTraceTimelineCategory(event: RunTraceTimelineEventInput): RunTraceTimelineCategory {
  const kind = String(event.kind || "");
  const searchText = searchableEventText(event);

  if (hasAny(searchText, ["memory", "memory_receipt", "context supplied", "context cited"])) {
    return "memory";
  }
  if (hasAny(searchText, ["review", "reviewer", "accepted", "returned", "rejected", "approval"])) {
    return "review";
  }
  if (hasAny(searchText, ["artifact", "attachment", "file evidence", "registered artifact", "output file"])) {
    return "artifact";
  }
  if (hasAny(searchText, ["stdout", "stderr", "process_io", "process output", "exit code"])) {
    return "process_io";
  }
  if (hasAny(searchText, ["usage", "token", "cost", "duration update"])) {
    return "usage";
  }
  if (hasAny(searchText, ["handoff", "wakeup", "invocation", "dispatch", "claim"])) {
    return "handoff";
  }
  if (TOOL_KINDS.has(kind)) {
    return "tool";
  }
  if (MESSAGE_KINDS.has(kind)) {
    return "message";
  }
  if (ACTION_KINDS.has(kind)) {
    return "action";
  }
  if (RUNNER_STATUS_KINDS.has(kind)) {
    return "runner_status";
  }

  return "runner_status";
}

function summarizeRunTraceEvidence(
  input: RunTraceEvidenceInput,
  timeline = normalizeRunTraceTimeline(input.timeline ?? []),
): RunTraceEvidenceSummary {
  const metrics = input.metrics ?? {};
  const transcriptEntryCount = transcriptCount(input.transcript);
  const categoryCounts = emptyCategoryCounts();
  for (const event of timeline) {
    categoryCounts[event.category] += 1;
  }
  const proofAttachmentCount = normalizeRunTraceProofAttachments(input.proofAttachments).length;

  const hasCost = isFiniteNumber(metrics.totalCostUsd);
  const hasTokenUsage = [
    metrics.inputTokens,
    metrics.outputTokens,
    metrics.cacheReadInputTokens,
    metrics.cacheCreationInputTokens,
  ].some(isFiniteNumber);
  const hasRunDuration = isFiniteNumber(metrics.durationMs) || isFiniteNumber(input.run.durationMs);
  const hasActionMetrics = [
    metrics.messagesImported,
    metrics.actionsFound,
    metrics.actionsExecuted,
    metrics.reportsImported,
    metrics.approvalsCreated,
    metrics.tasksCreated,
    metrics.errorCount,
  ].some(isFiniteNumber);

  return {
    hasRunMetadata: Boolean(input.run.id && input.run.status),
    hasTimeline: timeline.length > 0,
    hasTranscript: transcriptEntryCount > 0,
    hasFullTranscript: input.transcript?.provenance?.fullTranscriptAvailable === true,
    hasUsage: hasCost || hasTokenUsage || hasRunDuration || hasActionMetrics || categoryCounts.usage > 0,
    hasCost,
    hasWorkspaceVisibility: Boolean(input.workspaceRunVisibility),
    hasMemoryEvidence: hasMeaningfulMemoryEvidence(input.memoryEvidence) || categoryCounts.memory > 0,
    hasSkillEvidence: Boolean(input.skillEffectiveness?.events?.length),
    hasProofAttachments: proofAttachmentCount > 0,
    hasProviderSummary: hasProviderExecutionSummary(input.providerExecution),
    hasRawPayload: input.rawPayload !== undefined && input.rawPayload !== null,
    transcriptEntryCount,
    timelineEventCount: timeline.length,
    proofAttachmentCount,
    categoryCounts,
  };
}

function deriveRunTraceEvidenceGaps(
  input: RunTraceEvidenceInput,
  evidenceSummary = summarizeRunTraceEvidence(input),
): RunTraceEvidenceGap[] {
  const providerId = normalizeProviderId(input.provider.id || input.run.providerId || input.run.invocationSource || "unknown");
  const providerDescriptor = providerDescriptorFor(providerId);
  const manualOrMinimal = isManualOrMinimalRun(input, providerId);
  const terminal = isTerminalStatus(input.run.status);
  const expectedTranscript = expectsTranscript(input);
  const expectedCost = providerDescriptor?.costTruth !== undefined && providerDescriptor.costTruth !== "unavailable";
  const expectedWorkspaceVisibility = WORKSPACE_VISIBILITY_PROVIDERS.has(providerId);
  const gaps: RunTraceEvidenceGap[] = [];

  if (detectCaptureFailed(input)) {
    gaps.push(traceCaptureFailedGap());
  }

  if (!evidenceSummary.hasTimeline) {
    gaps.push(missingTimelineGap(manualOrMinimal));
  }

  if (!evidenceSummary.hasTranscript) {
    gaps.push(missingTranscriptGap(expectedTranscript, manualOrMinimal));
  }

  if (!evidenceSummary.hasCost) {
    gaps.push(missingCostGap(expectedCost, terminal, manualOrMinimal));
  }

  if (!evidenceSummary.hasRawPayload) {
    gaps.push(missingRawPayloadGap());
  }

  if (!evidenceSummary.hasMemoryEvidence) {
    gaps.push(missingMemoryEvidenceGap(manualOrMinimal));
  }

  if (!evidenceSummary.hasWorkspaceVisibility) {
    gaps.push(missingWorkspaceVisibilityGap(expectedWorkspaceVisibility, manualOrMinimal));
  }

  if (manualOrMinimal) {
    gaps.push(manualOrMinimalRunnerGap());
  }

  return gaps;
}

function deriveRunTraceCaptureQuality(
  input: RunTraceEvidenceInput,
  evidenceSummary = summarizeRunTraceEvidence(input),
  evidenceGaps = deriveRunTraceEvidenceGaps(input, evidenceSummary),
): RunTraceCaptureQualitySummary {
  const missingRequiredEvidence = evidenceGaps
    .filter((gap) => gap.affectsCaptureQuality)
    .map((gap) => gap.id);
  const providerId = normalizeProviderId(input.provider.id || input.run.providerId || input.run.invocationSource || "unknown");

  if (isTraceCaptureUnusable(evidenceSummary, evidenceGaps)) {
    return captureQualitySummary(
      "failed",
      "Trace capture failed",
      "Trace capture failed or the run record is unusable.",
      missingRequiredEvidence,
    );
  }

  if (!hasUsefulTraceEvidence(evidenceSummary) || isManualOrMinimalRun(input, providerId)) {
    return captureQualitySummary(
      "minimal",
      "Minimal trace",
      "Only basic run status/result metadata is available.",
      missingRequiredEvidence,
    );
  }

  if (!isTerminalStatus(input.run.status)) {
    return captureQualitySummary(
      "partial",
      "Partial trace",
      "The run is still active or not terminal, so trace evidence may still be accumulating.",
      missingRequiredEvidence,
    );
  }

  if (missingRequiredEvidence.length === 0) {
    return captureQualitySummary(
      "complete",
      "Complete trace",
      "Expected trace evidence for this runner capability set was captured.",
      missingRequiredEvidence,
    );
  }

  return captureQualitySummary(
    "partial",
    "Partial trace",
    "Useful trace evidence was captured, but at least one expected evidence category is missing.",
    missingRequiredEvidence,
  );
}

function traceCaptureFailedGap(): RunTraceEvidenceGap {
  return {
    id: "trace_capture_failed",
    label: "capture_failed",
    title: "Trace capture failed",
    detail: "HiveRunner recorded a safe trace-capture failure signal for this run.",
    affectsCaptureQuality: true,
  };
}

function missingTimelineGap(manualOrMinimal: boolean): RunTraceEvidenceGap {
  return {
    id: "missing_timeline",
    label: manualOrMinimal ? "not_available" : "not_captured",
    title: "Timeline events missing",
    detail: manualOrMinimal
      ? "This runner path does not expose automated timeline events."
      : "No timeline events were recorded for this run.",
    affectsCaptureQuality: !manualOrMinimal,
  };
}

function missingTranscriptGap(expectedTranscript: boolean, manualOrMinimal: boolean): RunTraceEvidenceGap {
  const unavailable = manualOrMinimal || !expectedTranscript;
  return {
    id: "missing_transcript",
    label: unavailable ? "not_available" : "not_captured",
    title: "Transcript missing",
    detail: unavailable
      ? "This runner path does not expose a persisted transcript."
      : "The runner can expose transcript evidence, but no transcript entries were stored.",
    affectsCaptureQuality: expectedTranscript && !manualOrMinimal,
  };
}

function missingCostGap(
  expectedCost: boolean,
  terminal: boolean,
  manualOrMinimal: boolean,
): RunTraceEvidenceGap {
  const unavailable = manualOrMinimal || !expectedCost;
  return {
    id: "missing_cost",
    label: unavailable ? "not_available" : "not_captured",
    title: "Cost missing",
    detail: unavailable
      ? "Cost data is not available for this runner path."
      : "Cost data was expected for this provider, but was not captured.",
    affectsCaptureQuality: expectedCost && terminal && !manualOrMinimal,
  };
}

function missingRawPayloadGap(): RunTraceEvidenceGap {
  return {
    id: "missing_raw_payload",
    label: "not_captured",
    title: "Raw handoff payload missing",
    detail: "Run Trace v1 does not store the full raw handoff payload by default.",
    affectsCaptureQuality: false,
  };
}

function missingMemoryEvidenceGap(manualOrMinimal: boolean): RunTraceEvidenceGap {
  return {
    id: "missing_memory_evidence",
    label: manualOrMinimal ? "not_available" : "not_captured",
    title: "Memory evidence missing",
    detail: manualOrMinimal
      ? "Manual or minimal runs do not have automated memory evidence."
      : "No memory receipts or injected-memory evidence were linked to this run.",
    affectsCaptureQuality: false,
  };
}

function missingWorkspaceVisibilityGap(
  expectedWorkspaceVisibility: boolean,
  manualOrMinimal: boolean,
): RunTraceEvidenceGap {
  const unavailable = manualOrMinimal || !expectedWorkspaceVisibility;
  return {
    id: "missing_workspace_visibility",
    label: unavailable ? "not_available" : "not_captured",
    title: "Workspace visibility missing",
    detail: unavailable
      ? "Workspace status visibility is not available for this runner path."
      : "Workspace visibility was expected for this runner, but no status snapshot was captured.",
    affectsCaptureQuality: expectedWorkspaceVisibility && !manualOrMinimal,
  };
}

function manualOrMinimalRunnerGap(): RunTraceEvidenceGap {
  return {
    id: "manual_or_minimal_runner",
    label: "not_available",
    title: "Manual or minimal runner",
    detail: "Only basic status/result evidence is expected for this runner path.",
    affectsCaptureQuality: false,
  };
}

function isTraceCaptureUnusable(
  evidenceSummary: RunTraceEvidenceSummary,
  evidenceGaps: RunTraceEvidenceGap[],
): boolean {
  return !evidenceSummary.hasRunMetadata || evidenceGaps.some((gap) => gap.label === "capture_failed");
}

function hasUsefulTraceEvidence(evidenceSummary: RunTraceEvidenceSummary): boolean {
  return evidenceSummary.hasTimeline ||
    evidenceSummary.hasTranscript ||
    evidenceSummary.hasUsage ||
    evidenceSummary.hasWorkspaceVisibility ||
    evidenceSummary.hasMemoryEvidence ||
    evidenceSummary.hasSkillEvidence ||
    evidenceSummary.hasProofAttachments ||
    evidenceSummary.hasProviderSummary;
}

function captureQualitySummary(
  label: RunTraceCaptureQuality,
  title: string,
  detail: string,
  missingRequiredEvidence: RunTraceEvidenceGapId[],
): RunTraceCaptureQualitySummary {
  return {
    label,
    title,
    detail,
    missingRequiredEvidence,
  };
}

function emptyCategoryCounts(): Record<RunTraceTimelineCategory, number> {
  return RUN_TRACE_TIMELINE_CATEGORIES.reduce((acc, category) => {
    acc[category] = 0;
    return acc;
  }, {} as Record<RunTraceTimelineCategory, number>);
}

function searchableEventText(event: RunTraceTimelineEventInput): string {
  return [
    event.kind,
    event.providerEventType,
    event.commentSource,
    event.commentType,
    event.source,
    event.summary,
    event.title,
    JSON.stringify(event.payload ?? {}),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase();
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function transcriptCount(transcript: RunTraceTranscriptEvidence | null | undefined): number {
  if (typeof transcript?.provenance?.totalEntries === "number") {
    return Math.max(0, transcript.provenance.totalEntries);
  }
  return Array.isArray(transcript?.entries) ? transcript.entries.length : 0;
}

function hasProviderExecutionSummary(providerExecution: RunTraceProviderExecutionEvidence | null | undefined): boolean {
  if (!providerExecution) return false;
  return Boolean(
    providerExecution.structuredTelemetry ||
      providerExecution.observedLiveText ||
      providerExecution.observedThinking ||
      providerExecution.observedStructuredTools ||
      textValue(providerExecution.assistantSummary) ||
      textValue(providerExecution.thinkingSummary) ||
      textValue(providerExecution.note) ||
      (providerExecution.resultErrors?.length ?? 0) > 0 ||
      (providerExecution.linkedHeartbeatCount ?? 0) > 0,
  );
}

function expectsTranscript(input: RunTraceEvidenceInput): boolean {
  const capabilities = input.provider.capabilities;
  const providerExecution = input.providerExecution;
  return capabilities?.persistedTranscript === true ||
    providerExecution?.structuredTelemetry === true ||
    providerExecution?.observedLiveText === true ||
    providerExecution?.observedStructuredTools === true ||
    input.transcript?.provenance?.fullTranscriptAvailable === true;
}

function detectCaptureFailed(input: RunTraceEvidenceInput): boolean {
  const text = [
    input.run.error,
    input.transcript?.provenance?.note,
    input.providerExecution?.note,
    input.provenance?.timeline?.note,
    ...(input.providerExecution?.resultErrors ?? []),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  return text.includes("capture failed") ||
    text.includes("trace capture failed") ||
    text.includes("transcript capture failed") ||
    text.includes("capture_failed");
}

function isManualOrMinimalRun(input: RunTraceEvidenceInput, providerId: string): boolean {
  const invocationSource = normalizeProviderId(input.run.invocationSource ?? "");
  return MANUAL_OR_MINIMAL_PROVIDERS.has(providerId) ||
    MANUAL_OR_MINIMAL_PROVIDERS.has(invocationSource) ||
    invocationSource === "manual";
}

function providerDescriptorFor(providerId: string) {
  const effectiveProviderId = providerId === "openclaw" ? "openclaw-heartbeat" : providerId;
  return PROVIDER_PRODUCT_DESCRIPTORS.find((descriptor) => descriptor.providerId === effectiveProviderId);
}

function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase();
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.trim().toLowerCase());
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function safeDateMs(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function hasMeaningfulMemoryEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length > 0;
  const record = value as Record<string, unknown>;
  const directEvidenceCollections = [
    record.evidence,
    record.records,
    record.memoryReceipts,
    record.used,
    record.ignored,
    record.irrelevant,
  ];
  if (directEvidenceCollections.some(hasNonEmptyArray)) return true;
  if (hasMemoryUtilizationEvidence(record.utilization)) return true;

  const isStructuredMemoryContainer =
    "injectionSource" in record ||
    "evidence" in record ||
    "diagnostics" in record ||
    "utilization" in record ||
    ("company" in record && "run" in record);
  if (isStructuredMemoryContainer) return false;

  return Object.keys(record).length > 0;
}

function hasMemoryUtilizationEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (hasNonEmptyArray(record.receipts)) return true;

  const receiptContainer = record.receipts;
  if (receiptContainer && typeof receiptContainer === "object" && !Array.isArray(receiptContainer)) {
    if (hasNonEmptyArray((receiptContainer as Record<string, unknown>).receipts)) return true;
  }

  const matchedUse = record.matchedUse;
  if (matchedUse && typeof matchedUse === "object" && !Array.isArray(matchedUse)) {
    if (hasNonEmptyArray((matchedUse as Record<string, unknown>).matches)) return true;
  }

  return false;
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function compactMetricsForExport(metrics: RunTraceMetricsEvidence): Record<string, unknown> {
  return {
    durationMs: metrics.durationMs ?? null,
    inputTokens: metrics.inputTokens ?? null,
    outputTokens: metrics.outputTokens ?? null,
    cacheReadInputTokens: metrics.cacheReadInputTokens ?? null,
    cacheCreationInputTokens: metrics.cacheCreationInputTokens ?? null,
    totalCostUsd: metrics.totalCostUsd ?? null,
    messagesImported: metrics.messagesImported ?? null,
    actionsFound: metrics.actionsFound ?? null,
    actionsExecuted: metrics.actionsExecuted ?? null,
    reportsImported: metrics.reportsImported ?? null,
    approvalsCreated: metrics.approvalsCreated ?? null,
    tasksCreated: metrics.tasksCreated ?? null,
    errorCount: metrics.errorCount ?? null,
  };
}

function buildRunTraceCopySummary(
  input: RunTraceEvidenceInput,
  trace: RunTraceViewModel,
): string {
  const taskParts = [
    input.task?.key,
    input.task?.title,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const usageParts = [
    isFiniteNumber(input.metrics?.inputTokens) ? `${input.metrics.inputTokens} input` : null,
    isFiniteNumber(input.metrics?.outputTokens) ? `${input.metrics.outputTokens} output` : null,
    isFiniteNumber(input.metrics?.totalCostUsd) ? `$${input.metrics.totalCostUsd.toFixed(4)}` : null,
  ].filter((value): value is string => Boolean(value));
  const evidenceGapSummary = trace.evidenceGaps.length > 0
    ? trace.evidenceGaps.map((gap) => `${gap.title} [${gap.label}]`).join("; ")
    : "none";

  return [
    "Run Trace",
    `Run: ${input.run.id}`,
    `Task: ${taskParts.length > 0 ? taskParts.join(" - ") : "none"}`,
    `Status: ${input.run.status}`,
    `Provider: ${trace.providerId}`,
    `Capture quality: ${trace.captureQuality.title} (${trace.captureQuality.label})`,
    `Timeline events: ${trace.timeline.length}`,
    `Proof attachments: ${trace.proofAttachments.length}`,
    `Annotations: ${trace.annotations.state} (${trace.annotations.annotations.length})`,
    `Evidence gaps: ${evidenceGapSummary}`,
    usageParts.length > 0 ? `Usage: ${usageParts.join(" / ")}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

class RunTraceRedactor {
  private readonly categories = RUN_TRACE_REDACTION_CATEGORIES.reduce((acc, category) => {
    acc[category] = { count: 0, paths: [] };
    return acc;
  }, {} as Record<RunTraceRedactionCategory, RunTraceRedactionCategorySummary>);

  redact(category: RunTraceRedactionCategory, path: string): string {
    const summary = this.categories[category];
    summary.count += 1;
    if (!summary.paths.includes(path)) {
      summary.paths.push(path);
    }
    return `[REDACTED:${category}]`;
  }

  summary(): RunTraceRedactionSummary {
    const categories = RUN_TRACE_REDACTION_CATEGORIES.reduce((acc, category) => {
      acc[category] = {
        count: this.categories[category].count,
        paths: [...this.categories[category].paths].sort(),
      };
      return acc;
    }, {} as Record<RunTraceRedactionCategory, RunTraceRedactionCategorySummary>);
    const totalRedactions = RUN_TRACE_REDACTION_CATEGORIES.reduce(
      (total, category) => total + categories[category].count,
      0,
    );

    return {
      policy: RUN_TRACE_REDACTION_POLICY,
      location: "server",
      totalRedactions,
      categories,
      notes: [
        "Structure-preserving redaction keeps object keys, arrays, and evidence-gap labels intact while replacing sensitive scalar values or substrings.",
        "Run Trace v1 exports are produced server-side from the run events evidence bundle so provider payloads and secrets-adjacent fields pass through one shared redaction policy.",
      ],
    };
  }
}

function redactStructuredValue(
  value: unknown,
  path: string,
  redactor: RunTraceRedactor,
  forceSensitiveField = false,
): unknown {
  if (typeof value === "string") {
    if (forceSensitiveField) {
      return redactor.redact("sensitive_field", path);
    }
    return redactStringPatterns(value, path, redactor);
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return forceSensitiveField ? redactor.redact("sensitive_field", path) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactStructuredValue(item, `${path}[${index}]`, redactor, forceSensitiveField));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().reduce((acc, key) => {
      const childPath = `${path}.${key}`;
      const sensitiveField = forceSensitiveField || isSensitiveFieldName(key);
      acc[key] = redactStructuredValue(record[key], childPath, redactor, sensitiveField);
      return acc;
    }, {} as Record<string, unknown>);
  }

  return value;
}

function redactStringPatterns(value: string, path: string, redactor: RunTraceRedactor): string {
  let output = value;
  output = redactMatches(output, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "private_credential", path, redactor);
  output = redactMatches(output, /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "bearer_token", path, redactor);
  for (const pattern of API_KEY_PATTERNS) {
    output = redactMatches(output, pattern, "api_key", path, redactor);
  }
  return output;
}

const API_KEY_PATTERNS = [
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{12,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/g,
  /\b(?:api|secret|token|key)_[A-Za-z0-9_-]{16,}\b/gi,
];

function redactMatches(
  value: string,
  pattern: RegExp,
  category: RunTraceRedactionCategory,
  path: string,
  redactor: RunTraceRedactor,
): string {
  return value.replace(pattern, () => redactor.redact(category, path));
}

const SAFE_FIELD_NAMES = new Set([
  "idempotencykey",
  "key",
  "taskkey",
  "wakeuprequestid",
  "providerid",
  "runid",
  "id",
  "publickey",
]);

function isSensitiveFieldName(fieldName: string): boolean {
  const compact = fieldName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (SAFE_FIELD_NAMES.has(compact)) return false;

  const envLike = /^[A-Z0-9_]+$/.test(fieldName) &&
    /(API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|AUTH|CREDENTIAL)/.test(fieldName);
  if (envLike) return true;

  return /(?:password|passphrase|apiKey|authToken|accessToken|refreshToken|clientSecret|privateKey|credential|credentials|authorization|bearerToken|secret)$/i.test(fieldName);
}

/**
 * Structure-preserving redaction for any Run Trace–derived payload — the view
 * model, an eval snapshot, or an MCP resource body. This is the single source of
 * truth so every export path shares the same redaction categories, patterns, and
 * summary shape as {@link buildRedactedRunTraceExport}. Object keys, arrays, and
 * evidence-gap labels are preserved; only sensitive scalar values or substrings
 * are replaced, and the returned summary carries per-category counts.
 */
export function redactRunTracePayload<T>(value: T): {
  value: T;
  redaction: RunTraceRedactionSummary;
} {
  const redactor = new RunTraceRedactor();
  const redacted = redactStructuredValue(value, "$", redactor) as T;
  return { value: redacted, redaction: redactor.summary() };
}

// Non-global probe copies of the redactor's own credential patterns. Used as a
// defense-in-depth parity guard (test mode) by callers that must prove a payload
// is free of secret-pattern fixtures *after* redaction. Built from the same
// API_KEY_PATTERNS the redactor replaces, so the guard can never drift weaker
// than the redactor that produced the payload.
function credentialLeakProbePatterns(): RegExp[] {
  return [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
    ...API_KEY_PATTERNS.map((pattern) => new RegExp(pattern.source, pattern.flags.replace("g", ""))),
  ];
}

/**
 * Returns the first credential-like pattern that still matches `serialized`, or
 * null when the payload is clean. Shared by eval snapshot validation and MCP
 * resource reads so they enforce the identical secret-fixture bar as the Run
 * Trace redactor.
 */
export function findRunTraceCredentialLeak(serialized: string): string | null {
  for (const pattern of credentialLeakProbePatterns()) {
    if (pattern.test(serialized)) return pattern.source;
  }
  return null;
}

/**
 * Throws when `payload` still contains a credential-like value after redaction.
 * Accepts an already-serialized string or any JSON-serializable value.
 */
export function assertNoRunTraceCredentialLeak(payload: unknown, label = "Run Trace payload"): void {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  if (findRunTraceCredentialLeak(serialized)) {
    throw new Error(`${label} contains an unredacted credential-like value`);
  }
}
