"use client";

import { useMemo, useState } from "react";
import { Zap, ArrowRight, Clock, ExternalLink, AlertCircle } from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import { useAgentProfile, A } from "../layout";
import { buildCanonicalRunDetailPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationAgentExecutionRun } from "@/lib/orchestration/types";

/* ── helpers ── */

function fmtTokens(n: number | undefined): string {
  if (n == null) return "—";
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
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const STATUS_TONE: Record<string, { color: string; bg: string; label: string }> = {
  pending:   { color: "#a8a6a0", bg: "rgba(168,166,160,0.14)", label: "Pending" },
  running:   { color: "#22c55e", bg: "rgba(34,197,94,0.14)",   label: "Running" },
  completed: { color: "#4ade80", bg: "rgba(74,222,128,0.14)",  label: "Completed" },
  failed:    { color: "#f87171", bg: "rgba(248,113,113,0.14)", label: "Failed" },
  cancelled: { color: "#78716c", bg: "rgba(120,113,108,0.14)", label: "Cancelled" },
};

const PROVIDER_TONE: Record<string, { color: string; bg: string }> = {
  openclaw:  { color: "#f59e0b", bg: "rgba(245,158,11,0.14)" },
  paperclip: { color: "#a78bfa", bg: "rgba(167,139,250,0.14)" },
  codex:     { color: "#60a5fa", bg: "rgba(96,165,250,0.14)" },
  anthropic: { color: "#f87171", bg: "rgba(248,113,113,0.14)" },
};

function StatusBadge({ status }: { status: string }) {
  const t = STATUS_TONE[status] ?? STATUS_TONE.cancelled;
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: t.color, background: t.bg, fontWeight: 600, letterSpacing: "0.02em" }}>
      {t.label}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const t = PROVIDER_TONE[provider] ?? { color: A.muted, bg: "rgba(120,113,108,0.14)" };
  return (
    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, color: t.color, background: t.bg, fontWeight: 500 }}>
      {provider}
    </span>
  );
}

/* ── main page ── */

