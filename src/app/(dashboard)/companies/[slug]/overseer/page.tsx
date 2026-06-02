"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useParams } from "next/navigation";
import { Asterisk, Bot, Check, CheckCircle2, ChevronDown, CircleAlert, Copy, File, Image as ImageIcon, Loader2, Pencil, Plus, Search, Sparkles, Square, Terminal, Wrench, X, Zap } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { listCompanies } from "@/lib/orchestration/client";
import { PageBreadcrumbs } from "@/components/PageBreadcrumbs";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { Badge, PageHeader, Section } from "@/lib/ui/primitives";
import { color, P, radius, space, type as T } from "@/lib/ui/tokens";

type SessionStatus = "idle" | "running" | "completed" | "failed" | "cancelled" | "approval_required";
type OverseerRuntimeProvider = "anthropic" | "codex" | "gemini";
type CompactionMode = "ask" | "auto" | "manual";

type SessionCompactionSettings = {
  mode: CompactionMode;
  thresholdPercent: number | null;
  status: "idle" | "requested" | "running" | "failed";
  hasMemorySummary: boolean;
  summaryUpdatedAt: string | null;
  summaryTokenEstimate: number | null;
  manualRequestedAt: string | null;
};

type OverseerSession = {
  id: string;
  title: string;
  status: SessionStatus;
  codexSessionId: string | null;
  workspaceRoot: string;
  model: string | null;
  reasoningEffort: string | null;
  scope?: {
    fastMode?: boolean;
    overseerProvider?: OverseerRuntimeProvider;
    compaction?: Partial<SessionCompactionSettings>;
    [key: string]: unknown;
  };
  compaction?: {
    policy?: CompactionMode;
    contextThreshold?: number;
    latestSummary?: string | null;
    compactedAt?: string | null;
    compactedBy?: string | null;
    metadata?: Record<string, unknown>;
  };
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    turnCount?: number;
  };
  quota: {
    status: "available" | "unavailable";
    reason?: string;
    updatedAt?: string;
    buckets?: Array<{
      label: string;
      usedPercent?: number;
      resetsAt?: string;
      windowDurationMins?: number;
    }>;
  };
  lastError: string | null;
  updatedAt: string;
  messageCount?: number;
};

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt?: string;
};

type OverseerMessage = {
  id: string;
  sessionId?: string;
  turnId: string | null;
  role: "user" | "assistant" | "system" | "tool" | "approval";
  content: string;
  metadata: Record<string, unknown>;
  sequence: number;
  createdAt: string;
};

type AssistantReveal = {
  messageId: string;
  fullText: string;
  visibleText: string;
};

type ModelOption = {
  id: string;
  label: string;
  detail: string;
  contextTokens: number | null;
  supportsFastMode?: boolean;
};

const MODEL_OPTIONS: ModelOption[] = [
  { id: "gpt-5.5", label: "GPT-5.5", detail: "Max · Deep", contextTokens: null },
  { id: "gpt-5.4", label: "GPT-5.4", detail: "Balanced", contextTokens: null },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", detail: "Fast", contextTokens: null },
  { id: "gpt-5.3-codex", label: "GPT-5.3-Codex", detail: "Code", contextTokens: null },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark", detail: "Spark", contextTokens: null },
  { id: "gpt-5.2", label: "GPT-5.2", detail: "Legacy", contextTokens: null },
];

const REASONING_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
] as const;

const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_REASONING = "xhigh";
const DEFAULT_OVERSEER_PROVIDER: OverseerRuntimeProvider = "codex";
const DEFAULT_SESSIONS_COLUMN_WIDTH = 225;
const MIN_SESSIONS_COLUMN_WIDTH = 160;
const MAX_SESSIONS_COLUMN_WIDTH = 360;
const ACTIVITY_MUTED = "color-mix(in srgb, var(--text-muted) 62%, var(--surface) 38%)";
type ReasoningEffort = typeof REASONING_OPTIONS[number]["value"];

const OVERSEER_PROVIDER_OPTIONS: Array<{
  value: OverseerRuntimeProvider;
  label: string;
  detail: string;
}> = [
  { value: "anthropic", label: "Claude", detail: "Claude Code CLI" },
  { value: "codex", label: "Codex", detail: "Codex CLI" },
  { value: "gemini", label: "Gemini", detail: "Gemini CLI" },
];

type OverseerEvent = {
  id: string;
  sessionId: string;
  turnId: string | null;
  eventType: string;
  event: Record<string, unknown>;
  sequence: number;
  occurredAt: string;
  createdAt: string;
};

type OverseerReadiness = {
  ready: boolean;
  codex: {
    installed: boolean;
    authReady: boolean;
    authMode: string;
    version: string | null;
    loginStatus: string;
  };
  workspace: {
    root: string | null;
    writable: boolean;
    source: string;
  };
  quota: {
    status: "available" | "unavailable";
    reason?: string;
  };
  modelCatalog?: Array<{
    slug: string;
    displayName: string;
    contextWindow: number | null;
    maxContextWindow: number | null;
    effectiveContextWindowPercent: number | null;
    additionalSpeedTiers: string[];
  }>;
};

type CodexSessionTelemetry = {
  sessionId: string;
  source: "codex_session_file";
  updatedAt: string;
  context: {
    usedTokens: number | null;
    limitTokens: number | null;
    totalTokens: number | null;
    cumulativeTotalTokens: number | null;
  };
  quota: OverseerSession["quota"];
};

type ContinuityProof = {
  status: "verified" | "stale" | "incomplete";
  sourceRowCounts: {
    turns: number;
    messages: number;
    events: number;
    snapshots: number;
    approvals: number;
    attachmentManifest: number;
    costEvents: number;
  };
  hashes: {
    messagesSha256?: string;
    eventsSha256?: string;
    snapshotsSha256?: string;
    approvalsSha256?: string;
    attachmentManifestSha256?: string;
    usageSha256?: string;
  };
  snapshotVersions: Array<{
    id: string;
    version: number | null;
    summaryHash: string | null;
    createdAt: string | null;
  }>;
  latestSnapshotVersion: number | null;
  latestCompactionApprovalId: string | null;
  latestCompaction: {
    compactedAt: string | null;
    compactedBy: string | null;
    snapshotId: string | null;
    snapshotVersion: number | null;
    snapshotSummaryHash: string | null;
  };
};

function formatNumber(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "0";
  return Intl.NumberFormat().format(value);
}

function formatElapsed(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "0s";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function eventTimeMs(event: OverseerEvent): number | null {
  const time = new Date(event.occurredAt).getTime();
  return Number.isFinite(time) ? time : null;
}

function commandLabel(command: unknown): string {
  if (Array.isArray(command)) return command.map((part) => String(part)).join(" ");
  return stringValue(command) || "terminal command";
}

function itemFromEvent(event: OverseerEvent): Record<string, unknown> | null {
  return asRecord(event.event.item);
}

function modelOption(model: string | null | undefined, catalog?: OverseerReadiness["modelCatalog"]): ModelOption {
  const base = MODEL_OPTIONS.find((option) => option.id === model) ?? MODEL_OPTIONS[0];
  const catalogEntry = catalog?.find((entry) => entry.slug === base.id);
  if (!catalogEntry) return base;
  const effectiveContextWindow = catalogEntry.contextWindow && catalogEntry.effectiveContextWindowPercent
    ? Math.round(catalogEntry.contextWindow * (catalogEntry.effectiveContextWindowPercent / 100))
    : catalogEntry.contextWindow;
  return {
    ...base,
    label: catalogEntry.displayName || base.label,
    contextTokens: effectiveContextWindow,
    supportsFastMode: catalogEntry.additionalSpeedTiers.includes("fast"),
  };
}

function reasoningLabel(value: string | null | undefined): string {
  return REASONING_OPTIONS.find((option) => option.value === value)?.label ?? "Extra High";
}

function displayModelLabel(option: ModelOption): string {
  return option.label.replace(/^GPT-/, "GPT ");
}

function normalizeOverseerProvider(value: unknown): OverseerRuntimeProvider {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "claude" || normalized === "claude-code" || normalized === "anthropic") return "anthropic";
  if (normalized === "gemini" || normalized === "google" || normalized === "gemini-cli") return "gemini";
  return "codex";
}

function providerLabel(provider: OverseerRuntimeProvider): string {
  return OVERSEER_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? "Codex";
}

function providerAccent(provider: OverseerRuntimeProvider): string {
  if (provider === "anthropic") return "#e87952";
  if (provider === "gemini") return "#8ab4f8";
  return "#10a37f";
}

function normalizeCompactionMode(value: unknown): CompactionMode {
  return value === "auto" || value === "manual" || value === "ask" ? value : "ask";
}

function normalizeCompactionSettings(session: OverseerSession | null | undefined): SessionCompactionSettings {
  const scoped = asRecord(session?.scope?.compaction);
  const state = session?.compaction;
  const thresholdSource = typeof scoped?.thresholdPercent === "number" && Number.isFinite(scoped.thresholdPercent)
    ? scoped.thresholdPercent
    : state?.contextThreshold;
  const threshold = typeof thresholdSource === "number" && Number.isFinite(thresholdSource)
    ? Math.max(50, Math.min(95, Math.round(thresholdSource)))
    : null;
  const summaryUpdatedAt = stringValue(state?.compactedAt) || stringValue(scoped?.summaryUpdatedAt) || null;
  return {
    mode: normalizeCompactionMode(scoped?.mode ?? state?.policy),
    thresholdPercent: threshold,
    status: scoped?.status === "requested" || scoped?.status === "running" || scoped?.status === "failed" ? scoped.status : "idle",
    hasMemorySummary: Boolean(state?.latestSummary) || scoped?.hasMemorySummary === true || Boolean(summaryUpdatedAt),
    summaryUpdatedAt,
    summaryTokenEstimate: typeof scoped?.summaryTokenEstimate === "number" && Number.isFinite(scoped.summaryTokenEstimate)
      ? Math.max(0, Math.round(scoped.summaryTokenEstimate))
      : null,
    manualRequestedAt: stringValue(scoped?.manualRequestedAt) || null,
  };
}

