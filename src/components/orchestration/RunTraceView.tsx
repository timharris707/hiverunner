"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Zap,
  MessageSquare,
  Play,
  Activity,
  Radio,
  FileText,
  Terminal,
  Shield,
  ListChecks,
  Loader,
  Info,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  X,
} from "lucide-react";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { ContextualRecommendationRollup, emptyContextualRecommendationCounts } from "@/components/orchestration/ContextualRecommendationRollup";
import { ExperimentLaunchPanel } from "@/components/orchestration/ExperimentLaunchPanel";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";
import type { ProviderCapabilities } from "@/lib/orchestration/adapters/types";
import { buildRunTraceExperimentLaunchModel } from "@/lib/orchestration/experiment-launch";
import type { RunTraceProofAttachment, RunTraceRedactedExport, RunTraceViewModel } from "@/lib/orchestration/run-trace";
import type { OrchestrationExperimentReportEvidence } from "@/lib/orchestration/types";
import { CapabilityGrid, TierBadge } from "@/components/orchestration/ProviderPresentation";
import { formatOrchestrationModeLabel as formatSharedOrchestrationModeLabel } from "@/lib/orchestration/execution-hives";
import { P as tokens } from "@/lib/ui/tokens";

const A = {
  accent: tokens.accent,
  accentLight: "#f59e0b",
  accentDark: "#b45309",
  surface: tokens.bg,
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  cardBorderHover: tokens.cardBorderHover,
  muted: tokens.muted,
  text: tokens.text,
  textSec: tokens.textSec,
};

/* ── Types ── */

interface RunDetail {
  id: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  agentEmoji: string | null;
  companyId: string;
  status: string;
  providerId: string;
  invocationSource: string;
  triggerDetail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastMeaningfulProgressAt?: string | null;
  suspiciousAfterAt?: string | null;
  durationMs: number | null;
  wakeupRequestId: string | null;
  idempotencyKey: string | null;
  sessionIdBefore: string | null;
  sessionIdAfter: string | null;
  usage: Record<string, unknown>;
  result: Record<string, unknown>;
  exitCode: number | null;
  error: string | null;
  createdAt: string;
}

interface TaskContext {
  id: string;
  title: string | null;
  key: string | null;
  status: string | null;
  priority: string | null;
}

interface RunContext {
  wakeSource: string | null;
  wakeReason: string | null;
  direction: string | null;
  directionTaskId: string | null;
  issueId: string | null;
  taskKey: string | null;
}

interface InvocationInfo {
  providerId: string;
  runTable: string;
  wakeupRequestId: string | null;
  idempotencyKey: string | null;
  wakeupStatus: string | null;
  requestedAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  linkedHeartbeatCount: number;
  note: string | null;
}

interface RunMetrics {
  durationMs: number | null;
  promptChars: number | null;
  promptBuildMs: number | null;
  totalDurationMs: number | null;
  thinkingDurationMs: number | null;
  actionExecutionMs: number | null;
  importDurationMs: number | null;
  messageCountBefore: number | null;
  sessionReused: boolean | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  totalCostUsd: number | null;
  messagesImported: number | null;
  actionsFound: number | null;
  actionsExecuted: number | null;
  actionsSkippedDedup: number | null;
  reportsImported: number | null;
  approvalsCreated: number | null;
  tasksCreated: number | null;
  assistantTextLength: number | null;
  plainTextLength: number | null;
  errorCount: number | null;
}

interface ProviderExecutionInfo {
  source: string | null;
  cliCommand: string | null;
  modelId: string | null;
  modelName: string | null;
  factoryBuildId: string | null;
  factoryTaskId: string | null;
  factoryTaskTitle: string | null;
  openclawRunId: string | null;
  openclawStatus: string | null;
  structuredTelemetry: boolean | null;
  observedLiveText: boolean | null;
  observedThinking: boolean | null;
  observedStructuredTools: boolean | null;
  toolCallNames: string[];
  assistantSummary: string | null;
  thinkingSummary: string | null;
  resultSubtype: string | null;
  resultErrors: string[];
  linkedHeartbeatCount: number;
  note: string | null;
}

interface ResolvedExecutionContext {
  executionEngine: string | null;
  provider: string | null;
  runnerProvider: string | null;
  runnerModel: string | null;
  model: string | null;
  modelLane: string | null;
  workspaceRoot: string | null;
  companyWorkspaceRoot: string | null;
  sourceWorkspaceRoot: string | null;
  sandbox: string | null;
  approvalPolicy: string | null;
  runtimeSlug: string | null;
  runtimeDisplayName: string | null;
  command: string | null;
  configSource: string | null;
  phase: "planned" | "run";
}

interface RunSkillEffectivenessEvent {
  id: string;
  skillId: string | null;
  skillSlug: string | null;
  skillName: string;
  skillVersion: number | null;
  eventType: "available" | "explicit_use" | "review_outcome";
  outcome: "pass" | "fail" | "blocked" | "unknown" | null;
  source: "system" | "agent" | "operator";
  agentName: string | null;
  taskKey: string | null;
  note: string | null;
  createdAt: string;
}

interface RunSkillEffectiveness {
  events: RunSkillEffectivenessEvent[];
  totals: {
    availableCount: number;
    explicitUseCount: number;
    passCount: number;
    failCount: number;
    blockedCount: number;
    unknownCount: number;
  };
}

interface EvalCaseSuggestion {
  schema: "hiverunner.eval_case_suggestion.v1";
  outcome: "accepted" | "returned";
  source: "review_status_event";
  title: string;
  detail: string;
  defaultRationale: string;
  reviewerAgentId: string | null;
  reviewerName: string | null;
  reviewedAt: string;
  requiresOperatorConfirmation: true;
  requiresLowCaptureConfirmation: boolean;
  requiresFailedTraceConfirmation: boolean;
  warnings: string[];
}

interface TranscriptEntry {
  id: string;
  body: string;
  type: string;
  source: string;
  authorName: string | null;
  ts: number;
  eventKind?: string;
  role?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown>;
}

interface TranscriptProvenance {
  label: string;
  note: string;
  totalEntries: number;
  source: string;
  fullTranscriptAvailable: boolean;
}

export interface TimelineEvent {
  id: string;
  kind: MCLiveEventKind;
  summary: string;
  ts: number;
  source: string;
  providerEventType?: string;
  commentSource?: string;
  commentType?: string;
  authorName?: string | null;
}

interface WorkspaceRunVisibilityRoot {
  root: string;
  exists: boolean;
  isGitRepo: boolean;
  beforeDirtyCount: number;
  afterDirtyCount: number;
  changedDuringRunCount: number;
  changedDuringRun: Array<{
    path: string;
    before: string | null;
    after: string | null;
    changeType: string;
  }>;
  beforeEntries: Array<{ path: string; raw: string; index: string; workingTree: string }>;
  afterEntries: Array<{ path: string; raw: string; index: string; workingTree: string }>;
  warning: string | null;
  error?: string;
}

interface WorkspaceRunVisibility {
  schema: "hiverunner.workspace_run_visibility.v1";
  capturedAt: string;
  readOnlyIntent: boolean;
  roots: WorkspaceRunVisibilityRoot[];
  totals: {
    trackedRoots: number;
    gitRoots: number;
    beforeDirtyCount: number;
    afterDirtyCount: number;
    changedDuringRunCount: number;
  };
  warnings: string[];
}

type RunTraceViewModelPayload = Omit<RunTraceViewModel, "proofAttachments"> & {
  proofAttachments?: RunTraceProofAttachment[] | null;
};

/** Wire format from the run events API — uses `id` not `providerId` */
interface ProviderInfo {
  id: string;
  displayName: string;
  tier: number;
  tierLabel: string;
  capabilities: ProviderCapabilities;
}

export interface RunEventsResponse {
  run: RunDetail;
  task: TaskContext | null;
  context: RunContext | null;
  invocation: InvocationInfo;
  metrics: RunMetrics;
  resolvedExecution?: {
    before: ResolvedExecutionContext;
    after: ResolvedExecutionContext;
  };
  workspaceRunVisibility?: WorkspaceRunVisibility | null;
  providerExecution: ProviderExecutionInfo;
  proofAttachments?: RunTraceProofAttachment[];
  skillEffectiveness: RunSkillEffectiveness;
  memoryEvidence?: unknown;
  transcript: { entries: TranscriptEntry[]; provenance: TranscriptProvenance };
  timeline: TimelineEvent[];
  trace?: RunTraceViewModelPayload;
  traceExport?: RunTraceRedactedExport;
  evalCaseSuggestion?: EvalCaseSuggestion | null;
  experimentReports?: OrchestrationExperimentReportEvidence[];
  provenance: { timeline: { label: string; note: string; sources: string[] }; runTable: string };
  provider: ProviderInfo;
}

/* ── Phase grouping ── */

interface TimelinePhase {
  id: string;
  label: string;
  icon: typeof Zap;
  color: string;
  events: TimelineEvent[];
  startTs: number;
  endTs: number;
  durationMs: number | null;
}

function groupIntoPhases(events: TimelineEvent[]): TimelinePhase[] {
  if (events.length === 0) return [];

  const phases: TimelinePhase[] = [];
  let currentPhase: TimelinePhase | null = null;

  for (const event of events) {
    const phaseType = getPhaseType(event.kind);

    if (phaseType === "start" || !currentPhase) {
      // Close previous phase
      if (currentPhase) {
        currentPhase.endTs = event.ts;
        currentPhase.durationMs = currentPhase.endTs - currentPhase.startTs;
        phases.push(currentPhase);
      }
      currentPhase = {
        id: `phase-${phases.length}`,
        label: getPhaseLabel(event.kind),
        icon: getPhaseIcon(event.kind),
        color: getPhaseColor(event.kind),
        events: [event],
        startTs: event.ts,
        endTs: event.ts,
        durationMs: null,
      };
    } else if (phaseType === "end") {
      currentPhase.events.push(event);
      currentPhase.endTs = event.ts;
      currentPhase.durationMs = currentPhase.endTs - currentPhase.startTs;
      currentPhase.label = getPhaseLabel(event.kind);
      currentPhase.icon = getPhaseIcon(event.kind);
      currentPhase.color = getPhaseColor(event.kind);
      phases.push(currentPhase);
      currentPhase = null;
    } else if (phaseType === "transition") {
      // Transitions close the current phase and start a new one
      if (currentPhase) {
        currentPhase.endTs = event.ts;
        currentPhase.durationMs = currentPhase.endTs - currentPhase.startTs;
        phases.push(currentPhase);
      }
      currentPhase = {
        id: `phase-${phases.length}`,
        label: getPhaseLabel(event.kind),
        icon: getPhaseIcon(event.kind),
        color: getPhaseColor(event.kind),
        events: [event],
        startTs: event.ts,
        endTs: event.ts,
        durationMs: null,
      };
    } else {
      currentPhase.events.push(event);
      currentPhase.endTs = event.ts;
    }
  }

  // Close any remaining open phase
  if (currentPhase && currentPhase.events.length > 0) {
    if (currentPhase.durationMs === null && currentPhase.events.length > 1) {
      currentPhase.durationMs = currentPhase.endTs - currentPhase.startTs;
    }
    phases.push(currentPhase);
  }

  return phases;
}

