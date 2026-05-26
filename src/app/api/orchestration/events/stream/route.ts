import { NextRequest } from "next/server";

import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE endpoint: GET /api/orchestration/events/stream
 *
 * Streams orchestration events (activity, comments, execution updates) in real time.
 * Clients connect and receive newline-delimited JSON events.
 *
 * Query params:
 *   company - company slug (required)
 *   since   - ISO timestamp to start from (optional, defaults to 5 min ago)
 */
export async function GET(req: NextRequest) {
  const companySlug = req.nextUrl.searchParams.get("company") ?? "";
  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam ?? new Date(Date.now() - 5 * 60 * 1000).toISOString();

  let lastEventTime = since;
  let disposed = false;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected", since: lastEventTime })}\n\n`));

      const poll = () => {
        if (disposed) return;

        try {
          const db = getOrchestrationDb();

          // Fetch new task_events since last poll. The schema uses task_events
          // (not activity_events); event_type values include task.created,
          // task.updated, task.assigned, task.unassigned, task.status_changed,
          // task.comment_added, task.archived, task.reordered.
          const events = db.prepare(
            `SELECT
              te.id,
              te.event_type,
              te.task_id,
              t.title AS task_title,
              t.task_number,
              t.task_key,
              t.status AS task_status,
              te.project_id,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code,
              s.id AS sprint_id,
              s.name AS sprint_name,
              s.status AS sprint_status,
              parent_s.id AS parent_goal_id,
              parent_s.name AS parent_goal_name,
              parent_s.status AS parent_goal_status,
              te.from_status,
              te.to_status,
              te.metadata_json,
              te.agent_id,
              a.name AS agent_name,
              te.created_at AS timestamp
             FROM task_events te
             LEFT JOIN tasks t ON t.id = te.task_id
             LEFT JOIN projects p ON p.id = te.project_id
             LEFT JOIN companies c ON c.id = p.company_id
             LEFT JOIN sprints s ON s.id = t.sprint_id
             LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
             LEFT JOIN agents a ON a.id = te.agent_id
             WHERE te.created_at > ?
               AND (c.slug = ? OR c.company_code = ? OR ? = '')
             ORDER BY te.created_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug, companySlug) as Array<Record<string, unknown>>;

          // Fetch new comments since last poll. Schema uses `comments` table.
          const comments = db.prepare(
            `SELECT
              cm.id,
              cm.task_id,
              t.title AS task_title,
              t.task_number,
              t.task_key,
              t.status AS task_status,
              COALESCE(ag.name, cm.author_user_id, 'Agent') AS author_name,
              cm.body,
              cm.type,
              cm.created_at AS timestamp,
              cm.updated_at,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code,
              s.id AS sprint_id,
              s.name AS sprint_name,
              s.status AS sprint_status,
              parent_s.id AS parent_goal_id,
              parent_s.name AS parent_goal_name,
              parent_s.status AS parent_goal_status
             FROM comments cm
             JOIN tasks t ON t.id = cm.task_id
             JOIN projects p ON p.id = t.project_id
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN sprints s ON s.id = t.sprint_id
             LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
             LEFT JOIN agents ag ON ag.id = cm.author_agent_id
             WHERE cm.created_at > ?
               AND (c.slug = ? OR c.company_code = ? OR ? = '')
             ORDER BY cm.created_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug, companySlug) as Array<Record<string, unknown>>;

          const goalEvents = db.prepare(
            `SELECT
              s.id AS sprint_id,
              s.name AS sprint_name,
              s.status AS sprint_status,
              s.goal_kind AS sprint_goal_kind,
              parent_s.id AS parent_goal_id,
              parent_s.name AS parent_goal_name,
              parent_s.status AS parent_goal_status,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code,
              s.created_at,
              s.updated_at AS timestamp
             FROM sprints s
             JOIN projects p ON p.id = s.project_id
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
             WHERE s.updated_at > ?
               AND (c.slug = ? OR c.company_code = ? OR ? = '')
             ORDER BY s.updated_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug, companySlug) as Array<Record<string, unknown>>;

          const contractEvents = db.prepare(
            `SELECT
              i.id,
              i.sprint_id,
              i.kind,
              i.created_at,
              i.updated_at,
              i.archived_at,
              s.name AS sprint_name,
              s.status AS sprint_status,
              s.goal_kind AS sprint_goal_kind,
              parent_s.id AS parent_goal_id,
              parent_s.name AS parent_goal_name,
              parent_s.status AS parent_goal_status,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code
             FROM goal_contract_items i
             JOIN sprints s ON s.id = i.sprint_id
             JOIN projects p ON p.id = s.project_id
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
             WHERE COALESCE(i.archived_at, i.updated_at) > ?
               AND (c.slug = ? OR c.company_code = ? OR ? = '')
             ORDER BY COALESCE(i.archived_at, i.updated_at) ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug, companySlug) as Array<Record<string, unknown>>;

          const evidenceEvents = db.prepare(
            `SELECT
              e.id,
              e.item_id,
              e.sprint_id,
              e.item_kind,
              e.status,
              e.source,
              e.created_at AS timestamp,
              s.name AS sprint_name,
              s.status AS sprint_status,
              s.goal_kind AS sprint_goal_kind,
              parent_s.id AS parent_goal_id,
              parent_s.name AS parent_goal_name,
              parent_s.status AS parent_goal_status,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code
             FROM goal_contract_evidence e
             JOIN sprints s ON s.id = e.sprint_id
             JOIN projects p ON p.id = s.project_id
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN sprints parent_s ON parent_s.id = s.parent_id
             WHERE e.created_at > ?
               AND (c.slug = ? OR c.company_code = ? OR ? = '')
             ORDER BY e.created_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug, companySlug) as Array<Record<string, unknown>>;

          const executionRunEvents = db.prepare(
            `SELECT
              er.id AS run_id,
              er.task_id,
              er.agent_id,
              er.status AS terminal_status,
              er.completed_at,
              er.updated_at AS timestamp,
              er.error_message,
              er.failure_class,
              t.title AS task_title,
              t.task_number,
              t.task_key,
              t.status AS task_status,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code,
              a.name AS agent_name
             FROM execution_runs er
             JOIN tasks t ON t.id = er.task_id
             JOIN projects p ON p.id = t.project_id
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN agents a ON a.id = er.agent_id
             WHERE er.updated_at > ?
               AND er.status IN ('cancelled', 'completed', 'failed', 'timed_out')
               AND (c.slug = ? OR c.company_code = ? OR ? = '')
             ORDER BY er.updated_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug, companySlug) as Array<Record<string, unknown>>;

          const heartbeatRunEvents = db.prepare(
            `SELECT
              hr.id AS run_id,
              hr.agent_id,
              a.name AS agent_name,
              hr.status AS run_status,
              hr.started_at,
              hr.finished_at,
              hr.error,
              hr.updated_at AS timestamp,
              t.id AS task_id,
              t.title AS task_title,
              t.task_number,
              t.task_key,
              t.status AS task_status,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code
             FROM heartbeat_runs hr
             JOIN companies c ON c.id = hr.company_id
             LEFT JOIN agents a ON a.id = hr.agent_id
             LEFT JOIN tasks t ON t.id = json_extract(hr.context_snapshot_json, '$.taskId')
             LEFT JOIN projects p ON p.id = t.project_id
             WHERE hr.updated_at > ?
               AND hr.status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')
               AND (c.slug = ? OR c.company_code = ? OR ? = '')
             ORDER BY hr.updated_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug, companySlug) as Array<Record<string, unknown>>;

          let latestTime = lastEventTime;

          for (const event of events) {
            const taskKey = (event.task_key as string | null) ??
              (event.task_number != null && event.company_code
                ? `${event.company_code}-${event.task_number}`
                : undefined);

            // Parse metadata to surface useful fields (assignee, priority).
            let metadata: Record<string, unknown> = {};
            try {
              metadata = event.metadata_json ? JSON.parse(String(event.metadata_json)) : {};
            } catch {
              metadata = {};
            }
            const metadataCompanyGoalId = typeof metadata.companyGoalId === "string" ? metadata.companyGoalId : undefined;
            const metadataCompanyGoalName = typeof metadata.companyGoalName === "string" ? metadata.companyGoalName : undefined;
            const isCompanyGoal = event.sprint_goal_kind === "company" && event.sprint_id;
            const companyGoalId = metadataCompanyGoalId ??
              (event.parent_goal_id ? String(event.parent_goal_id) : isCompanyGoal ? String(event.sprint_id) : undefined);
            const companyGoalName = metadataCompanyGoalName ??
              (event.parent_goal_name ? String(event.parent_goal_name) : isCompanyGoal ? String(event.sprint_name) : undefined);
            const companyGoalStatus = event.parent_goal_status
              ? String(event.parent_goal_status)
              : isCompanyGoal && event.sprint_status
                ? String(event.sprint_status)
                : undefined;

            const payload = {
              type: "activity",
              id: String(event.id),
              eventType: String(event.event_type),
              taskId: event.task_id ? String(event.task_id) : undefined,
              taskTitle: event.task_title ? String(event.task_title) : undefined,
              taskKey,
              taskStatus: event.task_status ? String(event.task_status) : undefined,
              projectSlug: event.project_slug ? String(event.project_slug) : undefined,
              projectName: event.project_name ? String(event.project_name) : undefined,
              sprintId: event.sprint_id ? String(event.sprint_id) : undefined,
              sprintName: event.sprint_name ? String(event.sprint_name) : undefined,
              sprintStatus: event.sprint_status ? String(event.sprint_status) : undefined,
              companyGoalId,
              companyGoalName,
              companyGoalStatus,
              agentId: event.agent_id ? String(event.agent_id) : undefined,
              agentName: event.agent_name ? String(event.agent_name) : undefined,
              fromStatus: event.from_status ? String(event.from_status) : undefined,
              toStatus: event.to_status ? String(event.to_status) : undefined,
              metadata,
              message: "",
              timestamp: String(event.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(event.timestamp) > latestTime) latestTime = String(event.timestamp);
          }

          for (const comment of comments) {
            const taskKey = (comment.task_key as string | null) ??
              (comment.task_number != null && comment.company_code
                ? `${comment.company_code}-${comment.task_number}`
                : undefined);

            const payload = {
              type: "comment",
              id: String(comment.id),
              taskId: String(comment.task_id),
              taskTitle: comment.task_title ? String(comment.task_title) : undefined,
              taskKey,
              taskStatus: comment.task_status ? String(comment.task_status) : undefined,
              author: String(comment.author_name ?? "Agent"),
              body: String(comment.body ?? ""),
              commentType: String(comment.type ?? "comment"),
              projectSlug: comment.project_slug ? String(comment.project_slug) : undefined,
              projectName: comment.project_name ? String(comment.project_name) : undefined,
              sprintId: comment.sprint_id ? String(comment.sprint_id) : undefined,
              sprintName: comment.sprint_name ? String(comment.sprint_name) : undefined,
              sprintStatus: comment.sprint_status ? String(comment.sprint_status) : undefined,
              companyGoalId: comment.parent_goal_id ? String(comment.parent_goal_id) : comment.sprint_id ? String(comment.sprint_id) : undefined,
              companyGoalName: comment.parent_goal_name ? String(comment.parent_goal_name) : comment.sprint_name ? String(comment.sprint_name) : undefined,
              companyGoalStatus: comment.parent_goal_status ? String(comment.parent_goal_status) : comment.sprint_status ? String(comment.sprint_status) : undefined,
              timestamp: String(comment.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(comment.timestamp) > latestTime) latestTime = String(comment.timestamp);
          }

          for (const goalEvent of goalEvents) {
            const isCompanyGoal = goalEvent.sprint_goal_kind === "company" && goalEvent.sprint_id;
            const payload = {
              type: "activity",
              id: `goal:${String(goalEvent.sprint_id)}:${String(goalEvent.timestamp)}`,
              eventType: String(goalEvent.created_at) === String(goalEvent.timestamp) ? "goal.created" : "goal.updated",
              projectSlug: goalEvent.project_slug ? String(goalEvent.project_slug) : undefined,
              projectName: goalEvent.project_name ? String(goalEvent.project_name) : undefined,
              sprintId: goalEvent.sprint_id ? String(goalEvent.sprint_id) : undefined,
              sprintName: goalEvent.sprint_name ? String(goalEvent.sprint_name) : undefined,
              sprintStatus: goalEvent.sprint_status ? String(goalEvent.sprint_status) : undefined,
              companyGoalId: goalEvent.parent_goal_id
                ? String(goalEvent.parent_goal_id)
                : isCompanyGoal
                  ? String(goalEvent.sprint_id)
                  : undefined,
              companyGoalName: goalEvent.parent_goal_name
                ? String(goalEvent.parent_goal_name)
                : isCompanyGoal && goalEvent.sprint_name
                  ? String(goalEvent.sprint_name)
                  : undefined,
              companyGoalStatus: goalEvent.parent_goal_status
                ? String(goalEvent.parent_goal_status)
                : isCompanyGoal && goalEvent.sprint_status
                  ? String(goalEvent.sprint_status)
                  : undefined,
              metadata: {
                goalKind: goalEvent.sprint_goal_kind ?? null,
              },
              message: "",
              timestamp: String(goalEvent.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(goalEvent.timestamp) > latestTime) latestTime = String(goalEvent.timestamp);
          }

          for (const contractEvent of contractEvents) {
            const timestamp = String(contractEvent.archived_at ?? contractEvent.updated_at);
            const isCompanyGoal = contractEvent.sprint_goal_kind === "company" && contractEvent.sprint_id;
            const eventType = contractEvent.archived_at
              ? "goal.contract_item_archived"
              : String(contractEvent.created_at) === String(contractEvent.updated_at)
                ? "goal.contract_item_created"
                : "goal.contract_item_updated";
            const payload = {
              type: "activity",
              id: `goal-contract:${String(contractEvent.id)}:${timestamp}`,
              eventType,
              projectSlug: contractEvent.project_slug ? String(contractEvent.project_slug) : undefined,
              projectName: contractEvent.project_name ? String(contractEvent.project_name) : undefined,
              sprintId: contractEvent.sprint_id ? String(contractEvent.sprint_id) : undefined,
              sprintName: contractEvent.sprint_name ? String(contractEvent.sprint_name) : undefined,
              sprintStatus: contractEvent.sprint_status ? String(contractEvent.sprint_status) : undefined,
              companyGoalId: contractEvent.parent_goal_id
                ? String(contractEvent.parent_goal_id)
                : isCompanyGoal
                  ? String(contractEvent.sprint_id)
                  : undefined,
              companyGoalName: contractEvent.parent_goal_name
                ? String(contractEvent.parent_goal_name)
                : isCompanyGoal && contractEvent.sprint_name
                  ? String(contractEvent.sprint_name)
                  : undefined,
              companyGoalStatus: contractEvent.parent_goal_status
                ? String(contractEvent.parent_goal_status)
                : isCompanyGoal && contractEvent.sprint_status
                  ? String(contractEvent.sprint_status)
                  : undefined,
              metadata: {
                itemId: String(contractEvent.id),
                kind: contractEvent.kind ? String(contractEvent.kind) : undefined,
                goalKind: contractEvent.sprint_goal_kind ?? null,
                archived: Boolean(contractEvent.archived_at),
              },
              message: "",
              timestamp,
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (timestamp > latestTime) latestTime = timestamp;
          }

          for (const evidenceEvent of evidenceEvents) {
            const isCompanyGoal = evidenceEvent.sprint_goal_kind === "company" && evidenceEvent.sprint_id;
            const payload = {
              type: "activity",
              id: `goal-evidence:${String(evidenceEvent.id)}`,
              eventType: "goal.contract_evidence_recorded",
              projectSlug: evidenceEvent.project_slug ? String(evidenceEvent.project_slug) : undefined,
              projectName: evidenceEvent.project_name ? String(evidenceEvent.project_name) : undefined,
              sprintId: evidenceEvent.sprint_id ? String(evidenceEvent.sprint_id) : undefined,
              sprintName: evidenceEvent.sprint_name ? String(evidenceEvent.sprint_name) : undefined,
              sprintStatus: evidenceEvent.sprint_status ? String(evidenceEvent.sprint_status) : undefined,
              companyGoalId: evidenceEvent.parent_goal_id
                ? String(evidenceEvent.parent_goal_id)
                : isCompanyGoal
                  ? String(evidenceEvent.sprint_id)
                  : undefined,
              companyGoalName: evidenceEvent.parent_goal_name
                ? String(evidenceEvent.parent_goal_name)
                : isCompanyGoal && evidenceEvent.sprint_name
                  ? String(evidenceEvent.sprint_name)
                  : undefined,
              companyGoalStatus: evidenceEvent.parent_goal_status
                ? String(evidenceEvent.parent_goal_status)
                : isCompanyGoal && evidenceEvent.sprint_status
                  ? String(evidenceEvent.sprint_status)
                  : undefined,
              metadata: {
                evidenceId: String(evidenceEvent.id),
                itemId: evidenceEvent.item_id ? String(evidenceEvent.item_id) : undefined,
                itemKind: evidenceEvent.item_kind ? String(evidenceEvent.item_kind) : undefined,
                status: evidenceEvent.status ? String(evidenceEvent.status) : undefined,
                source: evidenceEvent.source ? String(evidenceEvent.source) : undefined,
                goalKind: evidenceEvent.sprint_goal_kind ?? null,
              },
              message: "",
              timestamp: String(evidenceEvent.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(evidenceEvent.timestamp) > latestTime) latestTime = String(evidenceEvent.timestamp);
          }

          for (const runEvent of executionRunEvents) {
            const taskKey = (runEvent.task_key as string | null) ??
              (runEvent.task_number != null && runEvent.company_code
                ? `${runEvent.company_code}-${runEvent.task_number}`
                : undefined);
            const occurredAt = String(runEvent.completed_at ?? runEvent.timestamp);
            const terminalStatus = String(runEvent.terminal_status);
            const reason = runEvent.error_message
              ? String(runEvent.error_message)
              : runEvent.failure_class
                ? String(runEvent.failure_class)
                : `execution_run:${terminalStatus}`;
            const payload = {
              type: "execution_run_terminated",
              id: `execution-run:${String(runEvent.run_id)}:${String(runEvent.timestamp)}`,
              runId: String(runEvent.run_id),
              taskId: String(runEvent.task_id),
              taskTitle: runEvent.task_title ? String(runEvent.task_title) : undefined,
              taskKey,
              taskStatus: runEvent.task_status ? String(runEvent.task_status) : undefined,
              projectSlug: runEvent.project_slug ? String(runEvent.project_slug) : undefined,
              projectName: runEvent.project_name ? String(runEvent.project_name) : undefined,
              companySlug: runEvent.company_slug ? String(runEvent.company_slug) : undefined,
              companyCode: runEvent.company_code ? String(runEvent.company_code) : undefined,
              agentId: runEvent.agent_id ? String(runEvent.agent_id) : undefined,
              agentName: runEvent.agent_name ? String(runEvent.agent_name) : undefined,
              terminalStatus,
              reason,
              occurredAt,
              timestamp: String(runEvent.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(runEvent.timestamp) > latestTime) latestTime = String(runEvent.timestamp);
          }

          for (const runEvent of heartbeatRunEvents) {
            const taskKey = (runEvent.task_key as string | null) ??
              (runEvent.task_number != null && runEvent.company_code
                ? `${runEvent.company_code}-${runEvent.task_number}`
                : undefined);
            const payload = {
              type: "heartbeat_run_state_changed",
              id: `heartbeat-run:${String(runEvent.run_id)}:${String(runEvent.timestamp)}`,
              runId: String(runEvent.run_id),
              taskId: runEvent.task_id ? String(runEvent.task_id) : undefined,
              taskTitle: runEvent.task_title ? String(runEvent.task_title) : undefined,
              taskKey,
              taskStatus: runEvent.task_status ? String(runEvent.task_status) : undefined,
              projectSlug: runEvent.project_slug ? String(runEvent.project_slug) : undefined,
              projectName: runEvent.project_name ? String(runEvent.project_name) : undefined,
              companySlug: runEvent.company_slug ? String(runEvent.company_slug) : undefined,
              companyCode: runEvent.company_code ? String(runEvent.company_code) : undefined,
              agentId: runEvent.agent_id ? String(runEvent.agent_id) : undefined,
              agentName: runEvent.agent_name ? String(runEvent.agent_name) : undefined,
              runStatus: String(runEvent.run_status),
              startedAt: runEvent.started_at ? String(runEvent.started_at) : undefined,
              finishedAt: runEvent.finished_at ? String(runEvent.finished_at) : undefined,
              reason: runEvent.error ? String(runEvent.error) : undefined,
              timestamp: String(runEvent.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(runEvent.timestamp) > latestTime) latestTime = String(runEvent.timestamp);
          }

          lastEventTime = latestTime;
        } catch (err) {
          // Log but don't kill the stream
          console.warn("[sse] poll error:", err instanceof Error ? err.message : String(err));
        }

        // Poll every 3 seconds
        if (!disposed) {
          setTimeout(poll, 3000);
        }
      };

      // Start polling
      poll();

      // Keepalive every 15s
      const keepalive = setInterval(() => {
        if (disposed) { clearInterval(keepalive); return; }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          clearInterval(keepalive);
          disposed = true;
        }
      }, 15000);
    },
    cancel() {
      disposed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
