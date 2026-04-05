"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DollarSign,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Terminal,
  Users,
} from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { formatAge, statusTheme } from "@/components/orchestration/ui";
import {
  getCompanyAgentProfile,
  listActivityFeed,
  listCompanies,
  listCompanyAgents,
  listProjects,
  listTasks,
} from "@/lib/orchestration/client";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import type {
  OrchestrationActivityEvent,
  OrchestrationAgent,
  OrchestrationAgentExecutionRun,
  OrchestrationAgentProfile,
  OrchestrationAgentProfileActivity,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationTask,
} from "@/lib/orchestration/types";

/* ── helpers ── */

async function withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    }),
  ]);
}

const STATUS_DOT_COLOR: Record<OrchestrationAgent["status"], string> = {
  working: "#4ade80",
  idle: "#a8a29e",
  paused: "#ca8a04",
  offline: "#57534e",
  error: "#ef4444",
};

const STATUS_DOT_GLOW: Record<OrchestrationAgent["status"], string> = {
  working: "0 0 6px rgba(74,222,128,0.6)",
  idle: "none",
  paused: "none",
  offline: "none",
  error: "0 0 6px rgba(239,68,68,0.4)",
};

const TASK_STATUS_COLOR: Record<string, string> = {
  "in-progress": "#d97706",
  "on-deck": "#f59e0b",
  backlog: "#94a3b8",
  review: "#fbbf24",
  done: "#4ade80",
  blocked: "#ef4444",
  cancelled: "#78716c",
};

