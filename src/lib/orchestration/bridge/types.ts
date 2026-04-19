export type LocalTaskPriorityDb = "critical" | "high" | "medium" | "low";
export type LocalTaskStatusDb =
  | "backlog"
  | "on_deck"
  | "in_progress"
  | "review"
  | "done"
  | "blocked";

export type PaperclipIssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type PaperclipIssuePriority = "critical" | "high" | "medium" | "low";

export type BridgeExecutionMode = "manual" | "paperclip" | "openclaw";

export interface BridgeTaskRecord {
  id: string;
  title: string;
  description: string;
  priority: LocalTaskPriorityDb;
  status: LocalTaskStatusDb;
  projectId: string;
  projectName: string;
  companyId: string;
  assigneeAgentId?: string;
  assigneeAgentName?: string;
  assigneeOpenclawAgentId?: string;
  assigneePaperclipAgentId?: string;
  paperclipIssueId?: string;
  executionMode: BridgeExecutionMode;
  executionSessionId?: string;
}

export interface PaperclipIssueReference {
  id: string;
  identifier: string;
  status: PaperclipIssueStatus;
  priority: PaperclipIssuePriority;
  assigneeAgentId?: string;
  assigneeUserId?: string;
  /**
   * The Paperclip issue id of this issue's parent, if any. Set by
   * Paperclip when the issue is linked as a sub-issue. Consumed by
   * `pullTaskBridgeStatus` to reconcile `tasks.parent_task_id` on the
   * MC side — fixes Bug B from the 2026-04-18 WEA-211 investigation,
   * where the bridge only pulled status + comments and left MC flat
   * even though the Paperclip tree had a parent.
   */
  parentId?: string;
}

export interface PaperclipIssueComment {
  id: string;
  body: string;
  createdAt: string;
  authorAgentId?: string;
  authorUserId?: string;
}

export interface PaperclipIssueCreateInput {
  title: string;
  description?: string;
  priority: PaperclipIssuePriority;
  status?: PaperclipIssueStatus;
  assigneeAgentId?: string;
  goalId?: string;
  projectId?: string;
  parentId?: string;
}

export interface PaperclipIssueUpdateInput {
  title?: string;
  description?: string;
  priority?: PaperclipIssuePriority;
  status?: PaperclipIssueStatus;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  comment?: string;
}

export interface PaperclipAgentWakeInput {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  forceFreshSession?: boolean;
}

export interface PaperclipAgentWakeResult {
  status: "queued" | "running" | "skipped";
  runId?: string;
}

export type BridgeMappingErrorCode =
  | "missing_project_company"
  | "missing_paperclip_issue_mapping"
  | "missing_assignee"
  | "missing_paperclip_agent_mapping";

export interface BridgeMappingError {
  code: BridgeMappingErrorCode;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
}

export interface BridgeHealthStatusResult {
  checkedAt: string;
  connection: {
    ok: boolean;
    agentId?: string;
    error?: {
      code: string;
      message: string;
      retriable?: boolean;
    };
  };
  sync: {
    lastSyncedAt: string | null;
    paperclipTaskCount: number;
    mappedTaskCount: number;
  };
  mapping: {
    errorCount: number;
    errors: BridgeMappingError[];
  };
}
