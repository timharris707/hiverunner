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
              te.project_id,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code,
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
             LEFT JOIN agents a ON a.id = te.agent_id
             WHERE te.created_at > ?
               AND (c.slug = ? OR ? = '')
             ORDER BY te.created_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug) as Array<Record<string, unknown>>;

          // Fetch new comments since last poll. Schema uses `comments` table.
          const comments = db.prepare(
            `SELECT
              cm.id,
              cm.task_id,
              t.title AS task_title,
              t.task_number,
              t.task_key,
              COALESCE(ag.name, cm.author_user_id, 'Agent') AS author_name,
              cm.body,
              cm.type,
              cm.created_at AS timestamp,
              cm.updated_at,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code
             FROM comments cm
             JOIN tasks t ON t.id = cm.task_id
             JOIN projects p ON p.id = t.project_id
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN agents ag ON ag.id = cm.author_agent_id
             WHERE cm.created_at > ?
               AND (c.slug = ? OR ? = '')
             ORDER BY cm.created_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug) as Array<Record<string, unknown>>;

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

            const payload = {
              type: "activity",
              id: String(event.id),
              eventType: String(event.event_type),
              taskId: event.task_id ? String(event.task_id) : undefined,
              taskTitle: event.task_title ? String(event.task_title) : undefined,
              taskKey,
              projectSlug: event.project_slug ? String(event.project_slug) : undefined,
              projectName: event.project_name ? String(event.project_name) : undefined,
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
              author: String(comment.author_name ?? "Agent"),
              body: String(comment.body ?? ""),
              commentType: String(comment.type ?? "comment"),
              projectSlug: comment.project_slug ? String(comment.project_slug) : undefined,
              projectName: comment.project_name ? String(comment.project_name) : undefined,
              timestamp: String(comment.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(comment.timestamp) > latestTime) latestTime = String(comment.timestamp);
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
