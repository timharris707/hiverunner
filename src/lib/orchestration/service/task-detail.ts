import { getOrchestrationDb } from "@/lib/orchestration/db";
import type {
  OrchestrationTask,
  OrchestrationTaskDetail,
  OrchestrationTaskDetailSummary,
  OrchestrationTaskRunSummary,
  OrchestrationTaskTimelineItem,
} from "@/lib/orchestration/types";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { taskById } from "./shared";

function asJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asSummary(task: OrchestrationTask): OrchestrationTaskDetailSummary {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    priority: task.priority,
    type: task.type,
    assignee: task.assignee,
    updated: task.updated,
    created: task.created,
  };
}

function taskEventSummary(eventType: string, fromStatus?: string | null, toStatus?: string | null): string {
  switch (eventType) {
    case "task.created":
      return "Task created";
    case "task.status_changed":
      return fromStatus && toStatus ? `Status changed from ${fromStatus} to ${toStatus}` : "Status changed";
    case "task.assigned":
      return "Task assigned";
    case "task.unassigned":
      return "Task unassigned";
    case "task.updated":
      return "Task updated";
    case "task.archived":
      return "Task archived";
    case "task.comment_added":
      return "Comment added";
    default:
      return eventType.replace(/^task\./, "").replace(/_/g, " ");
  }
}

function runStatusSummary(status: string): string {
  switch (status) {
    case "queued":
    case "pending":
      return "Run queued";
    case "running":
      return "Run started";
    case "succeeded":
    case "completed":
      return "Run finished successfully";
    case "failed":
      return "Run failed";
    case "cancelled":
      return "Run cancelled";
    case "timed_out":
      return "Run timed out";
    default:
      return `Run ${status}`;
  }
}

function stableSortTimeline(items: OrchestrationTaskTimelineItem[]): OrchestrationTaskTimelineItem[] {
  const rank: Record<string, number> = {
    status_change: 0,
    approval_event: 1,
    run_event: 2,
    engine_event: 3,
    comment: 4,
    imported_report: 5,
    subtask_event: 6,
  };
  return [...items].sort((a, b) => {
    const ts = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (ts !== 0) return ts;
    const byRank = (rank[a.provenance] ?? 99) - (rank[b.provenance] ?? 99);
    if (byRank !== 0) return byRank;
    return a.id.localeCompare(b.id);
  });
}

function childTaskStatusRank(status: string): number {
  switch (status) {
    case "in-progress":
      return 0;
    case "review":
      return 1;
    case "blocked":
      return 2;
    case "on-deck":
      return 3;
    case "backlog":
      return 4;
    case "done":
      return 5;
    default:
      return 99;
  }
}

function sortChildTasks(items: OrchestrationTaskDetailSummary[]): OrchestrationTaskDetailSummary[] {
  return [...items].sort((a, b) => {
    const byStatus = childTaskStatusRank(a.status) - childTaskStatusRank(b.status);
    if (byStatus !== 0) return byStatus;
    const byUpdated = new Date(b.updated).getTime() - new Date(a.updated).getTime();
    if (byUpdated !== 0) return byUpdated;
    return a.id.localeCompare(b.id);
  });
}

