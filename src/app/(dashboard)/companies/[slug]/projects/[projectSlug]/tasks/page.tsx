"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Plus,
  Filter,
  ArrowUpDown,
  Layers,
  Check,
  X,
  ChevronRight,
  List,
  Columns3,
  User,
} from "lucide-react";

import { statusTheme, priorityTheme } from "@/components/orchestration/ui";
import {
  listCompanies,
  listCompanyAgents,
  listProjects,
  listTasks,
} from "@/lib/orchestration/client";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import { ProjectTabBar } from "../ProjectTabBar";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationTask,
  TaskPriority,
  TaskStatus,
} from "@/lib/orchestration/types";

/* ── constants ── */

const STATUS_ORDER: TaskStatus[] = ["in-progress", "on-deck", "backlog", "review", "blocked", "done", "cancelled"];
const PRIORITY_ORDER: TaskPriority[] = ["P0", "P1", "P2", "P3"];

const STATUS_DOT: Record<TaskStatus, string> = {
  backlog: "#94a3b8",
  "on-deck": "#f59e0b",
  "in-progress": "#d97706",
  review: "#fbbf24",
  done: "#4ade80",
  blocked: "#ef4444",
  cancelled: "#78716c",
};

/* ── absolute date formatter (Paperclip-style: "Apr 2, 2026") ── */

function formatAbsoluteDate(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── derive live task IDs from agent data ── */

function deriveLiveTaskIds(
  tasks: OrchestrationTask[],
  agents: OrchestrationAgent[],
): Set<string> {
  const liveIds = new Set<string>();

  // Build a lookup of agent name/id → agent for matching
  const workingAgents = agents.filter((a) => a.status === "working");
  if (workingAgents.length === 0) return liveIds;

  // Map of agent key (lowercase name or id) → agent
  const agentByKey = new Map<string, OrchestrationAgent>();
  for (const a of workingAgents) {
    agentByKey.set(a.id.toLowerCase(), a);
    agentByKey.set(a.name.toLowerCase(), a);
  }

  for (const task of tasks) {
    if (task.status !== "in-progress") continue;
    if (!task.assignee) continue;

    const agent = agentByKey.get(task.assignee.toLowerCase());
    if (!agent) continue;

    // Agent is working — check if they're on this task.
    // agent.currentTask may be a task title, key, or ID depending on the API.
    const ct = agent.currentTask?.toLowerCase();
    if (
      !ct ||
      ct === task.id.toLowerCase() ||
      ct === task.key?.toLowerCase() ||
      ct === task.title.toLowerCase()
    ) {
      liveIds.add(task.id);
    }
  }

  return liveIds;
}

const QUICK_FILTERS = [
  { label: "All", statuses: [] as TaskStatus[] },
  { label: "Active", statuses: ["on-deck", "in-progress", "review", "blocked"] as TaskStatus[] },
  { label: "Backlog", statuses: ["backlog"] as TaskStatus[] },
  { label: "Done", statuses: ["done", "cancelled"] as TaskStatus[] },
];

/* ── view state ── */

type SortField = "status" | "priority" | "title" | "created" | "updated";
type SortDir = "asc" | "desc";
type GroupBy = "status" | "priority" | "assignee" | "none";
type ViewMode = "list" | "board";

interface ViewState {
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  assignees: string[];
  sortField: SortField;
  sortDir: SortDir;
  groupBy: GroupBy;
  viewMode: ViewMode;
  collapsedGroups: string[];
}

const DEFAULT_VIEW: ViewState = {
  statuses: [],
  priorities: [],
  assignees: [],
  sortField: "updated",
  sortDir: "desc",
  groupBy: "none",
  viewMode: "list",
  collapsedGroups: [],
};

function loadView(key: string): ViewState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...DEFAULT_VIEW, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_VIEW };
}

