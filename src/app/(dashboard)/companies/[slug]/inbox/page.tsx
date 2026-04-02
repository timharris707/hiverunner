"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageSquareText, PlayCircle, Search, Target, XCircle } from "lucide-react";

import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { formatAge, statusTheme } from "@/components/orchestration/ui";
import { getCompanyInbox, listCompanies, listProjects } from "@/lib/orchestration/client";
import type { OrchestrationCompany, OrchestrationCompanyInboxEvent, OrchestrationCompanyInboxTask, OrchestrationProject, TaskStatus } from "@/lib/orchestration/types";

type StatusFilter = "all" | TaskStatus;

type InboxSnapshot = {
  events: OrchestrationCompanyInboxEvent[];
  tasks: OrchestrationCompanyInboxTask[];
  totals: Record<"backlog" | "on-deck" | "in-progress" | "review" | "done" | "blocked", number>;
  unreadCount: number;
  unreadSince?: string;
  nextCursor?: string;
  hasMore: boolean;
};

const INITIAL_SNAPSHOT: InboxSnapshot = {
  events: [],
  tasks: [],
  totals: {
    backlog: 0,
    "on-deck": 0,
    "in-progress": 0,
    review: 0,
    done: 0,
    blocked: 0,
  },
  unreadCount: 0,
  hasMore: false,
};

function eventIcon(event: OrchestrationCompanyInboxEvent) {
  if (event.eventType === "task.comment_added") return MessageSquareText;
  if (event.eventType === "task.status_changed") return Target;
  if (event.eventType === "execution.completed") return CheckCircle2;
  if (event.eventType === "execution.failed" || event.eventType === "execution.cancelled") return XCircle;
  if (event.eventType === "execution.pending" || event.eventType === "execution.running") return PlayCircle;
  return event.kind === "execution" ? PlayCircle : Target;
}

function eventAccent(event: OrchestrationCompanyInboxEvent) {
  if (event.eventType === "execution.completed") return "#34d399";
  if (event.eventType === "execution.failed" || event.eventType === "execution.cancelled") return "#f87171";
  if (event.eventType === "execution.pending" || event.eventType === "execution.running") return "#d97706";
  if (event.eventType === "task.comment_added") return "#f59e0b";
  if (event.eventType === "task.status_changed") return "#f59e0b";
  return "#d97706";
}

function eventTargetHref(companySlug: string, event: OrchestrationCompanyInboxEvent) {
  if (!event.projectSlug && !event.projectId) return `/companies/${encodeURIComponent(companySlug)}`;
  const projectKey = event.projectSlug || event.projectId;
  const taskQuery = event.taskId ? `?task=${encodeURIComponent(event.taskId)}` : "";
  return `/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(projectKey)}/board${taskQuery}`;
}

