"use client";

import { useEffect, useMemo, useState } from "react";
import { Zap, Clock, ExternalLink, AlertCircle, ChevronRight, Terminal, FileText, Activity } from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import { useAgentProfile, A } from "../agent-context";
import { buildCanonicalRunDetailPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationAgentExecutionRun } from "@/lib/orchestration/types";

/* ── formatting helpers ── */

function fmtTokens(n: number | undefined): string {
  if (n == null || n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number | undefined): string {
  if (ms == null) return "—";
  if (ms < 1_000) return `${ms}ms`;
  const s = Math.round(ms / 1_000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/* ── status / trigger / provider display ── */

const STATUS_TONE: Record<string, { color: string; bg: string; label: string }> = {
  pending:   { color: "#a8a6a0", bg: "rgba(168,166,160,0.14)", label: "Pending" },
  running:   { color: "#22c55e", bg: "rgba(34,197,94,0.14)",   label: "Running" },
  completed: { color: "#4ade80", bg: "rgba(74,222,128,0.14)",  label: "Succeeded" },
  succeeded: { color: "#4ade80", bg: "rgba(74,222,128,0.14)",  label: "Succeeded" },
  failed:    { color: "#f87171", bg: "rgba(248,113,113,0.14)", label: "Failed" },
  cancelled:  { color: "#78716c", bg: "rgba(120,113,108,0.14)", label: "Cancelled" },
  timed_out:  { color: "#f59e0b", bg: "rgba(245,158,11,0.14)", label: "Timed Out" },
  queued:     { color: "#a8a6a0", bg: "rgba(168,166,160,0.14)", label: "Queued" },
};

const TRIGGER_TONE: Record<string, { color: string; bg: string }> = {
  Timer:      { color: "#60a5fa", bg: "rgba(96,165,250,0.18)" },
  Assignment: { color: "#f472b6", bg: "rgba(244,114,182,0.18)" },
  Automation: { color: "#a8a29e", bg: "rgba(168,162,158,0.18)" },
  Kickoff:    { color: "#fbbf24", bg: "rgba(251,191,36,0.18)" },
  API:        { color: "#a78bfa", bg: "rgba(167,139,250,0.18)" },
};

const PROVIDER_TONE: Record<string, { color: string; bg: string }> = {
  openclaw:  { color: "#f59e0b", bg: "rgba(245,158,11,0.14)" },
  codex:     { color: "#60a5fa", bg: "rgba(96,165,250,0.14)" },
  anthropic: { color: "#f87171", bg: "rgba(248,113,113,0.14)" },
};

function StatusBadge({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? STATUS_TONE.cancelled;
  return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: t.color, background: t.bg, fontWeight: 600 }}>{t.label}</span>;
}

function TriggerBadge({ type }: { type: string }) {
  const t = TRIGGER_TONE[type] ?? TRIGGER_TONE.Automation;
  return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: t.color, background: t.bg, fontWeight: 500 }}>{type}</span>;
}

function ProviderBadge({ provider }: { provider: string }) {
  const t = PROVIDER_TONE[provider] ?? { color: A.muted, bg: "rgba(120,113,108,0.14)" };
  const label = provider === "openclaw" || provider === "openclaw-heartbeat"
    ? "OpenClaw"
    : provider;
  return <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: t.color, background: t.bg, fontWeight: 500 }}>{label}</span>;
}

/* ── run detail fetcher types ── */
interface RunDetailData {
  run: Record<string, unknown>;
  task: { id: string; title: string; key: string | null; status: string | null; priority: string | null } | null;
  context: { wakeSource: string; wakeReason: string; taskKey: string | null; direction: string | null } | null;
  transcript: { entries: Array<{ id: string; body: string; type: string; source: string; authorName: string | null; ts: number }>; provenance: { label: string; note: string; totalEntries: number } };
  invocation: Record<string, unknown>;
  metrics: Record<string, unknown>;
  providerExecution: Record<string, unknown>;
  timeline: Array<{ id: string; kind: string; summary: string; ts: number; source: string }>;
  provider: Record<string, unknown>;
}

/* ── main page ── */

