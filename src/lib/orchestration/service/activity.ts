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
import {
  buildCanonicalCompanyPath,
  buildCanonicalGoalPath,
  buildCanonicalOverseerPath,
  buildCanonicalTeamPath,
} from "@/lib/orchestration/route-paths";
import {
  IMPROVE_ACTIVITY_EVENT_TYPES,
  type ImproveActivityEventType,
} from "@/lib/orchestration/service/improvement-provenance";

type ActivityFeedEventRow = Omit<ActivityEventRow, "event_type"> & {
  event_type:
    | ActivityEventRow["event_type"]
    | "task.comment_added"
    | "task.read_marked"
    | ImproveActivityEventType;
  company_code: string | null;
};

function activityEventTypes(): string {
  return [
    "task.status_changed",
    "task.assigned",
    "task.unassigned",
    "task.comment_added",
    "task.read_marked",
    "task.eval_case_saved",
  ].map((type) => `'${type}'`).join(",");
}

function improveActivityEventTypes(): string {
  return IMPROVE_ACTIVITY_EVENT_TYPES.map((type) => `'${type}'`).join(",");
}

function isImproveActivityEventType(eventType: string): eventType is ImproveActivityEventType {
  return (IMPROVE_ACTIVITY_EVENT_TYPES as readonly string[]).includes(eventType);
}

