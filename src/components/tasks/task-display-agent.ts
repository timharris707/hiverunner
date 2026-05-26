import type { OrchestrationAgent } from "@/lib/orchestration/types";
import type { TaskRow } from "./types";

export function findAgentByReference(
  agents: OrchestrationAgent[],
  reference?: string | null,
): OrchestrationAgent | null {
  const normalized = reference?.trim().toLowerCase();
  if (!normalized) return null;
  return agents.find((agent) =>
    agent.id.toLowerCase() === normalized ||
    agent.name.toLowerCase() === normalized ||
    agent.slug?.toLowerCase() === normalized
  ) ?? null;
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
  const displayRef = (task.displayAgentId ?? task.displayAgentName ?? "").trim().toLowerCase();
  const assigneeRef = (task.assignee ?? "").trim().toLowerCase();
  return Boolean(displayRef && displayRef !== assigneeRef);
}
