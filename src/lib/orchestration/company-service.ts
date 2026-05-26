import { randomUUID } from "crypto";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import type { CompanyStatusInput, SprintStatusInput, TaskStatusInput } from "@/lib/orchestration/contracts";
import type {
  GoalContractEvidenceStatus,
  GoalContractItemKind,
  OrchestrationCompany,
  OrchestrationCompanyGoal,
  OrchestrationCompanyInboxEvent,
  OrchestrationCompanyInboxTask,
  OrchestrationGoalContractEvidence,
  OrchestrationGoalContractItem,
  OrchestrationGoalValidationSummary,
  OrchestrationPendingSprintPlanDraftSummary,
  OrchestrationSprintPlanDraft,
  OrchestrationSprintPlanDraftSprint,
  OrchestrationSprintPlanDraftTask,
  TaskExecutionEngine,
  TaskModelLane,
  TaskPriority,
  TaskType,
} from "@/lib/orchestration/types";
import { createTask } from "@/lib/orchestration/service/task";
import {
  readDefaultExecutionEngine,
  resolveTaskExecutionEngine,
  toApiPriority,
  toApiSprintStatus,
  toApiStatus,
  toApiType,
  toDbSprintStatus,
  toDbStatus,
} from "@/lib/orchestration/service/shared/mappers";
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
import { refreshEdgeRouteMapCache } from "@/lib/orchestration/edge-route-map-service";
import { recordPlanningRetrospectiveMemory } from "@/lib/orchestration/planning-retrospectives";
import { isExecutableAgentRuntime } from "@/lib/orchestration/runtime-readiness";
import {
  ensureCompanyWorkspaceScaffold,
  resolveCanonicalCompanyWorkspaceRoot,
  resolveCompanyWorkspaceRoot,
} from "@/lib/workspaces/company-paths";
import { isSafeManagedCompanyWorkspacePath } from "@/lib/workspaces/delete-safety";
import { resolveOpenClawDir } from "@/lib/workspaces/root";
import { ensureUniqueCompanyRuntimeSlug } from "@/lib/orchestration/runtime-identifiers";

const execFileAsync = promisify(execFile);
const GOAL_LEAD_PLANNING_TRIGGER = "goal_lead_planning";
const SPRINT_APPROVAL_START_REASON = "sprint_approved_start";

type CompanyRow = {
  id: string;
  slug: string;
  workspace_slug: string | null;
  runtime_slug: string | null;
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
  settings_json: string | null;
  owner_user_id: string | null;
  owner_display_name: string | null;
  owner_email: string | null;
  owner_member_role: "owner" | "admin" | "member" | "viewer" | null;
  owner_member_status: "active" | "invited" | "suspended" | "removed" | null;
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
  status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked";
  column_order: number;
  assignee_name: string | null;
  blocked_reason: string | null;
  execution_engine: "hiverunner" | "symphony" | "manual" | null;
  execution_mode: "openclaw" | "manual";
  project_settings_json: string | null;
  company_settings_json: string | null;
  labels_json: string;
  source_review_id: string | null;
  source_takeaway_id: string | null;
  created_at: string;
  updated_at: string;
};

type CompanyGoalRow = {
  sprint_id: string;
  sprint_key: string | null;
  sprint_goal_key: string | null;
  sprint_name: string;
  sprint_goal: string;
  sprint_goal_kind: "company" | "sprint" | null;
  sprint_status: "planning" | "active" | "blocked" | "paused" | "completed";
  sprint_start_date: string;
  sprint_end_date: string | null;
  sprint_created_at: string;
  sprint_updated_at: string;
  sprint_parent_id: string | null;
  sprint_owner: string | null;
  sprint_lead_agent_id: string | null;
  sprint_stop_condition: string | null;
  sprint_progress_summary: string | null;
  sprint_default_execution_engine: TaskExecutionEngine | null;
  sprint_default_model_lane: TaskModelLane | null;
  project_id: string;
  project_slug: string;
  project_name: string;
  project_color: string;
  task_count: number;
  in_progress_count: number;
  review_count: number;
  done_count: number;
};

type GoalPlanMetrics = {
  taskCount: number;
  doneCount: number;
  pendingTaskCount: number;
  sprintCount: number;
  approvedSprintCount: number;
  doneSprintCount: number;
  pendingSprintCount: number;
};

type CompanyProjectScopeRow = {
  id: string;
};

type CompanyScopedSprintRow = {
  id: string;
  sprint_key: string | null;
  goal_key: string | null;
  project_id: string;
  name: string;
  goal: string;
  goal_kind: "company" | "sprint" | null;
  status: "planning" | "active" | "blocked" | "paused" | "completed";
  start_date: string;
  end_date: string | null;
  completed_at: string | null;
  parent_id: string | null;
  owner: string | null;
  lead_agent_id: string | null;
  stop_condition: string | null;
  progress_summary: string | null;
  default_execution_engine: TaskExecutionEngine | null;
  default_model_lane: TaskModelLane | null;
};

type SprintApprovalRootTaskWakeRow = {
  id: string;
  task_key: string | null;
  company_id: string;
  project_id: string | null;
  sprint_id: string | null;
  status: string;
  assignee_agent_id: string;
  depends_on_json: string | null;
  execution_engine: TaskExecutionEngine | null;
  model_lane: TaskModelLane | null;
  agent_status: string;
  agent_adapter_type: string | null;
};

function sprintSequenceForCompany(db: ReturnType<typeof getOrchestrationDb>, companyId: string): number {
  const row = db
    .prepare(
      `SELECT
         COALESCE(
           MAX(CASE
             WHEN s.sprint_key LIKE '%-S%' THEN CAST(substr(s.sprint_key, instr(s.sprint_key, '-S') + 2) AS INTEGER)
             ELSE NULL
           END),
           COUNT(*)
         ) + 1 AS next_sequence
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       WHERE p.company_id = ?
         AND s.parent_id IS NOT NULL`
    )
    .get(companyId) as { next_sequence: number } | undefined;
  return Math.max(1, Number(row?.next_sequence ?? 1));
}

function sprintKeyForCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  companyCode: string | null | undefined,
): string {
  return sprintKeyForSequence(companyCode, sprintSequenceForCompany(db, companyId));
}

function sprintKeyForSequence(companyCode: string | null | undefined, sequenceNumber: number): string {
  const prefix = (companyCode?.trim() || "SPR").toUpperCase();
  return `${prefix}-S${Math.max(1, sequenceNumber).toString().padStart(3, "0")}`;
}

function goalSequenceForCompany(db: ReturnType<typeof getOrchestrationDb>, companyId: string): number {
  const row = db
    .prepare(
      `SELECT
         COALESCE(
           MAX(CASE
             WHEN s.goal_key LIKE '%-G%' THEN CAST(substr(s.goal_key, instr(s.goal_key, '-G') + 2) AS INTEGER)
             ELSE NULL
           END),
           COUNT(*)
         ) + 1 AS next_sequence
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       WHERE p.company_id = ?
         AND s.goal_kind = 'company'`
    )
    .get(companyId) as { next_sequence: number } | undefined;
  return Math.max(1, Number(row?.next_sequence ?? 1));
}

function goalKeyForCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  companyCode: string | null | undefined,
): string {
  const prefix = (companyCode?.trim() || "GOAL").toUpperCase();
  return `${prefix}-G${goalSequenceForCompany(db, companyId).toString().padStart(3, "0")}`;
}

function sprintNameWithSequence(name: string, sequenceNumber: number): string {
  const trimmed = name.trim();
  if (/^sprint\s+\d+\s+[—-]\s+/i.test(trimmed)) return trimmed;
  return `Sprint ${Math.max(1, sequenceNumber)} — ${trimmed}`;
}

type GoalContractItemRow = {
  id: string;
  sprint_id: string;
  kind: GoalContractItemKind;
  text: string;
  position: number;
  created_at: string;
  updated_at: string;
  evidence_id: string | null;
  evidence_status: GoalContractEvidenceStatus | null;
  evidence_source: "agent" | "operator" | "system" | null;
  evidence_result_text: string | null;
  evidence_command_exit_code: number | null;
  evidence_artifact_uri: string | null;
  evidence_recorded_by_agent_id: string | null;
  evidence_recorded_by_user_id: string | null;
  evidence_created_at: string | null;
};

type ScopedGoalContractItemRow = GoalContractItemRow & {
  project_id: string;
  sprint_status: "planning" | "active" | "blocked" | "paused" | "completed";
  sprint_goal_kind: "company" | "sprint" | null;
  sprint_parent_id: string | null;
};

type SprintPlanDraftRow = {
  id: string;
  company_id: string;
  company_goal_id: string;
  planning_task_id: string | null;
  proposed_by_agent_id: string | null;
  status: OrchestrationSprintPlanDraft["status"];
  sequence_number: number;
  proposal_group_id: string | null;
  sprint_json: string;
  tasks_json: string;
  reject_reason: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
};

type CompanyInboxEventRow = {
  event_id: string;
  event_type: string;
  event_kind: "task" | "execution" | "approval" | "sprint_plan_draft" | "lead_supervisor_update";
  company_id: string;
  company_slug: string;
  company_name: string;
  project_id: string;
  project_slug: string;
  project_name: string;
  project_color: string;
  task_id: string | null;
  task_title: string | null;
  task_key: string | null;
  sprint_id: string | null;
  sprint_name: string | null;
  sprint_status: "planning" | "active" | "blocked" | "paused" | "completed" | null;
  company_goal_id: string | null;
  company_goal_name: string | null;
  company_goal_status: "planning" | "active" | "blocked" | "paused" | "completed" | null;
  task_status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked" | null;
  from_status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked" | null;
  to_status: "backlog" | "to-do" | "in_progress" | "review" | "done" | "blocked" | null;
  agent_id: string | null;
  agent_name: string | null;
  avatar_url: string | null;
  provider: string | null;
  metadata_json: string;
  created_at: string;
};

type InboxCommentPreviewRow = {
  task_id: string;
  body: string;
  created_at: string;
};

type CompanyOwnerInput = {
  displayName: string;
  email: string;
};

function normalizeOwnerInput(owner: CompanyOwnerInput | undefined): CompanyOwnerInput | undefined {
  const displayName = owner?.displayName?.trim();
  const email = owner?.email?.trim().toLowerCase();
  if (!displayName || !email) return undefined;
  return { displayName, email };
}

