"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Activity, Loader2, RefreshCw } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { formatAge } from "@/components/orchestration/ui";
import { listActivityFeed, listCompanies, listProjects } from "@/lib/orchestration/client";
import { canonicalProjectBoardHref } from "@/lib/orchestration/company-routes";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type { OrchestrationActivityEvent, OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";

const PAGE_LIMIT = 40;
const API_PAGE_SIZE = 100;
const MAX_PAGE_FETCHES_PER_BATCH = 6;

/* ── amber/brown palette tokens ── */
const amber = {
  accent: "#d97706",
  accentLight: "#fbbf24",
  border: "rgba(217,119,6,0.25)",
  borderHover: "rgba(251,191,36,0.45)",
  bgSubtle: "rgba(217,119,6,0.06)",
  bgPanel: "rgba(28,25,23,0.82)",
  text: "#fde68a",
  textMuted: "#a8a29e",
  textDim: "#78716c",
};

type ActivitySlice = {
  events: OrchestrationActivityEvent[];
  nextCursor?: string;
  hasMore: boolean;
};

function eventStyle(eventType: OrchestrationActivityEvent["eventType"]) {
  if (eventType === "task.status_changed") return { label: "Status Change", color: "#d97706" };
  if (eventType === "task.assigned") return { label: "Assignment", color: "#a3e635" };
  if (eventType === "task.unassigned") return { label: "Unassigned", color: "#f59e0b" };
  if (eventType === "sprint.completed") return { label: "Sprint Complete", color: "#fbbf24" };
  if (eventType === "sprint.updated") return { label: "Sprint Updated", color: "#d6d3d1" };
  return { label: "Sprint Created", color: "#fb923c" };
}

function buildEventHref(company: OrchestrationCompany | null, companySlug: string, event: OrchestrationActivityEvent): string {
  const projectKey = event.projectSlug || event.projectId;
  if (!projectKey) return `/companies/${encodeURIComponent(companySlug)}`;
  return canonicalProjectBoardHref(company, projectKey, event.taskId);
}

async function readActivitySlice(
  slug: string,
  projectSet: Set<string>,
  cursor?: string
): Promise<ActivitySlice | null> {
  let nextCursor = cursor;
  let hasMore = true;
  let pagesFetched = 0;
  let collected: OrchestrationActivityEvent[] = [];

  while (hasMore && collected.length < PAGE_LIMIT && pagesFetched < MAX_PAGE_FETCHES_PER_BATCH) {
    const feed = await listActivityFeed({
      limit: API_PAGE_SIZE,
      cursor: nextCursor,
    });

    if (!feed) return null;

    const filtered = feed.activity.filter((event) => {
      if (event.companySlug) return event.companySlug === slug;
      return projectSet.has(event.projectId);
    });
    collected = collected.concat(filtered);

    nextCursor = feed.page.nextCursor;
    hasMore = feed.page.hasMore && Boolean(nextCursor);
    pagesFetched += 1;
  }

  return {
    events: collected.slice(0, PAGE_LIMIT),
    nextCursor,
    hasMore,
  };
}

export default function CompanyActivityPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const { activeProject, clearActiveProject } = useActiveProjectState();
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [events, setEvents] = useState<OrchestrationActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeProjectRecord = useMemo(
    () => resolveActiveProject(projects, activeProject, slug),
    [activeProject, projects, slug]
  );

  useEffect(() => {
    let cancelled = false;

    const loadInitial = async () => {
      setLoading(true);
      setError(null);

      try {
        const [companies, projectRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
        ]);

        if (cancelled) return;

        const current = companies.find((row) => row.slug === slug) ?? null;
        setCompany(current);

        if (!current) {
          setProjects([]);
          setEvents([]);
          setNextCursor(undefined);
          setHasMore(false);
          return;
        }

        const companyProjects = projectRows.filter((row) => row.companyId === current.id);
        setProjects(companyProjects);

        const projectSet = new Set(companyProjects.map((project) => project.id));
        const slice = await readActivitySlice(slug, projectSet);
        if (cancelled) return;
        if (!slice) {
          setError("Unable to load company activity right now.");
          setEvents([]);
          setNextCursor(undefined);
          setHasMore(false);
          return;
        }

        setEvents(slice.events);
        setNextCursor(slice.nextCursor);
        setHasMore(slice.hasMore);
      } catch {
        if (!cancelled) {
          setError("Unable to load company activity right now.");
          setEvents([]);
          setNextCursor(undefined);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void loadInitial();
    return () => { cancelled = true; };
  }, [slug, refreshNonce]);

  const handleLoadMore = async () => {
    if (!hasMore || !nextCursor || loadingMore || !company) return;
    setLoadingMore(true);
    setError(null);

    try {
      const projectSet = new Set(projects.map((project) => project.id));
      const slice = await readActivitySlice(slug, projectSet, nextCursor);
      if (!slice) {
        setError("Unable to load more activity right now.");
        return;
      }
      setEvents((previous) => previous.concat(slice.events));
      setNextCursor(slice.nextCursor);
      setHasMore(slice.hasMore);
    } finally {
      setLoadingMore(false);
    }
  };

  const counters = useMemo(() => {
    return events.reduce(
      (acc, event) => {
        if (event.eventType.startsWith("task.")) acc.task += 1;
        else acc.sprint += 1;
        if (event.eventType === "task.status_changed") acc.transitions += 1;
        return acc;
      },
      { task: 0, sprint: 0, transitions: 0 }
    );
  }, [events]);

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
    <div className="space-y-4 pb-8">
      {/* ── dense header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: amber.textDim }}>
            Activity
          </p>
          <h1 className="text-lg font-semibold text-stone-100">
            {loading ? "Loading…" : `${company?.name ?? "Company"} Timeline`}
          </h1>
          <p className="text-xs" style={{ color: amber.textMuted }}>
            {projects.length} projects · {events.length} events loaded
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setRefreshing(true); setRefreshNonce((v) => v + 1); }}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition"
          style={{ borderColor: amber.border, color: amber.text, background: amber.bgSubtle }}
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {activeProjectRecord ? (
        <ActiveProjectBanner companySlug={slug} project={activeProjectRecord} onClear={clearActiveProject} compact />
      ) : null}

      {/* ── stat pills ── */}
      <div className="flex flex-wrap gap-2">
        <StatPill label="Events" value={events.length} />
        <StatPill label="Task" value={counters.task} />
        <StatPill label="Sprint" value={counters.sprint} />
        <StatPill label="Transitions" value={counters.transitions} />
      </div>

      {/* ── error banner ── */}
      {error ? (
        <div
          className="rounded-lg border p-2.5 text-xs"
          style={{ borderColor: "rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.08)", color: "#fda4af" }}
        >
          {error}
        </div>
      ) : null}

      {/* ── timeline ── */}
      <div
        className="rounded-xl border p-3"
        style={{ borderColor: amber.border, background: amber.bgPanel }}
      >
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg"
                style={{ background: "rgba(217,119,6,0.08)", border: `1px solid ${amber.border}` }}
              />
            ))}
          </div>
        ) : events.length === 0 ? (
          <div
            className="rounded-lg border border-dashed px-3 py-8 text-center text-xs"
            style={{ borderColor: amber.border, color: amber.textMuted }}
          >
            No company events yet.
          </div>
        ) : (
          <div className="space-y-1">
            {events
              .filter((event) => !activeProjectRecord || event.projectId === activeProjectRecord.id)
              .map((event) => {
              const meta = eventStyle(event.eventType);
              return (
                <Link
                  key={`${event.id}-${event.timestamp}`}
                  href={buildEventHref(company, slug, event)}
                  className="group flex items-start gap-2.5 rounded-lg border px-3 py-2 transition"
                  style={{
                    borderColor: "rgba(255,255,255,0.06)",
                    background: "rgba(28,25,23,0.5)",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = amber.borderHover; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
                >
                  {/* icon */}
                  <span
                    className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
                    style={{
                      borderColor: `${meta.color}55`,
                      backgroundColor: `${meta.color}18`,
                      color: meta.color,
                    }}
                  >
                    <Activity className="h-3 w-3" />
                  </span>

                  {/* content */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-stone-200">{event.message}</p>
                    <p className="mt-0.5 truncate text-[11px]" style={{ color: amber.textDim }}>
                      {event.projectName}
                      {event.taskTitle ? ` · ${event.taskTitle}` : ""}
                      {event.agentName ? ` · ${event.agentName}` : ""}
                    </p>
                  </div>

                  {/* badges + time */}
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[10px]" style={{ color: amber.textDim }}>
                      {formatAge(event.timestamp)} ago
                    </span>
                    <div className="flex gap-1">
                      <span
                        className="rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                        style={{
                          borderColor: `${meta.color}44`,
                          color: meta.color,
                          backgroundColor: `${meta.color}12`,
                        }}
                      >
                        {meta.label}
                      </span>
                      {event.oldStatus && event.newStatus ? (
                        <span
                          className="rounded-full border px-1.5 py-0.5 text-[9px] text-stone-400"
                          style={{ borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)" }}
                        >
                          {event.oldStatus} → {event.newStatus}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* load more */}
        {!loading && hasMore ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => void handleLoadMore()}
              disabled={loadingMore}
              className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] disabled:opacity-50"
              style={{ borderColor: amber.border, color: amber.text, background: amber.bgSubtle }}
            >
              {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {loadingMore ? "Loading…" : "Load more events"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── compact stat pill ── */
function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px]"
      style={{ borderColor: amber.border, background: amber.bgSubtle }}
    >
      <span style={{ color: amber.textDim }}>{label}</span>
      <span className="font-medium" style={{ color: amber.text }}>{value}</span>
    </div>
  );
}
