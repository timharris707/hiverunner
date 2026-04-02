"use client";

import {
  Circle,
  ListChecks,
  MessageSquare,
  PlayCircle,
  Zap,
} from "lucide-react";
import { formatAge, priorityTheme, statusTheme, typeIcon } from "@/components/orchestration/ui";
import { useAgentProfile, A } from "../layout";
import type { OrchestrationAgentProfile } from "@/lib/orchestration/types";

export default function AgentDashboardPage() {
  const { profile } = useAgentProfile();
  const { currentTasks, recentActivity, executionHistory } = profile;
  const currentTask = currentTasks.find((t) => t.status === "in-progress") ?? currentTasks[0];

  return (
    <>
      {/* ── current task highlight ── */}
      {currentTask && (
        <div style={{
          marginBottom: 14, padding: "10px 14px", borderRadius: 8,
          background: "linear-gradient(135deg, rgba(217,119,6,0.08), rgba(180,83,9,0.04))",
          border: `1px solid ${A.cardBorder}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <PlayCircle size={13} style={{ color: A.accentLight }} />
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: A.accent }}>
              Current Task
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 13, color: A.text }}>
              {typeIcon[currentTask.type] && <span style={{ marginRight: 4 }}>{typeIcon[currentTask.type]}</span>}
              {currentTask.title}
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              <PriorityPill priority={currentTask.priority} />
              <StatusPill status={currentTask.status} />
            </div>
          </div>
        </div>
      )}

      {/* ── main 3-column grid ── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {/* col 1: tasks */}
        <div style={{ ...cardStyle, minHeight: 200 }}>
          <SectionHead icon={<ListChecks size={13} />} label={`Tasks (${currentTasks.length})`} />
          {currentTasks.length === 0 ? <Empty msg="No assigned tasks" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {currentTasks.map((task) => (
                <div key={task.id} style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: 12, color: A.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {typeIcon[task.type] && <span style={{ marginRight: 3 }}>{typeIcon[task.type]}</span>}
                      {task.title}
                    </span>
                    <span style={{ fontSize: 10, color: A.muted, flexShrink: 0 }}>{formatAge(task.updatedAt)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, marginTop: 3 }}>
                    <PriorityPill priority={task.priority} />
                    <StatusPill status={task.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* col 2: activity feed */}
        <div style={{ ...cardStyle, minHeight: 200 }}>
          <SectionHead icon={<MessageSquare size={13} />} label={`Activity (${recentActivity.length})`} />
          {recentActivity.length === 0 ? <Empty msg="No activity yet" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recentActivity.map((entry) => (
                <div key={entry.id} style={{ ...rowStyle, padding: "6px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <Circle
                      size={6}
                      fill={entry.kind === "comment" ? A.accentLight : A.muted}
                      stroke="none"
                    />
                    <span style={{ fontSize: 11, color: A.text, fontWeight: 500 }}>{entry.taskTitle}</span>
                    <span style={{ fontSize: 10, color: A.muted, marginLeft: "auto", flexShrink: 0 }}>{formatAge(entry.timestamp)}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11, color: A.textSec, paddingLeft: 12, lineHeight: 1.35 }}>{entry.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* col 3: execution history */}
        <div style={{ ...cardStyle, minHeight: 200 }}>
          <SectionHead icon={<Zap size={13} />} label={`Executions (${executionHistory.length})`} />
          {executionHistory.length === 0 ? <Empty msg="No execution runs" /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {executionHistory.map((run) => (
                <div key={run.id} style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span style={{ fontSize: 12, color: A.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.taskTitle}</span>
                    <RunPill status={run.status} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 10, color: A.muted }}>
                    <span>{run.provider}</span>
                    {run.sessionId && <span style={{ opacity: 0.7 }}>{run.sessionId.slice(0, 12)}</span>}
                    <span style={{ marginLeft: "auto" }}>{formatAge(run.startedAt ?? run.createdAt)}</span>
                    {run.durationMs != null && <span>{Math.round(run.durationMs / 1000)}s</span>}
                  </div>
                  {run.errorMessage && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "#f87171" }}>{run.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── shared styles ── */
const cardStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: A.card,
  border: `1px solid ${A.cardBorder}`,
  overflowY: "auto",
  maxHeight: 520,
};

const rowStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.05)",
};

/* ── tiny components ── */
function SectionHead({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, color: A.accent, fontSize: 12, fontWeight: 600, letterSpacing: "0.02em" }}>
      {icon}
      {label}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div style={{ padding: 24, textAlign: "center", color: A.muted, fontSize: 12, borderRadius: 6, border: "1px dashed rgba(120,113,108,0.35)" }}>
      {msg}
    </div>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const t = priorityTheme[priority as keyof typeof priorityTheme];
  if (!t) return null;
  return (
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, color: t.color, background: t.bg }}>
      {t.label}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, { color: string; bg: string }> = {
    backlog: { color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
    "on-deck": { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
    "in-progress": { color: "#d97706", bg: "rgba(217,119,6,0.12)" },
    review: { color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
    done: { color: "#4ade80", bg: "rgba(74,222,128,0.12)" },
    blocked: { color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  };
  const t = statusTheme[status as keyof typeof statusTheme];
  const c = colors[status] ?? { color: A.textSec, bg: "transparent" };
  if (!t) return null;
  return (
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, color: c.color, background: c.bg }}>
      {t.label}
    </span>
  );
}

function RunPill({ status }: { status: OrchestrationAgentProfile["executionHistory"][number]["status"] }) {
  const tones: Record<string, { color: string; bg: string; label: string }> = {
    pending: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", label: "Pending" },
    running: { color: "#22c55e", bg: "rgba(34,197,94,0.14)", label: "Running" },
    completed: { color: "#d97706", bg: "rgba(217,119,6,0.14)", label: "Done" },
    failed: { color: "#f87171", bg: "rgba(248,113,113,0.14)", label: "Failed" },
    cancelled: { color: "#78716c", bg: "rgba(120,113,108,0.14)", label: "Cancelled" },
  };
  const t = tones[status] ?? tones.cancelled;
  return (
    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, color: t.color, background: t.bg, flexShrink: 0 }}>
      {t.label}
    </span>
  );
}