function upsertCompanyOwner(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  owner: CompanyOwnerInput | undefined;
  currentOwnerUserId?: string | null;
  now: string;
}): string | null {
  const owner = normalizeOwnerInput(input.owner);
  if (!owner) return input.currentOwnerUserId ?? null;

  const existingById = input.currentOwnerUserId
    ? input.db.prepare("SELECT id FROM users WHERE id = ? LIMIT 1").get(input.currentOwnerUserId) as { id: string } | undefined
    : undefined;
  const existingByEmail = input.db
    .prepare("SELECT id FROM users WHERE lower(email) = lower(?) LIMIT 1")
    .get(owner.email) as { id: string } | undefined;
  const userId = existingById?.id ?? input.currentOwnerUserId ?? existingByEmail?.id ?? randomUUID();

  input.db.prepare(
    `INSERT INTO users (id, display_name, email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       display_name = excluded.display_name,
       email = excluded.email,
       updated_at = excluded.updated_at,
       archived_at = NULL`
  ).run(userId, owner.displayName, owner.email, input.now, input.now);

  input.db.prepare(
    `INSERT INTO company_members (id, company_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', 'active', ?, ?)
     ON CONFLICT(company_id, user_id) DO UPDATE SET
       role = 'owner',
       status = 'active',
       updated_at = excluded.updated_at`
  ).run(`member-${input.companyId}-${userId}`, input.companyId, userId, input.now, input.now);

  input.db.prepare(
    `UPDATE companies
     SET owner_user_id = ?, updated_at = ?
     WHERE id = ?`
  ).run(userId, input.now, input.companyId);

  return userId;
}

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
    includeArchivedInbox?: boolean;
  }
): { sql: string; params: unknown[] } {
  const taskWhere = ["p.company_id = ?", "p.archived_at IS NULL", "t.archived_at IS NULL"];
  const taskParams: unknown[] = [companyId];
  const execWhere = ["p.company_id = ?", "p.archived_at IS NULL", "t.archived_at IS NULL"];
  const execParams: unknown[] = [companyId];
  const draftWhere = ["d.company_id = ?", "d.status = 'pending'", "p.archived_at IS NULL", "g.archived_at IS NULL"];
  const draftParams: unknown[] = [companyId];
  const supervisorWhere = ["c.id = ?", "p.archived_at IS NULL", "pt.archived_at IS NULL", "lc.source = 'lead-supervisor'"];
  const supervisorParams: unknown[] = [companyId];

  if (opts?.beforeTimestamp) {
    taskWhere.push("te.created_at <= ?");
    taskParams.push(opts.beforeTimestamp);
    execWhere.push("COALESCE(er.completed_at, er.updated_at, er.created_at) <= ?");
    execParams.push(opts.beforeTimestamp);
    draftWhere.push("d.created_at <= ?");
    draftParams.push(opts.beforeTimestamp);
    supervisorWhere.push("lc.created_at <= ?");
    supervisorParams.push(opts.beforeTimestamp);
  }

  if (opts?.projectId) {
    taskWhere.push("(p.id = ? OR p.slug = ?)");
    taskParams.push(opts.projectId, opts.projectId);
    execWhere.push("(p.id = ? OR p.slug = ?)");
    execParams.push(opts.projectId, opts.projectId);
    draftWhere.push("(p.id = ? OR p.slug = ?)");
    draftParams.push(opts.projectId, opts.projectId);
    supervisorWhere.push("(p.id = ? OR p.slug = ?)");
    supervisorParams.push(opts.projectId, opts.projectId);
  }

  if (opts?.status) {
    taskWhere.push("t.status = ?");
    taskParams.push(opts.status);
    execWhere.push("t.status = ?");
    execParams.push(opts.status);
  } else if (opts?.excludeDone) {
    taskWhere.push("t.status <> 'done'");
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
    draftWhere.push(
      "(LOWER(g.name) LIKE ? OR LOWER(COALESCE(json_extract(d.sprint_json, '$.name'), '')) LIKE ? OR LOWER(COALESCE(a.name, '')) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(COALESCE(d.tasks_json, '')) LIKE ?)"
    );
    draftParams.push(needle, needle, needle, needle, needle);
    supervisorWhere.push(
      "(LOWER(g.name) LIKE ? OR LOWER(pt.title) LIKE ? OR LOWER(COALESCE(a.name, '')) LIKE ? OR LOWER(p.name) LIKE ? OR LOWER(lc.body) LIKE ?)"
    );
    supervisorParams.push(needle, needle, needle, needle, needle);
  }

  const archivedInboxPredicate = opts?.includeArchivedInbox
    ? ""
    : `WHERE NOT EXISTS (
        SELECT 1 FROM inbox_read_state irs2
        WHERE irs2.company_id = feed_events.company_id
          AND irs2.user_id = 'default'
          AND irs2.event_id = feed_events.event_id
          AND irs2.archived_at IS NOT NULL
      )`;

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
      p.color AS project_color,
      t.id AS task_id,
      t.title AS task_title,
      t.task_key AS task_key,
      s.id AS sprint_id,
      s.name AS sprint_name,
      s.status AS sprint_status,
      parent_s.id AS company_goal_id,
      parent_s.name AS company_goal_name,
      parent_s.status AS company_goal_status,
      t.status AS task_status,
      te.from_status AS from_status,
      te.to_status AS to_status,
      te.agent_id AS agent_id,
      a.name AS agent_name,
      CASE
        WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || c.id || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar?size=64'
        ELSE NULL
      END AS avatar_url,
      NULL AS provider,
      te.metadata_json AS metadata_json,
      te.created_at AS created_at
    FROM task_events te
    INNER JOIN tasks t ON t.id = te.task_id
    INNER JOIN projects p ON p.id = te.project_id
    INNER JOIN companies c ON c.id = p.company_id
    LEFT JOIN sprints s ON s.id = t.sprint_id
    LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
    LEFT JOIN agents a ON a.id = te.agent_id AND a.company_id = c.id
    WHERE ${taskWhere.join(" AND ")}
      AND te.event_type IN (
        'task.created', 'task.updated', 'task.archived', 'task.reordered',
        'task.status_changed', 'task.assigned', 'task.unassigned', 'task.comment_added',
        'goal.sprint_plan_approved', 'goal.sprint_plan_rejected'
      )

    UNION ALL

    SELECT
      'draft-plan:' || plan.proposal_group_id AS event_id,
      CASE
        WHEN json_extract(first_draft.sprint_json, '$.completionProposal') = 1 THEN 'goal.completion_proposed'
        ELSE 'goal.sprint_plan_proposed'
      END AS event_type,
      'sprint_plan_draft' AS event_kind,
      c.id AS company_id,
      c.slug AS company_slug,
      c.name AS company_name,
      p.id AS project_id,
      p.slug AS project_slug,
      p.name AS project_name,
      p.color AS project_color,
      t.id AS task_id,
      t.title AS task_title,
      t.task_key AS task_key,
      NULL AS sprint_id,
      COALESCE(json_extract(first_draft.sprint_json, '$.name'), 'Sprint plan') AS sprint_name,
      NULL AS sprint_status,
      g.id AS company_goal_id,
      g.name AS company_goal_name,
      g.status AS company_goal_status,
      t.status AS task_status,
      NULL AS from_status,
      NULL AS to_status,
      plan.proposed_by_agent_id AS agent_id,
      a.name AS agent_name,
      CASE
        WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || c.id || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar?size=64'
        ELSE NULL
      END AS avatar_url,
      NULL AS provider,
      json_object(
        'draftId', first_draft.id,
        'proposalGroupId', plan.proposal_group_id,
        'companyGoalId', g.id,
        'companyGoalName', g.name,
        'sprintName', COALESCE(json_extract(first_draft.sprint_json, '$.name'), 'Sprint plan'),
        'completionProposal', json_extract(first_draft.sprint_json, '$.completionProposal'),
        'completionReason', json_extract(first_draft.sprint_json, '$.completionReason'),
        'taskCount', plan.task_count,
        'sprintCount', plan.sprint_count,
        'nextSequenceNumber', plan.next_sequence_number,
        'materialized', plan.materialized_count > 0,
        'proposedByAgentId', plan.proposed_by_agent_id,
        'proposedByAgentName', a.name
      ) AS metadata_json,
      plan.created_at AS created_at
    FROM (
      SELECT
        d.company_id,
        d.company_goal_id,
        COALESCE(d.proposal_group_id, d.id) AS proposal_group_id,
        MIN(d.sequence_number) AS next_sequence_number,
        COUNT(*) AS sprint_count,
        SUM(json_array_length(d.tasks_json)) AS task_count,
        MIN(d.created_at) AS created_at,
        MIN(d.planning_task_id) AS planning_task_id,
        MIN(d.proposed_by_agent_id) AS proposed_by_agent_id,
        (
          SELECT COUNT(*)
          FROM goal_sprint_plan_drafts approved_d
          WHERE approved_d.company_id = d.company_id
            AND approved_d.company_goal_id = d.company_goal_id
            AND COALESCE(approved_d.proposal_group_id, approved_d.id) = COALESCE(d.proposal_group_id, d.id)
            AND approved_d.status = 'approved'
        ) AS materialized_count
      FROM goal_sprint_plan_drafts d
      INNER JOIN sprints g ON g.id = d.company_goal_id
      INNER JOIN projects p ON p.id = g.project_id
      WHERE ${draftWhere.join(" AND ")}
      GROUP BY d.company_id, d.company_goal_id, COALESCE(d.proposal_group_id, d.id)
    ) plan
    INNER JOIN companies c ON c.id = plan.company_id
    INNER JOIN sprints g ON g.id = plan.company_goal_id
    INNER JOIN projects p ON p.id = g.project_id
    INNER JOIN goal_sprint_plan_drafts first_draft
      ON first_draft.company_goal_id = plan.company_goal_id
     AND COALESCE(first_draft.proposal_group_id, first_draft.id) = plan.proposal_group_id
     AND first_draft.sequence_number = plan.next_sequence_number
     AND first_draft.status = 'pending'
    LEFT JOIN tasks t ON t.id = plan.planning_task_id
    LEFT JOIN agents a ON a.id = plan.proposed_by_agent_id AND a.company_id = c.id

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
      p.color AS project_color,
      t.id AS task_id,
      t.title AS task_title,
      t.task_key AS task_key,
      s.id AS sprint_id,
      s.name AS sprint_name,
      s.status AS sprint_status,
      parent_s.id AS company_goal_id,
      parent_s.name AS company_goal_name,
      parent_s.status AS company_goal_status,
      t.status AS task_status,
      NULL AS from_status,
      NULL AS to_status,
      er.agent_id AS agent_id,
      a.name AS agent_name,
      CASE
        WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || c.id || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar?size=64'
        ELSE NULL
      END AS avatar_url,
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
    LEFT JOIN sprints s ON s.id = t.sprint_id
    LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
    LEFT JOIN agents a ON a.id = er.agent_id AND a.company_id = c.id
    WHERE ${execWhere.join(" AND ")}
      AND er.status IN ('pending', 'running', 'completed', 'failed', 'cancelled')

    UNION ALL

    SELECT
      'lead-supervisor:' || sup.company_goal_id AS event_id,
      'lead_supervisor_update' AS event_type,
      'lead_supervisor_update' AS event_kind,
      sup.company_id,
      sup.company_slug,
      sup.company_name,
      sup.project_id,
      sup.project_slug,
      sup.project_name,
      sup.project_color,
      sup.task_id,
      sup.task_title,
      sup.task_key,
      NULL AS sprint_id,
      NULL AS sprint_name,
      NULL AS sprint_status,
      sup.company_goal_id,
      sup.company_goal_name,
      sup.company_goal_status,
      sup.task_status,
      NULL AS from_status,
      NULL AS to_status,
      sup.agent_id,
      sup.agent_name,
      sup.avatar_url,
      NULL AS provider,
      json_object(
        'goalId', sup.company_goal_id,
        'goalName', sup.company_goal_name,
        'summary', sup.body,
        'commentId', sup.comment_id
      ) AS metadata_json,
      sup.created_at
    FROM (
      SELECT
        c.id AS company_id,
        c.slug AS company_slug,
        c.name AS company_name,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        p.color AS project_color,
        pt.id AS task_id,
        pt.title AS task_title,
        pt.task_key AS task_key,
        g.id AS company_goal_id,
        g.name AS company_goal_name,
        g.status AS company_goal_status,
        pt.status AS task_status,
        lc.author_agent_id AS agent_id,
        a.name AS agent_name,
        CASE
          WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || c.id || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar?size=64'
          ELSE NULL
        END AS avatar_url,
        lc.id AS comment_id,
        lc.body AS body,
        lc.created_at AS created_at,
        ROW_NUMBER() OVER (PARTITION BY g.id ORDER BY datetime(lc.created_at) DESC, lc.id DESC) AS rn
      FROM comments lc
      INNER JOIN tasks pt ON pt.id = lc.task_id
      INNER JOIN goal_sprint_plan_drafts d ON d.planning_task_id = pt.id
      INNER JOIN sprints g ON g.id = d.company_goal_id
      INNER JOIN projects p ON p.id = g.project_id
      INNER JOIN companies c ON c.id = p.company_id
      LEFT JOIN agents a ON a.id = lc.author_agent_id AND a.company_id = c.id
      WHERE ${supervisorWhere.join(" AND ")}
    ) sup
    WHERE sup.rn = 1

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
      COALESCE(p.color, '#22d3ee') AS project_color,
      ap.linked_task_id AS task_id,
      COALESCE(t.title, '') AS task_title,
      COALESCE(t.task_key, '') AS task_key,
      s.id AS sprint_id,
      s.name AS sprint_name,
      s.status AS sprint_status,
      parent_s.id AS company_goal_id,
      parent_s.name AS company_goal_name,
      parent_s.status AS company_goal_status,
      COALESCE(t.status, 'backlog') AS task_status,
      NULL AS from_status,
      NULL AS to_status,
      ap.requested_by_agent_id AS agent_id,
      ag.name AS agent_name,
      CASE
        WHEN ag.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || c.id || '/agents/' || COALESCE(NULLIF(ag.slug, ''), ag.id) || '/avatar?size=64'
        ELSE NULL
      END AS avatar_url,
      NULL AS provider,
      json_object(
        'approvalId', ap.id,
        'approvalType', ap.type,
        'approvalStatus', ap.status,
        'approvalLabel', CASE ap.type
          WHEN 'hire_agent' THEN 'Hire Agent: ' || COALESCE(json_extract(ap.payload_json, '$.name'), json_extract(ap.payload_json, '$.agentName'), 'Unknown')
          WHEN 'approve_ceo_strategy' THEN COALESCE(json_extract(ap.payload_json, '$.title'), 'CEO Strategy Approval')
          WHEN 'budget_override_required' THEN 'Budget Override: ' || COALESCE(json_extract(ap.payload_json, '$.scopeName'), 'Required')
          WHEN 'provider_switch' THEN 'Provider Switch: ' || COALESCE(json_extract(ap.payload_json, '$.agentName'), json_extract(ap.payload_json, '$.agentId'), 'Agent') || ' to ' || COALESCE(json_extract(ap.payload_json, '$.targetProvider'), 'runtime')
          WHEN 'protected_runtime_command' THEN 'Protected Runtime: ' || COALESCE(json_extract(ap.payload_json, '$.summary'), json_extract(ap.payload_json, '$.command'), 'Command')
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
    LEFT JOIN sprints s ON s.id = t.sprint_id
    LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
    LEFT JOIN agents ag ON ag.id = ap.requested_by_agent_id AND ag.company_id = c.id
    WHERE ap.company_id = ?
  ),
  visible_feed_events AS (
    SELECT *
    FROM feed_events
    ${archivedInboxPredicate}
  )`;

  return { sql, params: [...taskParams, ...draftParams, ...execParams, ...supervisorParams, companyId] };
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

function cleanInboxSummary(value: string, maxLength = 220): string {
  const clean = value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1 attachment")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function toInboxEventType(
  row: CompanyInboxEventRow
): OrchestrationCompanyInboxEvent["eventType"] {
  if (row.event_kind === "lead_supervisor_update") {
    return "lead_supervisor_update";
  }

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
    case "goal.sprint_plan_proposed":
    case "goal.sprint_plan_approved":
    case "goal.sprint_plan_rejected":
    case "goal.completion_proposed":
    case "goal.completion_approved":
    case "goal.completion_rejected":
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
    const providerLabel =
      provider === "codex" ? "Codex" :
      provider === "anthropic" ? "Claude Code" :
      provider === "gemini" ? "Gemini" :
      provider === "symphony" ? "External runner" :
      provider === "multica" ? "Multica" :
      provider === "openclaw" ? "OpenClaw" :
      provider;
    const state = row.event_type.replace("execution.", "");
    if (state === "completed") return `${taskTitle} execution completed (${providerLabel})`;
    if (state === "failed") return `${taskTitle} execution failed (${providerLabel})`;
    if (state === "cancelled") return `${taskTitle} execution cancelled (${providerLabel})`;
    if (state === "running") return `${taskTitle} execution started (${providerLabel})`;
    return `${taskTitle} execution queued (${providerLabel})`;
  }

  if (row.event_kind === "lead_supervisor_update") {
    const summary = typeof metadata.summary === "string" ? cleanInboxSummary(metadata.summary) : "Latest sprint supervision update";
    return `Lead supervisor update for ${row.company_goal_name ?? "goal"}: ${summary}`;
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
  if (row.event_type === "goal.sprint_plan_proposed") {
    const sprintName = typeof metadata.sprintName === "string" ? metadata.sprintName : "Sprint plan";
    return `${sprintName} proposed for review`;
  }
  if (row.event_type === "goal.sprint_plan_approved") return `${taskTitle} sprint plan approved`;
  if (row.event_type === "goal.sprint_plan_rejected") return `${taskTitle} sprint plan rejected`;
  if (row.event_type === "goal.completion_proposed") return "Goal completion proposed";
  if (row.event_type === "goal.completion_approved") return "Goal completion approved";
  if (row.event_type === "goal.completion_rejected") return "Goal completion rejected";
  if (row.event_type === "task.created") return `${taskTitle} created`;
  if (row.event_type === "task.archived") return `${taskTitle} archived`;
  return `${taskTitle} updated`;
}

function commentPreviewForInboxEvent(
  row: CompanyInboxEventRow,
  commentsByTask: Map<string, InboxCommentPreviewRow[]>
): string | undefined {
  if (row.event_type !== "task.comment_added" || !row.task_id) return undefined;
  const comments = commentsByTask.get(row.task_id);
  if (!comments?.length) return undefined;

  const eventTime = new Date(row.created_at).getTime();
  if (Number.isNaN(eventTime)) return comments[0]?.body;

  const exact = comments.find((comment) => {
    const commentTime = new Date(comment.created_at).getTime();
    return !Number.isNaN(commentTime) && Math.abs(commentTime - eventTime) <= 5000;
  });
  if (exact) return exact.body;

  return comments.find((comment) => {
    const commentTime = new Date(comment.created_at).getTime();
    return !Number.isNaN(commentTime) && commentTime <= eventTime + 1000;
  })?.body;
}

function getCompanyRowBySlug(slug: string, ownerUserId?: string): CompanyRow | undefined {
  const db = getOrchestrationDb();
  const ownerClause = ownerUserId ? "AND c.owner_user_id = ?" : "";
  // Try the canonical slug first, then fall back to a stored slug alias.
  const row = db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.workspace_slug,
        c.runtime_slug,
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
        c.settings_json,
        c.owner_user_id,
        owner.display_name AS owner_display_name,
        owner.email AS owner_email,
        owner_member.role AS owner_member_role,
        owner_member.status AS owner_member_status,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL AND p.slug != 'no-project' AND p.slug NOT LIKE 'no-project-%'
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN users owner ON owner.id = c.owner_user_id AND owner.archived_at IS NULL
       LEFT JOIN company_members owner_member ON owner_member.company_id = c.id AND owner_member.user_id = owner.id
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'to-do', 'in_progress', 'review', 'blocked')
       WHERE c.slug = ? AND c.archived_at IS NULL
         ${ownerClause}
       GROUP BY c.id`
    )
    .get(...(ownerUserId ? [slug, ownerUserId] : [slug])) as CompanyRow | undefined;

  if (row) return row;

  // Resolve via slug alias (e.g. old slug after rename).
  const aliasRow = db
    .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(slug) as { company_id: string } | undefined;
  if (!aliasRow) return undefined;

  return getCompanyRowById(aliasRow.company_id, ownerUserId);
}

function getCompanyRowById(companyId: string, ownerUserId?: string): CompanyRow | undefined {
  const db = getOrchestrationDb();
  const ownerClause = ownerUserId ? "AND c.owner_user_id = ?" : "";
  return db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.workspace_slug,
        c.runtime_slug,
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
        c.settings_json,
        c.owner_user_id,
        owner.display_name AS owner_display_name,
        owner.email AS owner_email,
        owner_member.role AS owner_member_role,
        owner_member.status AS owner_member_status,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN users owner ON owner.id = c.owner_user_id AND owner.archived_at IS NULL
       LEFT JOIN company_members owner_member ON owner_member.company_id = c.id AND owner_member.user_id = owner.id
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'to-do', 'in_progress', 'review', 'blocked')
       WHERE c.id = ? AND c.archived_at IS NULL
         ${ownerClause}
       GROUP BY c.id`
    )
    .get(...(ownerUserId ? [companyId, ownerUserId] : [companyId])) as CompanyRow | undefined;
}

function themeFromRow(row: CompanyRow): CompanyThemeView {
  return {
    name: row.theme_name,
    promptTemplate: row.theme_prompt_template,
    keywords: parseKeywords(row.theme_keywords_json),
    sampleUrl: row.theme_sample_url ?? undefined,
  };
}

function getCompanyRowByIdOrSlug(companyIdOrSlug: string, ownerUserId?: string): CompanyRow | undefined {
  const resolved = resolveCompanyIdBySlug(companyIdOrSlug, undefined, { ownerUserId });
  return resolved ? getCompanyRowById(resolved.id, ownerUserId) : undefined;
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
        s.sprint_key,
        s.goal_key,
        s.project_id,
        s.name,
        s.goal,
        s.goal_kind,
        s.status,
        s.start_date,
        s.end_date,
	        s.completed_at,
	        s.parent_id,
	        s.owner,
	        s.lead_agent_id,
	        s.stop_condition,
	        s.progress_summary,
	        s.default_execution_engine,
	        s.default_model_lane
	       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?
         AND p.company_id = ?
         AND p.archived_at IS NULL
         AND s.archived_at IS NULL
       LIMIT 1`
    )
	    .get(sprintId, companyId) as CompanyScopedSprintRow | undefined;
}

function parseDependencyIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

function enqueueSprintApprovalWakeup(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  agentId: string;
  taskId: string;
  taskStatus: string;
  projectId: string | null;
  sprintId: string;
  companyGoalId: string;
  now: string;
}): "queued" | "coalesced" {
  const idempotencyKey = `sprint_approval_start:${input.taskId}:${input.agentId}`;
  const existing = input.db
    .prepare(
      `SELECT id
       FROM agent_wakeup_requests
       WHERE idempotency_key = ?
         AND status = 'queued'
       LIMIT 1`
    )
    .get(idempotencyKey) as { id: string } | undefined;

  if (existing) {
    input.db
      .prepare(
        `UPDATE agent_wakeup_requests
         SET coalesced_count = coalesced_count + 1,
             updated_at = ?
         WHERE id = ?`
      )
      .run(input.now, existing.id);
    return "coalesced";
  }

  input.db
    .prepare(
      `UPDATE agent_wakeup_requests
       SET idempotency_key = NULL
       WHERE idempotency_key = ?
         AND status IN ('finished', 'failed', 'cancelled', 'claimed')`
    )
    .run(idempotencyKey);

  const wakeupId = randomUUID();
  const heartbeatRunId = randomUUID();
  const payload = {
    taskId: input.taskId,
    taskStatus: input.taskStatus,
    projectId: input.projectId,
    sprintId: input.sprintId,
    companyGoalId: input.companyGoalId,
  };

  input.db
    .prepare(
      `INSERT INTO agent_wakeup_requests
         (id, agent_id, company_id, source, reason, trigger_detail, payload_json, status, idempotency_key, run_id, requested_at, created_at, updated_at)
       VALUES (?, ?, ?, 'issue_assigned', ?, NULL, ?, 'queued', ?, ?, ?, ?, ?)`
    )
    .run(
      wakeupId,
      input.agentId,
      input.companyId,
      SPRINT_APPROVAL_START_REASON,
      JSON.stringify(payload),
      idempotencyKey,
      heartbeatRunId,
      input.now,
      input.now,
      input.now
    );

  input.db
    .prepare(
      `INSERT INTO heartbeat_runs
         (id, agent_id, company_id, invocation_source, trigger_detail, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
       VALUES (?, ?, ?, 'issue_assigned', NULL, 'queued', ?, ?, ?, ?)`
    )
    .run(
      heartbeatRunId,
      input.agentId,
      input.companyId,
      wakeupId,
      JSON.stringify({
        wakeSource: "issue_assigned",
        wakeReason: SPRINT_APPROVAL_START_REASON,
        ...payload,
      }),
      input.now,
      input.now
    );

  return "queued";
}

function enqueueSprintApprovalRootTaskWakeups(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  companyGoalId: string;
  sprintId: string;
  taskIds: string[];
  now: string;
}): number {
  if (input.taskIds.length === 0) return 0;
  const placeholders = input.taskIds.map(() => "?").join(",");
  const rows = input.db
    .prepare(
      `SELECT
         t.id,
         t.task_key,
         t.company_id,
         t.project_id,
         t.sprint_id,
         t.status,
         t.assignee_agent_id,
         t.depends_on_json,
         t.execution_engine,
         t.model_lane,
         a.status AS agent_status,
         a.adapter_type AS agent_adapter_type
       FROM tasks t
       INNER JOIN agents a ON a.id = t.assignee_agent_id
       WHERE t.id IN (${placeholders})
         AND t.company_id = ?
         AND t.sprint_id = ?
         AND t.archived_at IS NULL
         AND a.archived_at IS NULL`
    )
    .all(...input.taskIds, input.companyId, input.sprintId) as SprintApprovalRootTaskWakeRow[];

  let queued = 0;
  for (const row of rows) {
    if (!row.assignee_agent_id) continue;
    if (row.status !== "to-do" && row.status !== "backlog") continue;
    if (row.execution_engine === "manual") continue;
    if (row.agent_status === "paused" || row.agent_status === "offline" || row.agent_status === "error") continue;
    if (!isExecutableAgentRuntime(row.agent_adapter_type)) continue;
    if (parseDependencyIds(row.depends_on_json).length > 0) continue;
    const result = enqueueSprintApprovalWakeup({
      db: input.db,
      companyId: input.companyId,
      agentId: row.assignee_agent_id,
      taskId: row.id,
      taskStatus: row.status,
      projectId: row.project_id,
      sprintId: input.sprintId,
      companyGoalId: input.companyGoalId,
      now: input.now,
    });
    if (result === "queued") queued += 1;
  }

  return queued;
}

function mapGoalContractEvidence(row: GoalContractItemRow): OrchestrationGoalContractEvidence | null {
  if (!row.evidence_id || !row.evidence_status || !row.evidence_source || !row.evidence_created_at) return null;
  return {
    id: row.evidence_id,
    itemId: row.id,
    sprintId: row.sprint_id,
    itemKind: row.kind,
    status: row.evidence_status,
    source: row.evidence_source,
    resultText: row.evidence_result_text ?? "",
    commandExitCode: row.evidence_command_exit_code,
    artifactUri: row.evidence_artifact_uri,
    recordedByAgentId: row.evidence_recorded_by_agent_id,
    recordedByUserId: row.evidence_recorded_by_user_id,
    createdAt: row.evidence_created_at,
  };
}

