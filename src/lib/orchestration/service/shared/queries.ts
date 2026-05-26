import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { normalizeAgentSymbol } from "@/lib/orchestration/avatar-icons";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveAgentModelDisplay } from "@/lib/orchestration/agent-model-display";
import { normalizeAgentAdapterType } from "@/lib/orchestration/service/provider-activation";
import { isHiveRunnerSystemAuthor } from "@/lib/orchestration/system-authors";

import {
  DEFAULT_ORDER_STEP,
  readDefaultExecutionEngine,
  resolveTaskExecutionEngine,
  resolveTaskExecutionRouting,
  toApiPriority,
  toApiSprintStatus,
  toApiStatus,
  toApiType,
} from "./mappers";
import { parseJsonArray, parseProjectSettings } from "./validators";
import type {
  OrchestrationTaskDependency,
} from "@/lib/orchestration/types";
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
function resolveCompanyId(
  db: Database.Database,
  companyIdOrSlug: string,
  input?: { ownerUserId?: string }
): string | undefined {
  const ownerUserId = input?.ownerUserId?.trim();
  const ownerClause = ownerUserId ? "AND owner_user_id = ?" : "";
  // Try direct match first (id or current slug).
  const direct = db
    .prepare(`SELECT id FROM companies WHERE (id = ? OR slug = ? OR UPPER(company_code) = UPPER(?)) AND archived_at IS NULL ${ownerClause}`)
    .get(...(ownerUserId
      ? [companyIdOrSlug, companyIdOrSlug, companyIdOrSlug, ownerUserId]
      : [companyIdOrSlug, companyIdOrSlug, companyIdOrSlug])) as { id: string } | undefined;
  if (direct) return direct.id;

  // Fall back to stored slug alias.
  const alias = db
    .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(companyIdOrSlug) as { company_id: string } | undefined;
  if (!alias) return undefined;
  if (!ownerUserId) return alias.company_id;

  const ownedAliasTarget = db
    .prepare("SELECT id FROM companies WHERE id = ? AND owner_user_id = ? AND archived_at IS NULL LIMIT 1")
    .get(alias.company_id, ownerUserId) as { id: string } | undefined;
  return ownedAliasTarget?.id;
}

function generateTaskKey(db: Database.Database, companyOrProjectId: string): { taskNumber: number; taskKey: string } {
  const companyRow = db
    .prepare(
      `SELECT c.id AS company_id, c.company_code, c.name
         FROM companies c
        WHERE c.id = ? AND c.archived_at IS NULL
       UNION
       SELECT c.id AS company_id, c.company_code, c.name
         FROM projects p
         INNER JOIN companies c ON c.id = p.company_id
        WHERE p.id = ? AND p.archived_at IS NULL
       LIMIT 1`
    )
    .get(companyOrProjectId, companyOrProjectId) as { company_id: string; company_code: string | null; name: string } | undefined;

  if (!companyRow) {
    const fallbackNum = (db.prepare(`SELECT COALESCE(MAX(task_number), 0) + 1 AS n FROM tasks`).get() as { n: number }).n;
    return { taskNumber: fallbackNum, taskKey: `TSK-${fallbackNum}` };
  }

  const code = companyRow.company_code
    ?? companyRow.name.replace(/[\s\-_]/g, "").slice(0, 3).toUpperCase();

  // Company-scoped sequential number. Some historical/task-recovery paths wrote
  // task_key without task_number; include the human-readable suffix so the next
  // allocation cannot reuse an existing key.
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(
         MAX(
           COALESCE(t.task_number, 0),
           CASE
             WHEN t.task_key GLOB ?
               THEN CAST(SUBSTR(t.task_key, ?) AS INTEGER)
             ELSE 0
           END
         )
       ), 0) AS max_num
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE COALESCE(p.company_id, t.company_id) = ?`
    )
    .get(`${code}-[0-9]*`, code.length + 2, companyRow.company_id) as { max_num: number };

  const taskNumber = Number(row?.max_num ?? 0) + 1;
  return { taskNumber, taskKey: `${code}-${taskNumber}` };
}

function nextColumnOrder(db: Database.Database, projectId: string | null, status: DbTaskStatus, companyId?: string | null): number {
  if (!projectId) {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(column_order), 0) AS max_order
         FROM tasks
         WHERE project_id IS NULL
           AND (? IS NULL OR company_id = ?)
           AND status = ?
           AND archived_at IS NULL`
      )
      .get(companyId ?? null, companyId ?? null, status) as { max_order: number };

    return Number(row?.max_order ?? 0) + DEFAULT_ORDER_STEP;
  }

  const row = db
    .prepare(
      `SELECT COALESCE(MAX(column_order), 0) AS max_order
       FROM tasks
       WHERE project_id = ? AND status = ? AND archived_at IS NULL`
    )
    .get(projectId, status) as { max_order: number };

  return Number(row?.max_order ?? 0) + DEFAULT_ORDER_STEP;
}

