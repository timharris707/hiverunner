import {
  DEFAULT_STALE_ALERT_THRESHOLDS_HOURS,
  type ActivityEventRow,
  type OrchestrationActivityEvent,
  type OrchestrationStaleAlert,
  OrchestrationApiError,
  type StaleAlertCandidateRow,
  decodeActivityCursor,
  deterministicEventId,
  encodeActivityCursor,
  getOrchestrationDb,
  getProjectRow,
  parseJsonObject,
  parseProjectSettings,
  toApiStatus,
} from "./shared";

type ActivityFeedEventRow = Omit<ActivityEventRow, "event_type"> & {
  event_type: ActivityEventRow["event_type"] | "task.comment_added" | "task.read_marked";
};

export function listActivityFeed(input: {
  limit: number;
  cursor?: string;
  projectId?: string;
  agentId?: string;
}): {
  activity: OrchestrationActivityEvent[];
  page: {
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  };
} {
  const db = getOrchestrationDb();
  const params: unknown[] = [];
  const taskWhereParts = [
    "p.archived_at IS NULL",
    "te.event_type IN ('task.status_changed','task.assigned','task.unassigned','task.comment_added','task.read_marked')",
  ];
  const sprintWhereParts = ["p.archived_at IS NULL"];

  if (input.projectId) {
    const project = getProjectRow(db, input.projectId);
    if (!project) {
      throw new OrchestrationApiError(404, "project_not_found", "Project not found");
    }
    taskWhereParts.push("p.id = ?");
    sprintWhereParts.push("p.id = ?");
    params.push(project.id, project.id);
  }

  if (input.agentId) {
    const agent = db
      .prepare(
        `SELECT id
         FROM agents
         WHERE archived_at IS NULL
           AND (id = ? OR lower(name) = lower(?))
         LIMIT 1`
      )
      .get(input.agentId, input.agentId) as { id: string } | undefined;

    if (!agent) {
      throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
    }

    taskWhereParts.push(
      `(te.agent_id = ? OR json_extract(te.metadata_json, '$.assigneeId') = ? OR json_extract(te.metadata_json, '$.previousAssigneeId') = ?)`
    );
    params.push(agent.id, agent.id, agent.id);
    sprintWhereParts.push("1 = 0");
  }

  if (input.cursor) {
    const decoded = decodeActivityCursor(input.cursor);
    taskWhereParts.push(
      "(te.created_at < ? OR (te.created_at = ? AND ('task:' || te.id) < ?))"
    );
    sprintWhereParts.push(
      `(
        CASE
          WHEN s.completed_at IS NOT NULL THEN s.completed_at
          WHEN s.updated_at > s.created_at THEN s.updated_at
          ELSE s.created_at
        END < ?
        OR (
          CASE
            WHEN s.completed_at IS NOT NULL THEN s.completed_at
            WHEN s.updated_at > s.created_at THEN s.updated_at
            ELSE s.created_at
          END = ?
          AND ('sprint:' || s.id || ':' ||
            CASE
              WHEN s.completed_at IS NOT NULL THEN 'completed'
              WHEN s.updated_at > s.created_at THEN 'updated'
              ELSE 'created'
            END
          ) < ?
        )
      )`
    );
    params.push(decoded.createdAt, decoded.createdAt, decoded.id, decoded.createdAt, decoded.createdAt, decoded.id);
  }

  params.push(input.limit + 1);

  const rows = db
    .prepare(
      `WITH feed_events AS (
        SELECT
          'task:' || te.id AS event_id,
          te.id AS task_event_uuid,
          te.event_type AS event_type,
          te.task_id,
          COALESCE(t.title, '[Deleted task]') AS task_title,
          t.task_key,
          t.sprint_id AS sprint_id,
          s.name AS sprint_name,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.id AS company_id,
          c.slug AS company_slug,
          c.name AS company_name,
          te.from_status,
          te.to_status,
          te.metadata_json,
          te.agent_id,
          a.name AS agent_name,
          te.created_at
        FROM task_events te
        INNER JOIN projects p ON p.id = te.project_id
        LEFT JOIN tasks t ON t.id = te.task_id
        LEFT JOIN sprints s ON s.id = t.sprint_id
        LEFT JOIN companies c ON c.id = p.company_id
        LEFT JOIN agents a ON a.id = te.agent_id
        WHERE ${taskWhereParts.join(" AND ")}

        UNION ALL

        SELECT
          'sprint:' || s.id || ':' ||
            CASE
              WHEN s.completed_at IS NOT NULL THEN 'completed'
              WHEN s.updated_at > s.created_at THEN 'updated'
              ELSE 'created'
            END AS event_id,
          NULL AS task_event_uuid,
          CASE
            WHEN s.completed_at IS NOT NULL THEN 'sprint.completed'
            WHEN s.updated_at > s.created_at THEN 'sprint.updated'
            ELSE 'sprint.created'
          END AS event_type,
          NULL AS task_id,
          NULL AS task_title,
          NULL AS task_key,
          s.id AS sprint_id,
          s.name AS sprint_name,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.id AS company_id,
          c.slug AS company_slug,
          c.name AS company_name,
          NULL AS from_status,
          NULL AS to_status,
          json_object('status', s.status, 'goal', s.goal) AS metadata_json,
          NULL AS agent_id,
          NULL AS agent_name,
          CASE
            WHEN s.completed_at IS NOT NULL THEN s.completed_at
            WHEN s.updated_at > s.created_at THEN s.updated_at
            ELSE s.created_at
          END AS created_at
        FROM sprints s
        INNER JOIN projects p ON p.id = s.project_id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE ${sprintWhereParts.join(" AND ")}
      )
      SELECT
        event_id,
        task_event_uuid,
        event_type,
        task_id,
        task_title,
        task_key,
        sprint_id,
        sprint_name,
        project_id,
        project_slug,
        project_name,
        company_id,
        company_slug,
        company_name,
        from_status,
        to_status,
        metadata_json,
        agent_id,
        agent_name,
        created_at
      FROM feed_events
      ORDER BY created_at DESC, event_id DESC
      LIMIT ?`
    )
    .all(...params) as ActivityFeedEventRow[];

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);

  return {
    activity: pageRows.map((row) => {
      const metadata = parseJsonObject(row.metadata_json);
      const eventType = row.event_type;
      const taskTitle = row.task_title ?? undefined;
      const sprintName = row.sprint_name ?? undefined;
      const assigneeName =
        typeof metadata.assignee === "string" && metadata.assignee.trim()
          ? metadata.assignee
          : undefined;

      const agentLabel = row.agent_name ?? assigneeName ?? "Someone";

      const commentSource = typeof metadata.source === "string" ? metadata.source : undefined;
      const message =
        eventType === "task.read_marked"
          ? `Board issue read marked ${taskTitle ?? "a task"}`
          : eventType === "task.comment_added"
            ? commentSource === "voice"
              ? `${agentLabel} logged a voice note on ${taskTitle ?? "a task"}`
              : `${agentLabel} commented on ${taskTitle ?? "a task"}`
            : eventType === "task.status_changed" && row.from_status && row.to_status
            ? `${taskTitle ?? "Task"} moved ${toApiStatus(row.from_status)} -> ${toApiStatus(row.to_status)}`
            : eventType === "task.assigned"
              ? `${taskTitle ?? "Task"} assigned${assigneeName ? ` to ${assigneeName}` : ""}`
              : eventType === "task.unassigned"
                ? `${taskTitle ?? "Task"} unassigned`
                : eventType === "sprint.completed"
                  ? `${sprintName ?? "Sprint"} completed`
                  : eventType === "sprint.updated"
                    ? `${sprintName ?? "Sprint"} updated`
                    : `${sprintName ?? "Sprint"} created`;

      return {
        id: row.task_event_uuid ?? deterministicEventId(row.event_id),
        eventType,
        taskId: row.task_id ?? undefined,
        taskTitle,
        taskKey: row.task_key ?? undefined,
        sprintId: row.sprint_id ?? undefined,
        sprintName,
        projectId: row.project_id,
        projectSlug: row.project_slug,
        projectName: row.project_name,
        companyId: row.company_id ?? undefined,
        companySlug: row.company_slug ?? undefined,
        companyName: row.company_name ?? undefined,
        oldStatus: row.from_status ? toApiStatus(row.from_status) : undefined,
        newStatus: row.to_status ? toApiStatus(row.to_status) : undefined,
        message,
        agentId: row.agent_id ?? undefined,
        agentName: eventType === "task.read_marked" ? "Board" : (row.agent_name ?? assigneeName),
        timestamp: row.created_at,
      } satisfies OrchestrationActivityEvent;
    }),
    page: {
      limit: input.limit,
      ...(hasMore && last ? { nextCursor: encodeActivityCursor(last.created_at, last.event_id) } : {}),
      hasMore,
    },
  };
}

