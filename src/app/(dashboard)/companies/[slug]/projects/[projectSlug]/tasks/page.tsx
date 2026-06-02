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
  CircleAlert,
} from "lucide-react";

import { statusTheme, priorityTheme } from "@/components/orchestration/ui";
import { StatusCircle } from "@/components/orchestration/StatusCircle";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { getAgentByAnyId } from "@/config/agents";
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
import { Card, EmptyState, PageHeader } from "@/lib/ui/primitives";
import { color, font, P, radius, space, type as tokenType } from "@/lib/ui/tokens";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";

/* ── constants ── */

const STATUS_ORDER: TaskStatus[] = ["backlog", "to-do", "in-progress", "review", "done", "blocked", "cancelled"];
const PRIORITY_ORDER: TaskPriority[] = ["P0", "P1", "P2", "P3"];

const QUICK_FILTERS = [
  { label: "All", statuses: [] as TaskStatus[] },
  { label: "Active", statuses: ["to-do", "in-progress", "review", "blocked"] as TaskStatus[] },
  { label: "Backlog", statuses: ["backlog"] as TaskStatus[] },
  { label: "Done", statuses: ["done", "cancelled"] as TaskStatus[] },
];

/* ── absolute date formatter (clear, readable cadence) ── */

function formatAbsoluteDate(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ── derive active owners from agent state ── */

function deriveActiveTaskOwners(
  tasks: OrchestrationTask[],
  agents: OrchestrationAgent[],
): Map<string, OrchestrationAgent> {
  const owners = new Map<string, OrchestrationAgent>();
  const workingAgents = agents.filter((a) => a.status === "working");
  if (workingAgents.length === 0) return owners;

  for (const task of tasks) {
    if (task.assignee) continue;

    const taskId = task.id.toLowerCase();
    const taskKey = task.key?.toLowerCase();
    const taskTitle = task.title.toLowerCase();

    const owningAgent = workingAgents.find((agent) => {
      const currentTask = agent.currentTask?.toLowerCase();
      if (!currentTask) return false;
      return currentTask === taskId || (taskKey ? currentTask === taskKey : false) || currentTask === taskTitle;
    });

    if (owningAgent) owners.set(task.id, owningAgent);
  }

  return owners;
}

function statusLabel(s: string): string {
  return statusTheme[s as TaskStatus]?.label ?? s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function countActiveFilters(s: { statuses: TaskStatus[]; priorities: TaskPriority[]; assignees: string[] }): number {
  let n = 0;
  if (s.statuses.length) n++;
  if (s.priorities.length) n++;
  if (s.assignees.length) n++;
  return n;
}

function arraysEqual<T extends string>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function toggleIn<T extends string>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

/* ── search input ── */

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    const timer = setTimeout(() => onChangeRef.current(local), 150);
    return () => clearTimeout(timer);
  }, [local]);

  return (
    <label style={{ position: "relative", minWidth: 200, flex: "0 1 280px" }}>
      <Search
        size={14}
        style={{
          position: "absolute",
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          color: P.textMuted,
          pointerEvents: "none",
        }}
      />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Search tasks..."
        style={{
          width: "100%",
          height: 34,
          borderRadius: radius.md,
          border: `0.5px solid ${P.cardBorder}`,
          background: "transparent",
          padding: "0 12px 0 32px",
          fontSize: 13,
          color: P.text,
          outline: "none",
        }}
      />
    </label>
  );
}

/* ── popover wrapper ── */

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
    <div style={{ position: "relative" }} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "0 10px",
          height: "34px",
          borderRadius: radius.md,
          border: `0.5px solid ${P.cardBorder}`,
          background: "transparent",
          color: P.textSecondary,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        {trigger}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            zIndex: 50,
            minWidth: align === "end" ? 240 : 220,
            right: align === "end" ? 0 : "auto",
            borderRadius: radius.md,
            border: `1px solid ${P.cardBorder}`,
            background: P.surfaceElevated,
            boxShadow: "0 16px 36px rgba(0, 0, 0, 0.35)",
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
      style={{
        display: "inline-flex",
        width: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.sm,
        border: `1px solid ${checked ? P.accent : P.cardBorder}`,
        background: checked ? P.accentSoft : "transparent",
      }}
    >
      {checked && <Check size={11} color={P.accent} />}
    </button>
  );
}

