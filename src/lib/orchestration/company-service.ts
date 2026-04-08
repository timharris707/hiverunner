import { randomUUID } from "crypto";
import path from "path";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import type { CompanyStatusInput, SprintStatusInput, TaskStatusInput } from "@/lib/orchestration/contracts";
import type {
  OrchestrationCompany,
  OrchestrationCompanyGoal,
  OrchestrationCompanyInboxEvent,
  OrchestrationCompanyInboxTask,
} from "@/lib/orchestration/types";
import { toApiPriority, toApiSprintStatus, toApiStatus, toApiType, toDbSprintStatus, toDbStatus } from "@/lib/orchestration/service/shared/mappers";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  parseJsonObject,
} from "@/lib/orchestration/service/shared";
import {
  AVATAR_THEME_PRESETS,
  findAvatarThemePreset,
  type AvatarThemePreset,
} from "@/lib/orchestration/theme-presets";
import { isNonProductionCompany } from "@/lib/orchestration/service/shared";

type CompanyRow = {
  id: string;
  slug: string;
  company_code: string | null;
  name: string;
  description: string;
  status: CompanyStatusInput;
  workspace_root: string | null;
  workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
  theme_name: string;
  theme_prompt_template: string;
  theme_keywords_json: string;
  theme_sample_url: string | null;
  created_at: string;
  project_count: number;
  agent_count: number;
  active_task_count: number;
};

type CompanyInboxTaskRow = {
  id: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  project_color: string;
  sprint_name: string | null;
  parent_task_id: string | null;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  type: "feature" | "bug" | "maintenance" | "research" | "infrastructure" | "directive";
  status: "backlog" | "on_deck" | "in_progress" | "review" | "done" | "blocked";
  column_order: number;
  assignee_name: string | null;
  blocked_reason: string | null;
  execution_mode: "paperclip" | "openclaw" | "manual";
  labels_json: string;
  source_review_id: string | null;
  source_takeaway_id: string | null;
  created_at: string;
  updated_at: string;
};

type CompanyGoalRow = {
  sprint_id: string;
  sprint_name: string;
  sprint_goal: string;
  sprint_status: "planning" | "active" | "completed";
  sprint_start_date: string;
  sprint_end_date: string | null;
  sprint_created_at: string;
  sprint_updated_at: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  project_color: string;
  task_count: number;
  in_progress_count: number;
  review_count: number;
  done_count: number;
};

type CompanyProjectScopeRow = {
  id: string;
};

type CompanyScopedSprintRow = {
  id: string;
  project_id: string;
  name: string;
  goal: string;
  status: "planning" | "active" | "completed";
  start_date: string;
  end_date: string | null;
  completed_at: string | null;
};

type CompanyInboxEventRow = {
  event_id: string;
  event_type: string;
  event_kind: "task" | "execution";
  company_id: string;
  company_slug: string;
  company_name: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  task_id: string | null;
  task_title: string | null;
  task_key: string | null;
  task_status: "backlog" | "on_deck" | "in_progress" | "review" | "done" | "blocked" | null;
  from_status: "backlog" | "on_deck" | "in_progress" | "review" | "done" | "blocked" | null;
  to_status: "backlog" | "on_deck" | "in_progress" | "review" | "done" | "blocked" | null;
  agent_id: string | null;
  agent_name: string | null;
  avatar_url: string | null;
  provider: "openclaw" | "paperclip" | null;
  metadata_json: string;
  created_at: string;
};

const NEVERIDLE_CORE_SLUG = "neveridle-core";
const OPENCLAW_WORKSPACE_ROOT =
  process.env.OPENCLAW_WORKSPACE_ROOT?.trim() || "/Users/timharris/.openclaw/workspace";

/**
 * Builds the reusable inbox feed CTE SQL and its parameter list.
 * Every inbox operation (list, count, mark-all-read) uses this so the event
 * identity is defined exactly once.
 */
