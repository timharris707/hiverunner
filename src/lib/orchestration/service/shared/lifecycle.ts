import { randomUUID } from "crypto";
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
const AGENT_NON_PRODUCTION_TOKENS = (NON_PRODUCTION_TOKENS as readonly string[]).filter(
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
  to_do: number;
  in_progress: number;
  review: number;
  done: number;
  blocked: number;
  total: number;
};

type ParentTaskRow = {
  id: string;
  parent_task_id: string | null;
  project_id: string;
  status: DbTaskStatus;
  assignee_agent_id: string | null;
};

function deriveParentStatusFromChildren(counts: TaskStatusCounts): DbTaskStatus {
  if (counts.total === 0) return "done";
  if (counts.done === counts.total) return "done";
  if (counts.blocked > 0) return "blocked";
  if (counts.in_progress > 0) return "in_progress";
  const waiting = counts.to_do + counts.backlog;
  if (waiting > 0) {
    return counts.review > 0 || counts.done > 0 ? "in_progress" : "to-do";
  }
  if (counts.review > 0) return "review";
  return "backlog";
}

function truncateForHierarchySummary(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}

function resolveParentCompletionOwner(
  db: Database.Database,
  parentTaskId: string,
): { id: string; name: string | null } | null {
  const latestCompletionActor = db
    .prepare(
      `SELECT e.agent_id AS id, a.name AS name
         FROM task_events e
         JOIN tasks child ON child.id = e.task_id
         LEFT JOIN agents a ON a.id = e.agent_id
        WHERE child.parent_task_id = ?
          AND child.archived_at IS NULL
          AND e.event_type = 'task.status_changed'
          AND e.to_status = 'done'
          AND e.agent_id IS NOT NULL
        ORDER BY e.created_at DESC
        LIMIT 1`,
    )
    .get(parentTaskId) as { id: string; name: string | null } | undefined;
  if (latestCompletionActor?.id) return latestCompletionActor;

  const latestChildAssignee = db
    .prepare(
      `SELECT child.assignee_agent_id AS id, a.name AS name
         FROM tasks child
         LEFT JOIN agents a ON a.id = child.assignee_agent_id
        WHERE child.parent_task_id = ?
          AND child.archived_at IS NULL
          AND child.status = 'done'
          AND child.assignee_agent_id IS NOT NULL
        ORDER BY child.updated_at DESC
        LIMIT 1`,
    )
    .get(parentTaskId) as { id: string; name: string | null } | undefined;

  return latestChildAssignee?.id ? latestChildAssignee : null;
}

function buildParentCompletionComment(db: Database.Database, parentTaskId: string): string {
  const children = db
    .prepare(
      `SELECT child.task_key,
              child.title,
              child.status,
              a.name AS assignee_name
         FROM tasks child
         LEFT JOIN agents a ON a.id = child.assignee_agent_id
        WHERE child.parent_task_id = ?
          AND child.archived_at IS NULL
        ORDER BY COALESCE(child.task_number, 0), child.created_at`,
    )
    .all(parentTaskId) as Array<{
      task_key: string | null;
      title: string;
      status: string;
      assignee_name: string | null;
    }>;

  const latestChildComment = db
    .prepare(
      `SELECT child.task_key,
              c.body
         FROM comments c
         JOIN tasks child ON child.id = c.task_id
        WHERE child.parent_task_id = ?
          AND child.archived_at IS NULL
        ORDER BY c.created_at DESC
        LIMIT 1`,
    )
    .get(parentTaskId) as { task_key: string | null; body: string } | undefined;

  const lines = [
    "**Parent task completed from subtasks**",
    "",
    `All ${children.length} subtask${children.length === 1 ? "" : "s"} are done, so HiveRunner moved this parent task to Done.`,
  ];

  if (children.length > 0) {
    lines.push("");
    for (const child of children) {
      const key = child.task_key ?? "Child task";
      const owner = child.assignee_name ? ` — ${child.assignee_name}` : "";
      lines.push(`- ${key}: ${truncateForHierarchySummary(child.title, 120)} (${child.status}${owner})`);
    }
  }

  if (latestChildComment?.body) {
    lines.push("");
    lines.push(
      `Latest child update${latestChildComment.task_key ? ` (${latestChildComment.task_key})` : ""}: ${truncateForHierarchySummary(latestChildComment.body, 260)}`,
    );
  }

  return lines.join("\n");
}