export default function AgentRunsPage() {
  const { profile, agentId } = useAgentProfile();
  const { executionHistory } = profile;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const companyCode = useMemo(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[0] ?? "";
  }, []);

  const selectedRun = useMemo(
    () => executionHistory.find((r) => r.id === selectedId) ?? (executionHistory.length > 0 ? executionHistory[0] : null),
    [executionHistory, selectedId]
  );

  const activeId = selectedId ?? selectedRun?.id;

  if (executionHistory.length === 0) {
    return (
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 12, fontWeight: 600 }}>
          <Zap size={13} style={{ color: A.textSec }} />
          <span style={{ color: A.text }}>Execution Runs</span>
        </div>
        <div style={{ padding: 32, textAlign: "center", color: A.muted, fontSize: 12, borderRadius: 6, border: "1px dashed rgba(120,113,108,0.35)" }}>
          No execution runs yet
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 500 }}>
      {/* ── Left: run list ── */}
      <div style={{ width: 360, flexShrink: 0, ...cardStyle, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: "none", overflowY: "auto", maxHeight: "calc(100vh - 240px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 12, fontWeight: 600 }}>
          <Zap size={13} style={{ color: A.textSec }} />
          <span style={{ color: A.text }}>Runs ({executionHistory.length})</span>
        </div>

        {executionHistory.map((run) => {
          const isActive = run.id === activeId;
          const totalTokens = (run.inputTokens ?? 0) + (run.outputTokens ?? 0);
          return (
            <button
              key={run.id}
              type="button"
              onClick={() => setSelectedId(run.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
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
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: (STATUS_TONE[run.status] ?? STATUS_TONE.cancelled).color,
              }} />

              {/* Main content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 11, color: A.text, fontWeight: 500 }}>
                    {run.id.slice(0, 8)}
                  </span>
                  <ProviderBadge provider={run.provider} />
                  <span style={{ marginLeft: "auto", fontSize: 10, color: A.muted, flexShrink: 0 }}>
                    {formatAge(run.startedAt ?? run.createdAt)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: A.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {totalTokens > 0 ? fmtTokens(totalTokens) + " tok" : run.taskTitle}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Right: run detail ── */}
      {selectedRun && (
        <div style={{ flex: 1, ...cardStyle, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, overflowY: "auto", maxHeight: "calc(100vh - 240px)" }}>
          <RunDetail run={selectedRun} companyCode={companyCode} agentId={agentId} />
        </div>
      )}
    </div>
  );
}

/* ── Run detail panel ── */

function RunDetail({ run, companyCode, agentId }: { run: OrchestrationAgentExecutionRun; companyCode: string; agentId: string }) {
  const detailHref = buildCanonicalRunDetailPath(companyCode, agentId, run.id);

  return (
    <div>
      {/* Status + timing header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 8 }}>
            <StatusBadge status={run.status} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: A.text, fontWeight: 500 }}>
            <Clock size={13} style={{ color: A.muted }} />
            <span>{fmtTime(run.startedAt)}</span>
            {run.completedAt && (
              <>
                <span style={{ color: A.muted }}>→</span>
                <span>{fmtTime(run.completedAt)}</span>
              </>
            )}
          </div>
          <div style={{ fontSize: 11, color: A.muted, marginTop: 4 }}>
            {fmtDate(run.startedAt ?? run.createdAt)}
            {" · "}
            {formatAge(run.startedAt ?? run.createdAt)} ago
          </div>
          <div style={{ fontSize: 12, color: A.textSec, marginTop: 2 }}>
            Duration: <span style={{ color: A.text, fontWeight: 500 }}>{fmtDuration(run.durationMs)}</span>
          </div>
        </div>

        {/* Token stats grid */}
        {(run.inputTokens != null || run.outputTokens != null) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px", textAlign: "right" }}>
            <StatCell label="Input" value={fmtTokens(run.inputTokens)} />
            <StatCell label="Output" value={fmtTokens(run.outputTokens)} />
            <StatCell label="Cached" value={fmtTokens(run.cacheReadTokens)} />
            <StatCell label="Cost" value={run.totalCostUsd != null ? `$${run.totalCostUsd.toFixed(2)}` : "—"} />
          </div>
        )}
      </div>

      <div style={{ height: 1, background: "rgba(120,113,108,0.15)", margin: "12px 0" }} />

      {/* Task reference */}
      <DetailSection label="Task">
        <span style={{ fontSize: 12, color: A.text }}>{run.taskTitle}</span>
        <span style={{ fontSize: 11, color: A.muted, marginTop: 2, display: "block" }}>
          {run.projectName}
        </span>
      </DetailSection>

      {/* Provider + Session */}
      <div style={{ display: "flex", gap: 24, marginTop: 12 }}>
        <DetailSection label="Provider">
          <ProviderBadge provider={run.provider} />
        </DetailSection>
        {run.sessionId && (
          <DetailSection label="Session">
            <span style={{ fontFamily: "monospace", fontSize: 11, color: A.textSec }}>{run.sessionId.slice(0, 12)}</span>
          </DetailSection>
        )}
      </div>

      {/* Error message */}
      {run.errorMessage && (
        <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 6, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "#f87171", marginBottom: 4 }}>
            <AlertCircle size={12} />
            Error
          </div>
          <pre style={{ fontSize: 11, color: "#fca5a5", whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontFamily: "monospace", lineHeight: 1.5 }}>
            {run.errorMessage}
          </pre>
        </div>
      )}

      {/* Full detail link */}
      <div style={{ marginTop: 16 }}>
        <a
          href={detailHref}
          onClick={(e) => { e.preventDefault(); window.location.href = detailHref; }}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: A.textSec, textDecoration: "none" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = A.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = A.textSec; }}
        >
          View full run details
          <ExternalLink size={10} />
        </a>
      </div>
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

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: A.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `0.5px solid ${A.cardBorder}`,
};