function listGoalContractItemsForSprints(sprintIds: string[]): Map<string, OrchestrationGoalContractItem[]> {
  const result = new Map<string, OrchestrationGoalContractItem[]>();
  if (sprintIds.length === 0) return result;

  const db = getOrchestrationDb();
  const placeholders = sprintIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT
        i.id,
        i.sprint_id,
        i.kind,
        i.text,
        i.position,
        i.created_at,
        i.updated_at,
        e.id AS evidence_id,
        e.status AS evidence_status,
        e.source AS evidence_source,
        e.result_text AS evidence_result_text,
        e.command_exit_code AS evidence_command_exit_code,
        e.artifact_uri AS evidence_artifact_uri,
        e.recorded_by_agent_id AS evidence_recorded_by_agent_id,
        e.recorded_by_user_id AS evidence_recorded_by_user_id,
        e.created_at AS evidence_created_at
       FROM goal_contract_items i
       LEFT JOIN goal_contract_evidence e
        ON e.id = (
          SELECT latest.id
          FROM goal_contract_evidence latest
          WHERE latest.item_id = i.id
          ORDER BY latest.created_at DESC, latest.rowid DESC
          LIMIT 1
        )
       WHERE i.sprint_id IN (${placeholders})
         AND i.archived_at IS NULL
       ORDER BY i.sprint_id, i.kind, i.position ASC, i.created_at ASC`
    )
    .all(...sprintIds) as GoalContractItemRow[];

  for (const row of rows) {
    const current = result.get(row.sprint_id) ?? [];
    current.push({
      id: row.id,
      sprintId: row.sprint_id,
      kind: row.kind,
      text: row.text,
      position: Number(row.position ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      latestEvidence: mapGoalContractEvidence(row),
    });
    result.set(row.sprint_id, current);
  }

  return result;
}

function summarizeGoalValidation(items: OrchestrationGoalContractItem[]): OrchestrationGoalValidationSummary {
  const successCriteria = items.filter((item) => item.kind === "success_criterion");
  const validationChecks = items.filter((item) => item.kind === "validation_check");
  const successPassed = successCriteria.filter((item) => item.latestEvidence?.status === "passed").length;
  const validationPassed = validationChecks.filter((item) => item.latestEvidence?.status === "passed").length;
  const missingSuccess = successCriteria.length - successPassed;
  const missingValidation = validationChecks.length - validationPassed;
  const blockingReason = missingValidation > 0
    ? `${missingValidation} of ${validationChecks.length} validation checks unconfirmed`
    : missingSuccess > 0
      ? `${missingSuccess} of ${successCriteria.length} success criteria unconfirmed`
      : undefined;

  return {
    successCriteria: { total: successCriteria.length, passed: successPassed },
    validationChecks: { total: validationChecks.length, passed: validationPassed },
    blockingReason,
  };
}

function latestEvidencePassed(item: OrchestrationGoalContractItem): boolean {
  return item.latestEvidence?.status === "passed";
}

function validationGateForSprint(db: ReturnType<typeof getOrchestrationDb>, sprintId: string): string | null {
  const openTasks = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE sprint_id = ?
         AND archived_at IS NULL
         AND status <> 'done'`
    )
    .get(sprintId) as { count: number } | undefined;
  if (Number(openTasks?.count ?? 0) > 0) {
    return `${Number(openTasks?.count ?? 0)} sprint task${Number(openTasks?.count ?? 0) === 1 ? "" : "s"} still open`;
  }

  const items = listGoalContractItemsForSprints([sprintId]).get(sprintId) ?? [];
  const validationChecks = items.filter((item) => item.kind === "validation_check");
  const passed = validationChecks.filter(latestEvidencePassed).length;
  if (passed < validationChecks.length) {
    return `${validationChecks.length - passed} of ${validationChecks.length} validation checks unconfirmed`;
  }
  return null;
}

function validationGateForCompanyGoal(db: ReturnType<typeof getOrchestrationDb>, sprintId: string): string | null {
  const directOpenTasks = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE sprint_id = ?
         AND archived_at IS NULL
         AND status <> 'done'`
    )
    .get(sprintId) as { count: number } | undefined;
  if (Number(directOpenTasks?.count ?? 0) > 0) {
    return `${Number(directOpenTasks?.count ?? 0)} direct company-goal task${Number(directOpenTasks?.count ?? 0) === 1 ? "" : "s"} still need sprint assignment or closure`;
  }

  const child = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM sprints
       WHERE parent_id = ?
         AND status <> 'completed'`
    )
    .get(sprintId) as { count: number } | undefined;
  if (Number(child?.count ?? 0) > 0) {
    return `${Number(child?.count ?? 0)} supporting sprint${Number(child?.count ?? 0) === 1 ? "" : "s"} not done`;
  }

  const items = listGoalContractItemsForSprints([sprintId]).get(sprintId) ?? [];
  const successCriteria = items.filter((item) => item.kind === "success_criterion");
  const passed = successCriteria.filter(latestEvidencePassed).length;
  if (passed < successCriteria.length) {
    return `${successCriteria.length - passed} of ${successCriteria.length} success criteria unconfirmed`;
  }
  return null;
}

function completionGateFailure(
  db: ReturnType<typeof getOrchestrationDb>,
  row: CompanyScopedSprintRow
): string | null {
  const goalKind = row.goal_kind ?? (row.parent_id ? "sprint" : "company");
  return goalKind === "sprint"
    ? validationGateForSprint(db, row.id)
    : validationGateForCompanyGoal(db, row.id);
}

function mapCompanyGoalRow(
  row: CompanyGoalRow,
  contractItems: OrchestrationGoalContractItem[],
  planMetrics?: GoalPlanMetrics
): OrchestrationCompanyGoal {
  const taskCount = Number(row.task_count ?? 0);
  const doneCount = Number(row.done_count ?? 0);
  const inProgressCount = Number(row.in_progress_count ?? 0);
  const reviewCount = Number(row.review_count ?? 0);
  const effectiveTaskCount = planMetrics?.taskCount ?? taskCount;
  const effectiveDoneCount = planMetrics?.doneCount ?? doneCount;

  return {
    sprint: {
      id: row.sprint_id,
      sprintKey: row.sprint_key,
      goalKey: row.sprint_goal_key,
      projectId: row.project_id,
      name: row.sprint_name,
      goal: row.sprint_goal,
      goalKind: row.sprint_goal_kind ?? undefined,
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
      leadAgentId: row.sprint_lead_agent_id,
      stopCondition: row.sprint_stop_condition ?? "",
      progressSummary: row.sprint_progress_summary ?? "",
      defaultExecutionEngine: row.sprint_default_execution_engine,
      defaultModelLane: row.sprint_default_model_lane,
      contractItems,
      validationSummary: summarizeGoalValidation(contractItems),
    },
    projectId: row.project_id,
    projectSlug: row.project_slug,
    projectName: row.project_name,
    projectColor: row.project_color,
    completionPercent: effectiveTaskCount > 0 ? Math.round((effectiveDoneCount / effectiveTaskCount) * 100) : 0,
    remainingTasks: Math.max(effectiveTaskCount - effectiveDoneCount, 0),
    planHasTasks: planMetrics ? planMetrics.taskCount > 0 : undefined,
    planTaskCount: planMetrics?.taskCount,
    planDoneTaskCount: planMetrics?.doneCount,
    planPendingTaskCount: planMetrics?.pendingTaskCount,
    planSprintCount: planMetrics?.sprintCount,
    planApprovedSprintCount: planMetrics?.approvedSprintCount,
    planDoneSprintCount: planMetrics?.doneSprintCount,
    planPendingSprintCount: planMetrics?.pendingSprintCount,
  };
}

function loadGoalPlanMetrics(companyId: string, companyGoalIds: string[]): Map<string, GoalPlanMetrics> {
  const db = getOrchestrationDb();
  const uniqueGoalIds = Array.from(new Set(companyGoalIds.filter(Boolean)));
  const metrics = new Map<string, GoalPlanMetrics>();
  if (uniqueGoalIds.length === 0) return metrics;
  const placeholders = uniqueGoalIds.map(() => "?").join(",");

  const approvedRows = db
    .prepare(
      `SELECT
         child.parent_id AS goal_id,
         COUNT(DISTINCT CASE WHEN t.id IS NOT NULL THEN child.id END) AS approved_sprint_count,
         COUNT(DISTINCT CASE WHEN child.status = 'completed' AND t.id IS NOT NULL THEN child.id END) AS done_sprint_count,
         COUNT(t.id) AS task_count,
         SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM sprints child
       INNER JOIN projects p ON p.id = child.project_id
       LEFT JOIN tasks t ON t.sprint_id = child.id AND t.archived_at IS NULL
       WHERE p.company_id = ?
         AND p.archived_at IS NULL
         AND child.parent_id IN (${placeholders})
       GROUP BY child.parent_id`
    )
    .all(companyId, ...uniqueGoalIds) as Array<{
      goal_id: string;
      approved_sprint_count: number | null;
      done_sprint_count: number | null;
      task_count: number | null;
      done_count: number | null;
    }>;

  for (const row of approvedRows) {
    metrics.set(row.goal_id, {
      taskCount: Number(row.task_count ?? 0),
      doneCount: Number(row.done_count ?? 0),
      pendingTaskCount: 0,
      sprintCount: Number(row.approved_sprint_count ?? 0),
      approvedSprintCount: Number(row.approved_sprint_count ?? 0),
      doneSprintCount: Number(row.done_sprint_count ?? 0),
      pendingSprintCount: 0,
    });
  }

  const pendingRows = db
    .prepare(
      `SELECT
         company_goal_id AS goal_id,
         COUNT(*) AS pending_sprint_count,
         SUM(json_array_length(tasks_json)) AS pending_task_count
       FROM goal_sprint_plan_drafts
       WHERE company_id = ?
         AND company_goal_id IN (${placeholders})
         AND status = 'pending'
         AND COALESCE(json_extract(sprint_json, '$.completionProposal'), 0) <> 1
       GROUP BY company_goal_id`
    )
    .all(companyId, ...uniqueGoalIds) as Array<{
      goal_id: string;
      pending_sprint_count: number | null;
      pending_task_count: number | null;
    }>;

  for (const row of pendingRows) {
    const current = metrics.get(row.goal_id) ?? {
      taskCount: 0,
      doneCount: 0,
      pendingTaskCount: 0,
      sprintCount: 0,
      approvedSprintCount: 0,
      doneSprintCount: 0,
      pendingSprintCount: 0,
    };
    const pendingTaskCount = Number(row.pending_task_count ?? 0);
    const pendingSprintCount = Number(row.pending_sprint_count ?? 0);
    current.pendingTaskCount += pendingTaskCount;
    current.pendingSprintCount += pendingSprintCount;
    current.taskCount += pendingTaskCount;
    current.sprintCount += pendingSprintCount;
    metrics.set(row.goal_id, current);
  }

  return metrics;
}

function parseDraftSprint(value: string): OrchestrationSprintPlanDraftSprint {
  try {
    const parsed = JSON.parse(value) as Partial<OrchestrationSprintPlanDraftSprint>;
    return {
      name: String(parsed.name ?? "Untitled sprint"),
      objective: String(parsed.objective ?? ""),
      completionProposal: Boolean((parsed as Record<string, unknown>).completionProposal),
      completionReason: (parsed as Record<string, unknown>).completionReason ? String((parsed as Record<string, unknown>).completionReason) : undefined,
      owner: parsed.owner ?? null,
      startDate: parsed.startDate,
      endDate: parsed.endDate ?? null,
      defaultExecutionEngine: parsed.defaultExecutionEngine ?? null,
      defaultModelLane: parsed.defaultModelLane ?? null,
      successCriteria: Array.isArray(parsed.successCriteria) ? parsed.successCriteria.map(String).filter(Boolean) : [],
      validationChecks: Array.isArray(parsed.validationChecks) ? parsed.validationChecks.map(String).filter(Boolean) : [],
      outOfScope: Array.isArray(parsed.outOfScope) ? parsed.outOfScope.map(String).filter(Boolean) : [],
    };
  } catch {
    return { name: "Untitled sprint", objective: "", successCriteria: [], validationChecks: [], outOfScope: [] };
  }
}

function parseDraftTasks(value: string): OrchestrationSprintPlanDraftTask[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((task, index) => {
      const candidate = task as Partial<OrchestrationSprintPlanDraftTask>;
      return {
        id: String(candidate.id ?? `task-${index + 1}`),
        title: String(candidate.title ?? "Untitled task"),
        description: candidate.description ? String(candidate.description) : "",
        assignee: candidate.assignee ?? null,
        priority: (candidate.priority ?? "P2") as TaskPriority,
        type: (candidate.type ?? "feature") as TaskType,
        executionEngine: candidate.executionEngine ?? null,
        modelLane: candidate.modelLane ?? null,
        eligibleAssignees: Array.isArray(candidate.eligibleAssignees) ? candidate.eligibleAssignees.map(String).filter(Boolean) : [],
        dependsOn: Array.isArray(candidate.dependsOn) ? candidate.dependsOn.map(String).filter(Boolean) : [],
        validation: candidate.validation ? String(candidate.validation) : "",
      };
    });
  } catch {
    return [];
  }
}

function sprintPlanDraftFromRow(row: SprintPlanDraftRow): OrchestrationSprintPlanDraft {
  return {
    id: row.id,
    companyGoalId: row.company_goal_id,
    planningTaskId: row.planning_task_id,
    proposedByAgentId: row.proposed_by_agent_id,
    sequenceNumber: Number(row.sequence_number ?? 1),
    proposalGroupId: row.proposal_group_id,
    status: row.status,
    sprint: parseDraftSprint(row.sprint_json),
    tasks: parseDraftTasks(row.tasks_json),
    rejectReason: row.reject_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
  };
}

function getSprintPlanDraftRow(id: string): SprintPlanDraftRow | undefined {
  return getOrchestrationDb()
    .prepare("SELECT * FROM goal_sprint_plan_drafts WHERE id = ? LIMIT 1")
    .get(id) as SprintPlanDraftRow | undefined;
}

function normalizeDraftAssigneeLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripAgentRoleSuffix(value: string): string {
  return value.replace(/-(lead|research|researcher|qa|quality|planner|planning|orchestrator|engineer|specialist|runner|agent)$/i, "");
}

function resolveDraftAssigneeAgentForCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  assignee?: string | null
): { id: string; name: string } | undefined {
  const raw = assignee?.trim();
  if (!raw) return undefined;
  const normalized = normalizeDraftAssigneeLookup(raw);
  const rows = db
    .prepare(
      `SELECT id, slug, name
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL`
    )
    .all(companyId) as Array<{ id: string; slug: string; name: string }>;

  return rows.find((agent) => agent.id === raw)
    ?? rows.find((agent) => agent.name.toLowerCase() === raw.toLowerCase())
    ?? rows.find((agent) => normalizeDraftAssigneeLookup(agent.slug) === normalized)
    ?? rows.find((agent) => stripAgentRoleSuffix(normalizeDraftAssigneeLookup(agent.slug)) === normalized);
}

function resolveDraftEligibleAssigneesForCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  task: OrchestrationSprintPlanDraftTask
): { eligibleAssignees: string[]; failures: string[] } {
  const values = [
    task.assignee ?? "",
    ...(Array.isArray(task.eligibleAssignees) ? task.eligibleAssignees : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const resolved: string[] = [];
  const failures: string[] = [];
  for (const value of values) {
    const agent = resolveDraftAssigneeAgentForCompany(db, companyId, value);
    if (!agent) {
      if (!failures.includes(value)) failures.push(value);
      continue;
    }
    if (!resolved.includes(agent.id)) resolved.push(agent.id);
  }
  return { eligibleAssignees: resolved, failures };
}

const CANONICAL_EXECUTION_TASK_TYPES = new Set<TaskType>([
  "feature",
  "bug",
  "research",
  "epic",
  "spike",
  "docs",
  "infra",
  "refactor",
  "review",
  "qa",
  "release",
]);

function coerceDraftTaskTypeForMaterialization(task: OrchestrationSprintPlanDraftTask): TaskType {
  const requested = task.type ?? "feature";
  if (CANONICAL_EXECUTION_TASK_TYPES.has(requested)) return requested;
  const haystack = `${task.title} ${task.description ?? ""}`.toLowerCase();
  const codeLike = /\b(implement|build|wire|api|ui|component|schema|migration|test|fix|refactor|code|button|route|endpoint)\b/.test(haystack);
  const coerced: TaskType = codeLike ? "feature" : "docs";
  console.warn(`[sprint-plan] coerced non-canonical task type "${requested}" to "${coerced}" for draft task "${task.title}"`);
  return coerced;
}

function normalizeSprintNameForMatch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^implement\s+/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sprintNamesReasonablyMatch(existingName: string, proposedName: string): boolean {
  const existing = normalizeSprintNameForMatch(existingName);
  const proposed = normalizeSprintNameForMatch(proposedName);
  if (!existing || !proposed) return false;
  return existing.includes(proposed) || proposed.includes(existing);
}

function findEmptyPrecreatedSprintForDraft(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  parentId: string,
  proposedName: string,
): CompanyScopedSprintRow | undefined {
  const rows = db
    .prepare(
      `SELECT
         s.id,
         s.project_id,
         s.name,
         s.goal,
         s.goal_kind,
         s.status,
         s.start_date,
         s.end_date,
         s.completed_at,
         s.parent_id,
         s.owner,
         s.lead_agent_id,
         s.stop_condition,
         s.progress_summary,
         s.default_execution_engine,
         s.default_model_lane,
         SUM(CASE WHEN lower(t.title) LIKE 'plan sprint for %' THEN 0 WHEN t.id IS NULL THEN 0 ELSE 1 END) AS materialized_task_count
       FROM sprints s
       INNER JOIN projects p ON p.id = s.project_id
       LEFT JOIN tasks t ON t.sprint_id = s.id AND t.archived_at IS NULL
       WHERE p.company_id = ?
         AND p.archived_at IS NULL
         AND s.parent_id = ?
       GROUP BY s.id
       ORDER BY s.created_at ASC`
    )
    .all(companyId, parentId) as Array<CompanyScopedSprintRow & { materialized_task_count: number | null }>;

  return rows.find((row) =>
    (row.materialized_task_count ?? 0) === 0 &&
    sprintNamesReasonablyMatch(row.name, proposedName)
  );
}

function mergeDraftContractItemsIntoSprint(input: {
  companyId: string;
  sprintId: string;
  sprintDraft: OrchestrationSprintPlanDraftSprint;
  actorUserId: string;
}): void {
  const db = getOrchestrationDb();
  const existingRows = db
    .prepare(
      `SELECT kind, text, position
       FROM goal_contract_items
       WHERE sprint_id = ?
         AND archived_at IS NULL
       ORDER BY kind ASC, position ASC`
    )
    .all(input.sprintId) as Array<{ kind: GoalContractItemKind; text: string; position: number }>;

  const existingByKind = new Map<GoalContractItemKind, Set<string>>();
  const maxPositionByKind = new Map<GoalContractItemKind, number>();
  for (const row of existingRows) {
    const normalized = row.text.trim().toLowerCase();
    if (!existingByKind.has(row.kind)) existingByKind.set(row.kind, new Set());
    existingByKind.get(row.kind)?.add(normalized);
    maxPositionByKind.set(row.kind, Math.max(maxPositionByKind.get(row.kind) ?? -1, row.position));
  }

  const appendMissing = (kind: GoalContractItemKind, values: string[]) => {
    const seen = existingByKind.get(kind) ?? new Set<string>();
    let nextPosition = (maxPositionByKind.get(kind) ?? -1) + 1;
    for (const value of values) {
      const text = value.trim();
      if (!text) continue;
      const normalized = text.toLowerCase();
      if (seen.has(normalized)) continue;
      createGoalContractItem({
        companyIdOrSlug: input.companyId,
        sprintId: input.sprintId,
        kind,
        text,
        position: nextPosition,
        actorUserId: input.actorUserId,
      });
      seen.add(normalized);
      nextPosition += 1;
    }
  };

  appendMissing("success_criterion", input.sprintDraft.successCriteria ?? []);
  appendMissing("validation_check", input.sprintDraft.validationChecks ?? []);
  appendMissing("out_of_scope", input.sprintDraft.outOfScope ?? []);
}

function closePlanningTaskAfterDraftApproval(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  planningTask: { id: string; project_id: string } | undefined;
  actorUserId: string;
  sprintId: string;
  taskCount: number;
  now: string;
}): void {
  if (!input.planningTask) return;
  const row = input.db
    .prepare("SELECT status FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(input.planningTask.id) as { status: string } | undefined;
  if (!row || row.status === "done" || row.status === "cancelled") return;

  const body = `Draft approved by operator at ${input.now}. Materialized sprint ${input.sprintId} with ${input.taskCount} tasks. Closing planning task lifecycle.`;
  input.db.prepare(
    `UPDATE tasks
     SET status = 'done',
         completed_at = COALESCE(completed_at, ?),
         consecutive_noop_wakes = 0,
         updated_at = ?
     WHERE id = ?`
  ).run(input.now, input.now, input.planningTask.id);

  input.db.prepare(
    `INSERT INTO comments
      (id, task_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'comment', 'mission_control', ?, ?, ?)`
  ).run(
    randomUUID(),
    input.planningTask.id,
    "hiverunner:system",
    body,
    `goal:sprint_plan_approved:${input.sprintId}`,
    input.now,
    input.now,
  );

  input.db.prepare(
    `INSERT INTO task_events
      (id, project_id, task_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES (?, ?, ?, ?, 'task.status_changed', ?, 'done', ?, ?)`
  ).run(
    randomUUID(),
    input.planningTask.project_id,
    input.planningTask.id,
    input.actorUserId,
    row.status,
    JSON.stringify({ source: "sprint_plan_approval", sprintId: input.sprintId, taskCount: input.taskCount }),
    input.now,
  );
}

function shortList(values: string[] | undefined, limit = 3): string {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length) return "none";
  const shown = cleaned.slice(0, limit).join("; ");
  return cleaned.length > limit ? `${shown}; +${cleaned.length - limit} more` : shown;
}

function draftEngineSummary(
  parent: CompanyScopedSprintRow,
  sprintDraft: OrchestrationSprintPlanDraftSprint,
  taskDrafts: OrchestrationSprintPlanDraftTask[],
): string | null {
  if (parent.default_execution_engine !== "symphony") return null;
  const nonSymphonyTasks = taskDrafts
    .filter((task) => task.executionEngine && task.executionEngine !== "symphony")
    .map((task) => task.title)
    .slice(0, 3);
  const sprintEngine = sprintDraft.defaultExecutionEngine ?? "unset";
  if (sprintEngine === "symphony" && nonSymphonyTasks.length === 0) {
    return "Engine/default lesson applied: this symphony-default goal kept the sprint default and explicit task engines aligned with symphony.";
  }
  return `Engine/default lesson: this company goal defaults to symphony, so future draft sprint defaults and task executionEngine values should inherit symphony unless the operator explicitly asks for HiveRunner or manual. Draft sprint engine was ${sprintEngine}${nonSymphonyTasks.length ? `; non-symphony task engines appeared on ${nonSymphonyTasks.join(", ")}` : ""}.`;
}

function recordSprintPlanReviewRetrospective(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  projectId: string | null;
  companyGoalId: string;
  companyGoalName: string;
  planningTask?: { id: string; project_id: string } | undefined;
  agentId?: string | null;
  draftId: string;
  outcome: "approved" | "rejected" | "edited";
  sprintDraft: OrchestrationSprintPlanDraftSprint;
  taskDrafts: OrchestrationSprintPlanDraftTask[];
  parent: CompanyScopedSprintRow;
  reason?: string | null;
  previousSprintDraft?: OrchestrationSprintPlanDraftSprint;
  previousTaskDrafts?: OrchestrationSprintPlanDraftTask[];
  now: string;
}): void {
  try {
    const taskDelta = input.previousTaskDrafts
      ? ` Task count changed ${input.previousTaskDrafts.length} -> ${input.taskDrafts.length}.`
      : "";
    const nameDelta = input.previousSprintDraft && input.previousSprintDraft.name !== input.sprintDraft.name
      ? ` Sprint name changed from "${input.previousSprintDraft.name}" to "${input.sprintDraft.name}".`
      : "";
    const reason = input.reason?.trim() ? ` Operator note: ${input.reason.trim()}` : "";
    const engine = draftEngineSummary(input.parent, input.sprintDraft, input.taskDrafts);
    const validation = `Validation requirements to carry forward: ${shortList(input.sprintDraft.validationChecks)}.`;
    const title = `Sprint plan ${input.outcome}: ${input.companyGoalName}`;
    const body = [
      `Outcome: ${input.outcome} sprint plan draft "${input.sprintDraft.name}" for company goal "${input.companyGoalName}" with ${input.taskDrafts.length} task(s).`,
      taskDelta.trim(),
      nameDelta.trim(),
      reason.trim(),
      validation,
      engine,
    ].filter(Boolean).join(" ");

    recordPlanningRetrospectiveMemory({
      db: input.db,
      companyId: input.companyId,
      projectId: input.planningTask?.project_id ?? input.projectId,
      agentId: input.agentId ?? null,
      taskId: input.planningTask?.id ?? null,
      title,
      body,
      outcome: input.outcome,
      draftId: input.draftId,
      companyGoalId: input.companyGoalId,
      confidence: input.outcome === "approved" ? 0.8 : 0.75,
      now: input.now,
    });
  } catch (error) {
    console.warn("[planning-retrospective] failed to record sprint plan memory", error);
  }
}

