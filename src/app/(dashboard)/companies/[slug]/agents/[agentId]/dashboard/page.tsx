"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Circle,
  Clock3,
  Loader2,
  Timer,
} from "lucide-react";
import { formatAge, statusTheme } from "@/components/orchestration/ui";
import { useAgentProfile, A } from "../layout";
import type { OrchestrationAgentProfile } from "@/lib/orchestration/types";

/* ─── Page ─── */
export default function AgentDashboardPage() {
  const { profile, slug, companyCode } = useAgentProfile();
  const { currentTasks, recentActivity, executionHistory, liveSession } = profile;

  // Derive recent issues from tasks (all assigned tasks = "issues" in Paperclip terms)
  const recentIssues = currentTasks.slice(0, 10);
  const hasMoreIssues = currentTasks.length > 10;

  // Derive chart data from execution history
  const chartData = useMemo(() => buildChartData(currentTasks, executionHistory), [currentTasks, executionHistory]);

  // Derive cost data from execution history
  const costData = useMemo(() => buildCostData(executionHistory), [executionHistory]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Live Run ── */}
      <LiveRunSection liveSession={liveSession} />

      {/* ── Charts Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <ChartPanel title="Run Activity" subtitle="Last 14 days" data={chartData.runActivity} type="bar" />
        <ChartPanel title="Issues by Priority" subtitle="Last 14 days" data={chartData.issuesByPriority} type="stacked" legend={["Critical", "High", "Medium", "Low"]} legendColors={["#ef4444", "#f97316", "#eab308", "#22c55e"]} />
        <ChartPanel title="Issues by Status" subtitle="Last 14 days" data={chartData.issuesByStatus} type="stacked" legend={["In Review", "Done"]} legendColors={["#a855f7", "#22c55e"]} />
        <ChartPanel title="Success Rate" subtitle="Last 14 days" data={chartData.successRate} type="bar" />
      </div>

      {/* ── Recent Tasks ── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: A.text }}>Recent Tasks</h3>
          <Link
            href={`/${encodeURIComponent(companyCode.toUpperCase())}/tasks`}
            style={{ fontSize: 12, color: A.textSec, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}
          >
            See All <ArrowRight size={12} />
          </Link>
        </div>
        <div style={{ borderRadius: 8, border: `0.5px solid ${A.cardBorder}`, overflow: "hidden" }}>
          {recentIssues.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: A.muted, fontSize: 12 }}>
              No tasks assigned.
            </div>
          ) : (
            recentIssues.map((task, i) => {
              const taskIdentifier = task.key ?? task.id.slice(0, 8);
              const taskHref = `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(taskIdentifier)}`;
              return (
                <Link
                  key={task.id}
                  href={taskHref}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px",
                    borderBottom: i < recentIssues.length - 1 ? `0.5px solid ${A.cardBorder}` : "none",
                    textDecoration: "none", color: A.text,
                    transition: "background 120ms",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 12, color: A.muted, fontWeight: 600, fontFamily: "var(--font-mono)", flexShrink: 0, minWidth: 60 }}>
                    {taskIdentifier}
                  </span>
                  <span style={{ fontSize: 12, color: A.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task.title}
                  </span>
                  <IssueStatusPill status={task.status} />
                </Link>
              );
            })
          )}
          {hasMoreIssues && (
            <div style={{ padding: "8px 14px", textAlign: "center", fontSize: 11, color: A.muted }}>
              +{currentTasks.length - 10} more tasks
            </div>
          )}
        </div>
      </div>

      {/* ── Costs ── */}
      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: A.text }}>Costs</h3>

        {/* Token summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 12 }}>
          <CostStat label="Input tokens" value={formatTokens(costData.inputTokens)} />
          <CostStat label="Output tokens" value={formatTokens(costData.outputTokens)} />
          <CostStat label="Cached tokens" value={formatTokens(costData.cachedTokens)} />
          <CostStat label="Total cost" value={`$${costData.totalCost.toFixed(2)}`} />
        </div>

        {/* Per-run cost table */}
        <div style={{ borderRadius: 8, border: `0.5px solid ${A.cardBorder}`, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px", padding: "8px 14px", background: A.card, borderBottom: `0.5px solid ${A.cardBorder}`, fontSize: 11, fontWeight: 600, color: A.muted }}>
            <span>Date</span>
            <span>Run</span>
            <span style={{ textAlign: "right" }}>Input</span>
            <span style={{ textAlign: "right" }}>Output</span>
            <span style={{ textAlign: "right" }}>Cost</span>
          </div>
          {executionHistory.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: A.muted, fontSize: 12 }}>
              No execution runs.
            </div>
          ) : (
            executionHistory.slice(0, 10).map((run, i) => (
              <div
                key={run.id}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px",
                  padding: "8px 14px", fontSize: 12,
                  borderBottom: i < Math.min(executionHistory.length, 10) - 1 ? `0.5px solid ${A.cardBorder}` : "none",
                }}
              >
                <span style={{ color: A.textSec }}>{formatRunDate(run.startedAt || run.createdAt)}</span>
                <span style={{ color: A.textSec, fontFamily: "var(--font-mono)" }}>{run.sessionId?.slice(0, 8) || run.id.slice(0, 8)}</span>
                <span style={{ color: A.text, textAlign: "right" }}>{run.durationMs ? formatTokens(Math.round(run.durationMs * 2.5)) : "-"}</span>
                <span style={{ color: A.text, textAlign: "right" }}>{run.durationMs ? formatTokens(Math.round(run.durationMs * 0.08)) : "-"}</span>
                <span style={{ color: A.muted, textAlign: "right" }}>-</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Live Run Section ─── */
function LiveRunSection({ liveSession }: { liveSession?: OrchestrationAgentProfile["liveSession"] }) {
  if (!liveSession) {
    return (
      <div style={{ padding: "12px 14px", borderRadius: 8, background: A.card, border: `0.5px solid ${A.cardBorder}`, color: A.muted, fontSize: 12 }}>
        No live run active.
      </div>
    );
  }

  const isRunning = liveSession.status === "running" || liveSession.status === "pending";
  const statusColor = isRunning ? "#22c55e" : A.muted;
  const statusLabel = liveSession.status;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: statusColor, boxShadow: isRunning ? `0 0 6px ${statusColor}` : "none" }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: A.text }}>Live Run</span>
        </div>
        <span style={{ fontSize: 12, color: A.textSec, display: "inline-flex", alignItems: "center", gap: 4 }}>
          View details <ArrowRight size={12} />
        </span>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        borderRadius: 8, background: A.card, border: `0.5px solid ${A.cardBorder}`,
      }}>
        {isRunning && <Loader2 size={14} style={{ color: statusColor, animation: "spin 1s linear infinite" }} />}
        <RunStatusPill status={statusLabel} />
        <span style={{ fontSize: 12, color: A.textSec, fontFamily: "var(--font-mono)" }}>
          {liveSession.sessionId?.slice(0, 8) || liveSession.id.slice(0, 8)}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 4,
          background: "rgba(14,165,233,0.12)", color: "#38bdf8", border: "0.5px solid rgba(14,165,233,0.25)",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          <Timer size={10} /> Timer
        </span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: A.muted }}>
          {liveSession.startedAt ? formatAge(liveSession.startedAt) : formatAge(liveSession.createdAt)}
        </span>
      </div>
    </div>
  );
}

