"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

import { CompanyErrorState } from "@/components/company/company-ui";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import {
  listCompanies,
  listCompanyAgents,
  listProjects,
  listTasks,
  updateTaskStatus,
  updateTask,
  updateTaskAssignee,
  archiveTask,
} from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  TaskPriority,
  TaskStatus,
} from "@/lib/orchestration/types";

import { TasksToolbar } from "@/components/tasks/TasksToolbar";
import { TaskListView } from "@/components/tasks/TaskListView";
import { TaskBoardView } from "@/components/tasks/TaskBoardView";
import { TaskTableView } from "@/components/tasks/TaskTableView";
import { TaskContextMenu } from "@/components/tasks/TaskContextMenu";
import { useTaskKeyboard } from "@/components/tasks/useTaskKeyboard";
import {
  type ViewMode,
  type GroupMode,
  type SortField,
  type TaskFilters,
  type TaskSort,
  type TaskRow,
  type TaskGroup,
  type InlineEditCallbacks,
  SURFACE,
  STATUS_ORDER,
  STATUS_LABEL,
  PRI_WEIGHT,
  getTaskIdentifier
} from "@/components/tasks/types";

const STATUS_WEIGHT: Record<TaskStatus, number> = {
  "in-progress": 0, "on-deck": 1, review: 2, blocked: 3, backlog: 4, done: 5, cancelled: 6,
};