export function updateSprintPlanDraft(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  sprint?: OrchestrationSprintPlanDraftSprint;
  tasks?: OrchestrationSprintPlanDraftTask[];
}): { draft: OrchestrationSprintPlanDraft } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const row = getSprintPlanDraftRow(input.draftId);
  if (!row || row.company_id !== companyRow.id || row.company_goal_id !== input.companyGoalId) {
    throw new OrchestrationApiError(404, "sprint_plan_draft_not_found", "Draft not found");
  }
  if (row.status !== "pending") throw new OrchestrationApiError(400, "draft_not_pending", "Only pending drafts can be updated");

  const nextSprint = input.sprint ?? parseDraftSprint(row.sprint_json);
  const nextTasks = input.tasks ?? parseDraftTasks(row.tasks_json);
  const previousSprint = parseDraftSprint(row.sprint_json);
  const previousTasks = parseDraftTasks(row.tasks_json);
  const parent = getCompanyScopedSprintRow(companyRow.id, row.company_goal_id);
  const planningTask = row.planning_task_id ? getCompanyTaskId(db, companyRow.id, row.planning_task_id) : undefined;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE goal_sprint_plan_drafts
     SET sprint_json = ?,
         tasks_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(nextSprint), JSON.stringify(nextTasks), now, row.id);
  if (parent) {
    recordSprintPlanReviewRetrospective({
      db,
      companyId: companyRow.id,
      projectId: parent.project_id,
      companyGoalId: parent.id,
      companyGoalName: parent.name,
      planningTask,
      agentId: row.proposed_by_agent_id,
      draftId: row.id,
      outcome: "edited",
      sprintDraft: nextSprint,
      taskDrafts: nextTasks,
      parent,
      previousSprintDraft: previousSprint,
      previousTaskDrafts: previousTasks,
      now,
    });
  }

  const updated = getSprintPlanDraftRow(row.id);
  if (!updated) throw new OrchestrationApiError(500, "sprint_plan_draft_load_failed", "Draft updated but could not be loaded");
  return { draft: sprintPlanDraftFromRow(updated) };
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
        s.sprint_key AS sprint_key,
        s.goal_key AS sprint_goal_key,
        s.name AS sprint_name,
        s.goal AS sprint_goal,
        s.goal_kind AS sprint_goal_kind,
        s.status AS sprint_status,
        s.start_date AS sprint_start_date,
        s.end_date AS sprint_end_date,
        s.created_at AS sprint_created_at,
        s.updated_at AS sprint_updated_at,
        s.parent_id AS sprint_parent_id,
        s.owner AS sprint_owner,
        s.lead_agent_id AS sprint_lead_agent_id,
        s.stop_condition AS sprint_stop_condition,
        s.progress_summary AS sprint_progress_summary,
        s.default_execution_engine AS sprint_default_execution_engine,
        s.default_model_lane AS sprint_default_model_lane,
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
         AND s.archived_at IS NULL
       GROUP BY s.id`
    )
    .get(sprintId, companyId) as CompanyGoalRow | undefined;

  if (!row) return undefined;
  const goalKind = row.sprint_goal_kind ?? (row.sprint_parent_id ? "sprint" : "company");
  const planMetrics = goalKind === "company" ? loadGoalPlanMetrics(companyId, [sprintId]).get(sprintId) : undefined;
  return mapCompanyGoalRow(row, listGoalContractItemsForSprints([sprintId]).get(sprintId) ?? [], planMetrics);
}

function ensureCompanyGoalProject(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string
): CompanyProjectScopeRow {
  const slug = `no-project-${companyId.slice(0, 8)}`;
  const existing = db
    .prepare(
      `SELECT id
       FROM projects
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (slug = 'no-project' OR slug = ? OR lower(name) = 'no project')
       ORDER BY CASE WHEN slug = ? THEN 0 WHEN slug = 'no-project' THEN 1 ELSE 2 END, created_at ASC
       LIMIT 1`
    )
    .get(companyId, slug, slug) as CompanyProjectScopeRow | undefined;

  if (existing) return existing;

  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects (id, company_id, slug, name, description, color, status, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 'No project', 'Company-wide goals and issue bucket.', '#737373', 'active', ?, ?, ?)`
  ).run(id, companyId, slug, JSON.stringify({ emoji: "" }), now, now);

  return { id };
}

function companyFromRow(row: CompanyRow): OrchestrationCompany {
  const workspaceSlug = row.workspace_slug?.trim() || row.slug;
  const runtimeSlug = row.runtime_slug?.trim() || workspaceSlug;
  const workspaceRoot = resolveCompanyWorkspaceRoot({
    companyId: row.id,
    workspaceSlug,
    workspaceRoot: row.workspace_root,
    workspaceSource: row.workspace_source,
  });

  return {
    id: row.id,
    slug: row.slug,
    workspaceSlug,
    runtimeSlug,
    code: row.company_code?.trim() || row.slug.slice(0, 3).toUpperCase(),
    name: row.name,
    description: row.description,
    status: row.status,
    created: row.created_at,
    owner: row.owner_user_id && row.owner_display_name && row.owner_email
      ? {
          id: row.owner_user_id,
          displayName: row.owner_display_name,
          email: row.owner_email,
          role: row.owner_member_role ?? "owner",
          status: row.owner_member_status ?? "active",
        }
      : undefined,
    workspace: {
      root: workspaceRoot,
      source:
        row.workspace_source ??
        "provisioned",
    },
    theme: {
      name: row.theme_name,
      promptTemplate: row.theme_prompt_template,
      keywords: parseKeywords(row.theme_keywords_json),
      sampleUrl: row.theme_sample_url ?? undefined,
    },
    defaultExecutionEngine: readDefaultExecutionEngine(row.settings_json) ?? undefined,
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
  ownerUserId?: string;
}): { companies: OrchestrationCompany[] } {
  const db = getOrchestrationDb();
  const includeArchived = input?.includeArchived ?? false;
  const includeNonProduction = input?.includeNonProduction ?? false;
  const whereParts = [includeArchived ? "1=1" : "c.archived_at IS NULL"];
  const args: unknown[] = [];
  const ownerUserId = input?.ownerUserId?.trim();
  if (ownerUserId) {
    whereParts.push("c.owner_user_id = ?");
    args.push(ownerUserId);
  }

  const rows = db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.workspace_slug,
        c.runtime_slug,
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
        c.settings_json,
        c.owner_user_id,
        owner.display_name AS owner_display_name,
        owner.email AS owner_email,
        owner_member.role AS owner_member_role,
        owner_member.status AS owner_member_status,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN users owner ON owner.id = c.owner_user_id AND owner.archived_at IS NULL
       LEFT JOIN company_members owner_member ON owner_member.company_id = c.id AND owner_member.user_id = owner.id
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'to-do', 'in_progress', 'review', 'blocked')
       WHERE ${whereParts.join(" AND ")}
       GROUP BY c.id
       ORDER BY c.updated_at DESC`
    )
    .all(...args) as CompanyRow[];

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
  owner?: CompanyOwnerInput;
  ownerUserId?: string;
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
  while (
    db.prepare("SELECT 1 FROM companies WHERE slug = ? LIMIT 1").get(slug) ||
    db.prepare("SELECT 1 FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1").get(slug)
  ) {
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

  const workspaceSlug = slug;
  const runtimeSlug = ensureUniqueCompanyRuntimeSlug(db, workspaceSlug);

  const workspaceRoot = resolveCanonicalCompanyWorkspaceRoot(companyId, workspaceSlug);
  const workspaceSource = "provisioned";

  // Materialize the filesystem scaffold before the DB INSERT so any
  // downstream reader that assumes workspace_root exists on disk (agent
  // hire flows, memory ops) finds it. mkdirSync is idempotent; failure
  // here aborts creation before leaving a half-wired row behind.
  ensureCompanyWorkspaceScaffold(workspaceRoot);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO companies
        (id, slug, workspace_slug, runtime_slug, company_code, name, description, status, workspace_root, workspace_source, theme_name, theme_prompt_template, theme_keywords_json, theme_sample_url, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      companyId,
      slug,
      workspaceSlug,
      runtimeSlug,
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

    upsertCompanyOwner({
      db,
      companyId,
      owner: input.owner,
      currentOwnerUserId: input.ownerUserId,
      now,
    });
  })();

  const row = db
    .prepare(
      `SELECT
        c.id,
        c.slug,
        c.workspace_slug,
        c.runtime_slug,
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
        c.settings_json,
        c.owner_user_id,
        owner.display_name AS owner_display_name,
        owner.email AS owner_email,
        owner_member.role AS owner_member_role,
        owner_member.status AS owner_member_status,
        c.created_at,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT a.id) AS agent_count,
        COUNT(DISTINCT t.id) AS active_task_count
       FROM companies c
       LEFT JOIN projects p ON p.company_id = c.id AND p.archived_at IS NULL
       LEFT JOIN agents a ON a.company_id = c.id AND a.archived_at IS NULL
       LEFT JOIN users owner ON owner.id = c.owner_user_id AND owner.archived_at IS NULL
       LEFT JOIN company_members owner_member ON owner_member.company_id = c.id AND owner_member.user_id = owner.id
       LEFT JOIN tasks t
         ON t.project_id = p.id
        AND t.archived_at IS NULL
        AND t.status IN ('backlog', 'to-do', 'in_progress', 'review', 'blocked')
       WHERE c.id = ?
       GROUP BY c.id`
    )
    .get(companyId) as CompanyRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(500, "company_create_failed", "Company created but could not be loaded");
  }

  return { company: companyFromRow(row) };
}

/**
 * Lightweight alias-aware company resolver. Accepts a slug (current or historical)
 * or a company UUID. Returns core identity fields without expensive joins.
 * Use this in API route handlers instead of inline `WHERE slug = ?` queries.
 */
export function resolveCompanyIdBySlug(
  slugOrId: string,
  db = getOrchestrationDb(),
  input?: { includeArchived?: boolean; ownerUserId?: string }
): {
  id: string;
  slug: string;
  workspace_slug: string | null;
  runtime_slug: string | null;
  company_code: string | null;
  name: string;
  workspace_root: string | null;
  workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
} | undefined {
  const includeArchived = input?.includeArchived ?? false;
  const ownerUserId = input?.ownerUserId?.trim();
  const archivedClause = includeArchived ? "1=1" : "archived_at IS NULL";
  const ownerClause = ownerUserId ? "AND owner_user_id = ?" : "";
  // Direct match on id, current slug, or stable company code.
  const direct = db
    .prepare(
      `SELECT id, slug, company_code, name, workspace_root, workspace_source
       , workspace_slug, runtime_slug
       FROM companies
       WHERE (id = ? OR slug = ? OR UPPER(company_code) = UPPER(?)) AND ${archivedClause}
         ${ownerClause}
       LIMIT 1`
    )
    .get(...(ownerUserId ? [slugOrId, slugOrId, slugOrId, ownerUserId] : [slugOrId, slugOrId, slugOrId])) as {
      id: string;
      slug: string;
      workspace_slug: string | null;
      runtime_slug: string | null;
      company_code: string | null;
      name: string;
      workspace_root: string | null;
      workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
    } | undefined;
  if (direct) return direct;

  // Fall back to stored slug alias.
  const alias = db
    .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(slugOrId) as { company_id: string } | undefined;
  if (!alias) return undefined;

  return db
    .prepare(
      `SELECT id, slug, company_code, name, workspace_root, workspace_source
       , workspace_slug, runtime_slug
       FROM companies
       WHERE id = ? AND ${archivedClause}
         ${ownerClause}
       LIMIT 1`
    )
    .get(...(ownerUserId ? [alias.company_id, ownerUserId] : [alias.company_id])) as {
      id: string;
      slug: string;
      workspace_slug: string | null;
      runtime_slug: string | null;
      company_code: string | null;
      name: string;
      workspace_root: string | null;
      workspace_source: "openclaw" | "provisioned" | "imported" | "manual" | null;
    } | undefined;
}

export function getCompany(companySlug: string, input?: { ownerUserId?: string }): { company: OrchestrationCompany } {
  const row = getCompanyRowByIdOrSlug(companySlug, input?.ownerUserId);
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
  defaultExecutionEngine?: "hiverunner" | "symphony" | "manual" | null;
  owner?: CompanyOwnerInput;
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

  // Also reject slugs that collide with an existing alias for a different company.
  if (nextSlug !== current.slug) {
    const aliasOwner = db
      .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
      .get(nextSlug) as { company_id: string } | undefined;
    if (aliasOwner && aliasOwner.company_id !== current.id) {
      throw new OrchestrationApiError(
        409,
        "company_slug_taken",
        "Another company already uses this slug (via alias)"
      );
    }
  }

  const currentSettings = parseJsonObject(current.settings_json);
  const currentExecutionSettings =
    currentSettings.execution &&
    typeof currentSettings.execution === "object" &&
    !Array.isArray(currentSettings.execution)
      ? currentSettings.execution as Record<string, unknown>
      : undefined;
  const hasDefaultExecutionEngine = Object.prototype.hasOwnProperty.call(
    input,
    "defaultExecutionEngine"
  );
  const nextSettings = {
    ...currentSettings,
    ...(hasDefaultExecutionEngine || currentExecutionSettings
      ? {
          execution: {
            ...(currentExecutionSettings ?? {}),
            ...(hasDefaultExecutionEngine
              ? { defaultEngine: input.defaultExecutionEngine ?? null }
              : {}),
          },
        }
      : {}),
  };

  const nextStatus = input.status ?? current.status;
  const now = new Date().toISOString();
  db.transaction(() => {
    // When the slug changes, preserve the old slug as a durable alias so old
    // URLs continue to resolve through the edge route maps.
    if (nextSlug !== current.slug) {
      db.prepare(
        `INSERT OR IGNORE INTO company_slug_aliases (company_id, slug_alias, created_at)
         VALUES (?, ?, ?)`
      ).run(current.id, current.slug, now);
    }

    db.prepare(
      `UPDATE companies
       SET
        slug = ?,
        name = ?,
        description = ?,
        status = ?,
        settings_json = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      nextSlug,
      input.name ?? current.name,
      input.description ?? current.description,
      nextStatus,
      JSON.stringify(nextSettings),
      now,
      current.id
    );

    if (input.owner) {
      upsertCompanyOwner({
        db,
        companyId: current.id,
        owner: input.owner,
        currentOwnerUserId: current.owner_user_id,
        now,
      });
    }

    if (input.status && input.status !== current.status && (input.status === "paused" || input.status === "active")) {
      db.prepare(`UPDATE projects SET status = ?, updated_at = ? WHERE company_id = ? AND status != 'archived'`).run(input.status, now, current.id);
      db.prepare(`UPDATE agents SET status = ?, updated_at = ? WHERE company_id = ? AND status != 'offline'`).run(input.status === "paused" ? "paused" : "idle", now, current.id);
    }
  })();

  // If slug changed, immediately invalidate the edge route map cache so
  // middleware picks up the new alias on the very next request.
  if (nextSlug !== current.slug) {
    refreshEdgeRouteMapCache();
  }

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
  const resolved = resolveCompanyIdBySlug(companySlug, db);
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  const current = { id: resolved.id, slug: resolved.slug };

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

