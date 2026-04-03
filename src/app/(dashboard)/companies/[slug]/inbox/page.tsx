"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquareText, PlayCircle, Search, Target, XCircle } from "lucide-react";

import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { formatAge, statusTheme } from "@/components/orchestration/ui";
import { getCompanyInbox, listCompanies, listProjects } from "@/lib/orchestration/client";
import { canonicalProjectBoardHref } from "@/lib/orchestration/company-routes";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
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
  totals: { backlog: 0, "on-deck": 0, "in-progress": 0, review: 0, done: 0, blocked: 0 },
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

function eventTargetHref(company: OrchestrationCompany | null, event: OrchestrationCompanyInboxEvent) {
  if (!event.projectSlug && !event.projectId) return company ? `/companies/${encodeURIComponent(company.slug)}` : "/companies";
  const projectKey = event.projectSlug || event.projectId;
  return canonicalProjectBoardHref(company, projectKey, event.taskId);
}

export default function CompanyInboxPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const { activeProject, clearActiveProject } = useActiveProjectState();
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

  const activeProjectRecord = useMemo(
    () => resolveActiveProject(projects, activeProject, slug),
    [activeProject, projects, slug]
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchDraft.trim());
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchDraft]);

  // Load once, no auto-refresh loop
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
            projectId: activeProjectRecord?.id ?? (projectFilter === "all" ? undefined : projectFilter),
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
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [slug, activeProjectRecord?.id, projectFilter, statusFilter, search, includeDone]);

  const loadMore = async () => {
    if (!snapshot.hasMore || !snapshot.nextCursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const next = await getCompanyInbox({
        companySlug: slug,
        projectId: activeProjectRecord?.id ?? (projectFilter === "all" ? undefined : projectFilter),
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
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/companies" />;
  }

  const inputStyle: React.CSSProperties = {
    borderRadius: "10px",
    border: "1px solid rgba(120,113,108,0.3)",
    background: "rgba(41,37,36,0.5)",
    padding: "8px 12px",
    fontSize: "13px",
    color: "#f5f5f4",
    outline: "none",
  };

  return (
    <CompanyShell eyebrow="Company Inbox" title={loading ? "Loading Inbox..." : `${company?.name ?? "Company"} Inbox`} description="Chronological company activity with task updates, execution runs, and comments across projects.">
      {activeProjectRecord ? (
        <ActiveProjectBanner companySlug={slug} project={activeProjectRecord} onClear={clearActiveProject} compact />
      ) : null}

      {/* stat cards */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Unread" value={snapshot.unreadCount} detail="Events newer than current marker" />
        <StatCard label="Active Tasks" value={activeCount} detail="Open work across the company" />
        <StatCard label="Blocked" value={snapshot.totals.blocked} detail="Tasks needing intervention" />
        <StatCard label="Done" value={snapshot.totals.done} detail="Completed tasks in current filter" />
      </section>

      {error ? (
        <section style={{ borderRadius: "14px", border: "1px solid rgba(120,113,108,0.3)", background: "rgba(28,25,23,0.7)", padding: "12px 16px", fontSize: "13px", color: "#d6d3d1" }}>
          {error}
        </section>
      ) : null}

      {/* main content */}
      <section style={{ borderRadius: "14px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(28,25,23,0.65)", padding: "20px" }}>
        {/* filters */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
          <div style={{ position: "relative", flex: "1 1 220px", minWidth: "220px" }}>
            <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#78716c", pointerEvents: "none" }} />
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search events, projects, tasks"
              style={{ ...inputStyle, width: "100%", paddingLeft: "32px" }}
            />
          </div>
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={inputStyle}>
            <option value="all">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} style={inputStyle}>
            <option value="all">All statuses</option>
            <option value="backlog">Backlog</option>
            <option value="on-deck">On Deck</option>
            <option value="in-progress">In Progress</option>
            <option value="review">Review</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", ...inputStyle, padding: "6px 12px", fontSize: "12px", color: "#a8a29e" }}>
            <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
            Include done
          </label>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr),minmax(300px,1fr)]">
          {/* activity feed */}
          <section style={{ borderRadius: "14px", border: "1px solid rgba(120,113,108,0.2)", background: "rgba(28,25,23,0.5)", padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#f5f5f4" }}>Activity Feed</h2>
              {snapshot.unreadSince ? (
                <span style={{ fontSize: "11px", color: "#78716c" }}>Unread since {new Date(snapshot.unreadSince).toLocaleString()}</span>
              ) : null}
            </div>

            <div style={{ display: "grid", gap: "8px" }}>
              {loading ? (
                <div style={{ padding: "32px 0", textAlign: "center" }}>
                  <p style={{ fontSize: "13px", color: "#78716c" }}>Loading activity...</p>
                </div>
              ) : snapshot.events.length === 0 ? (
                <div style={{ borderRadius: "10px", border: "1px dashed rgba(120,113,108,0.3)", padding: "32px 12px", textAlign: "center", fontSize: "13px", color: "#78716c" }}>
                  No activity events match this filter.
                </div>
              ) : (
                snapshot.events.map((event) => {
                  const Icon = eventIcon(event);
                  const targetHref = eventTargetHref(company, event);

                  return (
                    <Link
                      key={event.id}
                      href={targetHref}
                      style={{
                        display: "block",
                        borderRadius: "10px",
                        border: "1px solid rgba(120,113,108,0.18)",
                        background: "rgba(41,37,36,0.35)",
                        padding: "12px",
                        textDecoration: "none",
                        transition: "border-color 120ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(168,162,158,0.4)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(120,113,108,0.18)"; }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                          <span style={{
                            marginTop: "2px",
                            display: "inline-flex",
                            width: "28px",
                            height: "28px",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "8px",
                            border: "1px solid rgba(120,113,108,0.3)",
                            background: "rgba(41,37,36,0.5)",
                            color: "#a8a29e",
                            flexShrink: 0,
                          }}>
                            <Icon size={14} />
                          </span>
                          <div>
                            <p style={{ fontSize: "13px", color: "#d6d3d1" }}>{event.message}</p>
                            <p style={{ marginTop: "4px", fontSize: "12px", color: "#78716c" }}>
                              {event.projectName}
                              {event.taskTitle ? ` · ${event.taskTitle}` : ""}
                              {event.agentName ? ` · ${event.agentName}` : ""}
                            </p>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", fontSize: "11px", color: "#57534e", flexShrink: 0 }}>
                          <p>{formatAge(event.timestamp)} ago</p>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        <span style={{ borderRadius: "999px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)", padding: "2px 8px", color: "#78716c" }}>{event.kind}</span>
                        {event.status ? (
                          <span style={{ borderRadius: "999px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(41,37,36,0.4)", padding: "2px 8px", color: "#a8a29e" }}>
                            {statusTheme[event.status]?.label ?? event.status}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>

            {!loading && snapshot.hasMore ? (
              <div style={{ marginTop: "12px", display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  style={{
                    borderRadius: "10px",
                    border: "1px solid rgba(120,113,108,0.35)",
                    background: "rgba(41,37,36,0.5)",
                    padding: "8px 16px",
                    fontSize: "12px",
                    color: "#d6d3d1",
                    cursor: "pointer",
                    opacity: loadingMore ? 0.6 : 1,
                  }}
                >
                  {loadingMore ? "Loading..." : "Load more events"}
                </button>
              </div>
            ) : null}
          </section>

          {/* sidebar */}
          <aside style={{ display: "grid", gap: "16px", alignContent: "start" }}>
            <section style={{ borderRadius: "14px", border: "1px solid rgba(120,113,108,0.2)", background: "rgba(28,25,23,0.5)", padding: "16px" }}>
              <h2 style={{ marginBottom: "12px", fontSize: "13px", fontWeight: 600, color: "#f5f5f4" }}>Open Tasks Snapshot</h2>
              <div style={{ display: "grid", gap: "8px" }}>
                {loading ? (
                  <div style={{ padding: "24px 0", textAlign: "center" }}>
                    <p style={{ fontSize: "13px", color: "#78716c" }}>Loading tasks...</p>
                  </div>
                ) : openTasks.length === 0 ? (
                  <div style={{ borderRadius: "10px", border: "1px dashed rgba(120,113,108,0.3)", padding: "24px 12px", textAlign: "center", fontSize: "12px", color: "#57534e" }}>
                    No open tasks in this view.
                  </div>
                ) : (
                  openTasks.map((task) => {
                    const taskHref = canonicalProjectBoardHref(company, task.projectSlug || task.projectId, task.id);
                    return (
                      <Link
                        key={task.id}
                        href={taskHref}
                        style={{
                          display: "block",
                          borderRadius: "10px",
                          border: "1px solid rgba(120,113,108,0.18)",
                          background: "rgba(41,37,36,0.35)",
                          padding: "12px",
                          textDecoration: "none",
                          transition: "border-color 120ms ease",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(168,162,158,0.4)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(120,113,108,0.18)"; }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "11px", color: "#a8a29e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.projectName}</span>
                          <span style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: "#57534e" }}>{task.priority}</span>
                        </div>
                        <p style={{ fontSize: "13px", color: "#d6d3d1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</p>
                        <div style={{ marginTop: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px", color: "#57534e" }}>
                          <span>{task.assignee ?? "Unassigned"}</span>
                          <span>{statusTheme[task.status]?.label ?? task.status}</span>
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </CompanyShell>
  );
}
