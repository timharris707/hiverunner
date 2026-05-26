import type {
  DbSprintStatus,
  DbTaskExecutionEngine,
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
import type { TaskExecutionEngine } from "@/lib/orchestration/types";

const STATUS_API_TO_DB: Record<TaskStatusInput, DbTaskStatus> = {
  backlog: "backlog",
  "to-do": "to-do",
  "in-progress": "in_progress",
  review: "review",
  done: "done",
  blocked: "blocked",
};

const STATUS_DB_TO_API: Record<DbTaskStatus, TaskStatus> = {
  backlog: "backlog",
  "to-do": "to-do",
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
  epic: "research",
  spike: "research",
  docs: "maintenance",
  infra: "infrastructure",
  refactor: "maintenance",
  review: "research",
  qa: "research",
  release: "maintenance",
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
  blocked: "blocked",
  paused: "paused",
  done: "completed",
};

const SPRINT_STATUS_DB_TO_API: Record<DbSprintStatus, SprintStatus> = {
  planning: "planned",
  active: "active",
  blocked: "blocked",
  paused: "paused",
  completed: "done",
};

const DEFAULT_ORDER_STEP = 1000;
const DEFAULT_STALE_ALERT_THRESHOLDS_HOURS = {
  review: 1,
  inProgress: 4,
  blocked: 2,
} as const;

type ExecutionEngineResolution = {
  engine: TaskExecutionEngine;
  override: DbTaskExecutionEngine | null;
  source: "task" | "project" | "company" | "global";
};

type ExecutionRoutingDefaults = {
  runtimeProvider?: string;
  runtimeLabel?: string;
  modelRouting?: string;
  modelRoutingLabel?: string;
  activeHiveId?: string;
  activeHiveSlug?: string;
  activeHiveName?: string;
};

type ExecutionRoutingResolution = ExecutionRoutingDefaults & {
  source: "task" | "project" | "company" | "global";
};

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

function normalizeExecutionEngine(value: unknown): TaskExecutionEngine | null {
  return value === "hiverunner" || value === "symphony" || value === "manual"
    ? value
    : null;
}

function parseSettingsRecord(settingsJson: string | null | undefined): Record<string, unknown> {
  if (!settingsJson?.trim()) return {};
  try {
    const parsed = JSON.parse(settingsJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readDefaultExecutionEngine(settingsJson: string | null | undefined): TaskExecutionEngine | null {
  const settings = parseSettingsRecord(settingsJson);
  const execution = settings.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    return normalizeExecutionEngine(settings.defaultExecutionEngine);
  }
  return (
    normalizeExecutionEngine((execution as Record<string, unknown>).defaultEngine) ??
    normalizeExecutionEngine(settings.defaultExecutionEngine)
  );
}

function readExecutionRoutingDefaults(settingsJson: string | null | undefined): ExecutionRoutingDefaults {
  const settings = parseSettingsRecord(settingsJson);
  const execution = settings.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    return {};
  }
  const record = execution as Record<string, unknown>;
  const stringValue = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  return {
    runtimeProvider: stringValue(record.defaultRuntimeProvider),
    runtimeLabel: stringValue(record.defaultRuntimeLabel),
    modelRouting: stringValue(record.defaultModelRouting),
    modelRoutingLabel: stringValue(record.defaultModelRoutingLabel),
    activeHiveId: stringValue(record.activeHiveId),
    activeHiveSlug: stringValue(record.activeHiveSlug),
    activeHiveName: stringValue(record.activeHiveName),
  };
}

function readProjectSourceWorkspaceRoot(settingsJson: string | null | undefined): string | null {
  const settings = parseSettingsRecord(settingsJson);
  const workspace =
    settings.workspace &&
    typeof settings.workspace === "object" &&
    !Array.isArray(settings.workspace)
      ? settings.workspace as Record<string, unknown>
      : null;
  const candidate =
    typeof workspace?.sourceRoot === "string"
      ? workspace.sourceRoot
      : typeof settings.sourceWorkspaceRoot === "string"
        ? settings.sourceWorkspaceRoot
        : "";
  return candidate.trim() || null;
}

function resolveTaskExecutionEngine(input: {
  taskExecutionEngine?: DbTaskExecutionEngine | null;
  projectSettingsJson?: string | null;
  companySettingsJson?: string | null;
}): ExecutionEngineResolution {
  const taskEngine = normalizeExecutionEngine(input.taskExecutionEngine);
  if (taskEngine) {
    return { engine: taskEngine, override: taskEngine, source: "task" };
  }

  const projectEngine = readDefaultExecutionEngine(input.projectSettingsJson);
  if (projectEngine) {
    return { engine: projectEngine, override: null, source: "project" };
  }

  const companyEngine = readDefaultExecutionEngine(input.companySettingsJson);
  if (companyEngine) {
    return { engine: companyEngine, override: null, source: "company" };
  }

  return { engine: "hiverunner", override: null, source: "global" };
}

function resolveTaskExecutionRouting(input: {
  taskRuntimeProvider?: string | null;
  taskRuntimeLabel?: string | null;
  taskModelRouting?: string | null;
  taskModelRoutingLabel?: string | null;
  projectSettingsJson?: string | null;
  companySettingsJson?: string | null;
}): ExecutionRoutingResolution {
  const stringValue = (value: string | null | undefined) => value?.trim() || undefined;
  const taskDefaults: ExecutionRoutingDefaults = {
    runtimeProvider: stringValue(input.taskRuntimeProvider),
    runtimeLabel: stringValue(input.taskRuntimeLabel),
    modelRouting: stringValue(input.taskModelRouting),
    modelRoutingLabel: stringValue(input.taskModelRoutingLabel),
  };
  if (
    taskDefaults.runtimeProvider ||
    taskDefaults.runtimeLabel ||
    taskDefaults.modelRouting ||
    taskDefaults.modelRoutingLabel
  ) {
    return { ...taskDefaults, source: "task" };
  }

  const projectDefaults = readExecutionRoutingDefaults(input.projectSettingsJson);
  if (
    projectDefaults.runtimeProvider ||
    projectDefaults.runtimeLabel ||
    projectDefaults.modelRouting ||
    projectDefaults.modelRoutingLabel
  ) {
    return { ...projectDefaults, source: "project" };
  }

  const companyDefaults = readExecutionRoutingDefaults(input.companySettingsJson);
  if (
    companyDefaults.runtimeProvider ||
    companyDefaults.runtimeLabel ||
    companyDefaults.modelRouting ||
    companyDefaults.modelRoutingLabel
  ) {
    return { ...companyDefaults, source: "company" };
  }

  return { source: "global" };
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
  readDefaultExecutionEngine,
  readExecutionRoutingDefaults,
  readProjectSourceWorkspaceRoot,
  resolveTaskExecutionEngine,
  resolveTaskExecutionRouting,
  toDbPriority,
  toDbSprintStatus,
  toDbStatus,
  toDbType,
};