export default function CompanyTasksPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const { activeProject } = useActiveProjectState();
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [filters, setFilters] = useState<TaskFilters>({ status: "all", priority: "all", assignee: "all", type: "all", query: "" });
  const [sort, setSort] = useState<TaskSort>({ field: "updated", dir: "desc" });
  const [groupMode, setGroupMode] = useState<GroupMode>("status");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const [ctxTask, setCtxTask] = useState<TaskRow | null>(null);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });

  const searchRef = useRef<HTMLInputElement>(null);

  const activeProjectRecord = useMemo(() => {
    const qp = searchParams.get("projectId") ?? searchParams.get("project");
    if (qp) {
      return projects.find((p) => p.id === qp || p.slug === qp) ?? resolveActiveProject(projects, activeProject, slug);
    }
    return resolveActiveProject(projects, activeProject, slug);
  }, [activeProject, projects, searchParams, slug]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [companyRows, projectRows, taskRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          listTasks({ company: slug, includeNonProduction: true, sort: "updated-desc" }),
        ]);
        const current = companyRows.find((r) => r.slug === slug) ?? null;
        if (cancelled) return;
        setCompany(current);
        if (!current) { setProjects([]); setTasks([]); setAgents([]); return; }

        const pMap = new Map(projectRows.map((p) => [p.id, p] as const));
        const rows: TaskRow[] = taskRows.filter((t) => pMap.has(t.project)).map((t) => {
          const p = pMap.get(t.project)!;
          return { ...t, projectId: p.id, projectSlug: p.slug, projectName: p.name };
        });

        const agentRows = await listCompanyAgents(current.slug);
        if (cancelled) return;
        setProjects(projectRows);
        setTasks(rows);
        setAgents(agentRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const agentMap = useMemo(() => {
    const m = new Map<string, OrchestrationAgent>();
    for (const a of agents) { m.set(a.id.toLowerCase(), a); m.set(a.name.toLowerCase(), a); }
    return m;
  }, [agents]);

  const filtered = useMemo(() => {
    const lq = filters.query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filters.status !== "all" && t.status !== filters.status) return false;
      if (filters.priority !== "all" && t.priority !== filters.priority) return false;
      if (filters.assignee !== "all" && (t.assignee ?? "") !== filters.assignee) return false;
      if (filters.type !== "all" && t.type !== filters.type) return false;
      if (activeProjectRecord && t.projectId !== activeProjectRecord.id) return false;
      if (!lq) return true;
      return `${t.title} ${t.description ?? ""} ${t.assignee ?? ""} ${t.projectName}`.toLowerCase().includes(lq);
    }).sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      switch (sort.field) {
        case "priority": return dir * (PRI_WEIGHT[a.priority] - PRI_WEIGHT[b.priority]);
        case "created": return dir * (new Date(a.created).getTime() - new Date(b.created).getTime());
        case "title": return dir * a.title.localeCompare(b.title);
        case "status": return dir * (STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status]);
        case "id": return dir * getTaskIdentifier(a).localeCompare(getTaskIdentifier(b));
        case "assignee": return dir * (a.assignee ?? "").localeCompare(b.assignee ?? "");
        case "project": return dir * a.projectName.localeCompare(b.projectName);
        default: return -1 * (new Date(a.updated).getTime() - new Date(b.updated).getTime());
      }
    });
  }, [tasks, filters, activeProjectRecord, sort]);

  const grouped = useMemo<TaskGroup[]>(() => {
    if (groupMode === "none") return [{ key: "all", label: null, items: filtered }];
    const groups = new Map<string, TaskRow[]>();
    for (const t of filtered) {
      let key: string;
      if (groupMode === "status") key = t.status;
      else if (groupMode === "priority") key = t.priority;
      else if (groupMode === "assignee") key = t.assignee || "Unassigned";
      else key = t.projectName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    if (groupMode === "status") {
      return STATUS_ORDER.filter((s) => groups.has(s)).map((s) => ({ key: s, label: STATUS_LABEL[s], items: groups.get(s)! }));
    }
    return Array.from(groups.entries()).map(([k, items]) => ({ key: k, label: k, items }));
  }, [filtered, groupMode]);

  const flatTasks = useMemo(() => grouped.flatMap((g) => g.items.filter((t) => !t.parentTaskId)), [grouped]);

  const handleStatusChange = useCallback(async (taskId: string, status: TaskStatus) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status, updated: new Date().toISOString() } : t));
    await updateTaskStatus(taskId, status);
  }, []);

  const handlePriorityChange = useCallback(async (taskId: string, priority: TaskPriority) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, priority, updated: new Date().toISOString() } : t));
    await updateTask({ taskId, priority });
  }, []);

  const handleAssigneeChange = useCallback(async (taskId: string, assignee: string) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, assignee: assignee || undefined, updated: new Date().toISOString() } : t));
    await updateTaskAssignee(taskId, assignee);
  }, []);

  const handleArchive = useCallback(async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await archiveTask(taskId);
  }, []);

  const callbacks: InlineEditCallbacks = useMemo(() => ({
    onStatusChange: handleStatusChange,
    onPriorityChange: handlePriorityChange,
    onAssigneeChange: handleAssigneeChange,
  }), [handleStatusChange, handlePriorityChange, handleAssigneeChange]);

  const openContextMenu = useCallback((e: React.MouseEvent, task: TaskRow) => {
    e.preventDefault();
    setCtxTask(task);
    setCtxPos({ x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 300) });
  }, []);

  const closeContextMenu = useCallback(() => setCtxTask(null), []);

  const handleTableSort = useCallback((field: SortField) => {
    setSort((prev) => ({
      field,
      dir: prev.field === field && prev.dir === "asc" ? "desc" : "asc",
    }));
  }, []);

  const companyCode = company?.code ?? slug.slice(0, 3).toUpperCase();

  useTaskKeyboard({
    taskCount: flatTasks.length,
    selectedIndex,
    setSelectedIndex,
    onOpenTask: (i) => {
      const t = flatTasks[i];
      if (t) window.location.href = `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(getTaskIdentifier(t))}`;
    },
    onOpenCreate: () => setCreateOpen(true),
    focusSearch: () => searchRef.current?.focus(),
    viewMode,
    setViewMode,
    enabled: !createOpen && !ctxTask,
  });

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved." href="/" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: SURFACE.page }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* Page header */}
      <div style={{ padding: "24px 24px 0" }}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", fontWeight: 600, color: "#737373", marginBottom: 16 }}>
          Tasks
        </p>
      </div>

      <TasksToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        groupMode={groupMode}
        onGroupModeChange={setGroupMode}
        taskCount={filtered.length}
        agents={agents}
        onNewTask={() => setCreateOpen(true)}
        searchRef={searchRef}
      />

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "48px 16px", textAlign: "center", fontSize: "12px", color: SURFACE.textGhost }}>Loading tasks…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", fontSize: "12px", color: SURFACE.textGhost }}>No tasks match filters.</div>
        ) : viewMode === "list" ? (
          <TaskListView
            groups={grouped}
            groupMode={groupMode}
            agents={agents}
            agentMap={agentMap}
            callbacks={callbacks}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            buildHref={(t) => `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(getTaskIdentifier(t))}`}
            onContextMenu={openContextMenu}
            flatTasks={flatTasks}
          />
        ) : viewMode === "board" ? (
          <TaskBoardView
            tasks={filtered}
            agents={agents}
            agentMap={agentMap}
            callbacks={callbacks}
            buildHref={(t) => `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(getTaskIdentifier(t))}`}
            onContextMenu={openContextMenu}
          />
        ) : (
          <TaskTableView
            tasks={filtered}
            agents={agents}
            agentMap={agentMap}
            companyCode={companyCode}
            selectedIndex={selectedIndex}
            sortField={sort.field}
            sortDir={sort.dir}
            onSortChange={handleTableSort}
            onContextMenu={openContextMenu}
            callbacks={callbacks}
          />
        )}
      </div>

      {ctxTask && (
        <TaskContextMenu
          task={ctxTask}
          x={ctxPos.x}
          y={ctxPos.y}
          agents={agents}
          callbacks={callbacks}
          onArchive={handleArchive}
          onClose={closeContextMenu}
          href={`/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(getTaskIdentifier(ctxTask))}`}
        />
      )}

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { window.location.reload(); }}
        companySlug={slug}
        companyCode={companyCode}
      />
    </div>
  );
}