function getProjectRow(
  db: Database.Database,
  idOrSlug: string,
  options?: { includeArchived?: boolean },
): ProjectAggregateRow | undefined {
  const archivedPredicate = options?.includeArchived ? "1=1" : "p.archived_at IS NULL";
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
          p.archived_at,
          COUNT(t.id) AS total_tasks,
          SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
          SUM(CASE WHEN t.status = 'backlog' THEN 1 ELSE 0 END) AS backlog_tasks,
          SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) AS review_tasks,
          SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_tasks
       FROM projects p
       LEFT JOIN tasks t ON t.project_id = p.id AND t.archived_at IS NULL
       WHERE (p.id = ? OR p.slug = ?) AND ${archivedPredicate}
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
    status: row.archived_at ? "archived" : row.status,
    created: row.created_at,
    sourceWorkspaceRoot: settings.sourceWorkspaceRoot,
    defaultExecutionEngine: readDefaultExecutionEngine(row.settings_json) ?? undefined,
    taskCount: Number(row.total_tasks ?? 0),
    inProgress: Number(row.in_progress_tasks ?? 0),
    backlog: Number(row.backlog_tasks ?? 0),
    review: Number(row.review_tasks ?? 0),
    completed: Number(row.done_tasks ?? 0),
    activeAgents: Number(activeAgentsRow?.count ?? 0),
  };
}

function dependencySummariesForTaskRows(
  db: Database.Database,
  rows: Pick<TaskRow, "id" | "depends_on_json">[],
): Map<string, { dependencies: OrchestrationTaskDependency[]; waitingOn: OrchestrationTaskDependency[] }> {
  const idsByTask = new Map<string, string[]>();
  const dependencyIds = new Set<string>();
  for (const row of rows) {
    const ids = parseJsonArray(row.depends_on_json).filter(Boolean);
    idsByTask.set(row.id, ids);
    for (const id of ids) dependencyIds.add(id);
  }
  if (dependencyIds.size === 0) return new Map();

  const ids = Array.from(dependencyIds);
  const placeholders = ids.map(() => "?").join(",");
  const dependencyRows = db
    .prepare(
      `SELECT t.id, t.task_key, t.title, t.status, a.name AS assignee_name
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.id IN (${placeholders})
         AND t.archived_at IS NULL`,
    )
    .all(...ids) as Array<{
      id: string;
      task_key: string | null;
      title: string;
      status: TaskRow["status"];
      assignee_name: string | null;
    }>;

  const byId = new Map(dependencyRows.map((row) => [row.id, row] as const));
  const result = new Map<string, { dependencies: OrchestrationTaskDependency[]; waitingOn: OrchestrationTaskDependency[] }>();
  for (const [taskId, taskDependencyIds] of idsByTask.entries()) {
    const dependencies = taskDependencyIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<ReturnType<typeof byId.get>> => Boolean(row))
      .map((row) => ({
        id: row.id,
        key: row.task_key ?? undefined,
        title: row.title,
        status: toApiStatus(row.status),
        assignee: row.assignee_name ?? undefined,
      }));
    if (dependencies.length === 0) continue;
    result.set(taskId, {
      dependencies,
      waitingOn: dependencies.filter((dependency) => dependency.status !== "done"),
    });
  }
  return result;
}