export default function AgentRunsPage() {
  const { profile, agentId } = useAgentProfile();
  const { executionHistory } = profile;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<{ runId: string; data: RunDetailData | null } | null>(null);

  const companyCode = useMemo(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[0] ?? "";
  }, []);

  const selectedRun = useMemo(
    () => executionHistory.find((r) => r.id === selectedId) ?? (executionHistory.length > 0 ? executionHistory[0] : null),
    [executionHistory, selectedId]
  );
  const activeId = selectedId ?? selectedRun?.id ?? null;
  const detailData = activeId && detailState?.runId === activeId ? detailState.data : null;
  const detailLoading = Boolean(activeId && detailState?.runId !== activeId);

  useEffect(() => {
    if (!activeId) return;

    let cancelled = false;
    const runId = activeId;
    fetch(`/api/orchestration/engine/runs/${runId}/events`)
      .then(async (res) => {
        const data = res.ok ? (await res.json()) as RunDetailData : null;
        if (!cancelled) setDetailState({ runId, data });
      })
      .catch(() => {
        if (!cancelled) setDetailState({ runId, data: null });
      });

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  if (executionHistory.length === 0) {
    return (
      <div style={cardStyle}>
        <SectionHeader icon={<Zap size={13} />} label="Execution Runs" />
        <div style={{ padding: 32, textAlign: "center", color: A.muted, fontSize: 12, borderRadius: 6, border: "1px dashed rgba(120,113,108,0.35)" }}>
          No execution runs yet
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 520 }}>
      {/* ── Left: run list ── */}
      <div style={{ width: 340, flexShrink: 0, ...cardStyle, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "none", overflowY: "auto", maxHeight: "calc(100vh - 220px)" }}>
        <SectionHeader icon={<Zap size={13} />} label={`Runs (${executionHistory.length})`} />
        {executionHistory.map((run) => (
          <RunListItem key={run.id} run={run} isActive={run.id === activeId} onClick={() => setSelectedId(run.id)} />
        ))}
      </div>

      {/* ── Right: run detail ── */}
      <div style={{ flex: 1, ...cardStyle, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, overflowY: "auto", maxHeight: "calc(100vh - 220px)" }}>
        {selectedRun && (
          <RunDetailPanel
            run={selectedRun}
            detail={detailData}
            loading={detailLoading}
            companyCode={companyCode}
            agentId={agentId}
          />
        )}
      </div>
    </div>
  );
}

/* ── Left list item ── */

function RunListItem({ run, isActive, onClick }: { run: OrchestrationAgentExecutionRun; isActive: boolean; onClick: () => void }) {
  const totalTokens = (run.inputTokens ?? 0) + (run.outputTokens ?? 0);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "flex-start", gap: 8, width: "100%",
        padding: "10px 10px", textAlign: "left",
        background: isActive ? "rgba(255,255,255,0.05)" : "transparent",
        border: "none", cursor: "pointer", borderRadius: 6,
        borderLeft: isActive ? "2px solid #f59e0b" : "2px solid transparent",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      {/* Status dot */}
      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, marginTop: 4, background: (STATUS_TONE[run.status] ?? STATUS_TONE.cancelled).color }} />
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row 1: ID + trigger + age */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: A.text, fontWeight: 500 }}>{run.id.slice(0, 8)}</span>
          {run.triggerType && <TriggerBadge type={run.triggerType} />}
          <span style={{ marginLeft: "auto", fontSize: 10, color: A.muted, flexShrink: 0 }}>{formatAge(run.startedAt ?? run.createdAt)}</span>
        </div>
        {/* Row 2: token count */}
        <div style={{ fontSize: 11, color: A.muted, marginTop: 2 }}>
          {totalTokens > 0 ? fmtTokens(totalTokens) + " tok" : run.durationMs != null ? fmtDuration(run.durationMs) : "—"}
        </div>
      </div>
    </button>
  );
}

/* ── Right detail panel ── */