function addCursorClause(
  whereParts: string[],
  params: unknown[],
  createdAtExpr: string,
  eventIdExpr: string,
  cursor?: { createdAt: string; id: string },
): void {
  if (!cursor) return;
  whereParts.push(`(${createdAtExpr} < ? OR (${createdAtExpr} = ? AND ${eventIdExpr} < ?))`);
  params.push(cursor.createdAt, cursor.createdAt, cursor.id);
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const TEMPLATE_ACTIVITY_MESSAGES: Partial<Record<
  ActivityFeedEventRow["event_type"],
  (metadata: Record<string, unknown>, sprintName?: string) => string
>> = {
  "template.draft_created": (metadata: Record<string, unknown>, sprintName?: string) =>
    `Template draft created for ${metadataString(metadata, "sprintName") ?? sprintName ?? "a sprint"}`,
  "template.crew_recommended": (metadata: Record<string, unknown>, sprintName?: string) =>
    `Crew recommendations recorded for ${metadataString(metadata, "sprintName") ?? sprintName ?? "a template draft"}`,
  "template.board_created": (metadata: Record<string, unknown>) =>
    `Template draft approved into ${metadataNumber(metadata, "taskCount") ?? "board"} task${metadataNumber(metadata, "taskCount") === 1 ? "" : "s"}`,
};

const OVERSEER_ACTIVITY_MESSAGES: Partial<Record<
  ActivityFeedEventRow["event_type"],
  (metadata: Record<string, unknown>) => string
>> = {
  "overseer.draft.signoff_delegated": (metadata: Record<string, unknown>) =>
    `Delegated signoff recorded for ${metadataString(metadata, "draftId") ?? "a draft"}`,
  "overseer.draft.signoff_applied": (metadata: Record<string, unknown>) =>
    `Delegated signoff applied for ${metadataString(metadata, "draftId") ?? "a draft"}`,
  "overseer.draft.signoff_blocked": (metadata: Record<string, unknown>) =>
    `Delegated signoff blocked for ${metadataString(metadata, "draftId") ?? "a draft"}`,
};

const IMPROVE_ACTIVITY_MESSAGES = {
  "improve.recommendation_created": (label: string) => `Improve recorded ${label}`,
  "improve.recommendation_dismissed": (label: string) => `Improve dismissed ${label}`,
  "improve.recommendation_suppressed": (label: string) => `Improve suppressed ${label}`,
  "improve.approval_package_created": (label: string) => `Improve approval package created for ${label}`,
  "improve.approval_decision_synced": (label: string) => `Improve approval decision synced for ${label}`,
  "improve.recommendation_applied": (label: string) => `Improve applied ${label}`,
} satisfies Record<ImproveActivityEventType, (label: string) => string>;

function buildActivityMessage(input: {
  row: ActivityFeedEventRow;
  metadata: Record<string, unknown>;
  taskTitle?: string;
  sprintName?: string;
  agentLabel: string;
}): string {
  const { row, metadata, taskTitle, sprintName, agentLabel } = input;
  const eventType = row.event_type;

  if (eventType === "task.read_marked") {
    return `Board issue read marked ${taskTitle ?? "a task"}`;
  }

  if (eventType === "task.comment_added") {
    const commentSource = typeof metadata.source === "string" ? metadata.source : undefined;
    return commentSource === "voice"
      ? `${agentLabel} logged a voice note on ${taskTitle ?? "a task"}`
      : `${agentLabel} commented on ${taskTitle ?? "a task"}`;
  }

  if (eventType === "task.eval_case_saved") {
    const reviewOutcome = typeof metadata.reviewOutcome === "string" ? metadata.reviewOutcome : undefined;
    return `Eval case saved for ${row.task_key ?? taskTitle ?? "a task"}${reviewOutcome ? ` (${reviewOutcome})` : ""}`;
  }

  const templateMessage = TEMPLATE_ACTIVITY_MESSAGES[eventType]?.(metadata, sprintName);
  if (templateMessage) return templateMessage;

  const overseerMessage = OVERSEER_ACTIVITY_MESSAGES[eventType]?.(metadata);
  if (overseerMessage) return overseerMessage;

  if (isImproveActivityEventType(eventType)) {
    const recommendationId = metadataString(metadata, "recommendationId");
    const recommendationLabel = recommendationId ? `recommendation ${recommendationId}` : "an Improve recommendation";
    return IMPROVE_ACTIVITY_MESSAGES[eventType](recommendationLabel);
  }

  if (eventType === "task.status_changed" && row.from_status && row.to_status) {
    return `${taskTitle ?? "Task"} moved ${toApiStatus(row.from_status)} -> ${toApiStatus(row.to_status)}`;
  }

  if (eventType === "task.assigned") {
    const assignee = typeof metadata.assignee === "string" && metadata.assignee.trim()
      ? metadata.assignee
      : undefined;
    return `${taskTitle ?? "Task"} assigned${assignee ? ` to ${assignee}` : ""}`;
  }

  if (eventType === "task.unassigned") return `${taskTitle ?? "Task"} unassigned`;
  if (eventType === "sprint.completed") return `${sprintName ?? "Sprint"} completed`;
  if (eventType === "sprint.updated") return `${sprintName ?? "Sprint"} updated`;
  return `${sprintName ?? "Sprint"} created`;
}

function enrichActivityMetadata(
  row: ActivityFeedEventRow,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const companyCode = row.company_code ?? row.company_slug;
  if (!companyCode) return metadata;

  const goalId = metadataString(metadata, "companyGoalId") ?? row.sprint_id;
  const draftId = metadataString(metadata, "draftId");
  const templateVersionId = metadataString(metadata, "sourceTemplateVersionId");
  const templateIntakeAnswerId = metadataString(metadata, "templateIntakeAnswerId");
  const sprintId = metadataString(metadata, "sprintId") ?? row.sprint_id;

  if (
    row.event_type === "template.draft_created" ||
    row.event_type === "template.crew_recommended" ||
    row.event_type === "template.board_created"
  ) {
    return {
      ...metadata,
      sourceLinks: {
        ...(goalId ? { goal: buildCanonicalGoalPath(companyCode, goalId) } : {}),
        ...(draftId && goalId ? { draft: `${buildCanonicalGoalPath(companyCode, goalId)}?draft=${encodeURIComponent(draftId)}` } : {}),
        ...(sprintId ? { sprint: buildCanonicalGoalPath(companyCode, sprintId) } : {}),
        ...(templateVersionId ? { evals: `${buildCanonicalCompanyPath(companyCode, "/evals")}?template=${encodeURIComponent(templateVersionId)}` } : {}),
        ...(templateIntakeAnswerId ? { intake: `${buildCanonicalCompanyPath(companyCode, "/evals")}?templateIntakeAnswerId=${encodeURIComponent(templateIntakeAnswerId)}` } : {}),
        team: templateVersionId
          ? `${buildCanonicalTeamPath(companyCode)}?template=${encodeURIComponent(templateVersionId)}`
          : buildCanonicalTeamPath(companyCode),
      },
    };
  }

  if (row.event_type.startsWith("overseer.draft.signoff_")) {
    return {
      ...metadata,
      sourceLinks: {
        ...(goalId ? { goal: buildCanonicalGoalPath(companyCode, goalId) } : {}),
        ...(draftId && goalId ? { draft: `${buildCanonicalGoalPath(companyCode, goalId)}?draft=${encodeURIComponent(draftId)}` } : {}),
        overseer: metadataString(metadata, "sessionId")
          ? `${buildCanonicalOverseerPath(companyCode)}?session=${encodeURIComponent(metadataString(metadata, "sessionId") ?? "")}`
          : buildCanonicalOverseerPath(companyCode),
      },
    };
  }

  return metadata;
}

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
  const taskParams: unknown[] = [];
  const sprintParams: unknown[] = [];
  const draftParams: unknown[] = [];
  const crewParams: unknown[] = [];
  const boardParams: unknown[] = [];
  const signoffParams: unknown[] = [];
  const improveParams: unknown[] = [];
  const taskWhereParts = [
    "p.archived_at IS NULL",
    `te.event_type IN (${activityEventTypes()})`,
  ];
  const sprintWhereParts = ["p.archived_at IS NULL"];
  const draftWhereParts = [
    "p.archived_at IS NULL",
    "d.source_template_version_id IS NOT NULL",
  ];
  const crewWhereParts = [
    "p.archived_at IS NULL",
    "d.source_template_version_id IS NOT NULL",
    "json_type(d.generation_provenance_json, '$.crewRecommendation') = 'object'",
  ];
  const boardWhereParts = [
    "p.archived_at IS NULL",
    "d.source_template_version_id IS NOT NULL",
    "d.status = 'approved'",
    "d.approved_at IS NOT NULL",
  ];
  const signoffWhereParts = [
    "p.archived_at IS NULL",
    "ose.event_type IN ('overseer.draft.signoff_delegated','overseer.draft.signoff_applied','overseer.draft.signoff_blocked')",
  ];
  const improveWhereParts = [
    "p.archived_at IS NULL",
    "p.company_id = cae.company_id",
    `cae.event_type IN (${improveActivityEventTypes()})`,
  ];
  const decodedCursor = input.cursor ? decodeActivityCursor(input.cursor) : undefined;

  if (input.projectId) {
    const project = getProjectRow(db, input.projectId);
    if (!project) {
      throw new OrchestrationApiError(404, "project_not_found", "Project not found");
    }
    taskWhereParts.push("p.id = ?");
    sprintWhereParts.push("p.id = ?");
    draftWhereParts.push("p.id = ?");
    crewWhereParts.push("p.id = ?");
    boardWhereParts.push("p.id = ?");
    signoffWhereParts.push("p.id = ?");
    improveWhereParts.push("p.id = ?");
    taskParams.push(project.id);
    sprintParams.push(project.id);
    draftParams.push(project.id);
    crewParams.push(project.id);
    boardParams.push(project.id);
    signoffParams.push(project.id);
    improveParams.push(project.id);
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
    taskParams.push(agent.id, agent.id, agent.id);
    sprintWhereParts.push("1 = 0");
    draftWhereParts.push("d.proposed_by_agent_id = ?");
    crewWhereParts.push("d.proposed_by_agent_id = ?");
    boardWhereParts.push("d.proposed_by_agent_id = ?");
    draftParams.push(agent.id);
    crewParams.push(agent.id);
    boardParams.push(agent.id);
    signoffWhereParts.push("1 = 0");
    improveWhereParts.push("(cae.agent_id = ? OR json_extract(cae.metadata_json, '$.agentId') = ? OR json_extract(cae.metadata_json, '$.actorAgentId') = ?)");
    improveParams.push(agent.id, agent.id, agent.id);
  }

  addCursorClause(taskWhereParts, taskParams, "te.created_at", "('task:' || te.id)", decodedCursor);
  addCursorClause(
    sprintWhereParts,
    sprintParams,
    `CASE
      WHEN s.completed_at IS NOT NULL THEN s.completed_at
      WHEN s.updated_at > s.created_at THEN s.updated_at
      ELSE s.created_at
    END`,
    `('sprint:' || s.id || ':' ||
      CASE
        WHEN s.completed_at IS NOT NULL THEN 'completed'
        WHEN s.updated_at > s.created_at THEN 'updated'
        ELSE 'created'
      END
    )`,
    decodedCursor,
  );
  addCursorClause(draftWhereParts, draftParams, "d.created_at", "('draft:' || d.id || ':created')", decodedCursor);
  addCursorClause(crewWhereParts, crewParams, "d.created_at", "('draft:' || d.id || ':crew')", decodedCursor);
  addCursorClause(boardWhereParts, boardParams, "d.approved_at", "('draft:' || d.id || ':board')", decodedCursor);
  addCursorClause(signoffWhereParts, signoffParams, "ose.occurred_at", "('overseer:' || ose.id)", decodedCursor);
  addCursorClause(improveWhereParts, improveParams, "cae.created_at", "('audit:' || cae.id)", decodedCursor);

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
          c.company_code AS company_code,
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
          c.company_code AS company_code,
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

        UNION ALL

        SELECT
          'draft:' || d.id || ':created' AS event_id,
          NULL AS task_event_uuid,
          'template.draft_created' AS event_type,
          NULL AS task_id,
          NULL AS task_title,
          NULL AS task_key,
          goal.id AS sprint_id,
          COALESCE(CAST(json_extract(d.sprint_json, '$.name') AS TEXT), goal.name) AS sprint_name,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.id AS company_id,
          c.slug AS company_slug,
          c.company_code AS company_code,
          c.name AS company_name,
          NULL AS from_status,
          NULL AS to_status,
          json_object(
            'schema', 'hiverunner.template_activity.v1',
            'kind', 'template_draft_created',
            'draftId', d.id,
            'proposalGroupId', d.proposal_group_id,
            'companyGoalId', goal.id,
            'companyGoalName', goal.name,
            'sourceTemplateVersionId', d.source_template_version_id,
            'templateIntakeAnswerId', d.intake_answer_id,
            'templateId', CAST(json_extract(d.generation_provenance_json, '$.templateId') AS TEXT),
            'templateName', CAST(json_extract(d.generation_provenance_json, '$.templateName') AS TEXT),
            'templateVersion', json_extract(d.generation_provenance_json, '$.templateVersion'),
            'sprintName', COALESCE(CAST(json_extract(d.sprint_json, '$.name') AS TEXT), goal.name),
            'sequenceNumber', d.sequence_number,
            'taskCount', COALESCE(json_array_length(d.tasks_json), 0),
            'createsBoardTasksImmediately', 0
          ) AS metadata_json,
          d.proposed_by_agent_id AS agent_id,
          a.name AS agent_name,
          d.created_at AS created_at
        FROM goal_sprint_plan_drafts d
        INNER JOIN sprints goal ON goal.id = d.company_goal_id
        INNER JOIN projects p ON p.id = goal.project_id
        LEFT JOIN companies c ON c.id = d.company_id
        LEFT JOIN agents a ON a.id = d.proposed_by_agent_id
        WHERE ${draftWhereParts.join(" AND ")}

        UNION ALL

        SELECT
          'draft:' || d.id || ':crew' AS event_id,
          NULL AS task_event_uuid,
          'template.crew_recommended' AS event_type,
          NULL AS task_id,
          NULL AS task_title,
          NULL AS task_key,
          goal.id AS sprint_id,
          COALESCE(CAST(json_extract(d.sprint_json, '$.name') AS TEXT), goal.name) AS sprint_name,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.id AS company_id,
          c.slug AS company_slug,
          c.company_code AS company_code,
          c.name AS company_name,
          NULL AS from_status,
          NULL AS to_status,
          json_object(
            'schema', 'hiverunner.template_activity.v1',
            'kind', 'template_crew_recommended',
            'draftId', d.id,
            'proposalGroupId', d.proposal_group_id,
            'companyGoalId', goal.id,
            'companyGoalName', goal.name,
            'sourceTemplateVersionId', d.source_template_version_id,
            'templateIntakeAnswerId', d.intake_answer_id,
            'templateId', CAST(json_extract(d.generation_provenance_json, '$.templateId') AS TEXT),
            'templateName', CAST(json_extract(d.generation_provenance_json, '$.templateName') AS TEXT),
            'sprintName', COALESCE(CAST(json_extract(d.sprint_json, '$.name') AS TEXT), goal.name),
            'crewRecommendation', json_object(
              'requiredCount', COALESCE(json_array_length(d.generation_provenance_json, '$.crewRecommendation.required'), 0),
              'usefulCount', COALESCE(json_array_length(d.generation_provenance_json, '$.crewRecommendation.useful'), 0),
              'laterCount', COALESCE(json_array_length(d.generation_provenance_json, '$.crewRecommendation.later'), 0),
              'materializedNewAgentCount', COALESCE(json_extract(d.generation_provenance_json, '$.crewRecommendation.materializedNewAgentCount'), 0),
              'approvalRequiredNewAgentCount', COALESCE(json_extract(d.generation_provenance_json, '$.crewRecommendation.approvalRequiredNewAgentCount'), 0),
              'autoApproveNewHires', COALESCE(json_extract(d.generation_provenance_json, '$.crewRecommendation.autoApproveNewHires'), 0)
            )
          ) AS metadata_json,
          d.proposed_by_agent_id AS agent_id,
          a.name AS agent_name,
          d.created_at AS created_at
        FROM goal_sprint_plan_drafts d
        INNER JOIN sprints goal ON goal.id = d.company_goal_id
        INNER JOIN projects p ON p.id = goal.project_id
        LEFT JOIN companies c ON c.id = d.company_id
        LEFT JOIN agents a ON a.id = d.proposed_by_agent_id
        WHERE ${crewWhereParts.join(" AND ")}

        UNION ALL

        SELECT
          'draft:' || d.id || ':board' AS event_id,
          NULL AS task_event_uuid,
          'template.board_created' AS event_type,
          NULL AS task_id,
          NULL AS task_title,
          NULL AS task_key,
          COALESCE(materialized_s.id, goal.id) AS sprint_id,
          COALESCE(materialized_s.name, CAST(json_extract(d.sprint_json, '$.name') AS TEXT), goal.name) AS sprint_name,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.id AS company_id,
          c.slug AS company_slug,
          c.company_code AS company_code,
          c.name AS company_name,
          NULL AS from_status,
          NULL AS to_status,
          json_object(
            'schema', 'hiverunner.template_activity.v1',
            'kind', 'template_board_created',
            'draftId', d.id,
            'proposalGroupId', d.proposal_group_id,
            'companyGoalId', goal.id,
            'companyGoalName', goal.name,
            'sprintId', materialized_s.id,
            'sourceTemplateVersionId', d.source_template_version_id,
            'templateIntakeAnswerId', d.intake_answer_id,
            'templateId', CAST(json_extract(d.generation_provenance_json, '$.templateId') AS TEXT),
            'templateName', CAST(json_extract(d.generation_provenance_json, '$.templateName') AS TEXT),
            'sprintName', COALESCE(materialized_s.name, CAST(json_extract(d.sprint_json, '$.name') AS TEXT), goal.name),
            'sequenceNumber', d.sequence_number,
            'taskCount', COALESCE(json_array_length(d.tasks_json), 0),
            'createsBoardTasksImmediately', 0
          ) AS metadata_json,
          d.proposed_by_agent_id AS agent_id,
          a.name AS agent_name,
          d.approved_at AS created_at
        FROM goal_sprint_plan_drafts d
        INNER JOIN sprints goal ON goal.id = d.company_goal_id
        INNER JOIN projects p ON p.id = goal.project_id
        LEFT JOIN companies c ON c.id = d.company_id
        LEFT JOIN agents a ON a.id = d.proposed_by_agent_id
        LEFT JOIN (
          SELECT company_id, source_draft_id, MIN(sprint_id) AS sprint_id
          FROM template_generated_work
          WHERE generated_type = 'sprint'
          GROUP BY company_id, source_draft_id
        ) tgw_sprint ON tgw_sprint.company_id = d.company_id AND tgw_sprint.source_draft_id = d.id
        LEFT JOIN sprints materialized_s ON materialized_s.id = tgw_sprint.sprint_id
        WHERE ${boardWhereParts.join(" AND ")}

        UNION ALL

        SELECT
          'overseer:' || ose.id AS event_id,
          NULL AS task_event_uuid,
          ose.event_type AS event_type,
          NULL AS task_id,
          NULL AS task_title,
          NULL AS task_key,
          goal.id AS sprint_id,
          goal.name AS sprint_name,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.id AS company_id,
          c.slug AS company_slug,
          c.company_code AS company_code,
          c.name AS company_name,
          NULL AS from_status,
          NULL AS to_status,
          json_object(
            'schema', 'hiverunner.delegated_signoff_activity.v1',
            'kind', ose.event_type,
            'overseerEventId', ose.id,
            'sessionId', ose.session_id,
            'draftId', CAST(json_extract(ose.event_json, '$.draftId') AS TEXT),
            'companyGoalId', goal.id,
            'companyGoalName', goal.name,
            'reviewedContentHash', CAST(json_extract(ose.event_json, '$.reviewedContentHash') AS TEXT),
            'contentHash', CAST(json_extract(ose.event_json, '$.contentHash') AS TEXT),
            'currentContentHash', CAST(json_extract(ose.event_json, '$.evidence.currentContentHash') AS TEXT),
            'risk', CAST(json_extract(ose.event_json, '$.risk') AS TEXT),
            'allowRiskAtOrBelow', CAST(json_extract(ose.event_json, '$.allowRiskAtOrBelow') AS TEXT),
            'delegatedBy', CAST(json_extract(ose.event_json, '$.delegatedBy') AS TEXT),
            'code', CAST(json_extract(ose.event_json, '$.code') AS TEXT),
            'reason', CAST(json_extract(ose.event_json, '$.reason') AS TEXT),
            'hashMatched', json_extract(ose.event_json, '$.evidence.hashMatched'),
            'taskCount', COALESCE(json_array_length(ose.event_json, '$.taskIds'), 0)
          ) AS metadata_json,
          NULL AS agent_id,
          NULL AS agent_name,
          ose.occurred_at AS created_at
        FROM overseer_session_events ose
        INNER JOIN sprints goal ON goal.id = CAST(json_extract(ose.event_json, '$.companyGoalId') AS TEXT)
        INNER JOIN projects p ON p.id = goal.project_id
        LEFT JOIN companies c ON c.id = ose.company_id
        WHERE ${signoffWhereParts.join(" AND ")}

        UNION ALL

        SELECT
          'audit:' || cae.id AS event_id,
          NULL AS task_event_uuid,
          cae.event_type AS event_type,
          cae.task_id AS task_id,
          t.title AS task_title,
          t.task_key AS task_key,
          t.sprint_id AS sprint_id,
          s.name AS sprint_name,
          p.id AS project_id,
          p.slug AS project_slug,
          p.name AS project_name,
          c.id AS company_id,
          c.slug AS company_slug,
          c.company_code AS company_code,
          c.name AS company_name,
          NULL AS from_status,
          NULL AS to_status,
          cae.metadata_json AS metadata_json,
          cae.agent_id AS agent_id,
          a.name AS agent_name,
          cae.created_at AS created_at
        FROM company_audit_events cae
        LEFT JOIN tasks t ON t.id = cae.task_id
        LEFT JOIN sprints s ON s.id = t.sprint_id
        INNER JOIN projects p ON p.id = COALESCE(t.project_id, CAST(json_extract(cae.metadata_json, '$.projectId') AS TEXT))
        LEFT JOIN companies c ON c.id = cae.company_id
        LEFT JOIN agents a ON a.id = cae.agent_id
        WHERE ${improveWhereParts.join(" AND ")}
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
        company_code,
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
    .all(
      ...taskParams,
      ...sprintParams,
      ...draftParams,
      ...crewParams,
      ...boardParams,
      ...signoffParams,
      ...improveParams,
      input.limit + 1,
    ) as ActivityFeedEventRow[];

  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);

  return {
    activity: pageRows.map((row) => {
      const metadata = enrichActivityMetadata(row, parseJsonObject(row.metadata_json));
      const eventType = row.event_type;
      const taskTitle = row.task_title ?? undefined;
      const sprintName = row.sprint_name ?? undefined;
      const assigneeName =
        typeof metadata.assignee === "string" && metadata.assignee.trim()
          ? metadata.assignee
          : undefined;

      const agentLabel = row.agent_name ?? assigneeName ?? "Someone";
      const message = buildActivityMessage({ row, metadata, taskTitle, sprintName, agentLabel });

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
        agentName: eventType === "task.read_marked"
          ? "Board"
          : isImproveActivityEventType(eventType) && !row.agent_name
            ? "Improve"
            : (row.agent_name ?? assigneeName),
        metadata,
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
