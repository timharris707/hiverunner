"use client";

import { useState } from "react";
import { Zap, ChevronDown, ChevronRight } from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import { useAgentProfile, A } from "../layout";
import type { OrchestrationAgentExecutionRun } from "@/lib/orchestration/types";

export default function AgentRunsPage() {
  const { profile } = useAgentProfile();
  const { executionHistory } = profile;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, color: A.accent, fontSize: 12, fontWeight: 600 }}>
        <Zap size={13} />
        Execution Runs ({executionHistory.length})
      </div>

      {executionHistory.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center", color: A.muted, fontSize: 12, borderRadius: 6, border: "1px dashed rgba(120,113,108,0.35)" }}>
          No execution runs yet
        </div>
      ) : (
        <>
          {/* table header */}
          <div style={{ ...headerRow }}>
            <span style={{ width: 100 }}>ID</span>
            <span style={{ width: 80 }}>Status</span>
            <span style={{ flex: 1, minWidth: 120 }}>Task</span>
            <span style={{ width: 80 }}>Provider</span>
            <span style={{ width: 90 }}>Started</span>
            <span style={{ width: 70 }}>Duration</span>
          </div>

          {executionHistory.map((run) => {
            const expanded = expandedId === run.id;
            return (
              <div key={run.id}>
                <button
                  onClick={() => setExpandedId(expanded ? null : run.id)}
                  style={{
                    ...dataRow,
                    cursor: "pointer", background: expanded ? "rgba(217,119,6,0.04)" : "transparent",
                    border: "none", width: "100%", textAlign: "left",
                  }}
                >
                  <span style={{ width: 100, fontFamily: "monospace", fontSize: 11, color: A.muted, display: "flex", alignItems: "center", gap: 4 }}>
                    {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    {run.id.slice(0, 8)}
                  </span>
                  <span style={{ width: 80 }}>
                    <RunStatusBadge status={run.status} />
                  </span>
                  <span style={{ flex: 1, minWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: A.text }}>
                    {run.taskTitle}
                  </span>
                  <span style={{ width: 80, color: A.textSec }}>{run.provider}</span>
                  <span style={{ width: 90, color: A.muted }}>{formatAge(run.startedAt ?? run.createdAt)}</span>
                  <span style={{ width: 70, color: A.muted }}>
                    {run.durationMs != null ? `${Math.round(run.durationMs / 1000)}s` : "\u2014"}
                  </span>
                </button>

                {expanded && (
                  <div style={{
                    padding: "10px 14px 10px 28px",
                    background: "rgba(255,255,255,0.015)",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    fontSize: 11, color: A.textSec,
                    display: "flex", flexDirection: "column", gap: 4,
                  }}>
                    <DetailRow label="Run ID" value={run.id} mono />
                    <DetailRow label="Task ID" value={run.taskId} mono />
                    <DetailRow label="Project" value={run.projectName} />
                    {run.sessionId && <DetailRow label="Session" value={run.sessionId} mono />}
                    <DetailRow label="Created" value={new Date(run.createdAt).toLocaleString()} />
                    {run.startedAt && <DetailRow label="Started" value={new Date(run.startedAt).toLocaleString()} />}
                    {run.completedAt && <DetailRow label="Completed" value={new Date(run.completedAt).toLocaleString()} />}
                    {run.errorMessage && (
                      <div style={{ marginTop: 4, padding: "6px 8px", borderRadius: 4, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>
                        {run.errorMessage}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function RunStatusBadge({ status }: { status: OrchestrationAgentExecutionRun["status"] }) {
  const tones: Record<string, { color: string; bg: string; label: string }> = {
    pending: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", label: "Pending" },
    running: { color: "#22c55e", bg: "rgba(34,197,94,0.14)", label: "Running" },
    completed: { color: "#d97706", bg: "rgba(217,119,6,0.14)", label: "Done" },
    failed: { color: "#f87171", bg: "rgba(248,113,113,0.14)", label: "Failed" },
    cancelled: { color: "#78716c", bg: "rgba(120,113,108,0.14)", label: "Cancelled" },
  };
  const t = tones[status] ?? tones.cancelled;
  return (
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, color: t.color, background: t.bg }}>
      {t.label}
    </span>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <span style={{ color: A.muted, width: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ color: A.text, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `1px solid ${A.cardBorder}`,
};

const headerRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 10px", marginBottom: 2,
  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.06em", color: A.muted,
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const dataRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 10px", fontSize: 12,
  borderBottom: "1px solid rgba(255,255,255,0.03)",
  color: A.textSec,
};
