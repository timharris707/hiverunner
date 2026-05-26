"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Circle,
  Loader2,
  Timer,
} from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import { SprintGroupedList } from "@/components/goals/SprintGroupedList";
import { SprintRow } from "@/components/goals/SprintRow";
import { listCompanyAgents, updateCompanyGoal } from "@/lib/orchestration/client";
import { useAgentProfile, A } from "../agent-context";
import { groupBySprint, type SprintGroupedGoal, type SprintGroupedSprint } from "@/lib/orchestration/groupBySprint";
import type { OrchestrationAgent, OrchestrationAgentProfile, OrchestrationAgentProfileTask } from "@/lib/orchestration/types";

type SprintOverride = {
  owner?: string | null;
  startDate?: string;
  endDate?: string | null;
};

/* ─── Page ─── */
export default function AgentDashboardPage() {
  const { profile, companyCode, slug, reload } = useAgentProfile();
  const { currentTasks, executionHistory, liveSession } = profile;
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [sprintOverrides, setSprintOverrides] = useState<Map<string, SprintOverride>>(() => new Map());
  const [sprintMutationError, setSprintMutationError] = useState("");
  const openTasks = useMemo(() => currentTasks.filter((task) => task.status !== "done"), [currentTasks]);

  useEffect(() => {
    let cancelled = false;
    void listCompanyAgents(slug).then((result) => {
      if (!cancelled) setAgents(result);
    });
    return () => { cancelled = true; };
  }, [slug]);

  const tasksWithSprintOverrides = useMemo(() => currentTasks.map((task) => {
    if (!task.sprintId) return task;
    const override = sprintOverrides.get(task.sprintId);
    if (!override) return task;
    return {
      ...task,
      ...(Object.prototype.hasOwnProperty.call(override, "owner") ? { sprintOwner: override.owner } : {}),
      ...(override.startDate !== undefined ? { sprintStartDate: override.startDate } : {}),
      ...(Object.prototype.hasOwnProperty.call(override, "endDate") ? { sprintEndDate: override.endDate } : {}),
    };
  }), [currentTasks, sprintOverrides]);

  const patchSprintGoal = useCallback(async (sprintId: string, patch: SprintOverride) => {
    const hadPrevious = sprintOverrides.has(sprintId);
    const previous = sprintOverrides.get(sprintId);
    setSprintMutationError("");
    setSprintOverrides((current) => {
      const next = new Map(current);
      next.set(sprintId, { ...(next.get(sprintId) ?? {}), ...patch });
      return next;
    });
    try {
      const updated = await updateCompanyGoal({
        companySlug: slug,
        sprintId,
        ...patch,
      });
      if (!updated) throw new Error("Goal update failed");
      setSprintOverrides((current) => {
        const next = new Map(current);
        next.set(sprintId, {
          owner: updated.sprint.owner ?? null,
          startDate: updated.sprint.startDate,
          endDate: updated.sprint.endDate ?? null,
        });
        return next;
      });
      reload();
    } catch {
      setSprintOverrides((current) => {
        const next = new Map(current);
        if (hadPrevious && previous) next.set(sprintId, previous);
        else next.delete(sprintId);
        return next;
      });
      setSprintMutationError("Could not update sprint. The previous value was restored.");
    }
  }, [reload, slug, sprintOverrides]);

  const handleSprintOwnerChange = useCallback((sprintId: string, owner: string | null) => {
    void patchSprintGoal(sprintId, { owner });
  }, [patchSprintGoal]);

  const handleSprintDateChange = useCallback((sprintId: string, startDate: string, endDate: string | null) => {
    void patchSprintGoal(sprintId, { startDate, endDate });
  }, [patchSprintGoal]);

  const recentTasks = tasksWithSprintOverrides.slice(0, 10);
  const hasMoreTasks = tasksWithSprintOverrides.length > 10;
  const sprintAttachedTasks = useMemo(
    () => tasksWithSprintOverrides.filter((task) => task.sprintId && task.companyGoalId),
    [tasksWithSprintOverrides],
  );
  const sprintGroupedTasks = useMemo(
    () => groupBySprint(sprintAttachedTasks, "sprint"),
    [sprintAttachedTasks],
  );
  const sprintlessTaskCount = tasksWithSprintOverrides.filter((task) => !task.sprintId).length;

  // Derive chart data from execution history
  const chartData = useMemo(() => buildChartData(openTasks, executionHistory), [openTasks, executionHistory]);

  const costData = useMemo(
    () => profile.usageSummary
      ? {
          inputTokens: profile.usageSummary.inputTokens,
          outputTokens: profile.usageSummary.outputTokens,
          cachedTokens: profile.usageSummary.cacheReadTokens,
          totalCost: profile.usageSummary.totalCostUsd,
        }
      : buildCostData(executionHistory),
    [executionHistory, profile.usageSummary],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Live Run ── */}
      <LiveRunSection liveSession={liveSession} />

      {/* ── Charts Grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <ChartPanel title="Run Activity" subtitle="Last 14 days" data={chartData.runActivity} type="bar" />
        <ChartPanel title="Tasks by Priority" subtitle="Open tasks" data={chartData.tasksByPriority} type="stacked" legend={["Critical", "High", "Medium", "Low"]} legendColors={["var(--negative)", "var(--warning)", "var(--info)", "var(--positive)"]} />
        <ChartPanel title="Tasks by Status" subtitle="Open tasks" data={chartData.tasksByStatus} type="stacked" legend={["Backlog", "To-Do", "Working", "Review", "Blocked"]} legendColors={["#94a3b8", "#60a5fa", "#f59e0b", "#a855f7", "#ef4444"]} />
        <ChartPanel title="Success Rate" subtitle="Last 14 days" data={chartData.successRate} type="bar" />
      </div>

      <AgentGoalsSprintsCard
        agentName={profile.agent.name}
        agentId={profile.agent.id}
        companyCode={companyCode}
        grouped={sprintGroupedTasks}
        sprintlessTaskCount={sprintlessTaskCount}
        agents={agents}
        mutationError={sprintMutationError}
        onOwnerChange={handleSprintOwnerChange}
        onDateChange={handleSprintDateChange}
      />

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
          {recentTasks.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: A.muted, fontSize: 12 }}>
              No tasks assigned.
            </div>
          ) : (
            recentTasks.map((task, i) => {
              const taskIdentifier = task.key ?? task.id.slice(0, 8);
              const taskHref = `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(taskIdentifier)}`;
              return (
                <Link
                  key={task.id}
                  href={taskHref}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px",
                    borderBottom: i < recentTasks.length - 1 ? `0.5px solid ${A.cardBorder}` : "none",
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
          {hasMoreTasks && (
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
                key={`${run.id}-${i}`}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 80px",
                  padding: "8px 14px", fontSize: 12,
                  borderBottom: i < Math.min(executionHistory.length, 10) - 1 ? `0.5px solid ${A.cardBorder}` : "none",
                }}
              >
                <span style={{ color: A.textSec }}>{formatRunDate(run.startedAt || run.createdAt)}</span>
                <span style={{ color: A.textSec, fontFamily: "var(--font-mono)" }}>{run.sessionId?.slice(0, 8) || run.id.slice(0, 8)}</span>
                <span style={{ color: A.text, textAlign: "right" }}>{run.inputTokens != null ? formatTokens(run.inputTokens) : "-"}</span>
                <span style={{ color: A.text, textAlign: "right" }}>{run.outputTokens != null ? formatTokens(run.outputTokens) : "-"}</span>
                <span style={{ color: run.totalCostUsd != null ? A.text : A.muted, textAlign: "right" }}>
                  {run.totalCostUsd != null ? `$${run.totalCostUsd.toFixed(4)}` : "-"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function AgentGoalsSprintsCard({
  agentName,
  agentId,
  companyCode,
  grouped,
  sprintlessTaskCount,
  agents,
  mutationError,
  onOwnerChange,
  onDateChange,
}: {
  agentName: string;
  agentId: string;
  companyCode: string;
  grouped: ReturnType<typeof groupBySprint<OrchestrationAgentProfileTask>>;
  sprintlessTaskCount: number;
  agents: OrchestrationAgent[];
  mutationError: string;
  onOwnerChange: (sprintId: string, owner: string | null) => void;
  onDateChange: (sprintId: string, startDate: string, endDate: string | null) => void;
}) {
  const hasSprintWork = grouped.groups.length > 0;
  return (
    <section style={{ borderRadius: 8, border: `0.5px solid ${A.cardBorder}`, background: A.card, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `0.5px solid ${A.cardBorder}` }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: A.text }}>Goals & sprints</h3>
      </div>
      {!hasSprintWork ? (
        <div style={{ padding: 18, color: A.muted, fontSize: 12 }}>
          No active sprint work assigned to {agentName} yet.
        </div>
      ) : (
        <div style={{ maxHeight: 540, overflowY: "auto", padding: "8px 0" }}>
          <SprintGroupedList
            grouped={grouped}
            mode="sprint"
            companyCode={companyCode}
            persistenceKeyPrefix={`hr:agent-dashboard:goals-collapse:${companyCode.toUpperCase()}:${agentId}`}
            plainPersistenceIds
            itemCountLabel="tasks"
            renderItem={() => null}
            getGoalProject={goalProjectFromItems}
            renderSprint={(sprint, goal) => (
              <AgentSprintRow
                key={sprint.sprintId}
                sprint={sprint}
                goal={goal}
                companyCode={companyCode}
                agents={agents}
                onOwnerChange={onOwnerChange}
                onDateChange={onDateChange}
              />
            )}
          />
        </div>
      )}
      {mutationError ? (
        <div role="status" style={{ borderTop: `0.5px solid ${A.cardBorder}`, padding: "8px 14px", color: "var(--negative)", fontSize: 11 }}>
          {mutationError}
        </div>
      ) : null}
      {sprintlessTaskCount > 0 ? (
        <Link
          href={`/${encodeURIComponent(companyCode.toUpperCase())}/tasks?assignee=${encodeURIComponent(agentId)}&group=sprint`}
          style={{
            display: "block",
            borderTop: `0.5px solid ${A.cardBorder}`,
            padding: "9px 14px",
            color: A.muted,
            fontSize: 11,
            textDecoration: "none",
          }}
        >
          {sprintlessTaskCount} other task{sprintlessTaskCount === 1 ? "" : "s"} not yet tied to a sprint
        </Link>
      ) : null}
    </section>
  );
}

function AgentSprintRow({
  sprint,
  goal,
  companyCode,
  agents,
  onOwnerChange,
  onDateChange,
}: {
  sprint: SprintGroupedSprint<OrchestrationAgentProfileTask>;
  goal: SprintGroupedGoal<OrchestrationAgentProfileTask>;
  companyCode: string;
  agents: OrchestrationAgent[];
  onOwnerChange: (sprintId: string, owner: string | null) => void;
  onDateChange: (sprintId: string, startDate: string, endDate: string | null) => void;
}) {
  const first = sprint.items[0];
  const total = sprint.items.length;
  const open = sprint.items.filter((task) => task.status !== "done").length;
  const sprintTaskCount = first?.sprintTaskCount ?? total;
  const sprintDoneCount = first?.sprintDoneCount ?? Math.max(0, total - open);
  const completionPercent = sprintTaskCount > 0 ? (sprintDoneCount / sprintTaskCount) * 100 : 0;
  const projectLabel = first?.projectName && first.projectName.toLowerCase() !== "no project"
    ? first.projectName
    : "Company-wide";

  return (
    <SprintRow
      sprint={{
        id: sprint.sprintId,
        name: sprint.sprintName,
        status: sprint.sprintStatus ?? "planned",
        startDate: first?.sprintStartDate ?? "",
        endDate: first?.sprintEndDate ?? null,
        owner: first?.sprintOwner ?? undefined,
      }}
      completionPercent={completionPercent}
      companyCode={companyCode}
      parentGoalName={goal.goalName}
      projectLabel={projectLabel}
      agents={agents}
      rightAccessory={<AgentTaskCountBadge open={open} total={total} />}
      onOwnerChange={onOwnerChange}
      onDateChange={onDateChange}
    />
  );
}

function AgentTaskCountBadge({ open, total }: { open: number; total: number }) {
  return (
    <span
      title="Agent open tasks / agent total tasks in this sprint"
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 20,
        padding: "1px 7px",
        borderRadius: 999,
        border: `0.5px solid ${A.cardBorder}`,
        color: A.textSec,
        background: "rgba(255,255,255,0.03)",
        fontSize: 11,
        fontWeight: 650,
        whiteSpace: "nowrap",
      }}
    >
      {open}/{total}
    </span>
  );
}

function goalProjectFromItems(goal: SprintGroupedGoal<OrchestrationAgentProfileTask>) {
  const item = goal.sprints.flatMap((sprint) => sprint.items)[0];
  if (!item?.companyGoalProjectName && !item?.projectName) return null;
  return {
    name: item.companyGoalProjectName ?? item.projectName,
    color: item.companyGoalProjectColor ?? item.projectColor ?? null,
  };
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
  const hasData = data.some((val) => val > 0);

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
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 60, flex: 1, position: "relative" }}>
        {hasData ? (
          data.map((val, i) => {
            const h = val > 0 ? Math.max((val / max) * 50, 2) : 0;
            const color = type === "stacked" && legendColors
              ? legendColors[i % legendColors.length]
              : "#22c55e";
            return (
              <div
                key={i}
                title={String(val)}
                style={{
                  flex: 1, height: h, borderRadius: 2,
                  background: color,
                  opacity: 0.8,
                  transition: "height 0.3s ease",
                }}
              />
            );
          })
        ) : (
          <div style={{
            width: "100%",
            alignSelf: "center",
            textAlign: "center",
            color: A.muted,
            fontSize: 11,
          }}>
            No data yet.
          </div>
        )}
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
    review: { color: "#a78bfa", bg: "rgba(167,139,250,0.14)", label: "in review" },
    "in-progress": { color: "#f59e0b", bg: "rgba(245,158,11,0.14)", label: "in progress" },
    blocked: { color: "#ef4444", bg: "rgba(239,68,68,0.14)", label: "blocked" },
    backlog: { color: "#94a3b8", bg: "rgba(148,163,184,0.14)", label: "backlog" },
    "to-do": { color: "#60a5fa", bg: "rgba(96,165,250,0.14)", label: "To-Do" },
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
    pending: { color: "#a8a6a0", bg: "rgba(168,166,160,0.14)" },
    completed: { color: "#78716c", bg: "rgba(120,113,108,0.14)" },
    succeeded: { color: "#78716c", bg: "rgba(120,113,108,0.14)" },
    failed: { color: "#ef4444", bg: "rgba(239,68,68,0.14)" },
    timed_out: { color: "#ef4444", bg: "rgba(239,68,68,0.14)" },
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
  const bars = 14;
  const runActivity = new Array(bars).fill(0);
  const successRate = new Array(bars).fill(0);

  const completedByDay = new Array(bars).fill(0);
  const totalByDay = new Array(bars).fill(0);
  for (const run of runs) {
    const bucket = bucketIndexForTimestamp(run.startedAt ?? run.createdAt);
    if (bucket === null) continue;
    runActivity[bucket] += 1;
    totalByDay[bucket] += 1;
    if (isSuccessfulRunStatus(run.status)) {
      completedByDay[bucket] += 1;
    }
  }
  for (let i = 0; i < bars; i++) {
    successRate[i] = totalByDay[i] > 0 ? Math.round((completedByDay[i] / totalByDay[i]) * 100) : 0;
  }

  const priorityOrder: Array<OrchestrationAgentProfile["currentTasks"][number]["priority"]> = [
    "P0",
    "P1",
    "P2",
    "P3",
  ];
  const statusOrder: Array<OrchestrationAgentProfile["currentTasks"][number]["status"]> = [
    "backlog",
    "to-do",
    "in-progress",
    "review",
    "blocked",
  ];
  const tasksByPriority = priorityOrder.map((priority) => tasks.filter((task) => task.priority === priority).length);
  const tasksByStatus = statusOrder.map((status) => tasks.filter((task) => task.status === status).length);

  return { runActivity, tasksByPriority, tasksByStatus, successRate };
}

function buildCostData(runs: OrchestrationAgentProfile["executionHistory"]) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let totalCost = 0;

  for (const run of runs) {
    inputTokens += run.inputTokens ?? 0;
    outputTokens += run.outputTokens ?? 0;
    cachedTokens += run.cacheReadTokens ?? 0;
    totalCost += run.totalCostUsd ?? 0;
  }

  return { inputTokens, outputTokens, cachedTokens, totalCost };
}

function bucketIndexForTimestamp(ts: string | undefined): number | null {
  if (!ts) return null;
  const date = new Date(ts);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.floor((todayStart - dayStart) / 86_400_000);
  if (daysAgo < 0 || daysAgo >= 14) return null;
  return 13 - daysAgo;
}

function isSuccessfulRunStatus(status: OrchestrationAgentProfile["executionHistory"][number]["status"] | "succeeded") {
  return status === "completed" || status === "succeeded";
}
