import { randomUUID } from "crypto";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import type {
  OrchestrationRoutine,
  OrchestrationRoutineListItem,
  RoutineStatus,
  RoutinePriority,
  RoutineConcurrencyPolicy,
  RoutineCatchUpPolicy,
  RoutineRunStatus,
} from "@/lib/orchestration/types";

/* ── Row shapes ── */

type RoutineRow = {
  id: string;
  company_id: string;
  project_id: string | null;
  assignee_agent_id: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  concurrency_policy: string;
  catch_up_policy: string;
  created_at: string;
  updated_at: string;
};

type RoutineListRow = RoutineRow & {
  project_name: string | null;
  project_color: string | null;
  agent_name: string | null;
  agent_emoji: string | null;
  last_run_triggered_at: string | null;
  last_run_status: string | null;
};

/* ── Mappers ── */

function routineFromRow(row: RoutineRow): OrchestrationRoutine {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    assigneeAgentId: row.assignee_agent_id,
    title: row.title,
    description: row.description,
    priority: row.priority as RoutinePriority,
    status: row.status as RoutineStatus,
    concurrencyPolicy: row.concurrency_policy as RoutineConcurrencyPolicy,
    catchUpPolicy: row.catch_up_policy as RoutineCatchUpPolicy,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function routineListItemFromRow(row: RoutineListRow): OrchestrationRoutineListItem {
  return {
    ...routineFromRow(row),
    projectName: row.project_name,
    projectColor: row.project_color,
    agentName: row.agent_name,
    agentEmoji: row.agent_emoji,
    lastRun: row.last_run_triggered_at
      ? {
          triggeredAt: row.last_run_triggered_at,
          status: (row.last_run_status ?? "pending") as RoutineRunStatus,
        }
      : null,
  };
}

/* ── Helpers ── */

function resolveCompany(db: ReturnType<typeof getOrchestrationDb>, companyIdOrSlug: string) {
  // Try direct match (id, current slug, or stable company code), then fall back to stored slug alias.
  const row = db
    .prepare(
      `SELECT id
       FROM companies
       WHERE (id = ? OR slug = ? OR UPPER(company_code) = UPPER(?))
         AND archived_at IS NULL
       LIMIT 1`
    )
    .get(companyIdOrSlug, companyIdOrSlug, companyIdOrSlug) as { id: string } | undefined;
  if (row) return row.id;

  const alias = db
    .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(companyIdOrSlug) as { company_id: string } | undefined;
  if (alias) return alias.company_id;

  throw new OrchestrationApiError(404, "company_not_found", "Company not found");
}

/* ── Service functions ── */

export function listRoutines(input: {
  companyIdOrSlug: string;
  projectId?: string;
  status?: string;
}): { routines: OrchestrationRoutineListItem[] } {
  const db = getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);

  const whereParts = ["r.company_id = ?"];
  const args: unknown[] = [companyId];

  if (input.projectId) {
    whereParts.push("r.project_id = ?");
    args.push(input.projectId);
  }
  if (input.status) {
    whereParts.push("r.status = ?");
    args.push(input.status);
  }

  const rows = db
    .prepare(
      `SELECT
        r.*,
        p.name  AS project_name,
        p.color AS project_color,
        a.name  AS agent_name,
        a.emoji AS agent_emoji,
        lr.triggered_at AS last_run_triggered_at,
        lr.status        AS last_run_status
      FROM routines r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN agents a   ON a.id = r.assignee_agent_id
      LEFT JOIN (
        SELECT routine_id, triggered_at, status
        FROM routine_runs
        WHERE id IN (
          SELECT id FROM routine_runs rr2
          WHERE rr2.routine_id = routine_runs.routine_id
          ORDER BY rr2.created_at DESC
          LIMIT 1
        )
      ) lr ON lr.routine_id = r.id
      WHERE ${whereParts.join(" AND ")}
      ORDER BY r.created_at DESC`
    )
    .all(...args) as RoutineListRow[];

  return { routines: rows.map(routineListItemFromRow) };
}

export function getRoutine(routineId: string): { routine: OrchestrationRoutine } {
  const db = getOrchestrationDb();
  const row = db.prepare("SELECT * FROM routines WHERE id = ?").get(routineId) as RoutineRow | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "routine_not_found", "Routine not found");
  }
  return { routine: routineFromRow(row) };
}

