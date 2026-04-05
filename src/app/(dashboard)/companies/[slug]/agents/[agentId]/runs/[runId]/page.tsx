"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock3,
  Copy,
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
} from "lucide-react";
import { A } from "../../layout";
import { useLiveStream } from "@/components/live/LiveStreamProvider";
import { buildCanonicalAgentRunsPath } from "@/lib/orchestration/route-paths";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";
import type { StreamTranscriptEntry } from "@/hooks/useLiveRunStream";

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

interface ProviderCapabilities {
  liveText: boolean;
  actionDetection: boolean;
  structuredTools: boolean;
  thinking: boolean;
  runSteering: boolean;
  persistedTranscript: boolean;
}

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
  run_end: { icon: Square, color: "#06b6d4" },
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

  const copyToClipboard = (text: string, field: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: A.muted, fontSize: 13 }}>
        Loading run details...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <AlertTriangle size={20} style={{ color: "#f87171", marginBottom: 8 }} />
        <div style={{ color: "#f87171", fontSize: 13 }}>
          {error === "404" ? "Run not found" : `Failed to load run: ${error}`}
        </div>
        <Link
          href={buildCanonicalAgentRunsPath(companyCode, agentId)}
          style={{ color: A.accent, fontSize: 12, marginTop: 12, display: "inline-block" }}
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
    : run.startedAt
      ? Date.now() - new Date(run.startedAt).getTime()
      : null;
  const result = run.result as Record<string, unknown> | null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Back link ── */}
      <Link
        href={buildCanonicalAgentRunsPath(companyCode, agentId)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: A.muted, fontSize: 12, textDecoration: "none", width: "fit-content",
        }}
      >
        <ArrowLeft size={13} /> All runs
      </Link>

      {/* ── Task Context (first-class, prominent) ── */}
      {task && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: A.accent, fontSize: 12, fontWeight: 600 }}>
            <ListChecks size={13} /> Task
          </div>
          <div style={{ color: A.text, fontSize: 14, fontWeight: 500, lineHeight: 1.4 }}>
            {task.title ?? "Untitled task"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, fontSize: 11 }}>
            {task.key && (
              <span style={{
                fontFamily: "monospace", padding: "1px 6px", borderRadius: 4,
                background: "rgba(217,119,6,0.12)", color: A.accent,
              }}>
                {task.key}
              </span>
            )}
            {task.status && (
              <span style={{ color: A.textSec }}>{task.status.replace(/_/g, " ")}</span>
            )}
            {task.priority && (
              <span style={{ color: A.muted }}>{task.priority}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Run Header ── */}
      <div style={{
        ...cardStyle,
        borderColor: isLive ? "rgba(6,182,212,0.4)" : A.cardBorder,
        boxShadow: isLive ? "0 0 20px rgba(6,182,212,0.15)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {run.agentEmoji && <span style={{ fontSize: 20 }}>{run.agentEmoji}</span>}
            <div>
              <div style={{ color: A.text, fontSize: 14, fontWeight: 600 }}>{run.agentName}</div>
              <div style={{ color: A.muted, fontSize: 11, marginTop: 1 }}>
                {formatInvocationSource(run.invocationSource)}
                {run.triggerDetail && ` · ${run.triggerDetail}`}
                {context?.wakeReason && ` · ${context.wakeReason}`}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {isLive && (
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                color: "#06b6d4", background: "rgba(6,182,212,0.14)",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <Radio size={9} /> LIVE
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

        {/* Identity grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px", fontSize: 11, color: A.textSec,
        }}>
          <MetaRow label="Run ID" value={run.id.slice(0, 12)} mono onCopy={() => copyToClipboard(run.id, "runId")} copied={copiedField === "runId"} />
          {run.sessionIdAfter && (
            <MetaRow label="Session" value={run.sessionIdAfter.slice(0, 12)} mono onCopy={() => copyToClipboard(run.sessionIdAfter!, "session")} copied={copiedField === "session"} />
          )}
          {run.startedAt && <MetaRow label="Started" value={new Date(run.startedAt).toLocaleString()} />}
          {run.finishedAt && <MetaRow label="Finished" value={new Date(run.finishedAt).toLocaleString()} />}
          {durationMs != null && <MetaRow label="Duration" value={formatDuration(durationMs)} />}
          <MetaRow label="Run table" value={provenance.runTable} mono />
        </div>

        {run.error && (
          <div style={{
            marginTop: 10, padding: "8px 10px", borderRadius: 6,
            background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)",
            color: "#f87171", fontSize: 12,
          }}>
            {run.error}
          </div>
        )}
      </div>

      {/* ── Provider & Capability Depth ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: A.accent, fontSize: 12, fontWeight: 600 }}>
          <Shield size={13} /> Provider
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: A.text, fontSize: 13, fontWeight: 500 }}>{provider.displayName}</div>
            <div style={{ color: A.muted, fontSize: 11, marginTop: 2 }}>
              Tier {provider.tier} · {provider.tierLabel}
            </div>
          </div>
          <div style={{
            padding: "4px 10px", borderRadius: 6,
            background: "rgba(217,119,6,0.08)", border: "1px solid rgba(217,119,6,0.2)",
            fontSize: 10, fontWeight: 600, color: A.accent,
          }}>
            TIER {provider.tier}
          </div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11 }}>
          <CapabilityRow label="Live text streaming" available={provider.capabilities.liveText} />
          <CapabilityRow label="Action detection" available={provider.capabilities.actionDetection} />
          <CapabilityRow label="Structured tool events" available={provider.capabilities.structuredTools} />
          <CapabilityRow label="Thinking / reasoning" available={provider.capabilities.thinking} />
          <CapabilityRow label="Run steering" available={provider.capabilities.runSteering} />
          <CapabilityRow label="Persisted transcript" available={provider.capabilities.persistedTranscript} />
        </div>
      </div>

      {/* ── Live Transcript (active runs only) ── */}
      {isLive && agentStream && agentStream.streamingText && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: "#06b6d4", fontSize: 12, fontWeight: 600 }}>
            <Radio size={13} /> Live Assistant Output
          </div>
          <div style={{
            padding: "10px 12px", borderRadius: 6,
            background: "rgba(6,182,212,0.04)", border: "1px solid rgba(6,182,212,0.15)",
            color: A.text, fontSize: 12, lineHeight: 1.6,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 300, overflowY: "auto",
          }}>
            {agentStream.streamingText.slice(-800)}
          </div>
          <div style={{ marginTop: 4, fontSize: 10, color: A.muted, fontStyle: "italic" }}>
            Streaming via SSE from provider. Ephemeral — not persisted after run completes.
          </div>
        </div>
      )}

      {/* ── Persisted Agent Comments (transcript proxy for completed runs) ── */}
      {!isLive && transcript.entries.length > 0 && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#22c55e", fontSize: 12, fontWeight: 600 }}>
              <MessageSquare size={13} /> {transcript.provenance.label}
            </div>
            <span style={{ fontSize: 10, color: A.muted }}>
              {transcript.provenance.totalEntries} entr{transcript.provenance.totalEntries !== 1 ? "ies" : "y"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {transcript.entries.map((entry) => (
              <div key={entry.id} style={{
                padding: "8px 10px", borderRadius: 6,
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
              }}>
                <div style={{ fontSize: 12, color: A.text, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {entry.body}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 10, color: A.muted }}>
                  <span>{formatTimestamp(entry.ts)}</span>
                  <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                  <span>{entry.type}</span>
                  <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                  <span>{entry.source}</span>
                  {entry.authorName && (
                    <>
                      <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                      <span>{entry.authorName}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Honest provenance note */}
          <ProvenanceNote icon={Info} text={transcript.provenance.note} />
        </div>
      )}

      {/* ── Event Timeline ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: A.accent, fontSize: 12, fontWeight: 600 }}>
            <Activity size={13} /> Event Timeline
          </div>
          <div style={{ fontSize: 10, color: A.muted }}>
            {fullTimeline.length} event{fullTimeline.length !== 1 ? "s" : ""}
          </div>
        </div>

        {fullTimeline.length === 0 ? (
          <div style={{
            padding: 24, textAlign: "center", color: A.muted, fontSize: 12,
            borderRadius: 6, border: "1px dashed rgba(120,113,108,0.35)",
          }}>
            No events recorded for this run
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {fullTimeline.map((event, i) => {
              const iconDef = EVENT_ICONS[event.kind];
              const Icon = iconDef?.icon ?? Zap;
              const iconColor = iconDef?.color ?? A.muted;
              const isLast = i === fullTimeline.length - 1;

              return (
                <div key={event.id} style={{
                  display: "flex", gap: 10, padding: "8px 0",
                  borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.04)",
                }}>
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    width: 24, flexShrink: 0, paddingTop: 2,
                  }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: "50%",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: `${iconColor}18`,
                    }}>
                      <Icon size={11} style={{ color: iconColor }} />
                    </div>
                    {!isLast && (
                      <div style={{ width: 1, flex: 1, marginTop: 4, background: "rgba(255,255,255,0.06)" }} />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                    <div style={{ fontSize: 12, color: A.text, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {event.summary}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 10, color: A.muted }}>
                      <span>{formatTimestamp(event.ts)}</span>
                      <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                      <span style={{ color: iconColor, opacity: 0.7 }}>{formatEventKind(event.kind)}</span>
                      <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                      <span style={{ opacity: 0.5 }}>{formatSource(event.source)}</span>
                      {event.source === "persisted_comment" && event.authorName && (
                        <>
                          <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                          <span>{event.authorName}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <ProvenanceNote icon={Info} text={provenance.timeline.note} />
      </div>

      {/* ── Result Summary (completed runs) ── */}
      {result && run.status === "succeeded" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: A.accent, fontSize: 12, fontWeight: 600 }}>
            <FileText size={13} /> Result
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {typeof result.actionsExecuted === "number" && <ResultStat label="Actions executed" value={result.actionsExecuted} />}
            {typeof result.reportsImported === "number" && <ResultStat label="Reports imported" value={result.reportsImported} />}
            {Array.isArray(result.tasksCreated) && result.tasksCreated.length > 0 && <ResultStat label="Tasks created" value={result.tasksCreated.length} />}
            {typeof result.actionsSkippedDedup === "number" && result.actionsSkippedDedup > 0 && <ResultStat label="Skipped (dedup)" value={result.actionsSkippedDedup} />}
            {Array.isArray(result.errors) && result.errors.length > 0 && <ResultStat label="Errors" value={result.errors.length} warn />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function MetaRow({ label, value, mono, onCopy, copied }: {
  label: string; value: string; mono?: boolean; onCopy?: () => void; copied?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ color: A.muted, width: 70, flexShrink: 0 }}>{label}</span>
      <span style={{ color: A.text, fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? 10 : 11 }}>{value}</span>
      {onCopy && (
        <button onClick={onCopy} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: A.muted, display: "flex" }}>
          {copied ? <Check size={10} style={{ color: "#22c55e" }} /> : <Copy size={10} />}
        </button>
      )}
    </div>
  );
}

function CapabilityRow({ label, available }: { label: string; available: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: available ? "#22c55e" : "rgba(120,113,108,0.4)" }} />
      <span style={{ color: available ? A.textSec : A.muted }}>{label}</span>
      {!available && <span style={{ color: "rgba(120,113,108,0.5)", fontSize: 10, marginLeft: "auto" }}>not available</span>}
    </div>
  );
}

