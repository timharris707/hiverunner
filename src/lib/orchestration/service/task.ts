import { randomUUID } from "crypto";
import { syncTakeawayStatusFromTaskLifecycleAsync } from "@/lib/ideas-store";
import type { TaskModelLaneInput } from "@/lib/orchestration/contracts";
import { cancelRunningExecutionRunsForTask, type ExecutionRunTerminator } from "@/lib/orchestration/execution-run-cancellation";
import { normalizeTaskModelLane } from "@/lib/orchestration/task-model-routing";
import { resolveReviewProducerAssigneeId } from "@/lib/orchestration/service/review-assignment";

import {
  type OrchestrationTask,
  OrchestrationApiError,
  type DbTaskStatus,
  type TaskPriorityInput,
  type TaskRow,
  type TaskStatus,
  type TaskStatusInput,
  type TaskTypeInput,
  commentsForTasks,
  dependencySummariesForTaskRows,
  generateTaskKey,
  getOrchestrationDb,
  getProjectRow,
  getTaskRowForUpdate,
  nextColumnOrder,
  refreshAgentLoad,
  resolveAssigneeAgent,
  resolveCompanyId,
  resolveSingleEligibleAssignee,
  resolveTaskExecutionEngine,
  reconcileTaskHierarchy,
  isNonProductionTask,
  taskById,
  taskFromRow,
  toApiStatus,
  toDbPriority,
  toDbStatus,
  toDbType,
  validateTransition,
} from "./shared";

const GOAL_LEAD_REVISION_TRIGGER = "goal_lead_plan_revision";
const SPRINT_COMPLETED_PROPOSE_NEXT_TRIGGER = "sprint_completed_propose_next";

function ensureQueuedWakeupHeartbeatRun(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    runId: string | null;
    wakeupId: string;
    agentId: string;
    companyId: string;
    triggerDetail: string;
    payload: Record<string, unknown>;
    now: string;
    invocationSource?: "wakeup_request" | "issue_assigned";
    wakeSource?: string;
  }
): void {
  if (!input.runId) return;

  db.prepare(
    `INSERT OR IGNORE INTO heartbeat_runs
       (id, agent_id, company_id, invocation_source, trigger_detail, status, wakeup_request_id, context_snapshot_json, created_at, updated_at)
     VALUES
       (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
  ).run(
    input.runId,
    input.agentId,
    input.companyId,
    input.invocationSource ?? "wakeup_request",
    input.triggerDetail,
    input.wakeupId,
    JSON.stringify({
      wakeSource: input.wakeSource ?? "explicit",
      wakeReason: input.triggerDetail,
      ...input.payload,
    }),
    input.now,
    input.now,
  );
}

function parseDependencyIds(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
      : [];
  } catch {
    return [];
  }
}

function pendingDependencyCountForTask(
  db: ReturnType<typeof getOrchestrationDb>,
  dependencyIds: string[],
): number {
  if (dependencyIds.length === 0) return 0;
  const placeholders = dependencyIds.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM tasks
       WHERE id IN (${placeholders})
         AND archived_at IS NULL
         AND status != 'done'`,
    )
    .get(...dependencyIds) as { n: number } | undefined;
  return row?.n ?? 0;
}

