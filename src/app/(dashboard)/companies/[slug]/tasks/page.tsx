"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";

import { ListChecks, Plus } from "lucide-react";
import { CompanyErrorState } from "@/components/company/company-ui";
import { CreateTaskModal } from "@/components/orchestration/CreateTaskModal";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import {
  listCompanies,
  listCompanyAgents,
  listProjects,
  listTasks,
  updateTaskStatusDetailed,
  updateTask,
  updateTaskAssignee,
  archiveTask,
  listAvailableModels,
  switchAgentModel,
} from "@/lib/orchestration/client";
import type { AvailableModel } from "@/lib/orchestration/available-models";
import { resolveAgentModelDisplay } from "@/lib/orchestration/agent-model-display";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  TaskExecutionEngine,
  TaskModelLane,
  TaskPriority,
  TaskStatus,
} from "@/lib/orchestration/types";

import { TasksToolbar } from "@/components/tasks/TasksToolbar";
import { TaskListView } from "@/components/tasks/TaskListView";
import { TaskRow as TaskRowComponent } from "@/components/tasks/TaskRow";
import { TaskBoardView } from "@/components/tasks/TaskBoardView";
import type { TaskModelQuickOption } from "@/components/tasks/TaskCard";
import type { TaskBoardDropTarget } from "@/components/tasks/useTaskDragDrop";
import { TaskTableView } from "@/components/tasks/TaskTableView";
import { TaskContextMenu } from "@/components/tasks/TaskContextMenu";
import { TaskQuickViewModal } from "@/components/tasks/TaskQuickViewModal";
import { SprintGroupedList } from "@/components/goals/SprintGroupedList";
import { useTaskKeyboard } from "@/components/tasks/useTaskKeyboard";
import { useLiveRuns } from "@/hooks/useLiveRuns";
import {
  type ViewMode,
  type GroupMode,
  type SortField,
  type TaskFilters,
  type TaskSort,
  type TaskRow,
  type TaskGroup,
  type InlineEditCallbacks,
  BOARD_COLUMNS,
  UNASSIGNED_PROJECT_FILTER_ID,
  PRI_WEIGHT,
  getTaskIdentifier,
  getActiveRunLabel
} from "@/components/tasks/types";
import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";
import { isRunLive } from "@/lib/orchestration/live-status";
import { groupBySprint, groupTasksFlat, type GroupableItem } from "@/lib/orchestration/groupBySprint";
import { PageHeader } from "@/lib/ui/primitives";
import { font, P, radius, space, type as tokenType } from "@/lib/ui/tokens";

const STATUS_WEIGHT: Record<TaskStatus, number> = {
  backlog: 0, "to-do": 1, "in-progress": 2, review: 3, done: 4, blocked: 5, cancelled: 6,
};

type SprintGroupedTask = TaskRow & GroupableItem;

function statusChangeErrorMessage(errorCode?: string) {
  if (errorCode === "assignee_required") {
    return "Assign the task before moving it to In Progress.";
  }
  if (errorCode === "review_notes_required") {
    return "Add review notes before moving this task to Done.";
  }
  return "Could not save the status change.";
}

function switchProviderForAvailableModel(provider: AvailableModel["runtimeProvider"]): string | null {
  if (provider === "openai") return "codex";
  if (provider === "google") return "gemini";
  if (provider === "openrouter") return null;
  return provider;
}

