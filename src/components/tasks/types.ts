import type { OrchestrationAgent, OrchestrationTask, TaskExecutionEngine, TaskModelLane, TaskPriority, TaskStatus, TaskType } from "@/lib/orchestration/types";

export type ViewMode = "list" | "board" | "table";
export type GroupMode = "none" | "status" | "priority" | "assignee" | "project" | "sprint" | "company-goal";
export type SortField = "id" | "title" | "status" | "priority" | "assignee" | "project" | "updated" | "created";
export type SortDir = "asc" | "desc";

export type TaskRow = OrchestrationTask & {
  projectId: string;
  projectSlug: string;
  projectName: string;
};

export interface ActiveTaskRunInfo {
  agentName: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
}

export interface TaskFilters {
  status: TaskStatus[];
  priority: TaskPriority[];
  assignee: string[];
  type: "all" | TaskType;
  query: string;
}

export interface TaskSort {
  field: SortField;
  dir: SortDir;
}

export interface TaskGroup {
  key: string;
  label: string | null;
  items: TaskRow[];
}

export interface InlineEditCallbacks {
  onStatusChange: (taskId: string, status: TaskStatus) => void | Promise<void>;
  onPriorityChange: (taskId: string, priority: TaskPriority) => void | Promise<void>;
  onAssigneeChange: (taskId: string, assignee: string) => void | Promise<void>;
  onProjectChange?: (taskId: string, projectId: string | null) => void | Promise<void>;
  onTagsChange?: (taskId: string, tags: string[]) => void | Promise<void>;
  onExecutionEngineChange?: (taskId: string, executionEngine: TaskExecutionEngine | null) => void | Promise<void>;
  onModelLaneChange?: (taskId: string, modelLane: TaskModelLane) => void | Promise<void>;
}

export const STATUS_ORDER: TaskStatus[] = ["backlog", "to-do", "in-progress", "review", "done", "blocked", "cancelled"];
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  "to-do": "To-Do",
  "in-progress": "In Progress",
  review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};
export const PRI_WEIGHT: Record<TaskPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const BOARD_COLUMNS: TaskStatus[] = ["backlog", "to-do", "in-progress", "review", "done", "blocked"];
export const UNASSIGNED_PROJECT_FILTER_ID = "__unassigned_project__";

export const TASK_TYPES: TaskType[] = ["feature", "bug", "maintenance", "research", "infrastructure", "directive"];
export const TYPE_LABEL: Record<TaskType, string> = {
  feature: "Feature",
  bug: "Bug",
  maintenance: "Maintenance",
  research: "Research",
  infrastructure: "Infrastructure",
  directive: "Directive",
  epic: "Epic",
  spike: "Spike",
  docs: "Docs",
  infra: "Infrastructure",
  refactor: "Refactor",
  review: "Review",
  qa: "QA",
  release: "Release",
};

export const SURFACE = {
  page: "var(--bg)",
  card: "var(--surface)",
  cardHover: "var(--surface-hover)",
  line: "var(--border)",
  lineSoft: "color-mix(in srgb, var(--border) 64%, transparent)",
  text: "var(--text-primary)",
  textMuted: "var(--text-secondary)",
  textDim: "var(--text-secondary)",
  textFaint: "var(--text-muted)",
  textGhost: "color-mix(in srgb, var(--text-muted) 72%, transparent)",
} as const;

export function getTaskIdentifier(task: Pick<TaskRow, "key" | "id">) {
  return task.key ?? task.id.slice(0, 8).toUpperCase();
}

export function formatShortDate(isoString: string): string {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function assigneeInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function getAgentForTask(task: Pick<TaskRow, "assignee" | "status">, agentMap: Map<string, OrchestrationAgent>) {
  if (!task.assignee) return undefined;
  return agentMap.get(task.assignee.toLowerCase());
}

export function getActiveRunLabel(task: Pick<TaskRow, "assignee" | "status">, agentMap: Map<string, OrchestrationAgent>) {
  const agent = getAgentForTask(task, agentMap);
  if ((task.status !== "in-progress" && task.status !== "review") || !agent || agent.status !== "working") return undefined;
  const symbol = agent.emoji?.startsWith("icon:") ? "" : `${agent.emoji ?? ""} `;
  return `${symbol}${agent.name}`;
}

export function getWaitingOnLabel(task: Pick<TaskRow, "waitingOn">): { label: string; tone: "blocked" | "waiting" } | undefined {
  const waiting = task.waitingOn ?? [];
  if (waiting.length === 0) return undefined;

  const labels = waiting.slice(0, 3).map((dependency) => dependency.key ?? dependency.title);
  const suffix = waiting.length > labels.length ? ` +${waiting.length - labels.length}` : "";
  return {
    label: `${waiting.some((dependency) => dependency.status === "blocked") ? "Blocked by" : "Waiting on"} ${labels.join(", ")}${suffix}`,
    tone: waiting.some((dependency) => dependency.status === "blocked") ? "blocked" : "waiting",
  };
}