export function listStaleTaskAlerts(input: { projectId?: string }): {
  generatedAt: string;
  defaults: {
    review: number;
    inProgress: number;
    blocked: number;
  };
  alerts: OrchestrationStaleAlert[];
} {
  const db = getOrchestrationDb();
  const now = new Date();
  const whereParts = [
    "t.archived_at IS NULL",
    "p.archived_at IS NULL",
    "t.status IN ('review','in_progress','blocked')",
  ];
  const params: unknown[] = [];

  if (input.projectId) {
    const project = getProjectRow(db, input.projectId);
    if (!project) {
      throw new OrchestrationApiError(404, "project_not_found", "Project not found");
    }
    whereParts.push("p.id = ?");
    params.push(project.id);
  }

  const rows = db
    .prepare(
      `SELECT
        t.id AS task_id,
        t.title AS task_title,
        t.status AS task_status,
        t.updated_at AS task_updated_at,
        a.name AS assignee_name,
        p.id AS project_id,
        p.slug AS project_slug,
        p.name AS project_name,
        p.settings_json AS project_settings_json,
        c.id AS company_id,
        c.slug AS company_slug,
        c.name AS company_name
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = p.company_id
       LEFT JOIN agents a ON a.id = t.assignee_agent_id
       WHERE ${whereParts.join(" AND ")}
       ORDER BY t.updated_at ASC`
    )
    .all(...params) as StaleAlertCandidateRow[];

  const alerts: OrchestrationStaleAlert[] = [];
  for (const row of rows) {
    const settings = parseProjectSettings(row.project_settings_json);
    const thresholds = settings.staleAlertThresholdsHours;
    const thresholdHours =
      row.task_status === "review"
        ? thresholds.review
        : row.task_status === "in_progress"
          ? thresholds.inProgress
          : thresholds.blocked;

    const updatedMs = new Date(row.task_updated_at).getTime();
    if (!Number.isFinite(updatedMs)) continue;

    const staleMinutes = (now.getTime() - updatedMs) / 60_000;
    const thresholdMinutes = thresholdHours * 60;
    if (staleMinutes <= thresholdMinutes) continue;

    alerts.push({
      taskId: row.task_id,
      taskTitle: row.task_title,
      taskStatus: toApiStatus(row.task_status),
      projectId: row.project_id,
      projectSlug: row.project_slug,
      projectName: row.project_name,
      companyId: row.company_id ?? undefined,
      companySlug: row.company_slug ?? undefined,
      companyName: row.company_name ?? undefined,
      assignee: row.assignee_name ?? undefined,
      lastUpdatedAt: row.task_updated_at,
      staleMinutes: Math.floor(staleMinutes),
      thresholdMinutes: Math.floor(thresholdMinutes),
      exceededMinutes: Math.max(0, Math.floor(staleMinutes - thresholdMinutes)),
    });
  }
  alerts.sort((a, b) => b.exceededMinutes - a.exceededMinutes);

  return {
    generatedAt: now.toISOString(),
    defaults: {
      review: DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.review,
      inProgress: DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.inProgress,
      blocked: DEFAULT_STALE_ALERT_THRESHOLDS_HOURS.blocked,
    },
    alerts,
  };
}