/* ── issue row (single-line) ── */

function IssueRow({
  task,
  companySlug,
  projectSlug,
  assigneeAgent,
  activeOwner,
}: {
  task: OrchestrationTask;
  companySlug: string;
  projectSlug: string;
  assigneeAgent?: OrchestrationAgent;
  activeOwner?: OrchestrationAgent;
}) {
  const identifier = task.key ?? task.id.slice(0, 8);
  const taskHref = task.key
    ? buildCompanyPath(companySlug, `/tasks/${encodeURIComponent(task.key)}`)
    : buildCompanyPath(companySlug, `/projects/${encodeURIComponent(projectSlug)}/board?task=${encodeURIComponent(task.id)}`);

  return (
    <Link
      href={taskHref}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        textDecoration: "none",
        color: P.text,
        borderBottom: "none",
        transition: "background 120ms",
        fontSize: 13,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {/* status circle */}
      <span style={{ flexShrink: 0 }}>
        <StatusCircle status={task.status} size={12} />
      </span>

      {/* task key */}
      <span style={{
        flexShrink: 0,
        fontFamily: font.mono,
        fontSize: 12,
        color: P.textMuted,
      }}>
        {identifier}
      </span>

      {/* title */}
      <span style={{
        flex: "1 1 auto",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: P.text,
      }}>
        {task.title}
      </span>

        {/* trailing: assignee + date */}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
        {/* assignee */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, width: 120 }}>
          {assigneeAgent ? (
            <>
              {assigneeAgent.avatar ? (
                <img
                  src={assigneeAgent.avatar}
                  alt={assigneeAgent.name}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "9999px",
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "9999px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: assigneeAgent.emoji ? "rgba(217,119,6,0.18)" : "rgba(255,255,255,0.06)",
                      color: assigneeAgent.emoji ? "#fbbf24" : P.textSecondary,
                      fontSize: assigneeAgent.emoji ? 11 : 9,
                      fontFamily: assigneeAgent.emoji ? undefined : font.mono,
                      flexShrink: 0,
                    }}
                  >
                    <AvatarGlyph
                      value={assigneeAgent.emoji}
                      fallback={assigneeAgent.name?.slice(0, 1)?.toUpperCase() || ""}
                      size={11}
                      color={assigneeAgent.emoji ? "#fbbf24" : P.textSecondary}
                    />
                </span>
              )}
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 1, minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontSize: 12, color: P.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assigneeAgent.name}</span>
              </span>
            </>
          ) : activeOwner ? (
            <>
              <span style={{
                width: 20,
                height: 20,
                borderRadius: "9999px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px dashed ${P.cardBorder}`,
                color: P.textMuted,
                flexShrink: 0,
              }}>
                <User size={11} />
              </span>
              <span style={{ display: "inline-flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, color: P.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeOwner.name}</span>
                <span style={{ fontSize: 10, color: P.textMuted }}>Triage owner</span>
              </span>
            </>
          ) : (
            <>
              <span style={{
                width: 20,
                height: 20,
                borderRadius: "9999px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                border: `1px dashed ${P.cardBorder}`,
                color: P.textMuted,
                flexShrink: 0,
              }}>
                <User size={11} />
              </span>
              <span style={{ fontSize: 12, color: P.textMuted }}>Assignee</span>
            </>
          )}
        </span>

        {/* date */}
        <span style={{ fontSize: 12, color: P.textMuted, flexShrink: 0 }}>{formatAbsoluteDate(task.updated)}</span>
      </span>
    </Link>
  );
}

/* ── Kanban stub (reworked for shared surface style) ── */

