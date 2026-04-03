"use client";

import { useEffect, useMemo, useState } from "react";

async function withTimeout<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    }),
  ]);
}
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Clock3,
  FolderKanban,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { CompanyErrorState } from "@/components/company/company-ui";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { formatAge, statusTheme } from "@/components/orchestration/ui";
import {
  getProjectBoard,
  listActivityFeed,
  listCompanies,
  listCompanyAgents,
  listProjects,
  pollTaskExecutionStatus,
} from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type {
  OrchestrationActivityEvent,
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationTask,
} from "@/lib/orchestration/types";

type LiveSession = {
  taskId: string;
  taskTitle: string;
  projectName: string;
  mode: "openclaw" | "paperclip" | "manual";
  state: "running" | "completed" | "unknown" | "skipped";
  terminal: boolean;
  assignee: string;
  status: string;
  updated: string;
};

type DashboardSnapshot = {
  company: OrchestrationCompany;
  projects: OrchestrationProject[];
  agents: OrchestrationAgent[];
  tasks: OrchestrationTask[];
  activity: OrchestrationActivityEvent[];
  sessions: LiveSession[];
};

const REFRESH_MS = 20_000;

const STATUS_DOT: Record<OrchestrationAgent["status"], string> = {
  working: "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]",
  idle: "bg-amber-400/70",
  paused: "bg-yellow-600/60",
  offline: "bg-stone-500/50",
  error: "bg-red-500",
};

