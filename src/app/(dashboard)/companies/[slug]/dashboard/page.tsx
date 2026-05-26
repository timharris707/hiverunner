"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock3,
  DollarSign,
  ExternalLink,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { formatAge } from "@/components/orchestration/ui";
import {
  getCompanyAgentProfile,
  listActivityFeed,
  listCompanies,
  listCompanyAgents,
  listCompanyApprovals,
  listCompanyGoals,
  listProjects,
  listTasks,
  updateCompanyGoal,
} from "@/lib/orchestration/client";
import { SprintRow } from "@/components/goals/SprintRow";
import { COMPANY_SLUG_TO_CODE } from "@/lib/orchestration/edge-route-maps";
import { isAgentLive } from "@/lib/orchestration/live-status";
import { buildCanonicalAgentPath, buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import { isRunLive } from "@/lib/orchestration/live-status";
import { deriveRunLiveness, type RunLivenessSnapshot } from "@/lib/orchestration/live-run-liveness";
import { useNotifications } from "@/components/notifications/NotificationToast";
import { useLiveRuns, type LiveRun, type LiveRunTranscriptEntry } from "@/hooks/useLiveRuns";
import { useLiveStream } from "@/components/live/LiveStreamProvider";
import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";
import { resolveAgentModelDisplay } from "@/lib/orchestration/agent-model-display";
import type { AgentStreamState, StreamTranscriptEntry } from "@/hooks/useLiveRunStream";
import type {
  OrchestrationActivityEvent,
  OrchestrationAgent,
  OrchestrationAgentExecutionRun,
  OrchestrationAgentProfile,
  OrchestrationApproval,
  OrchestrationCompany,
  OrchestrationCompanyGoal,
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

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

const STATUS_DOT_COLOR: Record<OrchestrationAgent["status"], string> = {
  working: "var(--accent)",
  idle: "var(--text-secondary)",
  paused: "var(--warning)",
  offline: "var(--text-muted)",
  error: "var(--negative)",
};

const STATUS_DOT_GLOW: Record<OrchestrationAgent["status"], string> = {
  working: "0 0 6px color-mix(in srgb, var(--accent) 60%, transparent)",
  idle: "none",
  paused: "none",
  offline: "none",
  error: "0 0 6px color-mix(in srgb, var(--negative) 40%, transparent)",
};

const TASK_STATUS_COLOR: Record<string, string> = {
  "in-progress": "var(--accent)",
  "to-do": "var(--accent)",
  backlog: "var(--text-muted)",
  review: "var(--warning)",
  done: "var(--positive)",
  blocked: "var(--negative)",
  cancelled: "var(--text-muted)",
};

const RUN_STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  running: { color: "var(--accent)", bg: "var(--accent-soft)" },
  completed: { color: "var(--text-secondary)", bg: "var(--surface-elevated)" },
  failed: { color: "var(--negative)", bg: "var(--negative-soft)" },
  cancelled: { color: "var(--warning)", bg: "var(--warning-soft)" },
  pending: { color: "var(--text-muted)", bg: "var(--surface-elevated)" },
};

const TASK_STATUS_LABEL: Record<string, string> = {
  "in-progress": "In progress",
  "to-do": "On deck",
  backlog: "Backlog",
  review: "In review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

// Dev mode: 60s refresh to reduce webpack dev server pressure.
// Production: 15s for responsive dashboard updates.
const REFRESH_MS = process.env.NODE_ENV === "development" ? 60_000 : 15_000;
const DASHBOARD_AGENT_PROFILE_LIMIT = 6;

type DailyCost = { date: string; cost: number; input: number; output: number };

type CostSnapshot = {
  thisMonth: number;
  budget: number;
  today: number;
  projected: number;
  daily: DailyCost[];
} | null;

async function loadDashboardCosts(company: OrchestrationCompany): Promise<CostSnapshot> {
  const isDefaultCompany = company.slug === "hiverunner-workspace" || company.code === "HIVE";
  if (!isDefaultCompany) return null;

  try {
    const costResp = await withTimeout(
      fetch("/api/costs?timeframe=30d", { cache: "no-store" }).then(async (r) => r.ok ? r.json() : null),
      3000,
    );
    if (costResp && typeof costResp.thisMonth === "number") {
      return {
        thisMonth: costResp.thisMonth,
        budget: costResp.budget ?? 0,
        today: costResp.today ?? 0,
        projected: costResp.projected ?? 0,
        daily: Array.isArray(costResp.daily) ? costResp.daily : [],
      };
    }
  } catch {
    // Cost data is useful context, but it should never block dashboard navigation.
  }
  return null;
}

function approvalTypeLabel(type: OrchestrationApproval["type"]): string {
  switch (type) {
    case "hire_agent":
      return "agent hire";
    case "approve_ceo_strategy":
      return "CEO strategy";
    case "budget_override_required":
      return "budget override";
    case "provider_switch":
      return "provider switch";
    case "protected_runtime_command":
      return "protected runtime";
    default:
      return "approval";
  }
}

function buildApprovalsBannerDetail(approvals: OrchestrationApproval[]): string {
  const counts = new Map<OrchestrationApproval["type"], number>();
  for (const approval of approvals) {
    counts.set(approval.type, (counts.get(approval.type) ?? 0) + 1);
  }

  if (counts.size === 1) {
    const [type, count] = Array.from(counts.entries())[0];
    if (type === "hire_agent") {
      return count === 1
        ? "An agent hire is waiting for approval. Review it from Approvals or Inbox."
        : `${count} agent hires are waiting for approval. Review them from Approvals or Inbox.`;
    }
    if (type === "protected_runtime_command") {
      return count === 1
        ? "A protected runtime request is waiting for approval. Review the task context before allowing it to run."
        : `${count} protected runtime requests are waiting for approval. Review the task context before allowing them to run.`;
    }
    const label = approvalTypeLabel(type);
    return count === 1
      ? `A ${label} request is waiting for approval. Review it from Approvals or Inbox.`
      : `${count} ${label} requests are waiting for approval. Review them from Approvals or Inbox.`;
  }

  const summary = Array.from(counts.entries())
    .map(([type, count]) => `${count} ${approvalTypeLabel(type)}${count === 1 ? "" : "s"}`)
    .join(", ");
  return `Approvals are waiting across ${summary}. Review them from Approvals or Inbox.`;
}

type DashboardData = {
  company: OrchestrationCompany;
  projects: OrchestrationProject[];
  agents: OrchestrationAgent[];
  tasks: OrchestrationTask[];
  goals: OrchestrationCompanyGoal[];
  activity: OrchestrationActivityEvent[];
  agentProfiles: Map<string, OrchestrationAgentProfile>;
  pendingApprovals: OrchestrationApproval[];
  costs: CostSnapshot;
};

type DashboardGoalPatch = {
  owner?: string | null;
  startDate?: string;
  endDate?: string | null;
};

function applyDashboardGoalPatch(goal: OrchestrationCompanyGoal, patch: DashboardGoalPatch): OrchestrationCompanyGoal {
  const sprint = { ...goal.sprint };
  if (Object.prototype.hasOwnProperty.call(patch, "owner")) {
    if (patch.owner) sprint.owner = patch.owner;
    else delete sprint.owner;
  }
  if (patch.startDate !== undefined) sprint.startDate = patch.startDate;
  if (Object.prototype.hasOwnProperty.call(patch, "endDate")) {
    if (patch.endDate) sprint.endDate = patch.endDate;
    else delete sprint.endDate;
  }
  return { ...goal, sprint };
}

/* ── main page ── */

export default function CompanyDashboardPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const dataRef = useRef<DashboardData | null>(null);
  const liveRefreshReadyAtRef = useRef<number>(Number.POSITIVE_INFINITY);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;

    const load = async (mode: "initial" | "manual" | "poll") => {
      if (mode === "manual") setRefreshing(true);

      try {
        const previousData = dataRef.current;
        const [
          companiesResult,
          projectsResult,
          agentsResult,
          tasksResult,
          activityFeedResult,
          pendingApprovalsResult,
          goalsResult,
        ] = await Promise.allSettled([
          withTimeout(listCompanies(), 5000),
          withTimeout(listProjects({ company: slug }), 5000),
          withTimeout(listCompanyAgents(slug), 5000),
          withTimeout(listTasks({ company: slug, sort: "updated-desc", includeNonProduction: true }), 5000),
          withTimeout(listActivityFeed({ limit: 40 }), 5000),
          withTimeout(listCompanyApprovals({ companySlug: slug, status: "pending" }), 5000),
          withTimeout(listCompanyGoals({ companySlug: slug }), 5000),
        ]);

        const failedSections = [
          { label: "companies", result: companiesResult },
          { label: "projects", result: projectsResult },
          { label: "agents", result: agentsResult },
          { label: "tasks", result: tasksResult },
          { label: "activity", result: activityFeedResult },
          { label: "approvals", result: pendingApprovalsResult },
          { label: "goals", result: goalsResult },
        ]
          .filter(({ result }) => result.status === "rejected")
          .map(({ label }) => label);
        if (failedSections.length > 0) {
          console.warn("[dashboard] partial load timed out or failed:", failedSections.join(", "));
        }

        const companies = settledValue(
          companiesResult,
          previousData?.company ? [previousData.company] : [],
        );

        const slugKey = slug.toLowerCase();
        const company = companies.find(
          (c) => c.slug.toLowerCase() === slugKey || c.code.toLowerCase() === slugKey
        );
        if (!company) {
          if (!cancelled) { setError("Company not found."); setData(null); }
          return;
        }

        const companySlug = company.slug;
        const companyProjects = settledValue(projectsResult, previousData?.projects ?? []);
        const agents = settledValue(agentsResult, previousData?.agents ?? []);
        const tasks = settledValue(tasksResult, previousData?.tasks ?? []);
        const activityFeed = settledValue(activityFeedResult, {
          activity: previousData?.activity ?? [],
          page: { limit: previousData?.activity.length ?? 0, hasMore: false },
        });
        const pendingApprovals = settledValue(pendingApprovalsResult, previousData?.pendingApprovals ?? []);
        const companyGoalsResult = settledValue(goalsResult, previousData ? {
          goals: previousData.goals,
          summary: { total: previousData.goals.length, planned: 0, active: 0, done: 0, completionPercent: 0 },
        } : null);
        const companyProjectIdSet = new Set(companyProjects.map((p) => p.id));
        const recentActivity = (activityFeed?.activity ?? [])
          .filter((event) => {
            if (event.companySlug) return event.companySlug === companySlug;
            return companyProjectIdSet.has(event.projectId);
          })
          .slice(0, 20);

        if (cancelled) return;
        setData({
          company,
          projects: companyProjects,
          agents,
          tasks,
          goals: companyGoalsResult?.goals ?? [],
          activity: recentActivity,
          agentProfiles: previousData?.company.id === company.id ? previousData.agentProfiles : new Map(),
          pendingApprovals,
          costs: previousData?.company.id === company.id ? previousData.costs : null,
        });
        setError(null);

        const profileAgents = agents.slice(0, DASHBOARD_AGENT_PROFILE_LIMIT);
        void (async () => {
          const [profileResults, costs] = await Promise.all([
            Promise.allSettled(
              profileAgents.map((agent) =>
                withTimeout(
                  getCompanyAgentProfile(companySlug, agent.slug ?? agent.id, { executionLimit: 3, activityLimit: 6 }),
                  4000,
                )
              )
            ),
            loadDashboardCosts(company),
          ]);

          if (cancelled) return;
          const agentProfiles = new Map<string, OrchestrationAgentProfile>();
          for (let i = 0; i < profileAgents.length; i++) {
            const result = profileResults[i];
            if (result.status === "fulfilled" && result.value) {
              agentProfiles.set(profileAgents[i].id, result.value);
            }
          }
          setData((previous) => previous?.company.id === company.id
            ? { ...previous, agentProfiles, costs }
            : previous
          );
        })();
      } catch (err) {
        if (!cancelled) {
          console.warn("[dashboard] load failed", err);
          setError("Unable to load dashboard.");
          setData((prev) => prev);
        }
      } finally {
        if (!cancelled) {
          if (mode === "initial") {
            liveRefreshReadyAtRef.current = Date.now();
            setLoading(false);
          }
          if (mode === "manual") setRefreshing(false);
        }
      }
    };

    void load("initial");
    const timer = window.setInterval(() => void load("poll"), REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [slug, refreshNonce]);

  // D5: SSE-driven reactive refresh. Any task or comment event for this
  // company bumps refreshNonce, which re-runs the load effect above. The 60s
  // poll above stays as a safety net for anything outside the event stream.
  const liveRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLiveEvent = useCallback((event: StreamEvent) => {
    if (event.type !== "activity" && event.type !== "comment") return;
    if (!dataRef.current) return;
    const eventTime = new Date(event.timestamp ?? event.occurredAt ?? "").getTime();
    if (Number.isFinite(eventTime) && eventTime <= liveRefreshReadyAtRef.current) return;
    if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
    liveRefreshTimerRef.current = setTimeout(() => {
      setRefreshNonce((nonce) => nonce + 1);
    }, 400);
  }, []);

  const activeCompanySlug = data?.company.slug ?? "";

  useEventStream({ companySlug: activeCompanySlug, enabled: Boolean(activeCompanySlug), onEvent: handleLiveEvent });

  useEffect(() => () => {
    if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
  }, []);

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
      open: t.filter((x) => x.status === "backlog" || x.status === "to-do").length,
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
      critical: "var(--negative)",
      high: "var(--warning)",
      medium: "var(--info)",
      low: "var(--positive)",
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

  const activeSprintRows = useMemo(() => {
    if (!data) return [];
    const goalsById = new Map(data.goals.map((goal) => [goal.sprint.id, goal]));
    const projectById = new Map(data.projects.map((project) => [project.id, project]));
    return data.goals
      .filter((goal) => goal.sprint.goalKind === "sprint" && goal.sprint.status === "active")
      .map((sprintGoal) => ({
        sprintGoal,
        parentGoal: sprintGoal.sprint.parentId ? goalsById.get(sprintGoal.sprint.parentId) : undefined,
        project: sprintGoal.sprint.projectId ? projectById.get(sprintGoal.sprint.projectId) : undefined,
      }))
      .sort((a, b) => {
        const aEnd = a.sprintGoal.sprint.endDate ? new Date(a.sprintGoal.sprint.endDate).getTime() : Number.POSITIVE_INFINITY;
        const bEnd = b.sprintGoal.sprint.endDate ? new Date(b.sprintGoal.sprint.endDate).getTime() : Number.POSITIVE_INFINITY;
        if (aEnd !== bEnd) return aEnd - bEnd;
        return b.sprintGoal.completionPercent - a.sprintGoal.completionPercent;
      });
  }, [data]);

  /* ── live runs polling (3s, always active when dashboard loaded) ── */
  const { runsByAgentId, transitions } = useLiveRuns({
    companySlug: activeCompanySlug,
    enabled: !!data,
  });

  /* ── live run streaming (shared context — SSE managed at layout level) ── */
  const { streamByAgentId, liveAgentIds } = useLiveStream();

  const { push: pushToast } = useNotifications();
  const companyCode = data?.company.code ?? COMPANY_SLUG_TO_CODE[slug] ?? slug;

  const patchSprintGoal = useCallback(async (sprintId: string, patch: DashboardGoalPatch, failureMessage: string) => {
    let previousGoal: OrchestrationCompanyGoal | undefined;
    setData((current) => {
      if (!current) return current;
      previousGoal = current.goals.find((goal) => goal.sprint.id === sprintId);
      if (!previousGoal) return current;
      return {
        ...current,
        goals: current.goals.map((goal) => goal.sprint.id === sprintId ? applyDashboardGoalPatch(goal, patch) : goal),
      };
    });
    if (!previousGoal) return;

    try {
      const updated = await updateCompanyGoal({
        companySlug: activeCompanySlug,
        sprintId,
        ...patch,
      });
      if (!updated) throw new Error("Goal update failed");
      setData((current) => current
        ? { ...current, goals: current.goals.map((goal) => goal.sprint.id === sprintId ? updated : goal) }
        : current
      );
    } catch {
      const restoredGoal = previousGoal;
      setData((current) => current && restoredGoal
        ? { ...current, goals: current.goals.map((goal) => goal.sprint.id === sprintId ? restoredGoal : goal) }
        : current
      );
      pushToast({
        title: "Sprint update failed",
        body: failureMessage,
        dotColor: "var(--negative)",
        ttl: 7000,
      });
    }
  }, [activeCompanySlug, pushToast]);

  const handleSprintOwnerChange = useCallback((sprintId: string, owner: string | null) => {
    void patchSprintGoal(sprintId, { owner }, "Owner was restored.");
  }, [patchSprintGoal]);

  const handleSprintDateChange = useCallback((sprintId: string, startDate: string, endDate: string | null) => {
    void patchSprintGoal(sprintId, { startDate, endDate }, "Date window was restored.");
  }, [patchSprintGoal]);

  // Fire toasts on run state transitions
  useEffect(() => {
    let shouldRefresh = false;
    for (const t of transitions) {
      if (t.toStatus === "succeeded") {
        const actionCount = t.result?.actionsExecuted ?? 0;
        const reportCount = t.result?.reportsImported ?? 0;
        shouldRefresh = true;
        pushToast({
          title: `${t.agentName} completed run`,
          body: `${actionCount} action${actionCount !== 1 ? "s" : ""}, ${reportCount} report${reportCount !== 1 ? "s" : ""}`,
          dotColor: "var(--positive)",
          href: buildCanonicalAgentPath(companyCode, t.agentSlug),
          hrefLabel: "View agent",
          ttl: 8000,
        });
      } else if (t.toStatus === "failed" || t.toStatus === "timed_out") {
        shouldRefresh = true;
        pushToast({
          title: `${t.agentName} run ${t.toStatus === "timed_out" ? "timed out" : "failed"}`,
          body: t.error?.slice(0, 120) ?? "Check agent detail for error info.",
          dotColor: "var(--negative)",
          href: buildCanonicalAgentPath(companyCode, t.agentSlug),
          hrefLabel: "View agent",
          ttl: 10000,
        });
      }
    }
    if (shouldRefresh) {
      setRefreshNonce((prev) => prev + 1);
      window.dispatchEvent(new CustomEvent("orchestration-company-refresh", {
        detail: { companySlug: activeCompanySlug },
      }));
    }
  }, [transitions, activeCompanySlug, companyCode, pushToast]);

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

  const runningAgentCount = useMemo(() => {
    if (!data) return 0;
    return data.agents.filter((agent) =>
      isAgentLive({
        agentId: agent.id,
        agentStatus: agent.status,
        liveAgentIds,
        liveRunsByAgentId: runsByAgentId,
      })
    ).length;
  }, [data, liveAgentIds, runsByAgentId]);

  /* ── render ── */

  if (!loading && !data) {
    return <CompanyErrorState title="Dashboard unavailable" detail={error ?? "No data."} href="/companies" />;
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1200px] px-4 py-5 md:px-6">
        {/* ── page heading ── */}
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-[17px] font-semibold text-stone-200 tracking-tight">Dashboard</h1>
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

        {data && data.pendingApprovals.length > 0 && (
          <section
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3"
            style={{ borderColor: "rgba(245,158,11,0.24)", background: "rgba(245,158,11,0.08)" }}
          >
            <div>
              <p className="text-sm font-medium text-amber-200">
                {data.pendingApprovals.length} approval{data.pendingApprovals.length === 1 ? "" : "s"} waiting
              </p>
              <p className="mt-1 text-xs text-amber-100/80">
                {buildApprovalsBannerDetail(data.pendingApprovals)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={buildCanonicalCompanyPath(companyCode, "/approvals/pending")}
                className="rounded-md border px-2.5 py-1.5 text-[11px] font-medium text-amber-100 no-underline transition hover:text-white"
                style={{ borderColor: "rgba(245,158,11,0.28)" }}
              >
                Review approvals
              </a>
              <a
                href={buildCanonicalCompanyPath(companyCode, "/inbox")}
                className="text-[11px] text-amber-100/80 no-underline hover:text-white"
              >
                Open inbox
              </a>
            </div>
          </section>
        )}

        {/* ── agent run cards ── */}
        <section className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-stone-500">Agents</h2>
          {data && sortedAgents.length > 0 ? (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              {sortedAgents.map((agent) => (
                <AgentRunCard
                  key={agent.id}
                  agent={agent}
                  profile={data.agentProfiles.get(agent.id) ?? null}
                  companyCode={companyCode}
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
              style={{ borderColor: "rgba(120,113,108,0.2)", background: "transparent" }}
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
            detail={`${runningAgentCount} live, ${agentMetrics.paused} paused, ${agentMetrics.errors} errors`}
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

        {data && (
          <ActiveSprintsCard
            rows={activeSprintRows}
            agents={data.agents}
            companyCode={companyCode}
            onOwnerChange={handleSprintOwnerChange}
            onDateChange={handleSprintDateChange}
          />
        )}

        {/* ── time-series charts (14-day) ── */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ChartCard title="Run Activity" subtitle="Last 14 days">
            <TimeSeriesBar
              data={dailyActivity.map((d) => ({ label: d.label, value: d.count }))}
              color="var(--accent)"
            />
          </ChartCard>
          <ChartCard title="Tasks by Priority" subtitle="Last 14 days">
            <StackedTimeSeriesBar
              labels={dailyTasksByPriority.days}
              series={["critical", "high", "medium", "low"].map((pri) => ({
                key: pri,
                label: pri.charAt(0).toUpperCase() + pri.slice(1),
                values: dailyTasksByPriority.series[pri] ?? [],
                color: dailyTasksByPriority.colors[pri] ?? "var(--text-muted)",
              }))}
            />
          </ChartCard>
          <ChartCard title="Daily Spend" subtitle="Last 14 days">
            <TimeSeriesBar
              data={dailyCosts.map((d) => ({ label: d.label, value: d.cost }))}
              color="var(--positive)"
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
            style={{ borderColor: "rgba(120,113,108,0.15)", background: "transparent" }}
          >
            <div className="flex items-center justify-between px-4 py-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Recent Activity</h2>
              <a href={buildCanonicalCompanyPath(companyCode, "/activity")} className="text-[10px] text-stone-600 no-underline hover:text-stone-300">
                Full log →
              </a>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {(data?.activity ?? []).map((event) => {
                const agent = event.agentId ? agentLookup.get(event.agentId.toLowerCase()) : null;
                return (
                  <div key={event.id} className="flex items-start gap-2.5 px-4 py-2">
                    {agent?.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={agent.avatar} alt="" className="mt-0.5 h-5 w-5 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span
                        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px]"
                        style={{ background: "var(--surface-hover)", color: agent ? "var(--text-secondary)" : "var(--text-muted)" }}
                      >
                        <AvatarGlyph value={agent?.emoji} fallback="BO" size={11} />
                      </span>
                    )}
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
            style={{ borderColor: "rgba(120,113,108,0.15)", background: "transparent" }}
          >
            <div className="flex items-center justify-between px-4 py-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Recent Tasks</h2>
              <a href={buildCanonicalCompanyPath(companyCode, "/tasks")} className="text-[10px] text-stone-600 no-underline hover:text-stone-300">
                All tasks →
              </a>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {recentTasks.map((task) => {
                const assigneeAgent = task.assignee ? agentLookup.get(task.assignee.toLowerCase()) : null;
                const identifier = task.key ?? task.id.slice(0, 8);
                const dotColor = TASK_STATUS_COLOR[task.status] ?? "var(--text-muted)";
                return (
                  <div key={task.id} className="flex items-center gap-2 px-4 py-2">
                    <span className="inline-block h-[12px] w-[12px] shrink-0 rounded-full border-2" style={{ borderColor: dotColor }} />
                    <span className="shrink-0 font-mono text-[11px] text-stone-500">{identifier}</span>
                    {assigneeAgent && (
                      assigneeAgent.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={assigneeAgent.avatar} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px]" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                          <AvatarGlyph value={assigneeAgent.emoji} fallback="•" size={10} />
                        </span>
                      )
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

/* ── Agent Run Card ── */

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function useLiveElapsedMs(liveRun: LiveRun | null, isLive: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isLive || !liveRun?.startedAt) return;

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLive, liveRun?.runId, liveRun?.startedAt]);

  if (!liveRun) return 0;
  if (!isLive || !liveRun.startedAt) return liveRun.durationMs;

  const startedAt = new Date(liveRun.startedAt).getTime();
  if (!Number.isFinite(startedAt)) return liveRun.durationMs;

  return Math.max(liveRun.durationMs, now - startedAt);
}

/**
 * Re-derives a run's liveness snapshot client-side on a 1s ticking clock so
 * "no signal for Xs" actually counts up between server polls. The server is
 * the source of truth for the freshest `lastEventAt` we know about; the hook
 * just keeps the clock moving forward.
 */
function useLiveRunLivenessSnapshot(liveRun: LiveRun | null, isLive: boolean): RunLivenessSnapshot | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isLive, liveRun?.runId]);

  if (!liveRun) return null;
  return deriveRunLiveness({
    status: liveRun.status,
    startedAt: liveRun.startedAt,
    finishedAt: liveRun.finishedAt,
    lastEventAt: liveRun.lastEventAt ?? null,
    runnerPid: liveRun.runnerPid ?? null,
    runnerPidAlive: liveRun.runnerPidAlive ?? null,
    now,
  });
}

function formatCompactStatus(value: string | null | undefined): string {
  if (!value) return "None";
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanAgentDisplayText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function formatTranscriptMessage(entry: LiveRunTranscriptEntry): string {
  const cleaned = cleanAgentDisplayText(entry.message);
  if (entry.type === "assistant_text" || entry.type === "assistant_final") {
    return cleaned
      .replace(/^assistant(?:\s+(?:text|final))?:\s*/i, "")
      .trim();
  }
  if (entry.type === "thinking" || entry.type === "thinking_summary") {
    return cleaned
      .replace(/^thinking:\s*/i, "")
      .trim() || "Thinking";
  }
  if (entry.type === "provider_event") {
    if (/^(turn\.completed|item\.started|item\.completed:\s*```mc-action)/i.test(cleaned)) return "";
    return cleaned
      .replace(/^item\.completed:\s*/i, "")
      .replace(/^turn\.started:\s*/i, "")
      .trim();
  }
  if (entry.type === "tool_call" || entry.type === "tool_result" || entry.type === "tool_start" || entry.type === "tool_end") {
    const rawTool = cleaned
      .replace(/:\s*Codex reported tool activity:.*$/i, "")
      .replace(/^\/bin\/zsh\s+-lc\s+/i, "")
      .replace(/^"([\s\S]+)"$/, "$1")
      .replace(/^'([\s\S]+)'$/, "$1");
    const label = entry.type === "tool_call" || entry.type === "tool_start" ? "Running" : "Ran";
    return `${label} ${rawTool.length > 145 ? rawTool.slice(0, 145) + "..." : rawTool}`;
  }
  if (entry.type === "session_start") return cleaned || "Sending prompt to agent session";
  if (entry.type === "waiting") return cleaned || "Waiting for agent response";
  if (entry.type === "parsing_complete") {
    return cleaned
      .replace(/^Parsed\s+/i, "Read ")
      .replace(/adapter message/i, "agent message");
  }
  if (entry.type === "actions_complete") {
    return cleaned.replace(/^Done:/i, "Finished:");
  }
  if (entry.type === "action_executed") {
    return cleaned
      .replace(/^Comment on\s+/i, "Commented on ")
      .replace(/^Updated task\s+/i, "Updated ");
  }
  return cleaned;
}

function isReadableTranscriptEntry(entry: LiveRunTranscriptEntry): boolean {
  return (
    entry.kind === "comment" ||
    entry.type === "assistant_final" ||
    entry.type === "assistant_text" ||
    (entry.type === "provider_event" && /^item\.completed:/i.test(entry.message) && !/```mc-action/i.test(entry.message))
  );
}

function transcriptRowColor(type?: string): string {
  if (type === "action_error" || type === "lifecycle_error" || type === "error") return "#fca5a5";
  if (type === "action_skipped") return "#d6a84f";
  if (type === "tool_start" || type === "tool_end" || type === "tool_call" || type === "tool_result") return "#a8a29e";
  if (type === "thinking" || type === "thinking_summary") return "var(--text-secondary)";
  if (type === "action_executed" || type === "action_detected") return "var(--text-secondary)";
  if (type === "session_start" || type === "waiting" || type === "lifecycle_start") return "var(--accent)";
  return "var(--text-muted)";
}

/* ── Streaming text block — shows live assistant output ── */
function StreamingTextBlock({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text]);

  // Strip completed mc-action blocks (those are shown as structured entries in the transcript).
  // Keep any partial/in-progress block so the operator sees it being written.
  const cleanedText = useMemo(() => {
    const stripped = text.replace(/```mc-action[^\n]*\n[\s\S]*?```/g, "").trim();
    // If everything was action blocks, show a status note
    if (!stripped && text.length > 10) return "(writing action blocks…)";
    return cleanAgentDisplayText(stripped);
  }, [text]);

  // Show last ~400 chars for compact display
  const displayText = cleanedText.length > 400 ? "…" + cleanedText.slice(-400) : cleanedText;

  if (!displayText && !isStreaming) return null;

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4" style={{ background: "linear-gradient(180deg, var(--surface) 0%, transparent 100%)" }} />
      <div
        ref={scrollRef}
        className="max-h-[120px] overflow-y-auto py-1 pr-5"
      >
      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-stone-300">
        {displayText}
        {isStreaming && (
          <span
            className="ml-0.5 inline-block h-3 w-0.5 animate-pulse rounded-full"
            style={{ backgroundColor: "#d97706", verticalAlign: "text-bottom" }}
          />
        )}
      </p>
      </div>
    </div>
  );
}

function AgentNoteBlock({ text }: { text: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const displayText = cleanAgentDisplayText(text);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [displayText]);

  if (!displayText) return null;

  return (
    <div className="mx-4 mb-3">
      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4" style={{ background: "linear-gradient(180deg, var(--surface) 0%, transparent 100%)" }} />
        <div ref={scrollRef} className="max-h-[210px] overflow-y-auto py-1 pr-5">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-stone-300">
            {displayText}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Scrollable transcript inside agent card ── */
function AgentTranscript({
  entries,
  streamEvents = [],
  isLive,
  liveDurationMs,
  liveActivityLabel,
  livenessSnapshot,
}: {
  entries: LiveRunTranscriptEntry[];
  streamEvents?: StreamTranscriptEntry[];
  isLive: boolean;
  liveDurationMs?: number;
  liveActivityLabel?: string | null;
  livenessSnapshot?: RunLivenessSnapshot | null;
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
      .slice(-22); // keep a fuller readable activity window
  }, [entries, streamEvents]);

  // Auto-scroll to bottom when new entries arrive (chronological order, newest at bottom)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mergedEntries.length]);

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-10 h-5" style={{ background: "linear-gradient(180deg, var(--surface) 0%, transparent 100%)" }} />
      <div
        ref={scrollRef}
        className="max-h-[430px] overflow-y-auto py-1 pr-8 [scrollbar-gutter:stable]"
      >
        {mergedEntries.map((entry, i) => {
          const message = formatTranscriptMessage(entry);
          if (!message) return null;
          const readable = isReadableTranscriptEntry(entry);

          return (
            <div
              key={entry.id}
              className="border-b py-2.5 last:border-b-0"
              style={{
                borderColor: "rgba(120,113,108,0.06)",
                animation: i === mergedEntries.length - 1 && isLive ? "fadeSlideIn 0.3s ease" : undefined,
              }}
            >
              {readable ? (
                <div className="flex gap-2.5">
                  <MessageSquareText className="mt-1 h-3.5 w-3.5 shrink-0 text-stone-500" />
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-[13px] leading-[1.55] text-stone-200">
                      {message.length > 1100 ? message.slice(0, 1100) + "..." : message}
                    </p>
                    <span className="mt-1 block text-[10px] text-stone-600">
                      {entry.type === "status_update" ? "Status update" : "Comment"} · {formatAge(entry.ts)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5">
                  <TranscriptIcon type={entry.type} />
                  <span
                    className="min-w-0 flex-1 text-[12px] leading-snug"
                    style={{ color: transcriptRowColor(entry.type) }}
                  >
                    {message.length > 170 ? message.slice(0, 170) + "..." : message}
                  </span>
                  <span className="shrink-0 pr-1 text-[10px] text-stone-600">{formatAge(entry.ts)}</span>
                </div>
              )}
            </div>
          );
        })}
        {isLive && (() => {
          const liveness = livenessSnapshot?.liveness ?? "live";
          const isQuiet = liveness === "quiet";
          const isStalled = liveness === "stalled";
          const accentColor = isStalled
            ? "var(--negative)"
            : isQuiet
              ? "var(--warning)"
              : "var(--accent)";
          const baseLabel = liveActivityLabel ?? "Thinking";
          const heartbeatLabel =
            isStalled || isQuiet ? livenessSnapshot?.label ?? baseLabel : baseLabel;
          return (
            <div
              className="flex items-center gap-2.5 py-3 text-[13px]"
              style={{ color: isStalled ? "var(--negative)" : isQuiet ? "var(--warning)" : "var(--text-muted)" }}
              data-liveness={liveness}
              data-testid="agent-transcript-liveness"
            >
              {isStalled ? (
                <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: accentColor }} />
              ) : (
                <CircleDashed
                  className={`h-3.5 w-3.5 shrink-0 ${isQuiet ? "" : "animate-spin"}`}
                  style={{ color: accentColor }}
                />
              )}
              <span className="truncate">{heartbeatLabel}</span>
              <span className="ml-auto pr-1 font-mono text-[12px]" style={{ color: accentColor }}>
                {formatElapsed(liveDurationMs ?? 0)}
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function TranscriptIcon({ type }: { type?: string }) {
  const color = type === "action_error" || type === "lifecycle_error" || type === "error" ? "#ef4444"
    : type === "action_skipped" ? "#ca8a04"
    : type === "waiting" || type === "session_start" || type === "lifecycle_start" ? "#d97706"
    : type === "tool_start" || type === "tool_end" || type === "tool_call" || type === "tool_result" ? "#a8a29e"
    : type === "thinking" || type === "thinking_summary" ? "var(--text-secondary)"
    : type === "action_detected" || type === "action_executed" ? "var(--text-secondary)"
    : type === "lifecycle_end" || type === "assistant_final" ? "#d97706"
    : "var(--text-muted)";

  if (type === "tool_start" || type === "tool_end" || type === "tool_call" || type === "tool_result") return <Terminal className="h-3 w-3 shrink-0" style={{ color }} />;
  if (type === "assistant_final") return <MessageSquareText className="h-3 w-3 shrink-0" style={{ color }} />;
  if (type === "thinking" || type === "thinking_summary") return <Sparkles className="h-3 w-3 shrink-0" style={{ color }} />;
  if (type === "waiting" || type === "session_start" || type === "lifecycle_start") return <CircleDashed className="h-3 w-3 shrink-0" style={{ color }} />;
  if (type === "action_error" || type === "lifecycle_error" || type === "error") return <AlertCircle className="h-3 w-3 shrink-0" style={{ color }} />;
  if (type === "action_detected" || type?.startsWith("action_")) return <Sparkles className="h-3 w-3 shrink-0" style={{ color }} />;
  return <Activity className="h-3 w-3 shrink-0" style={{ color }} />;
}

/* ── Action execution badge ── */
function ActionBadge({ result, status }: { result: NonNullable<LiveRun["result"]>; status: string }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = status === "running" || status === "queued";
  const total = result.actionsExecuted + result.actionsSkippedDedup;
  const reportCount = result.reportsImported ?? 0;
  const label = isRunning
    ? `Executing ${total > 0 ? total : ""} structured action${total !== 1 ? "s" : ""}`
    : `Executed ${result.actionsExecuted} structured action${result.actionsExecuted !== 1 ? "s" : ""}${reportCount > 0 ? `, imported ${reportCount} report${reportCount !== 1 ? "s" : ""}` : ""}`;

  return (
    <div className="mx-4 mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 py-1 text-[12px] text-stone-500 hover:text-stone-300"
      >
        {result.errors.length > 0
          ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
          : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500/80" />}
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight
          className="h-3 w-3 shrink-0 transition-transform"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>
      {expanded && (
        <div className="ml-5 mt-1 space-y-1 text-[12px] leading-relaxed text-stone-500">
          {result.tasksCreated.length > 0 && (
            <p>{result.tasksCreated.length} task{result.tasksCreated.length !== 1 ? "s" : ""} created</p>
          )}
          {result.approvalsCreated.length > 0 && (
            <p>{result.approvalsCreated.length} approval{result.approvalsCreated.length !== 1 ? "s" : ""} requested</p>
          )}
          {result.reportsImported > 0 && (
            <p>{result.reportsImported} report{result.reportsImported !== 1 ? "s" : ""} imported</p>
          )}
          {(result.actionsExecuted - result.tasksCreated.length - result.approvalsCreated.length - result.reportsImported) > 0 && (
            <p>{result.actionsExecuted - result.tasksCreated.length - result.approvalsCreated.length - result.reportsImported} comment{(result.actionsExecuted - result.tasksCreated.length - result.approvalsCreated.length - result.reportsImported) !== 1 ? "s" : ""} posted</p>
          )}
          {result.actionsSkippedDedup > 0 && (
            <p>{result.actionsSkippedDedup} skipped as duplicate</p>
          )}
          {result.errors.length > 0 && (
            <p className="text-red-400">{result.errors.length} error{result.errors.length !== 1 ? "s" : ""}</p>
          )}
        </div>
      )}
    </div>
  );
}

function AgentStateDot({
  isLive,
  dotColor,
  dotGlow,
}: {
  isLive: boolean;
  dotColor: string;
  dotGlow: string;
}) {
  if (isLive) {
    return (
      <span className="relative mt-1.5 inline-flex h-2.5 w-2.5 shrink-0">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
          style={{ backgroundColor: "var(--accent)" }}
        />
        <span
          className="relative inline-flex h-3 w-3 rounded-full"
          style={{
            backgroundColor: "var(--accent)",
            boxShadow: "0 0 12px color-mix(in srgb, var(--accent) 70%, transparent)",
          }}
        />
      </span>
    );
  }

  return (
    <span
      className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: dotColor, boxShadow: dotGlow }}
    />
  );
}

function AgentStatusPill({
  isLive,
  hasPendingHireApproval,
  status,
}: {
  isLive: boolean;
  hasPendingHireApproval: boolean;
  status: OrchestrationAgent["status"];
}) {
  const label = isLive
    ? "Working"
    : hasPendingHireApproval
      ? "Approval"
      : status.charAt(0).toUpperCase() + status.slice(1);
  const tone = isLive
    ? { color: "var(--accent)", bg: "var(--accent-soft)", border: "rgba(217,119,6,0.22)" }
    : status === "error"
      ? { color: "var(--negative)", bg: "var(--negative-soft)", border: "rgba(239,68,68,0.2)" }
      : status === "paused"
        ? { color: "var(--warning)", bg: "var(--warning-soft)", border: "rgba(245,158,11,0.18)" }
        : { color: "var(--text-secondary)", bg: "var(--surface-elevated)", border: "rgba(120,113,108,0.18)" };

  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider"
      style={{ color: tone.color, background: tone.bg, border: `0.5px solid ${tone.border}` }}
    >
      {isLive && <CircleDashed className="h-2.5 w-2.5 animate-spin" />}
      {label}
    </span>
  );
}

function AgentWorkLine({
  task,
  fallbackTitle,
  latestRun,
  companyCode,
}: {
  task: OrchestrationAgentProfile["currentTasks"][number] | null;
  fallbackTitle: string | null;
  latestRun: OrchestrationAgentExecutionRun | null;
  companyCode: string;
}) {
  const title = task?.title ?? fallbackTitle;
  if (!title) return null;

  const taskKey = task?.key ?? latestRun?.taskKey ?? null;
  const status = task?.status ?? (latestRun?.status === "completed" ? "done" : latestRun?.status ?? "");
  const statusLabel = TASK_STATUS_LABEL[status] ?? status;
  const dotColor = TASK_STATUS_COLOR[status] ?? "var(--text-muted)";
  const href = taskKey ? buildCanonicalCompanyPath(companyCode, `/tasks/${encodeURIComponent(taskKey)}`) : null;

  const content = (
    <div className="px-4 pb-2">
      <p className="line-clamp-1 text-[13px] font-medium leading-snug text-stone-200">{title}</p>
      {(statusLabel || taskKey) && (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-stone-500">
          {taskKey && <span className="font-mono text-stone-500">{taskKey}</span>}
          {taskKey && statusLabel && <span aria-hidden="true">/</span>}
          {statusLabel && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor }} />
              {statusLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );

  return href ? (
    <a href={href} className="block no-underline">
      {content}
    </a>
  ) : content;
}

function RecentSignal({ event }: { event: OrchestrationAgentProfile["recentActivity"][number] }) {
  return (
    <div className="flex items-start gap-2 py-1">
      {event.kind === "comment"
        ? <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0 text-stone-500" />
        : <Activity className="mt-0.5 h-3 w-3 shrink-0 text-stone-500" />}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[12px] leading-snug text-stone-400">{event.message}</p>
        <p className="mt-0.5 truncate text-[10px] text-stone-600">
          {event.taskTitle} · {formatAge(event.timestamp)}
        </p>
      </div>
    </div>
  );
}

function AgentRunCard({
  agent,
  profile,
  companyCode,
  liveRun,
  agentStream,
}: {
  agent: OrchestrationAgent;
  profile: OrchestrationAgentProfile | null;
  companyCode: string;
  liveRun: LiveRun | null;
  agentStream: AgentStreamState | null;
}) {
  const [showMovement, setShowMovement] = useState(false);
  const agentHref = buildCanonicalAgentPath(companyCode, agent.slug ?? agent.id);

  const latestRun = profile?.liveSession ?? profile?.executionHistory?.[0] ?? null;
  const recentActivity = profile?.recentActivity ?? [];
  const currentTasks = profile?.currentTasks ?? [];
  const hasPendingHireApproval = agent.hireApprovalStatus === "pending" || agent.hireApprovalStatus === "revision_requested";
  const activeTask = currentTasks[0] ?? null;

  // Determine if this card is live from the same shared run-status truth used by
  // the dock and other orchestration surfaces.
  //
  // Defence-in-depth: SSE lifecycle_end is the most authoritative end-of-run
  // signal and arrives within ~150ms of the engine finishing. When SSE has
  // marked the run as inactive AND its runId matches the polling snapshot,
  // override the (potentially stale) polling-based status so the panel doesn't
  // sit on "Running" while waiting for the next poll cycle to catch up.
  const sseEndedThisRun =
    agentStream != null &&
    !agentStream.isActive &&
    liveRun != null &&
    agentStream.runId === liveRun.runId;
  const isLive = !sseEndedThisRun && liveRun != null && isRunLive(liveRun.status);
  const justFinished =
    sseEndedThisRun ||
    (liveRun != null && (liveRun.status === "succeeded" || liveRun.status === "failed" || liveRun.status === "timed_out"));
  const liveDurationMs = useLiveElapsedMs(liveRun, isLive);
  const livenessSnapshot = useLiveRunLivenessSnapshot(liveRun, isLive);

  const dotColor = isLive ? "var(--accent)" : STATUS_DOT_COLOR[agent.status];
  const dotGlow = isLive ? "0 0 8px color-mix(in srgb, var(--accent) 60%, transparent)" : STATUS_DOT_GLOW[agent.status];

  const cardBorder = isLive
    ? "color-mix(in srgb, var(--accent) 25%, transparent)"
    : justFinished
      ? "color-mix(in srgb, var(--positive) 20%, transparent)"
      : "var(--border)";
  const cardBg = "var(--surface)";
  const cardShadow = isLive
    ? "var(--shadow-cta)"
    : "none";
  const liveActivityLabel = isLive
    ? agentStream?.streamingText
      ? "Writing"
      : (liveRun?.transcript.length ?? 0) > 0 || (agentStream?.events.length ?? 0) > 0
        ? "Working"
        : "Thinking"
    : null;

  // Build the run status label
  const runStatusLabel = isLive
    ? liveActivityLabel
    : hasPendingHireApproval
      ? "Pending approval"
      : agent.status === "working"
        ? "Running"
        : agent.status === "paused"
          ? "Paused"
          : null;

  // Latest comment from this agent (most recent activity of kind "comment")
  const latestComment = recentActivity.find((a) => a.kind === "comment");
  const recentSignals = recentActivity.filter((activity) => activity.id !== latestComment?.id).slice(0, 3);

  // Best human-readable output. For active runs, avoid showing stale profile
  // comments from a previous cycle unless the live run itself has output.
  const outputText = liveRun?.latestOutput ?? (!isLive ? latestComment?.message ?? null : null);
  const hasTranscript = liveRun != null && (liveRun.transcript.length > 0 || (agentStream?.events.length ?? 0) > 0);
  const hasReadableTranscript = Boolean(
    liveRun?.transcript.some(isReadableTranscriptEntry) ||
    agentStream?.events.some((event) => event.kind === "assistant_final"),
  );
  const lastRun = liveRun ?? latestRun;
  const lastRunModel = liveRun ? latestRun?.runnerModel ?? agent.model ?? null : latestRun?.runnerModel ?? agent.model ?? null;
  const lastRunProvider = liveRun ? latestRun?.runnerProvider ?? latestRun?.provider ?? agent.adapterType : latestRun?.runnerProvider ?? latestRun?.provider ?? agent.adapterType;
  const lastRunExecutionEngine = liveRun ? latestRun?.executionEngine : latestRun?.executionEngine;
  const displayedModel = lastRunModel;
  const modelDisplay = resolveAgentModelDisplay({
    provider: lastRunProvider,
    model: displayedModel,
    executionEngine: lastRunExecutionEngine,
  });
  const providerLabel = modelDisplay?.providerLabel ?? formatRunProviderLabel(lastRunProvider ?? "manual");
  const modelLabel = formatModelLabel(modelDisplay?.model ?? displayedModel);
  const lastRunAge = lastRun
    ? formatAge(("finishedAt" in lastRun ? lastRun.finishedAt : undefined) ?? latestRun?.completedAt ?? latestRun?.createdAt ?? new Date().toISOString())
    : null;

  return (
    <div
      className="flex flex-col overflow-hidden rounded-lg border"
      style={{
        borderColor: cardBorder,
        background: isLive
          ? "linear-gradient(180deg, color-mix(in srgb, var(--accent-soft) 36%, var(--surface)) 0%, var(--surface) 32%)"
          : cardBg,
        boxShadow: cardShadow,
        transition: "border-color 0.3s ease, background 0.3s ease, box-shadow 0.3s ease",
      }}
    >
      {/* ── header ── */}
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <AgentStateDot isLive={isLive} dotColor={dotColor} dotGlow={dotGlow} />
          {agent.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agent.avatar} alt="" className="h-10 w-10 rounded-md object-cover shrink-0" />
          ) : (
            <span
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-xs"
              style={{ background: "var(--surface-elevated)", color: "var(--text-secondary)" }}
            >
              <AvatarGlyph value={agent.emoji} size={17} />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[16px] font-semibold text-stone-100">{agent.name}</span>
              <AgentStatusPill
                isLive={isLive}
                hasPendingHireApproval={hasPendingHireApproval}
                status={agent.status}
              />
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
              <span className="truncate">{agent.role}</span>
              <span aria-hidden="true">/</span>
              <span className="truncate">{providerLabel}</span>
              {modelLabel && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="truncate">{modelLabel}</span>
                </>
              )}
              {lastRunAge && (
                <>
                  <span aria-hidden="true">/</span>
                  <span>{lastRunAge} ago</span>
                </>
              )}
            </div>
          </div>
        </div>
        <a href={agentHref} className="shrink-0 rounded-md p-1 text-stone-600 transition hover:bg-stone-800/40 hover:text-stone-300" aria-label={`Open ${agent.name}`}>
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* ── run status line ── */}
      {runStatusLabel && !isLive && (
        <div className="px-4 pb-1.5">
          <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: isLive ? "var(--accent)" : "var(--text-muted)" }}>
            {isLive ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Clock3 className="h-3 w-3" />}
            {runStatusLabel}
          </span>
        </div>
      )}

      <AgentWorkLine
        task={activeTask}
        fallbackTitle={latestRun?.taskTitle ?? agent.currentTask ?? null}
        latestRun={latestRun}
        companyCode={companyCode}
      />

      {/* ── LIVE: streaming assistant text from gateway ── */}
      {isLive && agentStream?.streamingText && (
        <div className="mx-4 mb-2">
          <StreamingTextBlock text={agentStream.streamingText} isStreaming={agentStream.isStreaming} />
        </div>
      )}

      {outputText && !agentStream?.streamingText && (!hasTranscript || !hasReadableTranscript) && (
        <AgentNoteBlock text={outputText} />
      )}

      {/* ── Scrollable multi-entry transcript (merged: poll + stream) ── */}
      {hasTranscript || isLive ? (
        <div className="mx-4 mb-2">
          <AgentTranscript
            entries={liveRun?.transcript ?? []}
            streamEvents={agentStream?.events ?? []}
            isLive={isLive}
            liveDurationMs={liveDurationMs}
            liveActivityLabel={liveActivityLabel}
            livenessSnapshot={livenessSnapshot}
          />
        </div>
      ) : !isLive && !outputText && !latestRun ? (
        hasPendingHireApproval ? (
          <div className="mx-4 mb-2">
            <p className="text-[12px] leading-relaxed text-stone-500">
              Waiting for operator approval before this hire can start work.
            </p>
          </div>
        ) : null
      ) : null}

      {/* ── Action execution badge ── */}
      {liveRun?.result && (
        <ActionBadge result={liveRun.result} status={liveRun.status} />
      )}

      {/* ── JUST FINISHED: completion summary ── */}
      {justFinished && liveRun.result && (
        <div className="mx-4 mb-2 rounded-md px-2.5 py-1.5" style={{
          background: liveRun.status === "succeeded" ? "var(--positive-soft)" : "var(--negative-soft)",
          border: "0.5px solid var(--border)",
        }}>
          <span className="text-[11px] font-medium" style={{
            color: liveRun.status === "succeeded" ? "var(--positive)" : "var(--negative)",
          }}>
            {liveRun.status === "succeeded" ? "✓" : "✗"}{" "}
            {liveRun.result.actionsExecuted} structured action{liveRun.result.actionsExecuted !== 1 ? "s" : ""},{" "}
            {liveRun.result.reportsImported} report{liveRun.result.reportsImported !== 1 ? "s" : ""}
            {liveRun.result.errors.length > 0 && ` · ${liveRun.result.errors.length} error${liveRun.result.errors.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      )}

      {/* ── execution run metadata ── */}
      {latestRun && !isLive && (
        <div className="mx-4 mb-3">
          <RunBadge run={latestRun} />
        </div>
      )}

      {recentSignals.length > 0 && (
        <div className="border-t px-4 py-1.5" style={{ borderColor: "rgba(120,113,108,0.12)" }}>
          <button
            type="button"
            onClick={() => setShowMovement((value) => !value)}
            className="flex w-full items-center gap-1.5 py-0.5 text-[11px] text-stone-600 hover:text-stone-400"
          >
            <ChevronRight
              className="h-3 w-3 shrink-0 transition-transform"
              style={{ transform: showMovement ? "rotate(90deg)" : "rotate(0deg)" }}
            />
            <span>{recentSignals.length} movement update{recentSignals.length === 1 ? "" : "s"}</span>
          </button>
          {showMovement && (
            <div className="mt-1 space-y-0.5">
              {recentSignals.map((event) => (
                <RecentSignal key={event.id} event={event} />
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
  const providerLabel = formatRunProviderLabel(run.provider);
  const errorMessage = normalizeRunErrorMessage(run.errorMessage, run.provider);
  const durationLabel = run.durationMs
    ? run.durationMs < 60_000
      ? `${Math.round(run.durationMs / 1000)}s`
      : `${Math.round(run.durationMs / 60_000)}m`
    : null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{ color: style.color, background: style.bg }}
      >
        <Terminal className="h-2.5 w-2.5" />
        {formatCompactStatus(run.status)}
      </span>
      <span className="font-mono text-[10px] text-stone-600">{sessionShort}</span>
      {run.provider !== "manual" && (
        <span
          className="whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-medium"
          style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
        >
          {providerLabel}
        </span>
      )}
      {durationLabel && (
        <span className="text-[10px] text-stone-600">{durationLabel}</span>
      )}
      {errorMessage && (
        <span className="truncate text-[10px]" style={{ color: "var(--negative)" }}>{errorMessage}</span>
      )}
    </div>
  );
}

function normalizeRunErrorMessage(errorMessage: string | null | undefined, provider: string): string | null {
  if (!errorMessage) return null;
  if (errorMessage.includes("queued run was not claimed within 10 minutes")) {
    return "Runtime did not claim this run.";
  }
  if (provider === "openclaw" && errorMessage.includes("openclaw_agent_id")) {
    return "OpenClaw run failed: missing agent mapping.";
  }
  return errorMessage;
}

function formatRunProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openclaw" || normalized === "openclaw-heartbeat") return "OpenClaw";
  if (normalized === "codex" || normalized === "openai" || normalized === "openai-codex") return "Codex";
  if (normalized === "anthropic" || normalized === "claude") return "Anthropic";
  if (normalized === "gemini" || normalized === "google") return "Gemini";
  if (normalized === "hermes") return "HERMES";
  if (normalized === "manual") return "Manual";
  return provider;
}

function formatModelLabel(model?: string | null): string | null {
  const value = model?.trim();
  if (!value) return null;
  const compact = value.includes("/") ? value.split("/").slice(1).join("/") : value;
  if (/^gpt-/i.test(compact)) {
    return compact.replace(/^gpt-/i, "GPT-").replace(/-codex/i, " Codex").replace(/-spark/i, " Spark").replace(/-mini/i, " mini");
  }
  if (/^claude-/i.test(compact)) {
    return compact.replace(/^claude-/i, "Claude ").replace(/-/g, " ");
  }
  if (/^gemini-/i.test(compact)) {
    return compact.replace(/^gemini-/i, "Gemini ").replace(/-/g, " ");
  }
  return compact;
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
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
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

function ActiveSprintsCard({
  rows,
  agents,
  companyCode,
  onOwnerChange,
  onDateChange,
}: {
  rows: Array<{ sprintGoal: OrchestrationCompanyGoal; parentGoal?: OrchestrationCompanyGoal; project?: OrchestrationProject }>;
  agents: OrchestrationAgent[];
  companyCode: string;
  onOwnerChange: (sprintId: string, owner: string | null) => void;
  onDateChange: (sprintId: string, startDate: string, endDate: string | null) => void;
}) {
  const visible = rows.slice(0, 5);
  const extra = Math.max(0, rows.length - visible.length);
  const projectLabel = (goal: OrchestrationCompanyGoal, project?: OrchestrationProject) => {
    const label = project?.name ?? goal.projectName ?? "";
    return label.trim().toLowerCase() === "no project" || !label.trim() ? "Company-wide" : label;
  };
  return (
    <section className="mb-6 rounded-lg border" style={{ borderColor: "var(--border)", background: "transparent" }}>
      <div className="flex items-center justify-between px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Active sprints</h2>
        {extra > 0 ? (
          <a href={buildCanonicalCompanyPath(companyCode, `/goals?status=active`)} className="text-[10px] text-stone-600 no-underline hover:text-stone-300">
            +{extra} more
          </a>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <div className="px-4 py-5 text-xs text-stone-600">
          No active sprints
          <a href={buildCanonicalCompanyPath(companyCode, "/goals")} className="ml-2 text-stone-500 no-underline hover:text-stone-300">+ Add</a>
        </div>
      ) : (
        <div>
          {visible.map(({ sprintGoal, parentGoal, project }) => {
            const sprint = sprintGoal.sprint;
            return (
              <SprintRow
                key={sprint.id}
                sprint={sprint}
                completionPercent={sprintGoal.completionPercent}
                companyCode={companyCode}
                parentGoalName={parentGoal?.sprint.name ?? "Company goal"}
                projectLabel={projectLabel(sprintGoal, project)}
                agents={agents}
                onOwnerChange={onOwnerChange}
                onDateChange={onDateChange}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ── Chart card ── */

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg border px-3 py-2.5"
      style={{ borderColor: "rgba(120,113,108,0.15)", background: "transparent" }}
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