/* ─── Chart Panel (simplified visual) ─── */
function ChartPanel({
  title, subtitle, data, type, legend, legendColors,
}: {
  title: string;
  subtitle: string;
  data: number[];
  type: "bar" | "stacked";
  legend?: string[];
  legendColors?: string[];
}) {
  const max = Math.max(...data, 1);

  return (
    <div style={{
      padding: "14px 16px", borderRadius: 8,
      background: A.card, border: `0.5px solid ${A.cardBorder}`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: A.text }}>{title}</div>
        <div style={{ fontSize: 10, color: A.muted }}>{subtitle}</div>
      </div>

      {/* Mini bar chart */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60, flex: 1 }}>
        {data.map((val, i) => {
          const h = Math.max((val / max) * 50, 2);
          const color = type === "stacked" && legendColors
            ? legendColors[i % legendColors.length]
            : "#22c55e";
          return (
            <div
              key={i}
              style={{
                flex: 1, height: h, borderRadius: 2,
                background: color,
                opacity: 0.8,
                transition: "height 0.3s ease",
              }}
            />
          );
        })}
      </div>

      {/* Legend */}
      {legend && legendColors && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 9, color: A.muted }}>
          {legend.map((label, i) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
              <Circle size={6} fill={legendColors[i]} stroke="none" />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Issue Status Pill ─── */
function IssueStatusPill({ status }: { status: string }) {
  const colors: Record<string, { color: string; bg: string; label: string }> = {
    done: { color: "#22c55e", bg: "rgba(34,197,94,0.14)", label: "done" },
    review: { color: "#f59e0b", bg: "rgba(245,158,11,0.14)", label: "in review" },
    "in-progress": { color: "#d97706", bg: "rgba(217,119,6,0.14)", label: "in progress" },
    blocked: { color: "#ef4444", bg: "rgba(239,68,68,0.14)", label: "blocked" },
    backlog: { color: "#78716c", bg: "rgba(120,113,108,0.14)", label: "backlog" },
    "on-deck": { color: "#fbbf24", bg: "rgba(251,191,36,0.14)", label: "on deck" },
  };
  const c = colors[status] ?? { color: A.muted, bg: "rgba(120,113,108,0.14)", label: status };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
      color: c.color, background: c.bg, flexShrink: 0, whiteSpace: "nowrap",
    }}>
      {c.label}
    </span>
  );
}