function compactionSummaryLabel(compaction: SessionCompactionSettings): string {
  if (!compaction.hasMemorySummary) return "No compacted memory summary";
  if (!compaction.summaryUpdatedAt) return "Compacted memory summary available";
  const date = new Date(compaction.summaryUpdatedAt);
  if (!Number.isFinite(date.getTime())) return "Compacted memory summary available";
  return `Compacted ${date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

function runtimeProviderFromEvents(events: OverseerEvent[], fallback: OverseerRuntimeProvider): OverseerRuntimeProvider {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const eventProvider = normalizeOverseerProvider(event.event.provider ?? event.event.runtimeProvider);
    if (event.event.provider || event.event.runtimeProvider) return eventProvider;
    if (/^(claude|anthropic)\./i.test(event.eventType)) return "anthropic";
    if (/^gemini\./i.test(event.eventType)) return "gemini";
    if (/^codex\./i.test(event.eventType)) return "codex";
  }
  return fallback;
}

function ProviderRunMark({
  provider,
  active = false,
  size = 18,
  title,
  tone = "brand",
}: {
  provider: OverseerRuntimeProvider;
  active?: boolean;
  size?: number;
  title?: string;
  tone?: "brand" | "muted";
}) {
  const accent = tone === "muted" ? ACTIVITY_MUTED : providerAccent(provider);
  const className = `overseer-provider-mark provider-${provider}${active ? " is-active" : ""}`;
  const icon = provider === "anthropic"
    ? <Asterisk size={size} strokeWidth={2.25} />
    : provider === "gemini"
      ? <Sparkles size={size} strokeWidth={2.2} />
      : (
          <OpenAIMark size={size + 2} />
        );
  return (
    <span
      className={className}
      title={title ?? providerLabel(provider)}
      aria-label={title ?? providerLabel(provider)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 8,
        height: size + 8,
        color: accent,
        flex: "0 0 auto",
      }}
    >
      {icon}
    </span>
  );
}

function OpenAIMark({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 320 320"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      <path
        fill="currentColor"
        d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"
      />
    </svg>
  );
}

function displaySessionTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  if (!trimmed) return null;
  if (/^(manual api smoke|overseer session)$/i.test(trimmed)) return "Orchestration Chat";
  return trimmed;
}

function clampSessionsColumnWidth(value: number): number {
  return Math.max(MIN_SESSIONS_COLUMN_WIDTH, Math.min(MAX_SESSIONS_COLUMN_WIDTH, Math.round(value)));
}

function firstEventNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function contextTelemetryFromEvent(event: OverseerEvent): { usedTokens?: number; limitTokens?: number } {
  const record = event.event;
  const eventType = stringValue(record.type) || event.eventType;
  const hasContextSignal = /token_count/i.test(eventType)
    || record.total_token_usage !== undefined
    || record.totalTokenUsage !== undefined
    || record.model_context_window !== undefined
    || record.modelContextWindow !== undefined
    || record.context_window !== undefined
    || record.contextWindow !== undefined;
  if (!hasContextSignal) return {};
  const usedTokens = firstEventNumber(record, ["total_token_usage", "totalTokenUsage", "context_tokens", "contextTokens"]);
  const limitTokens = firstEventNumber(record, ["model_context_window", "modelContextWindow", "context_window", "contextWindow", "max_context_window", "maxContextWindow"]);
  return { usedTokens, limitTokens };
}

function resolveContextTelemetry(
  codexTelemetry: CodexSessionTelemetry | null,
  _session: OverseerSession | null,
  events: OverseerEvent[],
  model: ModelOption,
): { usedTokens: number | null; limitTokens: number | null } {
  if (codexTelemetry?.context) {
    return {
      usedTokens: codexTelemetry.context.usedTokens,
      limitTokens: codexTelemetry.context.limitTokens ?? model.contextTokens,
    };
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const telemetry = contextTelemetryFromEvent(events[index]);
    if (telemetry.usedTokens !== undefined || telemetry.limitTokens !== undefined) {
      return {
        usedTokens: telemetry.usedTokens ?? null,
        limitTokens: telemetry.limitTokens ?? model.contextTokens,
      };
    }
  }
  return {
    usedTokens: null,
    limitTokens: model.contextTokens,
  };
}

function attachmentsFromMetadata(metadata: Record<string, unknown>): ComposerAttachment[] {
  const raw = metadata.attachments;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    const id = stringValue(record.id);
    const name = stringValue(record.name);
    const pathValue = stringValue(record.path);
    if (!id || !name || !pathValue) return [];
    return [{
      id,
      name,
      path: pathValue,
      mimeType: stringValue(record.mimeType) || "application/octet-stream",
      size: typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0,
      uploadedAt: stringValue(record.uploadedAt) || undefined,
    }];
  });
}

export default function CompanyOverseerPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [, setCompany] = useState<OrchestrationCompany | null>(null);
  const [readiness, setReadiness] = useState<OverseerReadiness | null>(null);
  const [sessions, setSessions] = useState<OverseerSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OverseerMessage[]>([]);
  const [events, setEvents] = useState<OverseerEvent[]>([]);
  const [codexTelemetry, setCodexTelemetry] = useState<CodexSessionTelemetry | null>(null);
  const [continuityProof, setContinuityProof] = useState<ContinuityProof | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [creating, setCreating] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [optimisticRunStartedAtMs, setOptimisticRunStartedAtMs] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [updatingModel, setUpdatingModel] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState("");
  const [newSessionProvider, setNewSessionProvider] = useState<OverseerRuntimeProvider>(DEFAULT_OVERSEER_PROVIDER);
  const [sessionsColumnWidth, setSessionsColumnWidth] = useState(DEFAULT_SESSIONS_COLUMN_WIDTH);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [assistantReveal, setAssistantReveal] = useState<AssistantReveal | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const chatAutoStickRef = useRef(true);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null,
    [activeSessionId, sessions],
  );
  const eventsByTurn = useMemo(() => {
    const grouped = new Map<string, OverseerEvent[]>();
    for (const event of events) {
      if (!event.turnId) continue;
      const current = grouped.get(event.turnId) ?? [];
      current.push(event);
      grouped.set(event.turnId, current);
    }
    return grouped;
  }, [events]);
  const activeTurnId = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i]?.turnId) return events[i].turnId;
    }
    return null;
  }, [events]);
  const activeTurnEvents = activeTurnId ? eventsByTurn.get(activeTurnId) ?? [] : [];
  const activeTurnHasAssistant = Boolean(activeTurnId && messages.some((message) => message.turnId === activeTurnId && message.role === "assistant"));
  const showLiveActivity = Boolean((sending || activeSession?.status === "running") && !activeTurnHasAssistant);
  const runActive = sending || activeSession?.status === "running";
  const activeModel = modelOption(activeSession?.model ?? DEFAULT_MODEL, readiness?.modelCatalog).id;
  const activeReasoning = REASONING_OPTIONS.some((option) => option.value === activeSession?.reasoningEffort)
    ? activeSession?.reasoningEffort ?? DEFAULT_REASONING
    : DEFAULT_REASONING;
  const activeFastMode = Boolean(activeSession?.scope?.fastMode);
  const activeProvider = normalizeOverseerProvider(activeSession?.scope?.overseerProvider ?? DEFAULT_OVERSEER_PROVIDER);
  const activeCompaction = normalizeCompactionSettings(activeSession);
  const activeProviderLocked = Boolean(activeSession && ((activeSession.messageCount ?? messages.length) > 0 || activeSession.codexSessionId));
  const currentModel = modelOption(activeModel, readiness?.modelCatalog);
  const contextTelemetry = useMemo(
    () => resolveContextTelemetry(codexTelemetry, activeSession, events, currentModel),
    [codexTelemetry, activeSession, events, currentModel],
  );
  const contextTokens = contextTelemetry.usedTokens;
  const contextLimit = contextTelemetry.limitTokens;
  const contextPercent = contextTokens !== null && contextLimit
    ? Math.max(0, Math.min(100, Math.round((contextTokens / contextLimit) * 100)))
    : null;
  const visibleQuota = codexTelemetry?.quota.status === "available"
    ? codexTelemetry.quota
    : activeSession?.quota ?? readiness?.quota ?? { status: "unavailable" as const, reason: "No session quota telemetry yet." };
  const latestCompletedProvider = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant" || !message.turnId) continue;
      const turnEvents = eventsByTurn.get(message.turnId) ?? [];
      return runtimeProviderFromEvents(turnEvents, activeProvider);
    }
    return activeProvider;
  }, [messages, eventsByTurn, activeProvider]);
  const hasAssistantMessage = messages.some((message) => message.role === "assistant");

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
  }, []);

  const handleChatScroll = useCallback(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    chatAutoStickRef.current = distanceFromBottom < 96;
  }, []);

  const copyRunHandoff = useCallback(async (assistantMessage: OverseerMessage, userMessage: OverseerMessage | null, turnEvents: OverseerEvent[], provider: OverseerRuntimeProvider) => {
    const handoff = buildRunHandoffText({
      sessionTitle: displaySessionTitle(activeSession?.title) ?? "Orchestration Chat",
      provider,
      model: activeSession?.model ?? DEFAULT_MODEL,
      reasoning: activeSession?.reasoningEffort ?? DEFAULT_REASONING,
      userMessage,
      assistantMessage,
      events: turnEvents,
    });
    await writeClipboardText(handoff);
    setCopiedRunId(assistantMessage.id);
    window.setTimeout(() => {
      setCopiedRunId((current) => current === assistantMessage.id ? null : current);
    }, 1600);
  }, [activeSession?.model, activeSession?.reasoningEffort, activeSession?.title]);

  const revealAssistantMessage = useCallback((message: OverseerMessage | null | undefined) => {
    if (!message || message.role !== "assistant") return;
    if (message.content.trim().length < 80) return;
    setAssistantReveal({
      messageId: message.id,
      fullText: message.content,
      visibleText: "",
    });
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions`);
    if (!response.ok) throw new Error("Could not load Overseer sessions.");
    const body = await response.json() as { sessions: OverseerSession[] };
    setSessions(body.sessions);
    return body.sessions;
  }, [slug]);

  const loadDetail = useCallback(async (sessionId: string) => {
    const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions/${encodeURIComponent(sessionId)}`);
    if (!response.ok) throw new Error("Could not load Overseer transcript.");
    const body = await response.json() as {
      session: OverseerSession;
      messages: OverseerMessage[];
      events: OverseerEvent[];
      codexTelemetry?: CodexSessionTelemetry | null;
      continuityProof?: ContinuityProof | null;
    };
    setMessages(body.messages);
    setEvents(body.events ?? []);
    setCodexTelemetry(body.codexTelemetry ?? null);
    setContinuityProof(body.continuityProof ?? null);
    setSessions((current) => current.map((session) => session.id === body.session.id ? body.session : session));
  }, [slug]);

  useEffect(() => {
    if (!assistantReveal) return;
    if (assistantReveal.visibleText.length >= assistantReveal.fullText.length) return;
    const nextIndex = nextAssistantRevealIndex(assistantReveal.fullText, assistantReveal.visibleText.length);
    const nextText = assistantReveal.fullText.slice(0, nextIndex);
    const timer = window.setTimeout(() => {
      setAssistantReveal((current) => {
        if (!current || current.messageId !== assistantReveal.messageId) return current;
        return {
          ...current,
          visibleText: nextText,
        };
      });
    }, assistantRevealDelay(nextText));
    return () => window.clearTimeout(timer);
  }, [assistantReveal]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [companies, readinessResp, loadedSessions] = await Promise.all([
          listCompanies(),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/overseer`).then((response) => response.ok ? response.json() : null),
          loadSessions(),
        ]);
        if (cancelled) return;
        const normalized = slug.toLowerCase();
        setCompany(companies.find((entry) => entry.slug.toLowerCase() === normalized || entry.code.toLowerCase() === normalized) ?? null);
        setReadiness(readinessResp as OverseerReadiness | null);
        const first = loadedSessions[0];
        if (first) {
          setActiveSessionId(first.id);
          await loadDetail(first.id);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load Overseer.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, loadSessions, loadDetail]);

  useEffect(() => {
    if (!sending && activeSession?.status !== "running") return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeSession?.status, sending]);

  useEffect(() => {
    const sessionId = activeSession?.id;
    if (!sessionId || (!sending && activeSession?.status !== "running")) return;
    const refresh = () => {
      void loadDetail(sessionId).catch(() => {
        // Keep an in-flight chat usable even if one poll misses.
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => window.clearInterval(interval);
  }, [activeSession?.id, activeSession?.status, sending, loadDetail]);

  useEffect(() => {
    chatAutoStickRef.current = true;
    const frame = window.requestAnimationFrame(() => scrollChatToBottom("auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [activeSession?.id, scrollChatToBottom]);

  useEffect(() => {
    if (!chatAutoStickRef.current) return;
    const frame = window.requestAnimationFrame(() => scrollChatToBottom(showLiveActivity ? "smooth" : "auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, events.length, showLiveActivity, nowMs, assistantReveal?.visibleText.length, scrollChatToBottom]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(`hr:overseer:sessions-width:${slug}`);
      const parsed = stored ? Number(stored) : NaN;
      if (Number.isFinite(parsed)) setSessionsColumnWidth(clampSessionsColumnWidth(parsed));
    } catch {
      // Keep the default width when storage is unavailable.
    }
  }, [slug]);

  const beginColumnResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sessionsColumnWidth;
    let lastWidth = startWidth;
    const handlePointerMove = (moveEvent: MouseEvent) => {
      const nextWidth = clampSessionsColumnWidth(startWidth - (moveEvent.clientX - startX));
      lastWidth = nextWidth;
      setSessionsColumnWidth(nextWidth);
    };
    const handlePointerUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handlePointerMove);
      document.removeEventListener("mouseup", handlePointerUp);
      try {
        window.localStorage.setItem(`hr:overseer:sessions-width:${slug}`, String(lastWidth));
      } catch {
        // Width persistence is best effort.
      }
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handlePointerMove);
    document.addEventListener("mouseup", handlePointerUp);
  }, [sessionsColumnWidth, slug]);

  const createSession = async (title = "Orchestration Chat", provider: OverseerRuntimeProvider = DEFAULT_OVERSEER_PROVIDER): Promise<OverseerSession | null> => {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, provider }),
      });
      if (!response.ok) throw new Error("Could not create Overseer session.");
      const body = await response.json() as { session: OverseerSession; messages: OverseerMessage[] };
      setSessions((current) => [body.session, ...current]);
      setActiveSessionId(body.session.id);
      setMessages(body.messages);
      setEvents([]);
      setCodexTelemetry(null);
      setNewSessionOpen(false);
      setNewSessionTitle("");
      return body.session;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create session.");
      return null;
    } finally {
      setCreating(false);
    }
  };

  const ensureSession = async (title: string): Promise<OverseerSession | null> => {
    if (activeSession) return activeSession;
    return createSession(title, newSessionProvider);
  };

  const submitNewSession = async () => {
    const title = newSessionTitle.trim() || "Orchestration Chat";
    await createSession(title, newSessionProvider);
  };

  const patchActiveSession = async (patch: { model?: string | null; reasoningEffort?: "low" | "medium" | "high" | "xhigh" | null; fastMode?: boolean | null; provider?: OverseerRuntimeProvider | null; compaction?: Partial<SessionCompactionSettings> | null }) => {
    const session = await ensureSession("Orchestration Chat");
    if (!session) return;
    setUpdatingModel(true);
    setError(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => null) as { session?: OverseerSession; error?: { message?: string } } | null;
      if (!response.ok || !body?.session) {
        throw new Error(body?.error?.message ?? "Could not update Overseer session.");
      }
      setSessions((current) => current.map((entry) => entry.id === body.session?.id ? body.session : entry));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update session.");
    } finally {
      setUpdatingModel(false);
    }
  };

  const requestManualCompaction = async () => {
    await patchActiveSession({
      compaction: {
        ...activeCompaction,
        status: "requested",
        manualRequestedAt: new Date().toISOString(),
      },
    });
  };

  const patchCompactionSettings = async (compaction: Partial<SessionCompactionSettings>) => {
    const session = await ensureSession("Orchestration Chat");
    if (!session) return;
    setUpdatingModel(true);
    setError(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions/${encodeURIComponent(session.id)}/compaction`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy: compaction.mode,
          contextThreshold: compaction.thresholdPercent ?? undefined,
          actorUserId: "operator",
        }),
      });
      const body = await response.json().catch(() => null) as { session?: OverseerSession; error?: { message?: string } } | null;
      if (!response.ok || !body?.session) {
        throw new Error(body?.error?.message ?? "Could not update compaction.");
      }
      setSessions((current) => current.map((entry) => entry.id === body.session?.id ? body.session : entry));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update compaction.");
    } finally {
      setUpdatingModel(false);
    }
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const session = await ensureSession(draft.trim().slice(0, 80) || "Orchestration Chat");
    if (!session) return;
    setUploadingAttachments(true);
    setError(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions/${encodeURIComponent(session.id)}/attachments`, {
        method: "POST",
        body: form,
      });
      const body = await response.json().catch(() => null) as { attachments?: ComposerAttachment[]; error?: { message?: string } } | null;
      if (!response.ok || !body?.attachments) {
        throw new Error(body?.error?.message ?? "Could not upload attachment.");
      }
      setAttachments((current) => [...current, ...body.attachments!]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not upload attachment.");
    } finally {
      setUploadingAttachments(false);
      setDraggingFiles(false);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const handleFileList = (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((file) => file.size > 0);
    if (files.length > 0) void uploadFiles(files);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    handleFileList(files);
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) handleFileList(files);
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || sending || uploadingAttachments || cancelling) return;
    const startedAt = Date.now();
    const outgoingAttachments = attachments;
    chatAutoStickRef.current = true;
    setSending(true);
    setNowMs(startedAt);
    setOptimisticRunStartedAtMs(startedAt);
    setError(null);
    try {
      let session: OverseerSession | null = activeSession;
      if (!session) {
        const createdSession = await createSession(content.slice(0, 80) || "Orchestration Chat", newSessionProvider);
        if (!createdSession) throw new Error("Could not create Overseer session.");
        session = createdSession;
      }
      setDraft("");
      setAttachments([]);
      const optimisticMessage: OverseerMessage = {
        id: `optimistic-${startedAt}`,
        sessionId: session.id,
        turnId: null,
        role: "user",
        content: content || `Attached ${outgoingAttachments.length} file${outgoingAttachments.length === 1 ? "" : "s"}.`,
        metadata: { optimistic: true, attachments: outgoingAttachments },
        sequence: (messages.at(-1)?.sequence ?? 0) + 1,
        createdAt: new Date(startedAt).toISOString(),
      };
      setMessages((current) => [...current, optimisticMessage]);
      setSessions((current) => current.map((entry) => entry.id === session?.id
        ? {
            ...entry,
            status: "running",
            messageCount: Math.max(entry.messageCount ?? 0, (entry.messageCount ?? messages.length) + 1),
            updatedAt: optimisticMessage.createdAt,
          }
        : entry));
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions/${encodeURIComponent(session.id)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: content || `Attached ${outgoingAttachments.length} file${outgoingAttachments.length === 1 ? "" : "s"}.`,
          attachments: outgoingAttachments,
        }),
      });
      const body = await response.json().catch(() => null) as
        | { session: OverseerSession; messages: OverseerMessage[]; approvalIds?: string[] }
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(body && "error" in body ? body.error?.message ?? "Message failed." : "Message failed.");
      }
      const next = body as { session: OverseerSession; messages: OverseerMessage[] };
      const existingAssistantIds = new Set(messages.filter((message) => message.role === "assistant").map((message) => message.id));
      const assistantToReveal = latestNewAssistantMessage(next.messages, existingAssistantIds);
      setSessions((current) => [next.session, ...current.filter((entry) => entry.id !== next.session.id)]);
      setActiveSessionId(next.session.id);
      setMessages(next.messages);
      revealAssistantMessage(assistantToReveal);
      await loadDetail(next.session.id).catch(() => {
        // The POST response already contains messages; event refresh is best effort.
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not send message.");
      setDraft(content);
      setAttachments(outgoingAttachments);
    } finally {
      setSending(false);
      setOptimisticRunStartedAtMs(null);
    }
  };

  const stopRun = async () => {
    if (!activeSession || !runActive || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions/${encodeURIComponent(activeSession.id)}/cancel`, {
        method: "POST",
      });
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Could not stop the Overseer run.");
      }
      await loadDetail(activeSession.id);
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Could not stop the Overseer run.");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div style={{ padding: `${space.lg}px ${space.xl}px`, color: color.text, fontSize: T.body.size }}>
      <PageBreadcrumbs />
      <PageHeader
        icon={<Bot size={16} />}
        title="Overseer"
        description="Coordinate agent work, monitor tool activity, and resume orchestration sessions from inside HiveRunner."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge label={readiness?.ready ? "Ready" : "Setup"} tone={readiness?.ready ? "positive" : "warning"} />
          </div>
        }
      />

      {error ? (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: radius.md, border: "0.5px solid rgba(239,68,68,0.25)", background: color.negativeSoft, color: color.negative, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      <div
        className="overseer-shell-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `minmax(0, 1fr) 10px ${sessionsColumnWidth}px`,
          gap: 8,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <Section
            title={displaySessionTitle(activeSession?.title) ?? "Orchestration Chat"}
            trailing={
              <OverseerDiagnosticsControls
                open={diagnosticsOpen}
                onToggle={() => setDiagnosticsOpen((open) => !open)}
                readiness={readiness}
                session={activeSession}
                proof={continuityProof}
              />
            }
          >
            {diagnosticsOpen ? (
              <OverseerDiagnosticsPanel
                slug={slug}
                session={activeSession}
                readiness={readiness}
                proof={continuityProof}
              />
            ) : null}

            <div
              ref={chatScrollRef}
              className="overseer-chat-scroll"
              onScroll={handleChatScroll}
              style={{
                display: "grid",
                gap: 7,
                minHeight: 360,
                maxHeight: "58vh",
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {messages.length === 0 ? (
                <div style={{ display: "grid", placeItems: "center", minHeight: 300, color: P.muted, fontSize: 13 }}>
                  No messages yet.
                </div>
              ) : (
                messages.map((message, index) => {
                  const turnEvents = message.turnId ? eventsByTurn.get(message.turnId) ?? [] : [];
                  const turnProvider = runtimeProviderFromEvents(turnEvents, activeProvider);
                  const previousUserMessage = message.role === "assistant" ? findUserMessageForAssistant(messages, index) : null;
                  return (
                    <Fragment key={message.id}>
                      {message.role === "assistant" && turnEvents.length > 0 ? (
                        <ActivityFeed provider={turnProvider} events={turnEvents} active={false} nowMs={nowMs} finalMessageContent={message.content} />
                      ) : null}
                      {message.role === "assistant" ? (
                        <div className="overseer-message-run">
                          <MessageBubble
                            message={message}
                            displayContent={assistantReveal?.messageId === message.id ? assistantReveal.visibleText : undefined}
                            revealing={assistantReveal?.messageId === message.id && assistantReveal.visibleText.length < assistantReveal.fullText.length}
                          />
                          <CopyRunButton
                            copied={copiedRunId === message.id}
                            onCopy={() => void copyRunHandoff(message, previousUserMessage, turnEvents, turnProvider)}
                          />
                        </div>
                      ) : (
                        <MessageBubble message={message} />
                      )}
                    </Fragment>
                  );
                })
              )}
              {showLiveActivity ? (
                <ActivityFeed
                  provider={runtimeProviderFromEvents(activeTurnEvents, activeProvider)}
                  events={activeTurnEvents}
                  active
                  nowMs={nowMs}
                  fallbackStartedAtMs={optimisticRunStartedAtMs}
                />
              ) : null}
              {!showLiveActivity && hasAssistantMessage ? (
                <div style={{ justifySelf: "start", marginTop: 4, marginBottom: 6 }}>
                  <ProviderRunMark provider={latestCompletedProvider} size={22} title={`${providerLabel(latestCompletedProvider)} ready`} />
                </div>
              ) : null}
            </div>

            <div
              onDragEnter={(event) => {
                event.preventDefault();
                if (event.dataTransfer.types.includes("Files")) setDraggingFiles(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (event.dataTransfer.types.includes("Files")) setDraggingFiles(true);
              }}
              onDragLeave={() => setDraggingFiles(false)}
              onDrop={handleDrop}
              style={{
                marginTop: 14,
                borderRadius: radius.lg,
                border: `0.5px solid ${draggingFiles ? color.accent : P.cardBorder}`,
                background: draggingFiles ? color.accentSoft : "var(--surface-elevated)",
                padding: 10,
              }}
            >
              {attachments.length > 0 ? (
                <AttachmentTray attachments={attachments} onRemove={removeAttachment} />
              ) : null}
              {draggingFiles ? (
                <div style={{ marginBottom: 8, color: color.accent, fontSize: 12, fontWeight: 600 }}>
                  Drop files for the Overseer
                </div>
              ) : null}
              <div style={{ position: "relative" }}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    if (event.shiftKey) return;
                    event.preventDefault();
                    void sendMessage();
                  }}
                  placeholder="Ask the Overseer"
                  rows={1}
                  style={{
                    width: "100%",
                    height: 42,
                    minHeight: 42,
                    maxHeight: 120,
                    resize: "none",
                    borderRadius: radius.lg,
                    border: `0.5px solid ${P.cardBorder}`,
                    background: P.surfaceElevated,
                    color: P.text,
                    padding: "10px 44px 10px 12px",
                    fontSize: 13,
                    lineHeight: 1.45,
                    outline: "none",
                    overflowY: "auto",
                  }}
                />
                <button
                  type="button"
                  onClick={() => void stopRun()}
                  disabled={!activeSession || !runActive || cancelling}
                  title={runActive ? "Stop run" : "No active run"}
                  aria-label={runActive ? "Stop run" : "No active run"}
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 28,
                    height: 28,
                    border: 0,
                    borderRadius: radius.sm,
                    background: "transparent",
                    color: runActive ? P.textSec : P.muted,
                    cursor: activeSession && runActive && !cancelling ? "pointer" : "default",
                    opacity: activeSession ? (runActive && !cancelling ? 1 : 0.58) : 0.35,
                    padding: 0,
                  }}
                >
                  {cancelling ? <Loader2 size={15} className="animate-spin" /> : <Square size={14} strokeWidth={2.1} />}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(event) => {
                  if (event.currentTarget.files) handleFileList(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                style={{ display: "none" }}
              />
              <ComposerToolbar
                provider={activeProvider}
                model={activeModel}
                modelCatalog={readiness?.modelCatalog}
                reasoning={activeReasoning}
                fastMode={activeFastMode}
                compaction={activeCompaction}
                contextTokens={contextTokens}
                contextLimit={contextLimit}
                contextPercent={contextPercent}
                quota={visibleQuota}
                disabled={sending || updatingModel}
                providerLocked={activeProviderLocked}
                uploading={uploadingAttachments}
                onAttach={() => fileInputRef.current?.click()}
                onModelChange={(model) => void patchActiveSession({ model })}
                onReasoningChange={(reasoningEffort) => void patchActiveSession({ reasoningEffort })}
                onFastModeChange={(fastMode) => void patchActiveSession({ fastMode })}
                onProviderChange={(provider) => void patchActiveSession({ provider })}
                onCompactionChange={(compaction) => void patchCompactionSettings(compaction)}
                onCompactNow={() => void requestManualCompaction()}
              />
            </div>
          </Section>
        </div>

        <div
          className="overseer-resize-handle"
          role="separator"
          aria-label="Resize sessions column"
          aria-orientation="vertical"
          onMouseDown={beginColumnResize}
          title="Resize sessions column"
          style={{
            alignSelf: "stretch",
            minHeight: 520,
            cursor: "col-resize",
            display: "flex",
            justifyContent: "center",
            paddingTop: 56,
          }}
        />

        <Section
          title="Sessions"
          card={false}
          trailing={
            <button
              type="button"
              onClick={() => setNewSessionOpen((open) => !open)}
              title="New session"
              aria-label="New session"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 26,
                height: 26,
                border: 0,
                borderRadius: radius.full,
                background: newSessionOpen ? P.surfaceHover : "transparent",
                color: P.textSec,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <Plus size={16} />
            </button>
          }
        >
          <div style={{ display: "grid", gap: 6 }}>
            {newSessionOpen || sessions.length === 0 ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitNewSession();
                }}
                style={{
                  display: "grid",
                  gap: 8,
                  marginBottom: sessions.length > 0 ? 8 : 0,
                  padding: 10,
                  borderRadius: radius.md,
                  border: `0.5px solid ${P.cardBorder}`,
                  background: P.card,
                }}
              >
                <input
                  autoFocus
                  value={newSessionTitle}
                  onChange={(event) => setNewSessionTitle(event.target.value)}
                  placeholder="Session name"
                  aria-label="Session name"
                  style={{
                    width: "100%",
                    height: 34,
                    borderRadius: radius.sm,
                    border: `0.5px solid ${P.cardBorder}`,
                    background: P.surfaceElevated,
                    color: P.text,
                    padding: "0 10px",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 34px", gap: 8 }}>
                  <select
                    value={newSessionProvider}
                    onChange={(event) => setNewSessionProvider(normalizeOverseerProvider(event.target.value))}
                    aria-label="Session provider"
                    style={{
                      width: "100%",
                      height: 34,
                      borderRadius: radius.sm,
                      border: `0.5px solid ${P.cardBorder}`,
                      background: P.surfaceElevated,
                      color: P.text,
                      padding: "0 9px",
                      fontSize: 13,
                      outline: "none",
                    }}
                  >
                    {OVERSEER_PROVIDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={creating}
                    title="Create session"
                    aria-label="Create session"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 34,
                      height: 34,
                      borderRadius: radius.sm,
                      border: 0,
                      background: P.surfaceHover,
                      color: P.text,
                      cursor: creating ? "default" : "pointer",
                      opacity: creating ? 0.65 : 1,
                      padding: 0,
                    }}
                  >
                    {creating ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  </button>
                </div>
              </form>
            ) : null}

            {loading ? (
              <div style={{ color: P.muted, fontSize: 13 }}>Loading...</div>
            ) : sessions.length === 0 ? (
              <div style={{ color: P.muted, fontSize: 12 }}>Name the first session and choose its runtime.</div>
            ) : (
              sessions.map((session) => {
                const sessionCompaction = normalizeCompactionSettings(session);
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => {
                      setActiveSessionId(session.id);
                      void loadDetail(session.id).catch((detailError) => {
                        setError(detailError instanceof Error ? detailError.message : "Could not load session.");
                      });
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "14px minmax(0, 1fr) 14px",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 30,
                      textAlign: "left",
                      padding: "5px 7px",
                      borderRadius: radius.sm,
                      border: 0,
                      background: session.id === activeSession?.id ? P.surfaceHover : "transparent",
                      color: P.text,
                      cursor: "pointer",
                    }}
                  >
                    <SessionStatusDot status={session.status} selected={session.id === activeSession?.id} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13 }}>
                      {displaySessionTitle(session.title) ?? "Orchestration Chat"}
                    </span>
                    {sessionCompaction.hasMemorySummary ? (
                      <Asterisk size={12} color={P.accent} aria-label={compactionSummaryLabel(sessionCompaction)} />
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function SessionStatusDot({ status, selected }: { status: SessionStatus; selected: boolean }) {
  const running = status === "running";
  const failed = status === "failed" || status === "cancelled";
  const approval = status === "approval_required";
  const accent = failed ? color.negative : approval ? color.warning : running ? P.accent : selected ? P.textSec : P.muted;
  return (
    <span
      className={running ? "overseer-session-dot is-active" : "overseer-session-dot"}
      title={running ? "Session active" : "No action running"}
      aria-label={running ? "Session active" : "No action running"}
      style={{
        width: running ? 12 : 7,
        height: running ? 12 : 7,
        borderRadius: radius.full,
        border: running
          ? `2px solid color-mix(in srgb, ${accent} 22%, transparent)`
          : `1px solid ${accent}`,
        borderTopColor: running ? accent : undefined,
        background: "transparent",
        opacity: running || selected || failed || approval ? 1 : 0.72,
      }}
    />
  );
}

function shortHash(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : "none";
}

function formatCompactDateTime(value: string | null | undefined): string {
  if (!value) return "not compacted";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "not compacted";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function rawOverseerExportHref(slug: string, sessionId: string): string {
  return `/api/orchestration/companies/${encodeURIComponent(slug)}/overseer/sessions/${encodeURIComponent(sessionId)}/export`;
}

function readinessLabel(readiness: OverseerReadiness | null): string {
  if (!readiness) return "Checking";
  return readiness.ready ? "Ready" : "Setup";
}

function readinessColor(readiness: OverseerReadiness | null): string {
  if (!readiness) return P.muted;
  return readiness.ready ? color.positive : color.warning;
}

function latestProofVersion(proof: ContinuityProof | null): number | null {
  return proof?.latestSnapshotVersion ?? proof?.latestCompaction.snapshotVersion ?? null;
}

function OverseerDiagnosticsControls({
  open,
  onToggle,
  readiness,
  session,
  proof,
}: {
  open: boolean;
  onToggle: () => void;
  readiness: OverseerReadiness | null;
  session: OverseerSession | null;
  proof: ContinuityProof | null;
}) {
  const statusColor = readinessColor(readiness);
  const snapshotVersion = latestProofVersion(proof);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? "Hide diagnostics" : "Show diagnostics"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 26,
          borderRadius: radius.sm,
          border: `0.5px solid ${open ? P.cardBorder : "transparent"}`,
          background: open ? P.surfaceHover : "transparent",
          color: P.textSec,
          cursor: "pointer",
          padding: "3px 7px",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <ChevronDown
          size={13}
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
        <Wrench size={13} />
        <span>Diagnostics</span>
        <span style={{ color: statusColor }}>{readinessLabel(readiness)}</span>
        {session ? (
          <span style={{ color: P.muted }}>
            v{snapshotVersion ?? "none"}
          </span>
        ) : null}
      </button>
    </span>
  );
}

function DiagnosticPill({
  icon,
  label,
  value,
  title,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  title?: string;
  tone?: "positive" | "warning" | "muted";
}) {
  const toneColor = tone === "positive" ? color.positive : tone === "warning" ? color.warning : P.textSec;
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        borderRadius: radius.sm,
        background: P.surfaceElevated,
        color: P.textSec,
        padding: "5px 7px",
        fontSize: 12,
      }}
    >
      <span style={{ display: "inline-flex", color: toneColor }}>{icon}</span>
      <span style={{ color: P.muted }}>{label}</span>
      <span style={{ color: toneColor, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </span>
  );
}

function OverseerDiagnosticsPanel({
  slug,
  session,
  readiness,
  proof,
}: {
  slug: string;
  session: OverseerSession | null;
  readiness: OverseerReadiness | null;
  proof: ContinuityProof | null;
}) {
  const codexReady = readiness ? readiness.codex.installed && readiness.codex.authReady : false;
  const workspaceReady = readiness ? readiness.workspace.writable : false;
  return (
    <div
      style={{
        display: "grid",
        gap: 8,
        marginBottom: 10,
        paddingBottom: 10,
        borderBottom: `0.5px solid ${P.cardBorder}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {readiness ? (
          <>
            <DiagnosticPill
              icon={codexReady ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
              label="CLI"
              value={readiness.codex.installed ? readiness.codex.loginStatus : "not found"}
              title={readiness.codex.version ?? undefined}
              tone={codexReady ? "positive" : "warning"}
            />
            <DiagnosticPill
              icon={workspaceReady ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
              label="Workspace"
              value={workspaceReady ? "ready" : "not writable"}
              title={readiness.workspace.root ?? undefined}
              tone={workspaceReady ? "positive" : "warning"}
            />
            <DiagnosticPill
              icon={<Terminal size={13} />}
              label="Quota"
              value={readiness.quota.status}
              title={readiness.quota.reason}
              tone={readiness.quota.status === "available" ? "positive" : "muted"}
            />
          </>
        ) : (
          <DiagnosticPill icon={<Loader2 size={13} className="animate-spin" />} label="Readiness" value="checking" />
        )}
      </div>
      {session ? (
        <ContinuityProofBar
          slug={slug}
          session={session}
          proof={proof}
        />
      ) : null}
    </div>
  );
}

function ContinuityProofBar({
  slug,
  session,
  proof,
}: {
  slug: string;
  session: OverseerSession;
  proof: ContinuityProof | null;
}) {
  const status = proof?.status ?? "incomplete";
  const statusColor = status === "verified" ? color.positive : status === "stale" ? color.warning : P.muted;
  const latestVersion = latestProofVersion(proof);
  const exportHref = rawOverseerExportHref(slug, session.id);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 0,
        padding: "7px 9px",
        borderRadius: radius.md,
        border: `0.5px solid ${P.cardBorder}`,
        background: "color-mix(in srgb, var(--surface-elevated) 78%, transparent)",
        color: P.textSec,
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: statusColor, fontWeight: 650 }}>
          <CheckCircle2 size={13} />
          {status}
        </span>
        <span>snapshot v{latestVersion ?? "none"}</span>
        <span>{proof?.sourceRowCounts.attachmentManifest ?? 0} attachments</span>
        <span>{formatCompactNumber(session.usage.totalTokens)} tokens</span>
        <span>messages {shortHash(proof?.hashes.messagesSha256)}</span>
        <span>compacted {formatCompactDateTime(proof?.latestCompaction.compactedAt ?? session.compaction?.compactedAt)}</span>
      </div>
      <a
        href={exportHref}
        download
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: P.text,
          textDecoration: "none",
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        <Copy size={12} />
        Raw export
      </a>
    </div>
  );
}