function ResultStat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div style={{
      padding: "8px 10px", borderRadius: 6,
      background: warn ? "rgba(248,113,113,0.06)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${warn ? "rgba(248,113,113,0.2)" : "rgba(255,255,255,0.06)"}`,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: warn ? "#f87171" : A.text }}>{value}</div>
      <div style={{ fontSize: 10, color: A.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ProvenanceNote({ icon: Icon, text }: { icon: typeof Info; text: string }) {
  return (
    <div style={{
      marginTop: 12, padding: "8px 10px", borderRadius: 6,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
      fontSize: 10, color: A.muted, lineHeight: 1.5,
      display: "flex", gap: 8, alignItems: "flex-start",
    }}>
      <Icon size={12} style={{ flexShrink: 0, marginTop: 1, opacity: 0.5 }} />
      <span style={{ fontStyle: "italic" }}>{text}</span>
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
  return `${mins}m ${remSecs}s`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatEventKind(kind: MCLiveEventKind): string {
  const labels: Partial<Record<MCLiveEventKind, string>> = {
    run_start: "run start",
    run_end: "run end",
    run_error: "error",
    run_progress: "processing",
    assistant_text_delta: "streaming",
    assistant_text_final: "response parsed",
    tool_call_start: "tool call",
    tool_call_end: "tool done",
    action_detected: "action",
    comment_written: "comment",
    task_updated: "task update",
    report_written: "report",
    error: "error",
  };
  return labels[kind] ?? kind;
}

function formatSource(source: string): string {
  const labels: Record<string, string> = {
    engine_milestone: "engine",
    persisted_comment: "comment",
    live_stream: "live",
  };
  return labels[source] ?? source;
}

function formatInvocationSource(source: string): string {
  const labels: Record<string, string> = {
    timer: "Scheduled run",
    wakeup_request: "Wakeup request",
    issue_assigned: "Task assigned",
    kickoff: "Initial kickoff",
    openclaw: "OpenClaw execution",
  };
  return labels[source] ?? source;
}

/* ── Styles ── */

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `1px solid ${A.cardBorder}`,
};
