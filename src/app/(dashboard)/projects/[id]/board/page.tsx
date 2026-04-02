"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Activity,
  AlertTriangle,
  Check,
  Clock3,
  Filter,
  GripVertical,
  Layers3,
  Lightbulb,
  LoaderCircle,
  MessageSquare,
  Plus,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useSearchParams } from "next/navigation";
import { AGENT_CONFIGS } from "@/config/agents";
import { ProjectShellNav } from "@/components/orchestration/ProjectShellNav";
import { formatAge, getStaleSignal, priorityTheme, statusTheme, typeIcon } from "@/components/orchestration/ui";
import {
  cancelTaskExecution,
  createTask,
  createTaskComment,
  getProjectBoard,
  getProjectBoardUpdatedAt,
  listActivityFeed,
  listProjectAgents,
  listTaskComments,
  pollTaskExecutionStatus,
  updateTask,
  updateTaskAssignee,
  updateTaskStatus,
} from "@/lib/orchestration/client";
import {
  ORCHESTRATION_COLUMNS,
  type OrchestrationActivityEvent,
  type OrchestrationAgent,
  type OrchestrationTask,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "@/lib/orchestration/types";

const COLUMN_ORDER_STEP = 1000;
const COLUMN_ID_PREFIX = "column:";
const POLL_MS = 5_000;
const ACTIVITY_POLL_MS = 30_000;

type BoardFilterState = {
  assignee: string;
  priority: "all" | TaskPriority;
  type: "all" | TaskType;
  sprint: string;
  status: "all" | TaskStatus;
  source: "all" | "ideas" | "native";
};

const DEFAULT_FILTERS: BoardFilterState = {
  assignee: "all",
  priority: "all",
  type: "all",
  sprint: "all",
  status: "all",
  source: "all",
};

type IdeasSourceDetails = {
  reviewId: string;
  reviewTitle: string;
  reviewUrl?: string;
  takeawayId?: string;
  takeawayTitle?: string;
  takeawayUrl?: string;
  takeawayTimestamp?: string;
};

type TaskExecutionState = {
  phase: "running" | "queued" | "idle";
  statusLabel: string;
  detailLabel: string;
  elapsedLabel: string;
  heartbeatLabel?: string;
  outputPreview: string[];
  breadcrumbIndex: number;
  breadcrumbTrail: string[];
};

type ExecutionSourceTheme = {
  label: string;
  description: string;
  className: string;
};

type TaskExecutionSnapshot = NonNullable<Awaited<ReturnType<typeof pollTaskExecutionStatus>>>;

const EXECUTION_BREADCRUMBS = [
  "Exploring codebase",
  "Writing components",
  "Running tests",
  "Review ready",
];

export default function ProjectBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boardNotice, setBoardNotice] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("Project");
  const [tasks, setTasks] = useState<OrchestrationTask[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<BoardFilterState>(DEFAULT_FILTERS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedTaskId, setLastSelectedTaskId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [draftComment, setDraftComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [postingComment, setPostingComment] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [savingDescription, setSavingDescription] = useState(false);
  const [subtaskState, setSubtaskState] = useState<Record<string, boolean>>({});
  const [bulkAssignee, setBulkAssignee] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [reviewConfirm, setReviewConfirm] = useState<{
    taskId: string;
    status: TaskStatus;
    columnOrder?: number;
  } | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<
    | {
        mode: "move";
        status: TaskStatus;
        taskIds: string[];
      }
    | {
        mode: "assign";
        assignee: string;
        taskIds: string[];
      }
    | null
  >(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>("P2");
  const [newTaskType, setNewTaskType] = useState<TaskType>("feature");
  const [activityOpen, setActivityOpen] = useState(true);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityEvents, setActivityEvents] = useState<OrchestrationActivityEvent[]>([]);
  const [ideasSourceDetails, setIdeasSourceDetails] = useState<IdeasSourceDetails | null>(null);
  const [ideasSourceLoading, setIdeasSourceLoading] = useState(false);
  const [ideasSourceError, setIdeasSourceError] = useState<string | null>(null);
  const [taskExecutionSnapshot, setTaskExecutionSnapshot] = useState<TaskExecutionSnapshot | null>(null);
  const [executionLoading, setExecutionLoading] = useState(false);
  const [executionRefreshing, setExecutionRefreshing] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionNotice, setExecutionNotice] = useState<string | null>(null);
  const [executionCancelling, setExecutionCancelling] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const dragSnapshotRef = useRef<OrchestrationTask[] | null>(null);
  const consumedJumpTaskRef = useRef<string | null>(null);
  const boardUpdatedAtRef = useRef<string | null>(null);
  const boardPollInFlightRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);
  const dragDisabled = query.trim().length > 0;
  const hasFilters = useMemo(() => Object.values(filters).some((value) => value !== "all"), [filters]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const filteredTasks = useMemo(() => {
    const lower = query.toLowerCase().trim();

    return tasks.filter((task) => {
      if (filters.assignee !== "all" && task.assignee !== filters.assignee) return false;
      if (filters.priority !== "all" && task.priority !== filters.priority) return false;
      if (filters.type !== "all" && task.type !== filters.type) return false;
      if (filters.sprint !== "all" && task.sprint !== filters.sprint) return false;
      if (filters.status !== "all" && task.status !== filters.status) return false;
      if (filters.source === "ideas" && !task.sourceReviewId) return false;
      if (filters.source === "native" && task.sourceReviewId) return false;

      if (!lower) return true;
      return `${task.title} ${task.description ?? ""}`.toLowerCase().includes(lower);
    });
  }, [filters, query, tasks]);

  const orderedVisibleTaskIds = useMemo(
    () =>
      ORCHESTRATION_COLUMNS.flatMap((column) =>
        sortLaneTasks(filteredTasks, column.id).map((task) => task.id)
      ),
    [filteredTasks]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (event.key === "Escape") {
        if (shortcutsOpen) {
          setShortcutsOpen(false);
          return;
        }
        setSelectedTaskId(null);
        setCreateOpen(false);
      }

      if (isTyping) return;

      if ((event.key === "?" || (event.key === "/" && event.shiftKey)) && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }

      if (event.key === "Enter" && focusedTaskId) {
        event.preventDefault();
        setSelectedTaskId(focusedTaskId);
        return;
      }

      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && orderedVisibleTaskIds.length > 0) {
        event.preventDefault();
        const pivotTaskId = focusedTaskId ?? selectedTaskId;
        const currentIndex = pivotTaskId ? orderedVisibleTaskIds.indexOf(pivotTaskId) : -1;
        const nextIndex =
          event.key === "ArrowDown"
            ? (currentIndex + 1 + orderedVisibleTaskIds.length) % orderedVisibleTaskIds.length
            : (currentIndex - 1 + orderedVisibleTaskIds.length) % orderedVisibleTaskIds.length;
        const nextTaskId = orderedVisibleTaskIds[nextIndex] ?? orderedVisibleTaskIds[0] ?? null;
        setFocusedTaskId(nextTaskId);
        if (nextTaskId) {
          document.getElementById(`task-card-${nextTaskId}`)?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
            inline: "nearest",
          });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedTaskId, orderedVisibleTaskIds, selectedTaskId, shortcutsOpen]);

  useEffect(() => {
    let mounted = true;

    const loadBoard = async (initial = false) => {
      if (boardPollInFlightRef.current) return;
      boardPollInFlightRef.current = true;
      try {
        if (!initial && boardUpdatedAtRef.current) {
          const updatedAt = await getProjectBoardUpdatedAt(id);
          if (!mounted) return;
          if (updatedAt && updatedAt === boardUpdatedAtRef.current) {
            return;
          }
          if (updatedAt) {
            boardUpdatedAtRef.current = updatedAt;
          }
        }

        const board = await getProjectBoard(id);
        if (!board || !mounted) {
          if (initial) {
            setError("Project board not found.");
          }
          return;
        }

        setError(null);
        setProjectName(board.project.name);
        setTasks(board.tasks);
        if (!boardUpdatedAtRef.current) {
          const updatedAt = await getProjectBoardUpdatedAt(id);
          if (updatedAt) {
            boardUpdatedAtRef.current = updatedAt;
          }
        }

        const roster = await listProjectAgents(id, board.tasks);
        if (mounted) {
          setAgents(roster);
        }
      } catch {
        if (mounted) {
          setError("Failed to load orchestration board data.");
        }
      } finally {
        boardPollInFlightRef.current = false;
        if (mounted && initial) {
          setLoading(false);
        }
      }
    };

    void loadBoard(true);
    const timer = window.setInterval(() => {
      void loadBoard(false);
    }, POLL_MS);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedTaskId) return;
    const exists = tasks.some((task) => task.id === selectedTaskId);
    if (!exists) setSelectedTaskId(null);
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    const jumpTaskId = searchParams.get("task");

    if (!jumpTaskId) {
      consumedJumpTaskRef.current = null;
      return;
    }

    if (consumedJumpTaskRef.current === jumpTaskId) return;

    const taskExists = tasks.some((task) => task.id === jumpTaskId);
    if (!taskExists) return;

    consumedJumpTaskRef.current = jumpTaskId;
    setSelectedTaskId(jumpTaskId);
    requestAnimationFrame(() => {
      document.getElementById(`task-card-${jumpTaskId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    });
  }, [searchParams, tasks]);

  useEffect(() => {
    if (!selectedTaskId) return;
    listTaskComments(selectedTaskId).then((comments) => {
      setTasks((prev) =>
        prev.map((task) => (task.id === selectedTaskId ? { ...task, comments } : task))
      );
    });
    setDraftComment("");
    setCommentError(null);
    setDescriptionError(null);
    setEditingDescription(false);
  }, [selectedTaskId]);

  const mergeTaskFromExecution = useCallback((nextTask: OrchestrationTask) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== nextTask.id) return task;
        return {
          ...task,
          status: nextTask.status,
          columnOrder: nextTask.columnOrder ?? task.columnOrder,
          assignee: nextTask.assignee ?? task.assignee,
          blockedReason: nextTask.blockedReason ?? task.blockedReason,
          executionMode: nextTask.executionMode ?? task.executionMode,
          comments: nextTask.comments ?? task.comments,
          updated: nextTask.updated,
        };
      })
    );
  }, []);

  const refreshExecutionSnapshot = useCallback(
    async (taskId: string, input?: { manual?: boolean }) => {
      const manual = Boolean(input?.manual);
      if (manual) {
        setExecutionRefreshing(true);
      } else {
        setExecutionLoading(true);
      }

      const snapshot = await pollTaskExecutionStatus(taskId);

      if (manual) {
        setExecutionRefreshing(false);
      } else {
        setExecutionLoading(false);
      }

      if (!snapshot) {
        setExecutionError("Execution monitor unavailable right now.");
        return;
      }

      setExecutionError(null);
      setTaskExecutionSnapshot(snapshot);
      mergeTaskFromExecution(snapshot.task);

      if (snapshot.transition.changed && snapshot.transition.to) {
        setExecutionNotice(`Execution moved task to ${statusTheme[snapshot.transition.to].label}.`);
        return;
      }

      if (snapshot.status.state === "skipped" && snapshot.status.reason) {
        setExecutionNotice(snapshot.status.reason.replaceAll("_", " "));
        return;
      }

      if (manual) {
        setExecutionNotice(`Execution check complete at ${new Date(snapshot.polledAt).toLocaleTimeString()}.`);
      }
    },
    [mergeTaskFromExecution]
  );

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskExecutionSnapshot(null);
      setExecutionLoading(false);
      setExecutionRefreshing(false);
      setExecutionError(null);
      setExecutionNotice(null);
      setExecutionCancelling(false);
      return;
    }

    let mounted = true;
    const poll = async (manual = false) => {
      if (!mounted) return;
      await refreshExecutionSnapshot(selectedTaskId, { manual });
    };

    void poll(false);
    const timer = window.setInterval(() => {
      void poll(false);
    }, 15_000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [refreshExecutionSnapshot, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    const selectedTask = tasks.find((task) => task.id === selectedTaskId);
    if (!selectedTask) return;
    const nextDescription = selectedTask.description ?? "";
    setDescriptionDraft(nextDescription);
    setSubtaskState(buildChecklistState(nextDescription));
  }, [selectedTaskId, tasks]);

  useEffect(() => {
    if (selectedTaskId) {
      drawerCloseRef.current?.focus();
    }
  }, [selectedTaskId]);

  useEffect(() => {
    const shouldLock = Boolean(selectedTaskId || createOpen || reviewConfirm || bulkConfirm);
    if (shouldLock) {
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
    return;
  }, [selectedTaskId, createOpen, reviewConfirm, bulkConfirm]);

  useEffect(() => {
    let mounted = true;

    const loadActivity = async (initial = false) => {
      const feed = await listActivityFeed({ limit: 50 });

      if (!mounted) return;

      if (!feed) {
        setActivityError("Unable to load board activity stream.");
        if (initial) setActivityLoading(false);
        return;
      }

      setActivityError(null);
      setActivityEvents(feed.activity.filter((event) => event.projectId === id).slice(0, 16));
      if (initial) setActivityLoading(false);
    };

    void loadActivity(true);
    const timer = window.setInterval(() => {
      void loadActivity(false);
    }, ACTIVITY_POLL_MS);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [id]);

  const filterOptions = useMemo(() => {
    const assignees = Array.from(
      new Set([
        ...agents.map((agent) => agent.name),
        ...(tasks.map((task) => task.assignee).filter(Boolean) as string[]),
      ])
    ).sort((a, b) => a.localeCompare(b));
    const sprints = Array.from(new Set(tasks.map((task) => task.sprint).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b)
    );

    return {
      assignees,
      sprints,
    };
  }, [agents, tasks]);

  const agentLookup = useMemo(() => {
    const lookup = new Map<string, OrchestrationAgent>();
    for (const agent of agents) {
      lookup.set(agent.name.toLowerCase(), agent);
      lookup.set(agent.id.toLowerCase(), agent);
    }
    return lookup;
  }, [agents]);

  useEffect(() => {
    const knownTaskIds = new Set(tasks.map((task) => task.id));
    setSelectedIds((prev) => prev.filter((idValue) => knownTaskIds.has(idValue)));
    if (lastSelectedTaskId && !knownTaskIds.has(lastSelectedTaskId)) {
      setLastSelectedTaskId(null);
    }
    if (focusedTaskId && !knownTaskIds.has(focusedTaskId)) {
      setFocusedTaskId(null);
    }
  }, [tasks, focusedTaskId, lastSelectedTaskId]);

  useEffect(() => {
    if (!focusedTaskId && orderedVisibleTaskIds.length > 0) {
      setFocusedTaskId(orderedVisibleTaskIds[0]);
      return;
    }
    if (focusedTaskId && !orderedVisibleTaskIds.includes(focusedTaskId)) {
      setFocusedTaskId(orderedVisibleTaskIds[0] ?? null);
    }
  }, [focusedTaskId, orderedVisibleTaskIds]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );
  const activeDragTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks]
  );
  const executionByTaskId = useMemo(() => {
    const map = new Map<string, TaskExecutionState>();

    for (const task of tasks) {
      const execution = deriveTaskExecutionState(task, agentLookup, clockTick);
      map.set(task.id, execution);
    }

    return map;
  }, [agentLookup, clockTick, tasks]);

  useEffect(() => {
    if (!selectedTask?.sourceReviewId) {
      setIdeasSourceDetails(null);
      setIdeasSourceLoading(false);
      setIdeasSourceError(null);
      return;
    }

    const reviewId = selectedTask.sourceReviewId;
    const controller = new AbortController();
    let active = true;
    setIdeasSourceLoading(true);
    setIdeasSourceError(null);

    (async () => {
      try {
        const response = await fetch("/api/ideas", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Failed to load Ideas source metadata.");
        }

        const payload = (await response.json().catch(() => ({}))) as {
          reviews?: Array<{
            id?: string;
            title?: string;
            url?: string;
            takeaways?: Array<{
              id?: string;
              title?: string;
              video_url?: string;
              video_timestamp?: string;
            }>;
          }>;
        };

        const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
        const review = reviews.find((candidate) => String(candidate.id ?? "") === selectedTask.sourceReviewId);
        const takeaways = Array.isArray(review?.takeaways) ? review.takeaways : [];
        const takeaway = selectedTask.sourceTakeawayId
          ? takeaways.find((candidate) => String(candidate.id ?? "") === selectedTask.sourceTakeawayId)
          : undefined;

        if (!active) return;

        setIdeasSourceDetails({
          reviewId,
          reviewTitle: String(review?.title ?? "Ideas Review"),
          reviewUrl: review?.url ? String(review.url) : undefined,
          takeawayId: selectedTask.sourceTakeawayId,
          takeawayTitle: takeaway?.title ? String(takeaway.title) : undefined,
          takeawayUrl: takeaway?.video_url ? String(takeaway.video_url) : undefined,
          takeawayTimestamp: takeaway?.video_timestamp ? String(takeaway.video_timestamp) : undefined,
        });
      } catch {
        if (!active) return;
        setIdeasSourceDetails({
          reviewId,
          reviewTitle: "Ideas Review",
          takeawayId: selectedTask.sourceTakeawayId,
        });
        setIdeasSourceError("Unable to load full source metadata. Showing available linkage.");
      } finally {
        if (active) {
          setIdeasSourceLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedTask?.id, selectedTask?.sourceReviewId, selectedTask?.sourceTakeawayId]);

  const singleEligibleAutoAssignee = useMemo(() => {
    const eligible = agents.filter((agent) => agent.status === "idle" || agent.status === "working");
    if (eligible.length !== 1) return null;
    return eligible[0];
  }, [agents]);

  const moveTask = async (taskId: string, status: TaskStatus, columnOrder?: number, force = false) => {
    let previous = tasks.find((task) => task.id === taskId);
    if (status === "in-progress" && !previous?.assignee) {
      if (!singleEligibleAutoAssignee) {
        setBoardNotice("Assign an agent before moving a task to In Progress.");
        return;
      }

      const autoAssignOk = await updateTaskAssignee(taskId, singleEligibleAutoAssignee.name);
      if (!autoAssignOk) {
        setBoardNotice("Unable to auto-assign the only active agent. Try again in a moment.");
        return;
      }

      const assignedAt = new Date().toISOString();
      setTasks((prev) =>
        prev.map((task) =>
          task.id === taskId
            ? { ...task, assignee: singleEligibleAutoAssignee.name, updated: assignedAt }
            : task
        )
      );
      previous = previous
        ? { ...previous, assignee: singleEligibleAutoAssignee.name, updated: assignedAt }
        : previous;
    }

    setBoardNotice(null);
    if (!force && previous?.status === "review" && status === "done") {
      setReviewConfirm({ taskId, status, columnOrder });
      return;
    }
    const nextColumnOrder =
      columnOrder ??
      (tasks
        .filter((task) => task.id !== taskId && task.status === status)
        .reduce((max, task) => Math.max(max, task.columnOrder ?? 0), 0) + COLUMN_ORDER_STEP);

    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status, columnOrder: nextColumnOrder, updated: new Date().toISOString() }
          : task
      )
    );

    const ok = await updateTaskStatus(taskId, status, nextColumnOrder);
    if (!ok && previous) {
      setTasks((prev) => prev.map((task) => (task.id === taskId ? previous : task)));
      setBoardNotice("Unable to move task right now. Try again in a moment.");
    }
  };

  const assignTask = async (taskId: string, assignee: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, assignee: assignee || undefined, updated: new Date().toISOString() }
          : task
      )
    );

    const ok = await updateTaskAssignee(taskId, assignee);
    if (!ok) {
      setBoardNotice("Unable to update assignee right now. Try again in a moment.");
      return;
    }

    setBoardNotice(null);
  };

  const applyBulkMove = async (taskIds: string[], status: TaskStatus) => {
    const targetIds = [...taskIds];
    const movableIds =
      status === "in-progress"
        ? targetIds.filter((taskId) => {
            const task = tasks.find((candidate) => candidate.id === taskId);
            return Boolean(task?.assignee);
          })
        : targetIds;

    if (status === "in-progress" && movableIds.length !== targetIds.length) {
      const skipped = targetIds.length - movableIds.length;
      setBoardNotice(
        `Skipped ${skipped} unassigned task${skipped === 1 ? "" : "s"}. Assign agents before moving to In Progress.`
      );
    } else {
      setBoardNotice(null);
    }

    if (movableIds.length === 0) return;

    const existingMaxOrder = tasks
      .filter((task) => !movableIds.includes(task.id) && task.status === status)
      .reduce((max, task) => Math.max(max, task.columnOrder ?? 0), 0);
    setSelectedIds([]);
    setLastSelectedTaskId(null);
    for (const [index, taskId] of movableIds.entries()) {
      const columnOrder = existingMaxOrder + COLUMN_ORDER_STEP * (index + 1);
      await moveTask(taskId, status, columnOrder, true);
    }
  };

  const applyBulkAssign = async (taskIds: string[], assignee: string) => {
    const targetIds = [...taskIds];
    setSelectedIds([]);
    setLastSelectedTaskId(null);
    for (const taskId of targetIds) {
      await assignTask(taskId, assignee);
    }
  };

  const requestBulkMove = (status: TaskStatus) => {
    if (selectedIds.length === 0) return;
    setBulkConfirm({
      mode: "move",
      status,
      taskIds: [...selectedIds],
    });
  };

  const requestBulkAssign = () => {
    if (selectedIds.length === 0 || bulkAssignee === "all") return;
    setBulkConfirm({
      mode: "assign",
      assignee: bulkAssignee === "__none__" ? "" : bulkAssignee,
      taskIds: [...selectedIds],
    });
  };

  const toggleSelection = (taskId: string, checked: boolean, shiftKey = false) => {
    setSelectedIds((prev) => {
      if (shiftKey && lastSelectedTaskId && orderedVisibleTaskIds.length > 0) {
        const startIndex = orderedVisibleTaskIds.indexOf(lastSelectedTaskId);
        const endIndex = orderedVisibleTaskIds.indexOf(taskId);

        if (startIndex >= 0 && endIndex >= 0) {
          const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
          const range = orderedVisibleTaskIds.slice(from, to + 1);

          if (checked) {
            const next = new Set(prev);
            range.forEach((idValue) => next.add(idValue));
            return Array.from(next);
          }

          return prev.filter((idValue) => !range.includes(idValue));
        }
      }

      if (checked) {
        if (prev.includes(taskId)) return prev;
        return [...prev, taskId];
      }
      return prev.filter((idValue) => idValue !== taskId);
    });

    setLastSelectedTaskId(taskId);
  };

  const confirmBulkAction = async () => {
    const pending = bulkConfirm;
    setBulkConfirm(null);
    if (!pending) return;

    if (pending.mode === "move") {
      await applyBulkMove(pending.taskIds, pending.status);
      return;
    }

    await applyBulkAssign(pending.taskIds, pending.assignee);
  };

  const handleCreateTask = async () => {
    if (newTaskTitle.trim().length < 2) {
      setCreateError("Task title must be at least 2 characters.");
      return;
    }

    setCreatingTask(true);
    setCreateError(null);

    const created = await createTask({
      projectId: id,
      title: newTaskTitle.trim(),
      description: newTaskDescription.trim(),
      priority: newTaskPriority,
      type: newTaskType,
      status: "backlog",
    });

    setCreatingTask(false);

    if (!created) {
      setCreateError("Failed to create task.");
      return;
    }

    setTasks((prev) => [...prev, created]);
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskPriority("P2");
    setNewTaskType("feature");
    setCreateOpen(false);
    setSelectedTaskId(created.id);
  };

  const handlePostComment = async () => {
    if (!selectedTaskId || !draftComment.trim()) return;
    setPostingComment(true);
    setCommentError(null);
    const comment = await createTaskComment({
      taskId: selectedTaskId,
      body: draftComment.trim(),
      authorUserId: "pixel-ui",
    });
    setPostingComment(false);

    if (!comment) {
      setCommentError("Unable to post comment.");
      return;
    }

    setDraftComment("");
    setTasks((prev) =>
      prev.map((task) =>
        task.id === selectedTaskId
          ? { ...task, comments: [...(task.comments ?? []), comment], updated: new Date().toISOString() }
          : task
      )
    );
  };

  const saveDescriptionDraft = async () => {
    if (!selectedTaskId) return;
    const taskId = selectedTaskId;
    const nextDescription = descriptionDraft;
    const previousTask = tasks.find((task) => task.id === taskId) ?? null;

    setDescriptionError(null);
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, description: nextDescription, updated: new Date().toISOString() }
          : task
      )
    );
    setSubtaskState(buildChecklistState(nextDescription));
    setEditingDescription(false);

    setSavingDescription(true);
    const updated = await updateTask({
      taskId,
      description: nextDescription,
      actorUserId: "pixel-ui",
    });
    setSavingDescription(false);

    if (!updated) {
      setDescriptionError("Unable to save description. Restoring previous value.");
      if (previousTask) {
        setTasks((prev) => prev.map((task) => (task.id === taskId ? previousTask : task)));
        setDescriptionDraft(previousTask.description ?? "");
        setSubtaskState(buildChecklistState(previousTask.description ?? ""));
      }
      return;
    }

    setTasks((prev) => prev.map((task) => (task.id === taskId ? updated : task)));
    setDescriptionDraft(updated.description ?? "");
    setSubtaskState(buildChecklistState(updated.description ?? ""));
  };

  const handleCancelExecution = async (targetStatus: "on-deck" | "in-progress" = "on-deck") => {
    if (!selectedTaskId) return;
    setExecutionCancelling(true);

    const cancelled = await cancelTaskExecution({
      taskId: selectedTaskId,
      actorUserId: "pixel-ui",
      targetStatus,
      note: "Cancelled from Mission Control task drawer.",
    });

    setExecutionCancelling(false);

    if (!cancelled) {
      setExecutionError("Unable to cancel execution session.");
      return;
    }

    setExecutionError(null);
    mergeTaskFromExecution(cancelled.task);
    if (cancelled.cancelled.status === "cancelled") {
      setExecutionNotice(`Execution session cancelled. Task moved to ${statusTheme[cancelled.task.status].label}.`);
    } else {
      setExecutionNotice(cancelled.cancelled.reason?.replaceAll("_", " ") || "Execution cancellation skipped.");
    }

    await refreshExecutionSnapshot(selectedTaskId, { manual: true });
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (dragDisabled) return;
    const taskId = String(event.active.id);
    dragSnapshotRef.current = tasks;
    setActiveTaskId(taskId);
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (dragDisabled) return;
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;
    setTasks((prev) => moveTaskInState(prev, activeId, overId));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (dragDisabled) return;
    setActiveTaskId(null);
    const snapshot = dragSnapshotRef.current;
    dragSnapshotRef.current = null;

    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!snapshot) return;

    if (!overId) {
      setTasks(snapshot);
      return;
    }

    const nextState = moveTaskInState(tasks, activeId, overId);
    const persistedTask = nextState.find((task) => task.id === activeId) ?? null;
    setTasks(nextState);

    if (!persistedTask) {
      setTasks(snapshot);
      return;
    }

    const previousTask = snapshot.find((task) => task.id === activeId);
    const changed =
      previousTask?.status !== persistedTask.status ||
      (previousTask?.columnOrder ?? null) !== (persistedTask.columnOrder ?? null);
    if (!changed) return;

    if (persistedTask.status === "in-progress" && !persistedTask.assignee) {
      if (!singleEligibleAutoAssignee) {
        setTasks(snapshot);
        setBoardNotice("Assign an agent before moving a task to In Progress.");
        return;
      }

      const autoAssignOk = await updateTaskAssignee(persistedTask.id, singleEligibleAutoAssignee.name);
      if (!autoAssignOk) {
        setTasks(snapshot);
        setBoardNotice("Unable to auto-assign the only active agent. Try again in a moment.");
        return;
      }
      persistedTask.assignee = singleEligibleAutoAssignee.name;
    }

    if (previousTask?.status === "review" && persistedTask.status === "done") {
      setTasks(snapshot);
      setReviewConfirm({
        taskId: persistedTask.id,
        status: persistedTask.status,
        columnOrder: persistedTask.columnOrder,
      });
      return;
    }

    const ok = await updateTaskStatus(
      persistedTask.id,
      persistedTask.status,
      persistedTask.columnOrder
    );

    if (!ok) {
      setTasks(snapshot);
      setBoardNotice("Unable to move task right now. Try again in a moment.");
      return;
    }

    setBoardNotice(null);
  };

  const handleDragCancel = () => {
    setActiveTaskId(null);
    if (dragSnapshotRef.current) {
      setTasks(dragSnapshotRef.current);
      dragSnapshotRef.current = null;
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="h-48 animate-pulse rounded-3xl border border-white/10 bg-slate-900/60" />
      </div>
    );
  }

  return (
    <div className="orchestra-shell p-4 md:p-8">
      <ProjectShellNav projectId={id} projectName={projectName} />

      {error ? (
        <div className="mb-4 rounded-2xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      {boardNotice ? (
        <div className="mb-4 rounded-2xl border border-amber-300/35 bg-amber-400/10 p-3 text-sm text-amber-100">
          {boardNotice}
        </div>
      ) : null}

      <div className="orchestra-glass orchestra-enter mb-5 space-y-3 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              ref={searchInputRef}
              className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
              placeholder="Search tasks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {dragDisabled ? (
              <p className="mt-2 text-[11px] text-slate-400">
                Clear search to reorder tasks with drag-and-drop.
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="orchestra-cta inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-amber-100"
          >
            <Plus className="h-4 w-4" />
            New Task
          </button>

          <button
            type="button"
            onClick={() => setActivityOpen((prev) => !prev)}
            className="orchestra-ghost-btn inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-200"
            aria-expanded={activityOpen}
            aria-controls="board-activity-sidebar"
          >
            {activityOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            Activity
          </button>

          <div className="orchestra-chip flex items-center gap-2 rounded-xl px-2 py-1">
            <span className="px-2 text-xs text-slate-400">Bulk Move</span>
            {ORCHESTRATION_COLUMNS.filter((column) => column.id !== "blocked").map((column) => (
              <button
                key={column.id}
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => requestBulkMove(column.id)}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {column.label}
              </button>
            ))}
          </div>

          <div className="orchestra-chip flex items-center gap-2 rounded-xl px-2 py-1">
            <span className="px-2 text-xs text-slate-400">Bulk Assign</span>
            <select
              value={bulkAssignee}
              onChange={(event) => setBulkAssignee(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-200"
            >
              <option value="all">Select agent</option>
              <option value="__none__">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.name}>
                  {agent.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={selectedIds.length === 0 || bulkAssignee === "all"}
              onClick={requestBulkAssign}
              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <p className="orchestra-chip inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] text-slate-300">
            <Filter className="h-3.5 w-3.5" />
            Filters
          </p>

          <SelectFilter
            value={filters.assignee}
            onChange={(value) => setFilters((prev) => ({ ...prev, assignee: value }))}
            options={["all", ...filterOptions.assignees]}
            label="Agent"
          />
          <SelectFilter
            value={filters.priority}
            onChange={(value) => setFilters((prev) => ({ ...prev, priority: value as BoardFilterState["priority"] }))}
            options={["all", "P0", "P1", "P2", "P3"]}
            label="Priority"
          />
          <SelectFilter
            value={filters.type}
            onChange={(value) => setFilters((prev) => ({ ...prev, type: value as BoardFilterState["type"] }))}
            options={["all", "feature", "bug", "research", "infrastructure", "directive", "maintenance"]}
            label="Type"
          />
          <SelectFilter
            value={filters.sprint}
            onChange={(value) => setFilters((prev) => ({ ...prev, sprint: value }))}
            options={["all", ...filterOptions.sprints]}
            label="Sprint"
          />
          <SelectFilter
            value={filters.status}
            onChange={(value) => setFilters((prev) => ({ ...prev, status: value as BoardFilterState["status"] }))}
            options={["all", ...ORCHESTRATION_COLUMNS.map((column) => column.id)]}
            label="Status"
          />
          <SelectFilter
            value={filters.source}
            onChange={(value) => setFilters((prev) => ({ ...prev, source: value as BoardFilterState["source"] }))}
            options={["all", "ideas", "native"]}
            label="Source"
          />

          {hasFilters ? (
            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-slate-900/75 px-2.5 py-1 text-[11px] text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </button>
          ) : null}

          <span className="orchestra-chip ml-auto rounded-lg px-2.5 py-1 text-[11px] text-slate-400">
            {filteredTasks.length} visible
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="orchestra-chip rounded-lg px-2 py-1">Shortcut: `/` search</span>
          <span className="orchestra-chip rounded-lg px-2 py-1">Shortcut: `N` new task</span>
          <span className="orchestra-chip rounded-lg px-2 py-1">Shortcut: `↑/↓` focus cards</span>
          <span className="orchestra-chip rounded-lg px-2 py-1">Shortcut: `Enter` open drawer</span>
          <span className="orchestra-chip rounded-lg px-2 py-1">Shortcut: `?` help</span>
          <span className="orchestra-chip rounded-lg px-2 py-1">Shortcut: `Esc` close drawer</span>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="rounded-lg border border-white/10 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300"
            aria-label="Open keyboard shortcuts"
          >
            Show Shortcuts
          </button>
          <span className="ml-auto text-slate-500">Review to done requires explicit confirmation.</span>
        </div>
      </div>

      <div className="relative lg:flex lg:items-start lg:gap-4">
        <div className="min-w-0 flex-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div className="flex flex-col gap-4 pb-2 md:flex-row md:overflow-x-auto [scrollbar-width:thin]">
              {ORCHESTRATION_COLUMNS.map((column) => {
                const laneTasks = sortLaneTasks(filteredTasks, column.id);
                return (
                  <BoardLane key={column.id} column={column} taskCount={laneTasks.length}>
                    <SortableContext
                      items={laneTasks.map((task) => task.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {laneTasks.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-700/80 bg-slate-900/45 px-3 py-7 text-center text-xs text-slate-500">
                            <Layers3 className="mx-auto mb-2 h-4 w-4 text-slate-600" />
                            <p>No tasks in {column.label.toLowerCase()}.</p>
                            <p className="mt-1 text-[11px] text-slate-600">Drop a card here.</p>
                          </div>
                        ) : (
                          laneTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              agents={agents}
                              agentLookup={agentLookup}
                              isSelected={selectedIds.includes(task.id)}
                              isFocused={focusedTaskId === task.id}
                              isDragging={activeTaskId === task.id}
                              dragDisabled={dragDisabled}
                              onToggleSelect={(checked, shiftKey) => toggleSelection(task.id, checked, shiftKey)}
                              onStatusChange={(status) => moveTask(task.id, status)}
                              onAssigneeChange={(assignee) => assignTask(task.id, assignee)}
                              onFocusCard={() => setFocusedTaskId(task.id)}
                              executionState={executionByTaskId.get(task.id)}
                              nowMs={clockTick}
                              onOpen={() => {
                                setFocusedTaskId(task.id);
                                setSelectedTaskId(task.id);
                              }}
                            />
                          ))
                        )}
                      </div>
                    </SortableContext>
                  </BoardLane>
                );
              })}
            </div>
            <DragOverlay>
              {activeDragTask ? <TaskDragPreview task={activeDragTask} /> : null}
            </DragOverlay>
          </DndContext>
        </div>

        {activityOpen ? (
          <BoardActivitySidebar
            id="board-activity-sidebar"
            events={activityEvents}
            loading={activityLoading}
            error={activityError}
            agents={agents}
          />
        ) : null}

        <aside
          className="fixed inset-0 z-40 h-dvh w-full border-l-0 border-white/10 bg-[linear-gradient(180deg,rgba(2,6,23,0.97),rgba(15,23,42,0.94))] p-4 backdrop-blur-2xl transition-[transform,opacity] duration-300 ease-out md:right-0 md:top-[48px] md:h-[calc(100vh-48px)] md:max-w-md md:border-l md:p-5"
          style={{
            transform: selectedTask ? "translateX(0)" : "translateX(100%)",
            opacity: selectedTask ? 1 : 0,
            pointerEvents: selectedTask ? "auto" : "none",
            boxShadow: selectedTask ? "-22px 0 56px rgba(2,6,23,0.56)" : "none",
          }}
          role="dialog"
          aria-modal="true"
          aria-label={selectedTask ? `Task details for ${selectedTask.title}` : "Task details"}
          aria-hidden={!selectedTask}
        >
          {selectedTask ? (
            <div className="flex h-full flex-col gap-4 overflow-y-auto pr-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-amber-200/70">{statusTheme[selectedTask.status].label}</p>
                  <h3 className="mt-1 text-lg font-semibold text-white">{selectedTask.title}</h3>
                  {(() => {
                    const source = getExecutionSourceTheme(selectedTask.executionMode);
                    return (
                      <span className={`mt-2 inline-flex items-center rounded-md border px-2 py-1 text-[11px] ${source.className}`}>
                        {source.label}
                      </span>
                    );
                  })()}
                </div>
                <button
                  ref={drawerCloseRef}
                  type="button"
                  onClick={() => setSelectedTaskId(null)}
                  className="orchestra-ghost-btn rounded-lg px-2 py-1 text-xs text-slate-300"
                  aria-label="Close task drawer"
                >
                  Close
                </button>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-900/65 p-3 text-sm text-slate-300">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Description</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (editingDescription) {
                        void saveDescriptionDraft();
                        return;
                      }
                      setDescriptionError(null);
                      setDescriptionDraft(selectedTask.description ?? "");
                      setEditingDescription(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300"
                  >
                    {editingDescription ? <Check className="h-3.5 w-3.5" /> : null}
                    {editingDescription ? "Save inline" : "Edit inline"}
                  </button>
                </div>

                {editingDescription ? (
                  <div className="space-y-2">
                    <textarea
                      value={descriptionDraft}
                      onChange={(event) => {
                        setDescriptionDraft(event.target.value);
                        if (descriptionError) setDescriptionError(null);
                      }}
                      className="h-32 w-full resize-none rounded-lg border border-white/10 bg-slate-950/80 p-2 text-xs text-slate-200 outline-none focus:border-amber-300/60"
                      placeholder="Use markdown for richer task notes."
                    />
                    {descriptionError ? <p className="text-[11px] text-rose-300">{descriptionError}</p> : null}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={savingDescription}
                        onClick={() => {
                          setDescriptionDraft(selectedTask.description ?? "");
                          setDescriptionError(null);
                          setEditingDescription(false);
                        }}
                        className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={savingDescription}
                        onClick={() => void saveDescriptionDraft()}
                        className="rounded-md border border-amber-300/40 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100 disabled:opacity-60"
                      >
                        {savingDescription ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                ) : descriptionDraft.trim().length > 0 ? (
                  <div className="prose prose-invert max-w-none prose-p:my-1 prose-li:my-0.5 prose-ul:my-1 prose-ol:my-1 prose-pre:my-2 prose-code:text-amber-200">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{descriptionDraft}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No description yet. Click edit to add one.</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <Info label="Priority" value={priorityTheme[selectedTask.priority].label} />
                <Info label="Assignee" value={selectedTask.assignee || "Unassigned"} />
                <Info label="Sprint" value={selectedTask.sprint || "None"} />
                <Info label="Updated" value={formatAge(selectedTask.updated)} />
                <Info label="Type" value={selectedTask.type} />
                <Info label="Execution Source" value={getExecutionSourceTheme(selectedTask.executionMode).description} />
              </div>

              <section className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Execution</p>
                {(() => {
                  const execution =
                    taskExecutionSnapshot?.taskId === selectedTask.id
                      ? deriveTaskExecutionStateFromSnapshot(taskExecutionSnapshot, selectedTask, agentLookup, clockTick)
                      : executionByTaskId.get(selectedTask.id) ?? deriveTaskExecutionState(selectedTask, agentLookup, clockTick);
                  return (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          {executionLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                          {executionRefreshing ? <span>Refreshing...</span> : <span>Live monitor</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void refreshExecutionSnapshot(selectedTask.id, { manual: true })}
                            disabled={executionRefreshing || executionLoading || executionCancelling}
                            className="rounded-md border border-white/10 bg-slate-800/70 px-2 py-1 text-[11px] text-slate-200 disabled:opacity-50"
                          >
                            Refresh
                          </button>
                          {selectedTask.executionMode === "openclaw" && selectedTask.status === "in-progress" ? (
                            <button
                              type="button"
                              onClick={() => void handleCancelExecution("on-deck")}
                              disabled={executionCancelling || executionLoading}
                              className="rounded-md border border-rose-300/35 bg-rose-500/12 px-2 py-1 text-[11px] text-rose-100 disabled:opacity-50"
                            >
                              {executionCancelling ? "Cancelling..." : "Cancel Session"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {executionError ? (
                        <p className="rounded-md border border-rose-400/35 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100">
                          {executionError}
                        </p>
                      ) : null}
                      {executionNotice ? (
                        <p className="rounded-md border border-amber-300/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                          {executionNotice}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                            execution.phase === "running"
                              ? "border-emerald-300/45 bg-emerald-400/12 text-emerald-100"
                              : execution.phase === "queued"
                              ? "border-amber-300/45 bg-amber-400/12 text-amber-100"
                              : "border-white/10 bg-slate-800/70 text-slate-300"
                          }`}
                        >
                          {execution.phase === "running" ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          {execution.statusLabel}
                        </span>
                        <span className="text-xs text-slate-300">{execution.detailLabel}</span>
                      </div>
                      <div className="grid gap-2 text-xs sm:grid-cols-2">
                        <Info label="Elapsed" value={execution.elapsedLabel} />
                        <Info label="Heartbeat" value={execution.heartbeatLabel ?? "No heartbeat signal"} />
                      </div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/65 p-2">
                        <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">Progress Breadcrumbs</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {execution.breadcrumbTrail.map((step, index) => (
                            <span
                              key={`${selectedTask.id}-crumb-${step}`}
                              className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
                                index === execution.breadcrumbIndex
                                  ? "border-amber-300/45 bg-amber-400/14 text-amber-100"
                                  : index < execution.breadcrumbIndex
                                  ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100"
                                  : "border-white/10 bg-slate-800/70 text-slate-400"
                              }`}
                            >
                              {step}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-slate-950/65 p-2">
                        <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">Agent Output Preview</p>
                        {execution.outputPreview.length > 0 ? (
                          <ul className="space-y-1 text-xs text-slate-300">
                            {execution.outputPreview.map((line, index) => (
                              <li key={`${selectedTask.id}-output-${index}`} className="line-clamp-2">
                                {line}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-xs text-slate-500">No execution output yet. New comments from the assigned agent will appear here.</p>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </section>

              <section className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Assignment</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    value={selectedTask.status}
                    onChange={(event) => moveTask(selectedTask.id, event.target.value as TaskStatus)}
                    className="rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
                  >
                    {ORCHESTRATION_COLUMNS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedTask.assignee ?? ""}
                    onChange={(event) => assignTask(selectedTask.id, event.target.value)}
                    className="rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.name}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              {(selectedTask.blockedReason || selectedTask.tags.length > 0) && (
                <section className="rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs">
                  <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Dependencies</p>
                  {selectedTask.blockedReason ? (
                    <p className="rounded-lg border border-rose-400/35 bg-rose-500/10 px-2 py-1.5 text-rose-100">
                      Blocked: {selectedTask.blockedReason}
                    </p>
                  ) : null}
                  {selectedTask.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedTask.tags.map((tag) => (
                        <span key={tag} className="rounded-md border border-white/10 bg-slate-800/75 px-2 py-1 text-[11px] text-slate-300">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </section>
              )}

              {selectedTask.sourceReviewId ? (
                <section className="rounded-xl border border-fuchsia-300/25 bg-fuchsia-500/10 p-3 text-xs">
                  <p className="mb-2 text-xs uppercase tracking-[0.14em] text-fuchsia-100/85">Source: Ideas Pipeline</p>
                  {ideasSourceError ? (
                    <p className="mb-2 rounded-md border border-amber-300/35 bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-100">
                      {ideasSourceError}
                    </p>
                  ) : null}
                  {ideasSourceLoading ? (
                    <p className="text-slate-300">Loading source details…</p>
                  ) : null}
                  <div className="space-y-1.5">
                    <a
                      href={`/ideas?reviewId=${encodeURIComponent(selectedTask.sourceReviewId)}${selectedTask.sourceTakeawayId ? `&takeawayId=${encodeURIComponent(selectedTask.sourceTakeawayId)}` : ""}`}
                      className="inline-flex items-center gap-1 rounded-md border border-fuchsia-300/30 bg-fuchsia-500/12 px-2 py-1 text-[11px] text-fuchsia-100 transition hover:border-fuchsia-200/60"
                    >
                      <Lightbulb className="h-3.5 w-3.5" />
                      {ideasSourceDetails?.reviewTitle ?? "Open Ideas Review"}
                    </a>
                    {ideasSourceDetails?.takeawayTitle ? (
                      <p className="text-slate-300">
                        Takeaway: <span className="text-slate-100">{ideasSourceDetails.takeawayTitle}</span>
                        {ideasSourceDetails.takeawayTimestamp ? ` (${ideasSourceDetails.takeawayTimestamp})` : ""}
                      </p>
                    ) : null}
                    {ideasSourceDetails?.reviewUrl || ideasSourceDetails?.takeawayUrl ? (
                      <a
                        href={ideasSourceDetails.takeawayUrl ?? ideasSourceDetails.reviewUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-[11px] text-amber-100 hover:text-amber-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Open original source URL
                      </a>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Subtask Checklist</p>
                {Object.keys(subtaskState).length > 0 ? (
                  <div className="space-y-1.5">
                    {Object.entries(subtaskState).map(([label, checked]) => (
                      <label key={label} className="flex cursor-pointer items-start gap-2 rounded-md border border-white/10 bg-slate-800/70 px-2 py-1.5 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            setSubtaskState((prev) => ({ ...prev, [label]: event.target.checked }))
                          }
                          className="mt-0.5 h-3.5 w-3.5"
                        />
                        <span className={checked ? "text-slate-400 line-through" : ""}>{label}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Add markdown checkboxes in description (e.g. <code>- [ ] Ship animation polish</code>) to generate subtasks.
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Activity</p>
                {selectedTask.comments && selectedTask.comments.length > 0 ? (
                  <div className="space-y-2">
                    {selectedTask.comments.slice(-6).reverse().map((comment) => (
                      <div key={comment.id} className="rounded-lg border border-white/10 bg-slate-800/80 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-slate-200">{comment.author}</p>
                          <p className="text-[11px] text-slate-500">{formatAge(comment.timestamp)}</p>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">{comment.text}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No comments yet.</p>
                )}
              </section>

              <section className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                <label className="mb-2 inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.14em] text-slate-400">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Add Comment
                </label>
                <textarea
                  value={draftComment}
                  onChange={(event) => setDraftComment(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void handlePostComment();
                    }
                  }}
                  placeholder="Share a status update or unblock note."
                  className="h-24 w-full resize-none rounded-lg border border-white/10 bg-slate-900/80 p-2 text-xs text-slate-200 outline-none focus:border-amber-300/60"
                />
                {commentError ? <p className="mt-2 text-xs text-rose-200">{commentError}</p> : null}
                <button
                  type="button"
                  disabled={postingComment || draftComment.trim().length === 0}
                  onClick={() => void handlePostComment()}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-amber-300/40 bg-amber-400/10 px-2.5 py-1 text-xs text-amber-100 disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {postingComment ? "Posting..." : "Post Comment"}
                </button>
              </section>
            </div>
          ) : null}
        </aside>
      </div>

      {!selectedTask ? null : (
        <button
          type="button"
          aria-label="Close task drawer overlay"
          onClick={() => setSelectedTaskId(null)}
          className="fixed inset-0 z-30 bg-slate-950/50 transition-opacity duration-300"
          style={{ opacity: selectedTask ? 1 : 0 }}
        />
      )}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 md:items-center">
          <div
            className="w-full max-w-xl rounded-2xl border border-white/10 bg-[linear-gradient(175deg,rgba(15,23,42,0.97),rgba(2,6,23,0.96))] p-4 shadow-[0_20px_60px_rgba(2,6,23,0.65)] md:p-5"
            role="dialog"
            aria-modal="true"
            aria-label="Create task"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/70">New Task</p>
                <h3 className="text-lg font-semibold text-white">Create Backlog Card</h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs text-slate-400">Title</span>
                <input
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
                  placeholder="Improve drag-and-drop hover states"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-slate-400">Description</span>
                <textarea
                  value={newTaskDescription}
                  onChange={(event) => setNewTaskDescription(event.target.value)}
                  className="h-24 w-full resize-none rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
                  placeholder="What needs to ship and why."
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs text-slate-400">Priority</span>
                  <select
                    value={newTaskPriority}
                    onChange={(event) => setNewTaskPriority(event.target.value as TaskPriority)}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-slate-200"
                  >
                    <option value="P0">P0</option>
                    <option value="P1">P1</option>
                    <option value="P2">P2</option>
                    <option value="P3">P3</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-400">Type</span>
                  <select
                    value={newTaskType}
                    onChange={(event) => setNewTaskType(event.target.value as TaskType)}
                    className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-slate-200"
                  >
                    <option value="feature">Feature</option>
                    <option value="bug">Bug</option>
                    <option value="research">Research</option>
                    <option value="infrastructure">Infrastructure</option>
                    <option value="directive">Directive</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </label>
              </div>

              {createError ? <p className="text-sm text-rose-200">{createError}</p> : null}

              <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-xl border border-white/15 px-3 py-2 text-sm text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={creatingTask}
                  onClick={() => void handleCreateTask()}
                  className="rounded-xl border border-amber-300/45 bg-amber-400/15 px-3 py-2 text-sm font-medium text-amber-100 disabled:opacity-60"
                >
                  {creatingTask ? "Creating..." : "Create Task"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {reviewConfirm ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/75 p-3 md:items-center">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[linear-gradient(175deg,rgba(15,23,42,0.97),rgba(2,6,23,0.96))] p-4 shadow-[0_22px_64px_rgba(2,6,23,0.68)]"
            role="dialog"
            aria-modal="true"
            aria-label="Review approval confirmation"
          >
            <p className="text-[11px] uppercase tracking-[0.14em] text-amber-100/75">Review Gate</p>
            <h3 className="mt-1 text-lg font-semibold text-white">Mark Task as Done?</h3>
            <p className="mt-2 text-sm text-slate-300">
              This moves a task from review to done. Confirm approval is complete before finalizing.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewConfirm(null)}
                className="rounded-xl border border-white/15 px-3 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const pending = reviewConfirm;
                  setReviewConfirm(null);
                  if (!pending) return;
                  void moveTask(pending.taskId, pending.status, pending.columnOrder, true);
                }}
                className="rounded-xl border border-emerald-300/45 bg-emerald-400/15 px-3 py-2 text-sm font-medium text-emerald-100"
              >
                Confirm Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkConfirm ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/75 p-3 md:items-center">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[linear-gradient(175deg,rgba(15,23,42,0.97),rgba(2,6,23,0.96))] p-4 shadow-[0_22px_64px_rgba(2,6,23,0.68)]"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm bulk action"
          >
            <p className="text-[11px] uppercase tracking-[0.14em] text-amber-100/75">Bulk Action</p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {bulkConfirm.mode === "move" ? "Move selected tasks?" : "Assign selected tasks?"}
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              {bulkConfirm.mode === "move"
                ? `Move ${bulkConfirm.taskIds.length} selected task${bulkConfirm.taskIds.length === 1 ? "" : "s"} to ${statusTheme[bulkConfirm.status].label}.`
                : `Assign ${bulkConfirm.taskIds.length} selected task${bulkConfirm.taskIds.length === 1 ? "" : "s"} to ${bulkConfirm.assignee || "Unassigned"}.`}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkConfirm(null)}
                className="rounded-xl border border-white/15 px-3 py-2 text-sm text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmBulkAction()}
                className="rounded-xl border border-amber-300/45 bg-amber-400/15 px-3 py-2 text-sm font-medium text-amber-100"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shortcutsOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/75 p-3 md:items-center">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[linear-gradient(175deg,rgba(15,23,42,0.97),rgba(2,6,23,0.96))] p-4 shadow-[0_22px_64px_rgba(2,6,23,0.68)]"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
          >
            <p className="text-[11px] uppercase tracking-[0.14em] text-amber-100/75">Keyboard</p>
            <h3 className="mt-1 text-lg font-semibold text-white">Board Shortcuts</h3>
            <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-slate-900/65 p-3 text-sm text-slate-200">
              <p><kbd className="rounded border border-white/15 bg-slate-800 px-1.5 py-0.5 text-xs">/</kbd> Focus task search</p>
              <p><kbd className="rounded border border-white/15 bg-slate-800 px-1.5 py-0.5 text-xs">N</kbd> Open new task modal</p>
              <p><kbd className="rounded border border-white/15 bg-slate-800 px-1.5 py-0.5 text-xs">↑</kbd> <kbd className="rounded border border-white/15 bg-slate-800 px-1.5 py-0.5 text-xs">↓</kbd> Navigate task cards</p>
              <p><kbd className="rounded border border-white/15 bg-slate-800 px-1.5 py-0.5 text-xs">Enter</kbd> Open focused task drawer</p>
              <p><kbd className="rounded border border-white/15 bg-slate-800 px-1.5 py-0.5 text-xs">Esc</kbd> Close overlays</p>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="rounded-xl border border-amber-300/45 bg-amber-400/15 px-3 py-2 text-sm font-medium text-amber-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function normalizeAgentKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAgentVisual(
  agentName: string | undefined,
  projectAgents: OrchestrationAgent[]
): { avatar?: string; emoji?: string; label: string } {
  if (!agentName) return { label: "System" };
  const key = normalizeAgentKey(agentName);

  const projectMatch = projectAgents.find((agent) => {
    const candidate = normalizeAgentKey(agent.name);
    return candidate === key || candidate.includes(key) || key.includes(candidate);
  });
  if (projectMatch) return { avatar: projectMatch.avatar, emoji: projectMatch.emoji, label: projectMatch.name };

  const globalMatch = AGENT_CONFIGS.find((agent) => {
    const candidate = normalizeAgentKey(agent.name);
    return candidate === key || candidate.includes(key) || key.includes(candidate);
  });
  if (globalMatch) return { avatar: globalMatch.avatar, emoji: globalMatch.emoji, label: globalMatch.name };

  return { label: agentName };
}

function BoardActivitySidebar({
  id,
  events,
  loading,
  error,
  agents,
}: {
  id: string;
  events: OrchestrationActivityEvent[];
  loading: boolean;
  error: string | null;
  agents: OrchestrationAgent[];
}) {
  return (
    <section
      id={id}
      className="mt-4 rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.9),rgba(2,6,23,0.94))] p-3 lg:mt-0 lg:sticky lg:top-[92px] lg:w-[320px] lg:shrink-0"
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-amber-300/35 bg-amber-400/10 text-amber-100">
          <Activity className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-[10px] uppercase tracking-[0.13em] text-slate-400">Board Sidebar</p>
          <h3 className="text-sm font-semibold text-white">Activity Feed</h3>
        </div>
      </div>

      {error ? (
        <p className="mb-2 rounded-lg border border-rose-400/35 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-100">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="h-14 animate-pulse rounded-xl border border-white/10 bg-slate-900/60" />
          ))}
        </div>
      ) : events.length > 0 ? (
        <div className="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
          {events.map((event) => {
            const agent = resolveAgentVisual(event.agentName, agents);
            return (
              <div
                key={event.id}
                className="rounded-xl border border-white/10 bg-slate-950/60 px-2.5 py-2 text-xs text-slate-200"
              >
                <div className="mb-1 inline-flex min-w-0 items-center gap-1.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-slate-800 text-[10px]">
                    {agent.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={agent.avatar} alt={agent.label} className="h-full w-full object-cover" />
                    ) : (
                      agent.emoji ?? agent.label.slice(0, 1).toUpperCase()
                    )}
                  </span>
                  <span className="truncate text-[11px] text-slate-300">{event.agentName ?? "System"}</span>
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-500">
                    <Clock3 className="h-3 w-3" />
                    {formatAge(event.timestamp)}
                  </span>
                </div>
                <p className="truncate text-slate-100">{event.taskTitle}</p>
                <p className="mt-1 text-[10px] text-slate-400">
                  {event.oldStatus ? (statusTheme[event.oldStatus]?.label ?? event.oldStatus) : "—"} →{" "}
                  {event.newStatus ? (statusTheme[event.newStatus]?.label ?? event.newStatus) : "—"}
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-white/10 bg-slate-900/50 px-3 py-4 text-xs text-slate-400">
          No status-change activity for this project yet.
        </p>
      )}
    </section>
  );
}

function SelectFilter({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <label className="orchestra-chip inline-flex items-center gap-2 rounded-lg px-2 py-1 text-[11px] text-slate-400">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-[11px] text-slate-200"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all"
              ? "All"
              : option === "ideas"
              ? "Ideas Pipeline"
              : option === "native"
              ? "Native Tasks"
              : option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/60 p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-200">{value}</p>
    </div>
  );
}

function BoardLane({
  column,
  taskCount,
  children,
}: {
  column: { id: TaskStatus; label: string };
  taskCount: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_ID_PREFIX}${column.id}` });
  return (
    <section
      ref={setNodeRef}
      className={`rounded-2xl border p-3 shadow-[0_12px_30px_rgba(2,6,23,0.35)] transition-colors ${
        isOver
          ? "border-amber-300/60 bg-[linear-gradient(180deg,rgba(217,119,6,0.12),rgba(2,6,23,0.88))]"
          : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.85),rgba(2,6,23,0.88))]"
      } w-full md:min-w-[300px] md:flex-1`}
    >
      <header className="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-300">
          {column.label}
        </h2>
        <span className={`rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 ${isOver ? "orchestra-pulse" : ""}`}>
          {taskCount}
        </span>
      </header>
      {children}
    </section>
  );
}