function enqueueDependencyUnblockedAssignedTaskWake(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    companyId: string;
    projectId: string | null;
    taskId: string;
    taskKey: string | null;
    agentId: string;
    unblockedByTaskId: string;
    unblockedByStatus: DbTaskStatus;
    now: string;
  },
): void {
  const reason = "dependency_unblocked_assigned_task";
  const payload = {
    taskId: input.taskId,
    taskKey: input.taskKey ?? input.taskId,
    taskStatus: "to-do",
    projectId: input.projectId,
    unblockedByTaskId: input.unblockedByTaskId,
    unblockedByStatus: input.unblockedByStatus,
  };
  const idempotencyKey = `sweep:${input.taskId}:to-do`;
  const existing = db
    .prepare(
      `SELECT id, run_id
       FROM agent_wakeup_requests
       WHERE idempotency_key = ?
         AND status IN ('queued', 'claimed')
       LIMIT 1`,
    )
    .get(idempotencyKey) as { id: string; run_id: string | null } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE agent_wakeup_requests
       SET coalesced_count = coalesced_count + 1,
           updated_at = ?
       WHERE id = ?`,
    ).run(input.now, existing.id);
    ensureQueuedWakeupHeartbeatRun(db, {
      runId: existing.run_id,
      wakeupId: existing.id,
      agentId: input.agentId,
      companyId: input.companyId,
      triggerDetail: reason,
      payload,
      now: input.now,
      invocationSource: "issue_assigned",
      wakeSource: "issue_assigned",
    });
    return;
  }

  db.prepare(
    `UPDATE agent_wakeup_requests
     SET idempotency_key = NULL
     WHERE idempotency_key = ?
       AND status IN ('finished', 'failed', 'cancelled')`,
  ).run(idempotencyKey);

  const wakeupId = randomUUID();
  const runId = randomUUID();
  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json, status, idempotency_key, run_id, requested_at, created_at, updated_at)
     VALUES
       (?, ?, ?, 'issue_assigned', ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
  ).run(
    wakeupId,
    input.agentId,
    input.companyId,
    reason,
    reason,
    JSON.stringify(payload),
    idempotencyKey,
    runId,
    input.now,
    input.now,
    input.now,
  );

  ensureQueuedWakeupHeartbeatRun(db, {
    runId,
    wakeupId,
    agentId: input.agentId,
    companyId: input.companyId,
    triggerDetail: reason,
    payload,
    now: input.now,
    invocationSource: "issue_assigned",
    wakeSource: "issue_assigned",
  });
}

function enqueueWakesForNewlyRunnableDependents(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    completedTaskId: string;
    companyId: string | null;
    fromStatus: DbTaskStatus;
    toStatus: DbTaskStatus;
    now: string;
  },
): void {
  if (!input.companyId) return;
  if (input.fromStatus === input.toStatus) return;
  if (input.toStatus !== "done") return;

  const rows = db
    .prepare(
      `SELECT
         t.id,
         t.task_key,
         t.project_id,
         t.title,
         t.type,
         t.depends_on_json,
         t.assignee_agent_id,
         COALESCE(t.company_id, p.company_id) AS company_id,
         a.status AS agent_status,
         a.archived_at AS agent_archived_at
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       INNER JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE COALESCE(t.company_id, p.company_id) = ?
         AND t.archived_at IS NULL
         AND (t.project_id IS NULL OR p.archived_at IS NULL)
         AND c.archived_at IS NULL
         AND c.status = 'active'
         AND t.status = 'to-do'
         AND t.assignee_agent_id IS NOT NULL
         AND t.depends_on_json IS NOT NULL
         AND t.depends_on_json LIKE ?`,
    )
    .all(input.companyId, `%${input.completedTaskId}%`) as Array<{
      id: string;
      task_key: string | null;
      project_id: string | null;
      title: string;
      type: string | null;
      depends_on_json: string | null;
      assignee_agent_id: string;
      company_id: string;
      agent_status: string | null;
      agent_archived_at: string | null;
    }>;

  for (const row of rows) {
    if (row.agent_archived_at || row.agent_status === "paused" || row.agent_status === "offline") continue;
    const dependencyIds = parseDependencyIds(row.depends_on_json);
    if (!dependencyIds.includes(input.completedTaskId)) continue;
    if (pendingDependencyCountForTask(db, dependencyIds) > 0) continue;

    enqueueDependencyUnblockedAssignedTaskWake(db, {
      companyId: row.company_id,
      projectId: row.project_id,
      taskId: row.id,
      taskKey: row.task_key,
      agentId: row.assignee_agent_id,
      unblockedByTaskId: input.completedTaskId,
      unblockedByStatus: input.toStatus,
      now: input.now,
    });
  }
}

export function listTasks(filters: {
  companyIdOrSlug?: string;
  projectId?: string;
  assignee?: string;
  status?: TaskStatusInput;
  priority?: TaskPriorityInput;
  type?: TaskTypeInput;
  search?: string;
  sort?: "updated-desc" | "created-desc" | "priority-asc" | "priority-desc";
  sourceReviewId?: string;
  sourceTakeawayId?: string;
  includeArchived?: boolean;
  includeNonProduction?: boolean;
  limit?: number;
  ownerUserId?: string;
}): { tasks: OrchestrationTask[] } {
  const db = getOrchestrationDb();

  const includeArchived = filters.includeArchived ?? false;
  const includeNonProduction = filters.includeNonProduction ?? false;
  const whereParts = [
    includeArchived ? "1=1" : "t.archived_at IS NULL",
    "(t.project_id IS NULL OR p.archived_at IS NULL)",
  ];
  const args: unknown[] = [];

  if (filters.companyIdOrSlug) {
    const companyId = resolveCompanyId(db, filters.companyIdOrSlug, { ownerUserId: filters.ownerUserId });

    if (!companyId) {
      throw new OrchestrationApiError(404, "company_not_found", "Company not found");
    }

    whereParts.push("t.company_id = ?");
    args.push(companyId);
  } else if (filters.ownerUserId?.trim()) {
    whereParts.push("t.company_id IN (SELECT id FROM companies WHERE owner_user_id = ? AND archived_at IS NULL)");
    args.push(filters.ownerUserId.trim());
  }

  if (filters.projectId) {
    const project = getProjectRow(db, filters.projectId);
    if (!project) {
      throw new OrchestrationApiError(404, "project_not_found", "Project not found");
    }
    whereParts.push("t.project_id = ?");
    args.push(project.id);
  }

  if (filters.status) {
    whereParts.push("t.status = ?");
    args.push(toDbStatus(filters.status));
  }

  if (filters.assignee) {
    const normalized = filters.assignee.trim();
    if (normalized.toLowerCase() === "unassigned") {
      whereParts.push("t.assignee_agent_id IS NULL");
    } else {
      whereParts.push("(t.assignee_agent_id = ? OR lower(a.name) = lower(?))");
      args.push(normalized, normalized);
    }
  }

  if (filters.priority) {
    whereParts.push("t.priority = ?");
    args.push(toDbPriority(filters.priority));
  }

  if (filters.type) {
    whereParts.push("t.type = ?");
    args.push(toDbType(filters.type));
  }

  if (filters.sourceReviewId) {
    whereParts.push("t.source_review_id = ?");
    args.push(filters.sourceReviewId);
  }

  if (filters.sourceTakeawayId) {
    whereParts.push("t.source_takeaway_id = ?");
    args.push(filters.sourceTakeawayId);
  }

  if (filters.search) {
    whereParts.push(
      "lower(COALESCE(t.task_key, '') || ' ' || t.id || ' ' || t.title || ' ' || t.description || ' ' || COALESCE(a.name, '') || ' ' || COALESCE(p.name, '')) LIKE '%' || lower(?) || '%'"
    );
    args.push(filters.search);
  }

  const orderBy =
    filters.sort === "created-desc"
      ? "t.created_at DESC, t.id ASC"
      : filters.sort === "priority-asc"
        ? "CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC, t.updated_at DESC, t.id ASC"
        : filters.sort === "priority-desc"
          ? "CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END DESC, t.updated_at DESC, t.id ASC"
          : "t.updated_at DESC, t.created_at DESC, t.id ASC";

  const limit = typeof filters.limit === "number"
    ? Math.max(1, Math.min(500, Math.trunc(filters.limit)))
    : undefined;
  const limitSql = limit ? " LIMIT ?" : "";
  const queryArgs = limit ? [...args, limit] : args;

  const rows = db
    .prepare(
      `SELECT
        t.id,
        COALESCE(t.company_id, p.company_id) AS company_id,
        t.project_id,
        t.sprint_id,
        s.sprint_key,
        s.name AS sprint_name,
        s.status AS sprint_status,
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
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
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
       WHERE ${whereParts.join(" AND ")}
       ORDER BY ${orderBy}${limitSql}`
    )
    .all(...queryArgs) as TaskRow[];

  const commentMap = commentsForTasks(
    db,
    rows.map((row) => row.id),
    { latestPerTask: true }
  );
  const dependencyMap = dependencySummariesForTaskRows(db, rows);

  return {
    tasks: rows
      .filter((row) => {
        if (includeNonProduction) return true;
        return !isNonProductionTask({
          title: row.title,
          description: row.description,
          createdBy: row.created_by,
          labelsJson: row.labels_json,
        });
      })
      .map((row) => taskFromRow(row, commentMap.get(row.id) ?? [], dependencyMap.get(row.id))),
  };
}

export function getTask(taskId: string): { task: OrchestrationTask } {
  const db = getOrchestrationDb();
  return { task: taskById(db, taskId) };
}

function queueTakeawayLifecycleSync(input: { takeawayId: string; taskStatus: string }): void {
  setTimeout(() => {
    void syncTakeawayStatusFromTaskLifecycleAsync(input).catch((error) => {
      console.warn("[orchestration] async takeaway lifecycle sync failed", {
        takeawayId: input.takeawayId,
        taskStatus: input.taskStatus,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }, 0);
}

function resolveCreatorAgentId(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  createdBy: string
): string | null {
  const actor = createdBy.trim();
  if (!actor) return null;

  const row = db
    .prepare(
      `SELECT id
         FROM agents
        WHERE company_id = ?
          AND (id = ? OR slug = ? OR name = ?)
          AND archived_at IS NULL
        LIMIT 1`
    )
    .get(companyId, actor, actor, actor) as { id: string } | undefined;

  return row?.id ?? null;
}

function resolveCompanyForTaskCreate(
  db: ReturnType<typeof getOrchestrationDb>,
  input: { projectId?: string; companyIdOrSlug?: string }
): { id: string; project?: ReturnType<typeof getProjectRow> } {
  if (input.projectId) {
    const project = getProjectRow(db, input.projectId);
    if (!project) {
      throw new OrchestrationApiError(404, "project_not_found", "Project not found");
    }
    if (!project.company_id) {
      throw new OrchestrationApiError(500, "project_company_missing", "Project is missing a company owner");
    }
    return { id: project.company_id, project };
  }

  const companyRef = input.companyIdOrSlug?.trim();
  if (!companyRef) {
    throw new OrchestrationApiError(400, "company_required", "company is required when projectId is not set");
  }

  const company = db
    .prepare(
      `SELECT id
       FROM companies
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ? OR company_code = ?)
       LIMIT 1`
    )
    .get(companyRef, companyRef, companyRef.toUpperCase()) as { id: string } | undefined;

  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }

  return { id: company.id };
}

function ensureNoProjectBucket(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string
): NonNullable<ReturnType<typeof getProjectRow>> {
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
    .get(companyId, `no-project-${companyId.slice(0, 8)}`, `no-project-${companyId.slice(0, 8)}`) as { id: string } | undefined;

  if (existing) {
    const row = getProjectRow(db, existing.id);
    if (row) return row;
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const slug = `no-project-${companyId.slice(0, 8)}`;
  db.prepare(
    `INSERT INTO projects (id, company_id, slug, name, description, color, status, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, 'No project', 'Company-level issue bucket.', '#737373', 'active', ?, ?, ?)`
  ).run(id, companyId, slug, JSON.stringify({ emoji: "" }), now, now);

  const row = getProjectRow(db, id);
  if (!row) {
    throw new OrchestrationApiError(500, "no_project_bucket_failed", "Could not create No project bucket");
  }
  return row;
}

function resolveAssigneeAgentForCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  assignee: string
): { id: string; name: string } | undefined {
  const normalized = assignee.trim();
  if (!normalized) return undefined;

  return db
    .prepare(
      `SELECT id, name
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (id = ? OR lower(name) = lower(?))
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC, created_at ASC
       LIMIT 1`
    )
    .get(companyId, normalized, normalized, normalized) as { id: string; name: string } | undefined;
}

function resolveEligibleAssigneeIdsForCompany(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  assignees: string[] | undefined,
  primaryAssigneeId?: string | null,
): string[] {
  const ids: string[] = [];
  const push = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(primaryAssigneeId);
  for (const assignee of assignees ?? []) {
    const resolved = resolveAssigneeAgentForCompany(db, companyId, assignee);
    push(resolved?.id ?? null);
  }
  return ids;
}

function enqueueGoalLeadRevisionWake(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    companyId: string;
    agentId: string;
    companyGoalId: string;
    taskId: string;
    taskKey: string;
    completedSprintId: string;
  }
): void {
  const now = new Date().toISOString();
  const wakeupId = randomUUID();
  const runId = randomUUID();
  const payload = {
    wakeReason: GOAL_LEAD_REVISION_TRIGGER,
    companyGoalId: input.companyGoalId,
    completedSprintId: input.completedSprintId,
    taskId: input.taskId,
    taskKey: input.taskKey,
  };
  const idempotencyKey = `${GOAL_LEAD_REVISION_TRIGGER}:${input.companyGoalId}:${input.completedSprintId}:${input.agentId}`;
  const existing = db
    .prepare(
      `SELECT id, run_id
       FROM agent_wakeup_requests
       WHERE idempotency_key = ?
         AND status = 'queued'
       LIMIT 1`
    )
    .get(idempotencyKey) as { id: string; run_id: string | null } | undefined;
  if (existing) {
    ensureQueuedWakeupHeartbeatRun(db, {
      runId: existing.run_id,
      wakeupId: existing.id,
      agentId: input.agentId,
      companyId: input.companyId,
      triggerDetail: GOAL_LEAD_REVISION_TRIGGER,
      payload,
      now,
    });
    return;
  }

  db.prepare(
    `UPDATE agent_wakeup_requests
     SET idempotency_key = NULL
     WHERE idempotency_key = ?
       AND status IN ('finished', 'failed', 'claimed')`
  ).run(idempotencyKey);

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json, status, idempotency_key, run_id, requested_at, requested_by_actor_type, requested_by_actor_id, created_at, updated_at)
     VALUES
       (?, ?, ?, 'explicit', ?, ?, ?, 'queued', ?, ?, ?, 'system', 'system', ?, ?)`
  ).run(
    wakeupId,
    input.agentId,
    input.companyId,
    GOAL_LEAD_REVISION_TRIGGER,
    GOAL_LEAD_REVISION_TRIGGER,
    JSON.stringify(payload),
    idempotencyKey,
    runId,
    now,
    now,
    now,
  );

  ensureQueuedWakeupHeartbeatRun(db, {
    runId,
    wakeupId,
    agentId: input.agentId,
    companyId: input.companyId,
    triggerDetail: GOAL_LEAD_REVISION_TRIGGER,
    payload,
    now,
  });
}