function taskFromRow(
  row: TaskRow,
  comments: OrchestrationTask["comments"] = [],
  dependencyInfo?: { dependencies: OrchestrationTaskDependency[]; waitingOn: OrchestrationTaskDependency[] },
): OrchestrationTask {
  const executionEngine = resolveTaskExecutionEngine({
    taskExecutionEngine: row.execution_engine,
    projectSettingsJson: row.project_settings_json,
    companySettingsJson: row.company_settings_json,
  });

  const apiStatus = toApiStatus(row.status);
  const displayAgent =
    (apiStatus === "done" || apiStatus === "review") && row.source_agent_id
      ? {
          id: row.source_agent_id,
          name: row.source_agent_name,
          source: "runner" as const,
          provider: row.source_run_runner_provider ?? row.source_run_provider ?? row.execution_runtime_provider,
          model: row.source_run_runner_model ?? row.source_agent_model,
        }
      : {
          id: row.assignee_agent_id,
          name: row.assignee_name,
          source: "assignee" as const,
          provider: row.execution_runtime_provider,
          model: row.assignee_model,
        };
  const modelDisplay = resolveAgentModelDisplay({
    provider: displayAgent.provider,
    model: displayAgent.model,
    executionEngine: row.execution_engine,
  });

  return {
    id: row.id,
    key: row.task_key ?? undefined,
    title: row.title,
    description: row.description,
    parentTaskId: row.parent_task_id ?? undefined,
    status: apiStatus,
    columnOrder: row.column_order,
    priority: toApiPriority(row.priority),
    type: toApiType(row.type),
    project: row.project_id ?? "",
    assignee: row.assignee_name ?? undefined,
    displayAgentId: displayAgent.id ?? undefined,
    displayAgentName: displayAgent.name ?? undefined,
    displayAgentSource: displayAgent.source,
    eligibleAssignees: parseJsonArray(row.eligible_assignee_ids ?? "[]"),
    tags: parseJsonArray(row.labels_json),
    sprint: row.sprint_name ?? undefined,
    sprintId: row.sprint_id ?? undefined,
    sprintKey: row.sprint_key ?? undefined,
    sprintName: row.sprint_name ?? undefined,
    sprintStatus: row.sprint_status ? toApiSprintStatus(row.sprint_status) : undefined,
    companyGoalId: row.company_goal_id ?? undefined,
    companyGoalKey: row.company_goal_key ?? undefined,
    companyGoalName: row.company_goal_name ?? undefined,
    companyGoalStatus: row.company_goal_status ? toApiSprintStatus(row.company_goal_status) : undefined,
    blockedReason: row.blocked_reason ?? undefined,
    executionEngine: executionEngine.engine,
    executionEngineOverride: executionEngine.override,
    executionEngineSource: executionEngine.source,
    executionRuntimeProvider: row.execution_runtime_provider,
    executionRuntimeLabel: row.execution_runtime_label,
    executionModelRouting: row.execution_model_routing,
    executionModelRoutingLabel: row.execution_model_routing_label,
    executionRoutingSource: resolveTaskExecutionRouting({
      taskRuntimeProvider: row.execution_runtime_provider,
      taskRuntimeLabel: row.execution_runtime_label,
      taskModelRouting: row.execution_model_routing,
      taskModelRoutingLabel: row.execution_model_routing_label,
      projectSettingsJson: row.project_settings_json,
      companySettingsJson: row.company_settings_json,
    }).source,
    modelLane: row.model_lane ?? "default",
    modelDisplay: modelDisplay
      ? {
          ...modelDisplay,
          sourceAgentId: displayAgent.id ?? undefined,
          sourceAgentName: displayAgent.name ?? undefined,
          source: displayAgent.source,
        }
      : null,
    dependencies: dependencyInfo?.dependencies,
    waitingOn: dependencyInfo?.waitingOn,
    executionMode: row.execution_mode,
    createdBy: row.created_by_display_name ?? row.created_by ?? undefined,
    dueDate: row.due_date ?? undefined,
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
    sprintKey: row.sprint_key ?? undefined,
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
  const authorUserId = row.author_user_id?.trim() ?? "";
  const isOperatorComment =
    !row.author_name &&
    row.source === "mission_control" &&
    Boolean(authorUserId) &&
    !isHiveRunnerSystemAuthor(authorUserId) &&
    !authorUserId.startsWith("openclaw:") &&
    !authorUserId.startsWith("voice:");

  return {
    id: row.id,
    author: row.author_name ?? (isOperatorComment ? "Operator" : row.author_user_id) ?? "System",
    authorEmoji: row.author_emoji ?? undefined,
    text: row.body,
    timestamp: row.created_at,
    type: row.type,
    source: isOperatorComment ? "operator" : row.source ?? undefined,
  };
}

function getTaskRowForUpdate(db: Database.Database, taskId: string): TaskWithProjectRow | undefined {
  return db
    .prepare(
      `SELECT
        id,
        company_id,
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
        execution_engine,
        execution_runtime_provider,
        execution_runtime_label,
        execution_model_routing,
        execution_model_routing_label,
        COALESCE(model_lane, 'default') AS model_lane,
        labels_json,
        source_review_id,
        source_takeaway_id,
        review_notes,
        started_at,
        completed_at,
        due_date
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
    const keepStatus = currentAgent.status === "paused" || currentAgent.status === "offline";
    db.prepare(
      `UPDATE agents
       SET status = ?, current_task_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(keepStatus ? currentAgent.status : "working", active.id, new Date().toISOString(), agentId);
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
        t.company_id,
        t.project_id,
        t.sprint_id,
        s.sprint_key,
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
        t.execution_engine,
        t.execution_runtime_provider,
        t.execution_runtime_label,
        t.execution_model_routing,
        t.execution_model_routing_label,
        COALESCE(t.model_lane, 'default') AS model_lane,
        latest_er.provider AS run_provider,
        latest_er.runner_provider AS run_runner_provider,
        latest_er.runner_model AS run_runner_model,
        latest_er.agent_id AS run_agent_id,
        run_agent.name AS run_agent_name,
        run_agent.model AS run_agent_model,
        a.model AS assignee_model,
        source_agent.id AS source_agent_id,
        source_agent.name AS source_agent_name,
        source_agent.model AS source_agent_model,
        source_er.provider AS source_run_provider,
        source_er.runner_provider AS source_run_runner_provider,
        source_er.runner_model AS source_run_runner_model,
        t.execution_mode,
        t.labels_json,
        t.depends_on_json,
        t.eligible_assignee_ids,
        t.source_review_id,
        t.source_takeaway_id,
        t.task_key,
        t.due_date,
        t.created_at,
        t.updated_at,
        t.completed_at,
        p.settings_json AS project_settings_json,
        c.settings_json AS company_settings_json
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN execution_runs latest_er
         ON latest_er.id = (
          SELECT er.id
          FROM execution_runs er
          WHERE er.task_id = t.id
          ORDER BY
            CASE WHEN er.status = 'running' THEN 0 ELSE 1 END,
            COALESCE(er.started_at, er.completed_at, er.updated_at, er.created_at) DESC,
            er.rowid DESC
          LIMIT 1
        )
       LEFT JOIN agents run_agent ON run_agent.id = latest_er.agent_id
       LEFT JOIN task_events latest_producer_event
         ON latest_producer_event.id = (
          SELECT te.id
          FROM task_events te
          WHERE te.task_id = t.id
            AND te.agent_id IS NOT NULL
            AND (
              te.event_type = 'task.artifact_registered'
              OR (
                te.event_type = 'task.status_changed'
                AND te.to_status = 'review'
                AND COALESCE(te.from_status, '') <> 'review'
              )
            )
          ORDER BY
            te.created_at DESC,
            CASE WHEN te.event_type = 'task.artifact_registered' THEN 0 ELSE 1 END,
            te.rowid DESC
          LIMIT 1
        )
       LEFT JOIN task_events latest_review_handoff
         ON latest_review_handoff.id = (
          SELECT te.id
          FROM task_events te
          WHERE te.task_id = t.id
            AND te.event_type = 'task.assigned'
            AND json_valid(te.metadata_json)
            AND json_extract(te.metadata_json, '$.source') = 'engine_default_review_handoff'
          ORDER BY te.created_at DESC, te.rowid DESC
          LIMIT 1
        )
       LEFT JOIN agents source_agent ON source_agent.id = COALESCE(
          latest_producer_event.agent_id,
          CASE
            WHEN json_valid(latest_review_handoff.metadata_json)
            THEN json_extract(latest_review_handoff.metadata_json, '$.previousAssignee')
            ELSE NULL
          END,
          latest_review_handoff.agent_id
        )
       LEFT JOIN execution_runs source_er
         ON source_er.id = (
          SELECT er.id
          FROM execution_runs er
          WHERE er.task_id = t.id
            AND er.agent_id = source_agent.id
            AND er.status = 'completed'
            AND (
              latest_producer_event.created_at IS NULL
              OR COALESCE(er.started_at, er.created_at) <= latest_producer_event.created_at
            )
          ORDER BY
            COALESCE(er.completed_at, er.started_at, er.updated_at, er.created_at) DESC,
            er.rowid DESC
          LIMIT 1
        )
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE t.project_id = ? AND t.archived_at IS NULL
       ORDER BY
         CASE t.status
           WHEN 'backlog' THEN 1
           WHEN 'to-do' THEN 2
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
  taskIds: string[],
  options?: { latestPerTask?: boolean }
): Map<string, NonNullable<OrchestrationTask["comments"]>> {
  if (taskIds.length === 0) return new Map();

  const placeholders = taskIds.map(() => "?").join(",");
  const baseSelect = `
    SELECT
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
      AND NOT (
        c.source = 'engine'
        AND c.external_ref LIKE 'engine:circuit_breaker:%'
        AND EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.id = c.task_id AND t.status != 'blocked'
        )
      )`;
  const rows = options?.latestPerTask
    ? db
      .prepare(
        `WITH ranked_comments AS (
          SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at DESC, id DESC) AS rn
          FROM (${baseSelect})
        )
        SELECT
          id,
          task_id,
          body,
          type,
          source,
          external_ref,
          created_at,
          author_name,
          author_emoji,
          author_user_id
        FROM ranked_comments
        WHERE rn = 1
        ORDER BY created_at ASC`
      )
      .all(...taskIds) as CommentRow[]
    : db
      .prepare(`${baseSelect} ORDER BY c.created_at ASC`)
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
    emoji: normalizeAgentSymbol(row.emoji, row.role),
    role: row.role,
    avatar: row.avatar_url ?? undefined,
    status: effectiveStatus,
    currentTask: effectiveCurrentTask,
    personality: row.personality,
    model: row.model ?? undefined,
    adapterType: normalizeAgentAdapterType({
      adapterType: row.adapter_type,
      openclawAgentId: row.openclaw_agent_id,
    }),
    runtimeSlug: row.runtime_slug ?? undefined,
    openclawAgentId: row.openclaw_agent_id ?? undefined,
    reportingTo: row.reporting_to ?? undefined,
    reportingToName: row.reporting_to_name ?? undefined,
    hireApprovalId: row.hire_approval_id ?? undefined,
    hireApprovalStatus: row.hire_approval_status ?? undefined,
    skills: parseJsonArray(row.skills_json),
    tasksCompleted: Number(row.tasks_completed ?? 0),
    totalRuntimeMinutes: Number(row.total_runtime_minutes ?? 0),
    lastHeartbeat: row.last_heartbeat ?? undefined,
    created: row.created_at,
    updated: row.updated_at,
    archivedAt: row.archived_at ?? undefined,
    avatarStyleId: row.avatar_style_id ?? undefined,
    avatarGender: row.avatar_gender ?? undefined,
    avatarAge: typeof row.avatar_age === "number" ? row.avatar_age : undefined,
    avatarHairColor: row.avatar_hair_color ?? undefined,
    avatarHairLength: row.avatar_hair_length ?? undefined,
    avatarEyeColor: row.avatar_eye_color ?? undefined,
    avatarVibe: row.avatar_vibe ?? undefined,
    voiceId: row.voice_id ?? undefined,
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
        a.runtime_slug,
        a.openclaw_agent_id,
        a.reporting_to,
        mgr.name AS reporting_to_name,
        hap.id AS hire_approval_id,
        hap.status AS hire_approval_status,
        a.skills_json,
        a.tasks_completed,
        a.total_runtime_minutes,
        a.last_heartbeat,
        a.created_at,
        a.updated_at,
        a.avatar_style_id,
        a.avatar_gender,
        a.avatar_age,
        a.avatar_hair_color,
        a.avatar_hair_length,
        a.avatar_eye_color,
        a.avatar_vibe,
        a.voice_id
       FROM agents a
       LEFT JOIN tasks t ON t.id = a.current_task_id
       LEFT JOIN agents mgr ON mgr.id = a.reporting_to
       LEFT JOIN approvals hap
         ON hap.company_id = a.company_id
        AND hap.type = 'hire_agent'
        AND hap.status IN ('pending', 'revision_requested')
        AND json_extract(hap.payload_json, '$.agentId') = a.id
       WHERE a.id = ? AND a.archived_at IS NULL`
    )
    .get(agentId) as AgentRow | undefined;
}

function taskById(db: Database.Database, taskId: string): OrchestrationTask {
  const row = db
    .prepare(
      `SELECT
        t.id,
        t.company_id,
        t.project_id,
        t.sprint_id,
        s.sprint_key,
        s.name AS sprint_name,
        parent_s.id AS company_goal_id,
        parent_s.goal_key AS company_goal_key,
        parent_s.name AS company_goal_name,
        parent_s.status AS company_goal_status,
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
        t.execution_engine,
        t.execution_runtime_provider,
        t.execution_runtime_label,
        t.execution_model_routing,
        t.execution_model_routing_label,
        COALESCE(t.model_lane, 'default') AS model_lane,
        latest_er.provider AS run_provider,
        latest_er.runner_provider AS run_runner_provider,
        latest_er.runner_model AS run_runner_model,
        latest_er.agent_id AS run_agent_id,
        run_agent.name AS run_agent_name,
        run_agent.model AS run_agent_model,
        a.model AS assignee_model,
        source_agent.id AS source_agent_id,
        source_agent.name AS source_agent_name,
        source_agent.model AS source_agent_model,
        source_er.provider AS source_run_provider,
        source_er.runner_provider AS source_run_runner_provider,
        source_er.runner_model AS source_run_runner_model,
        t.execution_mode,
        t.created_by,
        creator.display_name AS created_by_display_name,
        t.labels_json,
        t.depends_on_json,
        t.eligible_assignee_ids,
        t.source_review_id,
        t.source_takeaway_id,
        t.task_key,
        t.due_date,
        t.created_at,
        t.updated_at,
        t.completed_at,
        p.settings_json AS project_settings_json,
        c.settings_json AS company_settings_json
       FROM tasks t
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN users creator ON creator.id = t.created_by AND creator.archived_at IS NULL
       LEFT JOIN sprints s ON s.id = t.sprint_id
       LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
       LEFT JOIN execution_runs latest_er
         ON latest_er.id = (
          SELECT er.id
          FROM execution_runs er
          WHERE er.task_id = t.id
          ORDER BY
            CASE WHEN er.status = 'running' THEN 0 ELSE 1 END,
            COALESCE(er.started_at, er.completed_at, er.updated_at, er.created_at) DESC,
            er.rowid DESC
          LIMIT 1
        )
       LEFT JOIN agents run_agent ON run_agent.id = latest_er.agent_id
       LEFT JOIN task_events latest_producer_event
         ON latest_producer_event.id = (
          SELECT te.id
          FROM task_events te
          WHERE te.task_id = t.id
            AND te.agent_id IS NOT NULL
            AND (
              te.event_type = 'task.artifact_registered'
              OR (
                te.event_type = 'task.status_changed'
                AND te.to_status = 'review'
                AND COALESCE(te.from_status, '') <> 'review'
              )
            )
          ORDER BY
            te.created_at DESC,
            CASE WHEN te.event_type = 'task.artifact_registered' THEN 0 ELSE 1 END,
            te.rowid DESC
          LIMIT 1
        )
       LEFT JOIN task_events latest_review_handoff
         ON latest_review_handoff.id = (
          SELECT te.id
          FROM task_events te
          WHERE te.task_id = t.id
            AND te.event_type = 'task.assigned'
            AND json_valid(te.metadata_json)
            AND json_extract(te.metadata_json, '$.source') = 'engine_default_review_handoff'
          ORDER BY te.created_at DESC, te.rowid DESC
          LIMIT 1
        )
       LEFT JOIN agents source_agent ON source_agent.id = COALESCE(
          latest_producer_event.agent_id,
          CASE
            WHEN json_valid(latest_review_handoff.metadata_json)
            THEN json_extract(latest_review_handoff.metadata_json, '$.previousAssignee')
            ELSE NULL
          END,
          latest_review_handoff.agent_id
        )
       LEFT JOIN execution_runs source_er
         ON source_er.id = (
          SELECT er.id
          FROM execution_runs er
          WHERE er.task_id = t.id
            AND er.agent_id = source_agent.id
            AND er.status = 'completed'
            AND (
              latest_producer_event.created_at IS NULL
              OR COALESCE(er.started_at, er.created_at) <= latest_producer_event.created_at
            )
          ORDER BY
            COALESCE(er.completed_at, er.started_at, er.updated_at, er.created_at) DESC,
            er.rowid DESC
          LIMIT 1
        )
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE (t.id = ? OR t.task_key = ?) AND t.archived_at IS NULL`
    )
    .get(taskId, taskId) as TaskRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const comments = commentsForTasks(db, [row.id]).get(row.id) ?? [];
  const dependencyMap = dependencySummariesForTaskRows(db, [row]);
  return taskFromRow(row, comments, dependencyMap.get(row.id));
}

function sprintById(db: Database.Database, sprintId: string): SprintRow | undefined {
  return db
    .prepare(
      `SELECT
        s.id,
        s.project_id,
        s.sprint_key,
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
  dependencySummariesForTaskRows,
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