function TaskDragPreview({ task }: { task: OrchestrationTask }) {
  const priority = priorityTheme[task.priority];
  return (
    <article className="w-[292px] rotate-[1.5deg] rounded-xl border border-amber-300/40 bg-[linear-gradient(170deg,rgba(15,23,42,0.95),rgba(2,6,23,0.97))] p-3 shadow-[0_22px_52px_rgba(2,6,23,0.62)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">{typeIcon[task.type]} {task.type}</span>
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: priority.bg, color: priority.color }}>
          {priority.label}
        </span>
      </div>
      <p className="line-clamp-2 text-sm font-medium text-white">{task.title}</p>
    </article>
  );
}

function TaskCard({
  task,
  agents,
  agentLookup,
  executionState,
  nowMs,
  isSelected,
  isFocused,
  isDragging,
  dragDisabled,
  onToggleSelect,
  onStatusChange,
  onAssigneeChange,
  onFocusCard,
  onOpen,
}: {
  task: OrchestrationTask;
  agents: OrchestrationAgent[];
  agentLookup: Map<string, OrchestrationAgent>;
  executionState?: TaskExecutionState;
  nowMs: number;
  isSelected: boolean;
  isFocused: boolean;
  isDragging: boolean;
  dragDisabled: boolean;
  onToggleSelect: (checked: boolean, shiftKey: boolean) => void;
  onStatusChange: (status: TaskStatus) => void;
  onAssigneeChange: (assignee: string) => void;
  onFocusCard: () => void;
  onOpen: () => void;
}) {
  const priority = priorityTheme[task.priority];
  const staleSignal = getStaleSignal(task.status, task.updated);
  const execution = executionState ?? deriveTaskExecutionState(task, agentLookup, nowMs);
  const source = getExecutionSourceTheme(task.executionMode);
  const assigneeKey = task.assignee?.toLowerCase() ?? "";
  const assigneeAgent = assigneeKey ? agentLookup.get(assigneeKey) : undefined;
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: task.id,
    disabled: dragDisabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    boxShadow: statusTheme[task.status].glow,
    opacity: isDragging ? 0.78 : 1,
  };

  return (
    <article
      id={`task-card-${task.id}`}
      ref={setNodeRef}
      style={style}
      className={`orchestra-card group cursor-pointer rounded-xl p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300/40 ${
        isFocused ? "ring-2 ring-amber-300/55 ring-offset-1 ring-offset-slate-950" : ""
      }`}
      onClick={(event) => {
        if (event.shiftKey) {
          event.preventDefault();
          onToggleSelect(!isSelected, true);
          return;
        }
        onOpen();
      }}
      role="button"
      tabIndex={0}
      onFocus={onFocusCard}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <label className="mt-0.5 inline-flex" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(event) =>
              onToggleSelect(
                event.target.checked,
                "shiftKey" in event.nativeEvent && Boolean((event.nativeEvent as MouseEvent).shiftKey)
              )
            }
            className="h-3.5 w-3.5"
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-300">
            <span>{typeIcon[task.type]}</span>
            {task.type}
          </span>
          <button
            type="button"
            {...attributes}
            {...listeners}
            disabled={dragDisabled}
            aria-label={`Drag ${task.title}`}
            onClick={(event) => event.stopPropagation()}
            className="rounded-md border border-white/10 p-1 text-slate-400 transition hover:border-amber-300/45 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <span
            className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase"
            style={{ backgroundColor: priority.bg, color: priority.color }}
          >
            {priority.label}
          </span>
        </div>
      </div>

      <p className="mb-2 line-clamp-2 text-sm font-medium text-white transition-colors group-hover:text-amber-100">{task.title}</p>

      <div className="mb-2 flex items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] ${
            execution.phase === "running"
              ? "border-emerald-300/45 bg-emerald-400/12 text-emerald-100"
              : execution.phase === "queued"
              ? "border-amber-300/45 bg-amber-400/12 text-amber-100"
              : "border-white/10 bg-slate-800/70 text-slate-300"
          }`}
        >
          {execution.phase === "running" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
          {execution.statusLabel}
        </span>
        <span className="truncate text-[10px] text-slate-400">{execution.elapsedLabel}</span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {execution.breadcrumbTrail.map((step, index) => (
          <span
            key={`${task.id}-crumb-${step}`}
            className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
              index === execution.breadcrumbIndex
                ? "border-amber-300/45 bg-amber-400/14 text-amber-100"
                : index < execution.breadcrumbIndex
                ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100"
                : "border-white/10 bg-slate-800/70 text-slate-400"
            }`}
          >
            {step}
          </span>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span
            className={`inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-slate-800 text-[10px] ${
              execution.phase === "running" ? "orchestra-live-avatar border-emerald-300/55" : ""
            }`}
          >
            {assigneeAgent?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assigneeAgent.avatar}
                alt={assigneeAgent.name}
                className="h-full w-full object-cover"
              />
            ) : (
              assigneeAgent?.emoji ?? "•"
            )}
            {execution.phase === "running" ? <span className="orchestra-live-dot" aria-hidden="true" /> : null}
          </span>
          <span className="truncate">{task.assignee ?? "Unassigned"}</span>
        </span>
        <span className={`inline-flex items-center gap-1 ${staleSignal.severity === "critical" ? "text-rose-300" : ""}`}>
          {staleSignal.severity === "critical" ? <AlertTriangle className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
          In lane {formatAge(task.updated)}
        </span>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span className={`rounded-md border px-1.5 py-0.5 text-[10px] ${source.className}`}>{source.label}</span>
        {task.sourceReviewId ? (
          <a
            href={`/ideas?reviewId=${encodeURIComponent(task.sourceReviewId)}${task.sourceTakeawayId ? `&takeawayId=${encodeURIComponent(task.sourceTakeawayId)}` : ""}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-fuchsia-300/30 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-100 transition hover:border-fuchsia-200/55 hover:bg-fuchsia-500/18"
            title="Promoted from Ideas. Open source review."
            aria-label={`Promoted from Ideas: open source review for ${task.title}`}
          >
            <Lightbulb className="h-3 w-3" />
            Promoted from Ideas
          </a>
        ) : null}
        {task.sprint ? (
          <span className="rounded-md border border-amber-300/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-100">
            {task.sprint}
          </span>
        ) : null}
        {task.blockedReason ? (
          <span className="rounded-md border border-rose-300/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-100">
            Blocked
          </span>
        ) : null}
        {staleSignal.severity !== "none" && staleSignal.thresholdMinutes ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className={`rounded-md border px-1.5 py-0.5 text-[10px] ${
              staleSignal.severity === "critical"
                ? "border-rose-300/45 bg-rose-500/12 text-rose-100"
                : "border-amber-300/45 bg-amber-400/15 text-amber-100"
            }`}
            aria-label={`${staleSignal.severity === "critical" ? "Stale" : "Approaching stale"} task ${task.title}`}
            title={`Updated ${staleSignal.ageMinutes}m ago (threshold ${staleSignal.thresholdMinutes}m)`}
          >
            {staleSignal.severity === "critical" ? "Stale" : "Stale Risk"}
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <select
          value={task.status}
          onChange={(event) => onStatusChange(event.target.value as TaskStatus)}
          className="flex-1 rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-[11px] text-slate-200"
        >
          {ORCHESTRATION_COLUMNS.map((item) => (
            <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
        <select
          value={task.assignee ?? ""}
          onChange={(event) => onAssigneeChange(event.target.value)}
          className="flex-1 rounded-md border border-white/10 bg-slate-800 px-2 py-1 text-[11px] text-slate-200"
        >
          <option value="">Unassigned</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.name}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function moveTaskInState(tasks: OrchestrationTask[], activeTaskId: string, overId: string) {
  const activeTask = tasks.find((task) => task.id === activeTaskId);
  if (!activeTask) return tasks;

  const isOverColumn = overId.startsWith(COLUMN_ID_PREFIX);
  const targetStatus = isOverColumn
    ? (overId.slice(COLUMN_ID_PREFIX.length) as TaskStatus)
    : tasks.find((task) => task.id === overId)?.status;
  if (!targetStatus) return tasks;

  const withoutActive = tasks.filter((task) => task.id !== activeTaskId);
  const targetLane = sortLaneTasks(
    withoutActive.filter((task) => task.status === targetStatus),
    targetStatus
  );

  const overIndex = isOverColumn
    ? targetLane.length
    : Math.max(
        0,
        targetLane.findIndex((task) => task.id === overId)
      );

  const targetIndex = Math.max(0, Math.min(overIndex, targetLane.length));
  const targetOrder = computeColumnOrder(targetLane, targetIndex);

  return withoutActive.concat({
    ...activeTask,
    status: targetStatus,
    columnOrder: targetOrder,
    updated: new Date().toISOString(),
  });
}

function computeColumnOrder(lane: OrchestrationTask[], index: number) {
  const previous = lane[index - 1]?.columnOrder;
  const next = lane[index]?.columnOrder;

  if (previous === undefined && next === undefined) return COLUMN_ORDER_STEP;
  if (previous === undefined) return Math.max(0, (next ?? COLUMN_ORDER_STEP) - COLUMN_ORDER_STEP);
  if (next === undefined) return previous + COLUMN_ORDER_STEP;

  const gap = next - previous;
  if (gap > 1) return previous + Math.floor(gap / 2);
  return previous + 1;
}

function sortLaneTasks(tasks: OrchestrationTask[], status: TaskStatus) {
  return tasks
    .filter((task) => task.status === status)
    .sort((a, b) => {
      const left = a.columnOrder ?? Number.MAX_SAFE_INTEGER;
      const right = b.columnOrder ?? Number.MAX_SAFE_INTEGER;
      if (left === right) return a.id.localeCompare(b.id);
      return left - right;
    });
}

function buildChecklistState(description: string): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  const matches = description.matchAll(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/gm);

  for (const match of matches) {
    const checked = match[1].toLowerCase() === "x";
    const label = match[2].trim();
    if (label.length > 0) {
      state[label] = checked;
    }
  }

  return state;
}

function taskMatchesAgentCurrentTask(task: OrchestrationTask, agent: OrchestrationAgent): boolean {
  if (!agent.currentTask) return false;
  const current = normalizeAgentKey(agent.currentTask);
  const title = normalizeAgentKey(task.title);
  return current === title || current.includes(title) || title.includes(current);
}

function formatElapsed(minutes: number): string {
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const dayHours = hours % 24;
  return dayHours > 0 ? `${days}d ${dayHours}h` : `${days}d`;
}

function deriveTaskExecutionState(
  task: OrchestrationTask,
  agentLookup: Map<string, OrchestrationAgent>,
  nowMs: number
): TaskExecutionState {
  const assigneeKey = task.assignee?.toLowerCase() ?? "";
  const assignee = assigneeKey ? agentLookup.get(assigneeKey) : undefined;
  const updatedMs = new Date(task.updated).getTime();
  const elapsedMinutes = Number.isFinite(updatedMs) ? Math.max(0, Math.floor((nowMs - updatedMs) / 60_000)) : 0;
  const elapsedLabel = `Elapsed ${formatElapsed(elapsedMinutes)}`;
  const heartbeatLabel = assignee?.lastHeartbeat ? `${formatAge(assignee.lastHeartbeat)} ago` : undefined;

  const outputPreview = (task.comments ?? [])
    .slice()
    .reverse()
    .filter((comment) => {
      if (!task.assignee) return true;
      return normalizeAgentKey(comment.author) === normalizeAgentKey(task.assignee);
    })
    .map((comment) => comment.text.trim())
    .filter((text) => text.length > 0)
    .slice(0, 3);
  const breadcrumbIndex = deriveExecutionBreadcrumbIndex(task, outputPreview);
  const breadcrumbTrail = EXECUTION_BREADCRUMBS;

  const inProgress = task.status === "in-progress";
  const onTask = assignee ? taskMatchesAgentCurrentTask(task, assignee) : false;

  if (inProgress && assignee && assignee.status === "working" && (onTask || !assignee.currentTask)) {
    return {
      phase: "running",
      statusLabel: "Executing",
      detailLabel: `${assignee.name} is actively running this task.`,
      elapsedLabel,
      heartbeatLabel,
      outputPreview,
      breadcrumbIndex,
      breadcrumbTrail,
    };
  }

  if (inProgress && task.assignee) {
    return {
      phase: "queued",
      statusLabel: "Queued",
      detailLabel: `${task.assignee} is assigned; waiting for active execution signal.`,
      elapsedLabel,
      heartbeatLabel,
      outputPreview,
      breadcrumbIndex,
      breadcrumbTrail,
    };
  }

  return {
    phase: "idle",
    statusLabel: "Idle",
    detailLabel: "Execution resumes once the task moves to In Progress with an active assigned agent.",
    elapsedLabel,
    heartbeatLabel,
    outputPreview,
    breadcrumbIndex,
    breadcrumbTrail,
  };
}

function deriveTaskExecutionStateFromSnapshot(
  snapshot: TaskExecutionSnapshot,
  task: OrchestrationTask,
  agentLookup: Map<string, OrchestrationAgent>,
  nowMs: number
): TaskExecutionState {
  const fallback = deriveTaskExecutionState(task, agentLookup, nowMs);

  const phase: TaskExecutionState["phase"] =
    snapshot.status.state === "running"
      ? "running"
      : snapshot.status.state === "completed"
      ? "idle"
      : snapshot.status.state === "unknown"
      ? "queued"
      : fallback.phase;

  const detailParts = [
    snapshot.status.reason,
    snapshot.status.raw ? `raw: ${snapshot.status.raw}` : null,
    snapshot.transition.changed && snapshot.transition.to ? `moved to ${statusTheme[snapshot.transition.to].label}` : null,
  ].filter(Boolean) as string[];

  const detailLabel = detailParts.length > 0 ? detailParts.join(" • ") : fallback.detailLabel;
  const statusLabel =
    snapshot.status.state === "completed"
      ? "Completed"
      : snapshot.status.state === "running"
      ? "Executing"
      : snapshot.status.state === "unknown"
      ? "Checking"
      : fallback.statusLabel;

  return {
    ...fallback,
    phase,
    statusLabel,
    detailLabel,
  };
}

function deriveExecutionBreadcrumbIndex(task: OrchestrationTask, outputPreview: string[]): number {
  const latestOutput = outputPreview[0]?.toLowerCase() ?? "";

  if (task.status === "done") return 3;
  if (task.status === "review") return 3;

  if (latestOutput.length > 0) {
    if (/(playwright|test|qa|lint|verify|assert)/.test(latestOutput)) return 2;
    if (/(build|component|implement|coding|refactor|patch|ui)/.test(latestOutput)) return 1;
    if (/(explor|audit|investigat|scan|triage|analy)/.test(latestOutput)) return 0;
  }

  if (task.status === "in-progress") return 1;
  if (task.status === "blocked") return 1;
  return 0;
}

function getExecutionSourceTheme(mode: OrchestrationTask["executionMode"]): ExecutionSourceTheme {
  if (mode === "openclaw") {
    return {
      label: "OpenClaw",
      description: "OpenClaw native runtime",
      className: "border-amber-300/40 bg-amber-400/10 text-amber-100",
    };
  }

  if (mode === "paperclip") {
    return {
      label: "Bridge",
      description: "Paperclip bridge runtime",
      className: "border-stone-400/40 bg-stone-400/10 text-stone-200",
    };
  }

  return {
    label: "Bridge",
    description: "Bridge/manual execution",
    className: "border-slate-300/25 bg-slate-700/45 text-slate-200",
  };
}