function getPhaseType(kind: MCLiveEventKind): "start" | "end" | "transition" | "event" {
  switch (kind) {
    case "run_start": return "start";
    case "run_end": return "end";
    case "run_error": return "end";
    case "run_progress": return "transition";
    case "assistant_text_final": return "transition";
    default: return "event";
  }
}

function getPhaseLabel(kind: MCLiveEventKind): string {
  switch (kind) {
    case "run_start": return "Session started";
    case "run_progress": return "Agent processing";
    case "assistant_text_final": return "Actions";
    case "run_end": return "Completed";
    case "run_error": return "Error";
    case "action_detected": return "Actions";
    case "comment_written": return "Comments";
    default: return "Events";
  }
}

function getPhaseIcon(kind: MCLiveEventKind): typeof Zap {
  switch (kind) {
    case "run_start": return Play;
    case "run_progress": return Loader;
    case "assistant_text_final": return Zap;
    case "run_end": return Check;
    case "run_error": return AlertTriangle;
    case "comment_written": return MessageSquare;
    default: return Activity;
  }
}

function getPhaseColor(kind: MCLiveEventKind): string {
  switch (kind) {
    case "run_start": return "#06b6d4";
    case "run_progress": return "#a8a29e";
    case "assistant_text_final": return "#67e8f9";
    case "run_end": return "#22c55e";
    case "run_error": return "#ef4444";
    case "action_detected": return "#a8a6a0";
    case "comment_written": return "#22c55e";
    default: return A.muted;
  }
}

/* ── Constants ── */

const STATUS_TONES: Record<string, { color: string; bg: string; label: string }> = {
  queued: { color: "#a8a6a0", bg: "rgba(168,166,160,0.14)", label: "Queued" },
  running: { color: "#22c55e", bg: "rgba(34,197,94,0.14)", label: "Running" },
  succeeded: { color: "#4ade80", bg: "rgba(74,222,128,0.14)", label: "Succeeded" },
  completed: { color: "#4ade80", bg: "rgba(74,222,128,0.14)", label: "Succeeded" },
  failed: { color: "#f87171", bg: "rgba(248,113,113,0.14)", label: "Failed" },
  cancelled: { color: "#78716c", bg: "rgba(120,113,108,0.14)", label: "Cancelled" },
  timed_out: { color: "#f87171", bg: "rgba(248,113,113,0.14)", label: "Timed Out" },
};

const EVENT_ICONS: Partial<Record<MCLiveEventKind, { icon: typeof Zap; color: string }>> = {
  run_start: { icon: Play, color: "#06b6d4" },
  run_end: { icon: Check, color: "#22c55e" },
  run_error: { icon: AlertTriangle, color: "#ef4444" },
  run_progress: { icon: Loader, color: "#a8a29e" },
  assistant_text_delta: { icon: Radio, color: "#67e8f9" },
  assistant_text_final: { icon: MessageSquare, color: "#67e8f9" },
  tool_call_start: { icon: Terminal, color: "#a78bfa" },
  tool_call_end: { icon: Terminal, color: "#a78bfa" },
  action_detected: { icon: Zap, color: "#a8a6a0" },
  comment_written: { icon: MessageSquare, color: "#22c55e" },
  task_updated: { icon: Activity, color: "#22c55e" },
  report_written: { icon: FileText, color: "#a8a6a0" },
  error: { icon: AlertTriangle, color: "#ef4444" },
};

const COMMENT_TYPE_BADGES: Record<string, { label: string; color: string }> = {
  status_update: { label: "report", color: "#a8a6a0" },
  comment: { label: "comment", color: "#22c55e" },
  code_link: { label: "code", color: "#a78bfa" },
  review: { label: "review", color: "#06b6d4" },
  blocker: { label: "blocker", color: "#ef4444" },
  run_start: { label: "start", color: "#06b6d4" },
  run_end: { label: "done", color: "#22c55e" },
  run_error: { label: "error", color: "#ef4444" },
  assistant_text_final: { label: "assistant", color: "#67e8f9" },
  thinking_summary: { label: "thinking", color: "#a78bfa" },
  tool_call_start: { label: "tool", color: "#a78bfa" },
  tool_call_end: { label: "tool", color: "#a78bfa" },
  tool_result: { label: "tool", color: "#a8a6a0" },
  error: { label: "error", color: "#ef4444" },
};

/* ── View ── */

export type RunTraceRouteKind = "agent" | "task" | "global";

export type RunTraceViewProps = {
  data: RunEventsResponse;
  routeKind?: RunTraceRouteKind;
  agentId?: string;
  taskKey?: string;
  companyKey?: string | null;
  companyHref: (subpath: string) => string;
  isLive?: boolean;
  liveTimelineEvents?: TimelineEvent[];
  liveStreamingText?: string | null;
  nowMs?: number | null;
};

const EMPTY_TIMELINE_EVENTS: TimelineEvent[] = [];