function KanbanView({
  tasks,
  companySlug,
  projectSlug,
  agentLookup,
  activeTaskOwners,
}: {
  tasks: OrchestrationTask[];
  companySlug: string;
  projectSlug: string;
  agentLookup: Map<string, OrchestrationAgent>;
  activeTaskOwners: Map<string, OrchestrationAgent>;
}) {
  const columns: TaskStatus[] = ["backlog", "to-do", "in-progress", "review", "done", "blocked"];
  const grouped: Record<string, OrchestrationTask[]> = {};
  for (const t of tasks) (grouped[t.status] ??= []).push(t);

  return (
    <div
      style={{
        display: "flex",
        gap: space.md,
        overflowX: "auto",
        paddingBottom: space.sm,
      }}
    >
      {columns.map((col) => {
        const items = grouped[col] ?? [];
        return (
          <div
            key={col}
            style={{
              width: 270,
              flexShrink: 0,
              border: `1px solid ${P.cardBorder}`,
              borderRadius: radius.md,
              background: P.surface,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: `${space.sm}px ${space.md}px`,
                borderBottom: `1px solid ${P.cardBorder}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StatusCircle status={col} size={10} />
                <span style={{ fontSize: tokenType.bodySmall.size, color: P.textSecondary }}>{statusLabel(col)}</span>
              </div>
              <span style={{ fontSize: 11, color: P.textMuted }}>{items.length}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: `${space.md}px ${space.md}px` }}>
              {items.map((task) => {
                const assigneeAgent = task.assignee ? agentLookup.get((task.assignee ?? "").toLowerCase()) : undefined;
                const activeOwner = task.assignee ? undefined : activeTaskOwners.get(task.id);
                return (
                  <Link
                    key={task.id}
                    href={task.key
                      ? buildCompanyPath(companySlug, `/tasks/${encodeURIComponent(task.key)}`)
                      : buildCompanyPath(companySlug, `/projects/${encodeURIComponent(projectSlug)}/board?task=${encodeURIComponent(task.id)}`)}
                    style={{
                      display: "block",
                      border: `1px solid ${P.cardBorder}`,
                      borderRadius: radius.md,
                      padding: `${space.sm}px ${space.md}px`,
                      textDecoration: "none",
                      background: P.surfaceElevated,
                      color: P.text,
                      transition: "border-color 140ms",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = P.cardBorderHover;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = P.cardBorder;
                    }}
                  >
                    <p style={{
                      margin: "0 0 6px",
                      fontSize: tokenType.cardTitle.size,
                      color: P.text,
                    }}>
                      {task.title}
                    </p>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: tokenType.bodySmall.size,
                      color: P.textSec,
                    }}>
                      <span>{task.key ?? task.id.slice(0, 6)}</span>
                      {assigneeAgent ? (
                        <span>{assigneeAgent.name}</span>
                      ) : activeOwner ? (
                        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.2 }}>
                          <span>{activeOwner.name}</span>
                          <span style={{ fontSize: 11, color: P.textMuted }}>Triage owner</span>
                        </span>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
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
  const [createTaskOpen, setCreateTaskOpen] = useState(false);

  const viewKey = `mc:project-tasks-view:${projectSlug}`;
  const [view, setView] = useState({
    statuses: [] as TaskStatus[],
    priorities: [] as TaskPriority[],
    assignees: [] as string[],
    sortField: "updated" as "status" | "priority" | "title" | "created" | "updated",
    sortDir: "desc" as "asc" | "desc",
    groupBy: "none" as "status" | "priority" | "assignee" | "none",
    viewMode: "list" as "list" | "board",
    collapsedGroups: [] as string[],
  });

  const loadView = (key: string) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...view, ...JSON.parse(raw) } : view;
    } catch {
      return view;
    }
  };

  useEffect(() => {
    const saved = loadView(viewKey);
    setView(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const saveView = (next: typeof view) => {
    setView(next);
    try { localStorage.setItem(viewKey, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const updateView = useCallback(
    (patch: Partial<typeof view>) => saveView({ ...view, ...patch }),
    [view],
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
    return () => {
      cancelled = true;
    };
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

  const activeTaskOwners = useMemo(() => deriveActiveTaskOwners(tasks, agents), [tasks, agents]);

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

  const filtered = useMemo(() => {
    const statusRank = view.statuses.length === 0
      ? [...searchedTasks]
      : searchedTasks.filter((t) => view.statuses.includes(t.status));
    const priorityRank = statusRank.filter((t) => view.priorities.length === 0 || view.priorities.includes(t.priority));
    const assigneeRank = priorityRank.filter((t) => {
      if (!view.assignees.length) return true;
      return view.assignees.some((a) => (a === "__unassigned" && !t.assignee) || t.assignee === a);
    });

    const dir = view.sortDir === "asc" ? 1 : -1;
    const sorted = [...assigneeRank];
    sorted.sort((a, b) => {
      switch (view.sortField) {
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
  }, [searchedTasks, view]);

  const grouped = useMemo(() => {
    if (view.groupBy === "none") {
      return [{ key: "__all", label: null, items: filtered }];
    }
    const groups: Record<string, OrchestrationTask[]> = {};
    if (view.groupBy === "status") {
      for (const t of filtered) {
        (groups[t.status] ??= []).push(t);
      }
      return STATUS_ORDER.filter((s) => groups[s]?.length).map((s) => ({
        key: s,
        label: statusLabel(s),
        items: groups[s]!,
      }));
    }
    if (view.groupBy === "priority") {
      for (const t of filtered) {
        (groups[t.priority] ??= []).push(t);
      }
      return PRIORITY_ORDER.filter((p) => groups[p]?.length).map((p) => ({
        key: p,
        label: priorityTheme[p].label,
        items: groups[p]!,
      }));
    }

    for (const t of filtered) {
      const key = t.assignee ?? "__unassigned";
      (groups[key] ??= []).push(t);
    }
    return Object.keys(groups).map((key) => ({
      key,
      label: key === "__unassigned" ? "Unassigned" : (agentLookup.get(key.toLowerCase())?.name ?? key),
      items: groups[key]!,
    }));
  }, [filtered, view.groupBy, agentLookup]);

  const activeFilterCount = countActiveFilters(view);

  /* ── new task link ── */
  const newTaskHref = `/companies/${encodeURIComponent(slug)}/tasks/new${project ? `?projectId=${encodeURIComponent(project.id)}` : ""}`;

  if (loading) {
    return (
      <div style={{ padding: `${space.md}px ${space.xl}px`, color: P.textMuted, fontSize: tokenType.body.size }}>
        Loading tasks…
      </div>
    );
  }

  if (!company || !project) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: `${space.md}px ${space.xl}px` }}>
        <EmptyState
          icon={<CircleAlert size={20} />}
          title="Project not found."
          description="The selected project does not exist or is not available in this workspace."
        />
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100%",
        padding: `${space.md}px ${space.xl}px`,
        color: P.text,
        fontFamily: font.body,
      }}
    >
      {/* ── project header */}
      <PageHeader
        icon={
          <span
            style={{
              display: "inline-block",
              width: 14,
              height: 14,
              borderRadius: radius.full,
              background: project.color ?? P.accent,
            }}
          />
        }
        title={project.name}
        actions={
          <button
            type="button"
            onClick={() => setCreateTaskOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              height: 34,
              borderRadius: radius.md,
              border: `0.5px solid ${P.cardBorder}`,
              background: "transparent",
              color: P.text,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <Plus size={13} />
            New Task
          </button>
        }
      />

      <div style={{ marginTop: space.xs, marginBottom: space.md }}>
        <ProjectTabBar slug={slug} projectSlug={projectSlug} active="tasks" />
      </div>

      {/* ── toolbar */}
      <div style={{ marginBottom: space.md, padding: `${space.sm}px 0` }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
          flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: space.sm, minWidth: 0, flex: 1 }}>
            <SearchInput value={search} onChange={setSearch} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: space.xs, flexShrink: 0 }}>
            <div style={{
              display: "inline-flex",
              borderRadius: radius.md,
              border: `0.5px solid ${P.cardBorder}`,
            }}>
              <button
                type="button"
                onClick={() => updateView({ viewMode: "list" })}
                style={{
                  padding: "6px 8px",
                  borderRadius: radius.md,
                  border: "none",
                  background: view.viewMode === "list" ? "rgba(255,255,255,0.08)" : "transparent",
                  color: view.viewMode === "list" ? P.text : P.textMuted,
                  cursor: "pointer",
                }}
                title="List view"
              >
                <List size={14} />
              </button>
              <button
                type="button"
                onClick={() => updateView({ viewMode: "board" })}
                style={{
                  padding: "6px 8px",
                  borderRadius: radius.md,
                  border: "none",
                  background: view.viewMode === "board" ? "rgba(255,255,255,0.08)" : "transparent",
                  color: view.viewMode === "board" ? P.text : P.textMuted,
                  cursor: "pointer",
                }}
                title="Board view"
              >
                <Columns3 size={14} />
              </button>
            </div>

            <SimplePopover
              trigger={
                <>
                  <Filter size={14} />
                  <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</span>
                  {activeFilterCount > 0 ? <X size={11} onClick={(e) => { e.stopPropagation(); updateView({ statuses: [], priorities: [], assignees: [] }); }} /> : null}
                </>
              }
            >
              {() => (
                <div style={{ width: 420, padding: space.md, display: "grid", gap: space.md }}>
                  <div style={{ fontSize: tokenType.bodySmall.size, color: P.textMuted }}>
                    Quick filters
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {QUICK_FILTERS.map((preset) => {
                      const isActive = arraysEqual(view.statuses, preset.statuses);
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => updateView({ statuses: isActive ? [] : [...preset.statuses] })}
                          style={{
                            borderRadius: radius.full,
                            padding: `${2}px ${space.sm}px`,
                            border: `1px solid ${isActive ? color.accent : P.cardBorder}`,
                            background: isActive ? P.accentSoft : "transparent",
                            color: isActive ? color.accent : P.textSecondary,
                            fontSize: tokenType.caption.size,
                            cursor: "pointer",
                          }}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ borderTop: `1px solid ${P.cardBorder}`, paddingTop: space.md }}>
                    <div style={{ fontSize: tokenType.bodySmall.size, color: P.textMuted, marginBottom: 6 }}>Status</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {STATUS_ORDER.map((s) => (
                        <label key={s} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: tokenType.bodySmall.size, color: P.textSecondary, cursor: "pointer" }}>
                          <MiniCheckbox
                            checked={view.statuses.includes(s)}
                            onChange={() => updateView({ statuses: toggleIn(view.statuses, s) })}
                          />
                          <StatusCircle status={s} size={10} />
                          <span>{statusLabel(s)}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: tokenType.bodySmall.size, color: P.textMuted, marginBottom: 6 }}>Priority</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {PRIORITY_ORDER.map((p) => (
                        <label
                          key={p}
                          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: tokenType.bodySmall.size, color: P.textSecondary, cursor: "pointer" }}
                        >
                          <MiniCheckbox
                            checked={view.priorities.includes(p)}
                            onChange={() => updateView({ priorities: toggleIn(view.priorities, p) })}
                          />
                          <span style={{ color: priorityTheme[p].color, fontSize: 13, flexShrink: 0 }}>{priorityTheme[p].icon}</span>
                          <span style={{ color: P.textSecondary }}>{priorityTheme[p].label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: tokenType.bodySmall.size, color: P.textMuted, marginBottom: 6 }}>Assignee</div>
                    <div style={{ display: "grid", gap: 6, maxHeight: 140, overflow: "auto" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: tokenType.bodySmall.size, color: P.textSecondary, cursor: "pointer" }}>
                        <MiniCheckbox
                          checked={view.assignees.includes("__unassigned")}
                          onChange={() => updateView({ assignees: toggleIn(view.assignees, "__unassigned") })}
                        />
                        <span>Unassigned</span>
                      </label>
                      {agents.map((a) => {
                        const avatarSrc = a.avatar || getAgentByAnyId(a.id)?.avatar;
                        return (
                        <label
                          key={a.id}
                          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: tokenType.bodySmall.size, color: P.textSecondary, cursor: "pointer" }}
                        >
                          <MiniCheckbox
                            checked={view.assignees.includes(a.id)}
                            onChange={() => updateView({ assignees: toggleIn(view.assignees, a.id) })}
                          />
                          {avatarSrc ? (
                            <img src={avatarSrc} alt={a.name} style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                          ) : (
                            <span style={{ width: 18, height: 18, borderRadius: "50%", background: "rgba(255,255,255,0.06)", border: `1px solid ${P.cardBorder}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: P.textSecondary, flexShrink: 0 }}>
                              {a.name?.slice(0, 1).toUpperCase()}
                            </span>
                          )}
                          <span>{a.name}</span>
                        </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </SimplePopover>

            {view.viewMode === "list" && (
              <SimplePopover trigger={<><ArrowUpDown size={14} /> <span>Sort</span></>}>
                {() => (
                  <div style={{ width: 170, padding: "6px 0" }}>
                    {(["status", "priority", "title", "created", "updated"] as const).map((field) => (
                      <button
                        key={field}
                        type="button"
                        onClick={() => {
                          if (view.sortField === field) {
                            updateView({ sortField: field, sortDir: view.sortDir === "asc" ? "desc" : "asc" });
                          } else {
                            updateView({ sortField: field, sortDir: "asc" });
                          }
                        }}
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: space.sm,
                          border: "none",
                          padding: `${space.sm}px ${space.md}px`,
                          textAlign: "left",
                          cursor: "pointer",
                          background: "transparent",
                          color: view.sortField === field ? P.text : P.textSecondary,
                          fontSize: tokenType.bodySmall.size,
                          transition: "background-color 120ms",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = P.surfaceElevated;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span>{field[0].toUpperCase() + field.slice(1)}</span>
                        {view.sortField === field && (
                          <span style={{ color: P.accent, fontSize: tokenType.caption.size }}>{view.sortDir === "asc" ? "↑" : "↓"}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </SimplePopover>
            )}

            {view.viewMode === "list" && (
              <SimplePopover
                trigger={<><Layers size={14} /> <span>Group</span></>}
              >
                {() => (
                  <div style={{ width: 150, padding: "6px 0" }}>
                    {([
                      ["status", "Status"],
                      ["priority", "Priority"],
                      ["assignee", "Assignee"],
                      ["none", "None"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => updateView({ groupBy: value })}
                        style={{
                          width: "100%",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: space.sm,
                          border: "none",
                          padding: `${space.sm}px ${space.md}px`,
                          textAlign: "left",
                          cursor: "pointer",
                          background: "transparent",
                          color: view.groupBy === value ? P.text : P.textSecondary,
                          fontSize: tokenType.bodySmall.size,
                          transition: "background-color 120ms",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = P.surfaceElevated;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <span>{label}</span>
                        {view.groupBy === value && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                )}
              </SimplePopover>
            )}
          </div>
        </div>
      </div>

      {/* ── content ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {view.viewMode === "board" ? (
          <KanbanView
            tasks={filtered}
            companySlug={slug}
            projectSlug={projectSlug}
            agentLookup={agentLookup}
            activeTaskOwners={activeTaskOwners}
          />
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState
              icon={<List size={24} />}
              title="No tasks match this view"
              description="Try clearing filters or changing the search query."
            />
          </Card>
        ) : (
          grouped.map((group) => (
            <CollapsibleGroup
              key={group.key}
              label={group.label}
              count={group.items.length}
              collapsed={view.collapsedGroups.includes(group.key)}
              onToggle={() => updateView({
                collapsedGroups: view.collapsedGroups.includes(group.key)
                  ? view.collapsedGroups.filter((k) => k !== group.key)
                  : [...view.collapsedGroups, group.key],
              })}
              newTaskHref={newTaskHref}
            >
              {group.items.map((task, i) => {
                const assigneeAgent = task.assignee ? agentLookup.get((task.assignee ?? "").toLowerCase()) : undefined;
                return (
                  <IssueRow
                    key={task.id}
                    task={task}
                    companySlug={slug}
                    projectSlug={projectSlug}
                    assigneeAgent={assigneeAgent}
                    activeOwner={task.assignee ? undefined : activeTaskOwners.get(task.id)}
                  />
                );
              })}
            </CollapsibleGroup>
          ))
        )}
      </div>

      <CreateTaskModal
        open={createTaskOpen}
        onClose={() => setCreateTaskOpen(false)}
        onCreated={() => {
          setCreateTaskOpen(false);
          window.location.reload();
        }}
        companySlug={slug}
        companyCode={company.code}
        companyName={company.name}
      />
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
  if (!label) {
    return <div>{children}</div>;
  }

  return (
    <div style={{ marginBottom: space.lg }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: space.sm,
          padding: `${space.sm}px 0`,
          color: P.textSecondary,
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "none",
            background: "transparent",
            color: P.textSecondary,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <ChevronRight
            size={12}
            style={{
              transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 130ms ease",
            }}
          />
          {label}
          <span style={{ color: P.textMuted, marginLeft: 4, fontWeight: 400 }}>({count})</span>
        </button>

        <Link
          href={newTaskHref}
          style={{
            marginLeft: "auto",
            color: P.textMuted,
            display: "inline-flex",
            alignItems: "center",
          }}
        >
          <Plus size={12} />
        </Link>
      </div>

      {!collapsed && <div>{children}</div>}
    </div>
  );
}