function reconcileParentTaskStatus(db: Database.Database, parentTaskId: string, now: string): void {
  const parent = db
    .prepare(
      `SELECT id, parent_task_id, project_id, status, assignee_agent_id
         FROM tasks
        WHERE id = ? AND archived_at IS NULL
        LIMIT 1`,
    )
    .get(parentTaskId) as ParentTaskRow | undefined;

  if (!parent) return;

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'backlog' THEN 1 ELSE 0 END) AS backlog,
         SUM(CASE WHEN status = 'to-do' THEN 1 ELSE 0 END) AS to_do,
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
    to_do: Number(counts.to_do ?? 0),
    in_progress: Number(counts.in_progress ?? 0),
    review: Number(counts.review ?? 0),
    done: Number(counts.done ?? 0),
    blocked: Number(counts.blocked ?? 0),
    total: Number(counts.total ?? 0),
  });

  if (nextStatus !== parent.status) {
    const latestStatusEvent = db
      .prepare(
        `SELECT id, agent_id, metadata_json, created_at
         FROM task_events
         WHERE task_id = ?
           AND event_type = 'task.status_changed'
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(parentTaskId) as { id: string; agent_id: string | null; metadata_json: string | null; created_at: string } | undefined;
    if (latestStatusEvent?.created_at) {
      let metadata: Record<string, unknown> = {};
      try {
        metadata = latestStatusEvent.metadata_json ? JSON.parse(latestStatusEvent.metadata_json) as Record<string, unknown> : {};
      } catch {
        metadata = {};
      }
      const ageMs = Date.parse(now) - Date.parse(latestStatusEvent.created_at);
      const recentExecutorTransition =
        Number.isFinite(ageMs) &&
        ageMs >= 0 &&
        ageMs <= 10 * 60 * 1000 &&
        metadata.source === "engine_action" &&
        Boolean(latestStatusEvent.agent_id) &&
        latestStatusEvent.agent_id === parent.assignee_agent_id;
      if (recentExecutorTransition) {
        db.prepare(
          `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
           VALUES (?, ?, ?, ?, 'task.status_changed', ?, ?, ?, ?)`
        ).run(
          randomUUID(),
          parent.project_id,
          parentTaskId,
          parent.assignee_agent_id,
          parent.status,
          parent.status,
          JSON.stringify({
            source: "hierarchy_reconcile",
            skipped: true,
            reason: "recent_executor_transition",
            deferred_to_event_id: latestStatusEvent.id,
            proposedStatus: nextStatus,
            childCounts: {
              backlog: Number(counts.backlog ?? 0),
              to_do: Number(counts.to_do ?? 0),
              in_progress: Number(counts.in_progress ?? 0),
              review: Number(counts.review ?? 0),
              done: Number(counts.done ?? 0),
              blocked: Number(counts.blocked ?? 0),
              total: Number(counts.total ?? 0),
            },
          }),
          now,
        );
        return;
      }
    }
    const completedAt = nextStatus === "done" ? now : null;
    const blockedReason = nextStatus === "blocked" ? "Blocked by child task state" : null;
    const completionOwner = nextStatus === "done" && !parent.assignee_agent_id
      ? resolveParentCompletionOwner(db, parentTaskId)
      : null;
    db.prepare(
      `UPDATE tasks
       SET status = ?,
           completed_at = ?,
           blocked_reason = ?,
           assignee_agent_id = COALESCE(assignee_agent_id, ?),
           assigned_at = CASE
             WHEN assignee_agent_id IS NULL AND ? IS NOT NULL THEN ?
             ELSE assigned_at
           END,
           updated_at = ?
       WHERE id = ?`
    ).run(nextStatus, completedAt, blockedReason, completionOwner?.id ?? null, completionOwner?.id ?? null, now, now, parentTaskId);

    if (completionOwner?.id) {
      db.prepare(
        `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, metadata_json, created_at)
         VALUES (?, ?, ?, ?, 'task.assigned', ?, ?)`,
      ).run(
        randomUUID(),
        parent.project_id,
        parentTaskId,
        completionOwner.id,
        JSON.stringify({
          source: "hierarchy_completion_owner",
          previousAssignee: null,
          newAssignee: completionOwner.id,
          assigneeName: completionOwner.name,
        }),
        now,
      );
    }

    db.prepare(
      `INSERT INTO task_events (id, project_id, task_id, agent_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, 'task.status_changed', ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      parent.project_id,
      parentTaskId,
      completionOwner?.id ?? parent.assignee_agent_id,
      parent.status,
      nextStatus,
      JSON.stringify({
        source: "hierarchy_reconcile",
        childCounts: {
          backlog: Number(counts.backlog ?? 0),
          to_do: Number(counts.to_do ?? 0),
          in_progress: Number(counts.in_progress ?? 0),
          review: Number(counts.review ?? 0),
          done: Number(counts.done ?? 0),
          blocked: Number(counts.blocked ?? 0),
          total: Number(counts.total ?? 0),
        },
      }),
      now,
    );

    if (nextStatus === "done") {
      const authorAgentId = parent.assignee_agent_id ?? completionOwner?.id ?? null;
      db.prepare(
        `INSERT INTO comments (id, task_id, author_agent_id, body, type, source, external_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'status_update', 'mission_control', ?, ?, ?)`,
      ).run(
        randomUUID(),
        parentTaskId,
        authorAgentId,
        buildParentCompletionComment(db, parentTaskId),
        `hierarchy:auto-complete:${parentTaskId}`,
        now,
        now,
      );
    }
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
         SUM(CASE WHEN status = 'to-do' THEN 1 ELSE 0 END) AS to_do,
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
  if (sprint.status !== "active" || total === 0 || done !== total) return;

  db.prepare(
    `UPDATE sprints
     SET status = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run("completed", now, now, sprintId);
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
