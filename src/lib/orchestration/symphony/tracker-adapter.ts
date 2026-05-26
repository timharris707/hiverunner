import type Database from "better-sqlite3";

import type { TaskExecutionEngine } from "@/lib/orchestration/types";
import type { TaskStatusInput } from "@/lib/orchestration/contracts";
import {
  getOrchestrationDb,
  resolveTaskExecutionEngine,
  type DbTaskStatus,
  type DbTaskExecutionEngine,
} from "@/lib/orchestration/service/shared";
import { createTaskComment, moveTask } from "@/lib/orchestration/service";

import {
  mapTaskRowToSymphonyIssue,
  type HiveRunnerSymphonyIssue,
  type HiveRunnerSymphonyIssueRow,
} from "./issue";

type TrackerTaskRow = HiveRunnerSymphonyIssueRow & {
  execution_engine: DbTaskExecutionEngine | null;
  project_settings_json: string | null;
  company_settings_json: string | null;
};

export type HiveRunnerSymphonyTrackerOptions = {
  companyIdOrSlug: string;
  projectIdOrSlug?: string;
  activeStates?: string[];
  terminalStates?: string[];
  executionEngine?: TaskExecutionEngine | "any";
  workerAgentIds?: string[];
  appBaseUrl?: string;
  actorUserId?: string;
};

export type HiveRunnerSymphonyTracker = {
  fetchCandidateIssues(): HiveRunnerSymphonyIssue[];
  fetchIssuesByStates(stateNames: string[]): HiveRunnerSymphonyIssue[];
  fetchIssueStatesByIds(issueIds: string[]): HiveRunnerSymphonyIssue[];
  createComment(issueId: string, body: string): { taskId: string; commentId: string };
  updateIssueState(issueId: string, stateName: string): HiveRunnerSymphonyIssue;
};

type CompanyRef = {
  id: string;
};

const DEFAULT_ACTIVE_STATES: DbTaskStatus[] = ["to-do", "in_progress"];
const DEFAULT_ACTOR = "symphony:tracker";

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeStateName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizeSymphonyTrackerState(value: string): DbTaskStatus | null {
  switch (normalizeStateName(value)) {
    case "backlog":
      return "backlog";
    case "todo":
    case "to_do":
    case "to-do":
      return "to-do";
    case "in_progress":
      return "in_progress";
    case "human_review":
    case "in_review":
    case "review":
      return "review";
    case "closed":
    case "complete":
    case "completed":
    case "done":
      return "done";
    case "blocked":
      return "blocked";
    default:
      return null;
  }
}

function dbStatusToApiStatus(status: DbTaskStatus): TaskStatusInput {
  switch (status) {
    case "to-do":
      return "to-do";
    case "in_progress":
      return "in-progress";
    default:
      return status;
  }
}

function resolveCompany(db: Database.Database, companyIdOrSlug: string): CompanyRef {
  const ref = companyIdOrSlug.trim();
  const row = db
    .prepare(
      `SELECT id
       FROM companies
       WHERE archived_at IS NULL
         AND (id = ? OR slug = ? OR company_code = ?)
       LIMIT 1`,
    )
    .get(ref, ref, ref.toUpperCase()) as CompanyRef | undefined;

  if (!row) {
    throw new Error(`HiveRunner company not found for Symphony tracker adapter: ${companyIdOrSlug}`);
  }
  return row;
}

function resolveTaskId(db: Database.Database, companyId: string, issueId: string): string {
  const ref = issueId.trim();
  const row = db
    .prepare(
      `SELECT t.id
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE t.archived_at IS NULL
         AND c.id = ?
         AND (t.id = ? OR t.task_key = ?)
       LIMIT 1`,
    )
    .get(companyId, ref, ref) as { id: string } | undefined;

  if (!row) {
    throw new Error(`HiveRunner task not found for Symphony issue: ${issueId}`);
  }
  return row.id;
}

function expectedExecutionEngine(options: HiveRunnerSymphonyTrackerOptions): TaskExecutionEngine | "any" {
  return options.executionEngine ?? "symphony";
}

function rowExecutionEngine(row: TrackerTaskRow): TaskExecutionEngine {
  return resolveTaskExecutionEngine({
    taskExecutionEngine: row.execution_engine,
    projectSettingsJson: row.project_settings_json,
    companySettingsJson: row.company_settings_json,
  }).engine;
}

function assignedToWorker(row: TrackerTaskRow, options: HiveRunnerSymphonyTrackerOptions, engine: TaskExecutionEngine): boolean {
  const expectedEngine = expectedExecutionEngine(options);
  if (expectedEngine !== "any" && engine !== expectedEngine) return false;

  const workerIds = unique(options.workerAgentIds ?? []);
  if (workerIds.length === 0) return true;
  return !row.assignee_agent_id || workerIds.includes(row.assignee_agent_id);
}

function issueFromRow(row: TrackerTaskRow, options: HiveRunnerSymphonyTrackerOptions): HiveRunnerSymphonyIssue {
  const engine = rowExecutionEngine(row);
  return mapTaskRowToSymphonyIssue(row, {
    appBaseUrl: options.appBaseUrl,
    executionEngine: engine,
    assignedToWorker: assignedToWorker(row, options, engine),
  });
}

