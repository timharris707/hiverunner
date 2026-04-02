import type {
  BridgeTaskRecord,
  LocalTaskStatusDb,
  PaperclipIssuePriority,
  PaperclipIssueStatus,
} from "@/lib/orchestration/bridge/types";

const PRIORITY_MAP: Record<BridgeTaskRecord["priority"], PaperclipIssuePriority> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

const STATUS_TO_PAPERCLIP: Record<LocalTaskStatusDb, PaperclipIssueStatus> = {
  backlog: "backlog",
  on_deck: "todo",
  in_progress: "in_progress",
  review: "in_review",
  done: "done",
  blocked: "blocked",
};

const STATUS_FROM_PAPERCLIP: Record<PaperclipIssueStatus, LocalTaskStatusDb> = {
  backlog: "backlog",
  todo: "on_deck",
  in_progress: "in_progress",
  in_review: "review",
  done: "done",
  blocked: "blocked",
  cancelled: "blocked",
};

export function mapLocalPriorityToPaperclip(priority: BridgeTaskRecord["priority"]): PaperclipIssuePriority {
  return PRIORITY_MAP[priority];
}

export function mapLocalStatusToPaperclip(status: LocalTaskStatusDb): PaperclipIssueStatus {
  return STATUS_TO_PAPERCLIP[status];
}

export function mapPaperclipStatusToLocal(status: PaperclipIssueStatus): LocalTaskStatusDb {
  return STATUS_FROM_PAPERCLIP[status];
}

export function buildPaperclipIssueDescription(task: BridgeTaskRecord): string {
  const lines = [
    task.description.trim(),
    "",
    "---",
    "## Mission Control Bridge Metadata",
    `- mcTaskId: ${task.id}`,
    `- mcProjectId: ${task.projectId}`,
    `- mcProjectName: ${task.projectName}`,
  ];

  if (task.assigneeAgentId) {
    lines.push(`- mcAssigneeAgentId: ${task.assigneeAgentId}`);
  }
  if (task.assigneeAgentName) {
    lines.push(`- mcAssigneeAgentName: ${task.assigneeAgentName}`);
  }

  return lines.join("\n").trim();
}