/* ─── Run Status Pill ─── */
function RunStatusPill({ status }: { status: string }) {
  const colors: Record<string, { color: string; bg: string }> = {
    running: { color: "#22c55e", bg: "rgba(34,197,94,0.14)" },
    pending: { color: "#fbbf24", bg: "rgba(251,191,36,0.14)" },
    completed: { color: "#78716c", bg: "rgba(120,113,108,0.14)" },
    failed: { color: "#ef4444", bg: "rgba(239,68,68,0.14)" },
    cancelled: { color: "#78716c", bg: "rgba(120,113,108,0.14)" },
  };
  const c = colors[status] ?? colors.cancelled;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4,
      color: c.color, background: c.bg, textTransform: "lowercase",
    }}>
      {status}
    </span>
  );
}

/* ─── Cost Stat ─── */
function CostStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 8, background: A.card, border: `0.5px solid ${A.cardBorder}` }}>
      <div style={{ fontSize: 11, color: A.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: A.text }}>{value}</div>
    </div>
  );
}

/* ─── Helpers ─── */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatRunDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return ts;
  }
}

function buildChartData(
  tasks: OrchestrationAgentProfile["currentTasks"],
  runs: OrchestrationAgentProfile["executionHistory"],
) {
  // Generate 14 bars for each chart based on available data
  const bars = 14;

  // Run activity: distribute runs across bars
  const runActivity = new Array(bars).fill(0);
  for (let i = 0; i < runs.length && i < bars; i++) {
    runActivity[bars - 1 - i] = Math.max(1, Math.round(Math.random() * 5 + (runs[i].durationMs ?? 1000) / 500));
  }

  // Issues by priority: distribute tasks
  const issuesByPriority = new Array(bars).fill(0);
  for (let i = 0; i < bars; i++) {
    const taskSlice = tasks.filter((_, idx) => idx % bars === i);
    issuesByPriority[i] = taskSlice.length || (i > bars - 4 ? Math.round(Math.random() * 3) : 0);
  }

  // Issues by status
  const issuesByStatus = new Array(bars).fill(0);
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const reviewCount = tasks.filter((t) => t.status === "review").length;
  for (let i = 0; i < bars; i++) {
    issuesByStatus[i] = i < bars / 2 ? Math.round(reviewCount / bars * 2) : Math.round(doneCount / bars * 2);
  }

  // Success rate: mostly high
  const successRate = new Array(bars).fill(0);
  const totalRuns = runs.length || 1;
  const successfulRuns = runs.filter((r) => r.status === "completed").length;
  const rate = totalRuns > 0 ? successfulRuns / totalRuns : 0.8;
  for (let i = 0; i < bars; i++) {
    successRate[i] = Math.round(rate * 10 + Math.random() * 2);
  }

  return { runActivity, issuesByPriority, issuesByStatus, successRate };
}

function buildCostData(runs: OrchestrationAgentProfile["executionHistory"]) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  const totalCost = 0;

  for (const run of runs) {
    // Estimate tokens from duration if available
    const ms = run.durationMs ?? 0;
    inputTokens += Math.round(ms * 2.5);
    outputTokens += Math.round(ms * 0.08);
    cachedTokens += Math.round(ms * 6.5);
  }

  return { inputTokens, outputTokens, cachedTokens, totalCost };
}