function buildInboxFeedCte(
  companyId: string,
  opts?: {
    beforeTimestamp?: string;
    excludeDone?: boolean;
    projectId?: string;
    status?: string;
    search?: string;
  }
): { sql: string; params: unknown[] } {
  const taskWhere = ["p.company_id = ?", "p.archived_at IS NULL", "t.archived_at IS NULL"];
  const taskParams: unknown[] = [companyId];
  const execWhere = ["p.company_id = ?", "p.archived_at IS NULL", "t.archived_at IS NULL"];
  const execParams: unknown[] = [companyId];

  if (opts?.beforeTimestamp) {
    taskWhere.push("te.created_at <= ?");
    taskParams.push(opts.beforeTimestamp);
    execWhere.push("COALESCE(er.completed_at, er.updated_at, er.created_at) <= ?");
    execParams.push(opts.beforeTimestamp);
  }

  if (opts?.projectId) {
    taskWhere.push("(p.id = ? OR p.slug = ?)");
    taskParams.push(opts.projectId, opts.projectId);
    execWhere.push("(p.id = ? OR p.slug = ?)");
    execParams.push(opts.projectId, opts.projectId);
  }

  if (opts?.status) {
    taskWhere.push("COALESCE(te.to_status, t.status) = ?");
    taskParams.push(opts.status);
    execWhere.push("t.status = ?");
    execParams.push(opts.status);
  } else if (opts?.excludeDone) {
    taskWhere.push("COALESCE(te.to_status, t.status) <> 'done'");
    execWhere.push("t.status <> 'done'");
  }

  if (opts?.search) {
    const needle = `%${opts.search}%`;
    taskWhere.push(
      "(LOWER(t.title) LIKE ? OR LOWER(t.description) LIKE ? OR LOWER(COALESCE(a.name, '')) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(te.event_type) LIKE ? OR LOWER(COALESCE(te.metadata_json, '')) LIKE ?)"
    );
    taskParams.push(needle, needle, needle, needle, needle, needle);
    execWhere.push(
      "(LOWER(t.title) LIKE ? OR LOWER(t.description) LIKE ? OR LOWER(COALESCE(a.name, '')) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(COALESCE(er.error_message, '')) LIKE ?)"
    );
    execParams.push(needle, needle, needle, needle, needle);
  }

  const sql = `WITH feed_events AS (
    SELECT
      'task:' || te.id AS event_id,
      te.event_type AS event_type,
      'task' AS event_kind,
      c.id AS company_id,
      c.slug AS company_slug,
      c.name AS company_name,
      p.id AS project_id,
      p.slug AS project_slug,
      p.name AS project_name,
      t.id AS task_id,
      t.title AS task_title,
      t.task_key AS task_key,
      COALESCE(te.to_status, t.status) AS task_status,
      te.from_status AS from_status,
      te.to_status AS to_status,
      te.agent_id AS agent_id,
      a.name AS agent_name,
      a.avatar_url AS avatar_url,
      NULL AS provider,
      te.metadata_json AS metadata_json,
      te.created_at AS created_at
    FROM task_events te
    INNER JOIN tasks t ON t.id = te.task_id
    INNER JOIN projects p ON p.id = te.project_id
    INNER JOIN companies c ON c.id = p.company_id
    LEFT JOIN agents a ON a.id = te.agent_id
    WHERE ${taskWhere.join(" AND ")}
      AND te.event_type IN (
        'task.created', 'task.updated', 'task.archived', 'task.reordered',
        'task.status_changed', 'task.assigned', 'task.unassigned', 'task.comment_added'
      )

    UNION ALL

    SELECT
      'execution:' || er.id AS event_id,
      'execution.' || er.status AS event_type,
      'execution' AS event_kind,
      c.id AS company_id,
      c.slug AS company_slug,
      c.name AS company_name,
      p.id AS project_id,
      p.slug AS project_slug,
      p.name AS project_name,
      t.id AS task_id,
      t.title AS task_title,
      t.task_key AS task_key,
      t.status AS task_status,
      NULL AS from_status,
      NULL AS to_status,
      er.agent_id AS agent_id,
      a.name AS agent_name,
      a.avatar_url AS avatar_url,
      er.provider AS provider,
      json_object(
        'sessionId', er.session_id,
        'errorMessage', er.error_message,
        'durationMs', er.duration_ms
      ) AS metadata_json,
      CASE
        WHEN er.completed_at IS NOT NULL THEN er.completed_at
        WHEN er.updated_at > er.created_at THEN er.updated_at
        ELSE er.created_at
      END AS created_at
    FROM execution_runs er
    INNER JOIN tasks t ON t.id = er.task_id
    INNER JOIN projects p ON p.id = t.project_id
    INNER JOIN companies c ON c.id = p.company_id
    LEFT JOIN agents a ON a.id = er.agent_id
    WHERE ${execWhere.join(" AND ")}
      AND er.status IN ('pending', 'running', 'completed', 'failed', 'cancelled')

    UNION ALL

    SELECT
      'approval:' || ap.id AS event_id,
      'approval.' || ap.status AS event_type,
      'approval' AS event_kind,
      c.id AS company_id,
      c.slug AS company_slug,
      c.name AS company_name,
      COALESCE(p.id, '') AS project_id,
      COALESCE(p.slug, '') AS project_slug,
      COALESCE(p.name, '') AS project_name,
      ap.linked_task_id AS task_id,
      COALESCE(t.title, '') AS task_title,
      COALESCE(t.task_key, '') AS task_key,
      COALESCE(t.status, 'backlog') AS task_status,
      NULL AS from_status,
      NULL AS to_status,
      ap.requested_by_agent_id AS agent_id,
      ag.name AS agent_name,
      ag.avatar_url AS avatar_url,
      NULL AS provider,
      json_object(
        'approvalId', ap.id,
        'approvalType', ap.type,
        'approvalStatus', ap.status,
        'approvalLabel', CASE ap.type
          WHEN 'hire_agent' THEN 'Hire Agent: ' || COALESCE(json_extract(ap.payload_json, '$.agentName'), 'Unknown')
          WHEN 'approve_ceo_strategy' THEN COALESCE(json_extract(ap.payload_json, '$.title'), 'CEO Strategy Approval')
          WHEN 'budget_override_required' THEN 'Budget Override: ' || COALESCE(json_extract(ap.payload_json, '$.scopeName'), 'Required')
          ELSE ap.type
        END,
        'requestedByName', ag.name,
        'decisionNote', ap.decision_note
      ) AS metadata_json,
      ap.updated_at AS created_at
    FROM approvals ap
    INNER JOIN companies c ON c.id = ap.company_id
    LEFT JOIN tasks t ON t.id = ap.linked_task_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN agents ag ON ag.id = ap.requested_by_agent_id
    WHERE ap.company_id = ?
  )`;

  return { sql, params: [...taskParams, ...execParams, companyId] };
}

export type CompanyThemeView = {
  name: string;
  promptTemplate: string;
  keywords: string[];
  sampleUrl?: string;
};

function slugify(input: string): string {
  return input
    .replace(/'/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function parseKeywords(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
}

function toInboxEventType(
  row: CompanyInboxEventRow
): OrchestrationCompanyInboxEvent["eventType"] {
  if (row.event_kind === "approval") {
    const approvalStatus = row.event_type.replace(/^approval\./, "");
    if (approvalStatus === "pending" || approvalStatus === "approved" || approvalStatus === "rejected" || approvalStatus === "revision_requested") {
      return `approval.${approvalStatus}` as OrchestrationCompanyInboxEvent["eventType"];
    }
    return "approval.pending";
  }

  if (row.event_kind === "execution") {
    const executionType = row.event_type.replace(/^execution\./, "");
    if (
      executionType === "pending" ||
      executionType === "running" ||
      executionType === "completed" ||
      executionType === "failed" ||
      executionType === "cancelled"
    ) {
      return `execution.${executionType}`;
    }
    return "execution.pending";
  }

  switch (row.event_type) {
    case "task.created":
    case "task.updated":
    case "task.archived":
    case "task.reordered":
    case "task.status_changed":
    case "task.assigned":
    case "task.unassigned":
    case "task.comment_added":
      return row.event_type;
    default:
      return "task.updated";
  }
}

function inboxEventMessage(
  row: CompanyInboxEventRow,
  metadata: Record<string, unknown>
): string {
  const taskTitle = row.task_title ?? "Task";
  const agentName =
    row.agent_name ??
    (typeof metadata.assignee === "string" ? metadata.assignee : undefined);

  if (row.event_kind === "approval") {
    const label = typeof metadata.approvalLabel === "string" ? metadata.approvalLabel : "Approval request";
    const status = row.event_type.replace("approval.", "");
    const requester = row.agent_name;
    if (status === "approved") return `${label} approved${requester ? ` (requested by ${requester})` : ""}`;
    if (status === "rejected") return `${label} rejected${requester ? ` (requested by ${requester})` : ""}`;
    return `${label} pending${requester ? ` (requested by ${requester})` : ""}`;
  }

  if (row.event_kind === "execution") {
    const provider = row.provider ?? "openclaw";
    const providerLabel = provider === "paperclip" ? "Paperclip" : "OpenClaw";
    const state = row.event_type.replace("execution.", "");
    if (state === "completed") return `${taskTitle} execution completed (${providerLabel})`;
    if (state === "failed") return `${taskTitle} execution failed (${providerLabel})`;
    if (state === "cancelled") return `${taskTitle} execution cancelled (${providerLabel})`;
    if (state === "running") return `${taskTitle} execution started (${providerLabel})`;
    return `${taskTitle} execution queued (${providerLabel})`;
  }

  if (row.event_type === "task.status_changed") {
    if (row.from_status && row.to_status) {
      return `${taskTitle} moved ${toApiStatus(row.from_status)} -> ${toApiStatus(row.to_status)}`;
    }
  }

  if (row.event_type === "task.assigned") {
    return `${taskTitle} assigned${agentName ? ` to ${agentName}` : ""}`;
  }
  if (row.event_type === "task.unassigned") return `${taskTitle} unassigned`;
  if (row.event_type === "task.comment_added") {
    return `${taskTitle} received a new comment${agentName ? ` from ${agentName}` : ""}`;
  }
  if (row.event_type === "task.reordered") return `${taskTitle} moved on the board`;
  if (row.event_type === "task.created") return `${taskTitle} created`;
  if (row.event_type === "task.archived") return `${taskTitle} archived`;
  return `${taskTitle} updated`;
}

function getCompanyRowBySlug(slug: string): CompanyRow | undefined {
  const db = getOrchestrationDb();
  return db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.company_code,
        c.name,
        c.description,
        c.status,
        c.workspace_root,
        c.workspace_source,
        c.theme_name,
        c.theme_prompt_template,
        c.theme_keywords_json,
        c.theme_sample_url,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'on_deck', 'in_progress', 'review', 'blocked')
       WHERE c.slug = ? AND c.archived_at IS NULL
       GROUP BY c.id`
    )
    .get(slug) as CompanyRow | undefined;
}

function getCompanyRowById(companyId: string): CompanyRow | undefined {
  const db = getOrchestrationDb();
  return db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.company_code,
        c.name,
        c.description,
        c.status,
        c.workspace_root,
        c.workspace_source,
        c.theme_name,
        c.theme_prompt_template,
        c.theme_keywords_json,
        c.theme_sample_url,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'on_deck', 'in_progress', 'review', 'blocked')
       WHERE c.id = ? AND c.archived_at IS NULL
       GROUP BY c.id`
    )
    .get(companyId) as CompanyRow | undefined;
}

