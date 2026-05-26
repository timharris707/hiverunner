import type { TaskExecutionEngine, TaskModelLane, TaskPriority, TaskStatus } from "@/lib/orchestration/types";

export type CreateTaskModalInput = {
  companySlug: string;
  projectId?: string | null;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignee?: string | null;
  dueDate?: string | null;
  tags: string[];
  executionEngine: TaskExecutionEngine | null;
  modelLaneOverride: TaskModelLane | null;
  parentTaskId?: string | null;
};

export function buildCreateTaskModalInput(input: CreateTaskModalInput) {
  const isSubtask = Boolean(input.parentTaskId);

  return {
    company: input.companySlug,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    type: "feature" as const,
    status: input.status,
    ...(input.assignee ? { assignee: input.assignee } : {}),
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    labels: input.tags,
    ...(isSubtask ? { parentTaskId: input.parentTaskId as string } : {}),
    ...(!isSubtask || input.executionEngine !== null ? { executionEngine: input.executionEngine } : {}),
    ...(!isSubtask || input.modelLaneOverride !== null ? { modelLane: input.modelLaneOverride ?? "default" } : {}),
  };
}