export function RunTraceView({
  data,
  routeKind = "agent",
  agentId,
  taskKey,
  companyKey,
  companyHref,
  isLive = false,
  liveTimelineEvents = EMPTY_TIMELINE_EVENTS,
  liveStreamingText = null,
  nowMs = null,
}: RunTraceViewProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [providerExpanded, setProviderExpanded] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [actionDetailExpanded, setActionDetailExpanded] = useState(false);

  const fullTimeline = useMemo(() => {
    if (liveTimelineEvents.length === 0) return data.timeline;
    return [...data.timeline, ...liveTimelineEvents].sort((a, b) => a.ts - b.ts);
  }, [data.timeline, liveTimelineEvents]);

  const phases = useMemo(() => groupIntoPhases(fullTimeline), [fullTimeline]);

  const copyValue = useCallback((text: string, field: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }, []);
  const downloadRedactedExport = useCallback((payload: RunTraceRedactedExport) => {
    const json = `${JSON.stringify(payload, null, 2)}\n`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `run-trace-${safeFilenamePart(payload.summary.runId)}-redacted.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setCopiedField("trace-export");
    setTimeout(() => setCopiedField(null), 1500);
  }, []);

  const { run, task, context, invocation, metrics, resolvedExecution, workspaceRunVisibility, providerExecution, skillEffectiveness, transcript, provider, provenance, trace, traceExport, evalCaseSuggestion } = data;
  const activeAgentId = agentId ?? run.agentSlug ?? run.agentId;
  const activeTaskKey = taskKey ?? task?.key ?? context?.taskKey ?? null;
  const agentRunsHref = activeAgentId
    ? companyHref(`/agents/${encodeURIComponent(activeAgentId)}/runs`)
    : companyHref("/team");
  const taskHref = activeTaskKey
    ? companyHref(`/tasks/${encodeURIComponent(activeTaskKey)}`)
    : companyHref("/tasks");
  const backHref = routeKind === "task"
    ? taskHref
    : routeKind === "global" && activeTaskKey
      ? taskHref
      : agentRunsHref;
  const backLabel = routeKind === "task" || (routeKind === "global" && activeTaskKey) ? "Task" : "Runs";
  const statusTone = STATUS_TONES[run.status] ?? STATUS_TONES.cancelled;
  const durationMs = run.durationMs ?? (run.startedAt && run.finishedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : run.startedAt && nowMs !== null ? nowMs - new Date(run.startedAt).getTime() : null);
  const result = run.result as Record<string, unknown> | null;
  const hasResultMetrics = [
    metrics.actionsFound,
    metrics.actionsExecuted,
    metrics.messagesImported,
    metrics.reportsImported,
    metrics.approvalsCreated,
    metrics.tasksCreated,
    metrics.errorCount,
    metrics.assistantTextLength,
  ].some((value) => typeof value === "number" && value > 0);
  const hasTelemetry = [
    metrics.promptChars,
    metrics.promptBuildMs,
    metrics.totalDurationMs,
    metrics.thinkingDurationMs,
    metrics.actionExecutionMs,
    metrics.importDurationMs,
    metrics.messageCountBefore,
    metrics.inputTokens,
    metrics.outputTokens,
    metrics.cacheReadInputTokens,
    metrics.cacheCreationInputTokens,
    metrics.totalCostUsd,
  ].some((value) => typeof value === "number");
  const sessionChanged = Boolean(run.sessionIdBefore && run.sessionIdAfter && run.sessionIdBefore !== run.sessionIdAfter);
  const transcriptCountLabel = `${transcript.provenance.totalEntries} entr${transcript.provenance.totalEntries !== 1 ? "ies" : "y"}`;
  const isOpenClawProvider = provider.id === "openclaw" || provider.id === "openclaw-heartbeat";
  const providerLabel = formatProviderDisplayName(provider.id, provider.displayName);
  const experimentLaunchModel = useMemo(
    () => buildRunTraceExperimentLaunchModel({
      runId: run.id,
      runStatus: run.status,
      taskKey: activeTaskKey,
      taskTitle: task?.title ?? null,
      taskStatus: task?.status ?? null,
      agentName: run.agentName,
      providerLabel,
      runnerModel: providerExecution.modelName ?? providerExecution.modelId,
      captureQuality: trace?.captureQuality.label ?? null,
      evidenceGapCount: trace?.evidenceGaps.length ?? null,
      reviewOutcome: evalCaseSuggestion?.outcome ?? null,
      reviewedAt: evalCaseSuggestion?.reviewedAt ?? null,
    }),
    [
      activeTaskKey,
      evalCaseSuggestion?.outcome,
      evalCaseSuggestion?.reviewedAt,
      providerExecution.modelId,
      providerExecution.modelName,
      providerLabel,
      run.agentName,
      run.id,
      run.status,
      task?.status,
      task?.title,
      trace?.captureQuality.label,
      trace?.evidenceGaps.length,
    ],
  );
  const providerSignals = [
    { label: "Structured telemetry", value: providerExecution.structuredTelemetry },
    { label: "Live text observed", value: providerExecution.observedLiveText },
    { label: "Thinking observed", value: providerExecution.observedThinking },
    { label: "Tool events observed", value: providerExecution.observedStructuredTools },
  ].filter((signal) => signal.value !== null);
  const providerFactRows = [
    { label: "Telemetry source", value: providerExecution.source, mono: true },
    { label: "CLI command", value: providerExecution.cliCommand, mono: true },
    {
      label: "Model",
      value: providerExecution.modelId && providerExecution.modelName
        ? `${providerExecution.modelName} (${providerExecution.modelId})`
        : providerExecution.modelName ?? providerExecution.modelId,
      mono: !providerExecution.modelName && Boolean(providerExecution.modelId),
    },
    { label: "Factory build", value: providerExecution.factoryBuildId, mono: true },
    {
      label: "Factory task",
      value: providerExecution.factoryTaskId && providerExecution.factoryTaskTitle
        ? `${providerExecution.factoryTaskId} · ${providerExecution.factoryTaskTitle}`
        : providerExecution.factoryTaskId ?? providerExecution.factoryTaskTitle,
      mono: Boolean(providerExecution.factoryTaskId),
    },
    { label: isOpenClawProvider ? "OpenClaw run" : "Provider run", value: providerExecution.openclawRunId, mono: true },
    { label: isOpenClawProvider ? "OpenClaw status" : "Provider status", value: providerExecution.openclawStatus },
    { label: "Result subtype", value: providerExecution.resultSubtype },
    {
      label: "Tool calls",
      value: providerExecution.toolCallNames.length > 0 ? providerExecution.toolCallNames.join(", ") : null,
    },
    {
      label: "Linked engine cycles",
      value: providerExecution.linkedHeartbeatCount > 1 ? String(providerExecution.linkedHeartbeatCount) : null,
      mono: true,
    },
  ].filter((row): row is { label: string; value: string; mono?: boolean } => typeof row.value === "string" && row.value.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
      {/* ── Back + Context Bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link
          href={backHref}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, color: A.muted, fontSize: 11, textDecoration: "none" }}
        >
          <ArrowLeft size={12} /> {backLabel}
        </Link>
        {durationMs != null && (
          <span style={{ display: "flex", alignItems: "center", gap: 4, color: A.muted, fontSize: 11 }}>
            <Clock size={11} /> {formatDuration(durationMs)}
          </span>
        )}
      </div>

      {/* ═══════════════════════════════════════════
          SECTION 1: WHAT IS THIS RUN
          ═══════════════════════════════════════════ */}

      {/* ── Run Identity ── */}
      <div style={{
        ...cardStyle,
        borderColor: isLive ? "rgba(6,182,212,0.35)" : A.cardBorder,
        boxShadow: isLive ? "0 0 24px rgba(6,182,212,0.12)" : "none",
        padding: "16px 18px",
      }}>
        {/* Agent + status row */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            {run.agentEmoji && <AvatarGlyph value={run.agentEmoji} size={22} color={A.text} />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: A.text, fontSize: 15, fontWeight: 600 }}>{run.agentName}</div>
              <div style={{ color: A.muted, fontSize: 11, marginTop: 2 }}>
                {providerLabel}
                <span style={{ color: A.textSec }}> · {formatInvocationSource(run.invocationSource)}</span>
                {context?.wakeReason && <span style={{ color: A.textSec }}> · {context.wakeReason}</span>}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {isLive && (
              <span style={{
                fontSize: 9, padding: "2px 7px", borderRadius: 4, fontWeight: 600, letterSpacing: "0.04em",
                color: "#06b6d4", background: "rgba(6,182,212,0.14)",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#06b6d4", animation: "pulse-dot 1.5s ease-in-out infinite" }} />
                LIVE
              </span>
            )}
            <span style={{
              fontSize: 11, padding: "3px 10px", borderRadius: 5,
              color: statusTone.color, background: statusTone.bg, fontWeight: 600,
            }}>
              {statusTone.label}
            </span>
          </div>
        </div>

        {/* Task context inline */}
        {task && (
          <div style={{
            marginTop: 12, padding: "8px 10px", borderRadius: 6,
            background: "rgba(255,255,255,0.03)", border: "0.5px solid rgba(255,255,255,0.06)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <ListChecks size={12} style={{ color: A.textSec, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: A.text, lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {task.title ?? "Untitled task"}
              </div>
            </div>
            {task.key && (
              <CopyChip value={task.key} label={task.key} onCopy={copyValue} copied={copiedField === `task-${task.key}`} copyKey={`task-${task.key}`} />
            )}
            {task.status && (
              <span style={{ fontSize: 10, color: A.textSec }}>{task.status.replace(/_/g, " ")}</span>
            )}
            {task.priority && (
              <span style={{
                fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                color: task.priority === "critical" ? "#f87171" : A.muted,
                background: task.priority === "critical" ? "rgba(248,113,113,0.1)" : "rgba(120,113,108,0.15)",
              }}>
                {task.priority.toUpperCase()}
              </span>
            )}
          </div>
        )}

        {/* Key IDs — always visible */}
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, fontSize: 11 }}>
          <IdPill label="Run" value={run.id} onCopy={copyValue} copied={copiedField === "runId"} copyKey="runId" />
          {run.wakeupRequestId && (
            <IdPill label="Wakeup" value={run.wakeupRequestId} onCopy={copyValue} copied={copiedField === "wakeup"} copyKey="wakeup" />
          )}
          {run.idempotencyKey && (
            <IdPill label="Idempotency" value={run.idempotencyKey} onCopy={copyValue} copied={copiedField === "idempotency"} copyKey="idempotency" />
          )}
          {run.sessionIdBefore && sessionChanged && (
            <IdPill label="Session before" value={run.sessionIdBefore} onCopy={copyValue} copied={copiedField === "session-before"} copyKey="session-before" />
          )}
          {run.sessionIdAfter && (
            <IdPill
              label={sessionChanged ? "Session after" : "Session"}
              value={run.sessionIdAfter}
              onCopy={copyValue}
              copied={copiedField === "session"}
              copyKey="session"
            />
          )}
        </div>

        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {traceExport && (
            <TraceActionButton
              icon={Copy}
              label="Copy summary"
              onClick={() => copyValue(traceExport.summary.copyText, "trace-summary")}
              active={copiedField === "trace-summary"}
            />
          )}
          <TraceActionButton
            icon={Copy}
            label="Copy run ID"
            onClick={() => copyValue(run.id, "trace-run-id")}
            active={copiedField === "trace-run-id"}
          />
          {traceExport && (
            <TraceActionButton
              icon={Download}
              label="Redacted JSON"
              onClick={() => downloadRedactedExport(traceExport)}
              active={copiedField === "trace-export"}
            />
          )}
        </div>

        {/* Collapsible technical metadata */}
        <DisclosureRow
          label="Timing & metadata"
          open={metaExpanded}
          onToggle={() => setMetaExpanded(!metaExpanded)}
          style={{ marginTop: 10 }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 20px", fontSize: 11, color: A.textSec, padding: "6px 0" }}>
            {run.startedAt && <MetaLine label="Started" value={new Date(run.startedAt).toLocaleString()} />}
            {run.finishedAt && <MetaLine label="Finished" value={new Date(run.finishedAt).toLocaleString()} />}
            {run.lastMeaningfulProgressAt && <MetaLine label="Last progress" value={new Date(run.lastMeaningfulProgressAt).toLocaleString()} />}
            {!run.finishedAt && run.suspiciousAfterAt && <MetaLine label="Suspicious after" value={new Date(run.suspiciousAfterAt).toLocaleString()} />}
            {durationMs != null && <MetaLine label="Duration" value={formatDuration(durationMs)} />}
            <MetaLine label="Provider" value={providerLabel} />
            <MetaLine label="Invocation" value={formatInvocationSource(run.invocationSource)} />
            <MetaLine label="Source" value={provenance.runTable} mono />
            {run.exitCode != null && <MetaLine label="Exit code" value={String(run.exitCode)} mono />}
          </div>
        </DisclosureRow>

        {/* Error */}
        {run.error && (
          <div style={{
            marginTop: 10, padding: "8px 10px", borderRadius: 6,
            background: "rgba(248,113,113,0.06)", border: "0.5px solid rgba(248,113,113,0.18)",
            color: "#f87171", fontSize: 12, lineHeight: 1.5,
          }}>
            {run.error}
          </div>
        )}
      </div>

      <ContextualRecommendationRollup
        surface="run-trace"
        improveHref={companyHref(`/improve?surface=run-trace&runId=${encodeURIComponent(run.id)}`)}
        companyKey={companyKey}
        contextIds={{ runId: run.id, taskKey: activeTaskKey, agentId: activeAgentId }}
        counts={emptyContextualRecommendationCounts()}
      />

      <ExperimentLaunchPanel
        model={experimentLaunchModel}
        companyKey={companyKey}
        defaultExpanded={experimentLaunchModel.availability.state === "available"}
      />

      <RunTraceTimelineCard
        fullTimeline={fullTimeline}
        phases={phases}
        provenanceNote={provenance.timeline.note}
      />

      {trace && (
        <RunTraceEvidenceCard
          trace={trace}
          data={data}
          traceExport={traceExport}
        />
      )}

      {/* ═══════════════════════════════════════════
          SECTION 2: PROVIDER + INVOCATION CONTEXT
          ═══════════════════════════════════════════ */}

      <div style={cardStyle}>
        <button
          onClick={() => setProviderExpanded(!providerExpanded)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", border: "none", background: "none", cursor: "pointer",
            padding: 0, color: A.text,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={13} style={{ color: A.textSec }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: A.textSec }}>{providerLabel}</span>
            <TierBadge tier={provider.tier} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: A.muted }}>{provider.tierLabel}</span>
            {providerExpanded ? <ChevronDown size={13} style={{ color: A.muted }} /> : <ChevronRight size={13} style={{ color: A.muted }} />}
          </div>
        </button>

        {providerExpanded && (
          <div style={{ marginTop: 10, fontSize: 11, display: "flex", flexDirection: "column", gap: 10 }}>
            <CapabilityGrid capabilities={provider.capabilities} />
            {providerExecution.note && <ProvenanceNote text={providerExecution.note} />}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <Radio size={12} style={{ color: A.textSec }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Invocation & session</span>
        </div>

        <div style={factsGridStyle}>
          <FactField label="Run table" value={invocation.runTable} mono />
          <FactField label="Invocation source" value={formatInvocationSource(run.invocationSource)} />
          {context?.wakeSource && <FactField label="Wake source" value={context.wakeSource} />}
          {context?.wakeReason && <FactField label="Wake reason" value={context.wakeReason} />}
          {invocation.wakeupStatus && <FactField label="Wakeup status" value={formatLabel(invocation.wakeupStatus)} />}
          {invocation.requestedAt && <FactField label="Requested" value={new Date(invocation.requestedAt).toLocaleString()} />}
          {invocation.claimedAt && <FactField label="Claimed" value={new Date(invocation.claimedAt).toLocaleString()} />}
          {invocation.completedAt && <FactField label="Wakeup finished" value={new Date(invocation.completedAt).toLocaleString()} />}
          {sessionChanged && run.sessionIdBefore && <FactField label="Session before" value={run.sessionIdBefore} mono />}
          {run.sessionIdAfter && <FactField label={sessionChanged ? "Session after" : "Session"} value={run.sessionIdAfter} mono />}
          {metrics.sessionReused !== null && <FactField label="Session reuse" value={metrics.sessionReused ? "Reused" : "New"} />}
          {metrics.messageCountBefore !== null && <FactField label="Messages before" value={metrics.messageCountBefore.toLocaleString()} mono />}
          {context?.taskKey && <FactField label="Task key" value={context.taskKey} mono />}
          {context?.issueId && <FactField label="Issue ID" value={context.issueId} mono />}
          {context?.directionTaskId && <FactField label="Direction task" value={context.directionTaskId} mono />}
          {invocation.linkedHeartbeatCount > 1 && <FactField label="Linked engine cycles" value={String(invocation.linkedHeartbeatCount)} mono />}
        </div>

        {run.triggerDetail && (
          <LongTextBlock label="Trigger detail" value={run.triggerDetail} mono />
        )}
        {context?.direction && (
          <LongTextBlock label="Direction snapshot" value={context.direction} />
        )}
        {invocation.note && <ProvenanceNote text={invocation.note} />}
      </div>

      {resolvedExecution && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Terminal size={12} style={{ color: A.textSec }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Runner detail</span>
          </div>
          <div style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.02)",
            border: "0.5px solid rgba(255,255,255,0.05)",
            color: A.textSec,
            fontSize: 11,
            lineHeight: 1.5,
          }}>
            HiveRunner is the control plane. Each task chooses an orchestration mode. That mode determines whether and how HiveRunner invokes a runtime, and the runtime decides which model/provider executes the work.
          </div>
          <ResolvedExecutionFacts title="Before execution" context={resolvedExecution.before} />
          <div style={{ height: 1, background: A.cardBorder, margin: "12px 0" }} />
          <ResolvedExecutionFacts title="After execution" context={resolvedExecution.after} />
        </div>
      )}

      {workspaceRunVisibility && (
        <div style={{
          ...cardStyle,
          borderColor: workspaceRunVisibility.warnings.length > 0 ? "rgba(248,113,113,0.28)" : A.cardBorder,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <FileText size={12} style={{ color: workspaceRunVisibility.warnings.length > 0 ? "#f87171" : A.textSec }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Workspace changes</span>
          </div>

          <div style={factsGridStyle}>
            <FactField label="Git roots" value={`${workspaceRunVisibility.totals.gitRoots} of ${workspaceRunVisibility.totals.trackedRoots}`} />
            <FactField label="Dirty before" value={workspaceRunVisibility.totals.beforeDirtyCount.toLocaleString()} mono />
            <FactField label="Dirty after" value={workspaceRunVisibility.totals.afterDirtyCount.toLocaleString()} mono />
            <FactField label="Changed during run" value={workspaceRunVisibility.totals.changedDuringRunCount.toLocaleString()} mono />
          </div>

          {workspaceRunVisibility.readOnlyIntent && workspaceRunVisibility.warnings.length === 0 && (
            <ProvenanceNote text="This run looked read-only and no workspace status changes were detected during execution." />
          )}
          {workspaceRunVisibility.warnings.map((warning, index) => (
            <div
              key={`${warning}-${index}`}
              style={{
                marginTop: 10,
                padding: "8px 10px",
                borderRadius: 6,
                background: "rgba(248,113,113,0.06)",
                border: "0.5px solid rgba(248,113,113,0.18)",
                color: "#f87171",
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {warning}
            </div>
          ))}

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {workspaceRunVisibility.roots.map((root) => (
              <div
                key={root.root}
                style={{
                  padding: "9px 10px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.018)",
                  border: "0.5px solid rgba(255,255,255,0.06)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: A.text, fontSize: 11, fontFamily: "monospace" }}>
                    {root.root}
                  </span>
                  <span style={{ color: root.changedDuringRunCount > 0 ? "#fbbf24" : A.muted, fontSize: 11, whiteSpace: "nowrap" }}>
                    {root.changedDuringRunCount} changed
                  </span>
                </div>
                {!root.isGitRepo && (
                  <div style={{ marginTop: 5, fontSize: 11, color: A.muted }}>
                    {root.exists ? "Not a git workspace" : "Workspace missing"}
                  </div>
                )}
                {root.changedDuringRun.length > 0 && (
                  <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 3 }}>
                    {root.changedDuringRun.slice(0, 8).map((change) => (
                      <div key={`${root.root}:${change.path}`} style={{ display: "grid", gridTemplateColumns: "74px minmax(0, 1fr)", gap: 8, color: A.textSec, fontSize: 11 }}>
                        <span style={{ color: A.muted }}>{formatWorkspaceChange(change)}</span>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>{change.path}</span>
                      </div>
                    ))}
                    {root.changedDuringRun.length > 8 && (
                      <div style={{ color: A.muted, fontSize: 11 }}>{root.changedDuringRun.length - 8} more changed files</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(providerFactRows.length > 0 || providerSignals.length > 0 || providerExecution.assistantSummary || providerExecution.thinkingSummary || providerExecution.resultErrors.length > 0) && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Terminal size={12} style={{ color: A.textSec }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Provider execution context</span>
          </div>

          {providerFactRows.length > 0 && (
            <div style={factsGridStyle}>
              {providerFactRows.map((fact) => (
                <FactField key={fact.label} label={fact.label} value={fact.value} mono={fact.mono} />
              ))}
            </div>
          )}

          {providerSignals.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: providerFactRows.length > 0 ? 10 : 0 }}>
              {providerSignals.map((signal) => (
                <BooleanChip key={signal.label} label={signal.label} value={Boolean(signal.value)} />
              ))}
            </div>
          )}

          {providerExecution.assistantSummary && (
            <LongTextBlock label="Assistant summary" value={providerExecution.assistantSummary} />
          )}
          {providerExecution.thinkingSummary && (
            <LongTextBlock label="Thinking summary" value={providerExecution.thinkingSummary} />
          )}
          {providerExecution.resultErrors.length > 0 && (
            <LongTextBlock label="Provider-reported errors" value={providerExecution.resultErrors.join("\n")} />
          )}
        </div>
      )}

      {skillEffectiveness.events.length > 0 && (
        <SkillEffectivenessCard skillEffectiveness={skillEffectiveness} />
      )}

      {/* ═══════════════════════════════════════════
          SECTION 3: WHAT THE AGENT SAID (evidence)
          ═══════════════════════════════════════════ */}

      {/* Live transcript */}
      {isLive && liveStreamingText && (
        <div style={{ ...cardStyle, borderColor: "rgba(6,182,212,0.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Radio size={12} style={{ color: "#06b6d4" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#06b6d4" }}>Live output</span>
            <span style={{ fontSize: 9, color: A.muted, fontStyle: "italic", marginLeft: "auto" }}>ephemeral</span>
          </div>
          <div style={{
            padding: "10px 12px", borderRadius: 6,
            background: "rgba(6,182,212,0.03)", border: "0.5px solid rgba(6,182,212,0.1)",
            color: A.text, fontSize: 12, lineHeight: 1.6,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 280, overflowY: "auto",
          }}>
            {liveStreamingText.slice(-800)}
          </div>
        </div>
      )}

      {/* Persisted comments (transcript proxy) */}
      {!isLive && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MessageSquare size={12} style={{ color: "#22c55e" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>{transcript.provenance.label}</span>
            </div>
            <span style={{ fontSize: 10, color: A.muted }}>{transcriptCountLabel}</span>
          </div>

          {transcript.entries.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {transcript.entries.map((entry) => {
                const badge = COMMENT_TYPE_BADGES[entry.eventKind ?? entry.type];
                const roleLabel = entry.role ?? entry.source;
                return (
                  <div key={entry.id} style={{
                    padding: "10px 12px", borderRadius: 6,
                    background: "rgba(255,255,255,0.015)",
                    borderLeft: `2px solid ${badge?.color ?? "rgba(255,255,255,0.08)"}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      {badge && (
                        <span style={{
                          fontSize: 9, padding: "0px 5px", borderRadius: 3, fontWeight: 600,
                          color: badge.color, background: `${badge.color}18`, letterSpacing: "0.03em",
                        }}>
                          {badge.label.toUpperCase()}
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: A.muted }}>{formatTimestamp(entry.ts)}</span>
                      <span style={{ fontSize: 10, color: A.muted }}>· {roleLabel}</span>
                      {entry.authorName && (
                        <span style={{ fontSize: 10, color: A.muted }}>· {entry.authorName}</span>
                      )}
                    </div>
                    {entry.title && (
                      <div style={{ fontSize: 11, color: A.textSec, marginBottom: 4, fontWeight: 600 }}>
                        {entry.title}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: A.text, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {entry.body || "(no text)"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{
              padding: 18,
              textAlign: "center",
              color: A.muted,
              fontSize: 12,
              borderRadius: 6,
              border: "1px dashed rgba(120,113,108,0.3)",
            }}>
              No persisted transcript entries were captured for this run.
            </div>
          )}

          <ProvenanceNote text={transcript.provenance.note} />
          {transcript.provenance.fullTranscriptAvailable && (
            <div style={{ marginTop: 8 }}>
              <BooleanChip label="Provider transcript persisted" value />
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════
          SECTION 5: OBSERVED OUTCOME
          ═══════════════════════════════════════════ */}

      {(hasResultMetrics || (result && Array.isArray((result as Record<string, unknown>).perActionDetail) && ((result as Record<string, unknown>).perActionDetail as Array<Record<string, unknown>>).length > 0)) && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <FileText size={12} style={{ color: A.textSec }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Observed outcome</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {metrics.actionsFound !== null && metrics.actionsFound > 0 && (
              <ResultChip label="actions found" value={metrics.actionsFound} />
            )}
            {metrics.actionsExecuted !== null && metrics.actionsExecuted > 0 && (
              <ResultChip label="actions executed" value={metrics.actionsExecuted} />
            )}
            {metrics.messagesImported !== null && metrics.messagesImported > 0 && (
              <ResultChip label="messages imported" value={metrics.messagesImported} />
            )}
            {metrics.reportsImported !== null && metrics.reportsImported > 0 && (
              <ResultChip label="reports imported" value={metrics.reportsImported} />
            )}
            {metrics.tasksCreated !== null && metrics.tasksCreated > 0 && (
              <ResultChip label="tasks created" value={metrics.tasksCreated} />
            )}
            {metrics.approvalsCreated !== null && metrics.approvalsCreated > 0 && (
              <ResultChip label="approvals created" value={metrics.approvalsCreated} />
            )}
            {metrics.actionsSkippedDedup !== null && metrics.actionsSkippedDedup > 0 && (
              <ResultChip label="skipped" value={metrics.actionsSkippedDedup} muted />
            )}
            {metrics.errorCount !== null && metrics.errorCount > 0 && (
              <ResultChip label="errors" value={metrics.errorCount} warn />
            )}
            {metrics.assistantTextLength !== null && metrics.assistantTextLength > 0 && (
              <ResultChip label="assistant chars" value={metrics.assistantTextLength} muted />
            )}
            {metrics.plainTextLength !== null && metrics.plainTextLength > 0 && (
              <ResultChip label="plain-text chars" value={metrics.plainTextLength} muted />
            )}
          </div>

          {/* Per-action detail from enriched result */}
          {result && Array.isArray((result as Record<string, unknown>).perActionDetail) && ((result as Record<string, unknown>).perActionDetail as Array<Record<string, unknown>>).length > 0 && (
            <DisclosureRow
              label={`Per-action detail (${((result as Record<string, unknown>).perActionDetail as unknown[]).length})`}
              open={actionDetailExpanded}
              onToggle={() => setActionDetailExpanded(!actionDetailExpanded)}
              style={{ marginTop: 8 }}
            >
              <div style={{ fontSize: 11, color: A.textSec, padding: "4px 0" }}>
                {((result as Record<string, unknown>).perActionDetail as Array<{ action: string; target: string; status: string; durationMs: number }>).map((d, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 10, color: A.muted, width: 40 }}>{d.durationMs}ms</span>
                    <span style={{ color: d.status === "error" ? "#f87171" : d.status === "skipped" ? A.muted : A.text }}>{d.action}</span>
                    <span style={{ color: A.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.target}</span>
                  </div>
                ))}
              </div>
            </DisclosureRow>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════
          SECTION 6: METRICS (when available)
          ═══════════════════════════════════════════ */}

      {hasTelemetry && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Clock size={12} style={{ color: A.textSec }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Observed metrics</span>
            <span style={{ fontSize: 9, color: A.muted, fontStyle: "italic", marginLeft: "auto" }}>captured values</span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {metrics.totalDurationMs !== null && (
              <TelemetryChip label="Provider runtime" value={formatDuration(metrics.totalDurationMs)} />
            )}
            {metrics.thinkingDurationMs !== null && (
              <TelemetryChip label="Thinking" value={formatDuration(metrics.thinkingDurationMs)} />
            )}
            {metrics.actionExecutionMs !== null && (
              <TelemetryChip label="Actions" value={formatDuration(metrics.actionExecutionMs)} />
            )}
            {metrics.importDurationMs !== null && (
              <TelemetryChip label="Import" value={formatDuration(metrics.importDurationMs)} />
            )}
            {metrics.promptBuildMs !== null && (
              <TelemetryChip label="Prompt build" value={formatDuration(metrics.promptBuildMs)} />
            )}
            {metrics.promptChars !== null && (
              <TelemetryChip label="Prompt" value={formatCharCount(metrics.promptChars)} />
            )}
            {metrics.inputTokens !== null && (
              <TelemetryChip label="Input tokens" value={metrics.inputTokens.toLocaleString()} />
            )}
            {metrics.outputTokens !== null && (
              <TelemetryChip label="Output tokens" value={metrics.outputTokens.toLocaleString()} />
            )}
            {metrics.cacheReadInputTokens !== null && (
              <TelemetryChip label="Cache read" value={metrics.cacheReadInputTokens.toLocaleString()} />
            )}
            {metrics.cacheCreationInputTokens !== null && (
              <TelemetryChip label="Cache write" value={metrics.cacheCreationInputTokens.toLocaleString()} />
            )}
            {metrics.totalCostUsd !== null && (
              <TelemetryChip label="Total cost" value={formatUsd(metrics.totalCostUsd)} />
            )}
          </div>
        </div>
      )}

      {/* Pulse animation for live dot */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

/* ── Sub-components ── */

function RunTraceTimelineCard({
  fullTimeline,
  phases,
  provenanceNote,
}: {
  fullTimeline: TimelineEvent[];
  phases: TimelinePhase[];
  provenanceNote: string;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Activity size={12} style={{ color: A.textSec }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Execution timeline</span>
        </div>
        <span style={{ fontSize: 10, color: A.muted }}>
          {fullTimeline.length} event{fullTimeline.length !== 1 ? "s" : ""}
        </span>
      </div>

      {phases.length === 0 ? (
        <div style={{
          padding: 20, textAlign: "center", color: A.muted, fontSize: 12,
          borderRadius: 6, border: "1px dashed rgba(120,113,108,0.3)",
        }}>
          No events recorded for this run
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {phases.map((phase, pi) => {
            const Icon = phase.icon;
            const isLastPhase = pi === phases.length - 1;

            return (
              <div key={phase.id}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 0",
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: `${phase.color}14`, border: `0.5px solid ${phase.color}30`,
                  }}>
                    <Icon size={11} style={{ color: phase.color }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: phase.color }}>{phase.label}</span>
                  {phase.durationMs != null && phase.durationMs > 0 && (
                    <span style={{ fontSize: 10, color: A.muted, marginLeft: "auto" }}>
                      {formatDuration(phase.durationMs)}
                    </span>
                  )}
                </div>

                <div style={{
                  marginLeft: 11, paddingLeft: 18,
                  borderLeft: isLastPhase ? "none" : `0.5px solid rgba(255,255,255,0.06)`,
                }}>
                  {phase.events.map((event) => {
                    const iconDef = EVENT_ICONS[event.kind];
                    const iconColor = iconDef?.color ?? A.muted;

                    return (
                      <div key={event.id} style={{
                        display: "flex", gap: 8, padding: "4px 0",
                        fontSize: 12, color: A.textSec,
                      }}>
                        <span style={{ fontSize: 10, color: A.muted, width: 72, flexShrink: 0, fontFamily: "monospace" }}>
                          {formatTimestamp(event.ts)}
                        </span>
                        <span style={{
                          flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                          color: event.kind === "run_end" || event.kind === "run_start" ? A.muted : A.text,
                        }}>
                          {event.summary}
                        </span>
                        {event.source === "persisted_comment" && (
                          <span style={{ fontSize: 9, color: iconColor, opacity: 0.6 }}>comment</span>
                        )}
                        {event.source === "execution_transcript" && (
                          <span style={{ fontSize: 9, color: iconColor, opacity: 0.6 }}>transcript</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProvenanceNote text={provenanceNote} />
    </div>
  );
}

function RunTraceEvidenceCard({
  trace,
  data,
  traceExport,
}: {
  trace: RunTraceViewModelPayload;
  data: RunEventsResponse;
  traceExport?: RunTraceRedactedExport;
}) {
  const summary = trace.evidenceSummary;
  const categoryCounts = summary.categoryCounts;
  const missingRequired = trace.captureQuality.missingRequiredEvidence.length;
  const qualityColor =
    trace.captureQuality.label === "complete" ? "#22c55e" :
    trace.captureQuality.label === "failed" ? "#f87171" :
    trace.captureQuality.label === "minimal" ? A.muted :
    "#fbbf24";
  const redactionRows = traceExport
    ? Object.entries(traceExport.redaction.categories)
      .filter(([, category]) => category.count > 0)
      .map(([category, value]) => ({
        category,
        count: value.count,
      }))
    : [];
  const traceProofAttachments = trace.proofAttachments ?? [];
  const proofAttachments = traceProofAttachments.length > 0 ? traceProofAttachments : data.proofAttachments ?? [];
  const traceMetadata = traceExport ?? {
    run: data.run,
    task: data.task,
    invocation: data.invocation,
    providerExecution: data.providerExecution,
    proofAttachments,
    trace,
    provenance: data.provenance,
  };
  const evalSuggestion = data.evalCaseSuggestion ?? null;
  const experimentReports = data.experimentReports ?? [];

  return (
    <div style={{
      ...cardStyle,
      borderColor: missingRequired > 0 ? "rgba(251,191,36,0.22)" : A.cardBorder,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ListChecks size={12} style={{ color: A.textSec }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Trace coverage</span>
        </div>
        <span style={{
          fontSize: 10,
          padding: "2px 7px",
          borderRadius: 999,
          color: qualityColor,
          background: `${qualityColor}16`,
          border: `0.5px solid ${qualityColor}33`,
          fontWeight: 700,
        }}>
          {trace.captureQuality.title}
        </span>
      </div>

      <div style={{ fontSize: 11, color: A.textSec, lineHeight: 1.45, marginBottom: 10 }}>
        {trace.captureQuality.detail}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <TelemetryChip label="chronology" value={String(summary.timelineEventCount)} />
        <TelemetryChip label="transcript" value={String(summary.transcriptEntryCount)} />
        <TelemetryChip label="usage" value={summary.hasUsage ? "yes" : "no"} />
        <TelemetryChip label="result" value={summary.hasRunMetadata ? "yes" : "no"} />
        <TelemetryChip label="artifacts" value={String(categoryCounts.artifact + summary.proofAttachmentCount)} />
        <TelemetryChip label="proof" value={String(summary.proofAttachmentCount)} />
        <TelemetryChip label="memory" value={summary.hasMemoryEvidence ? "yes" : String(categoryCounts.memory)} />
        <TelemetryChip label="workspace" value={summary.hasWorkspaceVisibility ? "yes" : "no"} />
        <TelemetryChip label="skills" value={summary.hasSkillEvidence ? "yes" : "no"} />
        <TelemetryChip label="review" value={String(categoryCounts.review)} />
        <TelemetryChip label="annotations" value={trace.annotations.state === "deferred" ? "deferred" : String(trace.annotations.annotations.length)} />
        <TelemetryChip label="raw" value={summary.hasRawPayload ? "yes" : "bounded"} />
      </div>

      <RunTraceAnnotationStatus annotations={trace.annotations} />

      {traceExport && (
        <div style={{
          marginTop: 10,
          padding: "9px 10px",
          borderRadius: 6,
          background: "rgba(34,197,94,0.045)",
          border: "0.5px solid rgba(34,197,94,0.16)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Shield size={11} style={{ color: "#22c55e" }} />
            <span style={{ fontSize: 11, color: A.text, fontWeight: 600 }}>Redacted export</span>
            <span style={{ fontSize: 9, color: "#22c55e", marginLeft: "auto" }}>
              {traceExport.redaction.location} · {traceExport.redaction.totalRedactions} redacted
            </span>
          </div>
          {redactionRows.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {redactionRows.map((row) => (
                <TelemetryChip
                  key={row.category}
                  label={formatRedactionCategory(row.category)}
                  value={String(row.count)}
                />
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 6, fontSize: 10, color: A.muted }}>
              No sensitive values matched the current redaction policy.
            </div>
          )}
        </div>
      )}

      {proofAttachments.length > 0 && (
        <BrowserProofAttachmentList attachments={proofAttachments} />
      )}

      {experimentReports.length > 0 && (
        <ExperimentReportEvidenceList reports={experimentReports} />
      )}

      {evalSuggestion && (
        <EvalCaseSuggestionCard
          suggestion={evalSuggestion}
          runId={data.run.id}
          evidenceGaps={trace.evidenceGaps}
        />
      )}

      {trace.evidenceGaps.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {trace.evidenceGaps.map((gap) => (
            <div
              key={gap.id}
              style={{
                padding: "8px 10px",
                borderRadius: 6,
                background: gap.affectsCaptureQuality ? "rgba(251,191,36,0.06)" : "rgba(255,255,255,0.018)",
                border: `0.5px solid ${gap.affectsCaptureQuality ? "rgba(251,191,36,0.18)" : "rgba(255,255,255,0.06)"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: gap.affectsCaptureQuality ? "#fbbf24" : A.text, fontWeight: 600 }}>
                  {gap.title}
                </span>
                <span style={{ fontSize: 9, color: A.muted, marginLeft: "auto" }}>{gap.label.replace(/_/g, " ")}</span>
              </div>
              <div style={{ marginTop: 3, fontSize: 10, color: A.muted, lineHeight: 1.45 }}>
                {gap.detail}
              </div>
            </div>
          ))}
        </div>
      )}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 10, color: A.muted }}>
          {traceExport ? "Redacted export JSON" : "Raw trace metadata"}
        </summary>
        <pre style={{
          margin: "8px 0 0",
          padding: "10px 12px",
          borderRadius: 6,
          background: "rgba(0,0,0,0.18)",
          border: "0.5px solid rgba(255,255,255,0.06)",
          color: A.textSec,
          fontSize: 10,
          lineHeight: 1.45,
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {safeStringify(traceMetadata)}
        </pre>
      </details>
    </div>
  );
}

type EvalSuggestionSaveState = {
  status: "idle" | "saving" | "saved" | "error";
  message: string | null;
  href: string | null;
};

type EvalSuggestionEvidenceGap = RunTraceViewModel["evidenceGaps"][number];

function buildSuggestedEvalCaseBody(suggestion: EvalCaseSuggestion, rationale: string): Record<string, unknown> {
  return {
    outcome: suggestion.outcome,
    rationaleByOutcome: {
      [suggestion.outcome]: rationale.trim(),
    },
    reviewerAgentId: suggestion.reviewerAgentId ?? undefined,
    reviewerName: suggestion.reviewerName ?? undefined,
    reviewedAt: suggestion.reviewedAt,
    confirmReviewed: true,
    confirmPartialCapture: suggestion.requiresLowCaptureConfirmation ? true : undefined,
    confirmLowCaptureQuality: suggestion.requiresLowCaptureConfirmation ? true : undefined,
    confirmFailedTrace: suggestion.requiresFailedTraceConfirmation ? true : undefined,
  };
}

async function postSuggestedEvalCase(input: {
  runId: string;
  suggestion: EvalCaseSuggestion;
  rationale: string;
}): Promise<{ href: string | null }> {
  const response = await fetch(`/api/orchestration/engine/runs/${encodeURIComponent(input.runId)}/eval-case`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildSuggestedEvalCaseBody(input.suggestion, input.rationale)),
  });
  const payload = await response.json().catch(() => ({})) as {
    links?: { evalCase?: string };
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Save failed with ${response.status}`);
  }
  return { href: payload.links?.evalCase ?? null };
}

function buildEvalSuggestionWarnings(
  suggestion: EvalCaseSuggestion,
  evidenceGaps: EvalSuggestionEvidenceGap[],
): string[] {
  const warnings = new Set(suggestion.warnings);
  for (const gap of evidenceGaps) {
    warnings.add(`Evidence gap: ${gap.title} (${gap.label.replace(/_/g, " ")}). ${gap.detail}`);
  }
  return [...warnings];
}

const prepareEvalButtonStyle = {
  marginTop: 9,
  minHeight: 28,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 9px",
  borderRadius: 6,
  border: "0.5px solid rgba(96,165,250,0.26)",
  background: "rgba(96,165,250,0.1)",
  color: "#93c5fd",
  fontSize: 11,
  fontWeight: 700,
  cursor: "pointer",
} as const;

const evalRationaleTextareaStyle = {
  width: "100%",
  resize: "vertical",
  borderRadius: 6,
  border: "0.5px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.16)",
  color: A.text,
  padding: "8px 9px",
  fontSize: 11,
  lineHeight: 1.45,
  fontFamily: "inherit",
} as const;

function saveEvalButtonStyle(saveReady: boolean) {
  return {
    minHeight: 28,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 9px",
    borderRadius: 6,
    border: `0.5px solid ${saveReady ? "rgba(34,197,94,0.3)" : "rgba(120,113,108,0.18)"}`,
    background: saveReady ? "rgba(34,197,94,0.11)" : "rgba(120,113,108,0.08)",
    color: saveReady ? "#4ade80" : A.muted,
    fontSize: 11,
    fontWeight: 700,
    cursor: saveReady ? "pointer" : "not-allowed",
  } as const;
}

function EvalCaseSuggestionCard({
  suggestion,
  runId,
  evidenceGaps,
}: {
  suggestion: EvalCaseSuggestion;
  runId: string;
  evidenceGaps: EvalSuggestionEvidenceGap[];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [rationale, setRationale] = useState(suggestion.defaultRationale);
  const [confirmed, setConfirmed] = useState(false);
  const [lowCaptureConfirmed, setLowCaptureConfirmed] = useState(false);
  const [failedTraceConfirmed, setFailedTraceConfirmed] = useState(false);
  const [saveState, setSaveState] = useState<EvalSuggestionSaveState>({
    status: "idle",
    message: null,
    href: null,
  });
  const warnings = useMemo(
    () => buildEvalSuggestionWarnings(suggestion, evidenceGaps),
    [evidenceGaps, suggestion],
  );
  const saveReady = Boolean(
    confirmed &&
    rationale.trim() &&
    (!suggestion.requiresLowCaptureConfirmation || lowCaptureConfirmed) &&
    (!suggestion.requiresFailedTraceConfirmation || failedTraceConfirmed) &&
    saveState.status !== "saving",
  );
  const save = useCallback(async () => {
    if (!saveReady) return;
    setSaveState({ status: "saving", message: null, href: null });
    try {
      const result = await postSuggestedEvalCase({ runId, suggestion, rationale });
      setSaveState({ status: "saved", message: "Eval case saved.", href: result.href });
    } catch (error) {
      setSaveState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        href: null,
      });
    }
  }, [rationale, runId, saveReady, suggestion]);
  const closeDialog = useCallback(() => {
    if (saveState.status !== "saving") setFormOpen(false);
  }, [saveState.status]);

  return (
    <div style={{
      marginTop: 10,
      padding: "10px 12px",
      borderRadius: 6,
      background: "rgba(96,165,250,0.045)",
      border: "0.5px solid rgba(96,165,250,0.18)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <FileText size={12} style={{ color: "#60a5fa", flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <EvalSuggestionHeader suggestion={suggestion} />
          <div style={{ marginTop: 4, fontSize: 10, color: A.muted, lineHeight: 1.45 }}>
            {suggestion.detail} Operator confirmation required.
          </div>
          <EvalSuggestionWarnings warnings={warnings.slice(0, 3)} />
          {!formOpen && saveState.status !== "saved" && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              style={prepareEvalButtonStyle}
            >
              <FileText size={12} />
              Save as eval case
            </button>
          )}
          {formOpen && saveState.status !== "saved" && (
            <EvalSuggestionDialog
              suggestion={suggestion}
              warnings={warnings}
              rationale={rationale}
              setRationale={setRationale}
              confirmed={confirmed}
              setConfirmed={setConfirmed}
              lowCaptureConfirmed={lowCaptureConfirmed}
              setLowCaptureConfirmed={setLowCaptureConfirmed}
              failedTraceConfirmed={failedTraceConfirmed}
              setFailedTraceConfirmed={setFailedTraceConfirmed}
              saveReady={saveReady}
              saveState={saveState}
              onSave={save}
              onClose={closeDialog}
            />
          )}
          {saveState.status === "saved" && (
            <EvalSuggestionSavedMessage saveState={saveState} />
          )}
        </div>
      </div>
    </div>
  );
}

function EvalSuggestionHeader({ suggestion }: { suggestion: EvalCaseSuggestion }) {
  const outcomeColor = suggestion.outcome === "accepted" ? "#22c55e" : "#fbbf24";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: A.text, fontWeight: 700 }}>{suggestion.title}</span>
      <span style={{
        fontSize: 9,
        padding: "1px 6px",
        borderRadius: 999,
        color: outcomeColor,
        background: `${outcomeColor}18`,
        border: `0.5px solid ${outcomeColor}38`,
        fontWeight: 700,
      }}>
        {suggestion.outcome.toUpperCase()}
      </span>
    </div>
  );
}

function EvalSuggestionWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div style={{ marginTop: 7, display: "grid", gap: 5 }}>
      {warnings.map((warning) => (
        <div key={warning} style={{ display: "flex", gap: 5, alignItems: "flex-start", fontSize: 10, color: "#fbbf24", lineHeight: 1.35 }}>
          <AlertTriangle size={10} style={{ flexShrink: 0, marginTop: 1 }} />
          {warning}
        </div>
      ))}
    </div>
  );
}

function EvalSuggestionDialog({
  suggestion,
  warnings,
  rationale,
  setRationale,
  confirmed,
  setConfirmed,
  lowCaptureConfirmed,
  setLowCaptureConfirmed,
  failedTraceConfirmed,
  setFailedTraceConfirmed,
  saveReady,
  saveState,
  onSave,
  onClose,
}: {
  suggestion: EvalCaseSuggestion;
  warnings: string[];
  rationale: string;
  setRationale: (value: string) => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  lowCaptureConfirmed: boolean;
  setLowCaptureConfirmed: (value: boolean) => void;
  failedTraceConfirmed: boolean;
  setFailedTraceConfirmed: (value: boolean) => void;
  saveReady: boolean;
  saveState: EvalSuggestionSaveState;
  onSave: () => void;
  onClose: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.58)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="eval-case-dialog-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        style={{
          width: "min(100%, 520px)",
          maxHeight: "min(82vh, 620px)",
          overflowY: "auto",
          borderRadius: 8,
          border: "0.5px solid rgba(255,255,255,0.12)",
          background: "#151311",
          boxShadow: "0 22px 70px rgba(0,0,0,0.45)",
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            background: "rgba(96,165,250,0.11)",
            border: "0.5px solid rgba(96,165,250,0.22)",
            color: "#93c5fd",
            flexShrink: 0,
          }}>
            <FileText size={15} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="eval-case-dialog-title" style={{ color: A.text, fontSize: 14, fontWeight: 700 }}>
              Save reviewed trace as eval case
            </div>
            <div style={{ marginTop: 4, color: A.muted, fontSize: 11, lineHeight: 1.45 }}>
              {suggestion.title} · {suggestion.outcome}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close eval case dialog"
            onClick={onClose}
            disabled={saveState.status === "saving"}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "0.5px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: A.muted,
              display: "grid",
              placeItems: "center",
              cursor: saveState.status === "saving" ? "not-allowed" : "pointer",
            }}
          >
            <X size={13} />
          </button>
        </div>

        <EvalSuggestionWarnings warnings={warnings} />

        <label style={{ display: "grid", gap: 6, color: A.textSec, fontSize: 10, fontWeight: 700 }}>
          Rationale
          <textarea
            ref={textareaRef}
            aria-label="Eval case rationale"
            value={rationale}
            onChange={(event) => setRationale(event.currentTarget.value)}
            rows={4}
            style={evalRationaleTextareaStyle}
          />
        </label>

        <div style={{ display: "grid", gap: 8 }}>
          <EvalSuggestionCheckbox
            checked={confirmed}
            onChange={setConfirmed}
            label="Confirm this reviewed run should become an immutable eval case."
          />
          {suggestion.requiresLowCaptureConfirmation && (
            <EvalSuggestionCheckbox
              checked={lowCaptureConfirmed}
              onChange={setLowCaptureConfirmed}
              label="Confirm the trace has enough evidence despite low capture quality."
            />
          )}
          {suggestion.requiresFailedTraceConfirmation && (
            <EvalSuggestionCheckbox
              checked={failedTraceConfirmed}
              onChange={setFailedTraceConfirmed}
              label="Confirm this failed trace should be saved as eval evidence."
            />
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
          {saveState.status === "error" && saveState.message && (
            <span style={{ marginRight: "auto", fontSize: 10, color: "#f87171" }}>{saveState.message}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saveState.status === "saving"}
            style={{
              minHeight: 28,
              padding: "5px 9px",
              borderRadius: 6,
              border: "0.5px solid rgba(255,255,255,0.09)",
              background: "rgba(255,255,255,0.035)",
              color: A.textSec,
              fontSize: 11,
              fontWeight: 700,
              cursor: saveState.status === "saving" ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!saveReady}
            onClick={onSave}
            style={saveEvalButtonStyle(saveReady)}
          >
            {saveState.status === "saving"
              ? <Loader size={12} style={{ animation: "spin 1.5s linear infinite" }} />
              : <Check size={12} />}
            Confirm and save
          </button>
        </div>
      </div>
    </div>
  );
}

function EvalSuggestionCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 10, color: A.textSec, lineHeight: 1.4 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        style={{ marginTop: 1 }}
      />
      {label}
    </label>
  );
}

function EvalSuggestionSavedMessage({ saveState }: { saveState: EvalSuggestionSaveState }) {
  return (
    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: "#22c55e" }}>
      <Check size={11} />
      {saveState.href ? (
        <Link href={saveState.href} style={{ color: "#22c55e", textDecoration: "none", fontWeight: 700 }}>
          {saveState.message}
        </Link>
      ) : saveState.message}
    </div>
  );
}

function BrowserProofAttachmentList({ attachments }: { attachments: RunTraceProofAttachment[] }) {
  return (
    <div style={{
      marginTop: 10,
      padding: "9px 10px",
      borderRadius: 6,
      background: "rgba(96,165,250,0.055)",
      border: "0.5px solid rgba(96,165,250,0.18)",
      display: "grid",
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <FileText size={11} style={{ color: "#93c5fd" }} />
        <span style={{ fontSize: 11, color: A.text, fontWeight: 650 }}>Browser proof attachments</span>
        <span style={{ fontSize: 9, color: A.muted, marginLeft: "auto" }}>
          {attachments.length} proof{attachments.length === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{ display: "grid", gap: 7 }}>
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            id={`browser-proof-${attachment.id}`}
            style={{
              display: "grid",
              gap: 6,
              minWidth: 0,
              padding: "7px 8px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.025)",
              border: "0.5px solid rgba(255,255,255,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
              <span style={{ color: A.text, fontSize: 12, fontWeight: 650 }}>
                {attachment.taskKey ?? "Browser proof"}
              </span>
              <span style={{
                borderRadius: 999,
                border: `0.5px solid ${attachment.status === "succeeded" ? "rgba(34,197,94,0.25)" : "rgba(248,113,113,0.25)"}`,
                background: attachment.status === "succeeded" ? "rgba(34,197,94,0.08)" : "rgba(248,113,113,0.08)",
                color: attachment.status === "succeeded" ? "#22c55e" : "#f87171",
                fontSize: 9,
                padding: "1px 6px",
                fontWeight: 700,
              }}>
                {attachment.status}
              </span>
              <span style={{ color: A.muted, fontSize: 10 }}>
                {attachment.screenshotCount} screenshots · {attachment.videoCount} videos · {attachment.artifactCount} files
              </span>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <TelemetryChip label="exit" value={String(attachment.exitCode)} />
              <TelemetryChip label="duration" value={formatDuration(attachment.durationMs)} />
              <TelemetryChip label="project" value={attachment.project} />
            </div>

            <a
              href={attachment.manifest.uri}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#93c5fd", fontSize: 11, textDecoration: "none", fontWeight: 650, width: "fit-content" }}
            >
              Open manifest
            </a>

            {attachment.artifacts && attachment.artifacts.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {attachment.artifacts.map((artifact) => (
                  <a
                    key={`${attachment.id}:${artifact.path}`}
                    href={artifact.uri}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      maxWidth: "100%",
                      borderRadius: 999,
                      border: "0.5px solid rgba(147,197,253,0.22)",
                      background: "rgba(147,197,253,0.06)",
                      color: "#bfdbfe",
                      padding: "3px 7px",
                      fontSize: 10,
                      textDecoration: "none",
                      fontWeight: 650,
                    }}
                  >
                    <span style={{ color: A.muted }}>{artifact.kind}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{artifact.label}</span>
                  </a>
                ))}
              </div>
            ) : null}

            <div style={{ color: A.muted, fontSize: 10, fontFamily: "monospace", lineHeight: 1.4, wordBreak: "break-all" }}>
              {attachment.manifest.path}
            </div>
            <div style={{ color: A.muted, fontSize: 10, fontFamily: "monospace", lineHeight: 1.4, wordBreak: "break-all" }}>
              sha256 {attachment.manifest.sha256}
            </div>
            <div style={{ color: A.textSec, fontSize: 10, fontFamily: "monospace", lineHeight: 1.4, wordBreak: "break-word" }}>
              {attachment.command}
            </div>
            {attachment.taskArtifact && (
              <div style={{ color: A.muted, fontSize: 10, lineHeight: 1.4 }}>
                Registered task artifact · {attachment.taskArtifact.kind ?? "file"} · {attachment.taskArtifact.registeredAt ?? "timestamp unavailable"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ExperimentReportEvidenceList({ reports }: { reports: OrchestrationExperimentReportEvidence[] }) {
  return (
    <div style={{
      marginTop: 10,
      padding: "9px 10px",
      borderRadius: 6,
      background: "rgba(245,158,11,0.055)",
      border: "0.5px solid rgba(245,158,11,0.18)",
      display: "grid",
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <FileText size={11} style={{ color: A.accentLight }} />
        <span style={{ fontSize: 11, color: A.text, fontWeight: 650 }}>Experiment evidence</span>
        <span style={{ fontSize: 9, color: A.muted, marginLeft: "auto" }}>
          {reports.length} report{reports.length === 1 ? "" : "s"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 7 }}>
        {reports.map((report) => (
          <a
            key={report.id}
            id={`experiment-report-${report.id}`}
            href={report.href}
            style={{
              display: "grid",
              gap: 3,
              textDecoration: "none",
              color: A.textSec,
              minWidth: 0,
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
              <span style={{ color: A.text, fontSize: 12, fontWeight: 650 }}>
                {report.title}
              </span>
              <span style={{
                borderRadius: 999,
                border: "0.5px solid rgba(245,158,11,0.25)",
                background: "rgba(245,158,11,0.08)",
                color: A.accentLight,
                fontSize: 9,
                padding: "1px 6px",
                fontWeight: 700,
              }}>
                {report.status}
              </span>
              {report.winningVariantName ? (
                <span style={{ color: A.muted, fontSize: 10 }}>
                  winner: {report.winningVariantName}
                </span>
              ) : null}
            </span>
            <span style={{ color: A.textSec, fontSize: 11, lineHeight: 1.4 }}>
              {report.summary || report.objective}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

function RunTraceAnnotationStatus({ annotations }: { annotations: RunTraceViewModel["annotations"] }) {
  if (annotations.state !== "deferred") return null;

  return (
    <div style={{
      marginTop: 10,
      padding: "9px 10px",
      borderRadius: 6,
      background: "rgba(251,191,36,0.045)",
      border: "0.5px solid rgba(251,191,36,0.16)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Info size={11} style={{ color: "#fbbf24", flexShrink: 0 }} />
        <span style={{ fontSize: 11, color: A.text, fontWeight: 600 }}>Trace annotations deferred</span>
      </div>
      <div style={{ marginTop: 5, fontSize: 10, color: A.muted, lineHeight: 1.45 }}>
        {annotations.decision.reason}
      </div>
    </div>
  );
}

function TraceActionButton({
  icon: Icon,
  label,
  onClick,
  active,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: 28,
        padding: "5px 9px",
        borderRadius: 6,
        border: `0.5px solid ${active ? "rgba(34,197,94,0.28)" : "rgba(255,255,255,0.08)"}`,
        background: active ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.025)",
        color: active ? "#22c55e" : A.textSec,
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 600,
      }}
      title={label}
    >
      {active ? <Check size={12} /> : <Icon size={12} />}
      <span>{label}</span>
    </button>
  );
}

function IdPill({ label, value, onCopy, copied, copyKey }: {
  label: string; value: string; onCopy: (v: string, k: string) => void; copied: boolean; copyKey: string;
}) {
  return (
    <span
      onClick={() => onCopy(value, copyKey)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 4, cursor: "pointer",
        background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.06)",
        fontSize: 10, fontFamily: "monospace",
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      title={`Copy ${label}: ${value}`}
    >
      <span style={{ color: A.muted }}>{label}</span>
      <span style={{ color: A.textSec }}>{value.slice(0, 10)}</span>
      {copied
        ? <Check size={9} style={{ color: "#22c55e" }} />
        : <Copy size={9} style={{ color: A.muted, opacity: 0.5 }} />
      }
    </span>
  );
}

function CopyChip({ value, label, onCopy, copied, copyKey }: {
  value: string; label: string; onCopy: (v: string, k: string) => void; copied: boolean; copyKey: string;
}) {
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onCopy(value, copyKey); }}
      style={{
        display: "inline-flex", alignItems: "center", gap: 3,
        fontFamily: "monospace", fontSize: 10, padding: "1px 6px", borderRadius: 4,
        background: "rgba(255,255,255,0.06)", color: A.textSec,
        cursor: "pointer",
      }}
      title={`Copy: ${value}`}
    >
      {label}
      {copied ? <Check size={8} style={{ color: "#22c55e" }} /> : <Copy size={8} style={{ opacity: 0.4 }} />}
    </span>
  );
}

function MetaLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <span style={{ color: A.muted, width: 64, flexShrink: 0 }}>{label}</span>
      <span style={{ color: A.text, fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? 10 : 11 }}>{value}</span>
    </div>
  );
}

function DisclosureRow({ label, open, onToggle, children, style }: {
  label: string; open: boolean; onToggle: () => void; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <button
        onClick={onToggle}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          background: "none", border: "none", cursor: "pointer",
          padding: 0, fontSize: 10, color: A.muted,
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {label}
      </button>
      {open && children}
    </div>
  );
}

function formatOrchestrationModeLabel(engine?: string | null): string {
  if (engine === "symphony" || engine === "manual" || engine === "hiverunner") {
    return formatSharedOrchestrationModeLabel(engine);
  }
  return formatSharedOrchestrationModeLabel("hiverunner");
}

function formatConfigSourceLabel(source?: string | null): string | null {
  if (!source) return null;
  switch (source) {
    case "task":
      return "Task override";
    case "project":
      return "Project default";
    case "company":
      return "Company default";
    case "global":
      return "Global fallback";
    default:
      return source;
  }
}

function formatRuntimeProviderLabel(provider?: string | null): string | null {
  if (!provider) return null;
  switch (provider.toLowerCase()) {
    case "anthropic":
      return "Anthropic";
    case "codex":
      return "Codex";
    case "gemini":
      return "Gemini";
    case "hermes":
      return "Hermes";
    case "openclaw":
      return "OpenClaw";
    case "openai":
      return "OpenAI";
    case "symphony":
      return "Symphony";
    default:
      return provider;
  }
}

function inferModelSource(provider?: string | null, model?: string | null): string | null {
  const normalizedProvider = provider?.trim().toLowerCase() ?? "";
  const normalizedModel = model?.trim().toLowerCase() ?? "";
  if (normalizedModel.includes("anthropic") || normalizedModel.includes("claude")) return "Anthropic";
  if (normalizedModel.includes("google") || normalizedModel.includes("gemini")) return "Google";
  if (normalizedModel.startsWith("gpt-") || normalizedModel.includes("openai")) return "OpenAI";
  if (normalizedProvider === "anthropic" || normalizedProvider === "claude") return "Anthropic";
  if (normalizedProvider === "gemini" || normalizedProvider === "google") return "Google";
  if (normalizedProvider === "codex" || normalizedProvider === "openai") return "OpenAI";
  if (normalizedProvider === "hermes") return "Runtime managed";
  if (normalizedProvider === "openclaw") return "OpenClaw managed";
  return null;
}

function runtimeForResolvedContext(context: ResolvedExecutionContext): string | null {
  return formatRuntimeProviderLabel(context.runnerProvider) ??
    formatRuntimeProviderLabel(context.provider) ??
    context.runtimeDisplayName ??
    context.runtimeSlug ??
    null;
}

function modelForResolvedContext(context: ResolvedExecutionContext): string | null {
  return context.runnerModel ?? context.model ?? null;
}

function stackForResolvedContext(context: ResolvedExecutionContext): Array<{ label: string; value: string; muted?: boolean }> {
  const runtime = runtimeForResolvedContext(context);
  const model = modelForResolvedContext(context);
  const source = inferModelSource(context.runnerProvider ?? context.provider, model);
  const rows = [
    { label: "Orchestration mode", value: formatOrchestrationModeLabel(context.executionEngine) },
    { label: "Runtime", value: runtime ?? (context.executionEngine === "manual" ? "No autonomous runtime" : "Runtime managed"), muted: !runtime },
    { label: "Model source", value: source ?? (model ? "Runtime managed" : "Not selected yet"), muted: !source },
    { label: "Model", value: model ?? (context.executionEngine === "manual" ? "None" : "Runtime managed"), muted: !model },
  ];
  if (context.modelLane) rows.push({ label: "Model routing", value: context.modelLane });
  return rows;
}

function FactField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      padding: "8px 10px",
      borderRadius: 6,
      background: "rgba(255,255,255,0.02)",
      border: "0.5px solid rgba(255,255,255,0.05)",
      minWidth: 0,
    }}>
      <div style={{ fontSize: 10, color: A.muted, marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: mono ? 11 : 12,
        color: A.text,
        lineHeight: 1.45,
        fontFamily: mono ? "monospace" : "inherit",
        overflowWrap: "anywhere",
      }}>
        {value}
      </div>
    </div>
  );
}

function ResolvedExecutionFacts({ title, context }: { title: string; context: ResolvedExecutionContext }) {
  const rows = [
    { label: "Setting source", value: formatConfigSourceLabel(context.configSource) },
    { label: "Runtime record", value: context.runtimeDisplayName ?? context.runtimeSlug },
    { label: "Workspace", value: context.workspaceRoot, mono: true },
    { label: "Source workspace", value: context.sourceWorkspaceRoot, mono: true },
    { label: "Company workspace", value: context.companyWorkspaceRoot, mono: true },
    { label: "Sandbox", value: context.sandbox },
    { label: "Command", value: context.command, mono: true },
  ].filter((row): row is { label: string; value: string; mono?: boolean } => typeof row.value === "string" && row.value.length > 0);

  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 11, color: A.muted }}>
        {title}: no resolved execution metadata recorded.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: A.muted, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        {title}
      </div>
      <ExecutionStackPath context={context} />
      {context.executionEngine === "manual" && (
        <div style={{
          marginTop: 8,
          padding: "8px 10px",
          borderRadius: 6,
          background: "rgba(255,255,255,0.02)",
          border: "0.5px solid rgba(255,255,255,0.05)",
          color: A.muted,
          fontSize: 11,
          lineHeight: 1.45,
        }}>
          Manual / Operator Controlled: no autonomous runtime will run this task.
        </div>
      )}
      <div style={factsGridStyle}>
        {rows.map((row) => (
          <FactField key={`${title}:${row.label}`} label={row.label} value={row.value} mono={row.mono} />
        ))}
      </div>
    </div>
  );
}

function ExecutionStackPath({ context }: { context: ResolvedExecutionContext }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      gap: 8,
      marginBottom: 10,
    }}>
      {stackForResolvedContext(context).map((row, index) => (
        <div
          key={`${row.label}:${index}`}
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            background: row.label === "Orchestration mode" && context.executionEngine === "symphony" ? "var(--accent-soft)" : "rgba(255,255,255,0.02)",
            border: `0.5px solid ${row.label === "Orchestration mode" && context.executionEngine === "symphony" ? "var(--accent)" : "rgba(255,255,255,0.06)"}`,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 9, color: A.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
            {row.label}
          </div>
          <div
            title={row.value}
            style={{
              fontSize: 12,
              color: row.muted ? A.muted : row.label === "Orchestration mode" && context.executionEngine === "symphony" ? "var(--accent)" : A.text,
              fontWeight: row.label === "Orchestration mode" ? 700 : 600,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function LongTextBlock({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      marginTop: 10,
      padding: "10px 12px",
      borderRadius: 6,
      background: "rgba(255,255,255,0.02)",
      border: "0.5px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ fontSize: 10, color: A.muted, marginBottom: 6 }}>{label}</div>
      <div style={{
        fontSize: 12,
        color: A.text,
        lineHeight: 1.55,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: mono ? "monospace" : "inherit",
      }}>
        {value}
      </div>
    </div>
  );
}

/* CapabilityRow now imported from @/components/orchestration/ProviderPresentation */

function ResultChip({ label, value, warn, muted }: { label: string; value: number; warn?: boolean; muted?: boolean }) {
  const color = warn ? "#f87171" : muted ? A.muted : A.text;
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 5,
      padding: "6px 10px", borderRadius: 6,
      background: warn ? "rgba(248,113,113,0.06)" : "rgba(255,255,255,0.02)",
      border: `0.5px solid ${warn ? "rgba(248,113,113,0.15)" : "rgba(255,255,255,0.05)"}`,
    }}>
      <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 10, color: A.muted }}>{label}</span>
    </div>
  );
}

function BooleanChip({ label, value }: { label: string; value: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 8px",
      borderRadius: 999,
      fontSize: 10,
      color: value ? "#22c55e" : A.muted,
      background: value ? "rgba(34,197,94,0.12)" : "rgba(120,113,108,0.14)",
      border: `0.5px solid ${value ? "rgba(34,197,94,0.25)" : "rgba(120,113,108,0.2)"}`,
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: value ? "#22c55e" : "rgba(120,113,108,0.5)",
      }} />
      {label}
    </span>
  );
}

function skillEventLabel(event: RunSkillEffectivenessEvent): string {
  if (event.eventType === "available") return "Available";
  if (event.eventType === "explicit_use") return "Used";
  if (event.eventType === "review_outcome") {
    return event.outcome ? `Review ${event.outcome}` : "Review outcome";
  }
  return event.eventType;
}

function skillEventTone(event: RunSkillEffectivenessEvent): { color: string; bg: string; border: string } {
  if (event.eventType === "explicit_use") {
    return { color: "#60a5fa", bg: "rgba(96,165,250,0.1)", border: "rgba(96,165,250,0.22)" };
  }
  if (event.eventType === "review_outcome" && event.outcome === "pass") {
    return { color: "#22c55e", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.22)" };
  }
  if (event.eventType === "review_outcome") {
    return { color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.22)" };
  }
  return { color: A.textSec, bg: "rgba(120,113,108,0.14)", border: "rgba(120,113,108,0.2)" };
}

function SkillEffectivenessCard({ skillEffectiveness }: { skillEffectiveness: RunSkillEffectiveness }) {
  const issueCount = skillEffectiveness.totals.failCount + skillEffectiveness.totals.blockedCount;
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <ListChecks size={12} style={{ color: A.textSec }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Runtime skills</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <TelemetryChip label="available" value={String(skillEffectiveness.totals.availableCount)} />
        <TelemetryChip label="used" value={String(skillEffectiveness.totals.explicitUseCount)} />
        <TelemetryChip label="passed" value={String(skillEffectiveness.totals.passCount)} />
        {issueCount > 0 && <TelemetryChip label="needs work" value={String(issueCount)} />}
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {skillEffectiveness.events.map((event) => {
          const tone = skillEventTone(event);
          return (
            <div
              key={event.id}
              style={{
                padding: "9px 10px",
                borderRadius: 6,
                background: "rgba(255,255,255,0.018)",
                border: "0.5px solid rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 9,
                    padding: "1px 6px",
                    borderRadius: 999,
                    color: tone.color,
                    background: tone.bg,
                    border: `0.5px solid ${tone.border}`,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {skillEventLabel(event)}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: A.text, fontWeight: 600 }}>
                  {event.skillName}
                </span>
                {event.skillVersion !== null && (
                  <span style={{ fontSize: 10, color: A.muted }}>v{event.skillVersion}</span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 10, color: A.muted }}>
                  {new Date(event.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              {event.note && (
                <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, color: A.textSec }}>
                  {event.note}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TelemetryChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 5,
      padding: "4px 8px", borderRadius: 5,
      background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.05)",
    }}>
      <span style={{ fontSize: 11, color: A.text, fontFamily: "monospace" }}>{value}</span>
      <span style={{ fontSize: 10, color: A.muted }}>{label}</span>
    </div>
  );
}

function ProvenanceNote({ text }: { text: string }) {
  return (
    <div style={{
      marginTop: 10, padding: "6px 10px", borderRadius: 5,
      background: "rgba(255,255,255,0.015)",
      fontSize: 10, color: A.muted, lineHeight: 1.5,
      display: "flex", gap: 6, alignItems: "flex-start",
      fontStyle: "italic", opacity: 0.7,
    }}>
      <Info size={11} style={{ flexShrink: 0, marginTop: 1 }} />
      {text}
    </div>
  );
}

/* ── Helpers ── */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatUsd(value: number): string {
  return value > 0 ? `$${value.toFixed(4)}` : "$0.0000";
}

function formatCharCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k chars` : `${value} chars`;
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function formatRedactionCategory(value: string): string {
  return value.replace(/_/g, " ");
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";
}

function formatInvocationSource(source: string): string {
  const labels: Record<string, string> = {
    timer: "Scheduled",
    wakeup_request: "Wakeup",
    issue_assigned: "Task assigned",
    kickoff: "Kickoff",
    openclaw: "OpenClaw",
  };
  return labels[source] ?? source;
}

function formatWorkspaceChange(change: WorkspaceRunVisibilityRoot["changedDuringRun"][number]): string {
  if (change.changeType === "added") return `new ${change.after ?? ""}`.trim();
  if (change.changeType === "removed") return `gone ${change.before ?? ""}`.trim();
  return `${change.before ?? "--"} -> ${change.after ?? "--"}`;
}

function formatProviderDisplayName(providerId: string, displayName: string): string {
  if (providerId === "openclaw" || providerId === "openclaw-heartbeat") return "OpenClaw";
  return displayName;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "(metadata could not be serialized)";
  }
}

const cardStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 8,
  background: A.card,
  border: `0.5px solid ${A.cardBorder}`,
};

const factsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 8,
};