function AttachmentTray({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
      {attachments.map((attachment) => {
        const isImage = attachment.mimeType.startsWith("image/");
        return (
          <span
            key={attachment.id}
            title={attachment.path}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              minWidth: 0,
              maxWidth: 260,
              borderRadius: radius.md,
              border: `0.5px solid ${P.cardBorder}`,
              background: P.card,
              color: P.textSec,
              padding: "6px 8px",
              fontSize: 12,
            }}
          >
            {isImage ? <ImageIcon size={13} /> : <File size={13} />}
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {attachment.name}
            </span>
            <span style={{ color: P.muted, fontSize: 11, whiteSpace: "nowrap" }}>{formatBytes(attachment.size)}</span>
            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              title="Remove attachment"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                border: 0,
                background: "transparent",
                color: P.muted,
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={12} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

function ComposerToolbar({
  provider,
  model,
  modelCatalog,
  reasoning,
  fastMode,
  compaction,
  contextTokens,
  contextLimit,
  contextPercent,
  quota,
  disabled,
  providerLocked,
  uploading,
  onAttach,
  onModelChange,
  onReasoningChange,
  onFastModeChange,
  onProviderChange,
  onCompactionChange,
  onCompactNow,
}: {
  provider: OverseerRuntimeProvider;
  model: string;
  modelCatalog?: OverseerReadiness["modelCatalog"];
  reasoning: string;
  fastMode: boolean;
  compaction: SessionCompactionSettings;
  contextTokens: number | null;
  contextLimit: number | null;
  contextPercent: number | null;
  quota: OverseerSession["quota"];
  disabled: boolean;
  providerLocked: boolean;
  uploading: boolean;
  onAttach: () => void;
  onModelChange: (model: string) => void;
  onReasoningChange: (reasoning: ReasoningEffort) => void;
  onFastModeChange: (fastMode: boolean) => void;
  onProviderChange: (provider: OverseerRuntimeProvider) => void;
  onCompactionChange: (compaction: Partial<SessionCompactionSettings>) => void;
  onCompactNow: () => void;
}) {
  const [runtimeMenuOpen, setRuntimeMenuOpen] = useState(false);
  const [compactionMenuOpen, setCompactionMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const compactionMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedModel = modelOption(model, modelCatalog);
  const availableModels = MODEL_OPTIONS.map((option) => modelOption(option.id, modelCatalog));
  const selectedReasoning = reasoningLabel(reasoning);
  const fastModeAvailable = selectedModel.supportsFastMode === true;
  const effectiveFastMode = fastMode && fastModeAvailable;
  const modeSuffix = effectiveFastMode ? " · Fast" : "";
  const compactionThreshold = compaction.thresholdPercent ?? 80;

  useEffect(() => {
    if (!runtimeMenuOpen && !compactionMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && (menuRef.current?.contains(target) || compactionMenuRef.current?.contains(target))) return;
      setRuntimeMenuOpen(false);
      setCompactionMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRuntimeMenuOpen(false);
        setCompactionMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [runtimeMenuOpen, compactionMenuOpen]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onAttach}
          disabled={disabled || uploading}
          title="Attach files or images"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            border: 0,
            background: "transparent",
            color: P.textSec,
            cursor: "pointer",
            borderRadius: radius.full,
            height: 30,
            width: 30,
            padding: 0,
            opacity: disabled || uploading ? 0.5 : 1,
          }}
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={19} />}
        </button>
        <div
          ref={menuRef}
          style={{ position: "relative" }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setRuntimeMenuOpen(false);
          }}
        >
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={runtimeMenuOpen}
            title={`${providerLabel(provider)} · ${displayModelLabel(selectedModel)} · ${selectedReasoning}${modeSuffix}`}
            onClick={() => setRuntimeMenuOpen((open) => !open)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 30,
              minWidth: 0,
              border: 0,
              borderRadius: radius.md,
              background: "transparent",
              color: P.text,
              cursor: "pointer",
              justifyContent: "flex-start",
              padding: "0 4px",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <ProviderRunMark provider={provider} size={14} />
              <span style={{ color: P.text, whiteSpace: "nowrap" }}>
                {displayModelLabel(selectedModel)}
                <span style={{ color: P.textSec }}> · {selectedReasoning}{effectiveFastMode ? " · Fast" : ""}</span>
              </span>
            </span>
            <ChevronDown size={14} color={P.muted} />
          </button>
          {runtimeMenuOpen ? (
            <div
              role="menu"
              aria-label="Model and reasoning"
              style={{
                position: "absolute",
                left: 0,
                bottom: 38,
                zIndex: 20,
                width: 278,
                maxHeight: "min(460px, 68vh)",
                overflowY: "auto",
                scrollbarWidth: "none",
                padding: 8,
                borderRadius: radius.lg,
                border: `0.5px solid ${P.cardBorder}`,
                background: P.surfaceElevated,
                boxShadow: "var(--shadow-glass)",
              }}
            >
              <div style={{ padding: "7px 10px 5px", color: P.muted, fontSize: 12 }}>Runtime</div>
              {providerLocked ? (
                <div style={{ padding: "0 10px 6px", color: P.muted, fontSize: 11 }}>
                  Locked for this session
                </div>
              ) : null}
              {OVERSEER_PROVIDER_OPTIONS.map((option) => {
                const selected = option.value === provider;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={providerLocked && !selected}
                    title={providerLocked ? "Provider is locked after a session starts" : option.detail}
                    onClick={() => {
                      if (providerLocked) return;
                      onProviderChange(option.value);
                      setRuntimeMenuOpen(false);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      height: 34,
                      border: 0,
                      borderRadius: radius.md,
                      background: selected ? P.surfaceHover : "transparent",
                      color: P.text,
                      padding: "0 10px",
                      fontSize: 13,
                      cursor: providerLocked ? "default" : "pointer",
                      textAlign: "left",
                      opacity: providerLocked && !selected ? 0.45 : 1,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <ProviderRunMark provider={option.value} size={14} />
                      {option.label}
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: P.muted, fontSize: 11, whiteSpace: "nowrap" }}>
                      {option.detail}
                      {selected ? <Check size={15} color={P.text} /> : null}
                    </span>
                  </button>
                );
              })}
              <div style={{ height: 1, background: P.cardBorder, margin: "8px 10px" }} />
              <div style={{ padding: "7px 10px 5px", color: P.muted, fontSize: 12 }}>Reasoning</div>
              {REASONING_OPTIONS.map((option) => {
                const selected = option.value === reasoning;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      onReasoningChange(option.value);
                      setRuntimeMenuOpen(false);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      height: 34,
                      border: 0,
                      borderRadius: radius.md,
                      background: selected ? P.surfaceHover : "transparent",
                      color: P.text,
                      padding: "0 10px",
                      fontSize: 13,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>{option.label}</span>
                    {selected ? <Check size={15} color={P.text} /> : null}
                  </button>
                );
              })}
              <div style={{ height: 1, background: P.cardBorder, margin: "8px 10px" }} />
              <div style={{ padding: "0 10px 5px", color: P.muted, fontSize: 12 }}>Speed</div>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={effectiveFastMode}
                disabled={!fastModeAvailable}
                title={fastModeAvailable ? "Use Codex fast service tier for this model" : "Fast Mode is available for GPT-5.5 and GPT-5.4"}
                onClick={() => {
                  if (fastModeAvailable) onFastModeChange(!effectiveFastMode);
                  setRuntimeMenuOpen(false);
                }}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: 34,
                  border: 0,
                  borderRadius: radius.md,
                  background: effectiveFastMode ? P.surfaceHover : "transparent",
                  color: P.text,
                  padding: "0 10px",
                  fontSize: 13,
                  cursor: fastModeAvailable ? "pointer" : "not-allowed",
                  textAlign: "left",
                  opacity: fastModeAvailable ? 1 : 0.55,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Zap size={14} color={effectiveFastMode ? P.accent : P.textSec} />
                  Fast Mode
                </span>
                {effectiveFastMode ? <Check size={15} color={P.text} /> : null}
              </button>
              <div style={{ height: 1, background: P.cardBorder, margin: "8px 10px" }} />
              <div style={{ padding: "0 10px 5px", color: P.muted, fontSize: 12 }}>Model</div>
              {availableModels.map((option) => {
                const selected = option.id === selectedModel.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    title={option.detail}
                    onClick={() => {
                      onModelChange(option.id);
                      setRuntimeMenuOpen(false);
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      minHeight: 36,
                      border: 0,
                      borderRadius: radius.md,
                      background: selected ? P.surfaceHover : "transparent",
                      color: P.text,
                      padding: "6px 10px",
                      fontSize: 13,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <Zap size={14} color={selected ? P.accent : P.textSec} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayModelLabel(option)}</span>
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: P.muted, fontSize: 11, whiteSpace: "nowrap" }}>
                      {option.detail}
                      {selected ? <Check size={15} color={P.text} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <div
          ref={compactionMenuRef}
          style={{ position: "relative" }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setCompactionMenuOpen(false);
          }}
        >
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={compactionMenuOpen}
            title={`${compactionSummaryLabel(compaction)} · Compaction ${compaction.mode}${compaction.mode === "manual" ? "" : ` at ${compactionThreshold}%`}`}
            onClick={() => setCompactionMenuOpen((open) => !open)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 30,
              border: 0,
              borderRadius: radius.md,
              background: compaction.hasMemorySummary ? "var(--surface-hover)" : "transparent",
              color: compaction.hasMemorySummary ? P.text : P.textSec,
              cursor: "pointer",
              padding: "0 5px",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <Asterisk size={14} color={compaction.hasMemorySummary ? P.accent : P.textSec} />
            <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>
              {compaction.mode === "auto" ? "Auto" : compaction.mode === "manual" ? "Manual" : "Ask"}
            </span>
            {compaction.status === "requested" || compaction.status === "running" ? <Loader2 size={12} className="animate-spin" /> : null}
          </button>
          {compactionMenuOpen ? (
            <div
              role="menu"
              aria-label="Compaction controls"
              style={{
                position: "absolute",
                right: 0,
                bottom: 38,
                zIndex: 20,
                width: 260,
                padding: 8,
                borderRadius: radius.lg,
                border: `0.5px solid ${P.cardBorder}`,
                background: P.surfaceElevated,
                boxShadow: "var(--shadow-glass)",
              }}
            >
              <div style={{ padding: "7px 10px 5px", color: P.muted, fontSize: 12 }}>Compaction</div>
              {(["ask", "auto", "manual"] as CompactionMode[]).map((mode) => {
                const selected = mode === compaction.mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      onCompactionChange({
                        ...compaction,
                        mode,
                        thresholdPercent: mode === "manual" ? null : compactionThreshold,
                      });
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      height: 34,
                      border: 0,
                      borderRadius: radius.md,
                      background: selected ? P.surfaceHover : "transparent",
                      color: P.text,
                      padding: "0 10px",
                      fontSize: 13,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>{mode === "auto" ? "Auto" : mode === "manual" ? "Manual" : "Ask"}</span>
                    {selected ? <Check size={15} color={P.text} /> : null}
                  </button>
                );
              })}
              {compaction.mode !== "manual" ? (
                <>
                  <div style={{ height: 1, background: P.cardBorder, margin: "8px 10px" }} />
                  <label style={{ display: "grid", gap: 7, padding: "4px 10px 8px", color: P.textSec, fontSize: 12 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>Threshold</span>
                      <span>{compactionThreshold}%</span>
                    </span>
                    <input
                      type="range"
                      min={50}
                      max={95}
                      step={5}
                      value={compactionThreshold}
                      onChange={(event) => onCompactionChange({ ...compaction, thresholdPercent: Number(event.target.value) })}
                      style={{ width: "100%", accentColor: P.accent }}
                    />
                  </label>
                </>
              ) : null}
              <div style={{ height: 1, background: P.cardBorder, margin: "8px 10px" }} />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCompactNow();
                  setCompactionMenuOpen(false);
                }}
                disabled={compaction.status === "running" || compaction.status === "requested"}
                title="Request compaction for this session"
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: 34,
                  border: 0,
                  borderRadius: radius.md,
                  background: "transparent",
                  color: P.text,
                  padding: "0 10px",
                  fontSize: 13,
                  cursor: compaction.status === "running" || compaction.status === "requested" ? "default" : "pointer",
                  opacity: compaction.status === "running" || compaction.status === "requested" ? 0.55 : 1,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Asterisk size={14} color={P.accent} />
                  Compact now
                </span>
                {compaction.status === "requested" || compaction.status === "running" ? <Loader2 size={13} className="animate-spin" /> : null}
              </button>
              <div style={{ padding: "6px 10px 3px", color: P.muted, fontSize: 11, lineHeight: 1.35 }}>
                {compaction.status === "requested"
                  ? "Compaction requested; runtime integration has not reported completion yet."
                  : compaction.hasMemorySummary
                    ? compactionSummaryLabel(compaction)
                    : "No compacted memory summary reported."}
              </div>
            </div>
          ) : null}
        </div>
        <ContextRing
          percent={contextPercent}
          contextTokens={contextTokens}
          contextLimit={contextLimit}
          quota={quota}
        />
      </div>
    </div>
  );
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "unknown";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return formatNumber(value);
}

function formatQuotaReset(value?: string): string {
  if (!value) return "reset time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "reset time unavailable";
  return `resets ${date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

type QuotaBucket = NonNullable<OverseerSession["quota"]["buckets"]>[number];

function quotaBucketUsedLabel(bucket: QuotaBucket): string {
  if (typeof bucket.usedPercent !== "number" || !Number.isFinite(bucket.usedPercent)) return "usage unavailable";
  return `${Math.round(bucket.usedPercent)}% used (${Math.max(0, Math.round(100 - bucket.usedPercent))}% left)`;
}

function quotaBucketLine(bucket: QuotaBucket): string {
  return `${bucket.label}: ${quotaBucketUsedLabel(bucket)} · ${formatQuotaReset(bucket.resetsAt)}`;
}

function isFiveHourQuotaBucket(bucket: QuotaBucket): boolean {
  return bucket.windowDurationMins === 300 || /\b5\s*h(?:our)?\b|\bfive\s*hour\b/i.test(bucket.label);
}

function isWeeklyQuotaBucket(bucket: QuotaBucket): boolean {
  return (bucket.windowDurationMins ?? 0) >= 10080 || /week/i.test(bucket.label);
}

function subscriptionUsageLines(quota: OverseerSession["quota"]): string[] {
  const buckets = "buckets" in quota && Array.isArray(quota.buckets) ? quota.buckets : [];
  if (quota.status === "available" && buckets.length > 0) {
    const ordered: QuotaBucket[] = [];
    const seen = new Set<QuotaBucket>();
    const add = (bucket: QuotaBucket | undefined) => {
      if (!bucket || seen.has(bucket)) return;
      ordered.push(bucket);
      seen.add(bucket);
    };
    add(buckets.find(isFiveHourQuotaBucket));
    add(buckets.find(isWeeklyQuotaBucket));
    for (const bucket of buckets) add(bucket);
    return ordered.map(quotaBucketLine);
  }
  if (quota.reason && !/not been fetched/i.test(quota.reason)) {
    return [`Subscription usage unavailable: ${quota.reason}`];
  }
  return ["Subscription usage not exposed by Codex exec JSON for this session."];
}

function ContextRing({
  percent,
  contextTokens,
  contextLimit,
  quota,
}: {
  percent: number | null;
  contextTokens: number | null;
  contextLimit: number | null;
  quota: OverseerSession["quota"];
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const clamped = percent === null ? null : Math.max(0, Math.min(100, percent));
  const contextLabel = clamped === null
    ? `Context unavailable · window ${formatCompactNumber(contextLimit)}`
    : `Context ${formatCompactNumber(contextTokens)} / ${formatCompactNumber(contextLimit)} (${clamped}%)`;
  const quotaLines = subscriptionUsageLines(quota);
  const title = [contextLabel, ...quotaLines].join(". ");
  return (
    <span
      className="overseer-context-ring"
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onFocus={() => setTooltipOpen(true)}
      onBlur={() => setTooltipOpen(false)}
      aria-label={title}
      tabIndex={0}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 22,
        height: 22,
        borderRadius: radius.full,
        border: 0,
        background: clamped === null
          ? "var(--surface-hover)"
          : `conic-gradient(var(--accent) ${clamped * 3.6}deg, var(--surface-hover) 0deg)`,
        boxShadow: "0 0 0 0.5px color-mix(in srgb, var(--text-muted) 16%, transparent)",
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: radius.full,
          background: "var(--surface-elevated)",
          boxShadow: "0 0 0 0.5px color-mix(in srgb, var(--text-muted) 10%, transparent)",
        }}
      />
      {tooltipOpen ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            right: 0,
            bottom: 30,
            zIndex: 30,
            width: "max-content",
            minWidth: 320,
            maxWidth: "min(520px, calc(100vw - 48px))",
            padding: "8px 10px",
            borderRadius: radius.md,
            background: P.surfaceHover,
            border: `0.5px solid ${P.cardBorder}`,
            color: P.text,
            boxShadow: "var(--shadow-glass)",
            fontSize: 12,
            lineHeight: 1.45,
            pointerEvents: "none",
          }}
        >
          <span style={{ display: "block", whiteSpace: "nowrap" }}>{contextLabel}</span>
          {quotaLines.map((line, index) => (
            <span key={`${line}-${index}`} style={{ display: "block", color: P.textSec, marginTop: 2, whiteSpace: "nowrap" }}>
              {line}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

type ActivityItem = {
  id: string;
  kind: "checkin" | "terminal" | "tool" | "system" | "done" | "waiting" | "summary";
  label: string;
  detail?: string;
  occurredAt?: string;
  running?: boolean;
};

type WorkDigestItem = {
  id: string;
  kind: "explored" | "edited" | "ran" | "browser" | "checkin" | "diff";
  label: string;
  detail?: string;
  additions?: number;
  deletions?: number;
};

function normalizedText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isFinalAssistantEcho(text: string, finalMessageContent?: string): boolean {
  if (!finalMessageContent) return false;
  const candidate = normalizedText(text);
  const final = normalizedText(finalMessageContent);
  return Boolean(candidate && final && (candidate === final || final.startsWith(candidate) || candidate.startsWith(final)));
}

function formatItemType(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function filePathsFromText(text: string): Set<string> {
  const paths = new Set<string>();
  const extensions = "tsx?|jsx?|mjs|cjs|json|css|scss|md|mdx|sql|py|rb|go|rs|java|kt|swift|sh|zsh|bash|yml|yaml|toml|txt|db";
  const backtick = String.fromCharCode(96);
  const quoteClass = `[\\s"'${backtick}]`;
  const pathPattern = new RegExp(
    `(?:^|${quoteClass})((?:~|\\.{1,2}|/|[\\w@.-]+/)[^\\s"'${backtick}]+?\\.(?:${extensions}))(?:$|[\\s"'${backtick},;)])`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(text)) !== null) {
    const candidate = match[1]?.replace(/[),.;:]+$/, "");
    if (candidate) paths.add(candidate);
  }

  const rgOutputPattern = new RegExp(`^([^:\\n]+\\.(?:${extensions})):\\d+:`, "gim");
  while ((match = rgOutputPattern.exec(text)) !== null) {
    const candidate = match[1]?.trim();
    if (candidate) paths.add(candidate);
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (new RegExp(`\\.(?:${extensions})$`, "i").test(trimmed)) paths.add(trimmed);
  }
  return paths;
}

type CommandDigest = {
  files: Set<string>;
  searches: number;
  edits: Set<string>;
  commands: number;
  browsers: number;
  details: string[];
};

function emptyCommandDigest(): CommandDigest {
  return {
    files: new Set(),
    searches: 0,
    edits: new Set(),
    commands: 0,
    browsers: 0,
    details: [],
  };
}

function mergeSets(target: Set<string>, source: Set<string>) {
  for (const value of source) target.add(value);
}

function analyzeCommandEvent(event: OverseerEvent): CommandDigest | null {
  const item = itemFromEvent(event);
  if (stringValue(item?.type) !== "command_execution") return null;
  const command = commandLabel(item?.command);
  const output = stringValue(item?.aggregated_output);
  const combined = `${command}\n${output}`;
  const lower = command.toLowerCase();
  const files = filePathsFromText(combined);
  const digest = emptyCommandDigest();
  const isSearch = /\b(rg|grep|ag|ack)\b/.test(lower) && !/\brg\b[^|;&]*--files\b/.test(lower);
  const isFind = /\bfind\b/.test(lower);
  const isFileListing = /\brg\b[^|;&]*--files\b/.test(lower) || /\bls\b/.test(lower);
  const isRead = /\b(sed|cat|nl|head|tail|less|more)\b/.test(lower) || /\bgit\s+(show|diff|status|log)\b/.test(lower);
  const isEdit = /apply_patch|\bcat\b[^|;&]*>\s*[^&|]|\btee\b|\b(mv|cp|rm|mkdir|touch)\b|\bwritefilesync\b|\b(sed|perl)\b[^|;&]*\s-i\b/.test(lower);
  const isBrowser = /\b(playwright|browser|screenshot|chromium|chrome)\b/.test(lower);

  if (isSearch || isFind) digest.searches += 1;
  if (isRead || isSearch || isFind || isFileListing) mergeSets(digest.files, files);
  if (isEdit) mergeSets(digest.edits, files);
  if (isBrowser) digest.browsers += 1;
  if (!isRead && !isSearch && !isFind && !isFileListing && !isEdit && !isBrowser) digest.commands += 1;
  digest.details.push(command);
  return digest;
}

function hasCommandDigestValue(digest: CommandDigest): boolean {
  return digest.files.size > 0 || digest.searches > 0 || digest.edits.size > 0 || digest.commands > 0 || digest.browsers > 0;
}

function digestLabel(digest: CommandDigest): { kind: WorkDigestItem["kind"]; label: string } | null {
  if (digest.edits.size > 0) {
    return {
      kind: "edited",
      label: `Edited ${pluralize(digest.edits.size, "file")}`,
    };
  }
  if (digest.files.size > 0 || digest.searches > 0) {
    const parts = [
      digest.files.size > 0 ? pluralize(digest.files.size, "file") : null,
      digest.searches > 0 ? pluralize(digest.searches, "search", "searches") : null,
    ].filter(Boolean);
    return {
      kind: "explored",
      label: `Explored ${parts.join(", ")}`,
    };
  }
  if (digest.browsers > 0) {
    return {
      kind: "browser",
      label: `Used ${pluralize(digest.browsers, "browser action")}`,
    };
  }
  if (digest.commands > 0) {
    return {
      kind: "ran",
      label: `Ran ${pluralize(digest.commands, "command")}`,
    };
  }
  return null;
}

function diffDigestFromEvent(event: OverseerEvent): WorkDigestItem | null {
  if (event.eventType !== "workspace.diff") return null;
  const filesChanged = numberValue(event.event.filesChanged);
  const additions = numberValue(event.event.additions);
  const deletions = numberValue(event.event.deletions);
  if (filesChanged <= 0) return null;
  const files = Array.isArray(event.event.files)
    ? event.event.files.flatMap((entry) => {
        const record = asRecord(entry);
        const filePath = stringValue(record?.path);
        return filePath ? [filePath] : [];
      })
    : [];
  return {
    id: event.id,
    kind: "diff",
    label: `${pluralize(filesChanged, "file")} changed`,
    detail: files.slice(0, 6).join("\n"),
    additions,
    deletions,
  };
}

function buildWorkDigestItems(events: OverseerEvent[], finalMessageContent?: string): WorkDigestItem[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const items: WorkDigestItem[] = [];
  let digest = emptyCommandDigest();
  let firstSequence: number | null = null;
  let lastSequence: number | null = null;

  const flush = () => {
    if (!hasCommandDigestValue(digest) || firstSequence === null || lastSequence === null) {
      digest = emptyCommandDigest();
      firstSequence = null;
      lastSequence = null;
      return;
    }
    const summary = digestLabel(digest);
    if (summary) {
      items.push({
        id: `digest-${firstSequence}-${lastSequence}`,
        kind: summary.kind,
        label: summary.label,
        detail: digest.details.slice(0, 6).join("\n"),
      });
    }
    digest = emptyCommandDigest();
    firstSequence = null;
    lastSequence = null;
  };

  for (const event of sorted) {
    if (event.eventType === "item.completed") {
      const commandDigest = analyzeCommandEvent(event);
      if (commandDigest) {
        if (firstSequence === null) firstSequence = event.sequence;
        lastSequence = event.sequence;
        mergeSets(digest.files, commandDigest.files);
        mergeSets(digest.edits, commandDigest.edits);
        digest.searches += commandDigest.searches;
        digest.commands += commandDigest.commands;
        digest.browsers += commandDigest.browsers;
        digest.details.push(...commandDigest.details);
        continue;
      }

      const item = itemFromEvent(event);
      if (stringValue(item?.type) === "agent_message") {
        flush();
        const text = stringValue(item?.text);
        if (text && text.length <= 900 && !isFinalAssistantEcho(text, finalMessageContent)) {
          items.push({
            id: event.id,
            kind: "checkin",
            label: text,
          });
        }
        continue;
      }
    }

    const diff = diffDigestFromEvent(event);
    if (diff) {
      flush();
      items.push(diff);
    }
  }
  flush();
  return items;
}

function buildActivityItems(events: OverseerEvent[], finalMessageContent?: string): ActivityItem[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const completedItemIds = new Set<string>();
  for (const event of sorted) {
    if (event.eventType !== "item.completed") continue;
    const item = itemFromEvent(event);
    const id = stringValue(item?.id);
    if (id) completedItemIds.add(id);
  }

  const items: ActivityItem[] = [];
  for (const event of sorted) {
    const item = itemFromEvent(event);
    const itemId = stringValue(item?.id) || event.id;
    const itemType = stringValue(item?.type);
    const eventType = event.eventType;

    if (eventType === "codex.exec.started" || eventType === "codex.resume.started") {
      items.push({
        id: event.id,
        kind: "system",
        label: eventType === "codex.resume.started" ? "Resumed Codex session" : "Started Codex session",
        detail: stringValue(event.event.workspaceRoot),
        occurredAt: event.occurredAt,
      });
      continue;
    }

    if (eventType === "thread.started") {
      items.push({
        id: event.id,
        kind: "system",
        label: "Codex session ready",
        detail: stringValue(event.event.thread_id) || stringValue(event.event.threadId),
        occurredAt: event.occurredAt,
      });
      continue;
    }

    if (eventType === "item.started" && itemType === "command_execution" && !completedItemIds.has(itemId)) {
      items.push({
        id: event.id,
        kind: "terminal",
        label: "Running terminal",
        detail: commandLabel(item?.command),
        occurredAt: event.occurredAt,
        running: true,
      });
      continue;
    }

    if (eventType === "item.completed" && itemType === "command_execution") {
      items.push({
        id: event.id,
        kind: "terminal",
        label: "Ran terminal",
        detail: commandLabel(item?.command),
        occurredAt: event.occurredAt,
      });
      continue;
    }

    if (eventType === "item.completed" && itemType === "agent_message") {
      const text = stringValue(item?.text);
      if (text && text.length <= 900 && !isFinalAssistantEcho(text, finalMessageContent)) {
        items.push({
          id: event.id,
          kind: "checkin",
          label: "Check-in",
          detail: text,
          occurredAt: event.occurredAt,
        });
      }
      continue;
    }

    if (eventType === "item.started" && completedItemIds.has(itemId)) {
      continue;
    }

    if ((eventType === "item.started" || eventType === "item.completed") && itemType) {
      items.push({
        id: event.id,
        kind: "tool",
        label: `${eventType === "item.started" ? "Using" : "Used"} ${formatItemType(itemType)}`,
        occurredAt: event.occurredAt,
        running: eventType === "item.started" && !completedItemIds.has(itemId),
      });
      continue;
    }

    if (eventType === "turn.completed") {
      const usage = asRecord(event.event.usage);
      const totalTokens = usage ? Number(usage.total_tokens ?? usage.totalTokens ?? 0) : 0;
      items.push({
        id: event.id,
        kind: "done",
        label: "Turn complete",
        detail: totalTokens > 0 ? `${formatNumber(totalTokens)} tokens` : undefined,
        occurredAt: event.occurredAt,
      });
    }
  }
  return items;
}

function compactActivityItems(items: ActivityItem[]): ActivityItem[] {
  if (items.length <= 12) return items;
  return [
    items[0],
    {
      id: "activity-summary",
      kind: "summary",
      label: `${items.length - 11} earlier activity item${items.length - 11 === 1 ? "" : "s"}`,
    },
    ...items.slice(-10),
  ];
}

function turnStartedAtMs(events: OverseerEvent[], fallbackStartedAtMs?: number | null): number | null {
  const startEvent = events.find((event) => event.eventType === "codex.exec.started" || event.eventType === "codex.resume.started" || event.eventType === "turn.started")
    ?? events[0];
  return startEvent ? eventTimeMs(startEvent) : fallbackStartedAtMs ?? null;
}

function turnEndedAtMs(events: OverseerEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) continue;
    if (event.eventType === "turn.completed") return eventTimeMs(event);
  }
  return events.length > 0 ? eventTimeMs(events[events.length - 1]) : null;
}

function countCommandTools(events: OverseerEvent[]): number {
  const ids = new Set<string>();
  for (const event of events) {
    const item = itemFromEvent(event);
    if (stringValue(item?.type) !== "command_execution") continue;
    ids.add(stringValue(item?.id) || event.id);
  }
  return ids.size;
}

function countCheckIns(items: ActivityItem[]): number {
  return items.filter((item) => item.kind === "checkin").length;
}

function runningToolLabels(items: ActivityItem[]): string[] {
  return items
    .filter((item) => item.running && (item.kind === "terminal" || item.kind === "tool"))
    .map((item) => item.detail ? `${item.label}: ${item.detail}` : item.label);
}

function usageTokensFromEvents(events: OverseerEvent[]): number | null {
  let total: number | null = null;
  for (const event of events) {
    const usage = asRecord(event.event.usage) ?? asRecord(event.event.token_usage) ?? asRecord(event.event.tokenUsage);
    const direct = firstEventNumber(event.event, ["total_tokens", "totalTokens", "total_token_usage", "totalTokenUsage"]);
    const nested = usage ? firstEventNumber(usage, ["total_tokens", "totalTokens", "total_token_usage", "totalTokenUsage"]) : undefined;
    const input = usage ? firstEventNumber(usage, ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]) : undefined;
    const output = usage ? firstEventNumber(usage, ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"]) : undefined;
    const candidate = nested ?? direct ?? (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined);
    if (candidate !== undefined) total = Math.max(total ?? 0, candidate);
  }
  return total;
}

function findUserMessageForAssistant(messages: OverseerMessage[], assistantIndex: number): OverseerMessage | null {
  const assistant = messages[assistantIndex];
  if (!assistant || assistant.role !== "assistant") return null;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (!candidate) continue;
    if (candidate.role === "assistant") break;
    if (candidate.role === "user") return candidate;
  }
  return null;
}

