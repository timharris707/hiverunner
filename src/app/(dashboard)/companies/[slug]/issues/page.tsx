"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Search, Plus, ChevronDown } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { formatAge, priorityTheme, typeIcon } from "@/components/orchestration/ui";
import { listCompanies, listCompanyAgents, listProjects, listTasks } from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type { OrchestrationAgent, OrchestrationCompany, OrchestrationProject, OrchestrationTask, TaskPriority, TaskStatus, TaskType } from "@/lib/orchestration/types";

type SortMode = "updated-desc" | "created-desc" | "priority-asc";

type CompanyIssue = OrchestrationTask & {
  projectId: string;
  projectSlug: string;
  projectName: string;
  projectColor: string;
};

const STATUS_OPTIONS: Array<"all" | TaskStatus> = ["all", "backlog", "on-deck", "in-progress", "review", "blocked", "done"];
const PRIORITY_OPTIONS: Array<"all" | TaskPriority> = ["all", "P0", "P1", "P2", "P3"];

const PRIORITY_WEIGHT: Record<TaskPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/* ── amber/brown status colors (no blue/purple) ── */
const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: "#94a3b8",
  "on-deck": "#f59e0b",
  "in-progress": "#d97706",
  review: "#fbbf24",
  done: "#4ade80",
  blocked: "#ef4444",
  cancelled: "#78716c",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  "on-deck": "On Deck",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

/* ── priority colors (amber palette, no blue) ── */
const PRI_COLOR: Record<TaskPriority, string> = {
  P0: "#ef4444",
  P1: "#f59e0b",
  P2: "#d97706",
  P3: "#78716c",
};