function maybeCreateGoalLeadRevisionTask(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    sprintId: string;
    projectId: string;
    now: string;
  }
): void {
  const context = db
    .prepare(
      `SELECT
         child.id AS sprint_id,
         child.name AS sprint_name,
         child.goal AS sprint_goal,
         parent.id AS goal_id,
         parent.name AS goal_name,
         parent.goal AS goal_objective,
         parent.stop_condition AS goal_stop_condition,
         parent.lead_agent_id,
         parent.default_execution_engine,
         parent.default_model_lane,
         c.id AS company_id
       FROM sprints child
       INNER JOIN sprints parent ON parent.id = child.parent_id
       INNER JOIN projects p ON p.id = child.project_id
       INNER JOIN companies c ON c.id = p.company_id
       WHERE child.id = ?
       LIMIT 1`
    )
    .get(input.sprintId) as {
      sprint_id: string;
      sprint_name: string;
      sprint_goal: string | null;
      goal_id: string;
      goal_name: string;
      goal_objective: string | null;
      goal_stop_condition: string | null;
      lead_agent_id: string | null;
      default_execution_engine: "hiverunner" | "symphony" | "manual" | null;
      default_model_lane: "default" | "fast" | "mini" | "deep" | null;
      company_id: string;
    } | undefined;
  if (!context?.lead_agent_id) return;

  const pendingDrafts = db
    .prepare(
      `SELECT sequence_number, sprint_json, tasks_json
       FROM goal_sprint_plan_drafts
       WHERE company_goal_id = ?
         AND status = 'pending'
       ORDER BY sequence_number ASC`
    )
    .all(context.goal_id) as Array<{ sequence_number: number; sprint_json: string; tasks_json: string }>;
  if (pendingDrafts.length === 0) return;

  const existing = db
    .prepare(
      `SELECT id, task_key
       FROM tasks
       WHERE sprint_id = ?
         AND assignee_agent_id = ?
         AND title = ?
         AND archived_at IS NULL
         AND status NOT IN ('done','cancelled')
       LIMIT 1`
    )
    .get(
      context.goal_id,
      context.lead_agent_id,
      `Review and refine remaining plan for ${context.goal_name}`,
    ) as { id: string; task_key: string | null } | undefined;
  if (existing) {
    enqueueGoalLeadRevisionWake(db, {
      companyId: context.company_id,
      agentId: context.lead_agent_id,
      companyGoalId: context.goal_id,
      completedSprintId: context.sprint_id,
      taskId: existing.id,
      taskKey: existing.task_key ?? existing.id,
    });
    return;
  }

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tasks
       WHERE sprint_id = ?
         AND archived_at IS NULL`
    )
    .get(context.sprint_id) as { total: number; done: number | null };
  const recentNotes = db
    .prepare(
      `SELECT body
       FROM comments
       WHERE task_id IN (SELECT id FROM tasks WHERE sprint_id = ? AND archived_at IS NULL)
       ORDER BY created_at DESC
       LIMIT 5`
    )
    .all(context.sprint_id) as Array<{ body: string }>;
  const pendingLines = pendingDrafts.map((draft) => {
    let name = `Sprint ${draft.sequence_number}`;
    try {
      const sprint = JSON.parse(draft.sprint_json) as { name?: string };
      if (sprint.name) name = sprint.name;
    } catch {}
    let taskCount = 0;
    try {
      const tasks = JSON.parse(draft.tasks_json);
      taskCount = Array.isArray(tasks) ? tasks.length : 0;
    } catch {}
    return `- Sprint ${draft.sequence_number}: ${name} (${taskCount} proposed tasks)`;
  });

  const description = [
    `Review and refine the remaining plan for company goal: ${context.goal_name}.`,
    context.goal_objective ? `Goal objective: ${context.goal_objective}` : "",
    context.goal_stop_condition ? `Goal stop condition: ${context.goal_stop_condition}` : "",
    `Just-completed sprint: ${context.sprint_name}.`,
    context.sprint_goal ? `Completed sprint objective: ${context.sprint_goal}` : "",
    `Actual outcome: ${Number(counts.done ?? 0)}/${Number(counts.total ?? 0)} tasks done.`,
    recentNotes.length ? `Recent execution notes:\n${recentNotes.map((note) => `- ${note.body.slice(0, 500)}`).join("\n")}` : "",
    `Remaining pending drafts:\n${pendingLines.join("\n")}`,
    "Instruction: refine the remaining plan based on what the completed sprint revealed. You may emit propose_sprint_plan to replace pending drafts, or emit mark_goal_complete if no remaining work is needed. Do not create execution tasks directly.",
  ].filter(Boolean).join("\n\n");

  const created = createTask({
    companyIdOrSlug: context.company_id,
    projectId: input.projectId,
    sprintId: context.goal_id,
    title: `Review and refine remaining plan for ${context.goal_name}`,
    description,
    priority: "P0",
    type: "research",
    status: "to-do",
    assignee: context.lead_agent_id,
    labels: ["goal-contract", "plan-revision"],
    executionEngine: context.default_execution_engine ?? "hiverunner",
    modelLane: context.default_model_lane ?? "default",
    createdBy: "system",
  }).task;

  enqueueGoalLeadRevisionWake(db, {
    companyId: context.company_id,
    agentId: context.lead_agent_id,
    companyGoalId: context.goal_id,
    completedSprintId: context.sprint_id,
    taskId: created.id,
    taskKey: created.key ?? created.id,
  });
}

function enqueueSprintCompletedNextWake(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    companyId: string;
    agentId: string;
    companyGoalId: string;
    completedSprintId: string;
    taskId: string;
    taskKey: string;
  }
): void {
  const now = new Date().toISOString();
  const wakeupId = randomUUID();
  const runId = randomUUID();
  const payload = {
    wakeReason: SPRINT_COMPLETED_PROPOSE_NEXT_TRIGGER,
    companyGoalId: input.companyGoalId,
    completedSprintId: input.completedSprintId,
    taskId: input.taskId,
    taskKey: input.taskKey,
  };
  const idempotencyKey = `${SPRINT_COMPLETED_PROPOSE_NEXT_TRIGGER}:${input.companyGoalId}:${input.completedSprintId}:${input.agentId}`;
  const existing = db
    .prepare(
      `SELECT id, run_id, status
       FROM agent_wakeup_requests
       WHERE idempotency_key = ?
         AND status IN ('queued', 'claimed')
       LIMIT 1`
    )
    .get(idempotencyKey) as { id: string; run_id: string | null; status: string } | undefined;
  if (existing) {
    if (existing.status === "queued") {
      ensureQueuedWakeupHeartbeatRun(db, {
        runId: existing.run_id,
        wakeupId: existing.id,
        agentId: input.agentId,
        companyId: input.companyId,
        triggerDetail: SPRINT_COMPLETED_PROPOSE_NEXT_TRIGGER,
        payload,
        now,
      });
    }
    return;
  }

  db.prepare(
    `INSERT INTO agent_wakeup_requests
       (id, agent_id, company_id, source, reason, trigger_detail, payload_json, status, idempotency_key, run_id, requested_at, requested_by_actor_type, requested_by_actor_id, created_at, updated_at)
     VALUES
       (?, ?, ?, 'explicit', ?, ?, ?, 'queued', ?, ?, ?, 'system', 'system', ?, ?)`
  ).run(
    wakeupId,
    input.agentId,
    input.companyId,
    SPRINT_COMPLETED_PROPOSE_NEXT_TRIGGER,
    SPRINT_COMPLETED_PROPOSE_NEXT_TRIGGER,
    JSON.stringify(payload),
    idempotencyKey,
    runId,
    now,
    now,
    now,
  );

  ensureQueuedWakeupHeartbeatRun(db, {
    runId,
    wakeupId,
    agentId: input.agentId,
    companyId: input.companyId,
    triggerDetail: SPRINT_COMPLETED_PROPOSE_NEXT_TRIGGER,
    payload,
    now,
  });
}

function maybeCreateSprintCompletedNextPlanTask(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    sprintId: string;
    projectId: string;
    now: string;
  }
): void {
  const context = db
    .prepare(
      `SELECT
         child.id AS sprint_id,
         child.name AS sprint_name,
         parent.id AS goal_id,
         parent.name AS goal_name,
         parent.goal AS goal_objective,
         parent.status AS goal_status,
         parent.lead_agent_id,
         parent.auto_progression,
         parent.default_execution_engine,
         parent.default_model_lane,
         c.id AS company_id
       FROM sprints child
       INNER JOIN sprints parent ON parent.id = child.parent_id
       INNER JOIN projects p ON p.id = child.project_id
       INNER JOIN companies c ON c.id = p.company_id
       WHERE child.id = ?
       LIMIT 1`
    )
    .get(input.sprintId) as {
      sprint_id: string;
      sprint_name: string;
      goal_id: string;
      goal_name: string;
      goal_objective: string | null;
      goal_status: string;
      lead_agent_id: string | null;
      auto_progression: number;
      default_execution_engine: "hiverunner" | "symphony" | "manual" | null;
      default_model_lane: "default" | "fast" | "mini" | "deep" | null;
      company_id: string;
    } | undefined;
  if (!context?.lead_agent_id) return;
  if (Number(context.auto_progression ?? 0) !== 1 || context.goal_status !== "active") return;

  const inFlightSibling = db
    .prepare(
      `SELECT 1
       FROM sprints
       WHERE parent_id = ?
         AND id <> ?
         AND status IN ('planning', 'active')
       LIMIT 1`
    )
    .get(context.goal_id, context.sprint_id);
  if (inFlightSibling) return;

  const title = `Plan next sprint for ${context.goal_name}`;
  const existing = db
    .prepare(
      `SELECT id, task_key
       FROM tasks
       WHERE sprint_id = ?
         AND assignee_agent_id = ?
         AND title = ?
         AND archived_at IS NULL
         AND status NOT IN ('done','cancelled')
       LIMIT 1`
    )
    .get(context.goal_id, context.lead_agent_id, title) as { id: string; task_key: string | null } | undefined;
  if (existing) {
    enqueueSprintCompletedNextWake(db, {
      companyId: context.company_id,
      agentId: context.lead_agent_id,
      companyGoalId: context.goal_id,
      completedSprintId: context.sprint_id,
      taskId: existing.id,
      taskKey: existing.task_key ?? existing.id,
    });
    return;
  }

  const created = createTask({
    companyIdOrSlug: context.company_id,
    projectId: input.projectId,
    sprintId: context.goal_id,
    title,
    description: [
      `The sprint "${context.sprint_name}" completed under company goal "${context.goal_name}".`,
      context.goal_objective ? `Goal objective: ${context.goal_objective}` : "",
      "Auto-progression is enabled. Propose the NEXT sprint only, using propose_sprint_plan. Do not re-plan completed work and do not create execution tasks directly.",
    ].filter(Boolean).join("\n\n"),
    priority: "P0",
    type: "research",
    status: "to-do",
    assignee: context.lead_agent_id,
    labels: ["goal-contract", "sprint-planning", "auto-progression"],
    executionEngine: context.default_execution_engine ?? "hiverunner",
    modelLane: context.default_model_lane ?? "default",
    createdBy: "system",
  }).task;

  enqueueSprintCompletedNextWake(db, {
    companyId: context.company_id,
    agentId: context.lead_agent_id,
    companyGoalId: context.goal_id,
    completedSprintId: context.sprint_id,
    taskId: created.id,
    taskKey: created.key ?? created.id,
  });
}

function maybeAutoCompleteSprintAfterTaskDone(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    sprintId: string | null;
    projectId: string | null;
    taskId: string;
    actorUserId?: string;
    now: string;
  }
): void {
  if (!input.sprintId || !input.projectId) return;

  const sprint = db
    .prepare("SELECT id, status, completed_at FROM sprints WHERE id = ? LIMIT 1")
    .get(input.sprintId) as { id: string; status: string; completed_at: string | null } | undefined;
  if (!sprint || sprint.status !== "active") return;

  const counts = db
    .prepare(
      `SELECT
        COUNT(*) AS task_count,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done_count
       FROM tasks
       WHERE sprint_id = ?
         AND archived_at IS NULL`
    )
    .get(input.sprintId) as { task_count: number; done_count: number | null };

  const taskCount = Number(counts.task_count ?? 0);
  const doneCount = Number(counts.done_count ?? 0);
  if (taskCount === 0 || doneCount !== taskCount) return;

  const result = db
    .prepare(
      `UPDATE sprints
       SET status = 'completed',
           completed_at = COALESCE(completed_at, ?),
           updated_at = ?
       WHERE id = ?
         AND status = 'active'`
    )
    .run(input.now, input.now, input.sprintId);

  if (result.changes === 0) return;

  maybeCreateGoalLeadRevisionTask(db, {
    sprintId: input.sprintId,
    projectId: input.projectId,
    now: input.now,
  });
  maybeCreateSprintCompletedNextPlanTask(db, {
    sprintId: input.sprintId,
    projectId: input.projectId,
    now: input.now,
  });

  db.prepare(
    `INSERT INTO task_events
      (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
     VALUES
      (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    input.projectId,
    input.taskId,
    input.actorUserId ?? "api",
    "sprint.auto_completed",
    "active",
    "completed",
    JSON.stringify({ sprintId: input.sprintId, taskCount, doneCount }),
    input.now
  );
}

export function maybeAutoCompleteSprintForTaskDone(
  db: ReturnType<typeof getOrchestrationDb>,
  input: {
    sprintId: string | null;
    projectId: string | null;
    taskId: string;
    actorUserId?: string;
    now: string;
  }
): void {
  maybeAutoCompleteSprintAfterTaskDone(db, input);
}

export function createTask(input: {
  companyIdOrSlug?: string;
  projectId?: string;
  title: string;
  description: string;
  priority: TaskPriorityInput;
  type: TaskTypeInput;
  status: TaskStatusInput;
  assignee?: string;
  eligibleAssignees?: string[];
  dueDate?: string;
  sprintId?: string;
  parentTaskId?: string;
  labels: string[];
  blockedReason?: string;
  executionEngine?: "hiverunner" | "symphony" | "manual" | null;
  executionRuntimeProvider?: string | null;
  executionRuntimeLabel?: string | null;
  executionModelRouting?: string | null;
  executionModelRoutingLabel?: string | null;
  modelLane?: TaskModelLaneInput | null;
  createdBy: string;
  columnOrder?: number;
  sourceReviewId?: string;
  sourceTakeawayId?: string;
}): { task: OrchestrationTask } {
  const db = getOrchestrationDb();

  const resolved = resolveCompanyForTaskCreate(db, {
    projectId: input.projectId,
    companyIdOrSlug: input.companyIdOrSlug,
  });
  const project = resolved.project ?? ensureNoProjectBucket(db, resolved.id);
  const projectId = project.id;
  const status = toDbStatus(input.status);
  const assignee = input.assignee
    ? resolveAssigneeAgentForCompany(db, resolved.id, input.assignee)
    : undefined;
  const eligibleAssigneeIds = resolveEligibleAssigneeIdsForCompany(
    db,
    resolved.id,
    input.eligibleAssignees,
    assignee?.id ?? null,
  );
  const creatorAgentId = resolveCreatorAgentId(db, resolved.id, input.createdBy);

  if (input.assignee && !assignee) {
    throw new OrchestrationApiError(400, "invalid_assignee", "Assignee must be a company agent");
  }

  const now = new Date().toISOString();
  const taskId = randomUUID();
  const columnOrder = input.columnOrder ?? nextColumnOrder(db, projectId, status, resolved.id);
  const { taskNumber, taskKey } = generateTaskKey(db, projectId);
  const parentDefaults = input.parentTaskId
    ? db
      .prepare(
        `SELECT
          execution_engine,
          execution_runtime_provider,
          execution_runtime_label,
          execution_model_routing,
          execution_model_routing_label,
          COALESCE(model_lane, 'default') AS model_lane
         FROM tasks
         WHERE id = ? AND project_id = ? AND archived_at IS NULL
         LIMIT 1`
      )
      .get(input.parentTaskId, projectId) as {
        execution_engine: "hiverunner" | "symphony" | "manual" | null;
        execution_runtime_provider: string | null;
        execution_runtime_label: string | null;
        execution_model_routing: string | null;
        execution_model_routing_label: string | null;
        model_lane: TaskModelLaneInput | null;
      } | undefined
    : undefined;
  if (input.parentTaskId && !parentDefaults) {
    throw new OrchestrationApiError(400, "invalid_parent_task", "parentTaskId must belong to the same project and be active");
  }
  const defaultsRow = db
    .prepare(
      `SELECT p.settings_json AS project_settings_json,
              c.settings_json AS company_settings_json
       FROM projects p
       INNER JOIN companies c ON c.id = p.company_id
       WHERE p.id = ? AND p.archived_at IS NULL AND c.archived_at IS NULL
       LIMIT 1`,
    )
    .get(projectId) as { project_settings_json: string | null; company_settings_json: string | null } | undefined;
  const defaultExecutionEngine = resolveTaskExecutionEngine({
    projectSettingsJson: defaultsRow?.project_settings_json,
    companySettingsJson: defaultsRow?.company_settings_json,
  }).engine;
  const parentExecutionEngine =
    parentDefaults?.execution_engine && parentDefaults.execution_engine !== "manual"
      ? parentDefaults.execution_engine
      : null;
  const executionEngine = Object.prototype.hasOwnProperty.call(input, "executionEngine")
    ? input.executionEngine ?? parentExecutionEngine ?? defaultExecutionEngine
    : parentExecutionEngine ?? defaultExecutionEngine;
  const modelLane = Object.prototype.hasOwnProperty.call(input, "modelLane")
    ? normalizeTaskModelLane(input.modelLane)
    : normalizeTaskModelLane(parentDefaults?.model_lane ?? "default");
  const executionRuntimeProvider = Object.prototype.hasOwnProperty.call(input, "executionRuntimeProvider")
    ? input.executionRuntimeProvider?.trim() || null
    : parentDefaults?.execution_runtime_provider ?? null;
  const executionRuntimeLabel = Object.prototype.hasOwnProperty.call(input, "executionRuntimeLabel")
    ? input.executionRuntimeLabel?.trim() || null
    : parentDefaults?.execution_runtime_label ?? null;
  const executionModelRouting = Object.prototype.hasOwnProperty.call(input, "executionModelRouting")
    ? input.executionModelRouting?.trim() || null
    : parentDefaults?.execution_model_routing ?? null;
  const executionModelRoutingLabel = Object.prototype.hasOwnProperty.call(input, "executionModelRoutingLabel")
    ? input.executionModelRoutingLabel?.trim() || null
    : parentDefaults?.execution_model_routing_label ?? null;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks
        (id, company_id, project_id, sprint_id, parent_task_id, title, description, priority, type, status, column_order,
        assignee_agent_id, assigned_at, created_by, labels_json, eligible_assignee_ids, blocked_reason, execution_engine, execution_runtime_provider, execution_runtime_label,
         execution_model_routing, execution_model_routing_label, model_lane, source_review_id, source_takeaway_id, started_at, completed_at,
         due_date, task_number, task_key, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      resolved.id,
      projectId,
      input.sprintId ?? null,
      input.parentTaskId ?? null,
      input.title,
      input.description,
      toDbPriority(input.priority),
      toDbType(input.type),
      status,
      columnOrder,
      assignee?.id ?? null,
      assignee ? now : null,
      input.createdBy,
      JSON.stringify(input.labels),
      JSON.stringify(eligibleAssigneeIds),
      status === "blocked" ? input.blockedReason ?? "Blocked" : null,
      executionEngine,
      executionRuntimeProvider,
      executionRuntimeLabel,
      executionModelRouting,
      executionModelRoutingLabel,
      modelLane,
      input.sourceReviewId ?? null,
      input.sourceTakeawayId ?? null,
      status === "in_progress" ? now : null,
      status === "done" ? now : null,
      input.dueDate ?? null,
      taskNumber,
      taskKey,
      now,
      now
    );

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      projectId,
      taskId,
      creatorAgentId,
      input.createdBy,
      "task.created",
      null,
      status,
      JSON.stringify({
        labels: input.labels,
        eligibleAssigneeIds,
        executionEngine,
        executionEngineInheritedFromParent: input.executionEngine === undefined && Boolean(parentExecutionEngine),
        executionRuntimeProvider,
        executionRuntimeProviderInheritedFromParent: input.executionRuntimeProvider === undefined && Boolean(parentDefaults?.execution_runtime_provider),
        executionModelRouting,
        executionModelRoutingInheritedFromParent: input.executionModelRouting === undefined && Boolean(parentDefaults?.execution_model_routing),
        modelLane,
        modelLaneInheritedFromParent: input.modelLane === undefined && Boolean(parentDefaults?.model_lane),
      }),
      now
    );

    if (assignee?.id) {
      refreshAgentLoad(db, assignee.id);
    }

    if (projectId) {
      db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    }

    reconcileTaskHierarchy(db, {
      touchedParentTaskIds: [input.parentTaskId ?? null],
      touchedSprintIds: [input.sprintId ?? null],
      now,
    });
  });

  tx();

  return { task: taskById(db, taskId) };
}

