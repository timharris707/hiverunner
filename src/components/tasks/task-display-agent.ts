import type { OrchestrationAgent } from "@/lib/orchestration/types";
import type { TaskRow } from "./types";

export function findAgentByReference(
  agents: OrchestrationAgent[],
  reference?: string | null,
): OrchestrationAgent | null {
  const normalized = cleanAgentReference(reference)?.toLowerCase();
  if (!normalized) return null;
  return agents.find((agent) =>
    agent.id.toLowerCase() === normalized ||
    agent.name.toLowerCase() === normalized ||
    agent.slug?.toLowerCase() === normalized
  ) ?? null;
}

export function cleanAgentReference(reference?: string | null): string {
  return reference?.trim().replace(/^icon:[a-z0-9-]+\s+/i, "").trim() ?? "";
}

export function taskAgentDisplayLabel(
  task: Pick<TaskRow, "assignee" | "displayAgentName"> | null | undefined,
): string | undefined {
  const displayName = cleanAgentReference(task?.displayAgentName);
  if (displayName) return displayName;
  const assignee = cleanAgentReference(task?.assignee);
  return assignee || undefined;
}

export function getTaskAgentOfRecord(
  task: Pick<TaskRow, "assignee" | "displayAgentId" | "displayAgentName"> | null | undefined,
  agents: OrchestrationAgent[],
): OrchestrationAgent | null {
  if (!task) return null;
  return (
    findAgentByReference(agents, task.displayAgentId) ??
    findAgentByReference(agents, task.displayAgentName) ??
    findAgentByReference(agents, task.assignee)
  );
}

export function shouldShowAgentOfRecord(
  task: Pick<TaskRow, "status" | "assignee" | "displayAgentId" | "displayAgentName"> | null | undefined,
): boolean {
  if (!task || task.status !== "done") return false;
  const displayRef = (task.displayAgentId ?? cleanAgentReference(task.displayAgentName)).trim().toLowerCase();
  const assigneeRef = cleanAgentReference(task.assignee).toLowerCase();
  return Boolean(displayRef && displayRef !== assigneeRef);
}
