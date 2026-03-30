export type TaskBoardStatus = "backlog" | "on-deck" | "in-progress" | "review" | "done" | "blocked";
export type TaskBoardColumnStatus = Exclude<TaskBoardStatus, "blocked">;

export type TaskBoardTask = {
  id: string;
  status: TaskBoardStatus;
  updated?: string;
  reviewStatus?: string;
  reviewRequired?: boolean;
  reviewRequestedAt?: string;
  reviewCompletedAt?: string;
  codeReviewState?: string;
  lastReviewVerdict?: string;
  lastReviewAt?: string;
};

const REVIEW_TERMINAL_STATUSES = new Set(["approved", "rejected", "changes-requested", "blocked"]);
const REVIEW_ACTIVE_STATUSES = new Set(["gater-reviewing"]);
const REVIEW_ACTIVE_CODE_STATES = new Set(["pending", "running"]);
const REVIEW_MIRROR_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseTimestamp(value?: string): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getReviewActivityTimestamp(task: TaskBoardTask): number | null {
  return (
    parseTimestamp(task.lastReviewAt) ??
    parseTimestamp(task.reviewCompletedAt) ??
    parseTimestamp(task.reviewRequestedAt) ??
    parseTimestamp(task.updated)
  );
}

export function hasTerminalReviewVerdict(task: TaskBoardTask): boolean {
  return (
    REVIEW_TERMINAL_STATUSES.has(task.reviewStatus || "") ||
    task.lastReviewVerdict === "APPROVED" ||
    task.lastReviewVerdict === "NEEDS_FIX"
  );
}

export function shouldMirrorTaskIntoReviewColumn(task: TaskBoardTask, now = Date.now()): boolean {
  if (task.status === "review") return false;

  if (
    REVIEW_ACTIVE_STATUSES.has(task.reviewStatus || "") ||
    REVIEW_ACTIVE_CODE_STATES.has(task.codeReviewState || "")
  ) {
    return true;
  }

  if (!hasTerminalReviewVerdict(task)) return false;

  const reviewAt = getReviewActivityTimestamp(task);
  if (reviewAt === null) return false;

  return now - reviewAt <= REVIEW_MIRROR_WINDOW_MS;
}

export function buildTasksByStatus<T extends TaskBoardTask>(
  tasks: T[],
  statuses: readonly TaskBoardColumnStatus[],
  now = Date.now(),
): Record<TaskBoardColumnStatus, T[]> {
  const buckets = Object.fromEntries(statuses.map((status) => [status, [] as T[]])) as Record<TaskBoardColumnStatus, T[]>;

  for (const task of tasks) {
    if (task.status in buckets) {
      buckets[task.status as TaskBoardColumnStatus].push(task);
    }
  }

  for (const task of tasks) {
    if (shouldMirrorTaskIntoReviewColumn(task, now)) {
      buckets.review.push(task);
    }
  }

  buckets.review.sort((a, b) => (getReviewActivityTimestamp(b) || 0) - (getReviewActivityTimestamp(a) || 0));

  return buckets;
}