export function updateTask(input: {
  taskId: string;
  title?: string;
  description?: string;
  priority?: TaskPriorityInput;
  projectId?: string | null;
  type?: TaskTypeInput;
  eligibleAssignees?: string[] | null;
  sprintId?: string | null;
  parentTaskId?: string | null;
  labels?: string[];
  blockedReason?: string | null;
  executionEngine?: "hiverunner" | "symphony" | "manual" | null;
  executionRuntimeProvider?: string | null;
  executionRuntimeLabel?: string | null;
  executionModelRouting?: string | null;
  executionModelRoutingLabel?: string | null;
  modelLane?: TaskModelLaneInput | null;
  reviewNotes?: string | null;
  actorUserId?: string;
}): { task: OrchestrationTask } {
  const db = getOrchestrationDb();
  const current = getTaskRowForUpdate(db, input.taskId);
  if (!current) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  let nextProjectId = current.project_id;
  if (input.projectId !== undefined) {
    if (input.projectId === null) {
      nextProjectId = null;
    } else {
      const project = getProjectRow(db, input.projectId);
      if (!project) {
        throw new OrchestrationApiError(400, "invalid_project", "projectId must reference an active project");
      }
      if (current.company_id && project.company_id && project.company_id !== current.company_id) {
        throw new OrchestrationApiError(400, "invalid_project", "projectId must belong to the same company as the task");
      }
      nextProjectId = project.id;
    }
  }
  const projectChanged = input.projectId !== undefined && nextProjectId !== current.project_id;

  let nextSprintId = current.sprint_id;
  if (projectChanged && input.sprintId === undefined) {
    nextSprintId = null;
  }
  if (input.sprintId !== undefined) {
    if (input.sprintId === null) {
      nextSprintId = null;
    } else {
      if (!nextProjectId) {
        throw new OrchestrationApiError(400, "invalid_sprint", "sprintId requires a project");
      }
      const sprint = db
        .prepare("SELECT id FROM sprints WHERE id = ? AND project_id = ? LIMIT 1")
        .get(input.sprintId, nextProjectId) as { id: string } | undefined;
      if (!sprint) {
        throw new OrchestrationApiError(
          400,
          "invalid_sprint",
          "sprintId must belong to the same project as the task"
        );
      }
      nextSprintId = sprint.id;
    }
  }

  let nextParentTaskId = current.parent_task_id;
  if (projectChanged && input.parentTaskId === undefined) {
    nextParentTaskId = null;
  }
  if (input.parentTaskId !== undefined) {
    if (input.parentTaskId === null) {
      nextParentTaskId = null;
    } else {
      if (!nextProjectId) {
        throw new OrchestrationApiError(400, "invalid_parent_task", "parentTaskId requires a project");
      }
      if (input.parentTaskId === current.id) {
        throw new OrchestrationApiError(400, "invalid_parent_task", "parentTaskId cannot reference the task itself");
      }

      const parentTask = db
        .prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL LIMIT 1")
        .get(input.parentTaskId, nextProjectId) as { id: string } | undefined;
      if (!parentTask) {
        throw new OrchestrationApiError(
          400,
          "invalid_parent_task",
          "parentTaskId must belong to the same project and be active"
        );
      }

      nextParentTaskId = parentTask.id;
    }
  }

  const nextTitle = input.title ?? current.title;
  const nextDescription = input.description ?? current.description;
  const nextPriority = input.priority ? toDbPriority(input.priority) : current.priority;
  const nextType = input.type ? toDbType(input.type) : current.type;
  const nextLabelsJson =
    input.labels !== undefined ? JSON.stringify(input.labels) : current.labels_json;
  const nextEligibleAssigneeIds: string[] | undefined = input.eligibleAssignees !== undefined
    ? resolveEligibleAssigneeIdsForCompany(
        db,
        current.company_id ?? "",
        input.eligibleAssignees ?? [],
        current.assignee_agent_id,
      )
    : undefined;
  const nextBlockedReason =
    input.blockedReason === undefined ? current.blocked_reason : input.blockedReason;
  const nextReviewNotes =
    input.reviewNotes === undefined ? current.review_notes : input.reviewNotes;
  const nextExecutionEngine = Object.prototype.hasOwnProperty.call(input, "executionEngine")
    ? input.executionEngine ?? null
    : current.execution_engine;
  const nextExecutionRuntimeProvider = Object.prototype.hasOwnProperty.call(input, "executionRuntimeProvider")
    ? input.executionRuntimeProvider?.trim() || null
    : current.execution_runtime_provider;
  const nextExecutionRuntimeLabel = Object.prototype.hasOwnProperty.call(input, "executionRuntimeLabel")
    ? input.executionRuntimeLabel?.trim() || null
    : current.execution_runtime_label;
  const nextExecutionModelRouting = Object.prototype.hasOwnProperty.call(input, "executionModelRouting")
    ? input.executionModelRouting?.trim() || null
    : current.execution_model_routing;
  const nextExecutionModelRoutingLabel = Object.prototype.hasOwnProperty.call(input, "executionModelRoutingLabel")
    ? input.executionModelRoutingLabel?.trim() || null
    : current.execution_model_routing_label;
  const nextModelLane = Object.prototype.hasOwnProperty.call(input, "modelLane")
    ? input.modelLane ?? "default"
    : current.model_lane;
  const nextTaskColumnOrder = projectChanged
    ? nextColumnOrder(db, nextProjectId, current.status, current.company_id)
    : current.column_order;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET
        title = ?,
        description = ?,
        priority = ?,
        project_id = ?,
        type = ?,
        sprint_id = ?,
        parent_task_id = ?,
        column_order = ?,
        labels_json = ?,
        eligible_assignee_ids = COALESCE(?, eligible_assignee_ids),
        blocked_reason = ?,
        review_notes = ?,
        execution_engine = ?,
        execution_runtime_provider = ?,
        execution_runtime_label = ?,
        execution_model_routing = ?,
        execution_model_routing_label = ?,
        model_lane = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      nextTitle,
      nextDescription,
      nextPriority,
      nextProjectId,
      nextType,
      nextSprintId,
      nextParentTaskId,
      nextTaskColumnOrder,
      nextLabelsJson,
      nextEligibleAssigneeIds !== undefined ? JSON.stringify(nextEligibleAssigneeIds) : null,
      nextBlockedReason,
      nextReviewNotes,
      nextExecutionEngine,
      nextExecutionRuntimeProvider,
      nextExecutionRuntimeLabel,
      nextExecutionModelRouting,
      nextExecutionModelRoutingLabel,
      nextModelLane,
      now,
      current.id
    );

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      nextProjectId,
      current.id,
      current.assignee_agent_id,
      input.actorUserId ?? "api",
      "task.updated",
      current.status,
      current.status,
      JSON.stringify({
        titleChanged: input.title !== undefined,
        descriptionChanged: input.description !== undefined,
        priorityChanged: input.priority !== undefined,
        projectChanged,
        typeChanged: input.type !== undefined,
        sprintChanged: input.sprintId !== undefined,
        parentTaskChanged: input.parentTaskId !== undefined,
        labelsChanged: input.labels !== undefined,
        eligibleAssigneesChanged: input.eligibleAssignees !== undefined,
        blockedReasonChanged: input.blockedReason !== undefined,
        executionEngineChanged: input.executionEngine !== undefined,
        executionRuntimeProviderChanged: input.executionRuntimeProvider !== undefined,
        executionRuntimeLabelChanged: input.executionRuntimeLabel !== undefined,
        executionModelRoutingChanged: input.executionModelRouting !== undefined,
        executionModelRoutingLabelChanged: input.executionModelRoutingLabel !== undefined,
        modelLaneChanged: input.modelLane !== undefined,
        reviewNotesChanged: input.reviewNotes !== undefined,
      }),
      now
    );

    if (current.project_id) {
      db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);
    }
    if (nextProjectId && nextProjectId !== current.project_id) {
      db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, nextProjectId);
    }

    reconcileTaskHierarchy(db, {
      touchedParentTaskIds: [current.parent_task_id, nextParentTaskId],
      touchedSprintIds: [current.sprint_id, nextSprintId],
      now,
    });
  });

  tx();

  if (current.source_takeaway_id) {
    queueTakeawayLifecycleSync({
      takeawayId: current.source_takeaway_id,
      taskStatus: current.status,
    });
  }

  return { task: taskById(db, input.taskId) };
}