function saveView(key: string, state: ViewState) {
  try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* ignore */ }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function toggleIn(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function statusLabel(s: string): string {
  return statusTheme[s as TaskStatus]?.label ?? s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function countActiveFilters(s: ViewState): number {
  let n = 0;
  if (s.statuses.length) n++;
  if (s.priorities.length) n++;
  if (s.assignees.length) n++;
  return n;
}

/* ── filtering / sorting / grouping ── */

function applyFilters(tasks: OrchestrationTask[], state: ViewState): OrchestrationTask[] {
  let result = tasks;
  if (state.statuses.length > 0) result = result.filter((t) => state.statuses.includes(t.status));
  if (state.priorities.length > 0) result = result.filter((t) => state.priorities.includes(t.priority));
  if (state.assignees.length > 0) {
    result = result.filter((t) => {
      for (const a of state.assignees) {
        if (a === "__unassigned" && !t.assignee) return true;
        if (t.assignee === a) return true;
      }
      return false;
    });
  }
  return result;
}

function sortTasks(tasks: OrchestrationTask[], state: ViewState): OrchestrationTask[] {
  const sorted = [...tasks];
  const dir = state.sortDir === "asc" ? 1 : -1;
  sorted.sort((a, b) => {
    switch (state.sortField) {
      case "status":
        return dir * (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
      case "priority":
        return dir * (PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
      case "title":
        return dir * a.title.localeCompare(b.title);
      case "created":
        return dir * (new Date(a.created).getTime() - new Date(b.created).getTime());
      case "updated":
      default:
        return dir * (new Date(a.updated).getTime() - new Date(b.updated).getTime());
    }
  });
  return sorted;
}

function groupTasks(
  tasks: OrchestrationTask[],
  groupBy: GroupBy,
  agentLookup: Map<string, OrchestrationAgent>,
): Array<{ key: string; label: string | null; items: OrchestrationTask[] }> {
  if (groupBy === "none") {
    return [{ key: "__all", label: null, items: tasks }];
  }

  const groups: Record<string, OrchestrationTask[]> = {};

  if (groupBy === "status") {
    for (const t of tasks) {
      (groups[t.status] ??= []).push(t);
    }
    return STATUS_ORDER.filter((s) => groups[s]?.length).map((s) => ({
      key: s,
      label: statusLabel(s),
      items: groups[s]!,
    }));
  }

  if (groupBy === "priority") {
    for (const t of tasks) {
      (groups[t.priority] ??= []).push(t);
    }
    return PRIORITY_ORDER.filter((p) => groups[p]?.length).map((p) => ({
      key: p,
      label: p,
      items: groups[p]!,
    }));
  }

  // assignee
  for (const t of tasks) {
    const key = t.assignee ?? "__unassigned";
    (groups[key] ??= []).push(t);
  }
  return Object.keys(groups).map((key) => ({
    key,
    label: key === "__unassigned"
      ? "Unassigned"
      : (agentLookup.get(key.toLowerCase())?.name ?? key),
    items: groups[key]!,
  }));
}

/* ── search input with debounce ── */

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => { setLocal(value); }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => onChangeRef.current(local), 150);
    return () => clearTimeout(timer);
  }, [local]);

  return (
    <div className="relative w-48 sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Search tasks..."
        className="h-8 w-full rounded-md border bg-stone-950/60 pl-8 pr-3 text-sm text-stone-200 outline-none placeholder:text-stone-600 focus:border-amber-700/50"
        style={{ borderColor: "rgba(120,113,108,0.25)" }}
      />
    </div>
  );
}

/* ── popover primitive ── */