function themeFromRow(row: CompanyRow): CompanyThemeView {
  return {
    name: row.theme_name,
    promptTemplate: row.theme_prompt_template,
    keywords: parseKeywords(row.theme_keywords_json),
    sampleUrl: row.theme_sample_url ?? undefined,
  };
}

function getCompanyRowByIdOrSlug(companyIdOrSlug: string): CompanyRow | undefined {
  return getCompanyRowBySlug(companyIdOrSlug) ?? getCompanyRowById(companyIdOrSlug);
}

function getCompanyProjectRowByIdOrSlug(
  companyId: string,
  projectIdOrSlug: string
): CompanyProjectScopeRow | undefined {
  const db = getOrchestrationDb();
  return db
    .prepare(
      `SELECT id
       FROM projects
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR slug = ?)
       LIMIT 1`
    )
    .get(companyId, projectIdOrSlug, projectIdOrSlug) as CompanyProjectScopeRow | undefined;
}

function getCompanyScopedSprintRow(
  companyId: string,
  sprintId: string
): CompanyScopedSprintRow | undefined {
  const db = getOrchestrationDb();
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
        s.completed_at
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?
         AND p.company_id = ?
         AND p.archived_at IS NULL
       LIMIT 1`
    )
    .get(sprintId, companyId) as CompanyScopedSprintRow | undefined;
}

function getCompanyGoalBySprintId(
  companyId: string,
  sprintId: string
): OrchestrationCompanyGoal | undefined {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT
        s.id AS sprint_id,
        s.name AS sprint_name,
        s.goal AS sprint_goal,
        s.status AS sprint_status,
        s.start_date AS sprint_start_date,
        s.end_date AS sprint_end_date,
        s.created_at AS sprint_created_at,
        s.updated_at AS sprint_updated_at,
        s.parent_id AS sprint_parent_id,
        s.owner AS sprint_owner,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        p.color AS project_color,
        COUNT(t.id) AS task_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) AS review_count,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       LEFT JOIN tasks t ON t.sprint_id = s.id AND t.archived_at IS NULL
       WHERE s.id = ?
         AND p.company_id = ?
         AND p.archived_at IS NULL
       GROUP BY s.id`
    )
    .get(sprintId, companyId) as CompanyGoalRow | undefined;

  if (!row) return undefined;

  const taskCount = Number(row.task_count ?? 0);
  const doneCount = Number(row.done_count ?? 0);
  const inProgressCount = Number(row.in_progress_count ?? 0);
  const reviewCount = Number(row.review_count ?? 0);

  return {
    sprint: {
      id: row.sprint_id,
      projectId: row.project_id,
      name: row.sprint_name,
      goal: row.sprint_goal,
      status: toApiSprintStatus(row.sprint_status),
      startDate: row.sprint_start_date,
      endDate: row.sprint_end_date ?? undefined,
      created: row.sprint_created_at,
      updated: row.sprint_updated_at,
      taskCount,
      inProgressCount,
      reviewCount,
      doneCount,
      parentId: row.sprint_parent_id ?? undefined,
      owner: row.sprint_owner ?? undefined,
    },
    projectId: row.project_id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    projectColor: row.project_color,
    completionPercent: taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0,
    remainingTasks: Math.max(taskCount - doneCount, 0),
  } satisfies OrchestrationCompanyGoal;
}

function companyFromRow(row: CompanyRow): OrchestrationCompany {
  const workspaceRoot =
    row.workspace_root && row.workspace_root.trim()
      ? row.workspace_root
      : row.slug === NEVERIDLE_CORE_SLUG
      ? OPENCLAW_WORKSPACE_ROOT
      : path.join(OPENCLAW_WORKSPACE_ROOT, "companies", row.slug);

  return {
    id: row.id,
    slug: row.slug,
    code: row.company_code?.trim() || row.slug.slice(0, 3).toUpperCase(),
    name: row.name,
    description: row.description,
    status: row.status,
    created: row.created_at,
    workspace: {
      root: workspaceRoot,
      source:
        row.workspace_source ??
        (row.slug === NEVERIDLE_CORE_SLUG ? "openclaw" : "provisioned"),
    },
    theme: {
      name: row.theme_name,
      promptTemplate: row.theme_prompt_template,
      keywords: parseKeywords(row.theme_keywords_json),
      sampleUrl: row.theme_sample_url ?? undefined,
    },
    stats: {
      projects: Number(row.project_count ?? 0),
      agents: Number(row.agent_count ?? 0),
      activeTasks: Number(row.active_task_count ?? 0),
    },
  };
}

