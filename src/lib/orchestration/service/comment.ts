import { randomUUID } from "crypto";

import {
  type CommentRow,
  type CommentSource,
  type CommentTypeInput,
  type OrchestrationTask,
  OrchestrationApiError,
  commentViewFromRow,
  getOrchestrationDb,
  getTaskRowForUpdate,
} from "./shared";
import { enqueueWakeup } from "../engine/wakeup-queue";
import { sanitizeAgentCommentLinks, shouldVerifyAgentCommentLinks } from "../comment-link-verification";
import { isHiveRunnerSystemAuthor } from "../system-authors";

export type TaskCommentWakeup = {
  wakeupRequestId: string;
  heartbeatRunId?: string;
  status: "queued" | "coalesced";
  reason: "user_comment_on_assigned_task";
};

export function listTaskComments(taskId: string): {
  taskId: string;
  comments: NonNullable<OrchestrationTask["comments"]>;
} {
  const db = getOrchestrationDb();
  const task = getTaskRowForUpdate(db, taskId);
  if (!task) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const rows = db
    .prepare(
      `SELECT
        c.id,
        c.task_id,
        c.body,
        c.type,
        c.source,
        c.external_ref,
        c.created_at,
        a.name AS author_name,
        a.emoji AS author_emoji,
        c.author_user_id
       FROM comments c
       LEFT JOIN agents a ON a.id = c.author_agent_id
       WHERE c.task_id = ?
       ORDER BY c.created_at ASC`
    )
    .all(taskId) as CommentRow[];

  return {
    taskId,
    comments: rows
      .filter((row) => !(row.source === "engine" && row.external_ref?.startsWith("engine:circuit_breaker:") && task.status !== "blocked"))
      .map(commentViewFromRow),
  };
}

