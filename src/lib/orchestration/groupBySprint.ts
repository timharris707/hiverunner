export type GroupStatus = "planned" | "active" | "blocked" | "paused" | "done";
export type FlatTaskGroupMode = "status" | "priority" | "assignee" | "project" | "sprint" | "company-goal";

export type GroupableItem = {
  sprintId?: string | null;
  sprintKey?: string | null;
  sprintName?: string | null;
  sprintStatus?: GroupStatus | null;
  companyGoalId?: string | null;
  companyGoalKey?: string | null;
  companyGoalName?: string | null;
  companyGoalStatus?: GroupStatus | null;
  updatedAt?: string | null;
};

export type FlatGroupableItem = GroupableItem & {
  status?: string | null;
  priority?: string | null;
  assignee?: string | null;
  projectId?: string | null;
  projectName?: string | null;
};

export type FlatTaskGroup<T extends FlatGroupableItem> = {
  id: string;
  label: string;
  status?: string;
  priority?: string;
  assignee?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  sprintId?: string | null;
  sprintKey?: string | null;
  sprintName?: string | null;
  sprintStatus?: GroupStatus;
  goalId?: string | null;
  goalKey?: string | null;
  goalName?: string | null;
  goalStatus?: GroupStatus;
  updatedAt: number;
  items: T[];
};

export type SprintGroupedSprint<T extends GroupableItem> = {
  sprintId: string;
  sprintKey?: string | null;
  sprintName: string;
  sprintStatus?: GroupStatus;
  updatedAt: number;
  items: T[];
};

export type SprintGroupedGoal<T extends GroupableItem> = {
  goalId: string;
  goalKey?: string | null;
  goalName: string;
  goalStatus?: GroupStatus;
  updatedAt: number;
  sprints: SprintGroupedSprint<T>[];
};

export type SprintGroupedResult<T extends GroupableItem> = {
  groups: SprintGroupedGoal<T>[];
  unassigned: T[];
};

function statusRank(status?: GroupStatus | null): number {
  if (status === "active") return 0;
  if (status === "planned") return 1;
  if (status === "blocked") return 2;
  if (status === "paused") return 3;
  if (status === "done") return 4;
  return 3;
}

function updatedTime(item: GroupableItem): number {
  const parsed = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function sequenceFromKey(key?: string | null): number | null {
  const match = key?.match(/-S(\d+)$/i);
  return match ? Number.parseInt(match[1] ?? "", 10) : null;
}

function compareSprintSequence(a: { sprintKey?: string | null; updatedAt: number }, b: { sprintKey?: string | null; updatedAt: number }) {
  const aSeq = sequenceFromKey(a.sprintKey);
  const bSeq = sequenceFromKey(b.sprintKey);
  if (aSeq !== null && bSeq !== null && aSeq !== bSeq) return aSeq - bSeq;
  if (aSeq !== null && bSeq === null) return -1;
  if (aSeq === null && bSeq !== null) return 1;
  return a.updatedAt - b.updatedAt;
}

const TASK_STATUS_ORDER = ["backlog", "to-do", "in-progress", "review", "done", "blocked", "cancelled"];
const TASK_STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  "to-do": "To-Do",
  "in-progress": "In Progress",
  review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};
const PRIORITY_ORDER = ["P0", "P1", "P2", "P3"];
const PRIORITY_LABELS: Record<string, string> = {
  P0: "Critical",
  P1: "High",
  P2: "Medium",
  P3: "Low",
};

function priorityRank(priority?: string | null): number {
  const index = priority ? PRIORITY_ORDER.indexOf(priority) : -1;
  return index >= 0 ? index : PRIORITY_ORDER.length;
}

function taskStatusRank(status?: string | null): number {
  const index = status ? TASK_STATUS_ORDER.indexOf(status) : -1;
  return index >= 0 ? index : TASK_STATUS_ORDER.length;
}