export default function CompanyIssuesPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const { activeProject, clearActiveProject } = useActiveProjectState();
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [issues, setIssues] = useState<CompanyIssue[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated-desc");

  useEffect(() => {
    const queryProject = searchParams.get("projectId") ?? searchParams.get("project");
    if (queryProject) {
      setProjectFilter(queryProject);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows, taskRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          listTasks({ company: slug, includeNonProduction: true, sort: "updated-desc" }),
        ]);

        const current = companyRows.find((row) => row.slug === slug) ?? null;
        if (cancelled) return;
        setCompany(current);

        if (!current) {
          setProjects([]);
          setIssues([]);
          setAgents([]);
          return;
        }

        const companyProjects = projectRows;
        const projectLookup = new Map(companyProjects.map((project) => [project.id, project] as const));

        const scopedIssues = taskRows
          .filter((task) => projectLookup.has(task.project))
          .map((task) => {
            const project = projectLookup.get(task.project);
            return {
              ...task,
              projectId: project?.id ?? task.project,
              projectSlug: project?.slug ?? task.project,
              projectName: project?.name ?? "Unknown",
              projectColor: project?.color ?? "#d97706",
            };
          });

        const companyAgents = await listCompanyAgents(current.slug);
        if (cancelled) return;

        setProjects(companyProjects);
        setIssues(scopedIssues);
        setAgents(companyAgents);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const activeProjectRecord = useMemo(() => {
    const queryProject = searchParams.get("projectId") ?? searchParams.get("project");
    if (queryProject) {
      return (
        projects.find((project) => project.id === queryProject || project.slug === queryProject) ??
        resolveActiveProject(projects, activeProject, slug)
      );
    }
    return resolveActiveProject(projects, activeProject, slug);
  }, [activeProject, projects, searchParams, slug]);

  const assigneeLookup = useMemo(() => {
    const entries = new Map<string, OrchestrationAgent>();
    for (const agent of agents) {
      entries.set(agent.id.toLowerCase(), agent);
      entries.set(agent.name.toLowerCase(), agent);
    }
    return entries;
  }, [agents]);

  const filteredIssues = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();

    const filtered = issues.filter((issue) => {
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      const effectiveProjectFilter = activeProjectRecord?.id ?? projectFilter;
      if (effectiveProjectFilter !== "all" && issue.projectId !== effectiveProjectFilter) return false;
      if (!lowerQuery) return true;
      const haystack = `${issue.title} ${issue.description ?? ""} ${issue.assignee ?? ""} ${issue.projectName} ${issue.type} ${issue.priority}`.toLowerCase();
      return haystack.includes(lowerQuery);
    });

    return filtered.sort((a, b) => {
      if (sortMode === "created-desc") return new Date(b.created).getTime() - new Date(a.created).getTime();
      if (sortMode === "priority-asc") return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      return new Date(b.updated).getTime() - new Date(a.updated).getTime();
    });
  }, [activeProjectRecord, issues, query, statusFilter, projectFilter, sortMode]);

  /* ── counts for inline summary ── */
  const counts = useMemo(() => {
    const c = { total: issues.length, active: 0, blocked: 0, review: 0 };
    for (const i of issues) {
      if (i.status === "in-progress") c.active++;
      if (i.status === "blocked") c.blocked++;
      if (i.status === "review") c.review++;
    }
    return c;
  }, [issues]);

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <div className="flex h-full flex-col" style={{ background: "linear-gradient(180deg, #0c0a09 0%, #1c1917 100%)" }}>
      {activeProjectRecord ? (
        <div className="px-4 pt-4">
          <ActiveProjectBanner companySlug={slug} project={activeProjectRecord} compact onClear={clearActiveProject} />
        </div>
      ) : null}

      {/* ── top bar: title + inline counts + new button ── */}
      <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: "rgba(217,119,6,0.15)", background: "rgba(12,10,9,0.9)" }}>
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold text-stone-100">
            {company?.name ?? "Issues"}
            <span className="ml-2 text-xs font-normal text-stone-500">/ Issues</span>
          </h1>
          <div className="hidden items-center gap-3 text-[11px] text-stone-400 sm:flex">
            <span>{counts.total} total</span>
            <span className="text-stone-600">·</span>
            <span style={{ color: "#d97706" }}>{counts.active} active</span>
            {counts.blocked > 0 && (
              <>
                <span className="text-stone-600">·</span>
                <span style={{ color: "#ef4444" }}>{counts.blocked} blocked</span>
              </>
            )}
            {counts.review > 0 && (
              <>
                <span className="text-stone-600">·</span>
                <span style={{ color: "#fbbf24" }}>{counts.review} review</span>
              </>
            )}
          </div>
        </div>
        <Link
          href={`/companies/${encodeURIComponent(slug)}/issues/new`}
          className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium text-stone-100 transition hover:brightness-110"
          style={{ background: "#b45309" }}
        >
          <Plus className="h-3 w-3" /> New Issue
        </Link>
      </div>

      {/* ── compact filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5" style={{ borderColor: "rgba(217,119,6,0.1)", background: "rgba(28,25,23,0.7)" }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-500" />
          <input
            className="h-7 w-52 rounded border bg-stone-950/80 pl-7 pr-2 text-xs text-stone-200 outline-none placeholder:text-stone-600 focus:border-amber-600/50"
            style={{ borderColor: "rgba(217,119,6,0.2)" }}
            placeholder="Search issues…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <InlineSelect value={statusFilter} onChange={(v) => setStatusFilter(v as "all" | TaskStatus)}>
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.slice(1).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s as TaskStatus]}</option>
          ))}
        </InlineSelect>

        <InlineSelect value={projectFilter} onChange={setProjectFilter}>
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </InlineSelect>

        <InlineSelect value={sortMode} onChange={(v) => setSortMode(v as SortMode)}>
          <option value="updated-desc">Updated</option>
          <option value="created-desc">Created</option>
          <option value="priority-asc">Priority</option>
        </InlineSelect>

        <span className="ml-auto text-[11px] text-stone-500">
          {filteredIssues.length} shown
        </span>
      </div>

      {/* ── dense table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10" style={{ background: "#1c1917" }}>
            <tr className="border-b text-left text-[10px] font-medium uppercase tracking-wider text-stone-500" style={{ borderColor: "rgba(217,119,6,0.12)" }}>
              <th className="py-1.5 pl-4 pr-2 font-medium">Status</th>
              <th className="px-2 py-1.5 font-medium">Title</th>
              <th className="px-2 py-1.5 font-medium">Pri</th>
              <th className="hidden px-2 py-1.5 font-medium md:table-cell">Type</th>
              <th className="hidden px-2 py-1.5 font-medium sm:table-cell">Assignee</th>
              <th className="hidden px-2 py-1.5 font-medium lg:table-cell">Project</th>
              <th className="px-2 py-1.5 pr-4 text-right font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading && issues.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-stone-500">Loading…</td>
              </tr>
            ) : filteredIssues.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs text-stone-500">No issues match filters.</td>
              </tr>
            ) : (
              filteredIssues.map((issue, idx) => (
                <DenseRow
                  key={issue.id}
                  issue={issue}
                  companySlug={slug}
                  assignee={assigneeLookup.get((issue.assignee ?? "").toLowerCase())}
                  even={idx % 2 === 0}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Dense table row ── */
function DenseRow({ issue, companySlug, assignee, even }: {
  issue: CompanyIssue;
  companySlug: string;
  assignee?: OrchestrationAgent;
  even: boolean;
}) {
  const taskHref = `/companies/${encodeURIComponent(companySlug)}/projects/${encodeURIComponent(issue.projectSlug)}/board?task=${encodeURIComponent(issue.id)}`;
  const dotColor = STATUS_DOT[issue.status];
  const priColor = PRI_COLOR[issue.priority];

  return (
    <tr
      className="group cursor-pointer border-b transition-colors hover:!bg-amber-950/20"
      style={{
        borderColor: "rgba(120,113,108,0.08)",
        background: even ? "rgba(28,25,23,0.4)" : "rgba(12,10,9,0.5)",
      }}
      onClick={() => { window.location.href = taskHref; }}
    >
      {/* status dot + label */}
      <td className="py-1.5 pl-4 pr-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: dotColor }} />
          <span className="text-stone-400">{STATUS_LABEL[issue.status]}</span>
        </span>
      </td>

      {/* title */}
      <td className="max-w-0 px-2 py-1.5">
        <Link href={taskHref} className="block truncate font-medium text-stone-100 group-hover:text-amber-200" onClick={(e) => e.stopPropagation()}>
          {issue.title}
        </Link>
      </td>

      {/* priority */}
      <td className="px-2 py-1.5">
        <span className="font-mono text-[11px] font-semibold" style={{ color: priColor }}>
          {issue.priority}
        </span>
      </td>

      {/* type */}
      <td className="hidden px-2 py-1.5 text-stone-500 md:table-cell">
        <span title={issue.type}>{typeIcon[issue.type]} {issue.type}</span>
      </td>

      {/* assignee */}
      <td className="hidden px-2 py-1.5 sm:table-cell">
        {assignee ? (
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px]" style={{ background: "rgba(217,119,6,0.18)", color: "#fbbf24" }}>
              {assignee.emoji ?? "•"}
            </span>
            <span className="text-stone-300">{assignee.name}</span>
          </span>
        ) : issue.assignee ? (
          <span className="text-stone-400">{issue.assignee}</span>
        ) : (
          <span className="text-stone-600">—</span>
        )}
      </td>

      {/* project */}
      <td className="hidden px-2 py-1.5 lg:table-cell">
        <span
          className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: issue.projectColor, background: `${issue.projectColor}18` }}
        >
          {issue.projectName}
        </span>
      </td>

      {/* updated */}
      <td className="px-2 py-1.5 pr-4 text-right text-stone-500">
        {formatAge(issue.updated)}
      </td>
    </tr>
  );
}

/* ── Tiny inline select ── */
function InlineSelect({ value, onChange, children }: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 appearance-none rounded border bg-stone-950/80 pl-2 pr-6 text-xs text-stone-300 outline-none focus:border-amber-600/50"
        style={{ borderColor: "rgba(217,119,6,0.2)" }}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-500" />
    </div>
  );
}