function latestNewAssistantMessage(messages: OverseerMessage[], existingAssistantIds: Set<string>): OverseerMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && !existingAssistantIds.has(message.id)) return message;
  }
  return null;
}

function nextAssistantRevealIndex(text: string, currentIndex: number): number {
  if (currentIndex >= text.length) return text.length;
  const target = Math.min(text.length, currentIndex + 28);
  if (target >= text.length) return text.length;

  const nextSpace = text.indexOf(" ", target);
  const nextNewline = text.indexOf("\n", target);
  const candidates = [nextSpace, nextNewline]
    .filter((index) => index >= target && index <= target + 24)
    .sort((a, b) => a - b);
  return (candidates[0] ?? target) + 1;
}

function assistantRevealDelay(visibleText: string): number {
  if (/\n\s*\n$/.test(visibleText)) return 150;
  if (/[.!?]\s$/.test(visibleText)) return 75;
  if (/[,;:]\s$/.test(visibleText)) return 45;
  return 18;
}

async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildRunHandoffText({
  sessionTitle,
  provider,
  model,
  reasoning,
  userMessage,
  assistantMessage,
  events,
}: {
  sessionTitle: string;
  provider: OverseerRuntimeProvider;
  model: string;
  reasoning: string;
  userMessage: OverseerMessage | null;
  assistantMessage: OverseerMessage;
  events: OverseerEvent[];
}): string {
  const startedAt = turnStartedAtMs(events);
  const endedAt = turnEndedAtMs(events);
  const elapsed = startedAt !== null ? formatElapsed((endedAt ?? Date.now()) - startedAt) : "unknown";
  const tokens = usageTokensFromEvents(events);
  const toolCount = countCommandTools(events);
  const digestItems = buildWorkDigestItems(events, assistantMessage.content);
  const checkIns = countCheckIns(buildActivityItems(events, assistantMessage.content));
  const lines = [
    `# Overseer Run Handoff`,
    ``,
    `Session: ${sessionTitle}`,
    `Provider: ${providerLabel(provider)}`,
    `Model: ${displayModelLabel(modelOption(model))}`,
    `Reasoning: ${reasoningLabel(reasoning)}`,
    `Elapsed: ${elapsed}`,
    tokens !== null ? `Tokens: ${formatNumber(tokens)}` : null,
    toolCount > 0 ? `Tools: ${formatNumber(toolCount)}` : null,
    checkIns > 0 ? `Check-ins: ${formatNumber(checkIns)}` : null,
    ``,
    `## User Prompt`,
    userMessage?.content?.trim() || "(No prompt found for this run.)",
    ``,
    `## Work Summary`,
    ...(
      digestItems.length > 0
        ? digestItems.flatMap((item) => {
            const prefix = item.kind === "diff" && item.additions !== undefined && item.deletions !== undefined
              ? `- ${item.label} (+${formatNumber(item.additions)} -${formatNumber(item.deletions)})`
              : `- ${item.label}`;
            return item.detail ? [prefix, `  ${item.detail.split(/\r?\n/).slice(0, 6).join("\n  ")}`] : [prefix];
          })
        : ["- No tool digest was recorded for this run."]
    ),
    ``,
    `## Final Response`,
    assistantMessage.content.trim(),
  ].filter((line): line is string => line !== null);
  return `${lines.join("\n").trim()}\n`;
}

