import { randomUUID } from "crypto";

import {
  type DbSprintStatus,
  type OrchestrationSprint,
  OrchestrationApiError,
  type SprintRow,
  type SprintStatusInput,
  getOrchestrationDb,
  getProjectRow,
  sprintById,
  sprintFromRow,
  toDbSprintStatus,
} from "./shared";

export function listProjectSprints(projectIdOrSlug: string): { sprints: OrchestrationSprint[] } {
  const db = getOrchestrationDb();
  const project = getProjectRow(db, projectIdOrSlug);
  if (!project) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  const rows = db
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
       WHERE s.project_id = ?
       GROUP BY s.id
       ORDER BY
        CASE s.status
          WHEN 'active' THEN 1
          WHEN 'planning' THEN 2
          WHEN 'completed' THEN 3
          ELSE 4
        END,
        s.start_date DESC,
        s.created_at DESC`
    )
    .all(project.id) as SprintRow[];

  return { sprints: rows.map(sprintFromRow) };
}

export function createProjectSprint(input: {
  projectId: string;
  name: string;
  goal: string;
  status: SprintStatusInput;
  startDate?: string;
  endDate?: string | null;
}): { sprint: OrchestrationSprint } {
  const db = getOrchestrationDb();
  const project = getProjectRow(db, input.projectId);
  if (!project) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }

  const existing = db
    .prepare(
      "SELECT 1 FROM sprints WHERE project_id = ? AND lower(name) = lower(?) LIMIT 1"
    )
    .get(project.id, input.name);
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
      (id, project_id, name, goal, status, start_date, end_date, completed_at, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sprintId,
    project.id,
    input.name,
    input.goal,
    toDbSprintStatus(input.status),
    input.startDate ?? now,
    input.endDate ?? null,
    input.status === "done" ? now : null,
    now,
    now
  );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, project.id);

  const sprint = sprintById(db, sprintId);
  if (!sprint) {
    throw new OrchestrationApiError(500, "sprint_create_failed", "Sprint created but reload failed");
  }

  return { sprint: sprintFromRow(sprint) };
}

export function updateSprint(input: {
  sprintId: string;
  name?: string;
  goal?: string;
  status?: SprintStatusInput;
  startDate?: string;
  endDate?: string | null;
}): { sprint: OrchestrationSprint } {
  const db = getOrchestrationDb();
  const current = db
    .prepare(
      "SELECT id, project_id, name, goal, status, start_date, end_date, completed_at FROM sprints WHERE id = ?"
    )
    .get(input.sprintId) as
    | {
        id: string;
        project_id: string;
        name: string;
        goal: string;
        status: DbSprintStatus;
        start_date: string;
        end_date: string | null;
        completed_at: string | null;
      }
    | undefined;

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
  const completedAt =
    nextStatus === "completed"
      ? (current.completed_at ?? now)
      : null;

  db.prepare(
    `UPDATE sprints
     SET
      name = ?,
      goal = ?,
      status = ?,
      start_date = ?,
      end_date = ?,
      completed_at = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    input.name ?? current.name,
    input.goal ?? current.goal,
    nextStatus,
    input.startDate ?? current.start_date,
    input.endDate === undefined ? current.end_date : input.endDate,
    completedAt,
    now,
    current.id
  );

  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, current.project_id);

  const sprint = sprintById(db, current.id);
  if (!sprint) {
    throw new OrchestrationApiError(500, "sprint_update_failed", "Sprint updated but reload failed");
  }

  return { sprint: sprintFromRow(sprint) };
}