export function archiveTask(input: {
  taskId: string;
  actorUserId?: string;
}): {
  taskId: string;
  archivedAt: string;
} {
  const db = getOrchestrationDb();
  const current = getTaskRowForUpdate(db, input.taskId);
  if (!current) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const archivedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET parent_task_id = NULL, updated_at = ?
       WHERE parent_task_id = ? AND archived_at IS NULL`
    ).run(archivedAt, current.id);

    db.prepare(
      `UPDATE tasks
       SET archived_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(archivedAt, archivedAt, current.id);

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      current.project_id,
      current.id,
      current.assignee_agent_id,
      input.actorUserId ?? "api",
      "task.archived",
      current.status,
      current.status,
      JSON.stringify({ archivedAt }),
      archivedAt
    );

    if (current.assignee_agent_id) {
      refreshAgentLoad(db, current.assignee_agent_id);
    }

    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(archivedAt, current.project_id);

    reconcileTaskHierarchy(db, {
      touchedParentTaskIds: [current.parent_task_id],
      touchedSprintIds: [current.sprint_id],
      now: archivedAt,
    });
  });

  tx();

  return {
    taskId: current.id,
    archivedAt,
  };
}

export function moveTask(input: {
  taskId: string;
  status: TaskStatusInput;
  columnOrder?: number;
  blockedReason?: string | null;
  reviewNotes?: string | null;
  actorUserId?: string;
  terminateExecutionRun?: ExecutionRunTerminator;
}): {
  task: OrchestrationTask;
  transition: {
    from: TaskStatus;
    to: TaskStatus;
    statusChanged: boolean;
  };
} {
  const db = getOrchestrationDb();
  const current = getTaskRowForUpdate(db, input.taskId);
  if (!current) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const toStatus = toDbStatus(input.status);
  const fromStatus = current.status;
  const autoAssignee =
    toStatus === "in_progress" && !current.assignee_agent_id && current.project_id
      ? resolveSingleEligibleAssignee(db, current.project_id)
      : undefined;
  const reviewCompletionAssigneeId =
    fromStatus === "review" && toStatus === "done"
      ? resolveReviewProducerAssigneeId(db, current.id)
      : null;
  const nextAssigneeId = reviewCompletionAssigneeId ?? current.assignee_agent_id ?? autoAssignee?.id ?? null;
  const nextAssigneeName = autoAssignee?.name ?? null;
  const reviewCompletionAssigneeRestored =
    Boolean(reviewCompletionAssigneeId) && reviewCompletionAssigneeId !== current.assignee_agent_id;

  if (
    fromStatus === "review" &&
    toStatus === "done" &&
    (!input.reviewNotes || !input.reviewNotes.trim())
  ) {
    throw new OrchestrationApiError(
      400,
      "review_notes_required",
      "This status transition requires review notes"
    );
  }

  validateTransition(
    db,
    fromStatus,
    toStatus,
    Boolean(nextAssigneeId),
    input.reviewNotes ?? null
  );

  const now = new Date().toISOString();
  const targetOrder =
    input.columnOrder !== undefined
      ? input.columnOrder
      : fromStatus === toStatus
        ? current.column_order
        : nextColumnOrder(db, current.project_id, toStatus);

  const blockedReason =
    toStatus === "blocked"
      ? (input.blockedReason ?? current.blocked_reason ?? "Blocked")
      : null;

  const reviewNotes =
    input.reviewNotes === null
      ? null
      : input.reviewNotes === undefined
        ? current.review_notes
        : input.reviewNotes;

  const startedAt =
    toStatus === "in_progress"
      ? (current.started_at ?? now)
      : current.started_at;

  const completedAt = toStatus === "done" ? now : null;
  const nextAssignedAt = nextAssigneeId
    ? (reviewCompletionAssigneeRestored ? now : current.assigned_at ?? now)
    : null;

  // Reset the in-progress-loop circuit-breaker counter on any operator-driven
  // status change (migration v46). This ensures manual unblocks / reassigns
  // / nudges start the counter fresh — the breaker is only meant to catch
  // autonomous loops, not interfere with operator intervention.
  const noopCounterUpdate = fromStatus !== toStatus ? "consecutive_noop_wakes = 0," : "";

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET
         status = ?,
         column_order = ?,
         assignee_agent_id = ?,
         assigned_at = ?,
         blocked_reason = ?,
         review_notes = ?,
         started_at = ?,
         completed_at = ?,
         ${noopCounterUpdate}
         updated_at = ?
       WHERE id = ?`
    ).run(
      toStatus,
      targetOrder,
      nextAssigneeId,
      nextAssignedAt,
      blockedReason,
      reviewNotes,
      startedAt,
      completedAt,
      now,
      input.taskId
    );

    if (autoAssignee || reviewCompletionAssigneeRestored) {
      db.prepare(
        `INSERT INTO task_events
          (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        current.project_id,
        current.id,
        nextAssigneeId,
        input.actorUserId ?? "api",
        "task.assigned",
        fromStatus,
        fromStatus,
        JSON.stringify({
          assignee: nextAssigneeName,
          assigneeId: nextAssigneeId,
          previousAssigneeId: current.assignee_agent_id,
          autoAssignedBy: autoAssignee ? "single_eligible_agent_on_transition" : null,
          source: reviewCompletionAssigneeRestored ? "review_completion_return_to_producer" : null,
        }),
        now
      );
    }

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      current.project_id,
      current.id,
      nextAssigneeId,
      input.actorUserId ?? "api",
      fromStatus === toStatus ? "task.reordered" : "task.status_changed",
      fromStatus,
      toStatus,
      JSON.stringify({
        columnOrder: targetOrder,
        blockedReason,
        autoAssignedBy: autoAssignee ? "single_eligible_agent_on_transition" : null,
        reviewCompletionAssigneeRestored,
      }),
      now
    );

    if (current.assignee_agent_id && current.assignee_agent_id !== nextAssigneeId) {
      refreshAgentLoad(db, current.assignee_agent_id);
    }
    if (nextAssigneeId) {
      refreshAgentLoad(db, nextAssigneeId);
    }

    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);

    cancelRunningExecutionRunsForTask(db, {
      taskId: current.id,
      toStatus,
      now,
      terminateRun: input.terminateExecutionRun,
    });

    if (fromStatus !== "done" && toStatus === "done") {
      maybeAutoCompleteSprintAfterTaskDone(db, {
        sprintId: current.sprint_id,
        projectId: current.project_id,
        taskId: current.id,
        actorUserId: input.actorUserId,
        now,
      });
    }

    enqueueWakesForNewlyRunnableDependents(db, {
      completedTaskId: current.id,
      companyId: current.company_id,
      fromStatus,
      toStatus,
      now,
    });

    reconcileTaskHierarchy(db, {
      touchedParentTaskIds: [current.parent_task_id],
      touchedSprintIds: [current.sprint_id],
      now,
    });
  });

  tx();

  if (current.source_takeaway_id) {
    queueTakeawayLifecycleSync({
      takeawayId: current.source_takeaway_id,
      taskStatus: toStatus,
    });
  }

  return {
    task: taskById(db, input.taskId),
    transition: {
      from: toApiStatus(fromStatus),
      to: toApiStatus(toStatus),
      statusChanged: fromStatus !== toStatus,
    },
  };
}

