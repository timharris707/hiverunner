import type { OrchestrationAgent, OrchestrationTask, TaskPriority, TaskStatus, TaskType } from "@/lib/orchestration/types";

export type ViewMode = "list" | "board" | "table";
export type GroupMode = "none" | "status" | "priority" | "assignee" | "project";
export type SortField = "id" | "title" | "status" | "priority" | "assignee" | "project" | "updated" | "created";
export type SortDir = "asc" | "desc";

export type TaskRow = OrchestrationTask & {
  projectId: string;
  projectSlug: string;
  projectName: string;
};

export interface TaskFilters {
  status: "all" | TaskStatus;
  priority: "all" | TaskPriority;
  assignee: "all" | string;
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
}

export const STATUS_ORDER: TaskStatus[] = ["in-progress", "on-deck", "review", "blocked", "backlog", "done", "cancelled"];
export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  "on-deck": "On Deck",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};
export const PRI_WEIGHT: Record<TaskPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const BOARD_COLUMNS: TaskStatus[] = ["backlog", "on-deck", "in-progress", "review", "blocked", "done"];

export const TASK_TYPES: TaskType[] = ["feature", "bug", "maintenance", "research", "infrastructure", "directive"];
export const TYPE_LABEL: Record<TaskType, string> = {
  feature: "Feature",
  bug: "Bug",
  maintenance: "Maintenance",
  research: "Research",
  infrastructure: "Infrastructure",
  directive: "Directive",
};

export const SURFACE = {
  page: "#0c0a09",
  card: "rgba(41,37,36,0.5)",
  cardHover: "rgba(41,37,36,0.68)",
  line: "rgba(120,113,108,0.15)",
  lineSoft: "rgba(120,113,108,0.08)",
  text: "#f5f5f4",
  textMuted: "#d6d3d1",
  textDim: "#a8a29e",
  textFaint: "#78716c",
  textGhost: "#57534e",
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
  if (task.status !== "in-progress" || !agent || agent.status !== "working") return undefined;
  return `${agent.emoji ?? "🤖"} ${agent.name}`;
}
