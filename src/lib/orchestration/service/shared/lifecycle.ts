import type Database from "better-sqlite3";

import { parseJsonArray } from "./validators";
import type { DbTaskStatus } from "./types";

const NON_PRODUCTION_TOKENS = [
  "test",
  "tests",
  "testing",
  "demo",
  "dev",
  "staging",
  "sandbox",
  "sample",
  "fixture",
  "mock",
  "smoke",
  "seed",
  "chaos",
  "debug",
  "scratch",
  "tmp",
  "temp",
  "playground",
  "local",
] as const;

const NON_PRODUCTION_CREATED_BY = new Set(
  NON_PRODUCTION_TOKENS.map((token) => token.toLowerCase())
);
const AGENT_NON_PRODUCTION_TOKENS = NON_PRODUCTION_TOKENS.filter(
  (token) => token !== "qa"
);

function hasNonProductionToken(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return false;

  const tokens = new Set(normalized.split(/\s+/));
  return NON_PRODUCTION_TOKENS.some((token) => tokens.has(token));
}

function hasAgentNonProductionToken(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return false;

  const tokens = new Set(normalized.split(/\s+/));
  return AGENT_NON_PRODUCTION_TOKENS.some((token) => tokens.has(token));
}

function isNonProductionCompany(input: {
  slug: string;
  name: string;
  description: string | null;
}): boolean {
  return (
    hasNonProductionToken(input.slug) ||
    hasNonProductionToken(input.name) ||
    hasNonProductionToken(input.description)
  );
}

function isNonProductionProject(input: {
  slug: string;
  name: string;
  description: string | null;
}): boolean {
  return (
    hasNonProductionToken(input.slug) ||
    hasNonProductionToken(input.name) ||
    hasNonProductionToken(input.description)
  );
}

/**
 * Matches agents that are clearly test/debug/duplicate junk.
 * Patterns: "Duplicate Agent", "Forge QA", "Guard Agent",
 * "Test Agent", "[CP-TEST]", "[AGENT-TEST]",
 * "Graduation Test", numbered generic "Agent-N" names, plus the standard
 * non-production tokens in name/role.
 */
function isNonProductionAgent(input: {
  name: string;
  role: string | null;
}): boolean {
  const name = input.name ?? "";
  // Exact patterns for known junk agent prefixes
  if (/^(Duplicate Agent|Error Agent|Forge QA|Guard Agent|Test Agent)\b/i.test(name)) return true;
  if (/^\[CP-TEST\]|\[AGENT-TEST\]|\[TEST-VIGIL\]|\[DEBUG\]/i.test(name)) return true;
  if (/^Graduation Test/i.test(name)) return true;
  // Generic numbered agents: "Agent-1", "Agent-12" etc.
  if (/^Agent-\d+$/i.test(name)) return true;
  // Also check standard non-production tokens in name and role
  if (hasAgentNonProductionToken(name)) return true;
  if (hasAgentNonProductionToken(input.role)) return true;
  return false;
}

function isNonProductionTask(input: {
  title: string;
  description: string | null;
  createdBy: string | null;
  labelsJson: string | null;
}): boolean {
  if (input.createdBy && NON_PRODUCTION_CREATED_BY.has(input.createdBy.trim().toLowerCase())) {
    return true;
  }

  if (hasNonProductionToken(input.title) || hasNonProductionToken(input.description)) {
    return true;
  }

  const labels = parseJsonArray(input.labelsJson ?? "[]");
  return labels.some((label) => hasNonProductionToken(label));
}

type TaskStatusCounts = {
  backlog: number;
  on_deck: number;
  in_progress: number;
  review: number;
  done: number;
  blocked: number;
  total: number;
};

function deriveParentStatusFromChildren(counts: TaskStatusCounts): DbTaskStatus {
  if (counts.total === 0) return "done";
  if (counts.done === counts.total) return "done";
  if (counts.blocked > 0) return "blocked";
  if (counts.review > 0) return "review";
  if (counts.in_progress > 0) return "in_progress";
  if (counts.on_deck > 0) return "on_deck";
  return "backlog";
}