export function assignTask(input: {
  taskId: string;
  assignee?: string | null;
  actorUserId?: string;
}): { task: OrchestrationTask; assignmentChanged: boolean } {
  const db = getOrchestrationDb();
  const current = getTaskRowForUpdate(db, input.taskId);
  if (!current) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const hasAssigneeInput = Object.prototype.hasOwnProperty.call(input, "assignee");
  let targetAssigneeId = current.assignee_agent_id;
  let targetAssigneeName: string | null = null;

  if (hasAssigneeInput) {
    if (typeof input.assignee === "string" && input.assignee.trim()) {
      const resolved = current.company_id
        ? resolveAssigneeAgentForCompany(db, current.company_id, input.assignee)
        : current.project_id
          ? resolveAssigneeAgent(db, current.project_id, input.assignee)
          : undefined;
      if (!resolved) {
        throw new OrchestrationApiError(400, "invalid_assignee", "Assignee must be a company agent");
      }
      targetAssigneeId = resolved.id;
      targetAssigneeName = resolved.name;
    } else {
      targetAssigneeId = null;
      targetAssigneeName = null;
    }
  } else if (current.assignee_agent_id) {
    const currentAssignee = db
      .prepare("SELECT name FROM agents WHERE id = ? AND archived_at IS NULL")
      .get(current.assignee_agent_id) as { name: string } | undefined;
    targetAssigneeName = currentAssignee?.name ?? null;
  }

  if (current.status === "in_progress" && !targetAssigneeId) {
    throw new OrchestrationApiError(
      400,
      "assignee_required",
      "In-progress tasks must remain assigned"
    );
  }

  if (targetAssigneeId === current.assignee_agent_id) {
    return { task: taskById(db, input.taskId), assignmentChanged: false };
  }

  const now = new Date().toISOString();
  const targetAssignedAt = targetAssigneeId ? now : null;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET assignee_agent_id = ?, assigned_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(targetAssigneeId, targetAssignedAt, now, input.taskId);

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      current.project_id,
      current.id,
      targetAssigneeId,
      input.actorUserId ?? "api",
      targetAssigneeId ? "task.assigned" : "task.unassigned",
      current.status,
      current.status,
      JSON.stringify({
        assignee: targetAssigneeName,
        assigneeId: targetAssigneeId,
        previousAssigneeId: current.assignee_agent_id,
      }),
      now
    );

    if (current.assignee_agent_id) {
      refreshAgentLoad(db, current.assignee_agent_id);
    }
    if (targetAssigneeId && targetAssigneeId !== current.assignee_agent_id) {
      refreshAgentLoad(db, targetAssigneeId);
    }

    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);
  });

  tx();

  const updated = getTaskRowForUpdate(db, input.taskId);
  if (!updated) {
    throw new OrchestrationApiError(500, "task_assignment_failed", "Task assignment saved but task reload failed");
  }

  if (updated.status === "in_progress" && !updated.assignee_agent_id) {
    throw new OrchestrationApiError(
      400,
      "assignee_required",
      "In-progress tasks must remain assigned"
    );
  }

  return { task: taskById(db, input.taskId), assignmentChanged: true };
}