function RunDetailPanel({ run, detail, loading, companyCode, agentId }: {
  run: OrchestrationAgentExecutionRun;
  detail: RunDetailData | null;
  loading: boolean;
  companyCode: string;
  agentId: string;
}) {
  const detailHref = buildCanonicalRunDetailPath(companyCode, agentId, run.id);
  const metrics = detail?.metrics as Record<string, unknown> | undefined;
  const provExec = detail?.providerExecution as Record<string, unknown> | undefined;
  const invocation = detail?.invocation as Record<string, unknown> | undefined;
  const runData = detail?.run as Record<string, unknown> | undefined;
  const context = detail?.context as { wakeSource?: string; wakeReason?: string; direction?: string; taskKey?: string | null } | undefined;

  return (
    <div>
      {/* ── Status + timing header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 6 }}><StatusBadge status={run.status} /></div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 15, color: A.text, fontWeight: 500 }}>
            <Clock size={14} style={{ color: A.muted }} />
            <span>{fmtTime(run.startedAt)}</span>
            {run.completedAt && <><span style={{ color: A.muted }}>→</span><span>{fmtTime(run.completedAt)}</span></>}
          </div>
          <div style={{ fontSize: 11, color: A.muted, marginTop: 3 }}>
            {fmtDate(run.startedAt ?? run.createdAt)} · {formatAge(run.startedAt ?? run.createdAt)} ago
          </div>
          <div style={{ fontSize: 12, color: A.textSec, marginTop: 2 }}>
            Duration: <span style={{ color: A.text, fontWeight: 500 }}>{fmtDuration(run.durationMs)}</span>
          </div>
        </div>
        {/* Token stats 2x2 grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 20px", textAlign: "right" }}>
          <StatCell label="Input" value={fmtTokens(run.inputTokens ?? num(metrics?.inputTokens))} />
          <StatCell label="Output" value={fmtTokens(run.outputTokens ?? num(metrics?.outputTokens))} />
          <StatCell label="Cached" value={fmtTokens(run.cacheReadTokens ?? num(metrics?.cacheReadInputTokens))} />
          <StatCell label="Cost" value={fmtCost(run.totalCostUsd ?? num(metrics?.totalCostUsd))} />
        </div>
      </div>

      <Divider />

      {/* ── Session ── */}
      <CollapsibleSection icon={<Activity size={12} />} title="Session" defaultOpen={false}>
        <KV label="Session ID" value={run.sessionId} mono />
        {runData?.sessionIdBefore != null && <KV label="Session Before" value={String(runData.sessionIdBefore)} mono />}
        {runData?.sessionIdAfter != null && <KV label="Session After" value={String(runData.sessionIdAfter)} mono />}
        {metrics?.sessionReused != null && <KV label="Session Reused" value={String(metrics.sessionReused)} />}
        {!run.sessionId && !runData?.sessionIdBefore && <div style={{ fontSize: 11, color: A.muted, fontStyle: "italic" }}>No session data</div>}
      </CollapsibleSection>

      <Divider />

      {/* ── Invocation ── */}
      <CollapsibleSection icon={<Terminal size={12} />} title="Invocation" defaultOpen>
        {run.triggerType && <KV label="Trigger" value={<TriggerBadge type={run.triggerType} />} />}
        {run.triggerReason && <KV label="Reason" value={run.triggerReason} />}
        {context?.wakeSource && <KV label="Wake Source" value={context.wakeSource} />}
        {context?.wakeReason && <KV label="Wake Reason" value={context.wakeReason} />}
        {context?.direction && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: A.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 3 }}>Direction</div>
            <div style={{ fontSize: 11, color: A.textSec, lineHeight: 1.5 }}>{context.direction}</div>
          </div>
        )}
        <KV label="Provider" value={<ProviderBadge provider={run.provider} />} />
        {provExec?.cliCommand != null && <KV label="Command" value={String(provExec.cliCommand)} mono />}
        {provExec?.modelName != null && <KV label="Model" value={String(provExec.modelName)} />}
        {provExec?.modelId != null && provExec?.modelName == null && <KV label="Model" value={String(provExec.modelId)} />}
        {invocation?.note != null && <div style={{ marginTop: 6, fontSize: 11, color: A.muted, fontStyle: "italic" }}>{String(invocation.note)}</div>}
        {!run.triggerType && !provExec?.cliCommand && !context?.wakeSource && (
          <div style={{ fontSize: 11, color: A.muted, fontStyle: "italic" }}>No invocation metadata available</div>
        )}
      </CollapsibleSection>

      <Divider />

      {/* ── Task reference ── */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: A.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, marginBottom: 4 }}>Task</div>
        <div style={{ fontSize: 12, color: A.text, fontWeight: 500 }}>
          {run.taskKey && <span style={{ fontFamily: "monospace", fontSize: 11, color: A.textSec, marginRight: 6 }}>{run.taskKey}</span>}
          {run.taskTitle}
        </div>
        <div style={{ fontSize: 11, color: A.muted, marginTop: 2 }}>{run.projectName}</div>
      </div>

      {/* ── Transcript preview ── */}
      {detail?.transcript && detail.transcript.entries.length > 0 && (
        <>
          <Divider />
          <CollapsibleSection icon={<FileText size={12} />} title={`Transcript (${detail.transcript.entries.length})`} defaultOpen={false}>
            <div style={{ fontSize: 10, color: A.muted, marginBottom: 6, fontStyle: "italic" }}>{detail.transcript.provenance.label}</div>
            {detail.transcript.entries.slice(0, 3).map((entry) => (
              <div key={entry.id} style={{ marginBottom: 8, padding: "6px 8px", borderRadius: 4, background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(120,113,108,0.12)" }}>
                <div style={{ fontSize: 10, color: A.muted, marginBottom: 2 }}>
                  {entry.authorName && <span style={{ color: A.textSec }}>{entry.authorName}</span>}
                  {entry.source !== "mission_control" && <span> · {entry.source}</span>}
                </div>
                <div style={{ fontSize: 11, color: A.textSec, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {entry.body.length > 200 ? entry.body.slice(0, 197) + "..." : entry.body}
                </div>
              </div>
            ))}
            {detail.transcript.entries.length > 3 && (
              <div style={{ fontSize: 10, color: A.muted }}>+ {detail.transcript.entries.length - 3} more entries</div>
            )}
          </CollapsibleSection>
        </>
      )}

      {/* ── Error ── */}
      {run.errorMessage && (
        <>
          <Divider />
          <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "#f87171", marginBottom: 4 }}>
              <AlertCircle size={12} /> Error
            </div>
            <pre style={{ fontSize: 11, color: "#fca5a5", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontFamily: "monospace", lineHeight: 1.5 }}>
              {run.errorMessage}
            </pre>
          </div>
        </>
      )}

      {/* ── Extended metrics ── */}
      {metrics && Object.keys(metrics).length > 4 && (
        <>
          <Divider />
          <CollapsibleSection icon={<Activity size={12} />} title="Run Metrics" defaultOpen={false}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 12px" }}>
              {metrics.promptChars != null && <MiniStat label="Prompt Chars" value={fmtTokens(num(metrics.promptChars))} />}
              {metrics.actionsExecuted != null && <MiniStat label="Actions" value={String(metrics.actionsExecuted)} />}
              {metrics.messagesImported != null && <MiniStat label="Messages" value={String(metrics.messagesImported)} />}
              {metrics.reportsImported != null && <MiniStat label="Reports" value={String(metrics.reportsImported)} />}
              {metrics.tasksCreated != null && <MiniStat label="Tasks Created" value={String(metrics.tasksCreated)} />}
              {metrics.errorCount != null && Number(metrics.errorCount) > 0 && <MiniStat label="Errors" value={String(metrics.errorCount)} />}
            </div>
          </CollapsibleSection>
        </>
      )}

      {/* ── Full detail link ── */}
      <div style={{ marginTop: 14 }}>
        <a
          href={detailHref}
          onClick={(e) => { e.preventDefault(); window.location.href = detailHref; }}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: A.textSec, textDecoration: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = A.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = A.textSec; }}
        >
          View full run details <ExternalLink size={10} />
        </a>
      </div>

      {loading && <div style={{ position: "absolute", top: 8, right: 12, fontSize: 10, color: A.muted }}>Loading...</div>}
    </div>
  );
}

/* ── Shared UI atoms ── */

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 12, fontWeight: 600 }}>
      <span style={{ color: A.textSec, display: "flex" }}>{icon}</span>
      <span style={{ color: A.text }}>{label}</span>
    </div>
  );
}

function CollapsibleSection({ icon, title, defaultOpen = true, children }: { icon: React.ReactNode; title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 4 }}>
      <button type="button" onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: "4px 0", width: "100%" }}>
        <ChevronRight size={12} style={{ color: A.muted, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
        <span style={{ color: A.muted, display: "flex" }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: A.textSec, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</span>
      </button>
      {open && <div style={{ paddingLeft: 20, paddingTop: 4 }}>{children}</div>}
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value == null) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 11 }}>
      <span style={{ color: A.muted, flexShrink: 0, minWidth: 80 }}>{label}</span>
      <span style={{ color: A.textSec, fontFamily: mono ? "monospace" : "inherit", fontSize: mono ? 10 : 11, wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: A.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 14, color: A.text, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: A.muted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 12, color: A.textSec, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(120,113,108,0.12)", margin: "10px 0" }} />;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function fmtCost(v: number | undefined): string {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `0.5px solid ${A.cardBorder}`,
  position: "relative",
};
