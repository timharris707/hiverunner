import { randomUUID } from "crypto";
import { syncTakeawayStatusFromTaskLifecycleAsync } from "@/lib/ideas-store";

import {
  type OrchestrationTask,
  OrchestrationApiError,
  type TaskPriorityInput,
  type TaskRow,
  type TaskStatus,
  type TaskStatusInput,
  type TaskTypeInput,
  commentsForTasks,
  generateTaskKey,
  getOrchestrationDb,
  getProjectRow,
  getTaskRowForUpdate,
  nextColumnOrder,
  refreshAgentLoad,
  resolveAssigneeAgent,
  resolveSingleEligibleAssignee,
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
}): { tasks: OrchestrationTask[] } {
  const db = getOrchestrationDb();

  const includeArchived = filters.includeArchived ?? false;
  const includeNonProduction = filters.includeNonProduction ?? false;
  const whereParts = [includeArchived ? "1=1" : "t.archived_at IS NULL", "p.archived_at IS NULL"];
  const args: unknown[] = [];

  if (filters.companyIdOrSlug) {
    const company = db
      .prepare(
        `SELECT id
         FROM companies
         WHERE archived_at IS NULL
           AND (id = ? OR slug = ?)
         LIMIT 1`
      )
      .get(filters.companyIdOrSlug, filters.companyIdOrSlug) as { id: string } | undefined;

    if (!company) {
      throw new OrchestrationApiError(404, "company_not_found", "Company not found");
    }

    whereParts.push("p.company_id = ?");
    args.push(company.id);
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
      "lower(t.title || ' ' || t.description || ' ' || COALESCE(a.name, '') || ' ' || COALESCE(p.name, '')) LIKE '%' || lower(?) || '%'"
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

  const rows = db
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
        t.updated_at
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       LEFT JOIN sprints s ON s.id = t.sprint_id
       WHERE ${whereParts.join(" AND ")}
       ORDER BY ${orderBy}`
    )
    .all(...args) as TaskRow[];

  const commentMap = commentsForTasks(
    db,
    rows.map((row) => row.id)
  );

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
      .map((row) => taskFromRow(row, commentMap.get(row.id) ?? [])),
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


export function createTask(input: {
  projectId: string;
  title: string;
  description: string;
  priority: TaskPriorityInput;
  type: TaskTypeInput;
  status: TaskStatusInput;
  assignee?: string;
  sprintId?: string;
  parentTaskId?: string;
  labels: string[];
  blockedReason?: string;
  createdBy: string;
  columnOrder?: number;
  sourceReviewId?: string;
  sourceTakeawayId?: string;
}): { task: OrchestrationTask } {
  const db = getOrchestrationDb();

  const project = getProjectRow(db, input.projectId);
  if (!project) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  const status = toDbStatus(input.status);
  const assignee = input.assignee
    ? resolveAssigneeAgent(db, project.id, input.assignee)
    : undefined;

  if (input.assignee && !assignee) {
    throw new OrchestrationApiError(400, "invalid_assignee", "Assignee must be a company agent");
  }

  const now = new Date().toISOString();
  const taskId = randomUUID();
  const columnOrder = input.columnOrder ?? nextColumnOrder(db, project.id, status);
  const { taskNumber, taskKey } = generateTaskKey(db, project.id);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO tasks
        (id, project_id, sprint_id, parent_task_id, title, description, priority, type, status, column_order,
         assignee_agent_id, assigned_at, created_by, labels_json, blocked_reason, source_review_id, source_takeaway_id, started_at, completed_at, task_number, task_key, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      project.id,
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
      status === "blocked" ? input.blockedReason ?? "Blocked" : null,
      input.sourceReviewId ?? null,
      input.sourceTakeawayId ?? null,
      status === "in_progress" ? now : null,
      status === "done" ? now : null,
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
      project.id,
      taskId,
      assignee?.id ?? null,
      input.createdBy,
      "task.created",
      null,
      status,
      JSON.stringify({ labels: input.labels }),
      now
    );

    if (assignee?.id) {
      refreshAgentLoad(db, assignee.id);
    }

    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, project.id);

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
  type?: TaskTypeInput;
  sprintId?: string | null;
  parentTaskId?: string | null;
  labels?: string[];
  blockedReason?: string | null;
  reviewNotes?: string | null;
  actorUserId?: string;
}): { task: OrchestrationTask } {
  const db = getOrchestrationDb();
  const current = getTaskRowForUpdate(db, input.taskId);
  if (!current) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  let nextSprintId = current.sprint_id;
  if (input.sprintId !== undefined) {
    if (input.sprintId === null) {
      nextSprintId = null;
    } else {
      const sprint = db
        .prepare("SELECT id FROM sprints WHERE id = ? AND project_id = ? LIMIT 1")
        .get(input.sprintId, current.project_id) as { id: string } | undefined;
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
  if (input.parentTaskId !== undefined) {
    if (input.parentTaskId === null) {
      nextParentTaskId = null;
    } else {
      if (input.parentTaskId === current.id) {
        throw new OrchestrationApiError(400, "invalid_parent_task", "parentTaskId cannot reference the task itself");
      }

      const parentTask = db
        .prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL LIMIT 1")
        .get(input.parentTaskId, current.project_id) as { id: string } | undefined;
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
  const nextBlockedReason =
    input.blockedReason === undefined ? current.blocked_reason : input.blockedReason;
  const nextReviewNotes =
    input.reviewNotes === undefined ? current.review_notes : input.reviewNotes;

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE tasks
       SET
        title = ?,
        description = ?,
        priority = ?,
        type = ?,
        sprint_id = ?,
        parent_task_id = ?,
        labels_json = ?,
        blocked_reason = ?,
        review_notes = ?,
        updated_at = ?
       WHERE id = ?`
    ).run(
      nextTitle,
      nextDescription,
      nextPriority,
      nextType,
      nextSprintId,
      nextParentTaskId,
      nextLabelsJson,
      nextBlockedReason,
      nextReviewNotes,
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
      current.project_id,
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
        typeChanged: input.type !== undefined,
        sprintChanged: input.sprintId !== undefined,
        parentTaskChanged: input.parentTaskId !== undefined,
        labelsChanged: input.labels !== undefined,
        blockedReasonChanged: input.blockedReason !== undefined,
        reviewNotesChanged: input.reviewNotes !== undefined,
      }),
      now
    );

    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);

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
    toStatus === "in_progress" && !current.assignee_agent_id
      ? resolveSingleEligibleAssignee(db, current.project_id)
      : undefined;
  const nextAssigneeId = current.assignee_agent_id ?? autoAssignee?.id ?? null;
  const nextAssigneeName = autoAssignee?.name ?? null;

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
    ? (current.assigned_at ?? now)
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

    if (autoAssignee) {
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
          autoAssignedBy: "single_eligible_agent_on_transition",
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
      const resolved = resolveAssigneeAgent(db, current.project_id, input.assignee);
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