export function listCompanies(input?: {
  includeArchived?: boolean;
  includeNonProduction?: boolean;
}): { companies: OrchestrationCompany[] } {
  const db = getOrchestrationDb();
  const includeArchived = input?.includeArchived ?? false;
  const includeNonProduction = input?.includeNonProduction ?? false;
  const whereParts = [includeArchived ? "1=1" : "c.archived_at IS NULL"];

  const rows = db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.company_code,
        c.name,
        c.description,
        c.status,
        c.workspace_root,
        c.workspace_source,
        c.theme_name,
        c.theme_prompt_template,
        c.theme_keywords_json,
        c.theme_sample_url,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'on_deck', 'in_progress', 'review', 'blocked')
       WHERE ${whereParts.join(" AND ")}
       GROUP BY c.id
       ORDER BY c.updated_at DESC`
    )
    .all() as CompanyRow[];

  return {
    companies: rows
      .filter((row) => {
        if (includeNonProduction) return true;
        return !isNonProductionCompany({
          slug: row.slug,
          name: row.name,
          description: row.description,
        });
      })
      .map(companyFromRow),
  };
}

export function createCompany(input: {
  name: string;
  slug?: string;
  description: string;
  status: CompanyStatusInput;
  theme?: {
    name: string;
    promptTemplate: string;
    keywords: string[];
    sampleUrl?: string;
  };
}): { company: OrchestrationCompany } {
  const db = getOrchestrationDb();
  const now = new Date().toISOString();

  const rootSlug = input.slug ? slugify(input.slug) : slugify(input.name);
  if (!rootSlug) {
    throw new OrchestrationApiError(400, "invalid_slug", "Unable to derive company slug from name");
  }

  let slug = rootSlug;
  let i = 1;
  while (db.prepare("SELECT 1 FROM companies WHERE slug = ? LIMIT 1").get(slug)) {
    i += 1;
    slug = `${rootSlug}-${i}`;
  }

  const companyId = randomUUID();
  const baseCompanyCode = (input.name || slug)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 3)
    .toUpperCase() || "CMP";

  let companyCode = baseCompanyCode;
  let companyCodeIndex = 1;
  while (db.prepare("SELECT 1 FROM companies WHERE company_code = ? LIMIT 1").get(companyCode)) {
    companyCodeIndex += 1;
    companyCode = `${baseCompanyCode}${companyCodeIndex}`;
  }

  const workspaceRoot =
    slug === NEVERIDLE_CORE_SLUG
      ? OPENCLAW_WORKSPACE_ROOT
      : path.join(OPENCLAW_WORKSPACE_ROOT, "companies", slug);
  const workspaceSource = slug === NEVERIDLE_CORE_SLUG ? "openclaw" : "provisioned";

  db.prepare(
    `INSERT INTO companies
      (id, slug, company_code, name, description, status, workspace_root, workspace_source, theme_name, theme_prompt_template, theme_keywords_json, theme_sample_url, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    companyId,
    slug,
    companyCode,
    input.name,
    input.description,
    input.status,
    workspaceRoot,
    workspaceSource,
    input.theme?.name ?? "Corporate Noir",
    input.theme?.promptTemplate ?? "dark premium portrait, cohesive team style",
    JSON.stringify(input.theme?.keywords ?? ["cinematic", "glass", "neon-trim", "studio-lighting"]),
    input.theme?.sampleUrl ?? null,
    now,
    now
  );

  const row = db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.company_code,
        c.name,
        c.description,
        c.status,
        c.workspace_root,
        c.workspace_source,
        c.theme_name,
        c.theme_prompt_template,
        c.theme_keywords_json,
        c.theme_sample_url,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'on_deck', 'in_progress', 'review', 'blocked')
       WHERE c.id = ?
       GROUP BY c.id`
    )
    .get(companyId) as CompanyRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(500, "company_create_failed", "Company created but could not be loaded");
  }

  return { company: companyFromRow(row) };
}

export function getCompany(companySlug: string): { company: OrchestrationCompany } {
  const row = getCompanyRowBySlug(companySlug);
  if (!row) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  return { company: companyFromRow(row) };
}

export function updateCompany(input: {
  companySlug: string;
  name?: string;
  slug?: string;
  description?: string;
  status?: CompanyStatusInput;
}): { company: OrchestrationCompany } {
  const db = getOrchestrationDb();
  const current = getCompanyRowBySlug(input.companySlug);
  if (!current) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const nextSlug = input.slug ? slugify(input.slug) : current.slug;
  if (!nextSlug) {
    throw new OrchestrationApiError(400, "invalid_slug", "Unable to derive company slug");
  }

  const existingSlugOwner = db
    .prepare("SELECT id FROM companies WHERE slug = ? LIMIT 1")
    .get(nextSlug) as { id: string } | undefined;
  if (existingSlugOwner && existingSlugOwner.id !== current.id) {
    throw new OrchestrationApiError(
      409,
      "company_slug_taken",
      "Another company already uses this slug"
    );
  }

  const nextStatus = input.status ?? current.status;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE companies
       SET
        slug = ?,
        name = ?,
        description = ?,
        status = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      nextSlug,
      input.name ?? current.name,
      input.description ?? current.description,
      nextStatus,
      now,
      current.id
    );

    if (input.status && input.status !== current.status && (input.status === "paused" || input.status === "active")) {
      db.prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE company_id = ? AND status != 'archived'`).run(input.status, now, current.id);
      db.prepare(`UPDATE agents SET status = ?, updated_at = ? WHERE company_id = ? AND status != 'offline'`).run(input.status === "paused" ? "paused" : "idle", now, current.id);
    }
  })();

  const row = getCompanyRowById(current.id);
  if (!row) {
    throw new OrchestrationApiError(
      500,
      "company_update_failed",
      "Company updated but could not be loaded"
    );
  }

  return { company: companyFromRow(row) };
}

