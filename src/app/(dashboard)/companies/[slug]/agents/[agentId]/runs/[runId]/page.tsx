"use client";

import { use, useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Zap,
  MessageSquare,
  Play,
  Square,
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
} from "lucide-react";
import { A } from "../../layout";
import { useLiveStream } from "@/components/live/LiveStreamProvider";
import { buildCanonicalAgentRunsPath } from "@/lib/orchestration/route-paths";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";
import type { StreamTranscriptEntry } from "@/hooks/useLiveRunStream";
import type { ProviderCapabilities } from "@/lib/orchestration/adapters/types";
import { CapabilityGrid, TierBadge } from "@/components/orchestration/ProviderPresentation";

/* ── Types ── */

interface RunDetail {
  id: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  agentEmoji: string | null;
  companyId: string;
  status: string;
  invocationSource: string;
  triggerDetail: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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
}

interface TranscriptEntry {
  id: string;
  body: string;
  type: string;
  source: string;
  authorName: string | null;
  ts: number;
}

interface TranscriptProvenance {
  label: string;
  note: string;
  totalEntries: number;
  source: string;
  fullTranscriptAvailable: boolean;
}

interface TimelineEvent {
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

/** Wire format from the run events API — uses `id` not `providerId` */
interface ProviderInfo {
  id: string;
  displayName: string;
  tier: number;
  tierLabel: string;
  capabilities: ProviderCapabilities;
}

interface RunEventsResponse {
  run: RunDetail;
  task: TaskContext | null;
  context: RunContext | null;
  transcript: { entries: TranscriptEntry[]; provenance: TranscriptProvenance };
  timeline: TimelineEvent[];
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
    case "assistant_text_final": return "#f59e0b";
    case "run_end": return "#22c55e";
    case "run_error": return "#ef4444";
    case "action_detected": return "#f59e0b";
    case "comment_written": return "#22c55e";
    default: return A.muted;
  }
}

/* ── Constants ── */

const STATUS_TONES: Record<string, { color: string; bg: string; label: string }> = {
  queued: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", label: "Queued" },
  running: { color: "#22c55e", bg: "rgba(34,197,94,0.14)", label: "Running" },
  succeeded: { color: "#d97706", bg: "rgba(217,119,6,0.14)", label: "Succeeded" },
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
  action_detected: { icon: Zap, color: "#f59e0b" },
  comment_written: { icon: MessageSquare, color: "#22c55e" },
  task_updated: { icon: Activity, color: "#22c55e" },
  report_written: { icon: FileText, color: "#d97706" },
  error: { icon: AlertTriangle, color: "#ef4444" },
};

const COMMENT_TYPE_BADGES: Record<string, { label: string; color: string }> = {
  status_update: { label: "report", color: "#d97706" },
  comment: { label: "comment", color: "#22c55e" },
  code_link: { label: "code", color: "#a78bfa" },
  review: { label: "review", color: "#06b6d4" },
  blocker: { label: "blocker", color: "#ef4444" },
};