export function createTaskComment(input: {
  taskId: string;
  body: string;
  type: CommentTypeInput;
  authorAgentId?: string;
  authorUserId?: string;
  source?: CommentSource;
  externalRef?: string;
  createdAt?: string;
}): {
  comment: NonNullable<OrchestrationTask["comments"]>[number];
  wakeup?: TaskCommentWakeup;
} {
  const db = getOrchestrationDb();
  const task = getTaskRowForUpdate(db, input.taskId);
  if (!task) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  if (input.authorAgentId) {
    const author = db
      .prepare(
        `SELECT a.id
         FROM agents a
         INNER JOIN projects p ON p.id = ?
         WHERE a.id = ?
           AND a.company_id = p.company_id
           AND a.archived_at IS NULL
         LIMIT 1`
      )
      .get(task.project_id, input.authorAgentId) as { id: string } | undefined;

    if (!author) {
      throw new OrchestrationApiError(
        400,
        "invalid_comment_author",
        "authorAgentId must belong to the same company as the task project"
      );
    }
  }

  const source: CommentSource = input.source ?? "mission_control";
  const externalRef =
    typeof input.externalRef === "string" && input.externalRef.trim()
      ? input.externalRef.trim()
      : null;

  if (externalRef) {
    const existing = db
      .prepare(
        `SELECT
          c.id,
          c.task_id,
          c.body,
          c.type,
          c.source,
          c.external_ref,
          c.created_at,
          a.name AS author_name,
          a.emoji AS author_emoji,
          c.author_user_id
         FROM comments c
         LEFT JOIN agents a ON a.id = c.author_agent_id
         WHERE c.task_id = ? AND c.source = ? AND c.external_ref = ?
         LIMIT 1`
      )
      .get(task.id, source, externalRef) as CommentRow | undefined;

    if (existing) {
      return { comment: commentViewFromRow(existing) };
    }
  }

  const now = new Date().toISOString();
  const sanitized = shouldVerifyAgentCommentLinks({
    authorAgentId: input.authorAgentId,
    authorUserId: input.authorUserId,
    source,
  })
    ? sanitizeAgentCommentLinks(input.body)
    : { body: input.body, invalidLinks: [] };
  const commentBody = sanitized.body;
  if (sanitized.invalidLinks.length > 0) {
    console.warn("[orchestration:comments] withheld agent comment with invalid external links", {
      taskId: task.id,
      source,
      invalidLinks: sanitized.invalidLinks.map((link) => ({ url: link.url, status: link.status, reason: link.reason })),
    });
  }
  const createdAt =
    typeof input.createdAt === "string" && input.createdAt.trim()
      ? input.createdAt.trim()
      : now;
  const commentId = randomUUID();
  const normalizedAuthorUserId = input.authorUserId?.trim() ?? "";
  const isGatewayImportedComment =
    normalizedAuthorUserId.startsWith("openclaw:");
  const isHiveRunnerSystemComment = isHiveRunnerSystemAuthor(normalizedAuthorUserId);
  const isHumanHiveRunnerComment =
    !input.authorAgentId &&
    Boolean(normalizedAuthorUserId) &&
    source === "mission_control" &&
    !isGatewayImportedComment &&
    !isHiveRunnerSystemComment;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO comments
        (id, task_id, author_agent_id, author_user_id, body, type, source, external_ref, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      commentId,
      task.id,
      input.authorAgentId ?? null,
      input.authorUserId ?? "api",
      commentBody,
      input.type,
      source,
      externalRef,
      createdAt,
      createdAt
    );

    db.prepare(
      `INSERT INTO task_events
        (id, project_id, task_id, agent_id, user_id, event_type, from_status, to_status, metadata_json, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      task.project_id,
      task.id,
      input.authorAgentId ?? task.assignee_agent_id ?? null,
      input.authorUserId ?? "api",
      "task.comment_added",
      task.status,
      task.status,
      JSON.stringify({ commentType: input.type, source, externalRef }),
      createdAt
    );

    db.prepare(
      `UPDATE tasks
       SET consecutive_noop_wakes = CASE WHEN ? THEN 0 ELSE consecutive_noop_wakes END,
           updated_at = ?
       WHERE id = ?`,
    ).run(isHumanHiveRunnerComment ? 1 : 0, createdAt, task.id);
    db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(createdAt, task.project_id);
  });

  tx();

  const commentWakeCompany = task.assignee_agent_id
    ? (db
        .prepare("SELECT company_id FROM projects WHERE id = ? LIMIT 1")
        .get(task.project_id) as { company_id: string } | undefined)
    : undefined;

  const shouldWakeAssignee =
    isHumanHiveRunnerComment &&
    Boolean(task.assignee_agent_id?.trim()) &&
    Boolean(commentWakeCompany?.company_id);

  let wakeup: TaskCommentWakeup | undefined;
  if (shouldWakeAssignee) {
    const wake = enqueueWakeup(
      {
        agentId: task.assignee_agent_id!,
        companyId: commentWakeCompany!.company_id,
        source: "api",
        reason: "user_comment_on_assigned_task",
        triggerDetail: `task_comment:${commentId}`,
        payload: {
          taskId: task.id,
          taskStatus: task.status,
          commentId,
          commentType: input.type,
          commentSource: source,
          commentAuthorUserId: normalizedAuthorUserId || null,
        },
        idempotencyKey: `task-comment-wake:${commentId}`,
      },
      db,
    );
    wakeup = {
      wakeupRequestId: wake.wakeupRequestId,
      heartbeatRunId: wake.heartbeatRunId || undefined,
      status: wake.status,
      reason: "user_comment_on_assigned_task",
    };
  }

  const row = db
    .prepare(
      `SELECT
        c.id,
        c.task_id,
        c.body,
        c.type,
        c.created_at,
        a.name AS author_name,
        a.emoji AS author_emoji,
        c.author_user_id
       FROM comments c
       LEFT JOIN agents a ON a.id = c.author_agent_id
       WHERE c.id = ?`
    )
    .get(commentId) as CommentRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(
      500,
      "comment_create_failed",
      "Comment created but reload failed"
    );
  }

  return { comment: commentViewFromRow(row), wakeup };
}