function statusList(stateNames: string[] | undefined, fallback: DbTaskStatus[]): DbTaskStatus[] {
  if (!stateNames || stateNames.length === 0) return fallback;
  return unique(stateNames)
    .map(normalizeSymphonyTrackerState)
    .filter((status): status is DbTaskStatus => Boolean(status));
}

function loadTaskRows(
  db: Database.Database,
  companyId: string,
  input: {
    projectIdOrSlug?: string;
    statuses?: DbTaskStatus[];
    issueIds?: string[];
  },
): TrackerTaskRow[] {
  const where = [
    "t.archived_at IS NULL",
    "(p.id IS NULL OR p.archived_at IS NULL)",
    "c.id = ?",
  ];
  const args: unknown[] = [companyId];

  if (input.projectIdOrSlug?.trim()) {
    where.push("(p.id = ? OR p.slug = ?)");
    args.push(input.projectIdOrSlug.trim(), input.projectIdOrSlug.trim());
  }

  if (input.statuses) {
    if (input.statuses.length === 0) return [];
    where.push(`t.status IN (${input.statuses.map(() => "?").join(",")})`);
    args.push(...input.statuses);
  }

  if (input.issueIds) {
    const issueIds = unique(input.issueIds);
    if (issueIds.length === 0) return [];
    const placeholders = issueIds.map(() => "?").join(",");
    where.push(`(t.id IN (${placeholders}) OR t.task_key IN (${placeholders}))`);
    args.push(...issueIds, ...issueIds);
  }

  return db
    .prepare(
      `SELECT
         t.id,
         t.task_key,
         t.title,
         t.description,
         t.priority,
         t.type,
         t.status,
         t.labels_json,
         t.depends_on_json,
         t.due_date,
         t.assignee_agent_id,
         t.blocked_reason,
         t.execution_engine,
         t.created_at,
         t.updated_at,
         p.id AS project_id,
         p.slug AS project_slug,
         p.name AS project_name,
         p.settings_json AS project_settings_json,
         c.id AS company_id,
         c.slug AS company_slug,
         c.company_code AS company_code,
         c.name AS company_name,
         c.settings_json AS company_settings_json
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN companies c ON c.id = COALESCE(t.company_id, p.company_id)
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
         t.created_at ASC,
         t.id ASC`,
    )
    .all(...args) as TrackerTaskRow[];
}

function shouldIncludeCandidate(row: TrackerTaskRow, options: HiveRunnerSymphonyTrackerOptions): boolean {
  const expectedEngine = expectedExecutionEngine(options);
  const engine = rowExecutionEngine(row);
  if (expectedEngine !== "any" && engine !== expectedEngine) return false;
  return assignedToWorker(row, options, engine);
}

export function createHiveRunnerSymphonyTracker(options: HiveRunnerSymphonyTrackerOptions): HiveRunnerSymphonyTracker {
  const db = getOrchestrationDb();
  const company = resolveCompany(db, options.companyIdOrSlug);

  return {
    fetchCandidateIssues() {
      const statuses = statusList(options.activeStates, DEFAULT_ACTIVE_STATES);
      return loadTaskRows(db, company.id, {
        projectIdOrSlug: options.projectIdOrSlug,
        statuses,
      })
        .filter((row) => shouldIncludeCandidate(row, options))
        .map((row) => issueFromRow(row, options));
    },

    fetchIssuesByStates(stateNames: string[]) {
      const statuses = statusList(stateNames, []);
      if (statuses.length === 0) return [];
      return loadTaskRows(db, company.id, {
        projectIdOrSlug: options.projectIdOrSlug,
        statuses,
      })
        .filter((row) => shouldIncludeCandidate(row, options))
        .map((row) => issueFromRow(row, options));
    },

    fetchIssueStatesByIds(issueIds: string[]) {
      return loadTaskRows(db, company.id, {
        projectIdOrSlug: options.projectIdOrSlug,
        issueIds,
      }).map((row) => issueFromRow(row, options));
    },

    createComment(issueId: string, body: string) {
      const taskId = resolveTaskId(db, company.id, issueId);
      const result = createTaskComment({
        taskId,
        body,
        type: "comment",
        source: "engine",
        authorUserId: options.actorUserId ?? DEFAULT_ACTOR,
      });
      return { taskId, commentId: result.comment.id };
    },

    updateIssueState(issueId: string, stateName: string) {
      const taskId = resolveTaskId(db, company.id, issueId);
      const status = normalizeSymphonyTrackerState(stateName);
      if (!status) {
        throw new Error(`Unsupported HiveRunner task state for Symphony tracker adapter: ${stateName}`);
      }

      moveTask({
        taskId,
        status: dbStatusToApiStatus(status),
        actorUserId: options.actorUserId ?? DEFAULT_ACTOR,
        reviewNotes: status === "done" ? "Closed by external runner tracker adapter." : undefined,
      });

      const [row] = loadTaskRows(db, company.id, { issueIds: [taskId] });
      if (!row) {
        throw new Error(`HiveRunner task disappeared after Symphony state update: ${issueId}`);
      }
      return issueFromRow(row, options);
    },
  };
}