export default function CompanyTasksPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const tasksStorageKey = `mc:tasks:prefs:${slug}`;
  const [prefsHydrated, setPrefsHydrated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("board");
  const [filters, setFilters] = useState<TaskFilters>({ status: [], priority: [], assignee: [], type: "all", query: "" });
  const [sort, setSort] = useState<TaskSort>({ field: "updated", dir: "desc" });
  const [groupMode, setGroupMode] = useState<GroupMode>("status");
  const [boardStatuses, setBoardStatuses] = useState<TaskStatus[]>(BOARD_COLUMNS);
  const [boardProjectIds, setBoardProjectIds] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickViewTask, setQuickViewTask] = useState<TaskRow | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    setPrefsHydrated(false);
    try {
      const raw = window.localStorage.getItem(tasksStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{
          viewMode: ViewMode;
          sort: TaskSort;
          groupMode: GroupMode;
          boardStatuses: TaskStatus[];
          boardProjectIds: string[];
        }>;
        if (parsed.sort && ["id", "title", "priority", "status", "assignee", "project", "updated", "created"].includes(parsed.sort.field)) {
          setSort({
            field: parsed.sort.field,
            dir: parsed.sort.dir === "asc" ? "asc" : "desc",
          });
        }
        if (Array.isArray(parsed.boardStatuses)) {
          const next = BOARD_COLUMNS.filter((status) => parsed.boardStatuses?.includes(status));
          if (next.length > 0) setBoardStatuses(next);
        }
        if (Array.isArray(parsed.boardProjectIds)) {
          setBoardProjectIds(parsed.boardProjectIds.filter((id) => typeof id === "string"));
        }
      }
    } catch {}
    setPrefsHydrated(true);
  }, [slug, tasksStorageKey]);

  useEffect(() => {
    const viewParam = searchParams.get("view");
    const groupParam = searchParams.get("group");
    if (viewParam === "list" || viewParam === "board" || viewParam === "table") {
      setViewMode(viewParam);
    } else {
      setViewMode("board");
    }
    if (groupParam === "none" || groupParam === "status" || groupParam === "priority" || groupParam === "assignee" || groupParam === "sprint" || groupParam === "company-goal") {
      setGroupMode(groupParam);
    } else {
      setGroupMode("status");
    }
  }, [searchParams]);

  const handleViewModeChange = useCallback((nextMode: ViewMode) => {
    setViewMode(nextMode);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextMode === "board") {
      nextParams.delete("view");
    } else {
      nextParams.set("view", nextMode);
    }
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!prefsHydrated) return;
    try { localStorage.setItem(tasksStorageKey, JSON.stringify({ viewMode, sort, groupMode, boardStatuses, boardProjectIds })); } catch {}
    try { localStorage.setItem(`hr:tasks:group:${company?.code ?? slug}`, groupMode); } catch {}
  }, [prefsHydrated, viewMode, sort, groupMode, boardStatuses, boardProjectIds, tasksStorageKey, company?.code, slug]);

  const handleGroupModeChange = useCallback((nextMode: GroupMode) => {
    setGroupMode(nextMode);
    const nextParams = new URLSearchParams(searchParams.toString());
    if (nextMode === "status") {
      nextParams.delete("group");
    } else {
      nextParams.set("group", nextMode);
    }
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const [ctxTask, setCtxTask] = useState<TaskRow | null>(null);
  const [ctxPos, setCtxPos] = useState({ x: 0, y: 0 });

  const searchRef = useRef<HTMLInputElement>(null);
  const hasLoadedTasksRef = useRef(false);
  const loadedSlugRef = useRef<string | null>(null);

  const explicitProjectScope = searchParams.get("projectId") ?? searchParams.get("project");

  const activeProjectRecord = useMemo(() => {
    if (!explicitProjectScope) return null;
    return projects.find((project) => project.id === explicitProjectScope || project.slug === explicitProjectScope) ?? null;
  }, [explicitProjectScope, projects]);

  const clearProjectScope = useCallback(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("projectId");
    nextParams.delete("project");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router, searchParams]);

  useEffect(() => {
    let cancelled = false;
    if (loadedSlugRef.current !== slug) {
      loadedSlugRef.current = slug;
      hasLoadedTasksRef.current = false;
    }
    const shouldShowLoading = !hasLoadedTasksRef.current;
    const load = async () => {
      if (shouldShowLoading) setLoading(true);
      setLoadError(null);
      try {
        const companyRows = await listCompanies();
        const slugKey = slug.toLowerCase();
        const current = companyRows.find((r) => r.slug.toLowerCase() === slugKey || r.code.toLowerCase() === slugKey) ?? null;
        if (cancelled) return;
        setCompany(current);
        if (!current) { setProjects([]); setTasks([]); setAgents([]); return; }

        const [projectRows, taskRows, agentRows] = await Promise.all([
          listProjects({ company: current.slug }),
          listTasks({ company: current.slug, includeNonProduction: true, sort: "updated-desc" }),
          listCompanyAgents(current.slug),
        ]);
        if (cancelled) return;

        const pMap = new Map(projectRows.map((p) => [p.id, p] as const));
        const rows: TaskRow[] = taskRows.map((t) => {
          const p = pMap.get(t.project);
          return {
            ...t,
            projectId: p?.id ?? "",
            projectSlug: p?.slug ?? "",
            projectName: p?.name ?? "No project",
          };
        });

        setProjects(projectRows);
        setTasks(rows);
        setAgents(agentRows);
        hasLoadedTasksRef.current = true;
      } catch {
        if (!cancelled) {
          setCompany(null);
          setProjects([]);
          setTasks([]);
          setAgents([]);
          setLoadError("Unable to load tasks for this company.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, refreshNonce]);

  useEffect(() => {
    let cancelled = false;
    void listAvailableModels({ includeInactive: false })
      .then((models) => {
        if (!cancelled) setAvailableModels(models);
      })
      .catch((error) => {
        console.warn("Could not load available models for task board", error);
      });
    return () => { cancelled = true; };
  }, []);

  const agentMap = useMemo(() => {
    const m = new Map<string, OrchestrationAgent>();
    for (const a of agents) { m.set(a.id.toLowerCase(), a); m.set(a.name.toLowerCase(), a); }
    return m;
  }, [agents]);

  const activeCompanySlug = company?.slug ?? slug;
  const liveRefreshTimerRef = useRef<number | null>(null);

  const scheduleTaskRefresh = useCallback((delayMs = 350) => {
    if (liveRefreshTimerRef.current) window.clearTimeout(liveRefreshTimerRef.current);
    liveRefreshTimerRef.current = window.setTimeout(() => {
      liveRefreshTimerRef.current = null;
      setRefreshNonce((nonce) => nonce + 1);
    }, delayMs);
  }, []);

  const modelOptions = useMemo<TaskModelQuickOption[]>(() => (
    availableModels.flatMap((model) => {
      const targetProvider = switchProviderForAvailableModel(model.runtimeProvider);
      if (!targetProvider) return [];
      const display = resolveAgentModelDisplay({
        provider: targetProvider,
        model: model.id,
      });
      return {
        id: model.id,
        model: model.id,
        targetProvider,
        label: display?.displayModel ?? model.displayName,
        providerLabel: display?.providerLabel ?? model.runtimeProvider,
        color: display?.color ?? "var(--text-secondary)",
        background: display?.background ?? "var(--surface-hover)",
        border: display?.border ?? "var(--border)",
      };
    })
  ), [availableModels]);

  const handleAgentModelChange = useCallback(async (agent: OrchestrationAgent, option: TaskModelQuickOption) => {
    const result = await switchAgentModel(agent.id, {
      targetProvider: option.targetProvider,
      targetModel: option.model,
    });
    if (!result.switched) {
      setMutationError(result.message || "The agent model change was refused.");
      return;
    }
    setMutationError(null);
    setAgents((current) => current.map((candidate) => (
      candidate.id === agent.id
        ? { ...candidate, model: option.model, adapterType: option.targetProvider }
        : candidate
    )));
    scheduleTaskRefresh(250);
  }, [scheduleTaskRefresh]);

  const handleLiveEvent = useCallback((event: StreamEvent) => {
    // A stream handshake is connection state, not task data. Refreshing on every
    // reconnect makes the board look like it reloads on the SSE retry cadence.
    if (event.type === "connected") return;
    if (event.type === "execution_run_terminated") {
      scheduleTaskRefresh(0);
      return;
    }
    if (event.type !== "activity" && event.type !== "comment") return;
    if (event.eventType === "task.archived" && event.taskId) {
      setTasks((current) => current.filter((task) => task.id !== event.taskId));
      if (quickViewTask?.id === event.taskId) setQuickViewTask(null);
      if (ctxTask?.id === event.taskId) setCtxTask(null);
      return;
    }
    scheduleTaskRefresh();
  }, [ctxTask?.id, quickViewTask?.id, scheduleTaskRefresh]);

  useEventStream({
    companySlug: activeCompanySlug,
    enabled: Boolean(activeCompanySlug),
    onEvent: handleLiveEvent,
  });

  useEffect(() => () => {
    if (liveRefreshTimerRef.current) window.clearTimeout(liveRefreshTimerRef.current);
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") scheduleTaskRefresh(0);
    };
    const refreshOnFocus = () => scheduleTaskRefresh(0);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [scheduleTaskRefresh]);

  const { runsByAgentId, transitions } = useLiveRuns({
    companySlug: activeCompanySlug,
    enabled: Boolean(company),
  });

  useEffect(() => {
    if (transitions.length > 0) scheduleTaskRefresh(0);
  }, [scheduleTaskRefresh, transitions]);

  const activeRunsByTaskId = useMemo(() => {
    const map = new Map<string, { agentName: string; status: string; startedAt: string | null; finishedAt: string | null; runnerProvider?: string | null; runnerModel?: string | null }>();
    for (const run of runsByAgentId.values()) {
      if (!run.taskId || !isRunLive(run)) continue;
      map.set(run.taskId, {
        agentName: run.agentName,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        runnerProvider: run.runnerProvider,
        runnerModel: run.runnerModel,
      });
    }
    return map;
  }, [runsByAgentId]);

  const visibleBoardProjectIds = useMemo(() => {
    const allBoardProjectIds = [...projects.map((project) => project.id), UNASSIGNED_PROJECT_FILTER_ID];
    if (boardProjectIds.length === 0) return allBoardProjectIds;
    const validProjectIds = new Set(projects.map((project) => project.id));
    return boardProjectIds.filter((projectId) => (
      projectId === UNASSIGNED_PROJECT_FILTER_ID || validProjectIds.has(projectId)
    ));
  }, [boardProjectIds, projects]);

  const filtered = useMemo(() => {
    const lq = filters.query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (boardStatuses.length > 0 && boardStatuses.length !== BOARD_COLUMNS.length && !boardStatuses.includes(t.status)) return false;
      if (filters.status.length > 0 && !filters.status.includes(t.status)) return false;
      if (filters.priority.length > 0 && !filters.priority.includes(t.priority)) return false;
      if (filters.assignee.length > 0 && !filters.assignee.includes(t.assignee ?? "")) return false;
      if (filters.type !== "all" && t.type !== filters.type) return false;
      if (activeProjectRecord && t.projectId !== activeProjectRecord.id) return false;
      if (!activeProjectRecord && visibleBoardProjectIds.length > 0) {
        const taskProjectFilterId = t.projectId || UNASSIGNED_PROJECT_FILTER_ID;
        if (!visibleBoardProjectIds.includes(taskProjectFilterId)) return false;
      }
      if (!lq) return true;
      return `${t.key ?? ""} ${t.id} ${t.title} ${t.description ?? ""} ${t.assignee ?? ""} ${t.projectName}`.toLowerCase().includes(lq);
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
  }, [tasks, filters, activeProjectRecord, sort, boardStatuses, visibleBoardProjectIds]);

  const noProjectBucketId = useMemo(() => {
    return tasks.find((task) => !task.projectId && task.project)?.project ?? "";
  }, [tasks]);

  const grouped = useMemo<TaskGroup[]>(() => {
    if (groupMode === "sprint" || groupMode === "company-goal") return [{ key: "all", label: null, items: filtered }];
    if (groupMode === "none") return [{ key: "all", label: null, items: filtered }];
    return groupTasksFlat(filtered, groupMode).map((group) => ({
      key: group.id,
      label: group.label,
      items: group.items,
    }));
  }, [filtered, groupMode]);

  const sprintGroupedTasks = useMemo(() => {
    const items: SprintGroupedTask[] = filtered.map((task) => ({
      ...task,
      updatedAt: task.updated,
      sprintId: task.sprintId,
      sprintKey: task.sprintKey,
      sprintName: task.sprintName ?? task.sprint,
      sprintStatus: task.sprintStatus,
      companyGoalId: task.companyGoalId,
      companyGoalKey: task.companyGoalKey,
      companyGoalName: task.companyGoalName,
      companyGoalStatus: task.companyGoalStatus,
    }));
    return groupBySprint(items, groupMode === "company-goal" ? "company-goal" : "sprint");
  }, [filtered, groupMode]);

  const flatTasks = useMemo(() => grouped.flatMap((g) => g.items.filter((t) => !t.parentTaskId)), [grouped]);

  const handleStatusChange = useCallback(async (taskId: string, status: TaskStatus) => {
    const previousTask = tasks.find((t) => t.id === taskId) ?? null;
    setMutationError(null);
    setTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t;
      return { ...t, status, updated: new Date().toISOString() };
    }));

    const saved = await updateTaskStatusDetailed(
      taskId,
      status,
      undefined,
      previousTask?.status === "review" && status === "done"
        ? { reviewNotes: "Marked done from task list." }
        : undefined
    );

    if (!saved.ok) {
      if (previousTask) {
        setTasks((prev) => prev.map((t) => t.id === taskId ? previousTask : t));
      }
      setMutationError(statusChangeErrorMessage(saved.errorCode));
    }
  }, [tasks]);

  const handlePriorityChange = useCallback(async (taskId: string, priority: TaskPriority) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, priority, updated: new Date().toISOString() } : t));
    await updateTask({ taskId, priority });
  }, []);

  const handleAssigneeChange = useCallback(async (taskId: string, assignee: string) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, assignee: assignee || undefined, updated: new Date().toISOString() } : t));
    await updateTaskAssignee(taskId, assignee);
  }, []);

  const handleBoardGroupDrop = useCallback(async (taskId: string, target: TaskBoardDropTarget) => {
    const previousTask = tasks.find((t) => t.id === taskId) ?? null;
    if (!previousTask) return;

    if (target.mode === "status") {
      if (previousTask.status === target.status) return;
      await handleStatusChange(taskId, target.status);
      return;
    }

    const now = new Date().toISOString();
    setMutationError(null);

    if (target.mode === "priority") {
      if (previousTask.priority === target.priority) return;
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, priority: target.priority, updated: now } : t));
      const saved = await updateTask({ taskId, priority: target.priority });
      if (!saved) {
        setTasks((prev) => prev.map((t) => t.id === taskId ? previousTask : t));
        setMutationError("Could not save the priority change.");
      }
      return;
    }

    if (target.mode === "assignee") {
      const nextAssignee = target.assignee?.trim() || null;
      if ((previousTask.assignee ?? null) === nextAssignee) return;
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, assignee: nextAssignee ?? undefined, updated: now } : t));
      const saved = await updateTaskAssignee(taskId, nextAssignee);
      if (!saved) {
        setTasks((prev) => prev.map((t) => t.id === taskId ? previousTask : t));
        setMutationError("Could not save the assignee change.");
      }
      return;
    }

    if (target.mode === "sprint") {
      if ((previousTask.sprintId ?? null) === (target.sprintId ?? null)) return;
      const project = target.projectId ? projects.find((item) => item.id === target.projectId) : null;
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          ...(target.sprintId && target.projectId
            ? {
                project: target.projectId,
                projectId: target.projectId,
                projectSlug: project?.slug ?? t.projectSlug,
                projectName: target.projectName ?? project?.name ?? t.projectName,
              }
            : {}),
          sprint: target.sprintName ?? undefined,
          sprintId: target.sprintId ?? undefined,
          sprintName: target.sprintName ?? undefined,
          sprintStatus: target.sprintStatus ?? undefined,
          companyGoalId: target.companyGoalId ?? undefined,
          companyGoalName: target.companyGoalName ?? undefined,
          companyGoalStatus: target.companyGoalStatus ?? undefined,
          updated: now,
        };
      }));
      const saved = await updateTask({
        taskId,
        sprintId: target.sprintId,
        ...(target.sprintId && target.projectId ? { projectId: target.projectId } : {}),
      });
      if (!saved) {
        setTasks((prev) => prev.map((t) => t.id === taskId ? previousTask : t));
        setMutationError("Could not save the sprint change.");
      }
    }
  }, [handleStatusChange, projects, tasks]);

  const handleProjectChange = useCallback(async (taskId: string, projectId: string | null) => {
    const previousTask = tasks.find((t) => t.id === taskId) ?? null;
    const resolvedProjectId = projectId ?? (noProjectBucketId || null);
    const project = resolvedProjectId ? projects.find((item) => item.id === resolvedProjectId) : null;
    const isNoProject = Boolean(resolvedProjectId && resolvedProjectId === noProjectBucketId && !project);
    const now = new Date().toISOString();
    setMutationError(null);
    setTasks((prev) => prev.map((t) => t.id === taskId ? {
      ...t,
      project: resolvedProjectId ?? "",
      projectId: project?.id ?? "",
      projectSlug: project?.slug ?? "",
      projectName: isNoProject || !project ? "No project" : project.name,
      updated: now,
    } : t));
    const saved = await updateTask({ taskId, projectId: resolvedProjectId });
    if (!saved) {
      if (previousTask) setTasks((prev) => prev.map((t) => t.id === taskId ? previousTask : t));
      setMutationError("Could not save the project change.");
    }
  }, [noProjectBucketId, projects, tasks]);

  const handleTagsChange = useCallback(async (taskId: string, tags: string[]) => {
    const previousTask = tasks.find((t) => t.id === taskId) ?? null;
    const nextTags = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
    setMutationError(null);
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, tags: nextTags, updated: new Date().toISOString() } : t));
    const saved = await updateTask({ taskId, labels: nextTags });
    if (!saved) {
      if (previousTask) setTasks((prev) => prev.map((t) => t.id === taskId ? previousTask : t));
      setMutationError("Could not save tag changes.");
    }
  }, [tasks]);

  const handleExecutionEngineChange = useCallback(async (taskId: string, executionEngine: TaskExecutionEngine | null) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? {
      ...t,
      executionEngine: executionEngine ?? t.executionEngine,
      executionEngineOverride: executionEngine,
      executionEngineSource: executionEngine ? "task" : t.executionEngineSource,
      updated: new Date().toISOString(),
    } : t));
    const saved = await updateTask({ taskId, executionEngine });
    if (saved) setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...saved } : t));
  }, []);

  const handleModelLaneChange = useCallback(async (taskId: string, modelLane: TaskModelLane) => {
    setTasks((prev) => prev.map((t) => t.id === taskId ? {
      ...t,
      modelLane,
      updated: new Date().toISOString(),
    } : t));
    const saved = await updateTask({ taskId, modelLane });
    if (saved) setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, ...saved } : t));
  }, []);

  const handleArchive = useCallback(async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await archiveTask(taskId);
  }, []);

  const callbacks: InlineEditCallbacks = useMemo(() => ({
    onStatusChange: handleStatusChange,
    onPriorityChange: handlePriorityChange,
    onAssigneeChange: handleAssigneeChange,
    onProjectChange: handleProjectChange,
    onTagsChange: handleTagsChange,
    onExecutionEngineChange: handleExecutionEngineChange,
    onModelLaneChange: handleModelLaneChange,
  }), [handleStatusChange, handlePriorityChange, handleAssigneeChange, handleProjectChange, handleTagsChange, handleExecutionEngineChange, handleModelLaneChange]);

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
  const taskHref = useCallback((task: TaskRow) => (
    `/${encodeURIComponent(companyCode.toUpperCase())}/tasks/${encodeURIComponent(getTaskIdentifier(task))}`
  ), [companyCode]);
  const activeQuickViewTask = useMemo(
    () => quickViewTask ? tasks.find((task) => task.id === quickViewTask.id) ?? quickViewTask : null,
    [quickViewTask, tasks]
  );

  useTaskKeyboard({
    taskCount: flatTasks.length,
    selectedIndex,
    setSelectedIndex,
    onOpenTask: (i) => {
      const t = flatTasks[i];
      if (!t) return;
      if (viewMode === "board") setQuickViewTask(t);
      else window.location.href = taskHref(t);
    },
    onOpenCreate: () => setCreateOpen(true),
    focusSearch: () => searchRef.current?.focus(),
    viewMode,
    setViewMode,
    enabled: !createOpen && !ctxTask && !quickViewTask,
  });

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail={loadError ?? "This company could not be resolved."} href="/" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: P.text, fontFamily: font.body }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {activeProjectRecord ? (
        <div style={{ padding: "24px 24px 0" }}>
          <ActiveProjectBanner
            companySlug={slug}
            companyCode={companyCode}
            project={activeProjectRecord}
            compact
            onClear={clearProjectScope}
          />
        </div>
      ) : null}

      {/* Page header */}
      <div style={{ padding: activeProjectRecord ? `4px ${space.xl}px 0` : `${space.md}px ${space.xl}px 0` }}>
        <PageHeader
          icon={<ListChecks size={14} style={{ color: P.textSecondary }} />}
          title="Tasks"
          actions={
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
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
      </div>

      <TasksToolbar
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        groupMode={groupMode}
        onGroupModeChange={handleGroupModeChange}
        boardStatuses={boardStatuses}
        onBoardStatusesChange={setBoardStatuses}
        boardProjectIds={boardProjectIds}
        onBoardProjectIdsChange={setBoardProjectIds}
        agents={agents}
        projects={projects}
        searchRef={searchRef}
      />

      {mutationError && (
        <div
          style={{
            margin: `0 ${space.xl}px ${space.sm}px`,
            padding: `${space.sm}px ${space.md}px`,
            borderRadius: radius.md,
            border: "0.5px solid rgba(239,68,68,0.35)",
            background: "rgba(127,29,29,0.18)",
            color: "#fca5a5",
            fontSize: tokenType.bodySmall.size,
          }}
        >
          {mutationError}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden" }}>
        {loading ? (
          <div style={{ padding: "48px 16px", textAlign: "center", fontSize: tokenType.bodySmall.size, color: P.textMuted }}>Loading tasks…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", fontSize: tokenType.bodySmall.size, color: P.textMuted }}>No tasks match filters.</div>
        ) : viewMode !== "board" && (groupMode === "sprint" || groupMode === "company-goal") ? (
          <TaskSprintGroupedView
            grouped={sprintGroupedTasks}
            mode={groupMode}
            companyCode={companyCode}
            agents={agents}
            agentMap={agentMap}
            callbacks={callbacks}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            buildHref={taskHref}
            onContextMenu={openContextMenu}
          />
        ) : viewMode === "list" || (viewMode === "table" && groupMode !== "none") ? (
          <TaskListView
            groups={grouped}
            agents={agents}
            agentMap={agentMap}
            callbacks={callbacks}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            buildHref={taskHref}
            onContextMenu={openContextMenu}
          />
        ) : viewMode === "board" ? (
          <TaskBoardView
            tasks={filtered}
            agentMap={agentMap}
            onContextMenu={openContextMenu}
            onOpenTask={setQuickViewTask}
            visibleStatuses={boardStatuses}
            groupMode={groupMode}
            onBoardGroupDrop={handleBoardGroupDrop}
            activeRunsByTaskId={activeRunsByTaskId}
            modelOptions={modelOptions}
            onAgentModelChange={handleAgentModelChange}
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

      <TaskQuickViewModal
        task={activeQuickViewTask}
        agents={agents}
        projects={projects}
        noProjectId={noProjectBucketId}
        href={activeQuickViewTask ? taskHref(activeQuickViewTask) : ""}
        callbacks={callbacks}
        onClose={() => setQuickViewTask(null)}
        companySlug={slug}
      />

      <CreateTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          scheduleTaskRefresh(0);
        }}
        companySlug={slug}
        companyCode={companyCode}
        companyName={company?.name ?? companyCode}
      />
    </div>
  );
}

function TaskSprintGroupedView({
  grouped,
  mode,
  companyCode,
  agents,
  agentMap,
  callbacks,
  selectedIndex,
  onSelect,
  buildHref,
  onContextMenu,
}: {
  grouped: ReturnType<typeof groupBySprint<SprintGroupedTask>>;
  mode: "sprint" | "company-goal";
  companyCode: string;
  agents: OrchestrationAgent[];
  agentMap: Map<string, OrchestrationAgent>;
  callbacks: InlineEditCallbacks;
  selectedIndex: number;
  onSelect: (index: number) => void;
  buildHref: (task: TaskRow) => string;
  onContextMenu: (event: ReactMouseEvent, task: TaskRow) => void;
}) {
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  const allItems = useMemo(
    () => [
      ...grouped.groups.flatMap((goal) => goal.sprints.flatMap((sprint) => sprint.items)),
      ...grouped.unassigned,
    ],
    [grouped]
  );
  const childrenMap = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const task of allItems) {
      if (!task.parentTaskId) continue;
      const arr = map.get(task.parentTaskId) ?? [];
      arr.push(task);
      map.set(task.parentTaskId, arr);
    }
    return map;
  }, [allItems]);

  let globalIndex = 0;
  const completion = (items: SprintGroupedTask[]) => {
    if (items.length === 0) return undefined;
    return Math.round((items.filter((task) => task.status === "done").length / items.length) * 100);
  };

  const renderTask = (task: SprintGroupedTask, depth = 0): ReactNode => {
    if (task.parentTaskId && depth === 0) return null;
    const children = childrenMap.get(task.id);
    const childCount = children?.length ?? 0;
    const isExpanded = expandedParents[task.id] ?? false;
    const activeLabel = getActiveRunLabel(task, agentMap);
    const myIndex = globalIndex++;
    return (
      <div key={task.id}>
        <TaskRowComponent
          task={task}
          href={buildHref(task)}
          agents={agents}
          callbacks={callbacks}
          isSelected={selectedIndex === myIndex}
          onContextMenu={onContextMenu}
          onClick={() => onSelect(myIndex)}
          depth={depth}
          childCount={childCount}
          expanded={isExpanded}
          onToggleExpand={() => setExpandedParents((prev) => ({ ...prev, [task.id]: !prev[task.id] }))}
          hasActiveRun={!!activeLabel}
          activeAgentName={activeLabel}
        />
        {isExpanded && children?.map((child) => renderTask(child as SprintGroupedTask, depth + 1))}
      </div>
    );
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <SprintGroupedList
        grouped={grouped}
        mode={mode}
        companyCode={companyCode}
        persistenceKeyPrefix={`hr:tasks:collapse:${companyCode}:${mode}`}
        itemCountLabel="tasks"
        unassignedLabel={mode === "sprint" ? "No sprint" : "No company goal"}
        itemCompletion={completion}
        renderItem={(task) => renderTask(task)}
      />
    </div>
  );
}