export default function CompanyDashboardPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [loading, setLoading] = useState(true);
  const { activeProject, clearActiveProject } = useActiveProjectState();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (mode: "initial" | "manual" | "poll") => {
      if (mode === "manual") setRefreshing(true);

      try {
        const [companies, projects, agents, activityFeed] = await Promise.all([
          withTimeout(listCompanies(), 5000),
          withTimeout(listProjects(), 5000),
          withTimeout(listCompanyAgents(slug), 5000),
          withTimeout(listActivityFeed({ limit: 80 }), 5000),
        ]);

        const company = companies.find((c) => c.slug === slug);
        if (!company) {
          if (!cancelled) {
            setError("Company not found in orchestration records.");
            setSnapshot(null);
          }
          return;
        }

        const companyProjects = projects.filter((p) => p.companyId === company.id);
        const boardRows = await Promise.all(
          companyProjects.map(async (project) => ({
            project,
            board: await withTimeout(getProjectBoard(project.id), 5000).catch(() => ({ tasks: [] })),
          }))
        );

        if (cancelled) return;

        const tasks = boardRows.flatMap((row) => row.board?.tasks ?? []);
        const companyProjectIdSet = new Set(companyProjects.map((p) => p.id));
        const recentActivity = (activityFeed?.activity ?? [])
          .filter((event) => {
            if (event.companySlug) return event.companySlug === slug;
            return companyProjectIdSet.has(event.projectId);
          })
          .slice(0, 20);

        const projectNameById = new Map(boardRows.map((row) => [row.project.id, row.project.name]));
        const sessionCandidates = tasks
          .filter((task) => task.executionMode && task.executionMode !== "manual")
          .filter((task) => task.status === "in-progress" || task.status === "review")
          .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime())
          .slice(0, 8);

        const sessionRows = await Promise.all(
          sessionCandidates.map(async (task) => {
            const execution = await withTimeout(pollTaskExecutionStatus(task.id), 3000).catch(() => null);
            if (!execution) return null;
            return {
              taskId: task.id,
              taskTitle: task.title,
              projectName: projectNameById.get(task.project) ?? "Unknown",
              mode: execution.mode,
              state: execution.status.state,
              terminal: execution.status.terminal,
              assignee: task.assignee ?? "Unassigned",
              status: statusTheme[task.status].label,
              updated: task.updated,
            } satisfies LiveSession;
          })
        );

        if (cancelled) return;

        setSnapshot({
          company,
          projects: companyProjects,
          agents,
          tasks,
          activity: recentActivity,
          sessions: sessionRows.filter((row): row is LiveSession => Boolean(row)),
        });
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error("[company-dashboard] load failed", err);
          setError("Unable to load company dashboard right now.");
          setLoading(false);
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

  const activeProjectRecord = useMemo(
    () => resolveActiveProject(snapshot?.projects ?? [], activeProject, slug),
    [activeProject, slug, snapshot]
  );

  const metrics = useMemo(() => {
    if (!snapshot) return { open: 0, inProgress: 0, blocked: 0, done: 0, review: 0, totalTasks: 0 };
    const t = snapshot.tasks;
    return {
      open: t.filter((x) => x.status === "backlog" || x.status === "on-deck").length,
      inProgress: t.filter((x) => x.status === "in-progress").length,
      blocked: t.filter((x) => x.status === "blocked").length,
      done: t.filter((x) => x.status === "done").length,
      review: t.filter((x) => x.status === "review").length,
      totalTasks: t.length,
    };
  }, [snapshot]);

  if (!loading && !snapshot) {
    return <CompanyErrorState title="Dashboard unavailable" detail={error ?? "No data."} href="/companies" />;
  }

  return (
    <div className="min-h-screen bg-stone-950 p-3 md:p-4">
      {/* Compact header */}
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-amber-50 tracking-tight">
            {snapshot?.company.name ?? "Loading…"}
          </h1>
          {snapshot && (
            <span className="text-[11px] text-stone-500">
              {snapshot.projects.length} projects · {snapshot.agents.length} agents
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshNonce((n) => n + 1)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 bg-stone-900 px-2.5 py-1 text-[11px] text-stone-300 transition hover:border-amber-600/40 hover:text-amber-200"
          >
            {refreshing ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
        </div>
      </header>

      {activeProjectRecord ? (
        <ActiveProjectBanner companySlug={slug} project={activeProjectRecord} onClear={clearActiveProject} compact />
      ) : null}

      {/* Stats row */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        <StatChip label="Open" value={metrics.open} color="#f59e0b" />
        <StatChip label="In Progress" value={metrics.inProgress} color="#d97706" />
        <StatChip label="Review" value={metrics.review} color="#b45309" />
        <StatChip label="Blocked" value={metrics.blocked} color="#dc2626" />
        <StatChip label="Done" value={metrics.done} color="#65a30d" className="hidden lg:flex" />
      </div>

      {/* Main grid: team + activity | projects */}
      <div className="grid gap-3 xl:grid-cols-[1fr,1fr,0.7fr]">
        {/* Team Status */}
        <section className="rounded-lg border border-stone-800 bg-stone-900/80">
          <div className="flex items-center justify-between border-b border-stone-800 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-500">Team</h2>
            <Link href={`/companies/${slug}/agents`} className="text-[10px] text-stone-500 hover:text-amber-400">
              View all →
            </Link>
          </div>
          <div className="divide-y divide-stone-800/60">
            {snapshot?.agents.map((agent) => (
              <div key={agent.id} className="flex items-center gap-2.5 px-3 py-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[agent.status]}`} />
                <span className="mr-1 text-sm">{agent.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-stone-200">{agent.name}</p>
                  <p className="truncate text-[10px] text-stone-500">
                    {agent.currentTask || agent.role}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-stone-600">
                  {agent.lastHeartbeat ? formatAge(agent.lastHeartbeat) : "—"}
                </span>
              </div>
            ))}
            {!snapshot?.agents.length && !loading && (
              <p className="px-3 py-4 text-xs text-stone-600">No agents registered.</p>
            )}
          </div>
        </section>

        {/* Activity Feed */}
        <section className="rounded-lg border border-stone-800 bg-stone-900/80">
          <div className="flex items-center justify-between border-b border-stone-800 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-500">
              <Activity className="mr-1 inline h-3 w-3" />
              Activity
            </h2>
            <Link href={`/companies/${slug}/activity`} className="text-[10px] text-stone-500 hover:text-amber-400">
              Full log →
            </Link>
          </div>
          <div className="max-h-[420px] divide-y divide-stone-800/60 overflow-y-auto">
            {snapshot?.activity.map((event) => (
              <div key={event.id} className="px-3 py-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-xs text-stone-300 leading-relaxed">
                    {event.message}
                  </p>
                  <span className="shrink-0 text-[10px] text-stone-600">{formatAge(event.timestamp)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-stone-500">
                  {event.projectName && <span>{event.projectName}</span>}
                  {event.agentName && <span>· {event.agentName}</span>}
                </div>
              </div>
            ))}
            {!snapshot?.activity.length && !loading && (
              <p className="px-3 py-4 text-xs text-stone-600">No recent activity.</p>
            )}
          </div>
        </section>

        {/* Project Health */}
        <section className="rounded-lg border border-stone-800 bg-stone-900/80">
          <div className="flex items-center justify-between border-b border-stone-800 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-500">
              <FolderKanban className="mr-1 inline h-3 w-3" />
              Projects
            </h2>
            <div className="flex items-center gap-3 text-[10px]">
              <Link href="/projects" className="text-stone-500 hover:text-amber-400">
                Global →
              </Link>
              <Link href={`/companies/${slug}/projects`} className="text-stone-500 hover:text-amber-400">
                Company →
              </Link>
            </div>
          </div>
          <div className="divide-y divide-stone-800/60">
            {(activeProjectRecord
              ? (snapshot?.projects ?? []).filter((project) => project.id === activeProjectRecord.id)
              : (snapshot?.projects ?? [])
            ).map((project) => {
              const pTasks = (snapshot?.tasks ?? []).filter((t) => t.project === project.id);
              const pDone = pTasks.filter((t) => t.status === "done").length;
              const pActive = pTasks.filter((t) => t.status === "in-progress").length;
              const pBlocked = pTasks.filter((t) => t.status === "blocked").length;
              const pct = pTasks.length ? Math.round((pDone / pTasks.length) * 100) : 0;
              return (
                <Link
                  key={project.id}
                  href={`/companies/${slug}/projects/${project.slug}`}
                  className="block px-3 py-2 transition hover:bg-stone-800/40"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">{project.emoji}</span>
                      <span className="truncate text-xs font-medium text-stone-200">{project.name}</span>
                    </div>
                    <span className="shrink-0 text-[10px] text-stone-500">{pct}%</span>
                  </div>
                  {/* Mini bar */}
                  <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-stone-800">
                    {pDone > 0 && (
                      <div className="bg-amber-600" style={{ width: `${(pDone / pTasks.length) * 100}%` }} />
                    )}
                    {pActive > 0 && (
                      <div className="bg-amber-400/60" style={{ width: `${(pActive / pTasks.length) * 100}%` }} />
                    )}
                    {pBlocked > 0 && (
                      <div className="bg-red-600/60" style={{ width: `${(pBlocked / pTasks.length) * 100}%` }} />
                    )}
                  </div>
                  <div className="mt-1 flex gap-2 text-[10px] text-stone-500">
                    <span>{pTasks.length} tasks</span>
                    <span>{pActive} active</span>
                    {pBlocked > 0 && <span className="text-red-400">{pBlocked} blocked</span>}
                  </div>
                </Link>
              );
            })}
            {!snapshot?.projects.length && !loading && (
              <p className="px-3 py-4 text-xs text-stone-600">No projects.</p>
            )}
          </div>
        </section>
      </div>

      {/* Live sessions strip (if any) */}
      {snapshot && snapshot.sessions.length > 0 && (
        <section className="mt-3 rounded-lg border border-amber-800/30 bg-stone-900/80">
          <div className="flex items-center border-b border-stone-800 px-3 py-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-500">
              Live Sessions
            </h2>
            <span className="ml-2 rounded-full bg-amber-600/20 px-1.5 py-0.5 text-[10px] text-amber-300">
              {snapshot.sessions.filter((s) => !s.terminal).length} running
            </span>
          </div>
          <div className="grid gap-px divide-stone-800/60 sm:grid-cols-2 lg:grid-cols-4">
            {snapshot.sessions.map((session) => (
              <div key={session.taskId} className="px-3 py-2 border-b border-stone-800/40 sm:border-b-0 sm:border-r last:border-r-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-stone-200">{session.taskTitle}</p>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${session.terminal ? "bg-stone-500" : "bg-green-400 animate-pulse"}`} />
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-stone-500">
                  <span className="uppercase">{session.mode}</span>
                  <span>· {session.assignee}</span>
                  <span>· {formatAge(session.updated)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Loading / error states */}
      {loading && (
        <div className="mt-4 flex items-center justify-center text-xs text-stone-500">
          <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
          Loading dashboard…
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-md border border-amber-700/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="mr-1.5 inline h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  color,
  className = "",
}: {
  label: string;
  value: number;
  color: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${className}`}
      style={{
        borderColor: `${color}33`,
        background: `linear-gradient(135deg, ${color}12, transparent)`,
      }}
    >
      <span className="text-lg font-semibold text-stone-100">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-stone-400">{label}</span>
    </div>
  );
}
