import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

import {
  DEFAULT_ORDER_STEP,
  toApiPriority,
  toApiSprintStatus,
  toApiStatus,
  toApiType,
} from "./mappers";
import { parseJsonArray, parseProjectSettings } from "./validators";
import type {
  AgentRow,
  CommentRow,
  DbTaskStatus,
  OrchestrationAgent,
  OrchestrationProject,
  OrchestrationSprint,
  OrchestrationTask,
  ProjectAggregateRow,
  ProjectThemeRow,
  SprintRow,
  TaskRow,
  TaskWithProjectRow,
} from "./types";

/**
 * Resolve a company ID from an opaque identifier that may be an id, current slug,
 * or a historical slug alias. Returns the company UUID or undefined.
 */
function resolveCompanyId(db: Database.Database, companyIdOrSlug: string): string | undefined {
  // Try direct match first (id or current slug).
  const direct = db
    .prepare("SELECT id FROM companies WHERE (id = ? OR slug = ?) AND archived_at IS NULL")
    .get(companyIdOrSlug, companyIdOrSlug) as { id: string } | undefined;
  if (direct) return direct.id;

  // Fall back to stored slug alias.
  const alias = db
    .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(companyIdOrSlug) as { company_id: string } | undefined;
  return alias?.company_id;
}

function generateTaskKey(db: Database.Database, projectId: string): { taskNumber: number; taskKey: string } {
  const companyRow = db
    .prepare(
      `SELECT c.id AS company_id, c.company_code, c.name
       FROM projects p
       INNER JOIN companies c ON c.id = p.company_id
       WHERE p.id = ?`
    )
    .get(projectId) as { company_id: string; company_code: string | null; name: string } | undefined;

  if (!companyRow) {
    const fallbackNum = (db.prepare(`SELECT COALESCE(MAX(task_number), 0) + 1 AS n FROM tasks WHERE project_id = ?`).get(projectId) as { n: number }).n;
    return { taskNumber: fallbackNum, taskKey: `TSK-${fallbackNum}` };
  }

  const code = companyRow.company_code
    ?? companyRow.name.replace(/[\s\-_]/g, "").slice(0, 3).toUpperCase();

  // Company-scoped sequential number
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(t.task_number), 0) AS max_num
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE p.company_id = ?`
    )
    .get(companyRow.company_id) as { max_num: number };

  const taskNumber = Number(row?.max_num ?? 0) + 1;
  return { taskNumber, taskKey: `${code}-${taskNumber}` };
}

function nextColumnOrder(db: Database.Database, projectId: string, status: DbTaskStatus): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(column_order), 0) AS max_order
       FROM tasks
       WHERE project_id = ? AND status = ? AND archived_at IS NULL`
    )
    .get(projectId, status) as { max_order: number };

  return Number(row?.max_order ?? 0) + DEFAULT_ORDER_STEP;
}

function getProjectRow(db: Database.Database, idOrSlug: string): ProjectAggregateRow | undefined {
  return db
    .prepare(
      `SELECT
          p.id,
          p.company_id,
          p.slug,
          p.name,
          p.description,
          p.color,
          p.status,
          p.owner_user_id,
          p.settings_json,
          p.created_at,
          COUNT(t.id) AS total_tasks,
          SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
          SUM(CASE WHEN t.status = 'backlog' THEN 1 ELSE 0 END) AS backlog_tasks,
          SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) AS review_tasks,
          SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_tasks
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id AND t.archived_at IS NULL
       WHERE (p.id = ? OR p.slug = ?) AND p.archived_at IS NULL
       GROUP BY p.id`
    )
    .get(idOrSlug, idOrSlug) as ProjectAggregateRow | undefined;
}