export function getRoutineDetail(routineId: string): {
  routine: OrchestrationRoutineListItem;
  runs: Array<{
    id: string;
    source: string;
    status: RoutineRunStatus;
    triggeredAt: string;
    completedAt: string | null;
    failureReason: string | null;
  }>;
} {
  const db = getOrchestrationDb();
  const row = db
    .prepare(
      `SELECT
        r.*,
        p.name  AS project_name,
        p.color AS project_color,
        a.name  AS agent_name,
        a.emoji AS agent_emoji,
        lr.triggered_at AS last_run_triggered_at,
        lr.status        AS last_run_status
      FROM routines r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN agents a   ON a.id = r.assignee_agent_id
      LEFT JOIN (
        SELECT routine_id, triggered_at, status
        FROM routine_runs
        WHERE id IN (
          SELECT id FROM routine_runs rr2
          WHERE rr2.routine_id = routine_runs.routine_id
          ORDER BY rr2.created_at DESC
          LIMIT 1
        )
      ) lr ON lr.routine_id = r.id
      WHERE r.id = ?`
    )
    .get(routineId) as RoutineListRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "routine_not_found", "Routine not found");
  }

  const runs = db
    .prepare(
      `SELECT id, source, status, triggered_at, completed_at, failure_reason
       FROM routine_runs
       WHERE routine_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all(routineId) as Array<{
    id: string;
    source: string;
    status: string;
    triggered_at: string;
    completed_at: string | null;
    failure_reason: string | null;
  }>;

  return {
    routine: routineListItemFromRow(row),
    runs: runs.map((r) => ({
      id: r.id,
      source: r.source,
      status: r.status as RoutineRunStatus,
      triggeredAt: r.triggered_at,
      completedAt: r.completed_at,
      failureReason: r.failure_reason,
    })),
  };
}

export function createRoutine(input: {
  companyIdOrSlug: string;
  title: string;
  description?: string;
  projectId: string;
  assigneeAgentId: string;
  priority?: string;
  concurrencyPolicy?: string;
  catchUpPolicy?: string;
}): { routine: OrchestrationRoutine } {
  const db = getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO routines (id, company_id, project_id, assignee_agent_id, title, description, priority, concurrency_policy, catch_up_policy, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    companyId,
    input.projectId,
    input.assigneeAgentId,
    input.title,
    input.description ?? "",
    input.priority ?? "medium",
    input.concurrencyPolicy ?? "coalesce_if_active",
    input.catchUpPolicy ?? "skip_missed",
    now,
    now
  );

  return getRoutine(id);
}

export function updateRoutine(input: {
  routineId: string;
  title?: string;
  description?: string;
  projectId?: string;
  assigneeAgentId?: string;
  priority?: string;
  status?: string;
  concurrencyPolicy?: string;
  catchUpPolicy?: string;
}): { routine: OrchestrationRoutine } {
  const db = getOrchestrationDb();

  const existing = db.prepare("SELECT id FROM routines WHERE id = ?").get(input.routineId) as { id: string } | undefined;
  if (!existing) {
    throw new OrchestrationApiError(404, "routine_not_found", "Routine not found");
  }

  const sets: string[] = [];
  const args: unknown[] = [];

  if (input.title !== undefined) { sets.push("title = ?"); args.push(input.title); }
  if (input.description !== undefined) { sets.push("description = ?"); args.push(input.description); }
  if (input.projectId !== undefined) { sets.push("project_id = ?"); args.push(input.projectId); }
  if (input.assigneeAgentId !== undefined) { sets.push("assignee_agent_id = ?"); args.push(input.assigneeAgentId); }
  if (input.priority !== undefined) { sets.push("priority = ?"); args.push(input.priority); }
  if (input.status !== undefined) { sets.push("status = ?"); args.push(input.status); }
  if (input.concurrencyPolicy !== undefined) { sets.push("concurrency_policy = ?"); args.push(input.concurrencyPolicy); }
  if (input.catchUpPolicy !== undefined) { sets.push("catch_up_policy = ?"); args.push(input.catchUpPolicy); }

  if (sets.length === 0) return getRoutine(input.routineId);

  sets.push("updated_at = ?");
  args.push(new Date().toISOString());
  args.push(input.routineId);

  db.prepare(`UPDATE routines SET ${sets.join(", ")} WHERE id = ?`).run(...args);

  return getRoutine(input.routineId);
}

export function runRoutine(routineId: string): { run: { id: string; status: string } } {
  const db = getOrchestrationDb();

  const routine = db.prepare("SELECT id, company_id, status FROM routines WHERE id = ?").get(routineId) as
    | { id: string; company_id: string; status: string }
    | undefined;
  if (!routine) {
    throw new OrchestrationApiError(404, "routine_not_found", "Routine not found");
  }
  if (routine.status === "archived") {
    throw new OrchestrationApiError(400, "routine_archived", "Cannot run an archived routine");
  }

  const runId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO routine_runs (id, routine_id, company_id, source, status, triggered_at, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', 'completed', ?, ?, ?)`
  ).run(runId, routineId, routine.company_id, now, now, now);

  return { run: { id: runId, status: "completed" } };
}