/* ── Page ── */

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ slug: string; agentId: string; runId: string }>;
}) {
  const { slug, agentId, runId } = use(params);
  const [data, setData] = useState<RunEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [providerExpanded, setProviderExpanded] = useState(false);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [actionDetailExpanded, setActionDetailExpanded] = useState(false);

  const { streamByAgentId } = useLiveStream();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/orchestration/engine/runs/${encodeURIComponent(runId)}/events`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((json: RunEventsResponse) => {
        if (!cancelled) { setData(json); setLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) { setError(err.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [runId]);

  const companyCode = useMemo(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[0] ?? slug;
  }, [slug]);

  const agentStream = data ? streamByAgentId.get(data.run.agentId) ?? null : null;
  const isLive = data?.run.status === "running" && agentStream?.isStreaming;

  const fullTimeline = useMemo(() => {
    if (!data) return [];
    const persisted = data.timeline;
    if (!agentStream || !isLive) return persisted;

    const lastPersistedTs = persisted.length > 0 ? persisted[persisted.length - 1].ts : 0;
    const liveEvents: TimelineEvent[] = agentStream.events
      .filter((e: StreamTranscriptEntry) => new Date(e.ts).getTime() > lastPersistedTs)
      .map((e: StreamTranscriptEntry) => ({
        id: e.id,
        kind: e.kind as MCLiveEventKind,
        summary: e.message,
        ts: new Date(e.ts).getTime(),
        source: "live_stream",
      }));

    return [...persisted, ...liveEvents];
  }, [data, agentStream, isLive]);

  const phases = useMemo(() => groupIntoPhases(fullTimeline), [fullTimeline]);

  const copyValue = useCallback((text: string, field: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: A.muted, fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <Loader size={18} style={{ animation: "spin 1.5s linear infinite" }} />
        Loading run...
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <AlertTriangle size={22} style={{ color: "#f87171", marginBottom: 10 }} />
        <div style={{ color: "#f87171", fontSize: 13, marginBottom: 16 }}>
          {error === "404" ? "Run not found" : `Failed to load: ${error}`}
        </div>
        <Link
          href={buildCanonicalAgentRunsPath(companyCode, agentId)}
          style={{ color: A.accent, fontSize: 12, textDecoration: "none" }}
        >
          Back to runs
        </Link>
      </div>
    );
  }

  const { run, task, context, transcript, provider, provenance } = data;
  const statusTone = STATUS_TONES[run.status] ?? STATUS_TONES.cancelled;
  const durationMs = run.startedAt && run.finishedAt
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : null;
  const result = run.result as Record<string, unknown> | null;
  const hasResult = result && run.status === "succeeded" && typeof result.actionsExecuted === "number";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 820 }}>
      {/* ── Back + Context Bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Link
          href={buildCanonicalAgentRunsPath(companyCode, agentId)}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, color: A.muted, fontSize: 11, textDecoration: "none" }}
        >
          <ArrowLeft size={12} /> Runs
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
            {run.agentEmoji && <span style={{ fontSize: 22, lineHeight: 1 }}>{run.agentEmoji}</span>}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: A.text, fontSize: 15, fontWeight: 600 }}>{run.agentName}</div>
              <div style={{ color: A.muted, fontSize: 11, marginTop: 2 }}>
                {formatInvocationSource(run.invocationSource)}
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
            background: "rgba(217,119,6,0.04)", border: "1px solid rgba(217,119,6,0.12)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <ListChecks size={12} style={{ color: A.accent, flexShrink: 0 }} />
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
          {run.sessionIdAfter && (
            <IdPill label="Session" value={run.sessionIdAfter} onCopy={copyValue} copied={copiedField === "session"} copyKey="session" />
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
            {durationMs != null && <MetaLine label="Duration" value={formatDuration(durationMs)} />}
            <MetaLine label="Source" value={provenance.runTable} mono />
          </div>
        </DisclosureRow>

        {/* Error */}
        {run.error && (
          <div style={{
            marginTop: 10, padding: "8px 10px", borderRadius: 6,
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.18)",
            color: "#f87171", fontSize: 12, lineHeight: 1.5,
          }}>
            {run.error}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════
          SECTION 2: PROVIDER DEPTH (collapsible)
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
            <Shield size={13} style={{ color: A.accent }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: A.textSec }}>{provider.displayName}</span>
            <TierBadge tier={provider.tier} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: A.muted }}>{provider.tierLabel}</span>
            {providerExpanded ? <ChevronDown size={13} style={{ color: A.muted }} /> : <ChevronRight size={13} style={{ color: A.muted }} />}
          </div>
        </button>

        {providerExpanded && (
          <div style={{ marginTop: 10, fontSize: 11 }}>
            <CapabilityGrid capabilities={provider.capabilities} />
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════
          SECTION 3: WHAT THE AGENT SAID (evidence)
          ═══════════════════════════════════════════ */}

      {/* Live transcript */}
      {isLive && agentStream && agentStream.streamingText && (
        <div style={{ ...cardStyle, borderColor: "rgba(6,182,212,0.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Radio size={12} style={{ color: "#06b6d4" }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#06b6d4" }}>Live output</span>
            <span style={{ fontSize: 9, color: A.muted, fontStyle: "italic", marginLeft: "auto" }}>ephemeral</span>
          </div>
          <div style={{
            padding: "10px 12px", borderRadius: 6,
            background: "rgba(6,182,212,0.03)", border: "1px solid rgba(6,182,212,0.1)",
            color: A.text, fontSize: 12, lineHeight: 1.6,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 280, overflowY: "auto",
          }}>
            {agentStream.streamingText.slice(-800)}
          </div>
        </div>
      )}

      {/* Persisted comments (transcript proxy) */}
      {!isLive && transcript.entries.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MessageSquare size={12} style={{ color: "#22c55e" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>{transcript.provenance.label}</span>
            </div>
            <span style={{ fontSize: 10, color: A.muted }}>
              {transcript.provenance.totalEntries} entr{transcript.provenance.totalEntries !== 1 ? "ies" : "y"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {transcript.entries.map((entry) => {
              const badge = COMMENT_TYPE_BADGES[entry.type];
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
                    {entry.authorName && (
                      <span style={{ fontSize: 10, color: A.muted }}>· {entry.authorName}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: A.text, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {entry.body}
                  </div>
                </div>
              );
            })}
          </div>

          <ProvenanceNote text={transcript.provenance.note} />
        </div>
      )}

      {/* ═══════════════════════════════════════════
          SECTION 4: WHAT HAPPENED (timeline)
          ═══════════════════════════════════════════ */}

      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Activity size={12} style={{ color: A.accent }} />
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
                  {/* Phase header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 0",
                  }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: `${phase.color}14`, border: `1px solid ${phase.color}30`,
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

                  {/* Phase events (indented) */}
                  <div style={{
                    marginLeft: 11, paddingLeft: 18,
                    borderLeft: isLastPhase ? "none" : `1px solid rgba(255,255,255,0.06)`,
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
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ProvenanceNote text={provenance.timeline.note} />
      </div>

      {/* ═══════════════════════════════════════════
          SECTION 5: RESULT (if completed)
          ═══════════════════════════════════════════ */}

      {hasResult && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <FileText size={12} style={{ color: A.accent }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Result</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {typeof result!.actionsExecuted === "number" && (
              <ResultChip label="actions" value={result!.actionsExecuted as number} />
            )}
            {typeof result!.reportsImported === "number" && (result!.reportsImported as number) > 0 && (
              <ResultChip label="reports" value={result!.reportsImported as number} />
            )}
            {Array.isArray(result!.tasksCreated) && (result!.tasksCreated as string[]).length > 0 && (
              <ResultChip label="tasks created" value={(result!.tasksCreated as string[]).length} />
            )}
            {typeof result!.actionsSkippedDedup === "number" && (result!.actionsSkippedDedup as number) > 0 && (
              <ResultChip label="skipped" value={result!.actionsSkippedDedup as number} muted />
            )}
            {Array.isArray(result!.errors) && (result!.errors as string[]).length > 0 && (
              <ResultChip label="errors" value={(result!.errors as string[]).length} warn />
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          SECTION 6: TELEMETRY (when available)
          ═══════════════════════════════════════════ */}

      {run.usage && typeof run.usage === "object" && Object.keys(run.usage).length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Clock size={12} style={{ color: A.accent }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: A.textSec }}>Run telemetry</span>
            <span style={{ fontSize: 9, color: A.muted, fontStyle: "italic", marginLeft: "auto" }}>captured values</span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {/* Timing */}
            {typeof (run.usage as Record<string, unknown>).thinkingDurationMs === "number" && (
              <TelemetryChip label="Thinking" value={formatDuration((run.usage as Record<string, unknown>).thinkingDurationMs as number)} />
            )}
            {typeof (run.usage as Record<string, unknown>).actionExecutionMs === "number" && (
              <TelemetryChip label="Actions" value={formatDuration((run.usage as Record<string, unknown>).actionExecutionMs as number)} />
            )}
            {typeof (run.usage as Record<string, unknown>).importDurationMs === "number" && (
              <TelemetryChip label="Import" value={formatDuration((run.usage as Record<string, unknown>).importDurationMs as number)} />
            )}
            {typeof (run.usage as Record<string, unknown>).promptBuildMs === "number" && (
              <TelemetryChip label="Prompt build" value={formatDuration((run.usage as Record<string, unknown>).promptBuildMs as number)} />
            )}

            {/* Size */}
            {typeof (run.usage as Record<string, unknown>).promptChars === "number" && (
              <TelemetryChip label="Prompt" value={`${Math.round(((run.usage as Record<string, unknown>).promptChars as number) / 1000)}k chars`} />
            )}

            {/* Tokens (nullable — not all providers report) */}
            {typeof (run.usage as Record<string, unknown>).inputTokens === "number" && (
              <TelemetryChip label="Input tokens" value={((run.usage as Record<string, unknown>).inputTokens as number).toLocaleString()} />
            )}
            {typeof (run.usage as Record<string, unknown>).outputTokens === "number" && (
              <TelemetryChip label="Output tokens" value={((run.usage as Record<string, unknown>).outputTokens as number).toLocaleString()} />
            )}

            {/* Session */}
            {(run.usage as Record<string, unknown>).sessionReused === true && (
              <TelemetryChip label="Session" value="reused" />
            )}
            {(run.usage as Record<string, unknown>).sessionReused === false && (
              <TelemetryChip label="Session" value="new" />
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

      {/* Pulse animation for live dot */}
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

/* ── Sub-components ── */

function IdPill({ label, value, onCopy, copied, copyKey }: {
  label: string; value: string; onCopy: (v: string, k: string) => void; copied: boolean; copyKey: string;
}) {
  return (
    <span
      onClick={() => onCopy(value, copyKey)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 4, cursor: "pointer",
        background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
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
        background: "rgba(217,119,6,0.12)", color: A.accent,
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

/* CapabilityRow now imported from @/components/orchestration/ProviderPresentation */

function ResultChip({ label, value, warn, muted }: { label: string; value: number; warn?: boolean; muted?: boolean }) {
  const color = warn ? "#f87171" : muted ? A.muted : A.text;
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 5,
      padding: "6px 10px", borderRadius: 6,
      background: warn ? "rgba(248,113,113,0.06)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${warn ? "rgba(248,113,113,0.15)" : "rgba(255,255,255,0.05)"}`,
    }}>
      <span style={{ fontSize: 16, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 10, color: A.muted }}>{label}</span>
    </div>
  );
}

function TelemetryChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", gap: 5,
      padding: "4px 8px", borderRadius: 5,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
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

const cardStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 8,
  background: A.card,
  border: `1px solid ${A.cardBorder}`,
};