export default function CompanyInboxPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [snapshot, setSnapshot] = useState<InboxSnapshot>(INITIAL_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [includeDone, setIncludeDone] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [companyRows, projectRows, inbox] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          getCompanyInbox({
            companySlug: slug,
            projectId: projectFilter === "all" ? undefined : projectFilter,
            status: statusFilter === "all" ? undefined : statusFilter,
            search: search || undefined,
            includeDone,
            includeTaskSnapshot: true,
            limit: 50,
          }),
        ]);

        if (cancelled) return;

        const current = companyRows.find((row) => row.slug === slug) ?? null;
        setCompany(current);

        if (!current) {
          setProjects([]);
          setSnapshot(INITIAL_SNAPSHOT);
          return;
        }

        setProjects(projectRows.filter((row) => row.companyId === current.id));

        if (!inbox) {
          setSnapshot(INITIAL_SNAPSHOT);
          return;
        }

        setSnapshot({
          events: inbox.events,
          tasks: inbox.tasks,
          totals: inbox.totals,
          unreadCount: inbox.unreadCount,
          unreadSince: inbox.unreadSince,
          nextCursor: inbox.page.nextCursor,
          hasMore: inbox.page.hasMore,
        });
      } catch {
        if (!cancelled) {
          setError("Unable to load company inbox feed right now.");
          setSnapshot(INITIAL_SNAPSHOT);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [includeDone, projectFilter, search, slug, statusFilter]);

  const loadMore = async () => {
    if (!snapshot.hasMore || !snapshot.nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const next = await getCompanyInbox({
        companySlug: slug,
        projectId: projectFilter === "all" ? undefined : projectFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
        search: search || undefined,
        includeDone,
        includeTaskSnapshot: false,
        limit: 50,
        cursor: snapshot.nextCursor,
      });

      if (!next) return;

      setSnapshot((prev) => ({
        ...prev,
        events: prev.events.concat(next.events),
        nextCursor: next.page.nextCursor,
        hasMore: next.page.hasMore,
      }));
    } finally {
      setLoadingMore(false);
    }
  };

  const activeCount = useMemo(() => {
    return snapshot.totals.backlog + snapshot.totals["on-deck"] + snapshot.totals["in-progress"] + snapshot.totals.review + snapshot.totals.blocked;
  }, [snapshot.totals]);

  const openTasks = useMemo(() => snapshot.tasks.filter((task) => task.status !== "done").slice(0, 8), [snapshot.tasks]);

  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="This company could not be resolved from orchestration data."
        href="/companies"
      />
    );
  }

  return (
    <CompanyShell
      eyebrow="Company Inbox"
      title={loading ? "Loading Inbox..." : `${company?.name ?? "Company"} Inbox`}
      description="Chronological company activity with task updates, execution runs, and comments across projects."
      accentColor="#f59e0b"
    >
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Unread" value={snapshot.unreadCount} detail="Events newer than current marker" accentColor="#f59e0b" />
        <StatCard label="Active Tasks" value={activeCount} detail="Open work across the company" accentColor="#d97706" />
        <StatCard label="Blocked" value={snapshot.totals.blocked} detail="Tasks needing intervention" accentColor="#f87171" />
        <StatCard label="Done" value={snapshot.totals.done} detail="Completed tasks in current filter" accentColor="#34d399" />
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">
          {error}
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
              placeholder="Search events, projects, tasks"
            />
          </div>

          <select
            className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <select
            className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="all">All statuses</option>
            <option value="backlog">Backlog</option>
            <option value="on-deck">On Deck</option>
            <option value="in-progress">In Progress</option>
            <option value="review">Review</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>

          <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={includeDone}
              onChange={(event) => setIncludeDone(event.target.checked)}
              className="h-3.5 w-3.5 accent-amber-400"
            />
            Include done
          </label>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr),minmax(300px,1fr)]">
          <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Activity Feed</h2>
              {snapshot.unreadSince ? (
                <span className="text-[11px] text-slate-400">Unread since {new Date(snapshot.unreadSince).toLocaleString()}</span>
              ) : null}
            </div>

            <div className="space-y-3">
              {loading ? (
                Array.from({ length: 7 }).map((_, idx) => (
                  <div key={idx} className="h-20 animate-pulse rounded-xl border border-white/10 bg-slate-950/70" />
                ))
              ) : snapshot.events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-3 py-8 text-center text-sm text-slate-400">
                  No activity events match this filter.
                </div>
              ) : (
                snapshot.events.map((event) => {
                  const Icon = eventIcon(event);
                  const accent = eventAccent(event);
                  const targetHref = eventTargetHref(slug, event);

                  return (
                    <Link
                      key={event.id}
                      href={targetHref}
                      className="block rounded-xl border border-white/10 bg-slate-950/80 p-3 transition hover:border-amber-300/35"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-lg border"
                            style={{
                              borderColor: `${accent}66`,
                              backgroundColor: `${accent}1e`,
                              color: accent,
                            }}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <div>
                            <p className="text-sm text-slate-100">{event.message}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {event.projectName}
                              {event.taskTitle ? ` · ${event.taskTitle}` : ""}
                              {event.agentName ? ` · ${event.agentName}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="text-right text-[11px] text-slate-500">
                          <p>{formatAge(event.timestamp)} ago</p>
                          <p>{new Date(event.timestamp).toLocaleString()}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em]">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-400">{event.kind}</span>
                        {event.status ? (
                          <span
                            className="rounded-full px-2 py-1 text-slate-200"
                            style={{ boxShadow: statusTheme[event.status].glow }}
                          >
                            {statusTheme[event.status].label}
                          </span>
                        ) : null}
                        {event.provider ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-400">{event.provider}</span>
                        ) : null}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>

            {!loading && snapshot.hasMore ? (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-300/35 bg-amber-400/10 px-3 py-2 text-xs text-amber-100 disabled:opacity-60"
                >
                  {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {loadingMore ? "Loading..." : "Load more events"}
                </button>
              </div>
            ) : null}
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-3">
              <h2 className="mb-3 text-sm font-semibold text-white">Open Tasks Snapshot</h2>
              <div className="space-y-2">
                {loading ? (
                  Array.from({ length: 6 }).map((_, idx) => (
                    <div key={idx} className="h-14 animate-pulse rounded-xl border border-white/10 bg-slate-950/70" />
                  ))
                ) : openTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                    No open tasks in this view.
                  </div>
                ) : (
                  openTasks.map((task) => {
                    const taskHref = `/companies/${encodeURIComponent(slug)}/projects/${encodeURIComponent(task.projectSlug || task.projectId)}/board?task=${encodeURIComponent(task.id)}`;
                    return (
                      <Link
                        key={task.id}
                        href={taskHref}
                        className="block rounded-xl border border-white/10 bg-slate-950/80 p-3 transition hover:border-amber-300/35"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-amber-100">{task.projectName}</span>
                          <span className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{task.priority}</span>
                        </div>
                        <p className="line-clamp-2 text-sm text-slate-100">{task.title}</p>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>{task.assignee ?? "Unassigned"}</span>
                          <span>{statusTheme[task.status].label}</span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-amber-300/20 bg-amber-500/10 p-3 text-xs text-amber-100">
              <p className="inline-flex items-center gap-2 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Inbox notes
              </p>
              <p className="mt-2 text-amber-100/85">
                Events are ordered newest-first across task and execution streams. Use project/status filters to narrow triage scope.
              </p>
            </section>
          </aside>
        </div>
      </section>
    </CompanyShell>
  );
}
