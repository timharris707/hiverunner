export type TaskBoardStatus = "backlog" | "to-do" | "in-progress" | "review" | "done" | "blocked";
export type TaskBoardColumnStatus = TaskBoardStatus;

export type TaskBoardTask = {
  id: string;
  status: TaskBoardStatus;
  priority?: "P0" | "P1" | "P2" | "P3" | string;
  buildState?: string;
  buildTriggeredAt?: string;
  buildQueuedAt?: string;
  buildStartedAt?: string;
  buildCompletedAt?: string;
  activeBuildId?: string;
  comments?: Array<{ timestamp?: string; author?: string }>;
  assignedAgent?: string;
  reviewAssignedTo?: string;
  updated?: string;
  completedAt?: string;
  reviewStatus?: string;
  reviewRequired?: boolean;
  reviewRequestedAt?: string;
  reviewCompletedAt?: string;
  codeReviewState?: string;
  lastReviewVerdict?: string;
  lastReviewAt?: string;
};

const ACTIVE_BUILD_STATES = new Set(["running"]);
const ACTIVE_REVIEW_STATES = new Set(["gater-reviewing"]);
const ACTIVE_REVIEW_CODE_STATES = new Set(["running"]);
const PRIORITY_ORDER: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

function parseTimestamp(value?: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getLatestTimestamp(values: Array<string | undefined>): number | null {
  let latest: number | null = null;
  for (const value of values) {
    const parsed = parseTimestamp(value);
    if (parsed !== null && (latest === null || parsed > latest)) {
      latest = parsed;
    }
  }
  return latest;
}

function getLatestCommentTimestamp(task: TaskBoardTask): number | null {
  if (!Array.isArray(task.comments) || task.comments.length === 0) return null;
  let latest: number | null = null;
  for (const comment of task.comments) {
    const parsed = parseTimestamp(comment.timestamp);
    if (parsed !== null && (latest === null || parsed > latest)) {
      latest = parsed;
    }
  }
  return latest;
}

export function getTaskPriorityRank(task: TaskBoardTask): number {
  return PRIORITY_ORDER[task.priority || ""] ?? PRIORITY_ORDER.P2;
}

export function hasActiveTaskWork(task: TaskBoardTask): boolean {
  return (
    ACTIVE_BUILD_STATES.has(task.buildState || "") ||
    ACTIVE_REVIEW_STATES.has(task.reviewStatus || "") ||
    ACTIVE_REVIEW_CODE_STATES.has(task.codeReviewState || "")
  );
}

export function getTaskActivityTimestamp(task: TaskBoardTask): number | null {
  return (
    getLatestTimestamp([
      task.buildStartedAt,
      task.buildQueuedAt,
      task.buildTriggeredAt,
      task.lastReviewAt,
      task.reviewRequestedAt,
      task.reviewCompletedAt,
    ]) ??
    getLatestCommentTimestamp(task) ??
    null
  );
}

export function hasAgentActivity(task: TaskBoardTask): boolean {
  return (
    hasActiveTaskWork(task) ||
    Boolean(task.activeBuildId) ||
    Boolean(task.assignedAgent) ||
    Boolean(task.reviewAssignedTo) ||
    getTaskActivityTimestamp(task) !== null
  );
}

function compareDescTimestamps(a: number | null, b: number | null): number {
  return (b ?? 0) - (a ?? 0);
}

export function compareTaskBoardItems(a: TaskBoardTask, b: TaskBoardTask, status: TaskBoardColumnStatus): number {
  if (status === "done") {
    return compareDescTimestamps(
      parseTimestamp(a.completedAt) ?? parseTimestamp(a.buildCompletedAt) ?? parseTimestamp(a.reviewCompletedAt) ?? parseTimestamp(a.updated),
      parseTimestamp(b.completedAt) ?? parseTimestamp(b.buildCompletedAt) ?? parseTimestamp(b.reviewCompletedAt) ?? parseTimestamp(b.updated),
    );
  }

  const priorityCompare = getTaskPriorityRank(a) - getTaskPriorityRank(b);
  if (priorityCompare !== 0) return priorityCompare;

  const activeCompare = Number(hasActiveTaskWork(b)) - Number(hasActiveTaskWork(a));
  if (activeCompare !== 0) return activeCompare;

  const agentActivityCompare = Number(hasAgentActivity(b)) - Number(hasAgentActivity(a));
  if (agentActivityCompare !== 0) return agentActivityCompare;

  const activityCompare = compareDescTimestamps(getTaskActivityTimestamp(a), getTaskActivityTimestamp(b));
  if (activityCompare !== 0) return activityCompare;

  return compareDescTimestamps(parseTimestamp(a.updated), parseTimestamp(b.updated));
}

export function buildTasksByStatus<T extends TaskBoardTask>(
  tasks: T[],
  statuses: readonly TaskBoardColumnStatus[],
): Record<TaskBoardColumnStatus, T[]> {
  const buckets = Object.fromEntries(statuses.map((status) => [status, [] as T[]])) as Record<TaskBoardColumnStatus, T[]>;

  for (const task of tasks) {
    if (task.status in buckets) {
      buckets[task.status as TaskBoardColumnStatus].push(task);
    }
  }

  for (const status of statuses) {
    buckets[status].sort((a, b) => compareTaskBoardItems(a, b, status));
  }

  return buckets;
}
