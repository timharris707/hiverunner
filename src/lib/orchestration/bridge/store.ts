import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import type { BridgeExecutionMode, BridgeTaskRecord } from "@/lib/orchestration/bridge/types";

type BridgeTaskRow = {
  id: string;
  title: string;
  description: string;
  priority: BridgeTaskRecord["priority"];
  status: BridgeTaskRecord["status"];
  project_id: string;
  project_name: string;
  company_id: string | null;
  assignee_agent_id: string | null;
  assignee_agent_name: string | null;
  assignee_openclaw_agent_id: string | null;
  assignee_paperclip_agent_id: string | null;
  paperclip_issue_id: string | null;
  execution_mode: BridgeExecutionMode;
  execution_session_id: string | null;
};

function getTaskBridgeRow(db: Database.Database, taskId: string): BridgeTaskRow | undefined {
  return db
    .prepare(
      `SELECT
         t.id,
         t.title,
         t.description,
         t.priority,
         t.status,
         t.project_id,
         p.name AS project_name,
         p.company_id,
         t.assignee_agent_id,
         a.name AS assignee_agent_name,
         a.openclaw_agent_id AS assignee_openclaw_agent_id,
         a.paperclip_agent_id AS assignee_paperclip_agent_id,
         t.paperclip_issue_id,
         t.execution_mode,
         t.execution_session_id
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.id = ? AND t.archived_at IS NULL
       LIMIT 1`
    )
    .get(taskId) as BridgeTaskRow | undefined;
}

function mapBridgeTaskRow(row: BridgeTaskRow): BridgeTaskRecord {
  if (!row.company_id) {
    throw new OrchestrationApiError(
      400,
      "bridge_company_missing",
      "Task project must belong to a company before bridge execution"
    );
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    projectId: row.project_id,
    projectName: row.project_name,
    companyId: row.company_id,
    assigneeAgentId: row.assignee_agent_id ?? undefined,
    assigneeAgentName: row.assignee_agent_name ?? undefined,
    assigneeOpenclawAgentId: row.assignee_openclaw_agent_id ?? undefined,
    assigneePaperclipAgentId: row.assignee_paperclip_agent_id ?? undefined,
    paperclipIssueId: row.paperclip_issue_id ?? undefined,
    executionMode: row.execution_mode,
    executionSessionId: row.execution_session_id ?? undefined,
  };
}

export function getTaskBridgeRecord(taskId: string, db = getOrchestrationDb()): BridgeTaskRecord {
  const row = getTaskBridgeRow(db, taskId);
  if (!row) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
  return mapBridgeTaskRow(row);
}

export function resolveTaskPaperclipAssignee(taskId: string, db = getOrchestrationDb()): {
  agentId: string;
  paperclipAgentId: string;
  agentName?: string;
} {
  const task = getTaskBridgeRecord(taskId, db);
  if (!task.assigneeAgentId) {
    throw new OrchestrationApiError(
      400,
      "assignee_required",
      "Task must be assigned before Paperclip bridge sync"
    );
  }
  if (!task.assigneePaperclipAgentId) {
    throw new OrchestrationApiError(
      400,
      "paperclip_agent_mapping_missing",
      "Assigned agent does not have a paperclipAgentId mapping"
    );
  }
  return {
    agentId: task.assigneeAgentId,
    paperclipAgentId: task.assigneePaperclipAgentId,
    agentName: task.assigneeAgentName,
  };
}

export function setTaskPaperclipIssueMapping(
  input: { taskId: string; issueId: string; executionSessionId?: string | null },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE tasks
       SET paperclip_issue_id = ?, execution_mode = 'paperclip', execution_session_id = ?, updated_at = ?
       WHERE id = ? AND archived_at IS NULL`
    )
    .run(input.issueId, input.executionSessionId ?? null, now, input.taskId);

  if (result.changes === 0) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
}

export function setTaskExecutionMode(
  input: { taskId: string; mode: BridgeExecutionMode; executionSessionId?: string | null },
  db = getOrchestrationDb()
): void {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE tasks
       SET execution_mode = ?, execution_session_id = ?, updated_at = ?
       WHERE id = ? AND archived_at IS NULL`
    )
    .run(input.mode, input.executionSessionId ?? null, now, input.taskId);

  if (result.changes === 0) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
}

export function listTaskExternalCommentRefs(
  input: { taskId: string; source: "paperclip" | "mission_control" | "openclaw" },
  db = getOrchestrationDb()
): Set<string> {
  const rows = db
    .prepare(
      `SELECT external_ref
       FROM comments
       WHERE task_id = ? AND source = ? AND external_ref IS NOT NULL`
    )
    .all(input.taskId, input.source) as Array<{ external_ref: string }>;

  return new Set(rows.map((row) => row.external_ref).filter(Boolean));
}

export function getLatestTaskExternalCommentRef(
  input: { taskId: string; source: "paperclip" | "mission_control" | "openclaw" },
  db = getOrchestrationDb()
): string | undefined {
  const row = db
    .prepare(
      `SELECT external_ref
       FROM comments
       WHERE task_id = ? AND source = ? AND external_ref IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(input.taskId, input.source) as { external_ref: string } | undefined;

  return row?.external_ref || undefined;
}