export function restoreCompany(companySlug: string): {
  companyId: string;
  companySlug: string;
  restoredAt: string;
} {
  const db = getOrchestrationDb();
  const resolved = resolveCompanyIdBySlug(companySlug, db, { includeArchived: true });
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const current = db
    .prepare("SELECT id, slug, status, archived_at FROM companies WHERE id = ? LIMIT 1")
    .get(resolved.id) as { id: string; slug: string; status: CompanyStatusInput; archived_at: string | null } | undefined;
  if (!current) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const restoredAt = new Date().toISOString();
  db.prepare(
    `UPDATE companies
     SET status = 'active', archived_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(restoredAt, current.id);

  refreshEdgeRouteMapCache();

  return {
    companyId: current.id,
    companySlug: current.slug,
    restoredAt,
  };
}

type HardDeleteCompanyResult = {
  companyId: string;
  companySlug: string;
  workspace: {
    root: string | null;
    existed: boolean;
    deleted: boolean;
  };
  openclawAgents: {
    queued: string[];
  };
  deletedCounts: {
    approvals: number;
    projects: number;
    tasks: number;
    agents: number;
  };
};

function isSafeCompanyWorkspacePath(workspaceRoot: string): boolean {
  return isSafeManagedCompanyWorkspacePath(workspaceRoot);
}

async function deleteOpenClawAgent(runtimeId: string): Promise<"deleted" | "missing"> {
  try {
    await execFileAsync("openclaw", ["agents", "delete", runtimeId, "--force"], {
      encoding: "utf-8",
      timeout: 15_000,
    });
    return "deleted";
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "";
    const stdout =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
        ? error.stdout
        : "";
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    if (combined.includes("not found") || combined.includes("no such agent")) {
      return "missing";
    }

    throw new OrchestrationApiError(500, "openclaw_agent_delete_failed", `Failed to remove OpenClaw agent ${runtimeId}`);
  }
}

type OpenClawAgentDirCleanupStatus =
  | "deleted"
  | "missing"
  | "unsafe";

function cleanupDeletedOpenClawAgentDir(runtimeId: string): OpenClawAgentDirCleanupStatus {
  const openclawAgentsRoot = path.resolve(resolveOpenClawDir(), "agents");
  const agentDir = path.resolve(path.join(openclawAgentsRoot, runtimeId));

  if (path.dirname(agentDir) !== openclawAgentsRoot || path.basename(agentDir) !== runtimeId) {
    console.warn(`[company-delete] Refusing to clean unsafe OpenClaw agent dir target for ${runtimeId}`);
    return "unsafe";
  }

  if (!fs.existsSync(agentDir)) {
    return "missing";
  }

  fs.rmSync(agentDir, { recursive: true, force: true });
  return "deleted";
}

export async function cleanupDeletedCompanyOpenClawAgents(runtimeIds: string[]): Promise<{
  deleted: string[];
  missing: string[];
  failed: string[];
  deletedAgentDirs: string[];
  missingAgentDirs: string[];
  retainedAgentDirs: string[];
}> {
  const result = {
    deleted: [] as string[],
    missing: [] as string[],
    failed: [] as string[],
    deletedAgentDirs: [] as string[],
    missingAgentDirs: [] as string[],
    retainedAgentDirs: [] as string[],
  };
  for (const runtimeId of runtimeIds) {
    try {
      const status = await deleteOpenClawAgent(runtimeId);
      if (status === "deleted") {
        result.deleted.push(runtimeId);
      } else {
        result.missing.push(runtimeId);
      }

      const dirCleanup = cleanupDeletedOpenClawAgentDir(runtimeId);
      if (dirCleanup === "deleted") {
        result.deletedAgentDirs.push(runtimeId);
      } else if (dirCleanup === "missing") {
        result.missingAgentDirs.push(runtimeId);
      } else {
        result.retainedAgentDirs.push(runtimeId);
      }
    } catch (error) {
      result.failed.push(runtimeId);
      console.error(
        `[company-delete] OpenClaw unregister failed for ${runtimeId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return result;
}

export function hardDeleteCompany(companySlug: string): HardDeleteCompanyResult {
  const db = getOrchestrationDb();
  const resolved = resolveCompanyIdBySlug(companySlug, db, { includeArchived: true });
  if (!resolved) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const current = {
    id: resolved.id,
    slug: resolved.slug,
    workspaceRoot: resolved.workspace_root?.trim() || null,
  };
  if (current.workspaceRoot && !isSafeCompanyWorkspacePath(current.workspaceRoot)) {
    throw new OrchestrationApiError(
      400,
      "unsafe_workspace_root",
      "Refusing to delete a workspace outside the managed HiveRunner or legacy OpenClaw company roots"
    );
  }

  const openclawAgentRows = db
    .prepare("SELECT openclaw_agent_id FROM agents WHERE company_id = ? AND openclaw_agent_id IS NOT NULL")
    .all(current.id) as { openclaw_agent_id: string }[];
  const deletedCounts = {
    approvals: Number((db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE company_id = ?").get(current.id) as { count?: number } | undefined)?.count ?? 0),
    projects: Number((db.prepare("SELECT COUNT(*) AS count FROM projects WHERE company_id = ?").get(current.id) as { count?: number } | undefined)?.count ?? 0),
    tasks: Number(
      (db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM tasks
            WHERE project_id IN (SELECT id FROM projects WHERE company_id = ?)`
        )
        .get(current.id) as { count?: number } | undefined)?.count ?? 0
    ),
    agents: Number((db.prepare("SELECT COUNT(*) AS count FROM agents WHERE company_id = ?").get(current.id) as { count?: number } | undefined)?.count ?? 0),
  };

  const openclawAgents = {
    queued: openclawAgentRows.map((row) => row.openclaw_agent_id),
  };

  let workspaceExisted = false;
  let workspaceDeleted = false;
  if (current.workspaceRoot) {
    workspaceExisted = fs.existsSync(current.workspaceRoot);
    if (workspaceExisted) {
      fs.rmSync(current.workspaceRoot, { recursive: true, force: true });
      workspaceDeleted = !fs.existsSync(current.workspaceRoot);
      if (!workspaceDeleted) {
        throw new OrchestrationApiError(500, "workspace_delete_failed", "Failed to delete company workspace");
      }
    }
  }

  db.transaction(() => {
    db.prepare("DELETE FROM approval_comments WHERE company_id = ?").run(current.id);
    db.prepare("DELETE FROM approvals WHERE company_id = ?").run(current.id);
    db.prepare(
      `DELETE FROM tasks
        WHERE assignee_agent_id IN (SELECT id FROM agents WHERE company_id = ?)
           OR project_id IN (SELECT id FROM projects WHERE company_id = ?)`
    ).run(current.id, current.id);
    db.prepare("DELETE FROM agents WHERE company_id = ?").run(current.id);
    db.prepare("DELETE FROM projects WHERE company_id = ?").run(current.id);
    db.prepare("DELETE FROM companies WHERE id = ?").run(current.id);
  })();

  refreshEdgeRouteMapCache();

  return {
    companyId: current.id,
    companySlug: current.slug,
    workspace: {
      root: current.workspaceRoot,
      existed: workspaceExisted,
      deleted: workspaceDeleted || !workspaceExisted,
    },
    openclawAgents,
    deletedCounts,
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
  includeArchived?: boolean;
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
  totals: Record<"backlog" | "to-do" | "in-progress" | "review" | "done" | "blocked", number>;
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
    includeArchivedInbox: input.includeArchived,
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
        project_color,
        task_id,
        task_title,
        task_key,
        sprint_id,
        sprint_name,
        sprint_status,
        company_goal_id,
        company_goal_name,
        company_goal_status,
        task_status,
        from_status,
        to_status,
        agent_id,
        agent_name,
        avatar_url,
        provider,
        metadata_json,
        created_at
      FROM visible_feed_events
      WHERE 1=1
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

  const commentPreviewTaskIds = Array.from(new Set(
    pageRows
      .filter((row) => row.event_type === "task.comment_added" && row.task_id)
      .map((row) => row.task_id as string)
  ));
  const commentsByTask = new Map<string, InboxCommentPreviewRow[]>();
  if (commentPreviewTaskIds.length > 0) {
    const placeholders = commentPreviewTaskIds.map(() => "?").join(",");
    const commentRows = db
      .prepare(
        `SELECT task_id, body, created_at
         FROM comments
         WHERE task_id IN (${placeholders})
         ORDER BY created_at DESC`
      )
      .all(...commentPreviewTaskIds) as InboxCommentPreviewRow[];
    for (const comment of commentRows) {
      const existing = commentsByTask.get(comment.task_id);
      if (existing) existing.push(comment);
      else commentsByTask.set(comment.task_id, [comment]);
    }
  }

  const events = pageRows.map((row) => {
    const metadata = parseJsonObject(row.metadata_json);
    const eventType = toInboxEventType(row);
    const activitySummary = commentPreviewForInboxEvent(row, commentsByTask);

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
      projectColor: row.project_color,
      taskId: row.task_id ?? undefined,
      taskTitle: row.task_title ?? undefined,
      taskKey: row.task_key ?? undefined,
      sprintId: row.sprint_id ?? undefined,
      sprintName: row.sprint_name ?? undefined,
      sprintStatus: row.sprint_status ? toApiSprintStatus(row.sprint_status) : undefined,
      companyGoalId: row.company_goal_id ?? undefined,
      companyGoalName: row.company_goal_name ?? undefined,
      companyGoalStatus: row.company_goal_status ? toApiSprintStatus(row.company_goal_status) : undefined,
      status: row.task_status ? toApiStatus(row.task_status) : undefined,
      agentId: row.agent_id ?? undefined,
      agentName: row.agent_name ?? undefined,
      avatarUrl: row.avatar_url ?? undefined,
      provider: row.provider ?? undefined,
      message: inboxEventMessage(row, metadata),
      activitySummary,
      timestamp: row.created_at,
      isRead: readSet.has(row.event_id),
    };

    if (row.event_kind === "lead_supervisor_update" && typeof metadata.summary === "string") {
      event.activitySummary = cleanInboxSummary(metadata.summary);
    }

    if (row.event_kind === "approval") {
      event.approvalId = typeof metadata.approvalId === "string" ? metadata.approvalId : undefined;
      event.approvalType = typeof metadata.approvalType === "string" ? metadata.approvalType as OrchestrationCompanyInboxEvent["approvalType"] : undefined;
      event.approvalStatus = typeof metadata.approvalStatus === "string" ? metadata.approvalStatus as OrchestrationCompanyInboxEvent["approvalStatus"] : undefined;
      event.approvalLabel = typeof metadata.approvalLabel === "string" ? metadata.approvalLabel : undefined;
      event.requestedByName = typeof metadata.requestedByName === "string" ? metadata.requestedByName : undefined;
    }

    if (row.event_kind === "sprint_plan_draft") {
      event.draftId = typeof metadata.draftId === "string" ? metadata.draftId : row.event_id.replace(/^draft:/, "");
      event.draftSprintName = typeof metadata.sprintName === "string" ? metadata.sprintName : row.sprint_name ?? undefined;
      event.draftTaskCount = typeof metadata.taskCount === "number" ? metadata.taskCount : undefined;
      event.draftSprintCount = typeof metadata.sprintCount === "number" ? metadata.sprintCount : undefined;
      event.draftNextSequenceNumber = typeof metadata.nextSequenceNumber === "number" ? metadata.nextSequenceNumber : undefined;
      event.draftProposalGroupId = typeof metadata.proposalGroupId === "string" ? metadata.proposalGroupId : undefined;
      event.draftMaterialized = metadata.materialized === true || metadata.materialized === 1;
      event.requestedByName = typeof metadata.proposedByAgentName === "string" ? metadata.proposedByAgentName : row.agent_name ?? undefined;
    }

    if (row.event_kind === "execution") {
      event.errorMessage = typeof metadata.errorMessage === "string" ? metadata.errorMessage : undefined;
    }

    return event;
  });

  // Unread count via pure SQL LEFT JOIN (raw composite keys match directly)
  const unreadCountRow = db
    .prepare(
      `${feedCte.sql}
      SELECT COUNT(*) AS count
     FROM visible_feed_events fe
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
    "to-do": 0,
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
        t.execution_engine,
        t.execution_mode,
        t.labels_json,
        t.source_review_id,
        t.source_takeaway_id,
        t.task_key,
        t.created_at,
        t.updated_at,
        p.settings_json AS project_settings_json,
        c.settings_json AS company_settings_json
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       WHERE ${taskWhereParts.join(" AND ")}
       ORDER BY
         CASE t.status
           WHEN 'blocked' THEN 0
           WHEN 'review' THEN 1
           WHEN 'in_progress' THEN 2
           WHEN 'to-do' THEN 3
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
      const executionEngine = resolveTaskExecutionEngine({
        taskExecutionEngine: row.execution_engine,
        projectSettingsJson: row.project_settings_json,
        companySettingsJson: row.company_settings_json,
      });
      if (status in mutableTotals) {
        mutableTotals[status as keyof typeof mutableTotals] =
          (mutableTotals[status as keyof typeof mutableTotals] ?? 0) + 1;
      }

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
        executionEngine: executionEngine.engine,
        executionEngineOverride: executionEngine.override,
        executionEngineSource: executionEngine.source,
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

export function countCompanyInboxUnreadThreads(input: {
  companyIdOrSlug: string;
  projectId?: string;
  status?: TaskStatusInput;
  search?: string;
  includeDone?: boolean;
  unreadSince?: string;
  includeArchived?: boolean;
  kinds?: string[];
  userId?: string;
}): number {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const userId = input.userId?.trim() || "default";
  const dbStatus = input.status ? toDbStatus(input.status) : undefined;
  const search = input.search?.trim().toLowerCase();
  const unreadSince = input.unreadSince?.trim() || undefined;
  const kinds = (input.kinds ?? []).map((kind) => kind.trim()).filter(Boolean);
  const kindPredicate = kinds.length > 0
    ? `AND fe.event_kind IN (${kinds.map(() => "?").join(",")})`
    : "";

  const feedCte = buildInboxFeedCte(companyRow.id, {
    projectId: input.projectId,
    status: dbStatus,
    excludeDone: !input.includeDone && !dbStatus,
    search,
    includeArchivedInbox: input.includeArchived,
  });

  const row = db
    .prepare(
      `${feedCte.sql}
      SELECT COUNT(*) AS count
      FROM (
        SELECT
          CASE
            WHEN fe.event_kind = 'approval'
              AND json_extract(fe.metadata_json, '$.approvalId') IS NOT NULL
              THEN 'a:' || json_extract(fe.metadata_json, '$.approvalId')
            WHEN fe.event_kind = 'sprint_plan_draft'
              AND json_extract(fe.metadata_json, '$.draftId') IS NOT NULL
              THEN 'd:' || json_extract(fe.metadata_json, '$.draftId')
            WHEN fe.event_kind = 'lead_supervisor_update'
              AND fe.company_goal_id IS NOT NULL
              THEN 'ls:' || fe.company_goal_id
            WHEN COALESCE(fe.task_key, '') != ''
              THEN 't:' || fe.task_key
            ELSE 'e:' || fe.event_id
          END AS thread_key
        FROM visible_feed_events fe
        LEFT JOIN inbox_read_state irs
          ON irs.company_id = ? AND irs.user_id = ? AND irs.event_id = fe.event_id
        WHERE irs.id IS NULL
          ${kindPredicate}
          ${unreadSince ? "AND fe.created_at > ?" : ""}
        GROUP BY thread_key
      ) unread_threads`
    )
    .get(
      ...feedCte.params,
      companyRow.id,
      userId,
      ...kinds,
      ...(unreadSince ? [unreadSince] : [])
    ) as { count: number } | undefined;

  return Number(row?.count ?? 0);
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
    "s.archived_at IS NULL",
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
        s.sprint_key AS sprint_key,
        s.goal_key AS sprint_goal_key,
        s.name AS sprint_name,
        s.goal AS sprint_goal,
        s.goal_kind AS sprint_goal_kind,
        s.status AS sprint_status,
        s.start_date AS sprint_start_date,
        s.end_date AS sprint_end_date,
        s.created_at AS sprint_created_at,
	        s.updated_at AS sprint_updated_at,
	        s.parent_id AS sprint_parent_id,
	        s.owner AS sprint_owner,
	        s.lead_agent_id AS sprint_lead_agent_id,
	        s.stop_condition AS sprint_stop_condition,
	        s.progress_summary AS sprint_progress_summary,
	        s.default_execution_engine AS sprint_default_execution_engine,
	        s.default_model_lane AS sprint_default_model_lane,
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

  const contractItemsBySprint = listGoalContractItemsForSprints(rows.map((row) => row.sprint_id));
  const companyGoalIds = rows
    .filter((row) => (row.sprint_goal_kind ?? (row.sprint_parent_id ? "sprint" : "company")) === "company")
    .map((row) => row.sprint_id);
  const planMetricsByGoal = loadGoalPlanMetrics(companyRow.id, companyGoalIds);

  const goals = rows.map((row) => {
    const planMetrics = planMetricsByGoal.get(row.sprint_id);
    const taskCount = planMetrics?.taskCount ?? Number(row.task_count ?? 0);
    const doneCount = planMetrics?.doneCount ?? Number(row.done_count ?? 0);

    doneTasks += doneCount;
    totalTasks += taskCount;

    return mapCompanyGoalRow(row, contractItemsBySprint.get(row.sprint_id) ?? [], planMetrics);
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
  projectId?: string;
  name: string;
  goal: string;
  goalKind?: "company" | "sprint";
  status: SprintStatusInput;
  startDate?: string;
  endDate?: string | null;
  parentId?: string;
  owner?: string | null;
  leadAgentId?: string | null;
  stopCondition?: string;
  progressSummary?: string;
  defaultExecutionEngine?: TaskExecutionEngine | null;
  defaultModelLane?: TaskModelLane | null;
  actorUserId?: string;
}): {
  company: OrchestrationCompany;
  goal: OrchestrationCompanyGoal;
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const projectRow = input.projectId
    ? getCompanyProjectRowByIdOrSlug(companyRow.id, input.projectId)
    : ensureCompanyGoalProject(db, companyRow.id);
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
  const goalKind = input.goalKind ?? (input.parentId ? "sprint" : "company");
  const sprintKey = goalKind === "sprint" && input.parentId
    ? sprintKeyForCompany(db, companyRow.id, companyRow.company_code)
    : null;
  const goalKey = goalKind === "company"
    ? goalKeyForCompany(db, companyRow.id, companyRow.company_code)
    : null;

  db.prepare(
    `INSERT INTO sprints
      (id, project_id, sprint_key, goal_key, name, goal, goal_kind, status, start_date, end_date, completed_at, parent_id, owner, lead_agent_id, stop_condition, progress_summary, default_execution_engine, default_model_lane, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sprintId,
    projectRow.id,
    sprintKey,
    goalKey,
    input.name,
    input.goal,
    goalKind,
    toDbSprintStatus(input.status),
    input.startDate ?? now,
    input.endDate ?? null,
    input.status === "done" ? now : null,
    input.parentId ?? null,
    input.owner ?? null,
    input.leadAgentId ?? null,
    input.stopCondition ?? "",
    input.progressSummary ?? "",
    input.defaultExecutionEngine ?? null,
    input.defaultModelLane ?? null,
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

  if (goalKind === "company" && input.status === "active" && input.leadAgentId) {
    createSprintPlanningTask({
      companyIdOrSlug: companyRow.id,
      companyGoalId: sprintId,
      leadAgentId: input.leadAgentId,
      actorUserId: "system",
    });
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
  goalKind?: "company" | "sprint" | null;
  status?: SprintStatusInput;
  startDate?: string;
  endDate?: string | null;
  parentId?: string | null;
  owner?: string | null;
  leadAgentId?: string | null;
  stopCondition?: string;
  progressSummary?: string;
  defaultExecutionEngine?: TaskExecutionEngine | null;
  defaultModelLane?: TaskModelLane | null;
  actorUserId?: string;
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
  if (
    input.stopCondition !== undefined &&
    input.stopCondition !== (current.stop_condition ?? "") &&
    current.status !== "planning" &&
    current.status !== "paused"
  ) {
    throw new OrchestrationApiError(
      400,
      "stop_condition_locked",
      "Pause the goal before changing its stop condition"
    );
  }

  if (nextStatus === "completed") {
    const gateFailure = completionGateFailure(db, current);
    if (gateFailure) {
      throw new OrchestrationApiError(
        400,
        "validation_gate_failed",
        `${gateFailure} — cannot mark done`
      );
    }
  }

  const completedAt = nextStatus === "completed" ? (current.completed_at ?? now) : null;

  db.prepare(
    `UPDATE sprints
     SET
      name = ?,
      goal = ?,
      goal_kind = ?,
      status = ?,
      start_date = ?,
      end_date = ?,
      completed_at = ?,
      parent_id = ?,
      owner = ?,
      lead_agent_id = ?,
      stop_condition = ?,
      progress_summary = ?,
      default_execution_engine = ?,
      default_model_lane = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    input.name ?? current.name,
    input.goal ?? current.goal,
    input.goalKind === undefined ? (current as Record<string, unknown>).goal_kind ?? null : input.goalKind,
    nextStatus,
    input.startDate ?? current.start_date,
    input.endDate === undefined ? current.end_date : input.endDate,
    completedAt,
    input.parentId === undefined ? (current as Record<string, unknown>).parent_id ?? null : input.parentId,
    input.owner === undefined ? (current as Record<string, unknown>).owner ?? null : input.owner,
    input.leadAgentId === undefined ? current.lead_agent_id ?? null : input.leadAgentId,
    input.stopCondition === undefined ? current.stop_condition ?? "" : input.stopCondition,
    input.progressSummary === undefined ? current.progress_summary ?? "" : input.progressSummary,
    input.defaultExecutionEngine === undefined ? current.default_execution_engine ?? null : input.defaultExecutionEngine,
    input.defaultModelLane === undefined ? current.default_model_lane ?? null : input.defaultModelLane,
    now,
    current.id
  );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);

  const updatedGoalKind = input.goalKind === undefined ? current.goal_kind ?? (current.parent_id ? "sprint" : "company") : input.goalKind;
  const updatedLeadAgentId = input.leadAgentId === undefined ? current.lead_agent_id ?? null : input.leadAgentId;
  if (
    updatedGoalKind === "company" &&
    current.status !== "active" &&
    nextStatus === "active" &&
    updatedLeadAgentId &&
    !hasPendingSprintPlanDraft(db, current.id)
  ) {
    createSprintPlanningTask({
      companyIdOrSlug: companyRow.id,
      companyGoalId: current.id,
      leadAgentId: updatedLeadAgentId,
      actorUserId: input.actorUserId ?? "system",
    });
  }

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

function getContractItemScopedToCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  itemId: string
): ScopedGoalContractItemRow | undefined {
  return db
    .prepare(
      `SELECT
        i.id,
        i.sprint_id,
        i.kind,
        i.text,
        i.position,
        i.created_at,
        i.updated_at,
        NULL AS evidence_id,
        NULL AS evidence_status,
        NULL AS evidence_source,
        NULL AS evidence_result_text,
        NULL AS evidence_command_exit_code,
        NULL AS evidence_artifact_uri,
        NULL AS evidence_recorded_by_agent_id,
        NULL AS evidence_recorded_by_user_id,
        NULL AS evidence_created_at,
        s.project_id,
        s.status AS sprint_status,
        s.goal_kind AS sprint_goal_kind,
        s.parent_id AS sprint_parent_id
       FROM goal_contract_items i
       INNER JOIN sprints s ON s.id = i.sprint_id
       INNER JOIN projects p ON p.id = s.project_id
       WHERE i.id = ?
         AND p.company_id = ?
         AND i.archived_at IS NULL
       LIMIT 1`
    )
    .get(itemId, companyId) as ScopedGoalContractItemRow | undefined;
}

function demoteDoneGoalIfGateNoLongerPasses(
  db: ReturnType<typeof getOrchestrationDb>,
  sprintId: string,
  failed: boolean
): void {
  const row = db
    .prepare("SELECT id, status FROM sprints WHERE id = ?")
    .get(sprintId) as { id: string; status: "planning" | "active" | "blocked" | "paused" | "completed" } | undefined;
  if (!row || row.status !== "completed") return;
  db.prepare("UPDATE sprints SET status = ?, completed_at = NULL, updated_at = ? WHERE id = ?")
    .run(failed ? "blocked" : "active", new Date().toISOString(), sprintId);
}

export function createGoalContractItem(input: {
  companyIdOrSlug: string;
  sprintId: string;
  kind: GoalContractItemKind;
  text: string;
  position?: number;
  actorUserId?: string;
  actorAgentId?: string;
}): { item: OrchestrationGoalContractItem; goal: OrchestrationCompanyGoal } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const sprint = getCompanyScopedSprintRow(companyRow.id, input.sprintId);
  if (!sprint) throw new OrchestrationApiError(404, "sprint_not_found", "Sprint not found");

  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO goal_contract_items
      (id, sprint_id, kind, text, position, created_by_agent_id, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.sprintId, input.kind, input.text, input.position ?? 0, input.actorAgentId ?? null, input.actorUserId ?? null, now, now);

  if (sprint.status === "completed" && (input.kind === "success_criterion" || input.kind === "validation_check")) {
    demoteDoneGoalIfGateNoLongerPasses(db, input.sprintId, false);
  }

  const items = listGoalContractItemsForSprints([input.sprintId]).get(input.sprintId) ?? [];
  const item = items.find((candidate) => candidate.id === id);
  const goal = getCompanyGoalBySprintId(companyRow.id, input.sprintId);
  if (!item || !goal) throw new OrchestrationApiError(500, "goal_contract_item_create_failed", "Contract item created but could not be loaded");
  return { item, goal };
}

export function updateGoalContractItem(input: {
  companyIdOrSlug: string;
  itemId: string;
  text?: string;
  position?: number;
  archived?: boolean;
  actorUserId?: string;
  actorAgentId?: string;
}): { item: OrchestrationGoalContractItem; goal: OrchestrationCompanyGoal } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const item = getContractItemScopedToCompany(db, companyRow.id, input.itemId);
  if (!item) throw new OrchestrationApiError(404, "contract_item_not_found", "Contract item not found");

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE goal_contract_items
     SET
      text = ?,
      position = ?,
      archived_at = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    input.text === undefined ? item.text : input.text,
    input.position === undefined ? item.position : input.position,
    input.archived === undefined ? null : input.archived ? now : null,
    now,
    input.itemId
  );

  if ((item.kind === "success_criterion" || item.kind === "validation_check") && input.archived !== undefined && !input.archived) {
    demoteDoneGoalIfGateNoLongerPasses(db, item.sprint_id, false);
  }

  const goal = getCompanyGoalBySprintId(companyRow.id, item.sprint_id);
  if (!goal) throw new OrchestrationApiError(500, "goal_contract_item_update_failed", "Contract item updated but goal could not be loaded");
  const updatedItem = (goal.sprint.contractItems ?? []).find((candidate) => candidate.id === input.itemId) ?? {
    id: input.itemId,
    sprintId: item.sprint_id,
    kind: item.kind,
    text: input.text === undefined ? item.text : input.text,
    position: input.position === undefined ? item.position : input.position,
    createdAt: item.created_at,
    updatedAt: now,
    latestEvidence: null,
  };
  return { item: updatedItem, goal };
}

export function recordGoalContractEvidence(input: {
  companyIdOrSlug: string;
  itemId: string;
  status: GoalContractEvidenceStatus;
  resultText?: string;
  commandExitCode?: number | null;
  artifactUri?: string | null;
  actorUserId?: string;
  actorAgentId?: string;
}): { evidence: OrchestrationGoalContractEvidence; goal: OrchestrationCompanyGoal } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const item = getContractItemScopedToCompany(db, companyRow.id, input.itemId);
  if (!item) throw new OrchestrationApiError(404, "contract_item_not_found", "Contract item not found");
  if ((input.status === "passed" || input.status === "retracted") && !input.actorUserId) {
    throw new OrchestrationApiError(400, "operator_confirmation_required", `${input.status} evidence requires operator confirmation`);
  }
  if ((input.status === "proposed" || input.status === "failed") && !input.actorAgentId && !input.actorUserId) {
    throw new OrchestrationApiError(400, "actor_required", "Evidence requires an agent or operator actor");
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const source = input.actorUserId ? "operator" : "agent";
  db.prepare(
    `INSERT INTO goal_contract_evidence
      (id, item_id, sprint_id, item_kind, status, source, result_text, command_exit_code, artifact_uri, recorded_by_agent_id, recorded_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.itemId,
    item.sprint_id,
    item.kind,
    input.status,
    source,
    input.resultText ?? "",
    input.commandExitCode ?? null,
    input.artifactUri ?? null,
    input.actorAgentId ?? null,
    input.actorUserId ?? null,
    now,
    now
  );

  if ((item.kind === "success_criterion" || item.kind === "validation_check") && input.status !== "passed") {
    demoteDoneGoalIfGateNoLongerPasses(db, item.sprint_id, input.status === "failed");
  }

  const evidence: OrchestrationGoalContractEvidence = {
    id,
    itemId: input.itemId,
    sprintId: item.sprint_id,
    itemKind: item.kind,
    status: input.status,
    source,
    resultText: input.resultText ?? "",
    commandExitCode: input.commandExitCode ?? null,
    artifactUri: input.artifactUri ?? null,
    recordedByAgentId: input.actorAgentId ?? null,
    recordedByUserId: input.actorUserId ?? null,
    createdAt: now,
  };
  const goal = getCompanyGoalBySprintId(companyRow.id, item.sprint_id);
  if (!goal) throw new OrchestrationApiError(500, "goal_evidence_record_failed", "Evidence recorded but goal could not be loaded");
  return { evidence, goal };
}

export function deleteCompanyGoal(input: {
  companyIdOrSlug: string;
  sprintId: string;
}): {
  company: OrchestrationCompany;
  sprintId: string;
  sprintIds: string[];
  taskIds: string[];
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
  const remove = db.transaction(() => {
    const sprintRows = db
      .prepare(
        `WITH RECURSIVE sprint_tree(id) AS (
           SELECT s.id
           FROM sprints s
           INNER JOIN projects p ON p.id = s.project_id
           WHERE s.id = ?
             AND p.company_id = ?
             AND p.archived_at IS NULL
           UNION ALL
           SELECT child.id
           FROM sprints child
           INNER JOIN sprint_tree parent ON parent.id = child.parent_id
           INNER JOIN projects p ON p.id = child.project_id
           WHERE p.company_id = ?
             AND p.archived_at IS NULL
         )
         SELECT id FROM sprint_tree`
      )
      .all(current.id, companyRow.id, companyRow.id) as Array<{ id: string }>;
    const sprintIds = sprintRows.map((row) => row.id);
    if (sprintIds.length === 0) return { sprintIds: [], taskIds: [] };

    const sprintPlaceholders = sprintIds.map(() => "?").join(",");
    const taskRows = db
      .prepare(`SELECT id FROM tasks WHERE sprint_id IN (${sprintPlaceholders})`)
      .all(...sprintIds) as Array<{ id: string }>;
    const taskIds = taskRows.map((row) => row.id);

    if (taskIds.length > 0) {
      const taskPlaceholders = taskIds.map(() => "?").join(",");
      const runRows = db
        .prepare(`SELECT id FROM execution_runs WHERE task_id IN (${taskPlaceholders})`)
        .all(...taskIds) as Array<{ id: string }>;
      const runIds = runRows.map((row) => row.id);
      if (runIds.length > 0) {
        const runPlaceholders = runIds.map(() => "?").join(",");
        db.prepare(`DELETE FROM execution_run_transcript_events WHERE execution_run_id IN (${runPlaceholders})`).run(...runIds);
        db.prepare(`DELETE FROM heartbeat_run_events WHERE run_id IN (${runPlaceholders})`).run(...runIds);
        db.prepare(`DELETE FROM heartbeat_runs WHERE id IN (${runPlaceholders})`).run(...runIds);
        db.prepare(`DELETE FROM agent_wakeup_requests WHERE run_id IN (${runPlaceholders})`).run(...runIds);
      }
      db.prepare(`DELETE FROM comments WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
      db.prepare(`DELETE FROM task_events WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
      db.prepare(`DELETE FROM execution_runs WHERE task_id IN (${taskPlaceholders})`).run(...taskIds);
      db.prepare(`DELETE FROM agent_wakeup_requests WHERE json_extract(payload_json, '$.taskId') IN (${taskPlaceholders})`).run(...taskIds);
      db.prepare(`DELETE FROM tasks WHERE id IN (${taskPlaceholders})`).run(...taskIds);
    }

    const contractItemRows = db
      .prepare(`SELECT id FROM goal_contract_items WHERE sprint_id IN (${sprintPlaceholders})`)
      .all(...sprintIds) as Array<{ id: string }>;
    const contractItemIds = contractItemRows.map((row) => row.id);
    if (contractItemIds.length > 0) {
      const contractItemPlaceholders = contractItemIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM goal_contract_evidence WHERE item_id IN (${contractItemPlaceholders})`).run(...contractItemIds);
    }
    db.prepare(`DELETE FROM goal_contract_evidence WHERE sprint_id IN (${sprintPlaceholders})`).run(...sprintIds);
    db.prepare(`DELETE FROM goal_contract_items WHERE sprint_id IN (${sprintPlaceholders})`).run(...sprintIds);
    db.prepare(`DELETE FROM goal_sprint_plan_drafts WHERE company_goal_id IN (${sprintPlaceholders})`).run(...sprintIds);
    db.prepare(`DELETE FROM sprints WHERE id IN (${sprintPlaceholders})`).run(...sprintIds);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);

    return { sprintIds, taskIds };
  });

  const deleted = remove();

  return {
    company: companyFromRow(companyRow),
    sprintId: current.id,
    sprintIds: deleted.sprintIds,
    taskIds: deleted.taskIds,
    projectId: current.project_id,
    deletedAt: now,
  };
}

export function archiveCompanyGoal(input: {
  companyIdOrSlug: string;
  sprintId: string;
}): {
  company: OrchestrationCompany;
  sprintId: string;
  sprintIds: string[];
  taskIds: string[];
  projectId: string;
  archivedAt: string;
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
  const archive = db.transaction(() => {
    const sprintRows = db
      .prepare(
        `WITH RECURSIVE sprint_tree(id) AS (
           SELECT s.id
           FROM sprints s
           INNER JOIN projects p ON p.id = s.project_id
           WHERE s.id = ?
             AND p.company_id = ?
             AND p.archived_at IS NULL
             AND s.archived_at IS NULL
           UNION ALL
           SELECT child.id
           FROM sprints child
           INNER JOIN sprint_tree parent ON parent.id = child.parent_id
           INNER JOIN projects p ON p.id = child.project_id
           WHERE p.company_id = ?
             AND p.archived_at IS NULL
             AND child.archived_at IS NULL
         )
         SELECT id FROM sprint_tree`
      )
      .all(current.id, companyRow.id, companyRow.id) as Array<{ id: string }>;
    const sprintIds = sprintRows.map((row) => row.id);
    if (sprintIds.length === 0) return { sprintIds: [], taskIds: [] };

    const placeholders = sprintIds.map(() => "?").join(",");
    const taskRows = db
      .prepare(`SELECT id FROM tasks WHERE sprint_id IN (${placeholders}) AND archived_at IS NULL`)
      .all(...sprintIds) as Array<{ id: string }>;
    const taskIds = taskRows.map((row) => row.id);

    db.prepare(`UPDATE sprints SET archived_at = ?, updated_at = ? WHERE id IN (${placeholders})`)
      .run(now, now, ...sprintIds);
    if (taskIds.length > 0) {
      const taskPlaceholders = taskIds.map(() => "?").join(",");
      db.prepare(`UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id IN (${taskPlaceholders})`)
        .run(now, now, ...taskIds);
    }
    db.prepare(
      `UPDATE goal_sprint_plan_drafts
          SET status = 'superseded',
              rejected_at = COALESCE(rejected_at, ?),
              reject_reason = CASE
                WHEN reject_reason IS NULL OR reject_reason = '' THEN 'archived with goal'
                ELSE reject_reason
              END,
              updated_at = ?
        WHERE company_goal_id IN (${placeholders})
          AND status = 'pending'`
    ).run(now, now, ...sprintIds);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);
    return { sprintIds, taskIds };
  });

  const archived = archive();
  return {
    company: companyFromRow(companyRow),
    sprintId: current.id,
    sprintIds: archived.sprintIds,
    taskIds: archived.taskIds,
    projectId: current.project_id,
    archivedAt: now,
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
  const eventIdsToArchive = new Set(input.eventIds);

  if (input.eventIds.length > 0) {
    const feedCte = buildInboxFeedCte(companyRow.id, { includeArchivedInbox: true });
    const placeholders = input.eventIds.map(() => "?").join(",");
    const targetRows = db
      .prepare(
        `${feedCte.sql}
        SELECT event_id, event_kind, task_key, metadata_json
        FROM feed_events
        WHERE event_id IN (${placeholders})`
      )
      .all(...feedCte.params, ...input.eventIds) as Array<{
        event_id: string;
        event_kind: string;
        task_key: string | null;
        metadata_json: string | null;
      }>;

    for (const row of targetRows) {
      if (row.task_key) {
        const threadRows = db
          .prepare(
            `${feedCte.sql}
            SELECT event_id
            FROM feed_events
            WHERE task_key = ? AND task_key != ''`
          )
          .all(...feedCte.params, row.task_key) as Array<{ event_id: string }>;
        for (const threadRow of threadRows) eventIdsToArchive.add(threadRow.event_id);
        continue;
      }

      if (row.event_kind === "approval") {
        const metadata = parseJsonObject(row.metadata_json);
        const approvalId = typeof metadata.approvalId === "string" ? metadata.approvalId : undefined;
        if (approvalId) {
          const threadRows = db
            .prepare(
              `${feedCte.sql}
              SELECT event_id
              FROM feed_events
              WHERE event_kind = 'approval'
                AND json_extract(metadata_json, '$.approvalId') = ?`
            )
            .all(...feedCte.params, approvalId) as Array<{ event_id: string }>;
          for (const threadRow of threadRows) eventIdsToArchive.add(threadRow.event_id);
        }
      }
    }
  }

  const upsert = db.prepare(
    `INSERT INTO inbox_read_state (id, company_id, user_id, event_id, read_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET archived_at = excluded.archived_at`
  );

  const tx = db.transaction(() => {
    for (const eventId of eventIdsToArchive) {
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

function getCompanyTaskId(db: ReturnType<typeof getOrchestrationDb>, companyId: string, taskId: string): { id: string; project_id: string } | undefined {
  return db
    .prepare(
      `SELECT t.id, t.project_id
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?
         AND p.company_id = ?
         AND t.archived_at IS NULL
       LIMIT 1`
    )
    .get(taskId, companyId) as { id: string; project_id: string } | undefined;
}

function insertSprintPlanTaskEvent(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  eventType: string;
  projectId: string;
  taskId: string;
  agentId?: string | null;
  userId?: string | null;
  metadata: Record<string, unknown>;
  now: string;
}): void {
  input.db.prepare(
    `INSERT INTO task_events (id, project_id, task_id, agent_id, user_id, event_type, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.projectId,
    input.taskId,
    input.agentId ?? null,
    input.userId ?? null,
    input.eventType,
    JSON.stringify(input.metadata),
    input.now
  );
}

function resolveGoalLeadAgentId(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  value?: string | null
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const row = db
    .prepare(
      `SELECT id
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR lower(name) = lower(?))
       LIMIT 1`
    )
    .get(companyId, raw, raw) as { id: string } | undefined;
  return row?.id ?? null;
}

function getExistingSprintPlanningTask(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  companyGoalId: string;
  title: string;
  leadAgentId: string | null;
}): { id: string; task_key: string | null } | undefined {
  return input.db
    .prepare(
      `SELECT id, task_key
       FROM tasks
       WHERE company_id = ?
         AND sprint_id = ?
         AND title = ?
         AND archived_at IS NULL
         AND status <> 'done'
         AND (
           (? IS NULL AND assignee_agent_id IS NULL)
           OR assignee_agent_id = ?
         )
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(input.companyId, input.companyGoalId, input.title, input.leadAgentId, input.leadAgentId) as
      | { id: string; task_key: string | null }
      | undefined;
}

function hasPendingSprintPlanDraft(db: ReturnType<typeof getOrchestrationDb>, goalId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM goal_sprint_plan_drafts WHERE company_goal_id = ? AND status = 'pending' LIMIT 1")
    .get(goalId);
  return Boolean(row);
}

function enqueueGoalLeadPlanningWake(input: {
  db: ReturnType<typeof getOrchestrationDb>;
  companyId: string;
  agentId: string | null;
  companyGoalId: string;
  taskId: string;
  taskKey: string;
}): void {
  if (!input.agentId) return;
  const now = new Date().toISOString();
  const taskStatus = input.db
    .prepare("SELECT status FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(input.taskId) as { status: string } | undefined;
  const idempotencyKey = `goal-lead-planning:${input.companyGoalId}:${input.taskId}:${input.agentId}`;
  const existing = input.db
    .prepare(
      `SELECT id
       FROM agent_wakeup_requests
       WHERE idempotency_key = ?
         AND status = 'queued'
       LIMIT 1`
    )
    .get(idempotencyKey) as { id: string } | undefined;

  if (existing) {
    input.db.prepare(
      `UPDATE agent_wakeup_requests
       SET coalesced_count = coalesced_count + 1,
           updated_at = ?
       WHERE id = ?`
    ).run(now, existing.id);
    return;
  }

  input.db.prepare(
    `UPDATE agent_wakeup_requests
     SET idempotency_key = NULL
     WHERE idempotency_key = ?
       AND status IN ('finished', 'failed', 'claimed')`
  ).run(idempotencyKey);

  const wakeupId = randomUUID();
  const runId = randomUUID();
  const payload = {
    companyGoalId: input.companyGoalId,
    taskId: input.taskId,
    taskKey: input.taskKey,
    taskStatus: taskStatus?.status ?? "to-do",
    assigneeAgentId: input.agentId,
    wakeSource: "explicit",
    wakeReason: GOAL_LEAD_PLANNING_TRIGGER,
  };

  input.db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json, status, idempotency_key, run_id, requested_at, requested_by_actor_type, requested_by_actor_id, created_at, updated_at)
     VALUES
       (?, ?, ?, 'explicit', ?, ?, ?, 'queued', ?, ?, ?, 'system', 'goal-contract', ?, ?)`
  ).run(
    wakeupId,
    input.agentId,
    input.companyId,
    GOAL_LEAD_PLANNING_TRIGGER,
    GOAL_LEAD_PLANNING_TRIGGER,
    JSON.stringify(payload),
    idempotencyKey,
    runId,
    now,
    now,
    now,
  );

  input.db.prepare(
    `INSERT INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
     VALUES
       (?, ?, ?, 'wakeup_request', ?, 'queued', ?, ?, ?, ?)`
  ).run(
    runId,
    input.agentId,
    input.companyId,
    GOAL_LEAD_PLANNING_TRIGGER,
    wakeupId,
    JSON.stringify(payload),
    now,
    now,
  );
}

export function createSprintPlanningTask(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  leadAgentId?: string | null;
  actorUserId?: string;
}): { taskId: string; taskKey: string; goal: OrchestrationCompanyGoal } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const goal = getCompanyScopedSprintRow(companyRow.id, input.companyGoalId);
  if (!goal) throw new OrchestrationApiError(404, "company_goal_not_found", "Company goal not found");
  const goalKind = goal.goal_kind ?? (goal.parent_id ? "sprint" : "company");
  if (goalKind !== "company") {
    throw new OrchestrationApiError(400, "company_goal_required", "Sprint planning starts from a company goal");
  }

  const existingPendingDraft = db.prepare(
    `SELECT id
     FROM goal_sprint_plan_drafts
     WHERE company_id = ?
       AND company_goal_id = ?
       AND status = 'pending'
     LIMIT 1`,
  ).get(companyRow.id, goal.id) as { id: string } | undefined;
  if (existingPendingDraft) {
    throw new OrchestrationApiError(
      409,
      "pending_sprint_plan_draft_exists",
      "This goal already has a pending sprint plan draft. Review, approve, reject, or supersede that draft before starting another planning run.",
    );
  }

  const leadAgentId = resolveGoalLeadAgentId(db, companyRow.id, input.leadAgentId ?? goal.lead_agent_id);
  const title = `Plan sprint for ${goal.name}`;
  const existing = getExistingSprintPlanningTask({
    db,
    companyId: companyRow.id,
    companyGoalId: goal.id,
    title,
    leadAgentId,
  });
  if (existing) {
    enqueueGoalLeadPlanningWake({
      db,
      companyId: companyRow.id,
      agentId: leadAgentId,
      companyGoalId: goal.id,
      taskId: existing.id,
      taskKey: existing.task_key ?? existing.id,
    });
    const loaded = getCompanyGoalBySprintId(companyRow.id, goal.id);
    if (!loaded) throw new OrchestrationApiError(500, "company_goal_load_failed", "Planning task found but goal could not be loaded");
    return { taskId: existing.id, taskKey: existing.task_key ?? existing.id, goal: loaded };
  }

  const task = createTask({
    companyIdOrSlug: companyRow.id,
    projectId: goal.project_id,
    sprintId: goal.id,
    title,
    description: [
      `Create a sprint plan for company goal: ${goal.name}.`,
      goal.goal ? `Objective: ${goal.goal}` : "",
      goal.stop_condition ? `Stop condition: ${goal.stop_condition}` : "",
      "Emit a propose_sprint_plan mc-action with the proposed sprint contract and every execution task. Do not create execution tasks directly.",
      "Planning quality determines code quality. Produce parallel-ready implementation slices, minimal necessary dependency gates, review/QA coverage, visual proof, migration/data safety, rollback/idempotence checks, and operator-verifiable validation. Use dependencies only for hard prerequisites; otherwise let capable agents work concurrently with clear ownership boundaries. Use cheap/fast models for bounded mechanical work and deeper models for architecture, novel design, and high-risk review.",
    ].filter(Boolean).join("\n\n"),
    priority: "P0",
    type: "research",
    status: "to-do",
    assignee: leadAgentId || undefined,
    labels: ["sprint-planning", "goal-contract"],
    executionEngine: goal.default_execution_engine ?? "hiverunner",
    modelLane: goal.default_model_lane ?? "default",
    createdBy: input.actorUserId ?? "system",
  }).task;

  enqueueGoalLeadPlanningWake({
    db,
    companyId: companyRow.id,
    agentId: leadAgentId,
    companyGoalId: goal.id,
    taskId: task.id,
    taskKey: task.key ?? task.id,
  });

  const loaded = getCompanyGoalBySprintId(companyRow.id, goal.id);
  if (!loaded) throw new OrchestrationApiError(500, "company_goal_load_failed", "Planning task created but goal could not be loaded");
  return { taskId: task.id, taskKey: task.key ?? task.id, goal: loaded };
}

export function getPendingSprintPlanDraft(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
}): { draft: OrchestrationSprintPlanDraft | null } {
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const row = getOrchestrationDb()
    .prepare(
      `SELECT *
       FROM goal_sprint_plan_drafts
       WHERE company_id = ?
         AND company_goal_id = ?
         AND status = 'pending'
       ORDER BY sequence_number ASC, created_at ASC
       LIMIT 1`
    )
    .get(companyRow.id, input.companyGoalId) as SprintPlanDraftRow | undefined;
  return { draft: row ? sprintPlanDraftFromRow(row) : null };
}

export function listPendingSprintPlanDraftsForGoal(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
}): { drafts: OrchestrationSprintPlanDraft[] } {
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const rows = getOrchestrationDb()
    .prepare(
      `SELECT *
       FROM goal_sprint_plan_drafts
       WHERE company_id = ?
         AND company_goal_id = ?
         AND status = 'pending'
       ORDER BY sequence_number ASC, created_at ASC`
    )
    .all(companyRow.id, input.companyGoalId) as SprintPlanDraftRow[];
  return { drafts: rows.map(sprintPlanDraftFromRow) };
}

export function listPendingSprintPlanDrafts(input?: {
  companyIdOrSlug?: string;
}): { drafts: OrchestrationPendingSprintPlanDraftSummary[] } {
  const db = getOrchestrationDb();
  const companyRow = input?.companyIdOrSlug
    ? getCompanyRowByIdOrSlug(input.companyIdOrSlug)
    : undefined;
  if (input?.companyIdOrSlug && !companyRow) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  const rows = db
    .prepare(
      `SELECT
        first_draft.id,
        plan.proposal_group_id,
        c.id AS company_id,
        c.slug AS company_slug,
        c.company_code AS company_code,
        g.id AS company_goal_id,
        g.name AS company_goal_name,
        plan.proposed_by_agent_id,
        a.name AS proposed_by_agent_name,
        CASE
          WHEN a.avatar_url IS NOT NULL THEN '/api/orchestration/companies/' || c.id || '/agents/' || COALESCE(NULLIF(a.slug, ''), a.id) || '/avatar?size=64'
          ELSE NULL
        END AS proposed_by_agent_avatar_url,
        COALESCE(json_extract(first_draft.sprint_json, '$.name'), 'Sprint plan') AS sprint_name,
        json_extract(first_draft.sprint_json, '$.completionProposal') AS completion_proposal,
        json_extract(first_draft.sprint_json, '$.completionReason') AS completion_reason,
        json_array_length(first_draft.tasks_json) AS next_task_count,
        plan.task_count,
        plan.sprint_count,
        plan.next_sequence_number,
        plan.created_at
       FROM (
         SELECT
           d.company_id,
           d.company_goal_id,
           COALESCE(d.proposal_group_id, d.id) AS proposal_group_id,
           MIN(d.sequence_number) AS next_sequence_number,
           COUNT(*) AS sprint_count,
           SUM(json_array_length(d.tasks_json)) AS task_count,
           MIN(d.created_at) AS created_at,
           MIN(d.proposed_by_agent_id) AS proposed_by_agent_id
         FROM goal_sprint_plan_drafts d
         INNER JOIN companies c ON c.id = d.company_id
         INNER JOIN sprints g ON g.id = d.company_goal_id
         WHERE d.status = 'pending'
           AND c.archived_at IS NULL
           AND g.archived_at IS NULL
           ${companyRow ? "AND c.id = ?" : ""}
         GROUP BY d.company_id, d.company_goal_id, COALESCE(d.proposal_group_id, d.id)
       ) plan
       INNER JOIN companies c ON c.id = plan.company_id
       INNER JOIN sprints g ON g.id = plan.company_goal_id AND g.archived_at IS NULL
       INNER JOIN goal_sprint_plan_drafts first_draft
         ON first_draft.company_goal_id = plan.company_goal_id
        AND COALESCE(first_draft.proposal_group_id, first_draft.id) = plan.proposal_group_id
        AND first_draft.sequence_number = plan.next_sequence_number
        AND first_draft.status = 'pending'
       LEFT JOIN agents a ON a.id = plan.proposed_by_agent_id AND a.company_id = c.id
       ORDER BY plan.created_at DESC`
    )
    .all(...(companyRow ? [companyRow.id] : [])) as Array<{
      id: string;
      proposal_group_id: string | null;
      company_id: string;
      company_slug: string;
      company_code: string | null;
      company_goal_id: string;
      company_goal_name: string;
      proposed_by_agent_id: string | null;
      proposed_by_agent_name: string | null;
      proposed_by_agent_avatar_url: string | null;
      sprint_name: string | null;
      completion_proposal: number | string | null;
      completion_reason: string | null;
      next_task_count: number | null;
      task_count: number | null;
      sprint_count: number | null;
      next_sequence_number: number | null;
      created_at: string;
    }>;

  const groupKeys = rows.map((row) => row.proposal_group_id ?? row.id);
  const sprintBreakdowns = new Map<string, Array<{
    id: string;
    sequenceNumber: number;
    sprintName: string;
    taskCount: number;
  }>>();
  if (groupKeys.length > 0) {
    const placeholders = groupKeys.map(() => "?").join(",");
    const breakdownRows = db
      .prepare(
        `SELECT
           d.id,
           COALESCE(d.proposal_group_id, d.id) AS proposal_group_id,
           d.sequence_number,
           COALESCE(json_extract(d.sprint_json, '$.name'), 'Sprint plan') AS sprint_name,
           json_array_length(d.tasks_json) AS task_count
         FROM goal_sprint_plan_drafts d
         INNER JOIN companies c ON c.id = d.company_id
         INNER JOIN sprints g ON g.id = d.company_goal_id
         WHERE d.status = 'pending'
           AND c.archived_at IS NULL
           AND g.archived_at IS NULL
           ${companyRow ? "AND c.id = ?" : ""}
           AND COALESCE(d.proposal_group_id, d.id) IN (${placeholders})
         ORDER BY d.sequence_number ASC`
      )
      .all(...(companyRow ? [companyRow.id] : []), ...groupKeys) as Array<{
        id: string;
        proposal_group_id: string | null;
        sequence_number: number | null;
        sprint_name: string | null;
        task_count: number | null;
      }>;
    for (const row of breakdownRows) {
      const key = row.proposal_group_id ?? row.id;
      const list = sprintBreakdowns.get(key) ?? [];
      list.push({
        id: row.id,
        sequenceNumber: Number(row.sequence_number ?? list.length + 1),
        sprintName: row.sprint_name ?? "Sprint plan",
        taskCount: Number(row.task_count ?? 0),
      });
      sprintBreakdowns.set(key, list);
    }
  }

  return {
    drafts: rows.map((row) => {
      const groupKey = row.proposal_group_id ?? row.id;
      return {
        id: row.id,
        companyId: row.company_id,
        companySlug: row.company_slug,
        companyCode: row.company_code ?? row.company_slug.toUpperCase(),
        companyGoalId: row.company_goal_id,
        companyGoalName: row.company_goal_name,
        proposedByAgentId: row.proposed_by_agent_id ?? undefined,
        proposedByAgentName: row.proposed_by_agent_name ?? undefined,
        proposedByAgentAvatarUrl: row.proposed_by_agent_avatar_url ?? undefined,
        sprintName: row.sprint_name ?? "Sprint plan",
        taskCount: Number(row.task_count ?? 0),
        nextSprintTaskCount: Number(row.next_task_count ?? 0),
        sprintCount: Number(row.sprint_count ?? 1),
        nextSequenceNumber: Number(row.next_sequence_number ?? 1),
        sprints: sprintBreakdowns.get(groupKey) ?? undefined,
        proposalGroupId: row.proposal_group_id ?? undefined,
        completionProposal: row.completion_proposal === 1 || row.completion_proposal === "true",
        completionReason: row.completion_reason ?? undefined,
        createdAt: row.created_at,
      };
    }),
  };
}

export function createSprintPlanDraft(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  planningTaskId: string;
  proposedByAgentId?: string | null;
  sprint: OrchestrationSprintPlanDraftSprint;
  tasks: OrchestrationSprintPlanDraftTask[];
  sequenceNumber?: number;
  proposalGroupId?: string | null;
}): { draft: OrchestrationSprintPlanDraft } {
  const result = createSprintPlanDrafts({
    companyIdOrSlug: input.companyIdOrSlug,
    companyGoalId: input.companyGoalId,
    planningTaskId: input.planningTaskId,
    proposedByAgentId: input.proposedByAgentId,
    drafts: [{
      sequenceNumber: input.sequenceNumber ?? 1,
      sprint: input.sprint,
      tasks: input.tasks,
    }],
    proposalGroupId: input.proposalGroupId,
  });
  const draft = result.drafts[0];
  if (!draft) throw new OrchestrationApiError(500, "sprint_plan_draft_create_failed", "Draft created but could not be loaded");
  return { draft };
}

export function createSprintPlanDrafts(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  planningTaskId: string;
  proposedByAgentId?: string | null;
  proposalGroupId?: string | null;
  supersedePending?: boolean;
  drafts: Array<{
    sequenceNumber?: number;
    sprint: OrchestrationSprintPlanDraftSprint;
    tasks: OrchestrationSprintPlanDraftTask[];
  }>;
}): { drafts: OrchestrationSprintPlanDraft[]; proposalGroupId: string } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const goal = getCompanyScopedSprintRow(companyRow.id, input.companyGoalId);
  if (!goal) throw new OrchestrationApiError(404, "company_goal_not_found", "Company goal not found");
  const goalKind = goal.goal_kind ?? (goal.parent_id ? "sprint" : "company");
  if (goalKind !== "company") throw new OrchestrationApiError(400, "company_goal_required", "Drafts must target a company goal");
  const planningTask = getCompanyTaskId(db, companyRow.id, input.planningTaskId);
  if (!planningTask) throw new OrchestrationApiError(404, "planning_task_not_found", "Planning task not found");
  if (input.drafts.length === 0) throw new OrchestrationApiError(400, "empty_sprint_plan", "A sprint plan must include at least one sprint");

  const now = new Date().toISOString();
  const proposalGroupId = input.proposalGroupId ?? randomUUID();
  const operatorSelectedExecutionEngine = goal.default_execution_engine ?? null;
  const normalizedDrafts = input.drafts.map((draft, index) => {
    const sprintDefaultExecutionEngine = operatorSelectedExecutionEngine ?? draft.sprint.defaultExecutionEngine ?? null;
    return {
      id: randomUUID(),
      sequenceNumber: Math.max(1, Number(draft.sequenceNumber ?? index + 1)),
      sprint: {
        ...draft.sprint,
        defaultExecutionEngine: sprintDefaultExecutionEngine,
      },
      tasks: draft.tasks.map((task) => ({
        ...task,
        executionEngine: sprintDefaultExecutionEngine ?? task.executionEngine ?? null,
      })),
    };
  });
  const seenSequences = new Set<number>();
  for (const draft of normalizedDrafts) {
    if (seenSequences.has(draft.sequenceNumber)) {
      throw new OrchestrationApiError(400, "duplicate_sequence_number", "Each sprint in a plan must have a unique sequence number");
    }
    seenSequences.add(draft.sequenceNumber);
  }

  const tx = db.transaction(() => {
    if (input.supersedePending !== false) {
      db.prepare(
        `UPDATE goal_sprint_plan_drafts
         SET status = 'superseded', rejected_at = ?, reject_reason = 'superseded', updated_at = ?
         WHERE company_id = ? AND company_goal_id = ? AND status = 'pending'`
      ).run(now, now, companyRow.id, goal.id);
    }
    const insert = db.prepare(
      `INSERT INTO goal_sprint_plan_drafts
        (id, company_id, company_goal_id, planning_task_id, proposed_by_agent_id, status,
         sequence_number, proposal_group_id, sprint_json, tasks_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    );
    for (const draft of normalizedDrafts) {
      insert.run(
        draft.id,
        companyRow.id,
        goal.id,
        planningTask.id,
        input.proposedByAgentId ?? null,
        draft.sequenceNumber,
        proposalGroupId,
        JSON.stringify(draft.sprint),
        JSON.stringify(draft.tasks),
        now,
        now
      );
    }
    const firstSprint = normalizedDrafts[0]?.sprint;
    const isCompletionProposal = Boolean(firstSprint?.completionProposal);
    insertSprintPlanTaskEvent({
      db,
      eventType: isCompletionProposal ? "goal.completion_proposed" : "goal.sprint_plan_proposed",
      projectId: planningTask.project_id,
      taskId: planningTask.id,
      agentId: input.proposedByAgentId ?? null,
      metadata: {
        draftId: normalizedDrafts[0]?.id,
        proposalGroupId,
        companyGoalId: goal.id,
        companyGoalName: goal.name,
        sprintName: firstSprint?.name ?? "Sprint plan",
        completionProposal: isCompletionProposal,
        completionReason: firstSprint?.completionReason,
        taskCount: normalizedDrafts.reduce((sum, draft) => sum + draft.tasks.length, 0),
        sprintCount: normalizedDrafts.length,
        nextSequenceNumber: Math.min(...normalizedDrafts.map((draft) => draft.sequenceNumber)),
      },
      now,
    });
  });
  tx();

  const rows = db
    .prepare(
      `SELECT *
       FROM goal_sprint_plan_drafts
       WHERE proposal_group_id = ?
         AND company_id = ?
         AND company_goal_id = ?
       ORDER BY sequence_number ASC`
    )
    .all(proposalGroupId, companyRow.id, goal.id) as SprintPlanDraftRow[];
  if (rows.length === 0) throw new OrchestrationApiError(500, "sprint_plan_draft_create_failed", "Drafts created but could not be loaded");
  return { drafts: rows.map(sprintPlanDraftFromRow), proposalGroupId };
}

export function createGoalCompletionProposal(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  planningTaskId: string;
  proposedByAgentId?: string | null;
  reason: string;
}): { draft: OrchestrationSprintPlanDraft } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const maxRow = db
    .prepare(
      `SELECT COALESCE(MAX(sequence_number), 0) AS max_sequence
       FROM goal_sprint_plan_drafts
       WHERE company_id = ?
         AND company_goal_id = ?
         AND status IN ('pending','approved')`
    )
    .get(companyRow.id, input.companyGoalId) as { max_sequence: number } | undefined;
  const result = createSprintPlanDrafts({
    companyIdOrSlug: input.companyIdOrSlug,
    companyGoalId: input.companyGoalId,
    planningTaskId: input.planningTaskId,
    proposedByAgentId: input.proposedByAgentId,
    supersedePending: false,
    drafts: [{
      sequenceNumber: Number(maxRow?.max_sequence ?? 0) + 1,
      sprint: {
        name: "Goal completion proposed",
        objective: input.reason,
        completionProposal: true,
        completionReason: input.reason,
        successCriteria: [],
        validationChecks: [],
        outOfScope: [],
      },
      tasks: [],
    }],
  });
  const draft = result.drafts[0];
  if (!draft) throw new OrchestrationApiError(500, "goal_completion_proposal_failed", "Completion proposal could not be loaded");
  return { draft };
}

export function rejectSprintPlanDraft(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  reason: string;
  actorUserId?: string;
}): { draft: OrchestrationSprintPlanDraft } {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const row = getSprintPlanDraftRow(input.draftId);
  if (!row || row.company_id !== companyRow.id || row.company_goal_id !== input.companyGoalId) {
    throw new OrchestrationApiError(404, "sprint_plan_draft_not_found", "Draft not found");
  }
  if (row.status !== "pending") throw new OrchestrationApiError(400, "draft_not_pending", "Only pending drafts can be rejected");
  const planningTask = row.planning_task_id ? getCompanyTaskId(db, companyRow.id, row.planning_task_id) : undefined;
  const sprintDraft = parseDraftSprint(row.sprint_json);
  const taskDrafts = parseDraftTasks(row.tasks_json);
  const parent = getCompanyScopedSprintRow(companyRow.id, row.company_goal_id);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE goal_sprint_plan_drafts
     SET status = 'rejected', reject_reason = ?, rejected_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(input.reason, now, now, row.id);
  if (planningTask) {
    insertSprintPlanTaskEvent({
      db,
      eventType: sprintDraft.completionProposal ? "goal.completion_rejected" : "goal.sprint_plan_rejected",
      projectId: planningTask.project_id,
      taskId: planningTask.id,
      userId: input.actorUserId ?? "operator",
      metadata: { draftId: row.id, reason: input.reason },
      now,
    });
  }
  if (parent) {
    recordSprintPlanReviewRetrospective({
      db,
      companyId: companyRow.id,
      projectId: parent.project_id,
      companyGoalId: parent.id,
      companyGoalName: parent.name,
      planningTask,
      agentId: row.proposed_by_agent_id,
      draftId: row.id,
      outcome: "rejected",
      sprintDraft,
      taskDrafts,
      parent,
      reason: input.reason,
      now,
    });
  }
  const updated = getSprintPlanDraftRow(row.id);
  if (!updated) throw new OrchestrationApiError(500, "sprint_plan_draft_load_failed", "Draft rejected but could not be loaded");
  return { draft: sprintPlanDraftFromRow(updated) };
}