function ActivityFeed({
  provider,
  events,
  active,
  nowMs,
  fallbackStartedAtMs,
  finalMessageContent,
}: {
  provider: OverseerRuntimeProvider;
  events: OverseerEvent[];
  active: boolean;
  nowMs: number;
  fallbackStartedAtMs?: number | null;
  finalMessageContent?: string;
}) {
  const startedAt = turnStartedAtMs(events, fallbackStartedAtMs);
  const endedAt = active ? nowMs : turnEndedAtMs(events) ?? nowMs;
  const elapsed = startedAt === null ? null : endedAt - startedAt;
  const rawItems = buildActivityItems(events, finalMessageContent);
  const digestItems = buildWorkDigestItems(events, finalMessageContent);
  const items = compactActivityItems(rawItems.length > 0
    ? rawItems
    : [{
        id: "waiting",
        kind: "waiting",
        label: "Waiting for Codex",
        detail: "The turn has been submitted and the first runtime event has not landed yet.",
        running: active,
      }]);
  const toolCount = countCommandTools(events);
  const checkIns = countCheckIns(rawItems);
  const runningTools = runningToolLabels(rawItems);
  const totalTokens = usageTokensFromEvents(events);
  const summaryMetaParts = active
    ? [
        totalTokens ? `${formatCompactNumber(totalTokens)} tokens` : null,
        runningTools.length > 0 ? "running toolset..." : "thinking...",
      ].filter(Boolean)
    : [
        totalTokens ? `${formatCompactNumber(totalTokens)} tokens` : null,
        toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
        checkIns > 0 ? `${checkIns} check-in${checkIns === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
  const summaryContent = (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, color: ACTIVITY_MUTED, fontSize: 12 }}>
      <ProviderRunMark
        provider={provider}
        active={active}
        size={active ? 16 : 15}
        tone="muted"
        title={active ? `${providerLabel(provider)} running` : providerLabel(provider)}
      />
      {active ? (
        <span className="overseer-thinking-dots overseer-thinking-dots--subtle" aria-label="Thinking">
          <span />
          <span />
          <span />
        </span>
      ) : null}
      <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>
        {formatElapsed(elapsed)}
        {summaryMetaParts.length > 0 ? (
          <span> · {summaryMetaParts.join(" · ")}</span>
        ) : null}
      </span>
    </div>
  );

  if (!active) {
    return (
      <details
        style={{
          justifySelf: "stretch",
          padding: "4px 0",
          color: P.text,
        }}
      >
        <summary
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: 12,
            color: P.muted,
            fontSize: 11,
            cursor: "pointer",
            listStyle: "none",
          }}
        >
          {summaryContent}
        </summary>
        <WorkDigestList items={digestItems} />
        <details style={{ marginTop: digestItems.length > 0 ? 10 : 0 }}>
          <summary
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: P.muted,
              cursor: "pointer",
              fontSize: 11,
              listStyle: "none",
            }}
          >
            Raw event details
          </summary>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {items.map((item) => <ActivityRow key={item.id} item={item} />)}
          </div>
        </details>
      </details>
    );
  }

  return (
    <div
      style={{
        justifySelf: "stretch",
        padding: "4px 0",
        color: P.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 12, marginBottom: 10, color: P.muted, fontSize: 11 }}>
        {summaryContent}
      </div>
      <details style={{ marginTop: 10 }}>
        <summary
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: P.muted,
            cursor: "pointer",
            fontSize: 11,
            listStyle: "none",
          }}
        >
          Activity details
        </summary>
        <WorkDigestList items={digestItems} />
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {items.map((item) => <ActivityRow key={item.id} item={item} />)}
        </div>
      </details>
    </div>
  );
}

function WorkDigestList({ items }: { items: WorkDigestItem[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 6, marginTop: 8, marginBottom: 6 }}>
      {items.map((item) => <WorkDigestRow key={item.id} item={item} />)}
    </div>
  );
}

function WorkDigestRow({ item }: { item: WorkDigestItem }) {
  const icon = item.kind === "diff"
    ? <Pencil size={14} />
    : item.kind === "explored"
      ? <Search size={14} />
      : item.kind === "ran"
        ? <Terminal size={14} />
        : item.kind === "checkin"
          ? <Bot size={14} />
          : item.kind === "edited"
            ? <Pencil size={14} />
            : <Wrench size={14} />;
  const label = item.kind === "diff" ? (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
      <span>{item.label}</span>
      <span style={{ color: color.positive }}>+{formatNumber(item.additions)}</span>
      <span style={{ color: color.negative }}>-{formatNumber(item.deletions)}</span>
    </span>
  ) : item.label;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", gap: 8, alignItems: "start", color: P.textSec, fontSize: 13 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: P.muted, paddingTop: 2 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: item.kind === "checkin" ? P.textSec : P.muted, lineHeight: 1.35 }}>
          {label}
        </div>
        {item.detail ? (
          <div
            style={{
              marginTop: 2,
              color: P.muted,
              fontFamily: item.kind === "checkin" ? undefined : "var(--font-mono, monospace)",
              fontSize: 11,
              lineHeight: 1.3,
              whiteSpace: "pre-wrap",
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflowWrap: "anywhere",
            }}
          >
            {item.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const icon = item.running
    ? <Loader2 size={13} className="animate-spin" />
    : item.kind === "terminal"
      ? <Terminal size={13} />
      : item.kind === "done"
        ? <CheckCircle2 size={13} />
        : item.kind === "checkin"
          ? <Bot size={13} />
          : <Wrench size={13} />;
  if (item.kind === "terminal" || item.kind === "tool") {
    return <ToolActivityRow item={item} icon={icon} />;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 8, alignItems: "start", color: P.textSec, fontSize: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: item.kind === "done" ? color.positive : P.muted, paddingTop: 2 }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: P.textSec, fontWeight: 600 }}>{item.label}</div>
        {item.detail ? (
          <div
            style={{
              marginTop: 3,
              color: P.muted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: item.kind === "checkin" ? 4 : 2,
              WebkitBoxOrient: "vertical",
              lineHeight: 1.4,
              overflowWrap: "anywhere",
            }}
          >
            {item.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolActivityRow({ item, icon }: { item: ActivityItem; icon: ReactNode }) {
  return (
    <details
      style={{
        color: P.textSec,
        fontSize: 12,
        borderRadius: radius.sm,
      }}
    >
      <summary
        style={{
          display: "grid",
          gridTemplateColumns: "18px minmax(0, 1fr) auto",
          gap: 8,
          alignItems: "center",
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", color: P.muted }}>
          {icon}
        </span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>
          {item.label}
        </span>
        <span style={{ color: P.muted, fontSize: 11 }}>
          Details
        </span>
      </summary>
      {item.detail ? (
        <div
          style={{
            margin: "6px 0 0 26px",
            borderRadius: radius.sm,
            border: 0,
            background: "transparent",
            color: P.muted,
            padding: "8px 10px",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11,
            lineHeight: 1.45,
            overflowWrap: "anywhere",
            whiteSpace: "pre-wrap",
          }}
        >
          {item.detail}
        </div>
      ) : null}
    </details>
  );
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="overseer-markdown" style={{ display: "grid", gap: 0, whiteSpace: "normal" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 0.45em 0" }}>{children}</p>,
          h1: ({ children }) => <h1 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 0.45em 0", color: P.text }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 0.4em 0", color: P.text }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 0.35em 0", color: P.text }}>{children}</h3>,
          h4: ({ children }) => <h4 style={{ fontSize: 13, fontWeight: 650, margin: "0 0 0.3em 0", color: P.text }}>{children}</h4>,
          h5: ({ children }) => <h5 style={{ fontSize: 13, fontWeight: 650, margin: "0 0 0.25em 0", color: P.text }}>{children}</h5>,
          h6: ({ children }) => <h6 style={{ fontSize: 13, fontWeight: 600, margin: "0 0 0.25em 0", color: P.textSec }}>{children}</h6>,
          ul: ({ children }) => <ul style={{ margin: "0.12em 0 0.5em 0", paddingLeft: 18, listStyleType: "disc" }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ margin: "0.12em 0 0.5em 0", paddingLeft: 18, listStyleType: "decimal" }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: 2, paddingLeft: 1 }}>{children}</li>,
          strong: ({ children }) => <strong style={{ fontWeight: 700, color: P.text }}>{children}</strong>,
          em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
          code: ({ children }) => (
            <code style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "0.92em",
              background: "var(--surface-hover)",
              borderRadius: 4,
              padding: "1px 5px",
              whiteSpace: "break-spaces",
            }}>
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre style={{
              margin: "0 0 0.55em 0",
              padding: 10,
              borderRadius: radius.md,
              border: `0.5px solid ${P.cardBorder}`,
              background: P.card,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}>
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              margin: "0 0 0.55em 0",
              padding: "0 0 0 12px",
              borderLeft: `2px solid ${P.cardBorder}`,
              color: P.textSec,
            }}>
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: P.accent, textDecoration: "underline" }}>
              {children}
            </a>
          ),
          hr: () => <hr style={{ border: 0, borderTop: `0.5px solid ${P.cardBorder}`, margin: "0.5em 0" }} />,
          table: ({ children }) => (
            <div style={{ overflowX: "auto", margin: "0 0 0.55em 0" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th style={{ borderBottom: `0.5px solid ${P.cardBorder}`, padding: "5px 7px", textAlign: "left" }}>{children}</th>,
          td: ({ children }) => <td style={{ borderBottom: `0.5px solid ${P.cardBorder}`, padding: "5px 7px", verticalAlign: "top" }}>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CopyRunButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <button
      type="button"
      className="overseer-copy-run"
      onClick={onCopy}
      title={copied ? "Copied run" : "Copy run handoff"}
      aria-label={copied ? "Copied run" : "Copy run handoff"}
      style={{
        justifySelf: "start",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        marginTop: -3,
        border: 0,
        borderRadius: radius.sm,
        background: "transparent",
        color: copied ? color.positive : P.muted,
        cursor: "pointer",
        padding: 0,
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function MessageBubble({
  message,
  displayContent,
  revealing = false,
}: {
  message: OverseerMessage;
  displayContent?: string;
  revealing?: boolean;
}) {
  const isUser = message.role === "user";
  const isApproval = message.role === "approval";
  const isAssistant = message.role === "assistant";
  const showRoleLabel = message.role !== "assistant" && message.role !== "user";
  const messageAttachments = attachmentsFromMetadata(message.metadata);
  const content = displayContent ?? message.content;
  const border = isUser
    ? "0.5px solid color-mix(in srgb, var(--accent) 28%, var(--border))"
    : isApproval
      ? "0.5px solid color-mix(in srgb, var(--warning) 32%, var(--border))"
      : "0";
  const background = isUser
    ? "var(--accent-muted)"
    : isApproval
      ? color.warningSoft
      : "transparent";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", width: "100%" }}>
      <div
        style={{
          width: isAssistant ? "100%" : undefined,
          maxWidth: isAssistant ? "100%" : "min(760px, 86%)",
          borderRadius: radius.md,
          border,
          background,
          padding: isUser || isApproval ? "10px 12px" : "2px 0",
          color: P.text,
          whiteSpace: isAssistant ? "normal" : "pre-wrap",
          overflowWrap: "anywhere",
          lineHeight: 1.38,
          fontSize: 13,
        }}
      >
        {showRoleLabel ? (
          <div style={{ marginBottom: 6, color: P.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0 }}>
            {message.role}
          </div>
        ) : null}
        {isAssistant ? (
          <>
            <AssistantMarkdown content={content} />
            {revealing ? <span className="overseer-reveal-caret" aria-hidden="true" /> : null}
          </>
        ) : content}
        {messageAttachments.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {messageAttachments.map((attachment) => (
              <span
                key={attachment.id}
                title={attachment.path}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: radius.md,
                  border: `0.5px solid ${P.cardBorder}`,
                  background: P.card,
                  color: P.textSec,
                  padding: "5px 7px",
                  fontSize: 11,
                }}
              >
                {attachment.mimeType.startsWith("image/") ? <ImageIcon size={12} /> : <File size={12} />}
                {attachment.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