function SimplePopover({
  trigger,
  children,
  align = "end",
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-200"
      >
        {trigger}
      </button>
      {open && (
        <div
          className="absolute top-full mt-1 z-50 rounded-lg border bg-stone-900 shadow-xl"
          style={{
            borderColor: "rgba(120,113,108,0.25)",
            ...(align === "end" ? { right: 0 } : { left: 0 }),
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/* ── checkbox ── */

function MiniCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
      style={{
        borderColor: checked ? "#d97706" : "rgba(120,113,108,0.4)",
        background: checked ? "rgba(217,119,6,0.25)" : "transparent",
      }}
    >
      {checked && <Check className="h-3 w-3 text-amber-400" />}
    </button>
  );
}

/* ── issue row (Paperclip-style) ── */

function IssueRow({
  task,
  companySlug,
  projectSlug,
  agent,
  isLive,
}: {
  task: OrchestrationTask;
  companySlug: string;
  projectSlug: string;
  agent?: OrchestrationAgent;
  isLive?: boolean;
}) {
  const identifier = task.key ?? task.id.slice(0, 8);
  const dotColor = STATUS_DOT[task.status];
  const taskHref = buildCompanyPath(companySlug, `/projects/${encodeURIComponent(projectSlug)}/board?task=${encodeURIComponent(task.id)}`);

  return (
    <Link
      href={taskHref}
      className="group flex items-center gap-2 border-b py-2 pl-2 pr-3 text-sm no-underline transition-colors hover:bg-amber-950/20"
      style={{ borderColor: "rgba(120,113,108,0.1)" }}
    >
      {/* status icon */}
      <span className="shrink-0">
        <span
          className="inline-block h-[14px] w-[14px] rounded-full border-2"
          style={{ borderColor: dotColor }}
        />
      </span>

      {/* identifier */}
      <span className="hidden shrink-0 font-mono text-xs text-stone-500 sm:inline">
        {identifier}
      </span>

      {/* live indicator */}
      {isLive && (
        <span className="hidden items-center gap-1 rounded-full px-1.5 py-0.5 sm:inline-flex" style={{ background: "rgba(217,119,6,0.12)" }}>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span className="text-[11px] font-medium text-amber-400">Live</span>
        </span>
      )}

      {/* title */}
      <span className="min-w-0 flex-1 truncate text-sm text-stone-100 group-hover:text-amber-200">
        {task.title}
      </span>

      {/* trailing: assignee + date */}
      <span className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
        {/* assignee */}
        <span className="inline-flex w-[140px] items-center gap-1.5 text-xs">
          {agent ? (
            <>
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[9px]"
                style={{ background: "rgba(217,119,6,0.18)", color: "#fbbf24" }}
              >
                {agent.emoji ?? "•"}
              </span>
              <span className="truncate text-stone-300">{agent.name}</span>
            </>
          ) : task.assignee ? (
            <>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed text-stone-600" style={{ borderColor: "rgba(120,113,108,0.35)" }}>
                <User className="h-3 w-3" />
              </span>
              <span className="truncate text-stone-400">{task.assignee}</span>
            </>
          ) : (
            <>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed text-stone-600" style={{ borderColor: "rgba(120,113,108,0.35)" }}>
                <User className="h-3 w-3" />
              </span>
              <span className="text-stone-600">Assignee</span>
            </>
          )}
        </span>

        {/* date */}
        <span className="text-xs text-stone-500">{formatAbsoluteDate(task.updated)}</span>
      </span>
    </Link>
  );
}

/* ── Kanban stub (reuse existing board for now) ── */

function KanbanView({
  tasks,
  companySlug,
  projectSlug,
  agentLookup,
}: {
  tasks: OrchestrationTask[];
  companySlug: string;
  projectSlug: string;
  agentLookup: Map<string, OrchestrationAgent>;
}) {
  const columns: TaskStatus[] = ["backlog", "on-deck", "in-progress", "review", "blocked", "done"];
  const grouped: Record<string, OrchestrationTask[]> = {};
  for (const t of tasks) (grouped[t.status] ??= []).push(t);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {columns.map((col) => (
        <div
          key={col}
          className="flex w-64 shrink-0 flex-col rounded-lg border"
          style={{ borderColor: "rgba(120,113,108,0.15)", background: "rgba(28,25,23,0.4)" }}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_DOT[col] }} />
              <span className="text-xs font-medium text-stone-300">{statusLabel(col)}</span>
            </div>
            <span className="text-[10px] text-stone-600">{grouped[col]?.length ?? 0}</span>
          </div>
          <div className="flex-1 space-y-1 px-2 pb-2">
            {(grouped[col] ?? []).map((task) => {
              const agent = agentLookup.get((task.assignee ?? "").toLowerCase());
              return (
                <Link
                  key={task.id}
                  href={buildCompanyPath(companySlug, `/projects/${encodeURIComponent(projectSlug)}/board?task=${encodeURIComponent(task.id)}`)}
                  className="block rounded-md border p-2 text-xs no-underline transition-colors hover:bg-amber-950/20"
                  style={{ borderColor: "rgba(120,113,108,0.12)", background: "rgba(12,10,9,0.4)" }}
                >
                  <p className="mb-1 text-stone-200">{task.title}</p>
                  <div className="flex items-center justify-between text-[10px] text-stone-500">
                    <span>{task.key ?? task.id.slice(0, 6)}</span>
                    {agent && <span className="text-stone-400">{agent.name}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── main page ── */

export default function ProjectTasksPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = use(params);

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [project, setProject] = useState<OrchestrationProject | null>(null);
  const [tasks, setTasks] = useState<OrchestrationTask[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const viewKey = `mc:project-tasks-view:${projectSlug}`;
  const [view, setView] = useState<ViewState>(() => loadView(viewKey));

  const updateView = useCallback(
    (patch: Partial<ViewState>) => {
      setView((prev) => {
        const next = { ...prev, ...patch };
        saveView(viewKey, next);
        return next;
      });
    },
    [viewKey],
  );

  /* ── load data ── */
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [companyRows, projectRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
        ]);
        const co = companyRows.find((c) => c.slug === slug) ?? null;
        const proj = projectRows.find(
          (p) => p.slug === projectSlug || p.id === projectSlug,
        ) ?? null;
        if (cancelled) return;
        setCompany(co);
        setProject(proj);

        if (!co || !proj) {
          setLoading(false);
          return;
        }

        const [taskRows, agentRows] = await Promise.all([
          listTasks({ company: slug, projectId: proj.id, sort: "updated-desc", includeNonProduction: true }),
          listCompanyAgents(slug),
        ]);
        if (cancelled) return;
        setTasks(taskRows);
        setAgents(agentRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, projectSlug]);

  /* ── poll agents every 5s for live indicator updates ── */
  useEffect(() => {
    if (!company) return;
    const interval = setInterval(async () => {
      try {
        const agentRows = await listCompanyAgents(slug);
        setAgents(agentRows);
      } catch { /* ignore polling errors */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [company, slug]);

  /* ── derived data ── */
  const agentLookup = useMemo(() => {
    const m = new Map<string, OrchestrationAgent>();
    for (const a of agents) {
      m.set(a.id.toLowerCase(), a);
      m.set(a.name.toLowerCase(), a);
    }
    return m;
  }, [agents]);

  const liveTaskIds = useMemo(() => deriveLiveTaskIds(tasks, agents), [tasks, agents]);

  const searchedTasks = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.key ?? "").toLowerCase().includes(q) ||
        (t.assignee ?? "").toLowerCase().includes(q),
    );
  }, [tasks, search]);

  const filtered = useMemo(() => sortTasks(applyFilters(searchedTasks, view), view), [searchedTasks, view]);
  const grouped = useMemo(() => groupTasks(filtered, view.groupBy, agentLookup), [filtered, view.groupBy, agentLookup]);
  const activeFilterCount = countActiveFilters(view);

  /* ── new task link ── */
  const newTaskHref = `/companies/${encodeURIComponent(slug)}/issues/new${project ? `?projectId=${encodeURIComponent(project.id)}` : ""}`;

  /* ── render ── */

  if (loading) {
    return (
      <div className="flex h-full flex-col" style={{ background: "#0f0f0f" }}>
        <div className="p-6 text-sm text-stone-500">Loading...</div>
      </div>
    );
  }

  if (!company || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center" style={{ background: "#0f0f0f" }}>
        <p className="text-sm text-red-300">Project not found.</p>
        <Link href={buildCompanyPath(slug, "/projects")} className="mt-2 text-xs text-stone-400 hover:text-stone-200">
          Back to Projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ background: "#0f0f0f" }}>
      {/* ── project header ── */}
      <div className="px-5 pt-5 pb-0">
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-4 w-4 shrink-0 rounded-md"
            style={{ backgroundColor: project.color ?? "#d97706" }}
          />
          <h1 className="text-lg font-semibold text-stone-100">{project.name}</h1>
        </div>
      </div>

      {/* ── tab bar ── */}
      <div className="mt-3 px-5">
        <ProjectTabBar slug={slug} projectSlug={projectSlug} active="tasks" />
      </div>

      {/* ── toolbar ── */}
      <div className="flex items-center justify-between gap-2 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={newTaskHref}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-stone-200 no-underline transition-colors hover:bg-stone-800"
            style={{ borderColor: "rgba(120,113,108,0.3)" }}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New Task</span>
          </Link>
          <SearchInput value={search} onChange={setSearch} />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* list/board toggle */}
          <div className="mr-1 flex items-center overflow-hidden rounded-md border" style={{ borderColor: "rgba(120,113,108,0.25)" }}>
            <button
              className={`p-1.5 transition-colors ${view.viewMode === "list" ? "bg-stone-800 text-stone-200" : "text-stone-500 hover:text-stone-300"}`}
              onClick={() => updateView({ viewMode: "list" })}
              title="List view"
            >
              <List className="h-3.5 w-3.5" />
            </button>
            <button
              className={`p-1.5 transition-colors ${view.viewMode === "board" ? "bg-stone-800 text-stone-200" : "text-stone-500 hover:text-stone-300"}`}
              onClick={() => updateView({ viewMode: "board" })}
              title="Board view"
            >
              <Columns3 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* filter */}
          <SimplePopover
            trigger={
              <>
                <Filter className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {activeFilterCount > 0 ? `Filter (${activeFilterCount})` : "Filter"}
                </span>
                {activeFilterCount > 0 && (
                  <X
                    className="ml-0.5 h-3 w-3"
                    onClick={(e) => {
                      e.stopPropagation();
                      updateView({ statuses: [], priorities: [], assignees: [] });
                    }}
                  />
                )}
              </>
            }
          >
            {() => (
              <div className="w-[420px] p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-200">Filters</span>
                  {activeFilterCount > 0 && (
                    <button
                      className="text-xs text-stone-500 hover:text-stone-300"
                      onClick={() => updateView({ statuses: [], priorities: [], assignees: [] })}
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* quick filters */}
                <div className="space-y-1.5">
                  <span className="text-xs text-stone-500">Quick filters</span>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_FILTERS.map((preset) => {
                      const isActive = arraysEqual(view.statuses, preset.statuses);
                      return (
                        <button
                          key={preset.label}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            isActive
                              ? "border-amber-700 bg-amber-900/40 text-amber-200"
                              : "border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200"
                          }`}
                          onClick={() => updateView({ statuses: isActive ? [] : [...preset.statuses] })}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ borderTop: "1px solid rgba(120,113,108,0.15)" }} />

                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {/* status */}
                  <div className="space-y-1">
                    <span className="text-xs text-stone-500">Status</span>
                    <div className="space-y-0.5">
                      {STATUS_ORDER.map((s) => (
                        <label key={s} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-stone-800">
                          <MiniCheckbox
                            checked={view.statuses.includes(s)}
                            onChange={() => updateView({ statuses: toggleIn(view.statuses, s) })}
                          />
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_DOT[s] }} />
                          <span className="text-sm text-stone-300">{statusLabel(s)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {/* priority */}
                    <div className="space-y-1">
                      <span className="text-xs text-stone-500">Priority</span>
                      <div className="space-y-0.5">
                        {PRIORITY_ORDER.map((p) => (
                          <label key={p} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-stone-800">
                            <MiniCheckbox
                              checked={view.priorities.includes(p)}
                              onChange={() => updateView({ priorities: toggleIn(view.priorities, p) })}
                            />
                            <span className="font-mono text-xs font-semibold" style={{ color: priorityTheme[p].color }}>{p}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* assignee */}
                    <div className="space-y-1">
                      <span className="text-xs text-stone-500">Assignee</span>
                      <div className="max-h-32 space-y-0.5 overflow-y-auto">
                        <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-stone-800">
                          <MiniCheckbox
                            checked={view.assignees.includes("__unassigned")}
                            onChange={() => updateView({ assignees: toggleIn(view.assignees, "__unassigned") })}
                          />
                          <span className="text-sm text-stone-300">No assignee</span>
                        </label>
                        {agents.map((a) => (
                          <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-stone-800">
                            <MiniCheckbox
                              checked={view.assignees.includes(a.id)}
                              onChange={() => updateView({ assignees: toggleIn(view.assignees, a.id) })}
                            />
                            <span className="text-sm text-stone-300">{a.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </SimplePopover>

          {/* sort (list mode only) */}
          {view.viewMode === "list" && (
            <SimplePopover
              trigger={
                <>
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Sort</span>
                </>
              }
            >
              {() => (
                <div className="w-44 p-2 space-y-0.5">
                  {([
                    ["status", "Status"],
                    ["priority", "Priority"],
                    ["title", "Title"],
                    ["created", "Created"],
                    ["updated", "Updated"],
                  ] as const).map(([field, label]) => (
                    <button
                      key={field}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-sm ${
                        view.sortField === field ? "bg-stone-800 text-stone-200" : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                      }`}
                      onClick={() => {
                        if (view.sortField === field) {
                          updateView({ sortDir: view.sortDir === "asc" ? "desc" : "asc" });
                        } else {
                          updateView({ sortField: field, sortDir: "asc" });
                        }
                      }}
                    >
                      <span>{label}</span>
                      {view.sortField === field && (
                        <span className="text-xs text-stone-500">{view.sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </SimplePopover>
          )}

          {/* group (list mode only) */}
          {view.viewMode === "list" && (
            <SimplePopover
              trigger={
                <>
                  <Layers className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Group</span>
                </>
              }
            >
              {() => (
                <div className="w-40 p-2 space-y-0.5">
                  {([
                    ["status", "Status"],
                    ["priority", "Priority"],
                    ["assignee", "Assignee"],
                    ["none", "None"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-sm ${
                        view.groupBy === value ? "bg-stone-800 text-stone-200" : "text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                      }`}
                      onClick={() => updateView({ groupBy: value })}
                    >
                      <span>{label}</span>
                      {view.groupBy === value && <Check className="h-3.5 w-3.5 text-amber-500" />}
                    </button>
                  ))}
                </div>
              )}
            </SimplePopover>
          )}
        </div>
      </div>

      {/* ── content ── */}
      <div className="flex-1 overflow-auto px-5 pb-6">
        {view.viewMode === "board" ? (
          <KanbanView
            tasks={filtered}
            companySlug={slug}
            projectSlug={projectSlug}
            agentLookup={agentLookup}
          />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div
              className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full"
              style={{ background: "rgba(120,113,108,0.12)" }}
            >
              <List className="h-5 w-5 text-stone-500" />
            </div>
            <p className="text-sm text-stone-400">No tasks match the current filters.</p>
            <Link
              href={newTaskHref}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-stone-200 no-underline transition-colors hover:bg-stone-800"
              style={{ borderColor: "rgba(120,113,108,0.3)" }}
            >
              <Plus className="h-3 w-3" /> Create Task
            </Link>
          </div>
        ) : (
          grouped.map((group) => (
            <CollapsibleGroup
              key={group.key}
              label={group.label}
              count={group.items.length}
              collapsed={view.collapsedGroups.includes(group.key)}
              onToggle={() =>
                updateView({
                  collapsedGroups: view.collapsedGroups.includes(group.key)
                    ? view.collapsedGroups.filter((k) => k !== group.key)
                    : [...view.collapsedGroups, group.key],
                })
              }
              newTaskHref={newTaskHref}
            >
              {group.items.map((task) => (
                <IssueRow
                  key={task.id}
                  task={task}
                  companySlug={slug}
                  projectSlug={projectSlug}
                  agent={agentLookup.get((task.assignee ?? "").toLowerCase())}
                  isLive={liveTaskIds.has(task.id)}
                />
              ))}
            </CollapsibleGroup>
          ))
        )}
      </div>
    </div>
  );
}

/* ── collapsible group ── */

function CollapsibleGroup({
  label,
  count,
  collapsed,
  onToggle,
  newTaskHref,
  children,
}: {
  label: string | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  newTaskHref: string;
  children: React.ReactNode;
}) {
  if (!label) return <>{children}</>;

  return (
    <div className="mb-2">
      <div className="flex items-center py-1.5 pl-1 pr-3">
        <button onClick={onToggle} className="flex items-center gap-1.5 text-stone-300 hover:text-stone-100">
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform"
            style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }}
          />
          <span className="text-sm font-semibold uppercase tracking-wide">{label}</span>
          <span className="text-xs text-stone-600">{count}</span>
        </button>
        <Link
          href={newTaskHref}
          className="ml-auto text-stone-600 hover:text-stone-300"
        >
          <Plus className="h-3 w-3" />
        </Link>
      </div>
      {!collapsed && children}
    </div>
  );
}