function reconcileParentTaskStatus(db: Database.Database, parentTaskId: string, now: string): void {
  const parent = db
    .prepare("SELECT id, parent_task_id, status FROM tasks WHERE id = ? AND archived_at IS NULL LIMIT 1")
    .get(parentTaskId) as { id: string; parent_task_id: string | null; status: DbTaskStatus } | undefined;

  if (!parent) return;

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
         SUM(CASE WHEN status = 'on_deck' THEN 1 ELSE 0 END) AS on_deck,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
       FROM tasks
       WHERE parent_task_id = ? AND archived_at IS NULL`
    )
    .get(parentTaskId) as TaskStatusCounts;

  const nextStatus = deriveParentStatusFromChildren({
    backlog: Number(counts.backlog ?? 0),
    on_deck: Number(counts.on_deck ?? 0),
    in_progress: Number(counts.in_progress ?? 0),
    review: Number(counts.review ?? 0),
    done: Number(counts.done ?? 0),
    blocked: Number(counts.blocked ?? 0),
    total: Number(counts.total ?? 0),
  });

  if (nextStatus !== parent.status) {
    const completedAt = nextStatus === "done" ? now : null;
    const blockedReason = nextStatus === "blocked" ? "Blocked by child task state" : null;
    db.prepare(
      `UPDATE tasks
       SET status = ?, completed_at = ?, blocked_reason = ?, updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, completedAt, blockedReason, now, parentTaskId);
  }

  if (parent.parent_task_id) {
    reconcileParentTaskStatus(db, parent.parent_task_id, now);
  }
}

function reconcileSprintStatus(db: Database.Database, sprintId: string, now: string): void {
  const sprint = db
    .prepare("SELECT id, status FROM sprints WHERE id = ? LIMIT 1")
    .get(sprintId) as { id: string; status: "planning" | "active" | "completed" } | undefined;
  if (!sprint) return;

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
         SUM(CASE WHEN status = 'on_deck' THEN 1 ELSE 0 END) AS on_deck,
         SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review,
         SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked
       FROM tasks
       WHERE sprint_id = ? AND archived_at IS NULL`
    )
    .get(sprintId) as TaskStatusCounts;

  const total = Number(counts.total ?? 0);
  const done = Number(counts.done ?? 0);
  const active = Number(counts.in_progress ?? 0) + Number(counts.review ?? 0) + Number(counts.blocked ?? 0);
  const queued = Number(counts.backlog ?? 0) + Number(counts.on_deck ?? 0);

  let nextStatus: "planning" | "active" | "completed";
  if (total === 0) {
    nextStatus = "planning";
  } else if (done === total) {
    nextStatus = "completed";
  } else if (active > 0) {
    nextStatus = "active";
  } else if (queued > 0) {
    nextStatus = "planning";
  } else {
    nextStatus = "active";
  }

  if (nextStatus === sprint.status) return;

  db.prepare(
    `UPDATE sprints
     SET status = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextStatus, nextStatus === "completed" ? now : null, now, sprintId);
}

function reconcileTaskHierarchy(db: Database.Database, input: {
  touchedParentTaskIds?: Array<string | null | undefined>;
  touchedSprintIds?: Array<string | null | undefined>;
  now?: string;
}): void {
  const now = input.now ?? new Date().toISOString();

  const parentIds = new Set(
    (input.touchedParentTaskIds ?? [])
      .map((value) => (typeof value === "string" && value.trim() ? value : null))
      .filter((value): value is string => Boolean(value))
  );
  for (const parentId of parentIds) {
    reconcileParentTaskStatus(db, parentId, now);
  }

  const sprintIds = new Set(
    (input.touchedSprintIds ?? [])
      .map((value) => (typeof value === "string" && value.trim() ? value : null))
      .filter((value): value is string => Boolean(value))
  );
  for (const sprintId of sprintIds) {
    reconcileSprintStatus(db, sprintId, now);
  }
}

export {
  isNonProductionAgent,
  isNonProductionCompany,
  isNonProductionProject,
  isNonProductionTask,
  reconcileTaskHierarchy,
};