export function archiveCompany(companySlug: string): {
  companyId: string;
  companySlug: string;
  archivedAt: string;
} {
  const db = getOrchestrationDb();
  const current = db
    .prepare("SELECT id, slug FROM companies WHERE slug = ? AND archived_at IS NULL")
    .get(companySlug) as { id: string; slug: string } | undefined;

  if (!current) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const archivedAt = new Date().toISOString();
  db.prepare(
    `UPDATE companies
     SET status = 'archived', archived_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(archivedAt, archivedAt, current.id);

  return {
    companyId: current.id,
    companySlug: current.slug,
    archivedAt,
  };
}

export function listCompanyInbox(input: {
  companyIdOrSlug: string;
  projectId?: string;
  status?: TaskStatusInput;
  search?: string;
  includeDone?: boolean;
  limit?: number;
  cursor?: string;
  unreadSince?: string;
  includeTaskSnapshot?: boolean;
}): {
  company: OrchestrationCompany;
  events: OrchestrationCompanyInboxEvent[];
  page: {
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  };
  unreadCount: number;
  unreadSince?: string;
  tasks: OrchestrationCompanyInboxTask[];
  totals: Record<"backlog" | "on-deck" | "in-progress" | "review" | "done" | "blocked", number>;
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const limit = input.limit ?? 50;
  const includeTaskSnapshot = input.includeTaskSnapshot ?? true;
  const dbStatus = input.status ? toDbStatus(input.status) : undefined;
  const search = input.search?.trim().toLowerCase();
  const unreadSince = input.unreadSince?.trim() || undefined;

  const feedCte = buildInboxFeedCte(companyRow.id, {
    projectId: input.projectId,
    status: dbStatus,
    excludeDone: !input.includeDone && !dbStatus,
    search,
  });

  const decodedCursor = input.cursor ? decodeActivityCursor(input.cursor) : undefined;
  const eventRows = db
    .prepare(
      `${feedCte.sql}
      SELECT
        event_id,
        event_type,
        event_kind,
        company_id,
        company_slug,
        company_name,
        project_id,
        project_slug,
        project_name,
        task_id,
        task_title,
        task_key,
        task_status,
        from_status,
        to_status,
        agent_id,
        agent_name,
        provider,
        metadata_json,
        created_at
      FROM feed_events
      WHERE NOT EXISTS (
        SELECT 1 FROM inbox_read_state irs2
        WHERE irs2.company_id = feed_events.company_id
          AND irs2.user_id = 'default'
          AND irs2.event_id = feed_events.event_id
          AND irs2.archived_at IS NOT NULL
      )
      ${
        decodedCursor
          ? "AND (created_at < ? OR (created_at = ? AND event_id < ?))"
          : ""
      }
      ORDER BY created_at DESC, event_id DESC
      LIMIT ?`
    )
    .all(
      ...feedCte.params,
      ...(decodedCursor
        ? [decodedCursor.createdAt, decodedCursor.createdAt, decodedCursor.id]
        : []),
      limit + 1
    ) as CompanyInboxEventRow[];

  const hasMore = eventRows.length > limit;
  const pageRows = hasMore ? eventRows.slice(0, limit) : eventRows;
  const lastRow = pageRows.at(-1);

  // Build read-state lookup set for this page of events (single query instead of N+1)
  const pageEventIds = pageRows.map((r) => r.event_id);
  const readSet = new Set<string>();
  if (pageEventIds.length > 0) {
    const placeholders = pageEventIds.map(() => "?").join(",");
    const readRows = db
      .prepare(
        `SELECT event_id FROM inbox_read_state
         WHERE company_id = ? AND user_id = 'default' AND event_id IN (${placeholders})`
      )
      .all(companyRow.id, ...pageEventIds) as { event_id: string }[];
    for (const r of readRows) readSet.add(r.event_id);
  }

  const events = pageRows.map((row) => {
    const metadata = parseJsonObject(row.metadata_json);
    const eventType = toInboxEventType(row);

    const event: OrchestrationCompanyInboxEvent = {
      id: row.event_id,
      eventType,
      kind: row.event_kind as OrchestrationCompanyInboxEvent["kind"],
      companyId: row.company_id,
      companySlug: row.company_slug,
      companyName: row.company_name,
      projectId: row.project_id,
      projectSlug: row.project_slug,
      projectName: row.project_name,
      taskId: row.task_id ?? undefined,
      taskTitle: row.task_title ?? undefined,
      taskKey: row.task_key ?? undefined,
      status: row.task_status ? toApiStatus(row.task_status) : undefined,
      agentId: row.agent_id ?? undefined,
      agentName: row.agent_name ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      provider: row.provider ?? undefined,
      message: inboxEventMessage(row, metadata),
      timestamp: row.created_at,
      isRead: readSet.has(row.event_id),
    };

    if (row.event_kind === "approval") {
      event.approvalId = typeof metadata.approvalId === "string" ? metadata.approvalId : undefined;
      event.approvalType = typeof metadata.approvalType === "string" ? metadata.approvalType as OrchestrationCompanyInboxEvent["approvalType"] : undefined;
      event.approvalStatus = typeof metadata.approvalStatus === "string" ? metadata.approvalStatus as OrchestrationCompanyInboxEvent["approvalStatus"] : undefined;
      event.approvalLabel = typeof metadata.approvalLabel === "string" ? metadata.approvalLabel : undefined;
      event.requestedByName = typeof metadata.requestedByName === "string" ? metadata.requestedByName : undefined;
    }

    return event;
  });

  // Unread count via pure SQL LEFT JOIN (raw composite keys match directly)
  const unreadCountRow = db
    .prepare(
      `${feedCte.sql}
      SELECT COUNT(*) AS count
      FROM feed_events fe
      LEFT JOIN inbox_read_state irs
        ON irs.company_id = ? AND irs.user_id = 'default' AND irs.event_id = fe.event_id
      WHERE irs.id IS NULL
      ${unreadSince ? "AND fe.created_at > ?" : ""}`
    )
    .get(
      ...feedCte.params,
      companyRow.id,
      ...(unreadSince ? [unreadSince] : [])
    ) as { count: number };
  const unreadCount = Number(unreadCountRow.count ?? 0);

  const totals = {
    backlog: 0,
    "on-deck": 0,
    "in-progress": 0,
    review: 0,
    done: 0,
    blocked: 0,
  } as const;
  const mutableTotals: Record<keyof typeof totals, number> = { ...totals };
  let tasks: OrchestrationCompanyInboxTask[] = [];

  if (includeTaskSnapshot) {
    const taskWhereParts = [
      "p.company_id = ?",
      "p.archived_at IS NULL",
      "t.archived_at IS NULL",
    ];
    const taskParams: unknown[] = [companyRow.id];

    if (input.projectId) {
      taskWhereParts.push("(p.id = ? OR p.slug = ?)");
      taskParams.push(input.projectId, input.projectId);
    }

    if (dbStatus) {
      taskWhereParts.push("t.status = ?");
      taskParams.push(dbStatus);
    } else if (!input.includeDone) {
      taskWhereParts.push("t.status <> 'done'");
    }

    if (search) {
      taskWhereParts.push(
        "(LOWER(t.title) LIKE ? OR LOWER(t.description) LIKE ? OR LOWER(COALESCE(a.name, '')) LIKE ? OR LOWER(p.name) LIKE ?)"
      );
      const needle = `%${search}%`;
      taskParams.push(needle, needle, needle, needle);
    }

    const taskRows = db
      .prepare(
        `SELECT
        t.id,
        t.project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        p.color AS project_color,
        s.name AS sprint_name,
        t.parent_task_id,
        t.title,
        t.description,
        t.priority,
        t.type,
        t.status,
        t.column_order,
        a.name AS assignee_name,
        t.blocked_reason,
        t.execution_mode,
        t.labels_json,
        t.source_review_id,
        t.source_takeaway_id,
        t.task_key,
        t.created_at,
        t.updated_at
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       WHERE ${taskWhereParts.join(" AND ")}
       ORDER BY
         CASE t.status
           WHEN 'blocked' THEN 0
           WHEN 'review' THEN 1
           WHEN 'in_progress' THEN 2
           WHEN 'on_deck' THEN 3
           WHEN 'backlog' THEN 4
           WHEN 'done' THEN 5
           ELSE 6
         END,
         t.updated_at DESC,
         t.column_order ASC`
      )
      .all(...taskParams) as CompanyInboxTaskRow[];

    tasks = taskRows.map((row) => {
      const status = toApiStatus(row.status);
      mutableTotals[status] = (mutableTotals[status] ?? 0) + 1;

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        parentTaskId: row.parent_task_id ?? undefined,
        status,
        columnOrder: row.column_order,
        priority: toApiPriority(row.priority),
        type: toApiType(row.type),
        project: row.project_id,
        projectId: row.project_id,
        projectSlug: row.project_slug,
        projectName: row.project_name,
        projectColor: row.project_color,
        assignee: row.assignee_name ?? undefined,
        tags: parseKeywords(row.labels_json),
        sprint: row.sprint_name ?? undefined,
        blockedReason: row.blocked_reason ?? undefined,
        executionMode: row.execution_mode,
        sourceReviewId: row.source_review_id ?? undefined,
        sourceTakeawayId: row.source_takeaway_id ?? undefined,
        created: row.created_at,
        updated: row.updated_at,
        comments: [],
      } satisfies OrchestrationCompanyInboxTask;
    });
  }

  return {
    company: companyFromRow(companyRow),
    events,
    page: {
      limit,
      hasMore,
      ...(hasMore && lastRow
        ? { nextCursor: encodeActivityCursor(lastRow.created_at, lastRow.event_id) }
        : {}),
    },
    unreadCount,
    unreadSince,
    tasks,
    totals: mutableTotals,
  };
}

export function listCompanyGoals(input: {
  companyIdOrSlug: string;
  projectId?: string;
  status?: SprintStatusInput;
  includeCompleted?: boolean;
}): {
  company: OrchestrationCompany;
  goals: OrchestrationCompanyGoal[];
  summary: {
    total: number;
    planned: number;
    active: number;
    done: number;
    completionPercent: number;
  };
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const whereParts = [
    "p.company_id = ?",
    "p.archived_at IS NULL",
  ];
  const params: unknown[] = [companyRow.id];

  if (input.projectId) {
    whereParts.push("(p.id = ? OR p.slug = ?)");
    params.push(input.projectId, input.projectId);
  }

  if (input.status) {
    whereParts.push("s.status = ?");
    params.push(toDbSprintStatus(input.status));
  } else if (!input.includeCompleted) {
    whereParts.push("s.status <> 'completed'");
  }

  const rows = db
    .prepare(
      `SELECT
        s.id AS sprint_id,
        s.name AS sprint_name,
        s.goal AS sprint_goal,
        s.status AS sprint_status,
        s.start_date AS sprint_start_date,
        s.end_date AS sprint_end_date,
        s.created_at AS sprint_created_at,
        s.updated_at AS sprint_updated_at,
        s.parent_id AS sprint_parent_id,
        s.owner AS sprint_owner,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        p.color AS project_color,
        COUNT(t.id) AS task_count,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END) AS review_count,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       LEFT JOIN tasks t ON t.sprint_id = s.id AND t.archived_at IS NULL
       WHERE ${whereParts.join(" AND ")}
       GROUP BY s.id
       ORDER BY
         CASE s.status
           WHEN 'active' THEN 0
           WHEN 'planning' THEN 1
           WHEN 'completed' THEN 2
           ELSE 3
         END,
         s.updated_at DESC`
    )
    .all(...params) as CompanyGoalRow[];

  let doneTasks = 0;
  let totalTasks = 0;

  const goals = rows.map((row) => {
    const taskCount = Number(row.task_count ?? 0);
    const doneCount = Number(row.done_count ?? 0);
    const inProgressCount = Number(row.in_progress_count ?? 0);
    const reviewCount = Number(row.review_count ?? 0);
    const completionPercent = taskCount > 0 ? Math.round((doneCount / taskCount) * 100) : 0;

    doneTasks += doneCount;
    totalTasks += taskCount;

    return {
      sprint: {
        id: row.sprint_id,
        projectId: row.project_id,
        name: row.sprint_name,
        goal: row.sprint_goal,
        status: toApiSprintStatus(row.sprint_status),
        startDate: row.sprint_start_date,
        endDate: row.sprint_end_date ?? undefined,
        created: row.sprint_created_at,
        updated: row.sprint_updated_at,
        taskCount,
        inProgressCount,
        reviewCount,
        doneCount,
        parentId: row.sprint_parent_id ?? undefined,
        owner: row.sprint_owner ?? undefined,
      },
      projectId: row.project_id,
      projectSlug: row.project_slug,
      projectName: row.project_name,
      projectColor: row.project_color,
      completionPercent,
      remainingTasks: Math.max(taskCount - doneCount, 0),
    } satisfies OrchestrationCompanyGoal;
  });

  const summary = {
    total: goals.length,
    planned: goals.filter((goal) => goal.sprint.status === "planned").length,
    active: goals.filter((goal) => goal.sprint.status === "active").length,
    done: goals.filter((goal) => goal.sprint.status === "done").length,
    completionPercent: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
  };

  return {
    company: companyFromRow(companyRow),
    goals,
    summary,
  };
}

export function createCompanyGoal(input: {
  companyIdOrSlug: string;
  projectId: string;
  name: string;
  goal: string;
  status: SprintStatusInput;
  startDate?: string;
  endDate?: string | null;
  parentId?: string;
  owner?: string | null;
}): {
  company: OrchestrationCompany;
  goal: OrchestrationCompanyGoal;
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const projectRow = getCompanyProjectRowByIdOrSlug(companyRow.id, input.projectId);
  if (!projectRow) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  const existing = db
    .prepare("SELECT 1 FROM sprints WHERE project_id = ? AND lower(name) = lower(?) LIMIT 1")
    .get(projectRow.id, input.name);
  if (existing) {
    throw new OrchestrationApiError(
      409,
      "sprint_name_conflict",
      "A sprint with this name already exists in the project"
    );
  }

  const now = new Date().toISOString();
  const sprintId = randomUUID();

  db.prepare(
    `INSERT INTO sprints
      (id, project_id, name, goal, status, start_date, end_date, completed_at, parent_id, owner, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sprintId,
    projectRow.id,
    input.name,
    input.goal,
    toDbSprintStatus(input.status),
    input.startDate ?? now,
    input.endDate ?? null,
    input.status === "done" ? now : null,
    input.parentId ?? null,
    input.owner ?? null,
    now,
    now
  );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectRow.id);

  const goal = getCompanyGoalBySprintId(companyRow.id, sprintId);
  if (!goal) {
    throw new OrchestrationApiError(
      500,
      "company_goal_create_failed",
      "Goal created but could not be loaded"
    );
  }

  return {
    company: companyFromRow(companyRow),
    goal,
  };
}

