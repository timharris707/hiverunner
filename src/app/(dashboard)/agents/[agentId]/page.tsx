"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Bot,
  Building2,
  Clock3,
  FolderKanban,
  ListChecks,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatAge, priorityTheme, statusTheme, typeIcon } from "@/components/orchestration/ui";
import {
  getProjectBoard,
  listCompanies,
  listProjectAgents,
  listProjects,
  listTaskComments,
} from "@/lib/orchestration/client";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationTask,
} from "@/lib/orchestration/types";

type AgentScope = {
  project: OrchestrationProject;
  company: OrchestrationCompany | undefined;
  agent: OrchestrationAgent;
  assignedTasks: OrchestrationTask[];
};

type ExecutionEntry = {
  id: string;
  taskTitle: string;
  projectId: string;
  timestamp: string;
  text: string;
  tone: "comment" | "event";
};

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const searchParams = useSearchParams();
  const preferredProjectId = searchParams.get("projectId") ?? undefined;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<AgentScope | null>(null);
  const [executionLog, setExecutionLog] = useState<ExecutionEntry[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [companies, projects] = await Promise.all([listCompanies(), listProjects()]);
        const companyById = new Map(companies.map((company) => [company.id, company]));

        const scopes = await Promise.all(
          projects.map(async (project) => {
            const board = await getProjectBoard(project.id);
            if (!board) return null;

            const roster = await listProjectAgents(project.id, board.tasks);
            const match = roster.find((agent) => agent.id === agentId);
            if (!match) return null;

            const assignedTasks = board.tasks
              .filter((task) => {
                if (!task.assignee) return false;
                const assignee = task.assignee.toLowerCase();
                return assignee === match.name.toLowerCase() || assignee === match.id.toLowerCase();
              })
              .sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());

            return {
              project,
              company: project.companyId ? companyById.get(project.companyId) : undefined,
              agent: match,
              assignedTasks,
            } satisfies AgentScope;
          })
        );

        if (!mounted) return;

        const matches = scopes.filter((item): item is AgentScope => item !== null);
        if (matches.length === 0) {
          setScope(null);
          setExecutionLog([]);
          setError("Agent profile not found in orchestration projects.");
          return;
        }

        const selected =
          matches.find((item) => item.project.id === preferredProjectId) ??
          matches.sort((a, b) => new Date(b.agent.updated ?? "").getTime() - new Date(a.agent.updated ?? "").getTime())[0];
        if (!selected) {
          setScope(null);
          setExecutionLog([]);
          setError("Agent profile not found in orchestration projects.");
          return;
        }

        setScope(selected);

        const recentTasks = selected.assignedTasks.slice(0, 6);
        const commentGroups = await Promise.all(
          recentTasks.map(async (task) => ({
            task,
            comments: await listTaskComments(task.id),
          }))
        );

        if (!mounted) return;

        const commentEntries: ExecutionEntry[] = [];
        for (const group of commentGroups) {
          for (const comment of group.comments) {
            if (comment.author.toLowerCase() !== selected.agent.name.toLowerCase()) continue;
            commentEntries.push({
              id: `comment:${group.task.id}:${comment.id}`,
              taskTitle: group.task.title,
              projectId: selected.project.id,
              timestamp: comment.timestamp,
              text: comment.text,
              tone: "comment",
            });
          }
        }

        const eventEntries: ExecutionEntry[] = recentTasks.map((task) => ({
          id: `event:${task.id}`,
          taskTitle: task.title,
          projectId: selected.project.id,
          timestamp: task.updated,
          text: `Task moved to ${statusTheme[task.status].label}.`,
          tone: "event",
        }));

        const merged = [...commentEntries, ...eventEntries]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 12);

        setExecutionLog(merged);
      } catch {
        if (!mounted) return;
        setError("Failed to load agent profile.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [agentId, preferredProjectId]);

  const stats = useMemo(() => {
    if (!scope) return null;

    const totalAssigned = scope.assignedTasks.length;
    const doneCount = scope.assignedTasks.filter((task) => task.status === "done").length;
    const activeCount = scope.assignedTasks.filter((task) => task.status === "in-progress").length;
    const reviewCount = scope.assignedTasks.filter((task) => task.status === "review").length;
    const blockedCount = scope.assignedTasks.filter((task) => task.status === "blocked").length;

    return {
      totalAssigned,
      doneCount,
      activeCount,
      reviewCount,
      blockedCount,
      completionRate: totalAssigned > 0 ? Math.round((doneCount / totalAssigned) * 100) : 0,
    };
  }, [scope]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <section className="orchestra-glass orchestra-enter rounded-3xl p-5 md:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Link href="/agents" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-slate-900/65 px-3 py-2 text-xs text-slate-200 hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Directory
          </Link>
          {scope ? (
            <Link
              href={`/projects/${scope.project.id}/board`}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300/40 bg-amber-400/15 px-3 py-2 text-xs text-amber-100 hover:text-amber-50"
            >
              <FolderKanban className="h-3.5 w-3.5" />
              Open Project Board
            </Link>
          ) : null}
        </div>

        {loading ? (
          <div className="h-48 animate-pulse rounded-2xl border border-white/10 bg-slate-900/60" />
        ) : error ? (
          <div className="rounded-xl border border-rose-400/35 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
        ) : scope && stats ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-slate-800/85 text-2xl">
                  {scope.agent.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={scope.agent.avatar} alt={`${scope.agent.name} avatar`} className="h-full w-full object-cover" />
                  ) : (
                    scope.agent.emoji
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.24em] text-amber-100/70">
                    {scope.company?.name ?? "Orchestration Agent"}
                  </p>
                  <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">{scope.agent.name}</h1>
                  <p className="mt-1 text-sm text-slate-300">{scope.agent.role}</p>
                </div>
              </div>
              <StatusBadge status={scope.agent.status} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Stat label="Assigned" value={stats.totalAssigned} />
              <Stat label="Done" value={stats.doneCount} accent="#6ee7b7" />
              <Stat label="In Progress" value={stats.activeCount} accent="#fcd34d" />
              <Stat label="In Review" value={stats.reviewCount} accent="#a8a29e" />
              <Stat label="Blocked" value={stats.blockedCount} accent="#fda4af" />
              <Stat label="Completion" value={`${stats.completionRate}%`} />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <DetailRow icon={<Bot className="h-3.5 w-3.5" />} label="Model" value={scope.agent.model || "Pending Forge contract"} />
              <DetailRow icon={<Activity className="h-3.5 w-3.5" />} label="Current Task" value={scope.agent.currentTask || "Idle — waiting"} />
              <DetailRow icon={<Building2 className="h-3.5 w-3.5" />} label="Project" value={scope.project.name} />
              <DetailRow
                icon={scope.agent.lastHeartbeat ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                label="Last Heartbeat"
                value={scope.agent.lastHeartbeat ? `${formatAge(scope.agent.lastHeartbeat)} ago` : "No heartbeat yet"}
              />
            </div>
          </div>
        ) : null}
      </section>

      {scope && stats ? (
        <div className="grid gap-4 xl:grid-cols-5">
          <section className="orchestra-card rounded-2xl p-4 xl:col-span-3">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                <ListChecks className="h-4 w-4 text-amber-200" />
                Recent Task History
              </h2>
              <span className="text-[11px] text-slate-400">{scope.assignedTasks.length} total tracked</span>
            </div>

            {scope.assignedTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700/80 bg-slate-900/55 p-8 text-center text-sm text-slate-400">
                No assigned task history yet.
              </div>
            ) : (
              <div className="space-y-2">
                {scope.assignedTasks.slice(0, 8).map((task) => (
                  <article key={task.id} className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-slate-100">
                        <span className="mr-1">{typeIcon[task.type]}</span>
                        {task.title}
                      </p>
                      <span className="text-[11px] text-slate-400">{formatAge(task.updated)} ago</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span
                        className="rounded-full px-2 py-1"
                        style={{
                          color: priorityTheme[task.priority].color,
                          backgroundColor: priorityTheme[task.priority].bg,
                        }}
                      >
                        {priorityTheme[task.priority].label}
                      </span>
                      <span
                        className="rounded-full px-2 py-1 text-slate-200"
                        style={{ boxShadow: statusTheme[task.status].glow }}
                      >
                        {statusTheme[task.status].label}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="orchestra-card rounded-2xl p-4 xl:col-span-2">
            <h2 className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-white">
              <Clock3 className="h-4 w-4 text-amber-200" />
              Execution Log
            </h2>

            {executionLog.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700/80 bg-slate-900/55 p-8 text-center text-sm text-slate-400">
                No execution entries yet.
              </div>
            ) : (
              <div className="space-y-2">
                {executionLog.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-white/10 bg-slate-900/65 p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{entry.tone === "comment" ? "Agent Comment" : "Task Event"}</p>
                    <p className="mt-1 text-xs font-medium text-slate-100">{entry.taskTitle}</p>
                    <p className="mt-1 text-xs text-slate-300">{entry.text}</p>
                    <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Clock3 className="h-3 w-3" />
                      {formatAge(entry.timestamp)} ago
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      {scope ? (
        <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 text-xs text-slate-300">
          <p className="inline-flex items-center gap-2 text-slate-200">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
            Profile Notes
          </p>
          <p className="mt-2 text-slate-400">
            {scope.agent.personality || "Personality profile not defined yet."}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/55 p-3">
      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color: accent ?? "#e2e8f0" }}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: OrchestrationAgent["status"] }) {
  const palette: Record<OrchestrationAgent["status"], { text: string; bg: string; border: string }> = {
    working: { text: "#6ee7b7", bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.45)" },
    idle: { text: "#f59e0b", bg: "rgba(180,83,9,0.16)", border: "rgba(180,83,9,0.4)" },
    paused: { text: "#fcd34d", bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.4)" },
    offline: { text: "#fda4af", bg: "rgba(244,63,94,0.16)", border: "rgba(244,63,94,0.4)" },
    error: { text: "#f87171", bg: "rgba(239,68,68,0.18)", border: "rgba(239,68,68,0.5)" },
  };

  return (
    <span
      className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]"
      style={{
        color: palette[status].text,
        borderColor: palette[status].border,
        backgroundColor: palette[status].bg,
      }}
    >
      {status}
    </span>
  );
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
      <p className="inline-flex items-center gap-1 text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-slate-200">{value}</p>
    </div>
  );
}
