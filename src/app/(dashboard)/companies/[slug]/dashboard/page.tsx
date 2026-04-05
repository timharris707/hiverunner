"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { useNotifications } from "@/components/notifications/NotificationToast";
import { useLiveRuns, type LiveRun, type LiveRunTranscriptEntry } from "@/hooks/useLiveRuns";
import { useLiveRunStream, type AgentStreamState, type StreamTranscriptEntry } from "@/hooks/useLiveRunStream";
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

  const dailyTasksByPriority = useMemo(() => {
    const PRIORITY_COLORS: Record<string, string> = {
      critical: "#ef4444",
      high: "#f59e0b",
      medium: "#d97706",
      low: "#94a3b8",
    };
    if (!data) return { days: [] as string[], series: {} as Record<string, number[]>, colors: PRIORITY_COLORS };
    const PRIORITY_ORDER = ["critical", "high", "medium", "low"];
    const buckets: Record<string, Record<string, number>> = {};
    for (const t of data.tasks) {
      const day = t.created?.split("T")[0] ?? t.updated?.split("T")[0];
      if (!day) continue;
      const pri = (t.priority ?? "medium").toLowerCase().replace(/^p0$/, "critical").replace(/^p1$/, "high").replace(/^p2$/, "medium").replace(/^p3$/, "low");
      if (!buckets[day]) buckets[day] = {};
      buckets[day][pri] = (buckets[day][pri] ?? 0) + 1;
    }
    const series: Record<string, number[]> = {};
    for (const p of PRIORITY_ORDER) series[p] = [];
    for (const day of last14Days) {
      for (const p of PRIORITY_ORDER) {
        series[p].push(buckets[day]?.[p] ?? 0);
      }
    }
    return { days: last14Days.map(formatDayLabel), series, colors: PRIORITY_COLORS };
  }, [data, last14Days]);

  const successRateData = useMemo(() => {
    // Derive from execution_runs via agent profiles
    if (!data) return { total: 0, completed: 0, failed: 0, running: 0, daily: [] as Array<{ label: string; completed: number; failed: number }> };
    const runs: Array<{ status: string; completedAt?: string; createdAt: string }> = [];
    for (const profile of data.agentProfiles.values()) {
      for (const run of profile.executionHistory) {
        runs.push({ status: run.status, completedAt: run.completedAt, createdAt: run.createdAt });
      }
    }
    const completed = runs.filter((r) => r.status === "completed").length;
    const failed = runs.filter((r) => r.status === "failed" || r.status === "cancelled").length;
    const running = runs.filter((r) => r.status === "running" || r.status === "pending").length;
    // Daily bucketing
    const daily = last14Days.map((day) => {
      const dayRuns = runs.filter((r) => (r.completedAt ?? r.createdAt)?.split("T")[0] === day);
      return {
        label: formatDayLabel(day),
        completed: dayRuns.filter((r) => r.status === "completed").length,
        failed: dayRuns.filter((r) => r.status === "failed" || r.status === "cancelled").length,
      };
    });
    return { total: runs.length, completed, failed, running, daily };
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

  /* ── live runs polling (3s, always active when dashboard loaded) ── */
  const { runsByAgentId, transitions, hasActiveRuns } = useLiveRuns({
    companySlug: slug,
    enabled: !!data,
  });

  /* ── live run streaming (real-time gateway events via SSE) ── */
  const { streamByAgentId } = useLiveRunStream({
    companySlug: slug,
    enabled: !!data && hasActiveRuns,
  });

  const { push: pushToast } = useNotifications();

  // Fire toasts on run state transitions
  useEffect(() => {
    for (const t of transitions) {
      if (t.toStatus === "succeeded") {
        const actionCount = t.result?.actionsExecuted ?? 0;
        const reportCount = t.result?.reportsImported ?? 0;
        pushToast({
          title: `${t.agentName} completed run`,
          body: `${actionCount} action${actionCount !== 1 ? "s" : ""}, ${reportCount} report${reportCount !== 1 ? "s" : ""}`,
          dotColor: "#4ade80",
          href: buildCompanyPath(slug, `/agents/${encodeURIComponent(t.agentSlug)}/dashboard`),
          hrefLabel: "View agent",
          ttl: 8000,
        });
      } else if (t.toStatus === "failed" || t.toStatus === "timed_out") {
        pushToast({
          title: `${t.agentName} run ${t.toStatus === "timed_out" ? "timed out" : "failed"}`,
          body: t.error?.slice(0, 120) ?? "Check agent detail for error info.",
          dotColor: "#ef4444",
          href: buildCompanyPath(slug, `/agents/${encodeURIComponent(t.agentSlug)}/dashboard`),
          hrefLabel: "View agent",
          ttl: 10000,
        });
      }
    }
  }, [transitions, slug, pushToast]);

  // Persistent recency tracking — survives across render cycles
  const agentRecencyRef = useRef<Map<string, number>>(new Map());

  // Update recency timestamps when live run data changes
  useEffect(() => {
    for (const [agentId, run] of runsByAgentId) {
      // Best timestamp: latest transcript entry > finishedAt > startedAt
      const transcriptTs = run.transcript.length > 0
        ? new Date(run.transcript[run.transcript.length - 1].ts).getTime()
        : 0;
      const finishedTs = run.finishedAt ? new Date(run.finishedAt).getTime() : 0;
      const startedTs = run.startedAt ? new Date(run.startedAt).getTime() : 0;
      const bestTs = Math.max(transcriptTs, finishedTs, startedTs);

      const current = agentRecencyRef.current.get(agentId) ?? 0;
      if (bestTs > current) {
        agentRecencyRef.current.set(agentId, bestTs);
      }
    }
  }, [runsByAgentId]);

  // Sort agents: most recent activity first, then alphabetical
  const sortedAgents = useMemo(() => {
    if (!data) return [];
    return [...data.agents].sort((a, b) => {
      const aTs = agentRecencyRef.current.get(a.id) ?? 0;
      const bTs = agentRecencyRef.current.get(b.id) ?? 0;
      if (aTs !== bTs) return bTs - aTs; // higher timestamp = more recent = first
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, runsByAgentId]);

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
          {data && sortedAgents.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {sortedAgents.map((agent) => (
                <AgentRunCard
                  key={agent.id}
                  agent={agent}
                  profile={data.agentProfiles.get(agent.id) ?? null}
                  companySlug={slug}
                  liveRun={runsByAgentId.get(agent.id) ?? null}
                  agentStream={streamByAgentId.get(agent.id) ?? null}
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
          <ChartCard title="Tasks by Priority" subtitle="Last 14 days">
            <StackedTimeSeriesBar
              labels={dailyTasksByPriority.days}
              series={["critical", "high", "medium", "low"].map((pri) => ({
                key: pri,
                label: pri.charAt(0).toUpperCase() + pri.slice(1),
                values: dailyTasksByPriority.series[pri] ?? [],
                color: dailyTasksByPriority.colors[pri] ?? "#78716c",
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
          <ChartCard title="Success Rate" subtitle="Last 14 days">
            {successRateData.completed + successRateData.failed === 0 ? (
              <div className="flex flex-col items-center justify-center py-4 text-center">
                <p className="text-[10px] text-stone-500">No completed runs yet</p>
                <p className="mt-0.5 text-[9px] text-stone-600">
                  {successRateData.running > 0
                    ? `${successRateData.running} run${successRateData.running !== 1 ? "s" : ""} in progress`
                    : "Runs will appear as agents execute tasks"}
                </p>
              </div>
            ) : (
              <SuccessRateBar data={successRateData.daily} />
            )}
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

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

/* ── Streaming text block — shows live assistant output ── */
function StreamingTextBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  // Show last ~400 chars for compact display
  const displayText = text.length > 400 ? "…" + text.slice(-400) : text;

  return (
    <div
      ref={scrollRef}
      className="mx-3 mb-2 overflow-y-auto rounded-md px-2.5 py-2"
      style={{
        maxHeight: "120px",
        background: "rgba(6,182,212,0.04)",
        border: "1px solid rgba(6,182,212,0.12)",
      }}
    >
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-stone-300">
        {displayText}
        {isStreaming && (
          <span
            className="ml-0.5 inline-block h-3 w-0.5 animate-pulse"
            style={{ backgroundColor: "#06b6d4", verticalAlign: "text-bottom" }}
          />
        )}
      </p>
    </div>
  );
}

/* ── Scrollable transcript inside agent card ── */
function AgentTranscript({
  entries,
  streamEvents = [],
  isLive,
}: {
  entries: LiveRunTranscriptEntry[];
  streamEvents?: StreamTranscriptEntry[];
  isLive: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Merge poll-based entries with real-time stream events, dedup by content
  const mergedEntries = useMemo(() => {
    // Convert stream events to LiveRunTranscriptEntry format
    const streamAsTranscript: LiveRunTranscriptEntry[] = streamEvents
      .filter((e) => e.kind !== "assistant_delta") // text shown separately
      .map((e) => ({
        id: e.id,
        kind: "action" as const,
        message: e.message,
        ts: e.ts,
        type: e.kind, // map stream kind → type for icon rendering
      }));

    // Merge and sort chronologically
    const all = [...entries, ...streamAsTranscript];

    // Dedup: if a stream event has the same message and similar timestamp as a poll entry, skip it
    const seen = new Set<string>();
    const deduped: LiveRunTranscriptEntry[] = [];
    for (const entry of all) {
      const key = `${entry.message.slice(0, 60)}:${entry.ts.slice(0, 16)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }

    return deduped
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .slice(-16); // keep last 16
  }, [entries, streamEvents]);

  // Auto-scroll to bottom when new entries arrive (chronological order, newest at bottom)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mergedEntries.length]);

  return (
    <div
      ref={scrollRef}
      className="mx-3 mb-2 overflow-y-auto rounded-md"
      style={{
        maxHeight: "180px",
        background: isLive ? "rgba(6,182,212,0.03)" : "rgba(28,25,23,0.3)",
        border: isLive ? "1px solid rgba(6,182,212,0.1)" : "1px solid rgba(120,113,108,0.08)",
      }}
    >
      {mergedEntries.map((entry, i) => (
        <div
          key={entry.id}
          className="border-b px-2.5 py-1.5 last:border-b-0"
          style={{
            borderColor: "rgba(120,113,108,0.06)",
            animation: i === mergedEntries.length - 1 && isLive ? "fadeSlideIn 0.3s ease" : undefined,
          }}
        >
          {entry.kind === "comment" ? (
            <>
              <p className="text-xs leading-relaxed text-stone-300">
                {entry.message.length > 200 ? entry.message.slice(0, 200) + "…" : entry.message}
              </p>
              <span className="mt-0.5 block text-[9px] text-stone-600">
                {entry.type === "status_update" ? "📋 report" : "💬 comment"} · {formatAge(entry.ts)}
              </span>
            </>
          ) : entry.kind === "action" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]" style={{
                color: entry.type === "action_error" || entry.type === "lifecycle_error" || entry.type === "error" ? "#ef4444"
                  : entry.type === "action_skipped" ? "#ca8a04"
                  : entry.type === "waiting" || entry.type === "session_start" || entry.type === "lifecycle_start" ? "#06b6d4"
                  : entry.type === "tool_start" || entry.type === "tool_end" ? "#a78bfa"
                  : entry.type === "lifecycle_end" || entry.type === "assistant_final" ? "#06b6d4"
                  : "#4ade80",
              }}>
                {entry.type === "action_executed" ? "✓"
                  : entry.type === "action_error" || entry.type === "lifecycle_error" || entry.type === "error" ? "✗"
                  : entry.type === "action_skipped" ? "⏭"
                  : entry.type === "waiting" || entry.type === "session_start" || entry.type === "lifecycle_start" ? "◉"
                  : entry.type === "tool_start" ? "⚡"
                  : entry.type === "tool_end" ? "⚡"
                  : entry.type === "parsing_complete" ? "⎔"
                  : entry.type === "actions_complete" || entry.type === "lifecycle_end" ? "✓"
                  : entry.type === "assistant_final" ? "💬"
                  : "→"}
              </span>
              <span className="flex-1 text-[11px]" style={{
                color: entry.type === "action_error" || entry.type === "lifecycle_error" || entry.type === "error" ? "#fca5a5"
                  : entry.type === "action_skipped" ? "#fde68a"
                  : entry.type === "tool_start" || entry.type === "tool_end" ? "#c4b5fd"
                  : entry.type?.startsWith("action_") ? "#86efac"
                  : entry.type?.startsWith("lifecycle_") || entry.type === "assistant_final" ? "#67e8f9"
                  : "#a8a29e",
              }}>{entry.message}</span>
              <span className="shrink-0 text-[9px] text-stone-600">{formatAge(entry.ts)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-stone-500">→</span>
              <span className="text-[11px] text-stone-400">{entry.message}</span>
              <span className="ml-auto text-[9px] text-stone-600">{formatAge(entry.ts)}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Action execution badge (Paperclip "EXECUTED N COMMANDS" equivalent) ── */
function ActionBadge({ result, status }: { result: NonNullable<LiveRun["result"]>; status: string }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = status === "running" || status === "queued";
  const total = result.actionsExecuted + result.actionsSkippedDedup;
  const label = isRunning
    ? `Executing ${total > 0 ? total : ""} action${total !== 1 ? "s" : ""}…`
    : `Executed ${result.actionsExecuted} action${result.actionsExecuted !== 1 ? "s" : ""}`;

  return (
    <div className="mx-3 mb-1.5">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-stone-200"
        style={{ background: "rgba(120,113,108,0.06)" }}
      >
        <div className="flex gap-0.5">
          {Array.from({ length: Math.min(result.actionsExecuted, 4) }).map((_, i) => (
            <span key={i} className="inline-block h-3 w-3 rounded border p-[1px]" style={{
              borderColor: "rgba(120,113,108,0.2)",
            }}>
              <CheckCircle2 className="h-full w-full text-emerald-500/70" />
            </span>
          ))}
          {result.errors.length > 0 && (
            <span className="inline-block h-3 w-3 rounded border p-[1px]" style={{ borderColor: "rgba(239,68,68,0.2)" }}>
              <AlertCircle className="h-full w-full text-red-400/70" />
            </span>
          )}
        </div>
        <span className="flex-1 text-left font-medium uppercase tracking-wider">{label}</span>
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 px-1.5 text-[10px] text-stone-500">
          {result.tasksCreated.length > 0 && (
            <p>📋 {result.tasksCreated.length} task{result.tasksCreated.length !== 1 ? "s" : ""} created</p>
          )}
          {result.approvalsCreated.length > 0 && (
            <p>🤝 {result.approvalsCreated.length} approval{result.approvalsCreated.length !== 1 ? "s" : ""} requested</p>
          )}
          {result.reportsImported > 0 && (
            <p>📊 {result.reportsImported} report{result.reportsImported !== 1 ? "s" : ""} imported</p>
          )}
          {(result.actionsExecuted - result.tasksCreated.length - result.approvalsCreated.length - result.reportsImported) > 0 && (
            <p>💬 {result.actionsExecuted - result.tasksCreated.length - result.approvalsCreated.length - result.reportsImported} comment{(result.actionsExecuted - result.tasksCreated.length - result.approvalsCreated.length - result.reportsImported) !== 1 ? "s" : ""} posted</p>
          )}
          {result.actionsSkippedDedup > 0 && (
            <p>⏭ {result.actionsSkippedDedup} skipped (dedup)</p>
          )}
          {result.errors.length > 0 && (
            <p className="text-red-400">⚠ {result.errors.length} error{result.errors.length !== 1 ? "s" : ""}</p>
          )}
        </div>
      )}
    </div>
  );
}

function AgentRunCard({
  agent,
  profile,
  companySlug,
  liveRun,
  agentStream,
}: {
  agent: OrchestrationAgent;
  profile: OrchestrationAgentProfile | null;
  companySlug: string;
  liveRun: LiveRun | null;
  agentStream: AgentStreamState | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const agentHref = buildCompanyPath(companySlug, `/agents/${encodeURIComponent(agent.slug ?? agent.id)}/dashboard`);

  const latestRun = profile?.liveSession ?? profile?.executionHistory?.[0] ?? null;
  const recentActivity = profile?.recentActivity ?? [];
  const currentTasks = profile?.currentTasks ?? [];

  // Determine if this card is "live" — agent is running or has a recent live run
  const isLive = liveRun != null && (liveRun.status === "running" || liveRun.status === "queued");
  const justFinished = liveRun != null && (liveRun.status === "succeeded" || liveRun.status === "failed" || liveRun.status === "timed_out");

  // Status dot — cyan when live, otherwise standard
  const dotColor = isLive ? "#06b6d4" : STATUS_DOT_COLOR[agent.status];
  const dotGlow = isLive ? "0 0 8px rgba(6,182,212,0.6)" : STATUS_DOT_GLOW[agent.status];

  // Card border/background — cyan glow when live
  const cardBorder = isLive
    ? "rgba(6,182,212,0.25)"
    : justFinished
      ? "rgba(74,222,128,0.2)"
      : "rgba(120,113,108,0.15)";
  const cardBg = isLive
    ? "rgba(6,182,212,0.04)"
    : "rgba(28,25,23,0.5)";
  const cardShadow = isLive
    ? "0 8px 24px rgba(6,182,212,0.08)"
    : "none";

  // Build the run status label
  const runStatusLabel = isLive
    ? "Running"
    : latestRun
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

  // Best output text — prefer live run's latest output over profile comment
  const outputText = liveRun?.latestOutput ?? latestComment?.message ?? null;

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        borderColor: cardBorder,
        background: cardBg,
        boxShadow: cardShadow,
        transition: "border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease",
      }}
    >
      {/* ── header ── */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Status dot — pulsing when live */}
          {isLive ? (
            <span className="relative inline-flex h-2 w-2 shrink-0">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                style={{ backgroundColor: "#06b6d4" }}
              />
              <span
                className="relative inline-flex h-2 w-2 rounded-full"
                style={{ backgroundColor: "#06b6d4", boxShadow: "0 0 6px rgba(6,182,212,0.6)" }}
              />
            </span>
          ) : (
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: dotColor, boxShadow: dotGlow }}
            />
          )}
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
          <span className="text-[11px]" style={{ color: isLive ? "#06b6d4" : "#78716c" }}>
            {runStatusLabel}
          </span>
        </div>
      )}

      {/* ── task context pill (latest run or current task) ── */}
      {latestRun ? (
        <div className="mx-3 mb-2 rounded-md px-2.5 py-1.5" style={{
          background: isLive ? "rgba(6,182,212,0.06)" : "rgba(120,113,108,0.07)",
          border: isLive ? "1px solid rgba(6,182,212,0.12)" : "none",
        }}>
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

      {/* ── LIVE: progress header ── */}
      {isLive && (
        <div className="mx-3 mb-1 flex items-center gap-2 text-[11px]" style={{ color: "#06b6d4" }}>
          <LoaderCircle className="h-3 w-3 animate-spin" />
          <span>Running… {formatElapsed(liveRun.durationMs)}</span>
        </div>
      )}

      {/* ── LIVE: streaming assistant text from gateway ── */}
      {isLive && agentStream?.streamingText && (
        <StreamingTextBlock text={agentStream.streamingText} isStreaming={agentStream.isStreaming} />
      )}

      {/* ── Action execution badge (Paperclip "EXECUTED N COMMANDS" equivalent) ── */}
      {liveRun?.result && (
        <ActionBadge result={liveRun.result} status={liveRun.status} />
      )}
      {isLive && !liveRun.result && (
        <div className="mx-3 mb-1.5 flex items-center gap-1.5 text-[10px] text-stone-500">
          <Terminal className="h-3 w-3" />
          <span>Executing actions…</span>
        </div>
      )}

      {/* ── JUST FINISHED: completion summary ── */}
      {justFinished && liveRun.result && (
        <div className="mx-3 mb-1.5 rounded-md px-2.5 py-1.5" style={{
          background: liveRun.status === "succeeded" ? "rgba(74,222,128,0.06)" : "rgba(239,68,68,0.06)",
          border: `1px solid ${liveRun.status === "succeeded" ? "rgba(74,222,128,0.15)" : "rgba(239,68,68,0.15)"}`,
        }}>
          <span className="text-[11px] font-medium" style={{
            color: liveRun.status === "succeeded" ? "#4ade80" : "#ef4444",
          }}>
            {liveRun.status === "succeeded" ? "✓" : "✗"}{" "}
            {liveRun.result.actionsExecuted} action{liveRun.result.actionsExecuted !== 1 ? "s" : ""},{" "}
            {liveRun.result.reportsImported} report{liveRun.result.reportsImported !== 1 ? "s" : ""}
            {liveRun.result.errors.length > 0 && ` · ${liveRun.result.errors.length} error${liveRun.result.errors.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      )}

      {/* ── Scrollable multi-entry transcript (merged: poll + stream) ── */}
      {liveRun && (liveRun.transcript.length > 0 || (agentStream?.events.length ?? 0) > 0) ? (
        <AgentTranscript
          entries={liveRun.transcript}
          streamEvents={agentStream?.events ?? []}
          isLive={isLive}
        />
      ) : !isLive && outputText ? (
        <div className="mx-3 mb-2">
          <p className="text-sm leading-relaxed text-stone-200">
            {outputText.length > 200
              ? outputText.slice(0, 200) + "…"
              : outputText}
          </p>
        </div>
      ) : !isLive && !outputText && !latestRun ? (
        <div className="mx-3 mb-2">
          <p className="text-xs text-stone-500">{agent.role}</p>
        </div>
      ) : null}

      {/* ── execution run metadata ── */}
      {latestRun && !isLive && (
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
  series: Array<{ key: string; label?: string; values: number[]; color: string }>;
}) {
  if (labels.length === 0) return <p className="py-3 text-center text-[10px] text-stone-600">No data</p>;

  const barHeight = 64;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const maxTotal = Math.max(...totals, 1);

  return (
    <div>
      <div className="flex items-end gap-px" style={{ height: barHeight }}>
        {labels.map((label, i) => {
          const dayTotal = totals[i];
          return (
            <div key={i} className="relative flex-1" style={{ height: barHeight }} title={`${label}: ${dayTotal}`}>
              <div className="absolute bottom-0 left-0 right-0 flex flex-col-reverse">
                {series.map((s) => {
                  const v = s.values[i] ?? 0;
                  if (v === 0) return null;
                  const h = Math.max((v / maxTotal) * barHeight, 1);
                  return <div key={s.key} className="rounded-t-sm" style={{ height: h, background: s.color, opacity: 0.7 }} />;
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-stone-600">
        <span>{labels[0]}</span>
        {labels.length > 4 && <span>{labels[Math.floor(labels.length / 2)]}</span>}
        <span>{labels[labels.length - 1]}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
        {series.filter((s) => s.values.some((v) => v > 0)).map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[9px] text-stone-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {s.label ?? s.key}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Success rate bar (stacked completed vs failed) ── */

function SuccessRateBar({ data }: { data: Array<{ label: string; completed: number; failed: number }> }) {
  const barHeight = 64;
  const maxVal = Math.max(...data.map((d) => d.completed + d.failed), 1);

  return (
    <div>
      <div className="flex items-end gap-px" style={{ height: barHeight }}>
        {data.map((d, i) => {
          const total = d.completed + d.failed;
          if (total === 0) return <div key={i} className="flex-1" style={{ height: barHeight }} />;
          const completedH = Math.max((d.completed / maxVal) * barHeight, 1);
          const failedH = d.failed > 0 ? Math.max((d.failed / maxVal) * barHeight, 1) : 0;
          return (
            <div key={i} className="relative flex-1" style={{ height: barHeight }} title={`${d.label}: ${d.completed} ok, ${d.failed} failed`}>
              <div className="absolute bottom-0 left-0 right-0 flex flex-col-reverse">
                {d.completed > 0 && <div className="rounded-t-sm" style={{ height: completedH, background: "#4ade80", opacity: 0.7 }} />}
                {d.failed > 0 && <div className="rounded-t-sm" style={{ height: failedH, background: "#ef4444", opacity: 0.7 }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-stone-600">
        <span>{data[0]?.label}</span>
        {data.length > 4 && <span>{data[Math.floor(data.length / 2)]?.label}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}