function pushFlatItem<T extends FlatGroupableItem>(
  groups: Map<string, FlatTaskGroup<T>>,
  id: string,
  label: string,
  item: T,
  metadata: Omit<Partial<FlatTaskGroup<T>>, "id" | "label" | "items" | "updatedAt"> = {}
) {
  const latest = updatedTime(item);
  let group = groups.get(id);
  if (!group) {
    group = {
      id,
      label,
      updatedAt: latest,
      items: [],
      ...metadata,
    };
    groups.set(id, group);
  }
  group.updatedAt = Math.max(group.updatedAt, latest);
  group.items.push(item);
}

export function groupTasksFlat<T extends FlatGroupableItem>(
  items: T[],
  mode: FlatTaskGroupMode,
  options?: { statusOrder?: string[]; includeEmptyStatusGroups?: boolean }
): FlatTaskGroup<T>[] {
  const groups = new Map<string, FlatTaskGroup<T>>();

  if (mode === "status" && options?.includeEmptyStatusGroups) {
    for (const status of options.statusOrder ?? TASK_STATUS_ORDER) {
      groups.set(`status:${status}`, {
        id: `status:${status}`,
        label: TASK_STATUS_LABELS[status] ?? status,
        status,
        updatedAt: 0,
        items: [],
      });
    }
  }

  for (const item of items) {
    if (mode === "status") {
      const status = item.status ?? "backlog";
      pushFlatItem(groups, `status:${status}`, TASK_STATUS_LABELS[status] ?? status, item, { status });
      continue;
    }

    if (mode === "priority") {
      const priority = item.priority;
      const id = priority ? `priority:${priority}` : "priority:unassigned";
      pushFlatItem(groups, id, priority ? PRIORITY_LABELS[priority] ?? priority : "No priority", item, { priority: priority ?? undefined });
      continue;
    }

    if (mode === "assignee") {
      const assignee = item.assignee?.trim();
      pushFlatItem(groups, assignee ? `assignee:${assignee.toLowerCase()}` : "assignee:unassigned", assignee || "Unassigned", item, { assignee: assignee ?? null });
      continue;
    }

    if (mode === "project") {
      const projectId = item.projectId ?? null;
      pushFlatItem(groups, projectId ? `project:${projectId}` : "project:unassigned", item.projectName ?? "Unassigned", item, { projectId, projectName: item.projectName ?? null });
      continue;
    }

    if (mode === "sprint") {
      const sprintId = item.sprintId ?? null;
      const sprintLabel = item.sprintKey ? `${item.sprintKey} — ${item.sprintName ?? "Sprint"}` : item.sprintName ?? "No sprint";
      pushFlatItem(groups, sprintId ? `sprint:${sprintId}` : "sprint:unassigned", sprintLabel, item, {
        projectId: item.projectId ?? null,
        projectName: item.projectName ?? null,
        sprintId,
        sprintKey: item.sprintKey ?? null,
        sprintName: item.sprintName ?? null,
        sprintStatus: item.sprintStatus ?? undefined,
        goalId: item.companyGoalId ?? null,
        goalKey: item.companyGoalKey ?? null,
        goalName: item.companyGoalName ?? null,
        goalStatus: item.companyGoalStatus ?? undefined,
      });
      continue;
    }

    const goalId = item.companyGoalId ?? null;
    const goalLabel = item.companyGoalKey ? `${item.companyGoalKey} — ${item.companyGoalName ?? "Company goal"}` : item.companyGoalName ?? "No company goal";
    pushFlatItem(groups, goalId ? `company-goal:${goalId}` : "company-goal:unassigned", goalLabel, item, {
      goalId,
      goalKey: item.companyGoalKey ?? null,
      goalName: item.companyGoalName ?? null,
      goalStatus: item.companyGoalStatus ?? undefined,
    });
  }

  const sortedItems = (group: FlatTaskGroup<T>) => ({
    ...group,
    items: group.items.slice().sort((a, b) => updatedTime(b) - updatedTime(a)),
  });

  return Array.from(groups.values()).map(sortedItems).sort((a, b) => {
    if (mode === "status") return taskStatusRank(a.status) - taskStatusRank(b.status);
    if (mode === "priority") return priorityRank(a.priority) - priorityRank(b.priority);
    if (mode === "assignee") {
      if (!a.assignee && b.assignee) return -1;
      if (a.assignee && !b.assignee) return 1;
      return b.items.length - a.items.length || a.label.localeCompare(b.label);
    }
    if (mode === "sprint") {
      if (a.id === "sprint:unassigned") return 1;
      if (b.id === "sprint:unassigned") return -1;
      return compareSprintSequence(a, b) || statusRank(a.sprintStatus) - statusRank(b.sprintStatus) || b.updatedAt - a.updatedAt;
    }
    if (mode === "company-goal") {
      if (a.id === "company-goal:unassigned") return 1;
      if (b.id === "company-goal:unassigned") return -1;
      return statusRank(a.goalStatus) - statusRank(b.goalStatus) || b.updatedAt - a.updatedAt;
    }
    if (mode === "project") {
      if (a.id === "project:unassigned") return 1;
      if (b.id === "project:unassigned") return -1;
    }
    return a.label.localeCompare(b.label);
  });
}