export function approveSprintPlanDraft(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  sprint?: OrchestrationSprintPlanDraftSprint;
  tasks?: OrchestrationSprintPlanDraftTask[];
  actorUserId?: string;
}): {
  draft: OrchestrationSprintPlanDraft;
  sprint: OrchestrationCompanyGoal;
  taskIds: string[];
  assigneeResolutionFailures?: Array<{ taskId: string; title: string; assignee: string }>;
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const row = getSprintPlanDraftRow(input.draftId);
  if (!row || row.company_id !== companyRow.id || row.company_goal_id !== input.companyGoalId) {
    throw new OrchestrationApiError(404, "sprint_plan_draft_not_found", "Draft not found");
  }
  if (row.status !== "pending") throw new OrchestrationApiError(400, "draft_not_pending", "Only pending drafts can be approved");
  const rowSprintDraft = parseDraftSprint(row.sprint_json);
  const earlier = db
    .prepare(
      `SELECT id, sequence_number
       FROM goal_sprint_plan_drafts
       WHERE company_id = ?
         AND company_goal_id = ?
         AND status = 'pending'
         AND sequence_number < ?
       ORDER BY sequence_number ASC
       LIMIT 1`
    )
    .get(companyRow.id, row.company_goal_id, row.sequence_number) as { id: string; sequence_number: number } | undefined;
  if (earlier && !rowSprintDraft.completionProposal) {
    throw new OrchestrationApiError(409, "earlier_sprint_pending", `Sprint ${earlier.sequence_number} must be approved before sprint ${row.sequence_number}`);
  }
  const parent = getCompanyScopedSprintRow(companyRow.id, row.company_goal_id);
  if (!parent) throw new OrchestrationApiError(404, "company_goal_not_found", "Company goal not found");
  const planningTask = row.planning_task_id ? getCompanyTaskId(db, companyRow.id, row.planning_task_id) : undefined;
  const sprintDraft = input.sprint ?? rowSprintDraft;
  const taskDrafts = input.tasks ?? parseDraftTasks(row.tasks_json);
  const now = new Date().toISOString();

  if (sprintDraft.completionProposal) {
    const gateFailure = completionGateFailure(db, parent);
    if (gateFailure) {
      throw new OrchestrationApiError(400, "validation_gate_failed", `${gateFailure} — cannot mark done`);
    }
    db.prepare(
      `UPDATE sprints
       SET status = 'completed',
           completed_at = COALESCE(completed_at, ?),
           updated_at = ?
       WHERE id = ?`
    ).run(now, now, parent.id);
    db.prepare(
      `UPDATE goal_sprint_plan_drafts
       SET status = 'superseded',
           reject_reason = 'goal-completed',
           rejected_at = ?,
           updated_at = ?
       WHERE company_id = ?
         AND company_goal_id = ?
         AND status = 'pending'
         AND id <> ?`
    ).run(now, now, companyRow.id, parent.id, row.id);
    db.prepare(
      `UPDATE goal_sprint_plan_drafts
       SET status = 'approved',
           approved_at = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(now, now, row.id);
    if (planningTask) {
      insertSprintPlanTaskEvent({
        db,
        eventType: "goal.completion_approved",
        projectId: planningTask.project_id,
        taskId: planningTask.id,
        userId: input.actorUserId ?? "operator",
        metadata: { draftId: row.id, reason: sprintDraft.completionReason ?? sprintDraft.objective },
        now,
      });
    }
    const updated = getSprintPlanDraftRow(row.id);
    const loadedGoal = getCompanyGoalBySprintId(companyRow.id, parent.id);
    if (!updated || !loadedGoal) throw new OrchestrationApiError(500, "goal_completion_load_failed", "Goal completed but could not be loaded");
    return { draft: sprintPlanDraftFromRow(updated), sprint: loadedGoal, taskIds: [] };
  }

  const taskBackedSprintStatus: SprintStatusInput = taskDrafts.length > 0 ? "active" : "planned";
  const materializedSprintName = sprintNameWithSequence(sprintDraft.name, Number(row.sequence_number ?? 1));
  const precreatedSprint = findEmptyPrecreatedSprintForDraft(db, companyRow.id, parent.id, sprintDraft.name);
  let created: OrchestrationCompanyGoal;
  if (precreatedSprint) {
    db.prepare(
      `UPDATE sprints
       SET name = ?,
           goal = CASE WHEN trim(COALESCE(goal, '')) = '' THEN ? ELSE goal END,
           status = ?,
           start_date = COALESCE(NULLIF(start_date, ''), ?),
           end_date = COALESCE(end_date, ?),
           owner = COALESCE(owner, ?),
           lead_agent_id = COALESCE(lead_agent_id, ?),
           sprint_key = COALESCE(sprint_key, ?),
           default_execution_engine = COALESCE(default_execution_engine, ?),
           default_model_lane = COALESCE(default_model_lane, ?),
           updated_at = ?
       WHERE id = ?`
    ).run(
      materializedSprintName,
      sprintDraft.objective,
      toDbSprintStatus(taskBackedSprintStatus),
      sprintDraft.startDate ?? precreatedSprint.start_date ?? now,
      sprintDraft.endDate ?? null,
      sprintDraft.owner ?? null,
      parent.lead_agent_id ?? null,
      precreatedSprint.sprint_key ?? sprintKeyForCompany(db, companyRow.id, companyRow.company_code),
      sprintDraft.defaultExecutionEngine ?? parent.default_execution_engine ?? "hiverunner",
      sprintDraft.defaultModelLane ?? parent.default_model_lane ?? "default",
      now,
      precreatedSprint.id,
    );
    mergeDraftContractItemsIntoSprint({
      companyId: companyRow.id,
      sprintId: precreatedSprint.id,
      sprintDraft,
      actorUserId: input.actorUserId ?? "operator",
    });
    const loaded = getCompanyGoalBySprintId(companyRow.id, precreatedSprint.id);
    if (!loaded) throw new OrchestrationApiError(500, "sprint_plan_precreated_fill_failed", "Pre-created sprint filled but could not be loaded");
    created = loaded;
  } else {
    created = createCompanyGoal({
      companyIdOrSlug: companyRow.id,
      projectId: parent.project_id,
      parentId: parent.id,
      goalKind: "sprint",
      name: materializedSprintName,
      goal: sprintDraft.objective,
      status: taskBackedSprintStatus,
      startDate: sprintDraft.startDate,
      endDate: sprintDraft.endDate ?? null,
      owner: sprintDraft.owner ?? null,
      leadAgentId: parent.lead_agent_id ?? null,
      defaultExecutionEngine: sprintDraft.defaultExecutionEngine ?? parent.default_execution_engine ?? "hiverunner",
      defaultModelLane: sprintDraft.defaultModelLane ?? parent.default_model_lane ?? "default",
    }).goal;

    mergeDraftContractItemsIntoSprint({
      companyId: companyRow.id,
      sprintId: created.sprint.id,
      sprintDraft,
      actorUserId: input.actorUserId ?? "operator",
    });
  }

  const taskIds: string[] = [];
  const draftTaskIdToMaterializedTaskId = new Map<string, string>();
  const assigneeResolutionFailures: Array<{ taskId: string; title: string; assignee: string }> = [];
  const materializedTaskDrafts = taskDrafts.map((task) => {
    const resolvedEligibility = resolveDraftEligibleAssigneesForCompany(db, companyRow.id, task);
    for (const failure of resolvedEligibility.failures) {
      assigneeResolutionFailures.push({ taskId: task.id, title: task.title, assignee: failure });
    }
    if (!task.assignee?.trim()) {
      return {
        ...task,
        assignee: null,
        eligibleAssignees: resolvedEligibility.eligibleAssignees,
        type: coerceDraftTaskTypeForMaterialization(task),
      };
    }
    const assignee = resolveDraftAssigneeAgentForCompany(db, companyRow.id, task.assignee);
    if (!assignee) {
      return {
        ...task,
        assignee: null,
        eligibleAssignees: resolvedEligibility.eligibleAssignees,
        type: coerceDraftTaskTypeForMaterialization(task),
      };
    }
    return {
      ...task,
      assignee: assignee.id,
      eligibleAssignees: resolvedEligibility.eligibleAssignees,
      type: coerceDraftTaskTypeForMaterialization(task),
    };
  });

  for (const task of materializedTaskDrafts) {
    const descriptionParts = [task.description ?? ""];
    if (task.validation) descriptionParts.push(`Validation: ${task.validation}`);
    if (task.dependsOn?.length) descriptionParts.push(`Depends on: ${task.dependsOn.join(", ")}`);
    const createdTask = createTask({
      companyIdOrSlug: companyRow.id,
      projectId: parent.project_id,
      sprintId: created.sprint.id,
      title: task.title,
      description: descriptionParts.filter(Boolean).join("\n\n"),
      priority: task.priority ?? "P2",
      type: task.type ?? "feature",
      status: "to-do",
      assignee: task.assignee || undefined,
      eligibleAssignees: task.eligibleAssignees,
      labels: ["sprint-task"],
      executionEngine: task.executionEngine ?? sprintDraft.defaultExecutionEngine ?? parent.default_execution_engine ?? "hiverunner",
      modelLane: task.modelLane ?? sprintDraft.defaultModelLane ?? parent.default_model_lane ?? "default",
      createdBy: input.actorUserId ?? "operator",
    }).task;
    taskIds.push(createdTask.id);
    draftTaskIdToMaterializedTaskId.set(task.id, createdTask.id);
  }

  for (const task of materializedTaskDrafts) {
    const createdTaskId = draftTaskIdToMaterializedTaskId.get(task.id);
    if (!createdTaskId || !task.dependsOn?.length) continue;
    const resolvedDependsOn = task.dependsOn
      .map((dependency) => draftTaskIdToMaterializedTaskId.get(dependency) ?? null)
      .filter((dependency): dependency is string => Boolean(dependency))
      .filter((dependency) => dependency !== createdTaskId);
    db.prepare("UPDATE tasks SET depends_on_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(resolvedDependsOn), now, createdTaskId);
  }

  const sprintStartWakeCount = enqueueSprintApprovalRootTaskWakeups({
    db,
    companyId: companyRow.id,
    companyGoalId: parent.id,
    sprintId: created.sprint.id,
    taskIds,
    now,
  });

  db.prepare(
    `UPDATE goal_sprint_plan_drafts
     SET status = 'approved', sprint_json = ?, tasks_json = ?, approved_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(JSON.stringify(sprintDraft), JSON.stringify(materializedTaskDrafts), now, now, row.id);
  if (planningTask) {
    insertSprintPlanTaskEvent({
      db,
      eventType: "goal.sprint_plan_approved",
      projectId: planningTask.project_id,
      taskId: planningTask.id,
      userId: input.actorUserId ?? "operator",
      metadata: {
        draftId: row.id,
        proposalGroupId: row.proposal_group_id,
        sprintId: created.sprint.id,
        filledPrecreatedSprint: Boolean(precreatedSprint),
        sequenceNumber: row.sequence_number,
        taskCount: taskIds.length,
        sprintStartWakeCount,
      },
      now,
    });
  }
  recordSprintPlanReviewRetrospective({
    db,
    companyId: companyRow.id,
    projectId: parent.project_id,
    companyGoalId: parent.id,
    companyGoalName: parent.name,
    planningTask,
    agentId: row.proposed_by_agent_id,
    draftId: row.id,
    outcome: "approved",
    sprintDraft,
    taskDrafts: materializedTaskDrafts,
    parent,
    now,
  });
  closePlanningTaskAfterDraftApproval({
    db,
    planningTask,
    actorUserId: input.actorUserId ?? "operator",
    sprintId: created.sprint.id,
    taskCount: taskIds.length,
    now,
  });

  const updated = getSprintPlanDraftRow(row.id);
  if (!updated) throw new OrchestrationApiError(500, "sprint_plan_draft_load_failed", "Draft approved but could not be loaded");
  return {
    draft: sprintPlanDraftFromRow(updated),
    sprint: created,
    taskIds,
    ...(assigneeResolutionFailures.length > 0 ? { assigneeResolutionFailures } : {}),
  };
}

export function approveSprintPlanDraftGroup(input: {
  companyIdOrSlug: string;
  companyGoalId: string;
  draftId: string;
  actorUserId?: string;
}): {
  draft: OrchestrationSprintPlanDraft;
  drafts: OrchestrationSprintPlanDraft[];
  sprints: OrchestrationCompanyGoal[];
  sprint?: OrchestrationCompanyGoal;
  taskIds: string[];
  assigneeResolutionFailures?: Array<{ taskId: string; title: string; assignee: string }>;
} {
  const db = getOrchestrationDb();
  const companyRow = getCompanyRowByIdOrSlug(input.companyIdOrSlug);
  if (!companyRow) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  const anchor = getSprintPlanDraftRow(input.draftId);
  if (!anchor || anchor.company_id !== companyRow.id || anchor.company_goal_id !== input.companyGoalId) {
    throw new OrchestrationApiError(404, "sprint_plan_draft_not_found", "Draft not found");
  }
  if (anchor.status !== "pending") throw new OrchestrationApiError(400, "draft_not_pending", "Only pending drafts can be approved");
  if (parseDraftSprint(anchor.sprint_json).completionProposal) {
    throw new OrchestrationApiError(400, "completion_proposal_not_plan", "Goal completion proposals must be reviewed individually");
  }
  const groupKey = anchor.proposal_group_id ?? anchor.id;
  const rows = db
    .prepare(
      `SELECT id
       FROM goal_sprint_plan_drafts
       WHERE company_id = ?
         AND company_goal_id = ?
         AND status = 'pending'
         AND COALESCE(proposal_group_id, id) = ?
       ORDER BY sequence_number ASC, created_at ASC`
    )
    .all(companyRow.id, anchor.company_goal_id, groupKey) as Array<{ id: string }>;
  if (rows.length === 0) {
    throw new OrchestrationApiError(404, "sprint_plan_draft_not_found", "Draft group not found");
  }

  const approveAll = db.transaction(() => {
    const approvedDrafts: OrchestrationSprintPlanDraft[] = [];
    const approvedSprints: OrchestrationCompanyGoal[] = [];
    const taskIds: string[] = [];
    const assigneeResolutionFailures: Array<{ taskId: string; title: string; assignee: string }> = [];
    for (const row of rows) {
      const result = approveSprintPlanDraft({
        companyIdOrSlug: companyRow.id,
        companyGoalId: input.companyGoalId,
        draftId: row.id,
        actorUserId: input.actorUserId ?? "operator",
      });
      approvedDrafts.push(result.draft);
      approvedSprints.push(result.sprint);
      taskIds.push(...result.taskIds);
      if (result.assigneeResolutionFailures?.length) {
        assigneeResolutionFailures.push(...result.assigneeResolutionFailures);
      }
    }
    return {
      draft: approvedDrafts[0],
      drafts: approvedDrafts,
      sprints: approvedSprints,
      sprint: approvedSprints[0],
      taskIds,
      ...(assigneeResolutionFailures.length > 0 ? { assigneeResolutionFailures } : {}),
    };
  });

  return approveAll();
}
