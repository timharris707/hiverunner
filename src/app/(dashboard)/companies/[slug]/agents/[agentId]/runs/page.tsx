"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Zap, ArrowRight } from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import { useAgentProfile, A } from "../layout";
import { buildCanonicalRunDetailPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationAgentExecutionRun } from "@/lib/orchestration/types";

export default function AgentRunsPage() {
  const { profile, agentId } = useAgentProfile();
  const { executionHistory } = profile;
  const router = useRouter();

  // Resolve company code from the current pathname for canonical links
  const companyCode = useMemo(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[0] ?? "";
  }, []);

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 12, fontWeight: 600 }}>
        <Zap size={13} style={{ color: A.textSec }} />
        <span style={{ color: A.text }}>Execution Runs ({executionHistory.length})</span>
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
            <span style={{ width: 24 }} />
          </div>

          {executionHistory.map((run) => {
            const href = buildCanonicalRunDetailPath(companyCode, agentId, run.id);
            return (
            <a
              key={run.id}
              href={href}
              onClick={(e) => { e.preventDefault(); window.location.href = href; }}
              style={{
                ...dataRow,
                textDecoration: "none",
                display: "flex",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.03)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              <span style={{ width: 100, fontFamily: "monospace", fontSize: 11, color: A.muted }}>
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
              <span style={{ width: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <ArrowRight size={12} style={{ color: A.muted, opacity: 0.5 }} />
              </span>
            </a>
            );
          })}
        </>
      )}
    </div>
  );
}

function RunStatusBadge({ status }: { status: OrchestrationAgentExecutionRun["status"] }) {
  const tones: Record<string, { color: string; bg: string; label: string }> = {
    pending: { color: "#a8a6a0", bg: "rgba(168,166,160,0.14)", label: "Pending" },
    running: { color: "#22c55e", bg: "rgba(34,197,94,0.14)", label: "Running" },
    completed: { color: "#4ade80", bg: "rgba(74,222,128,0.14)", label: "Done" },
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

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `0.5px solid ${A.cardBorder}`,
};

const headerRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 10px", marginBottom: 2,
  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.06em", color: A.muted,
  borderBottom: "0.5px solid rgba(255,255,255,0.06)",
};

const dataRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 10px", fontSize: 12,
  borderBottom: "0.5px solid rgba(255,255,255,0.03)",
  color: A.textSec,
  cursor: "pointer",
  borderRadius: 4,
  transition: "background 0.15s",
};