const RUN_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  running: { color: "#4ade80", bg: "rgba(74,222,128,0.12)" },
  completed: { color: "#a8a29e", bg: "rgba(168,162,158,0.1)" },
  failed: { color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  cancelled: { color: "#ca8a04", bg: "rgba(202,138,4,0.12)" },
  pending: { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
};

const REFRESH_MS = 15_000;

type DailyCost = { date: string; cost: number; input: number; output: number };

type CostSnapshot = {
  thisMonth: number;
  budget: number;
  today: number;
  projected: number;
  daily: DailyCost[];
} | null;

type DashboardData = {
  company: OrchestrationCompany;
  projects: OrchestrationProject[];
  agents: OrchestrationAgent[];
  tasks: OrchestrationTask[];
  activity: OrchestrationActivityEvent[];
  agentProfiles: Map<string, OrchestrationAgentProfile>;
  costs: CostSnapshot;
};

/* ── main page ── */

export default function CompanyDashboardPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (mode: "initial" | "manual" | "poll") => {
      if (mode === "manual") setRefreshing(true);

      try {
        const [companies, projects, agents, tasks, activityFeed] = await Promise.all([
          withTimeout(listCompanies(), 5000),
          withTimeout(listProjects(), 5000),
          withTimeout(listCompanyAgents(slug), 5000),
          withTimeout(listTasks({ company: slug, sort: "updated-desc", includeNonProduction: true }), 5000),
          withTimeout(listActivityFeed({ limit: 40 }), 5000),
        ]);

        const company = companies.find((c) => c.slug === slug);
        if (!company) {
          if (!cancelled) { setError("Company not found."); setData(null); }
          return;
        }

        const companyProjects = projects.filter((p) => p.companyId === company.id);
        const companyProjectIdSet = new Set(companyProjects.map((p) => p.id));
        const recentActivity = (activityFeed?.activity ?? [])
          .filter((event) => {
            if (event.companySlug) return event.companySlug === slug;
            return companyProjectIdSet.has(event.projectId);
          })
          .slice(0, 20);

        // Fetch per-agent profiles for rich run cards (parallel, with timeout, non-blocking)
        const profileResults = await Promise.allSettled(
          agents.map((agent) =>
            withTimeout(
              getCompanyAgentProfile(slug, agent.slug ?? agent.id, { executionLimit: 3, activityLimit: 6 }),
              4000,
            )
          )
        );

        const agentProfiles = new Map<string, OrchestrationAgentProfile>();
        for (let i = 0; i < agents.length; i++) {
          const result = profileResults[i];
          if (result.status === "fulfilled" && result.value) {
            agentProfiles.set(agents[i].id, result.value);
          }
        }

        // Fetch real cost data (non-blocking)
        let costs: CostSnapshot = null;
        try {
          const costResp = await withTimeout(
            fetch("/api/costs?timeframe=30d", { cache: "no-store" }).then(async (r) => r.ok ? r.json() : null),
            3000,
          );
          if (costResp && typeof costResp.thisMonth === "number") {
            costs = {
              thisMonth: costResp.thisMonth,
              budget: costResp.budget ?? 0,
              today: costResp.today ?? 0,
              projected: costResp.projected ?? 0,
              daily: Array.isArray(costResp.daily) ? costResp.daily : [],
            };
          }
        } catch { /* cost fetch is non-critical */ }

        if (cancelled) return;
        setData({ company, projects: companyProjects, agents, tasks, activity: recentActivity, agentProfiles, costs });
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("[dashboard] load failed", err);
          setError("Unable to load dashboard.");
          setData((prev) => prev);
        }
      } finally {
        if (!cancelled) {
          if (mode === "initial") setLoading(false);
          if (mode === "manual") setRefreshing(false);
        }
      }
    };

    void load("initial");
    const timer = window.setInterval(() => void load("poll"), REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [slug, refreshNonce]);

  /* ── derived data ── */

  const agentMetrics = useMemo(() => {
    if (!data) return { enabled: 0, running: 0, paused: 0, errors: 0 };
    const a = data.agents;
    return {
      enabled: a.length,
      running: a.filter((x) => x.status === "working").length,
      paused: a.filter((x) => x.status === "paused").length,
      errors: a.filter((x) => x.status === "error").length,
    };
  }, [data]);

  const taskMetrics = useMemo(() => {
    if (!data) return { inProgress: 0, open: 0, blocked: 0, total: 0 };
    const t = data.tasks;
    return {
      inProgress: t.filter((x) => x.status === "in-progress").length,
      open: t.filter((x) => x.status === "backlog" || x.status === "on-deck").length,
      blocked: t.filter((x) => x.status === "blocked").length,
      total: t.length,
    };
  }, [data]);

  const pendingReview = useMemo(() => {
    if (!data) return 0;
    return data.tasks.filter((t) => t.status === "review").length;
  }, [data]);

  const recentTasks = useMemo(() => {
    if (!data) return [];
    return [...data.tasks]
      .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
      .slice(0, 8);
  }, [data]);

  /* ── 14-day time-series bucketing ── */

  const last14Days = useMemo(() => {
    const days: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split("T")[0]);
    }
    return days;
  }, []);

  const formatDayLabel = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const dailyActivity = useMemo(() => {
    if (!data) return [];
    const counts: Record<string, number> = {};
    for (const event of data.activity) {
      const day = event.timestamp?.split("T")[0];
      if (day) counts[day] = (counts[day] ?? 0) + 1;
    }
    // Also count task events from tasks (created/updated)
    for (const t of data.tasks) {
      const day = t.created?.split("T")[0] ?? t.updated?.split("T")[0];
      if (day) counts[day] = (counts[day] ?? 0) + 1;
    }
    return last14Days.map((day) => ({ day, label: formatDayLabel(day), count: counts[day] ?? 0 }));
  }, [data, last14Days]);

  const dailyTasksByStatus = useMemo(() => {
    if (!data) return { days: [] as string[], series: {} as Record<string, number[]> };
    // Count tasks that existed in each status by their creation date
    const statusCounts: Record<string, Record<string, number>> = {};
    for (const t of data.tasks) {
      const day = t.created?.split("T")[0] ?? t.updated?.split("T")[0];
      if (!day) continue;
      if (!statusCounts[day]) statusCounts[day] = {};
      const status = t.status.replace(/_/g, "-");
      statusCounts[day][status] = (statusCounts[day][status] ?? 0) + 1;
    }
    const allStatuses = [...new Set(data.tasks.map((t) => t.status.replace(/_/g, "-")))];
    const series: Record<string, number[]> = {};
    for (const s of allStatuses) series[s] = [];
    for (const day of last14Days) {
      for (const s of allStatuses) {
        series[s].push(statusCounts[day]?.[s] ?? 0);
      }
    }
    return { days: last14Days.map(formatDayLabel), series };
  }, [data, last14Days]);

  const dailyCosts = useMemo(() => {
    if (!data?.costs?.daily) return [];
    const costByDay: Record<string, number> = {};
    for (const d of data.costs.daily) {
      // The API returns date as "MM-DD", convert to match our day keys
      costByDay[d.date] = d.cost;
    }
    return last14Days.map((day) => {
      const mmdd = `${day.slice(5, 7)}-${day.slice(8, 10)}`;
      return { day, label: formatDayLabel(day), cost: costByDay[mmdd] ?? 0 };
    });
  }, [data, last14Days]);

  const agentLookup = useMemo(() => {
    const m = new Map<string, OrchestrationAgent>();
    for (const a of data?.agents ?? []) {
      m.set(a.id.toLowerCase(), a);
      m.set(a.name.toLowerCase(), a);
    }
    return m;
  }, [data]);

  /* ── render ── */

  if (!loading && !data) {
    return <CompanyErrorState title="Dashboard unavailable" detail={error ?? "No data."} href="/companies" />;
  }

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(180deg, #0c0a09 0%, #1c1917 100%)" }}>
      <div className="mx-auto max-w-[1200px] px-4 py-5 md:px-6">
        {/* ── page heading ── */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500">Dashboard</h1>
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] text-stone-400 transition hover:text-stone-200"
            style={{ borderColor: "rgba(120,113,108,0.25)" }}
          >
            {refreshing ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>

        {/* ── agent run cards ── */}
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-stone-500">Agents</h2>
          {data && data.agents.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.agents.map((agent) => (
                <AgentRunCard
                  key={agent.id}
                  agent={agent}
                  profile={data.agentProfiles.get(agent.id) ?? null}
                  companySlug={slug}
                />
              ))}
            </div>
          ) : loading ? (
            <div className="py-8 text-center text-xs text-stone-600">
              <LoaderCircle className="mx-auto mb-2 h-4 w-4 animate-spin" />
              Loading agents...
            </div>
          ) : (
            <div
              className="flex items-center gap-3 rounded-lg border px-4 py-3"
              style={{ borderColor: "rgba(120,113,108,0.2)", background: "rgba(28,25,23,0.5)" }}
            >
              <Bot className="h-5 w-5 text-stone-500" />
              <div>
                <p className="text-sm text-stone-300">No agents registered</p>
                <p className="text-xs text-stone-500">Create an agent to get started.</p>
              </div>
            </div>
          )}
        </section>

        {/* ── metric cards (2×2 grid) ── */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            value={agentMetrics.enabled}
            label="Agents Enabled"
            icon={<Users className="h-4 w-4" />}
            detail={`${agentMetrics.running} running, ${agentMetrics.paused} paused, ${agentMetrics.errors} errors`}
          />
          <MetricCard
            value={taskMetrics.inProgress}
            label="Tasks In Progress"
            icon={<Clock3 className="h-4 w-4" />}
            detail={`${taskMetrics.open} open, ${taskMetrics.blocked} blocked`}
          />
          <MetricCard
            value={data?.costs ? `$${data.costs.thisMonth.toFixed(2)}` : "—"}
            label="Month Spend"
            icon={<DollarSign className="h-4 w-4" />}
            detail={
              data?.costs
                ? data.costs.budget > 0
                  ? `${Math.round((data.costs.thisMonth / data.costs.budget) * 100)}% of $${data.costs.budget.toFixed(0)} budget`
                  : "No budget limit set"
                : "Cost data unavailable"
            }
          />
          <MetricCard
            value={pendingReview}
            label="Tasks In Review"
            icon={<CheckCircle2 className="h-4 w-4" />}
            detail={pendingReview > 0 ? "Awaiting review" : "No tasks in review"}
          />
        </div>

        {/* ── time-series charts (14-day) ── */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ChartCard title="Run Activity" subtitle="Last 14 days">
            <TimeSeriesBar
              data={dailyActivity.map((d) => ({ label: d.label, value: d.count }))}
              color="#d97706"
            />
          </ChartCard>
          <ChartCard title="Tasks by Status" subtitle="Last 14 days">
            <StackedTimeSeriesBar
              labels={dailyTasksByStatus.days}
              series={Object.entries(dailyTasksByStatus.series).map(([status, values]) => ({
                key: status,
                values,
                color: TASK_STATUS_COLOR[status] ?? "#78716c",
              }))}
            />
          </ChartCard>
          <ChartCard title="Daily Spend" subtitle="Last 14 days">
            <TimeSeriesBar
              data={dailyCosts.map((d) => ({ label: d.label, value: d.cost }))}
              color="#4ade80"
              formatValue={(v) => v > 0 ? `$${v.toFixed(1)}` : ""}
            />
          </ChartCard>
          <ChartCard title="Tasks Created" subtitle="Last 14 days">
            <TimeSeriesBar
              data={last14Days.map((day) => {
                const count = (data?.tasks ?? []).filter((t) => (t.created?.split("T")[0]) === day).length;
                return { label: formatDayLabel(day), value: count };
              })}
              color="#f59e0b"
            />
          </ChartCard>
        </div>

        {/* ── recent activity + recent tasks (2-column) ── */}
        <div className="grid gap-3 md:grid-cols-2">
          {/* Recent Activity */}
          <section
            className="rounded-lg border"
            style={{ borderColor: "rgba(120,113,108,0.15)", background: "rgba(28,25,23,0.5)" }}
          >
            <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "rgba(120,113,108,0.12)" }}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Recent Activity</h2>
              <Link href={buildCompanyPath(slug, "/activity")} className="text-[10px] text-stone-600 no-underline hover:text-stone-300">
                Full log →
              </Link>
            </div>
            <div className="max-h-[400px] divide-y overflow-y-auto" style={{ borderColor: "rgba(120,113,108,0.08)" }}>
              {(data?.activity ?? []).map((event) => {
                const agent = event.agentId ? agentLookup.get(event.agentId.toLowerCase()) : null;
                return (
                  <div key={event.id} className="flex items-start gap-2.5 px-4 py-2">
                    <span
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px]"
                      style={{ background: "rgba(120,113,108,0.15)", color: agent ? "#a8a29e" : "#78716c" }}
                    >
                      {agent?.emoji ?? "BO"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-stone-300">{event.message}</p>
                    </div>
                    <span className="shrink-0 text-[10px] text-stone-600">{formatAge(event.timestamp)}</span>
                  </div>
                );
              })}
              {!data?.activity.length && !loading && (
                <p className="px-4 py-6 text-center text-xs text-stone-600">No recent activity.</p>
              )}
            </div>
          </section>

          {/* Recent Tasks */}
          <section
            className="rounded-lg border"
            style={{ borderColor: "rgba(120,113,108,0.15)", background: "rgba(28,25,23,0.5)" }}
          >
            <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "rgba(120,113,108,0.12)" }}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Recent Tasks</h2>
              <Link href={buildCompanyPath(slug, "/issues")} className="text-[10px] text-stone-600 no-underline hover:text-stone-300">
                All tasks →
              </Link>
            </div>
            <div className="max-h-[400px] divide-y overflow-y-auto" style={{ borderColor: "rgba(120,113,108,0.08)" }}>
              {recentTasks.map((task) => {
                const assigneeAgent = task.assignee ? agentLookup.get(task.assignee.toLowerCase()) : null;
                const identifier = task.key ?? task.id.slice(0, 8);
                const dotColor = TASK_STATUS_COLOR[task.status] ?? "#78716c";
                return (
                  <div key={task.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="inline-block h-[12px] w-[12px] shrink-0 rounded-full border-2" style={{ borderColor: dotColor }} />
                    <span className="shrink-0 font-mono text-[11px] text-stone-500">{identifier}</span>
                    {assigneeAgent && (
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px]" style={{ background: "rgba(120,113,108,0.15)", color: "#a8a29e" }}>
                        {assigneeAgent.emoji ?? "•"}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] text-stone-600">{formatAge(task.updated)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-stone-300">{task.title}</span>
                  </div>
                );
              })}
              {recentTasks.length === 0 && !loading && (
                <p className="px-4 py-6 text-center text-xs text-stone-600">No tasks yet.</p>
              )}
            </div>
          </section>
        </div>

        {/* ── loading / error ── */}
        {loading && (
          <div className="mt-6 flex items-center justify-center text-xs text-stone-500">
            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
            Loading dashboard…
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-md border px-3 py-2 text-xs text-amber-200" style={{ borderColor: "rgba(217,119,6,0.2)", background: "rgba(217,119,6,0.06)" }}>
            <AlertCircle className="mr-1.5 inline h-3 w-3" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Agent Run Card (Paperclip-style) ── */

function AgentRunCard({
  agent,
  profile,
  companySlug,
}: {
  agent: OrchestrationAgent;
  profile: OrchestrationAgentProfile | null;
  companySlug: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const dotColor = STATUS_DOT_COLOR[agent.status];
  const dotGlow = STATUS_DOT_GLOW[agent.status];
  const agentHref = buildCompanyPath(companySlug, `/agents/${encodeURIComponent(agent.slug ?? agent.id)}/dashboard`);

  const latestRun = profile?.liveSession ?? profile?.executionHistory?.[0] ?? null;
  const recentActivity = profile?.recentActivity ?? [];
  const currentTasks = profile?.currentTasks ?? [];

  // Build the run status label
  const runStatusLabel = latestRun
    ? latestRun.status === "running"
      ? "Running"
      : `Finished ${formatAge(latestRun.completedAt ?? latestRun.createdAt)} ago`
    : agent.status === "working"
      ? "Running"
      : agent.status === "paused"
        ? "Paused"
        : null;

  // Latest comment from this agent (most recent activity of kind "comment")
  const latestComment = recentActivity.find((a) => a.kind === "comment");
  // Recent events (non-comment activity)
  const recentEvents = recentActivity.filter((a) => a.kind === "event").slice(0, 3);

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "rgba(120,113,108,0.15)", background: "rgba(28,25,23,0.5)" }}
    >
      {/* ── header ── */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ background: dotColor, boxShadow: dotGlow }}
          />
          <span
            className="inline-flex h-6 w-6 items-center justify-center rounded text-xs"
            style={{ background: "rgba(120,113,108,0.12)", color: "#a8a29e" }}
          >
            {agent.emoji ?? "🤖"}
          </span>
          <span className="text-sm font-medium text-stone-200">{agent.name}</span>
        </div>
        <Link href={agentHref} className="text-stone-600 hover:text-stone-300">
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* ── run status line ── */}
      {runStatusLabel && (
        <div className="px-3 pb-1">
          <span className="text-[11px] text-stone-500">{runStatusLabel}</span>
        </div>
      )}

      {/* ── task context pill (latest run or current task) ── */}
      {latestRun ? (
        <div className="mx-3 mb-2 rounded-md px-2.5 py-1.5" style={{ background: "rgba(120,113,108,0.07)" }}>
          <span className="text-xs text-stone-400">
            {latestRun.taskTitle}
          </span>
        </div>
      ) : currentTasks.length > 0 ? (
        <div className="mx-3 mb-2 rounded-md px-2.5 py-1.5" style={{ background: "rgba(120,113,108,0.07)" }}>
          <span className="text-xs text-stone-400">
            {currentTasks[0].title}
          </span>
        </div>
      ) : null}

      {/* ── latest comment / agent output ── */}
      {latestComment ? (
        <div className="mx-3 mb-2">
          <p className="text-sm leading-relaxed text-stone-200">
            {latestComment.message.length > 200
              ? latestComment.message.slice(0, 200) + "…"
              : latestComment.message}
          </p>
        </div>
      ) : agent.currentTask && !latestRun ? (
        <div className="mx-3 mb-2">
          <p className="text-xs text-stone-400">{agent.role}</p>
        </div>
      ) : !latestRun ? (
        <div className="mx-3 mb-2">
          <p className="text-xs text-stone-500">{agent.role}</p>
        </div>
      ) : null}

      {/* ── execution run metadata ── */}
      {latestRun && (
        <div className="mx-3 mb-2">
          <RunBadge run={latestRun} />
        </div>
      )}

      {/* ── expandable recent activity ── */}
      {recentEvents.length > 0 && (
        <div className="border-t" style={{ borderColor: "rgba(120,113,108,0.08)" }}>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] text-stone-500 hover:text-stone-300"
          >
            <ChevronRight
              className="h-3 w-3 shrink-0 transition-transform"
              style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
            />
            {recentEvents.length} recent event{recentEvents.length !== 1 ? "s" : ""}
          </button>
          {expanded && (
            <div className="space-y-0.5 px-3 pb-2">
              {recentEvents.map((event) => (
                <p key={event.id} className="truncate text-[11px] text-stone-500">
                  {event.message}
                  <span className="ml-1.5 text-stone-600">{formatAge(event.timestamp)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Run badge ── */

function RunBadge({ run }: { run: OrchestrationAgentExecutionRun }) {
  const style = RUN_STATUS_STYLE[run.status] ?? RUN_STATUS_STYLE.pending;
  const sessionShort = run.sessionId?.slice(0, 8) ?? run.id.slice(0, 8);
  const durationLabel = run.durationMs
    ? run.durationMs < 60_000
      ? `${Math.round(run.durationMs / 1000)}s`
      : `${Math.round(run.durationMs / 60_000)}m`
    : null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{ color: style.color, background: style.bg }}
      >
        <Terminal className="h-2.5 w-2.5" />
        {run.status}
      </span>
      <span className="font-mono text-[10px] text-stone-600">{sessionShort}</span>
      {run.provider !== "manual" && (
        <span
          className="rounded px-1 py-0.5 text-[9px] font-medium uppercase"
          style={{ color: "#d97706", background: "rgba(217,119,6,0.1)" }}
        >
          {run.provider === "openclaw" ? "Timer" : run.provider}
        </span>
      )}
      {durationLabel && (
        <span className="text-[10px] text-stone-600">{durationLabel}</span>
      )}
      {run.errorMessage && (
        <span className="truncate text-[10px] text-red-400">{run.errorMessage}</span>
      )}
    </div>
  );
}

/* ── Metric card ── */

function MetricCard({
  value,
  label,
  detail,
  icon,
}: {
  value: number | string;
  label: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "rgba(120,113,108,0.15)", background: "rgba(28,25,23,0.5)" }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-bold text-stone-100">{value}</p>
          <p className="mt-0.5 text-xs font-medium text-stone-400">{label}</p>
        </div>
        <span className="text-stone-600">{icon}</span>
      </div>
      <p className="mt-1 text-[11px] text-stone-600">{detail}</p>
    </div>
  );
}

/* ── Chart card ── */

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border px-3 py-2.5"
      style={{ borderColor: "rgba(120,113,108,0.15)", background: "rgba(28,25,23,0.5)" }}
    >
      <div className="mb-2">
        <p className="text-xs font-medium text-stone-400">{title}</p>
        {subtitle && <p className="text-[10px] text-stone-600">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* ── Time-series vertical bar chart ── */

function TimeSeriesBar({
  data,
  color,
  formatValue,
}: {
  data: Array<{ label: string; value: number }>;
  color: string;
  formatValue?: (v: number) => string;
}) {
  if (data.length === 0) return <p className="py-3 text-center text-[10px] text-stone-600">No data</p>;

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const barHeight = 64;

  return (
    <div>
      <div className="flex items-end gap-px" style={{ height: barHeight }}>
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max((d.value / maxVal) * barHeight, 2) : 0;
          return (
            <div
              key={i}
              className="group relative flex-1"
              style={{ height: barHeight }}
              title={`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}
            >
              <div
                className="absolute bottom-0 left-0 right-0 rounded-t-sm transition-opacity group-hover:opacity-100"
                style={{
                  height: h,
                  background: color,
                  opacity: d.value > 0 ? 0.7 : 0,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* x-axis labels: first, middle, last */}
      <div className="mt-1 flex justify-between text-[9px] text-stone-600">
        <span>{data[0]?.label}</span>
        {data.length > 4 && <span>{data[Math.floor(data.length / 2)]?.label}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/* ── Stacked time-series bar chart ── */

function StackedTimeSeriesBar({
  labels,
  series,
}: {
  labels: string[];
  series: Array<{ key: string; values: number[]; color: string }>;
}) {
  if (labels.length === 0) return <p className="py-3 text-center text-[10px] text-stone-600">No data</p>;

  const barHeight = 64;
  // Compute max stacked total per day
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const maxTotal = Math.max(...totals, 1);

  return (
    <div>
      <div className="flex items-end gap-px" style={{ height: barHeight }}>
        {labels.map((label, i) => {
          const dayTotal = totals[i];
          return (
            <div
              key={i}
              className="relative flex-1"
              style={{ height: barHeight }}
              title={`${label}: ${dayTotal} tasks`}
            >
              <div className="absolute bottom-0 left-0 right-0 flex flex-col-reverse">
                {series.map((s) => {
                  const v = s.values[i] ?? 0;
                  if (v === 0) return null;
                  const h = Math.max((v / maxTotal) * barHeight, 1);
                  return (
                    <div
                      key={s.key}
                      className="rounded-t-sm"
                      style={{ height: h, background: s.color, opacity: 0.7 }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {/* x-axis */}
      <div className="mt-1 flex justify-between text-[9px] text-stone-600">
        <span>{labels[0]}</span>
        {labels.length > 4 && <span>{labels[Math.floor(labels.length / 2)]}</span>}
        <span>{labels[labels.length - 1]}</span>
      </div>
      {/* legend */}
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {series.filter((s) => s.values.some((v) => v > 0)).map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[9px] text-stone-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {statusTheme[s.key as keyof typeof statusTheme]?.label ?? s.key}
          </span>
        ))}
      </div>
    </div>
  );
}