function projectFromRow(db: Database.Database, row: ProjectAggregateRow): OrchestrationProject {
  const activeAgentsRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM agents
       WHERE project_id = ?
         AND archived_at IS NULL
         AND status IN ('working','idle')`
    )
    .get(row.id) as { count: number };

  const settings = parseProjectSettings(row.settings_json);

  return {
    id: row.id,
    companyId: row.company_id ?? undefined,
    slug: row.slug,
    name: row.name,
    description: row.description,
    emoji: settings.emoji,
    color: row.color,
    owner: row.owner_user_id ?? undefined,
    status: row.status,
    created: row.created_at,
    taskCount: Number(row.total_tasks ?? 0),
    inProgress: Number(row.in_progress_tasks ?? 0),
    backlog: Number(row.backlog_tasks ?? 0),
    review: Number(row.review_tasks ?? 0),
    completed: Number(row.done_tasks ?? 0),
    activeAgents: Number(activeAgentsRow?.count ?? 0),
  };
}

function taskFromRow(row: TaskRow, comments: OrchestrationTask["comments"] = []): OrchestrationTask {
  return {
    id: row.id,
    key: row.task_key ?? undefined,
    title: row.title,
    description: row.description,
    parentTaskId: row.parent_task_id ?? undefined,
    status: toApiStatus(row.status),
    columnOrder: row.column_order,
    priority: toApiPriority(row.priority),
    type: toApiType(row.type),
    project: row.project_id,
    assignee: row.assignee_name ?? undefined,
    tags: parseJsonArray(row.labels_json),
    sprint: row.sprint_name ?? undefined,
    blockedReason: row.blocked_reason ?? undefined,
    executionMode: row.execution_mode,
    createdBy: row.created_by ?? undefined,
    sourceReviewId: row.source_review_id ?? undefined,
    sourceTakeawayId: row.source_takeaway_id ?? undefined,
    created: row.created_at,
    updated: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    comments,
  };
}

function sprintFromRow(row: SprintRow): OrchestrationSprint {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    goal: row.goal,
    status: toApiSprintStatus(row.status),
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    created: row.created_at,
    updated: row.updated_at,
    taskCount: Number(row.task_count ?? 0),
    inProgressCount: Number(row.in_progress_count ?? 0),
    reviewCount: Number(row.review_count ?? 0),
    doneCount: Number(row.done_count ?? 0),
  };
}

function commentViewFromRow(row: CommentRow): NonNullable<OrchestrationTask["comments"]>[number] {
  return {
    id: row.id,
    author: row.author_name ?? row.author_user_id ?? "System",
    authorEmoji: row.author_emoji ?? undefined,
    text: row.body,
    timestamp: row.created_at,
    type: row.type,
  };
}

function getTaskRowForUpdate(db: Database.Database, taskId: string): TaskWithProjectRow | undefined {
  return db
    .prepare(
      `SELECT
        id,
        project_id,
        sprint_id,
        parent_task_id,
        title,
        description,
        priority,
        type,
        assignee_agent_id,
        assigned_at,
        status,
        column_order,
        blocked_reason,
        labels_json,
        source_review_id,
        source_takeaway_id,
        review_notes,
        started_at,
        completed_at
       FROM tasks
       WHERE id = ? AND archived_at IS NULL`
    )
    .get(taskId) as TaskWithProjectRow | undefined;
}

function resolveAssigneeAgent(
  db: Database.Database,
  projectId: string,
  assignee: string
): { id: string; name: string } | undefined {
  const normalized = assignee.trim();
  if (!normalized) return undefined;

  return db
    .prepare(
      `SELECT id, name
       FROM agents
       WHERE company_id = (
           SELECT company_id
           FROM projects
           WHERE id = ? AND archived_at IS NULL
         )
         AND archived_at IS NULL
         AND (id = ? OR lower(name) = lower(?))
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, created_at ASC
       LIMIT 1`
    )
    .get(projectId, normalized, normalized, normalized) as { id: string; name: string } | undefined;
}

function resolveSingleEligibleAssignee(
  db: Database.Database,
  projectId: string
): { id: string; name: string } | undefined {
  const rows = db
    .prepare(
      `SELECT id, name
       FROM agents
       WHERE company_id = (
           SELECT company_id
           FROM projects
           WHERE id = ? AND archived_at IS NULL
         )
         AND archived_at IS NULL
         AND status IN ('idle','working')
       ORDER BY updated_at DESC, created_at ASC
       LIMIT 2`
    )
    .all(projectId) as Array<{ id: string; name: string }>;

  if (rows.length !== 1) return undefined;
  return rows[0];
}

function resolveProjectAvatarTheme(
  db: Database.Database,
  projectId: string
): { name: string; promptTemplate: string; keywords: string[] } {
  const row = db
    .prepare(
      `SELECT
        c.theme_name AS company_theme_name,
        c.theme_prompt_template AS company_prompt_template,
        c.theme_keywords_json AS company_keywords_json,
        at.name AS catalog_theme_name,
        at.prompt_template AS catalog_prompt_template,
        at.style_keywords_json AS catalog_keywords_json
       FROM projects p
       LEFT JOIN companies c ON c.id = p.company_id AND c.archived_at IS NULL
       LEFT JOIN avatar_themes at ON at.company_id = c.id AND at.is_default = 1
       WHERE p.id = ?
       LIMIT 1`
    )
    .get(projectId) as ProjectThemeRow | undefined;

  return {
    name: row?.company_theme_name ?? row?.catalog_theme_name ?? "Corporate Noir",
    promptTemplate:
      row?.company_prompt_template ??
      row?.catalog_prompt_template ??
      "dark premium portrait, cohesive team style",
    keywords: parseJsonArray(row?.company_keywords_json ?? row?.catalog_keywords_json ?? "[]"),
  };
}

function refreshAgentLoad(db: Database.Database, agentId: string): void {
  const active = db
    .prepare(
      `SELECT id
       FROM tasks
       WHERE assignee_agent_id = ? AND status = 'in_progress' AND archived_at IS NULL
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(agentId) as { id: string } | undefined;

  const currentAgent = db
    .prepare("SELECT status FROM agents WHERE id = ?")
    .get(agentId) as { status: AgentRow["status"] } | undefined;

  if (!currentAgent) return;

  if (active) {
    db.prepare(
      `UPDATE agents
       SET status = 'working', current_task_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(active.id, new Date().toISOString(), agentId);
    return;
  }

  const keepStatus = currentAgent.status === "paused" || currentAgent.status === "offline";
  db.prepare(
    `UPDATE agents
     SET status = ?, current_task_id = NULL, updated_at = ?
     WHERE id = ?`
  ).run(keepStatus ? currentAgent.status : "idle", new Date().toISOString(), agentId);
}

function fetchTaskRowsForProject(db: Database.Database, projectId: string): TaskRow[] {
  return db
    .prepare(
      `SELECT
        t.id,
        t.project_id,
        t.sprint_id,
        s.name AS sprint_name,
        t.parent_task_id,
        t.title,
        t.description,
        t.priority,
        t.type,
        t.status,
        t.column_order,
        t.assignee_agent_id,
        a.name AS assignee_name,
        t.blocked_reason,
        t.execution_mode,
        t.labels_json,
        t.source_review_id,
        t.source_takeaway_id,
        t.task_key,
        t.created_at,
        t.updated_at,
        t.completed_at
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       WHERE t.project_id = ? AND t.archived_at IS NULL
       ORDER BY
         CASE t.status
           WHEN 'backlog' THEN 1
           WHEN 'on_deck' THEN 2
           WHEN 'in_progress' THEN 3
           WHEN 'review' THEN 4
           WHEN 'done' THEN 5
           WHEN 'blocked' THEN 6
           ELSE 7
         END,
         t.column_order ASC,
         t.created_at ASC`
    )
    .all(projectId) as TaskRow[];
}

function commentsForTasks(
  db: Database.Database,
  taskIds: string[]
): Map<string, NonNullable<OrchestrationTask["comments"]>> {
  if (taskIds.length === 0) return new Map();

  const placeholders = taskIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT
        c.id,
        c.task_id,
        c.body,
        c.type,
        c.source,
        c.external_ref,
        c.created_at,
        a.name AS author_name,
        a.emoji AS author_emoji,
        c.author_user_id
       FROM comments c
       LEFT JOIN agents a ON a.id = c.author_agent_id
       WHERE c.task_id IN (${placeholders})
       ORDER BY c.created_at ASC`
    )
    .all(...taskIds) as CommentRow[];

  const map = new Map<string, NonNullable<OrchestrationTask["comments"]>>();
  for (const row of rows) {
    const existing = map.get(row.task_id) ?? [];
    existing.push(commentViewFromRow(row));
    map.set(row.task_id, existing);
  }

  return map;
}

function agentFromRow(
  row: AgentRow,
  overrides?: {
    status?: OrchestrationAgent["status"];
    currentTask?: string;
  }
): OrchestrationAgent {
  const effectiveStatus = overrides?.status ?? row.status;
  const effectiveCurrentTask =
    effectiveStatus === "working"
      ? (overrides?.currentTask ?? row.current_task_title ?? undefined)
      : undefined;

  return {
    id: row.id,
    companyId: row.company_id,
    slug: row.slug || row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    projectId: row.project_id ?? undefined,
    name: row.name,
    emoji: row.emoji ?? "🤖",
    role: row.role,
    avatar: row.avatar_url ?? undefined,
    status: effectiveStatus,
    currentTask: effectiveCurrentTask,
    personality: row.personality,
    model: row.model ?? undefined,
    adapterType: row.adapter_type ?? "openclaw",
    paperclipAgentId: row.paperclip_agent_id ?? undefined,
    openclawAgentId: row.openclaw_agent_id ?? undefined,
    reportingTo: row.reporting_to ?? undefined,
    reportingToName: row.reporting_to_name ?? undefined,
    skills: parseJsonArray(row.skills_json),
    tasksCompleted: Number(row.tasks_completed ?? 0),
    totalRuntimeMinutes: Number(row.total_runtime_minutes ?? 0),
    lastHeartbeat: row.last_heartbeat ?? undefined,
    created: row.created_at,
    updated: row.updated_at,
  };
}

function agentById(db: Database.Database, agentId: string): AgentRow | undefined {
  return db
    .prepare(
      `SELECT
        a.id,
        a.company_id,
        a.project_id,
        a.name,
        a.slug,
        a.emoji,
        a.role,
        a.personality,
        a.avatar_url,
        a.status,
        a.current_task_id,
        t.title AS current_task_title,
        a.model,
        a.adapter_type,
        a.paperclip_agent_id,
        a.openclaw_agent_id,
        a.reporting_to,
        mgr.name AS reporting_to_name,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       LEFT JOIN agents mgr ON mgr.id = a.reporting_to
       WHERE a.id = ? AND a.archived_at IS NULL`
    )
    .get(agentId) as AgentRow | undefined;
}

function taskById(db: Database.Database, taskId: string): OrchestrationTask {
  const row = db
    .prepare(
      `SELECT
        t.id,
        t.project_id,
        t.sprint_id,
        s.name AS sprint_name,
        t.parent_task_id,
        t.title,
        t.description,
        t.priority,
        t.type,
        t.status,
        t.column_order,
        t.assignee_agent_id,
        a.name AS assignee_name,
        t.blocked_reason,
        t.execution_mode,
        t.created_by,
        t.labels_json,
        t.source_review_id,
        t.source_takeaway_id,
        t.task_key,
        t.created_at,
        t.updated_at,
        t.completed_at
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       WHERE (t.id = ? OR t.task_key = ?) AND t.archived_at IS NULL`
    )
    .get(taskId, taskId) as TaskRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const comments = commentsForTasks(db, [row.id]).get(row.id) ?? [];
  return taskFromRow(row, comments);
}

function sprintById(db: Database.Database, sprintId: string): SprintRow | undefined {
  return db
    .prepare(
      `SELECT
        s.id,
        s.project_id,
        s.name,
        s.goal,
        s.status,
        s.start_date,
        s.end_date,
        s.created_at,
        s.updated_at,
        COUNT(t.id) AS task_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) AS review_count,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM sprints s
       LEFT JOIN tasks t ON t.sprint_id = s.id AND t.archived_at IS NULL
       WHERE s.id = ?
       GROUP BY s.id`
    )
    .get(sprintId) as SprintRow | undefined;
}

export {
  OrchestrationApiError,
  commentsForTasks,
  commentViewFromRow,
  fetchTaskRowsForProject,
  generateTaskKey,
  getOrchestrationDb,
  getProjectRow,
  getTaskRowForUpdate,
  nextColumnOrder,
  projectFromRow,
  refreshAgentLoad,
  resolveAssigneeAgent,
  resolveCompanyId,
  resolveProjectAvatarTheme,
  resolveSingleEligibleAssignee,
  sprintById,
  sprintFromRow,
  taskById,
  taskFromRow,
  agentById,
  agentFromRow,
};