export function getTaskDetail(taskId: string): { task: OrchestrationTask; detail: OrchestrationTaskDetail } {
  const db = getOrchestrationDb();
  const task = taskById(db, taskId);
  const taskRow = db
    .prepare(`SELECT id, project_id, parent_task_id, assignee_agent_id FROM tasks WHERE id = ? LIMIT 1`)
    .get(task.id) as { id: string; project_id: string; parent_task_id: string | null; assignee_agent_id: string | null } | undefined;

  if (!taskRow) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }

  const timeline: OrchestrationTaskTimelineItem[] = [];

  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.type, c.source, c.external_ref, c.created_at,
              a.name AS author_name, c.author_user_id
         FROM comments c
         LEFT JOIN agents a ON a.id = c.author_agent_id
        WHERE c.task_id = ?
        ORDER BY c.created_at DESC, c.id DESC`
    )
    .all(task.id) as Array<{
    id: string;
    body: string;
    type: string | null;
    source: string | null;
    external_ref: string | null;
    created_at: string;
    author_name: string | null;
    author_user_id: string | null;
  }>;

  for (const comment of comments) {
    const imported = comment.source === "paperclip" || comment.source === "openclaw";
    timeline.push({
      id: `comment:${comment.id}`,
      taskId: task.id,
      timestamp: comment.created_at,
      kind: imported ? "imported_report" : "comment",
      source: comment.source ?? "mission_control",
      actorLabel: comment.author_name ?? comment.author_user_id ?? (imported ? "Imported" : "System"),
      summary: imported ? "Imported report" : "Comment added",
      body: comment.body,
      metadata: {
        commentType: comment.type,
        externalRef: comment.external_ref,
      },
      provenance: imported ? "imported_report" : "comment",
    });
  }

  const taskEvents = db
    .prepare(
      `SELECT te.id, te.event_type, te.from_status, te.to_status, te.metadata_json, te.created_at,
              a.name AS agent_name, te.user_id
         FROM task_events te
         LEFT JOIN agents a ON a.id = te.agent_id
        WHERE te.task_id = ?
          AND te.event_type NOT IN ('task.read_marked', 'task.comment_added', 'task.reordered')
        ORDER BY te.created_at DESC, te.id DESC`
    )
    .all(task.id) as Array<{
    id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    metadata_json: string | null;
    created_at: string;
    agent_name: string | null;
    user_id: string | null;
  }>;

  for (const event of taskEvents) {
    const provenance = event.event_type === "task.status_changed" ? "status_change" : "engine_event";
    timeline.push({
      id: `task_event:${event.id}`,
      taskId: task.id,
      timestamp: event.created_at,
      kind: provenance,
      source: "task_events",
      actorLabel: event.agent_name ?? event.user_id ?? "System",
      summary: taskEventSummary(event.event_type, event.from_status, event.to_status),
      metadata: {
        eventType: event.event_type,
        fromStatus: event.from_status,
        toStatus: event.to_status,
        ...asJson(event.metadata_json),
      },
      provenance,
    });
  }

  const heartbeatRuns = db
    .prepare(
      `SELECT hb.id, hb.status, hb.invocation_source, hb.trigger_detail, hb.started_at, hb.finished_at, hb.created_at, hb.error,
              hb.wakeup_request_id, hb.result_json, hb.usage_json,
              wr.payload_json, wr.reason
         FROM heartbeat_runs hb
         LEFT JOIN agent_wakeup_requests wr ON wr.id = hb.wakeup_request_id
        WHERE hb.company_id = (SELECT p.company_id FROM projects p WHERE p.id = ?)
          AND (
            json_extract(wr.payload_json, '$.taskId') = ?
            OR json_extract(hb.context_snapshot_json, '$.taskId') = ?
          )
        ORDER BY COALESCE(hb.started_at, hb.created_at) DESC, hb.created_at DESC`
    )
    .all(taskRow.project_id, task.id, task.id) as Array<{
    id: string;
    status: string;
    invocation_source: string | null;
    trigger_detail: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    error: string | null;
    wakeup_request_id: string | null;
    result_json: string | null;
    usage_json: string | null;
    payload_json: string | null;
    reason: string | null;
  }>;

  const executionRuns = db
    .prepare(
      `SELECT er.id, er.provider, er.status, er.session_id, er.started_at, er.completed_at, er.error_message, er.created_at, er.token_usage_json
         FROM execution_runs er
        WHERE er.task_id = ?
        ORDER BY COALESCE(er.started_at, er.created_at) DESC, er.created_at DESC`
    )
    .all(task.id) as Array<{
    id: string;
    provider: string;
    status: string;
    session_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    created_at: string;
    token_usage_json: string | null;
  }>;

  const heartbeatRunIds = new Set(heartbeatRuns.map((run) => run.id));
  for (const run of heartbeatRuns) {
    timeline.push({
      id: `heartbeat_run:${run.id}`,
      taskId: task.id,
      timestamp: run.started_at ?? run.created_at,
      kind: "run_event",
      source: "heartbeat_runs",
      actorLabel: task.assignee ?? "Assigned agent",
      summary: runStatusSummary(run.status),
      metadata: {
        runTable: "heartbeat_runs",
        status: run.status,
        invocationSource: run.invocation_source,
        triggerDetail: run.trigger_detail,
        wakeReason: run.reason,
        finishedAt: run.finished_at,
        error: run.error,
        result: asJson(run.result_json),
        usage: asJson(run.usage_json),
      },
      linkedRunId: run.id,
      provenance: "run_event",
    });
  }

  for (const run of executionRuns) {
    timeline.push({
      id: `execution_run:${run.id}`,
      taskId: task.id,
      timestamp: run.started_at ?? run.created_at,
      kind: "run_event",
      source: "execution_runs",
      actorLabel: task.assignee ?? "Assigned agent",
      summary: runStatusSummary(run.status),
      metadata: {
        runTable: "execution_runs",
        provider: run.provider,
        status: run.status,
        sessionId: run.session_id,
        finishedAt: run.completed_at,
        error: run.error_message,
        usage: asJson(run.token_usage_json),
      },
      linkedRunId: run.id,
      provenance: "run_event",
    });
  }

  if (heartbeatRunIds.size > 0) {
    const placeholders = Array.from(heartbeatRunIds).map(() => "?").join(",");
    const runEvents = db
      .prepare(
        `SELECT hre.id, hre.run_id, hre.event_type, hre.detail, hre.created_at
           FROM heartbeat_run_events hre
          WHERE hre.run_id IN (${placeholders})
          ORDER BY hre.created_at DESC, hre.id DESC`
      )
      .all(...Array.from(heartbeatRunIds)) as Array<{
      id: string;
      run_id: string;
      event_type: string;
      detail: string;
      created_at: string;
    }>;

    for (const event of runEvents) {
      timeline.push({
        id: `heartbeat_run_event:${event.id}`,
        taskId: task.id,
        timestamp: event.created_at,
        kind: "run_event",
        source: "heartbeat_run_events",
        actorLabel: task.assignee ?? "Assigned agent",
        summary: event.event_type.replace(/_/g, " "),
        body: event.detail,
        metadata: {
          eventType: event.event_type,
        },
        linkedRunId: event.run_id,
        provenance: "run_event",
      });
    }
  }

  const approvals = db
    .prepare(
      `SELECT a.id, a.type, a.status, a.created_at, a.updated_at, a.decision_note,
              ag.name AS requested_by_name
         FROM approvals a
         LEFT JOIN agents ag ON ag.id = a.requested_by_agent_id
        WHERE a.linked_task_id = ?
        ORDER BY a.created_at DESC, a.id DESC`
    )
    .all(task.id) as Array<{
    id: string;
    type: string;
    status: string;
    created_at: string;
    updated_at: string;
    decision_note: string | null;
    requested_by_name: string | null;
  }>;

  for (const approval of approvals) {
    timeline.push({
      id: `approval:${approval.id}`,
      taskId: task.id,
      timestamp: approval.updated_at ?? approval.created_at,
      kind: "approval_event",
      source: "approvals",
      actorLabel: approval.requested_by_name ?? "Approval system",
      summary: `Approval ${approval.status}`,
      body: approval.decision_note ?? undefined,
      metadata: {
        approvalType: approval.type,
        status: approval.status,
      },
      linkedApprovalId: approval.id,
      provenance: "approval_event",
    });
  }

  const childRows = db
    .prepare(
      `SELECT id, task_key FROM tasks WHERE parent_task_id = ? AND archived_at IS NULL ORDER BY updated_at DESC, created_at DESC`
    )
    .all(task.id) as Array<{ id: string; task_key: string | null }>;
  const childTasks = sortChildTasks(childRows.map((row) => asSummary(taskById(db, row.id))));

  for (const child of childTasks) {
    timeline.push({
      id: `subtask:${child.id}`,
      taskId: task.id,
      timestamp: child.updated,
      kind: "subtask_event",
      source: "tasks",
      summary: `Subtask ${child.key ?? child.id} is ${child.status}`,
      metadata: {
        title: child.title,
        priority: child.priority,
        type: child.type,
      },
      linkedTaskId: child.id,
      provenance: "subtask_event",
    });
  }

  const parentTask = taskRow.parent_task_id ? asSummary(taskById(db, taskRow.parent_task_id)) : undefined;

  const activeRun = [...heartbeatRuns, ...executionRuns].find((run) => run.status === "running" || run.status === "queued" || run.status === "pending");
  const latestRun = [...heartbeatRuns, ...executionRuns][0];
  const runEventCount = heartbeatRunIds.size
    ? Number(
        (db
          .prepare(`SELECT COUNT(*) as count FROM heartbeat_run_events WHERE run_id IN (${Array.from(heartbeatRunIds).map(() => "?").join(",")})`)
          .get(...Array.from(heartbeatRunIds)) as { count: number } | undefined)?.count ?? 0
      )
    : 0;
  const importedReportCount = comments.filter((comment) => comment.source === "paperclip" || comment.source === "openclaw").length;

  const runSummary: OrchestrationTaskRunSummary = {
    totalRuns: heartbeatRuns.length + executionRuns.length,
    structuredActionCount: runEventCount,
    importedReportCount,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          provider: "provider" in latestRun ? latestRun.provider : "openclaw",
          status: latestRun.status,
          startedAt: latestRun.started_at ?? latestRun.created_at,
          finishedAt: "completed_at" in latestRun ? latestRun.completed_at : latestRun.finished_at,
          error: "error_message" in latestRun ? latestRun.error_message : latestRun.error,
        }
      : undefined,
    activeRun: activeRun
      ? {
          id: activeRun.id,
          provider: "provider" in activeRun ? activeRun.provider : "openclaw",
          status: activeRun.status,
          startedAt: activeRun.started_at ?? activeRun.created_at,
          finishedAt: "completed_at" in activeRun ? activeRun.completed_at : activeRun.finished_at,
          error: "error_message" in activeRun ? activeRun.error_message : activeRun.error,
        }
      : undefined,
  };

  return {
    task,
    detail: {
      task: asSummary(task),
      parentTask,
      childTasks,
      timeline: stableSortTimeline(timeline),
      runSummary,
    },
  };
}