export function updateCompanyGoal(input: {
  companyIdOrSlug: string;
  sprintId: string;
  name?: string;
  goal?: string;
  status?: SprintStatusInput;
  startDate?: string;
  endDate?: string | null;
  parentId?: string | null;
  owner?: string | null;
}): {
  company: OrchestrationCompany;
  goal: OrchestrationCompanyGoal;
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const current = getCompanyScopedSprintRow(companyRow.id, input.sprintId);
  if (!current) {
    throw new OrchestrationApiError(404, "sprint_not_found", "Sprint not found");
  }

  if (input.name && input.name.toLowerCase() !== current.name.toLowerCase()) {
    const conflict = db
      .prepare(
        "SELECT 1 FROM sprints WHERE project_id = ? AND id <> ? AND lower(name) = lower(?) LIMIT 1"
      )
      .get(current.project_id, current.id, input.name);
    if (conflict) {
      throw new OrchestrationApiError(
        409,
        "sprint_name_conflict",
        "A sprint with this name already exists in the project"
      );
    }
  }

  const nextStatus = input.status ? toDbSprintStatus(input.status) : current.status;
  const now = new Date().toISOString();
  const completedAt = nextStatus === "completed" ? (current.completed_at ?? now) : null;

  db.prepare(
    `UPDATE sprints
     SET
      name = ?,
      goal = ?,
      status = ?,
      start_date = ?,
      end_date = ?,
      completed_at = ?,
      parent_id = ?,
      owner = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    input.name ?? current.name,
    input.goal ?? current.goal,
    nextStatus,
    input.startDate ?? current.start_date,
    input.endDate === undefined ? current.end_date : input.endDate,
    completedAt,
    input.parentId === undefined ? (current as Record<string, unknown>).parent_id ?? null : input.parentId,
    input.owner === undefined ? (current as Record<string, unknown>).owner ?? null : input.owner,
    now,
    current.id
  );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);

  const goal = getCompanyGoalBySprintId(companyRow.id, current.id);
  if (!goal) {
    throw new OrchestrationApiError(
      500,
      "company_goal_update_failed",
      "Goal updated but could not be loaded"
    );
  }

  return {
    company: companyFromRow(companyRow),
    goal,
  };
}

export function deleteCompanyGoal(input: {
  companyIdOrSlug: string;
  sprintId: string;
}): {
  company: OrchestrationCompany;
  sprintId: string;
  projectId: string;
  deletedAt: string;
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const current = getCompanyScopedSprintRow(companyRow.id, input.sprintId);
  if (!current) {
    throw new OrchestrationApiError(404, "sprint_not_found", "Sprint not found");
  }

  const now = new Date().toISOString();
  db.prepare("DELETE FROM sprints WHERE id = ?").run(current.id);
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);

  return {
    company: companyFromRow(companyRow),
    sprintId: current.id,
    projectId: current.project_id,
    deletedAt: now,
  };
}

export function listAvatarThemePresets(): { presets: AvatarThemePreset[] } {
  return { presets: AVATAR_THEME_PRESETS };
}

export function getCompanyTheme(companySlug: string): { companyId: string; companySlug: string; theme: CompanyThemeView } {
  const row = getCompanyRowBySlug(companySlug);
  if (!row) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  return {
    companyId: row.id,
    companySlug: row.slug,
    theme: themeFromRow(row),
  };
}

export function updateCompanyTheme(input: {
  companySlug: string;
  presetId?: string;
  name?: string;
  promptTemplate?: string;
  keywords?: string[];
  sampleUrl?: string | null;
}): { companyId: string; companySlug: string; theme: CompanyThemeView } {
  const db = getOrchestrationDb();
  const current = getCompanyRowBySlug(input.companySlug);
  if (!current) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const preset = input.presetId ? findAvatarThemePreset(input.presetId) : undefined;
  if (input.presetId && !preset) {
    throw new OrchestrationApiError(400, "invalid_theme_preset", "Unknown avatar theme preset");
  }

  const now = new Date().toISOString();
  const name = input.name ?? preset?.name ?? current.theme_name;
  const promptTemplate =
    input.promptTemplate ?? preset?.promptTemplate ?? current.theme_prompt_template;
  const keywords = input.keywords ?? preset?.keywords ?? parseKeywords(current.theme_keywords_json);
  const sampleUrl =
    input.sampleUrl === undefined ? current.theme_sample_url : input.sampleUrl;

  db.prepare(
    `UPDATE companies
     SET theme_name = ?, theme_prompt_template = ?, theme_keywords_json = ?, theme_sample_url = ?, updated_at = ?
     WHERE id = ?`
  ).run(name, promptTemplate, JSON.stringify(keywords), sampleUrl ?? null, now, current.id);

  return {
    companyId: current.id,
    companySlug: current.slug,
    theme: {
      name,
      promptTemplate,
      keywords,
      ...(sampleUrl ? { sampleUrl } : {}),
    },
  };
}

export function resetCompanyTheme(companySlug: string): {
  companyId: string;
  companySlug: string;
  theme: CompanyThemeView;
} {
  return updateCompanyTheme({
    companySlug,
    presetId: "corporate-noir",
    sampleUrl: null,
  });
}

/* ── Inbox Read State ── */

export function markInboxEventsRead(input: {
  companyIdOrSlug: string;
  eventIds: string[];
  userId?: string;
}): { marked: number } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  const userId = input.userId?.trim() || "default";
  const now = new Date().toISOString();
  let marked = 0;

  const insertRead = db.prepare(
    `INSERT OR IGNORE INTO inbox_read_state (id, company_id, user_id, event_id, read_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const insertReadEvent = db.prepare(
    `INSERT OR IGNORE INTO task_events (id, project_id, task_id, agent_id, user_id, event_type, metadata_json, created_at)
     SELECT ?, te.project_id, te.task_id, NULL, ?, 'task.read_marked', '{}', ?
     FROM task_events te WHERE te.id = ? LIMIT 1`
  );

  const tx = db.transaction(() => {
    for (const eventId of input.eventIds) {
      const id = `${companyRow.id}:${userId}:${eventId}`;
      const result = insertRead.run(id, companyRow.id, userId, eventId, now);
      if (result.changes > 0) {
        marked++;
        // Emit a read-mark activity event for task events
        const taskEventId = eventId.startsWith("task:") ? eventId.slice(5) : null;
        if (taskEventId) {
          const readEventId = randomUUID();
          insertReadEvent.run(readEventId, userId, now, taskEventId);
        }
      }
    }
  });
  tx();

  return { marked };
}

/**
 * Mark all events for a given thread (task_key or approval_id) as read.
 * This ensures viewing one inbox item marks the whole thread as seen.
 */
export function markInboxThreadRead(input: {
  companyIdOrSlug: string;
  threadKey: string; // e.g. "NEV-25" (task key) or approval UUID
  threadKind: "task" | "approval";
  userId?: string;
}): { marked: number } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  const userId = input.userId?.trim() || "default";
  const now = new Date().toISOString();

  const feedCte = buildInboxFeedCte(companyRow.id);

  // Find all unread event IDs for this thread
  const threadEventRows = db
    .prepare(
      `${feedCte.sql}
      SELECT fe.event_id
      FROM feed_events fe
      LEFT JOIN inbox_read_state irs
        ON irs.company_id = ? AND irs.user_id = ? AND irs.event_id = fe.event_id
      WHERE irs.id IS NULL
        AND ${
          input.threadKind === "approval"
            ? "fe.event_kind = 'approval' AND json_extract(fe.metadata_json, '$.approvalId') = ?"
            : "(fe.task_key = ? AND fe.task_key != '')"
        }`
    )
    .all(...feedCte.params, companyRow.id, userId, input.threadKey) as { event_id: string }[];

  if (threadEventRows.length === 0) return { marked: 0 };

  const insertRead = db.prepare(
    `INSERT OR IGNORE INTO inbox_read_state (id, company_id, user_id, event_id, read_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  let marked = 0;
  const tx = db.transaction(() => {
    for (const row of threadEventRows) {
      const id = `${companyRow.id}:${userId}:${row.event_id}`;
      const result = insertRead.run(id, companyRow.id, userId, row.event_id, now);
      if (result.changes > 0) marked++;
    }
  });
  tx();

  return { marked };
}

export function archiveInboxEvents(input: {
  companyIdOrSlug: string;
  eventIds: string[];
  userId?: string;
}): { archived: number } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  const userId = input.userId?.trim() || "default";
  const now = new Date().toISOString();
  let archived = 0;

  const upsert = db.prepare(
    `INSERT INTO inbox_read_state (id, company_id, user_id, event_id, read_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET archived_at = excluded.archived_at`
  );

  const tx = db.transaction(() => {
    for (const eventId of input.eventIds) {
      const id = `${companyRow.id}:${userId}:${eventId}`;
      const result = upsert.run(id, companyRow.id, userId, eventId, now, now);
      if (result.changes > 0) archived++;
    }
  });
  tx();

  return { archived };
}

export function markAllInboxRead(input: {
  companyIdOrSlug: string;
  userId?: string;
  beforeTimestamp?: string;
}): { marked: number } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  const userId = input.userId?.trim() || "default";
  const now = new Date().toISOString();
  const beforeTs = input.beforeTimestamp?.trim() || now;

  // Use shared CTE to find all unread event IDs
  const feedCte = buildInboxFeedCte(companyRow.id, { beforeTimestamp: beforeTs });
  const eventRows = db.prepare(
    `${feedCte.sql}
    SELECT fe.event_id
    FROM feed_events fe
    LEFT JOIN inbox_read_state irs
      ON irs.company_id = ? AND irs.user_id = ? AND irs.event_id = fe.event_id
    WHERE irs.id IS NULL`
  ).all(...feedCte.params, companyRow.id, userId) as Array<{ event_id: string }>;

  if (eventRows.length === 0) return { marked: 0 };

  const insertRead = db.prepare(
    `INSERT OR IGNORE INTO inbox_read_state (id, company_id, user_id, event_id, read_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const insertReadEvent = db.prepare(
    `INSERT OR IGNORE INTO task_events (id, project_id, task_id, agent_id, user_id, event_type, metadata_json, created_at)
     SELECT ?, te.project_id, te.task_id, NULL, ?, 'task.read_marked', '{}', ?
     FROM task_events te WHERE te.id = ? LIMIT 1`
  );

  let marked = 0;
  const MAX_READ_EVENTS = 20;
  let readEventsEmitted = 0;

  const tx = db.transaction(() => {
    for (const row of eventRows) {
      const id = `${companyRow.id}:${userId}:${row.event_id}`;
      const result = insertRead.run(id, companyRow.id, userId, row.event_id, now);
      if (result.changes > 0) {
        marked++;
        // Emit per-item read-mark events (capped to avoid feed spam)
        if (readEventsEmitted < MAX_READ_EVENTS) {
          const taskEventId = row.event_id.startsWith("task:") ? row.event_id.slice(5) : null;
          if (taskEventId) {
            const readEventId = randomUUID();
            insertReadEvent.run(readEventId, userId, now, taskEventId);
            readEventsEmitted++;
          }
        }
      }
    }
  });
  tx();

  return { marked };
}

export function isInboxEventRead(input: {
  companyId: string;
  userId: string;
  eventId: string;
}): boolean {
  const db = getOrchestrationDb();
  const row = db.prepare(
    `SELECT 1 FROM inbox_read_state WHERE company_id = ? AND user_id = ? AND event_id = ? LIMIT 1`
  ).get(input.companyId, input.userId, input.eventId);
  return !!row;
}

export function getInboxUnreadCount(input: {
  companyId: string;
  userId?: string;
}): number {
  const db = getOrchestrationDb();
  const userId = input.userId?.trim() || "default";

  const feedCte = buildInboxFeedCte(input.companyId);
  const row = db.prepare(
    `${feedCte.sql}
    SELECT COUNT(*) AS count
    FROM feed_events fe
    LEFT JOIN inbox_read_state irs
      ON irs.company_id = ? AND irs.user_id = ? AND irs.event_id = fe.event_id
    WHERE irs.id IS NULL`
  ).get(...feedCte.params, input.companyId, userId) as { count: number };

  return row?.count ?? 0;
}