export function groupBySprint<T extends GroupableItem>(
  items: T[],
  mode: "sprint" | "company-goal"
): SprintGroupedResult<T> {
  const goalMap = new Map<string, SprintGroupedGoal<T> & { sprintMap: Map<string, SprintGroupedSprint<T>> }>();
  const unassigned: T[] = [];

  for (const item of items) {
    const latest = updatedTime(item);
    if (!item.companyGoalId) {
      unassigned.push(item);
      continue;
    }

    let goal = goalMap.get(item.companyGoalId);
    if (!goal) {
      goal = {
        goalId: item.companyGoalId,
        goalKey: item.companyGoalKey ?? null,
        goalName: item.companyGoalName ?? "Company goal",
        goalStatus: item.companyGoalStatus ?? undefined,
        updatedAt: latest,
        sprints: [],
        sprintMap: new Map(),
      };
      goalMap.set(item.companyGoalId, goal);
    }
    goal.updatedAt = Math.max(goal.updatedAt, latest);

    const sprintId = mode === "company-goal"
      ? `goal:${item.companyGoalId}`
      : item.sprintId;
    const sprintName = mode === "company-goal"
      ? item.companyGoalName ?? "Company goal"
      : item.sprintName;
    const sprintKeyForGroup = mode === "company-goal" ? item.companyGoalKey : item.sprintKey;

    if (!sprintId) {
      unassigned.push(item);
      continue;
    }

    let sprint = goal.sprintMap.get(sprintId);
    if (!sprint) {
      sprint = {
        sprintId,
        sprintKey: sprintKeyForGroup ?? null,
        sprintName: sprintName ?? "Sprint",
        sprintStatus: mode === "company-goal" ? item.companyGoalStatus ?? undefined : item.sprintStatus ?? undefined,
        updatedAt: latest,
        items: [],
      };
      goal.sprintMap.set(sprintId, sprint);
      goal.sprints.push(sprint);
    }
    sprint.updatedAt = Math.max(sprint.updatedAt, latest);
    sprint.items.push(item);
  }

  return {
    groups: Array.from(goalMap.values())
      .map((goal) => ({
        goalId: goal.goalId,
        goalKey: goal.goalKey ?? null,
        goalName: goal.goalName,
        goalStatus: goal.goalStatus,
        updatedAt: goal.updatedAt,
        sprints: goal.sprints
          .map((sprint) => ({
            ...sprint,
            items: sprint.items.slice().sort((a, b) => updatedTime(b) - updatedTime(a)),
          }))
          .sort((a, b) => compareSprintSequence(a, b) || statusRank(a.sprintStatus) - statusRank(b.sprintStatus) || b.updatedAt - a.updatedAt),
      }))
      .sort((a, b) => statusRank(a.goalStatus) - statusRank(b.goalStatus) || b.updatedAt - a.updatedAt),
    unassigned: unassigned.slice().sort((a, b) => updatedTime(b) - updatedTime(a)),
  };
}

export function flattenSprintGroupedItems<T extends GroupableItem>(grouped: SprintGroupedResult<T>): T[] {
  return [
    ...grouped.groups.flatMap((goal) => goal.sprints.flatMap((sprint) => sprint.items)),
    ...grouped.unassigned,
  ];
}
