import type {
  DbSprintStatus,
  DbTaskPriority,
  DbTaskStatus,
  DbTaskType,
  SprintStatus,
  SprintStatusInput,
  TaskPriority,
  TaskPriorityInput,
  TaskStatus,
  TaskStatusInput,
  TaskType,
  TaskTypeInput,
} from "./types";

const STATUS_API_TO_DB: Record<TaskStatusInput, DbTaskStatus> = {
  backlog: "backlog",
  "on-deck": "on_deck",
  "in-progress": "in_progress",
  review: "review",
  done: "done",
  blocked: "blocked",
};

const STATUS_DB_TO_API: Record<DbTaskStatus, TaskStatus> = {
  backlog: "backlog",
  on_deck: "on-deck",
  in_progress: "in-progress",
  review: "review",
  done: "done",
  blocked: "blocked",
};

const PRIORITY_API_TO_DB: Record<TaskPriorityInput, DbTaskPriority> = {
  P0: "critical",
  P1: "high",
  P2: "medium",
  P3: "low",
};

const PRIORITY_DB_TO_API: Record<DbTaskPriority, TaskPriority> = {
  critical: "P0",
  high: "P1",
  medium: "P2",
  low: "P3",
};

const TASK_TYPE_API_TO_DB: Record<TaskTypeInput, DbTaskType> = {
  feature: "feature",
  bug: "bug",
  maintenance: "maintenance",
  research: "research",
  infrastructure: "infrastructure",
  directive: "directive",
};

const TASK_TYPE_DB_TO_API: Record<DbTaskType, TaskType> = {
  feature: "feature",
  bug: "bug",
  maintenance: "maintenance",
  research: "research",
  infrastructure: "infrastructure",
  directive: "directive",
};

const SPRINT_STATUS_API_TO_DB: Record<SprintStatusInput, DbSprintStatus> = {
  planned: "planning",
  active: "active",
  done: "completed",
};

const SPRINT_STATUS_DB_TO_API: Record<DbSprintStatus, SprintStatus> = {
  planning: "planned",
  active: "active",
  completed: "done",
};

const DEFAULT_ORDER_STEP = 1000;
const DEFAULT_STALE_ALERT_THRESHOLDS_HOURS = {
  review: 1,
  inProgress: 4,
  blocked: 2,
} as const;

function toApiStatus(status: DbTaskStatus): TaskStatus {
  return STATUS_DB_TO_API[status] ?? "backlog";
}

function toDbStatus(status: TaskStatusInput): DbTaskStatus {
  return STATUS_API_TO_DB[status];
}

function toApiPriority(priority: DbTaskPriority): TaskPriority {
  return PRIORITY_DB_TO_API[priority] ?? "P2";
}

function toDbPriority(priority: TaskPriorityInput): DbTaskPriority {
  return PRIORITY_API_TO_DB[priority];
}

function toApiType(type: DbTaskType): TaskType {
  return TASK_TYPE_DB_TO_API[type] ?? "feature";
}

function toDbType(type: TaskTypeInput): DbTaskType {
  return TASK_TYPE_API_TO_DB[type];
}

function toApiSprintStatus(status: DbSprintStatus): SprintStatus {
  return SPRINT_STATUS_DB_TO_API[status] ?? "planned";
}

function toDbSprintStatus(status: SprintStatusInput): DbSprintStatus {
  return SPRINT_STATUS_API_TO_DB[status];
}

export {
  DEFAULT_ORDER_STEP,
  DEFAULT_STALE_ALERT_THRESHOLDS_HOURS,
  toApiPriority,
  toApiSprintStatus,
  toApiStatus,
  toApiType,
  toDbPriority,
  toDbSprintStatus,
  toDbStatus,
  toDbType,
};
