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

          // Fetch new activity events since last poll
          const events = db.prepare(
            `SELECT
              ae.id,
              ae.event_type,
              ae.task_id,
              t.title AS task_title,
              t.sequence_number,
              ae.project_id,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code,
              ae.old_status,
              ae.new_status,
              ae.message,
              ae.agent_id,
              a.name AS agent_name,
              ae.created_at AS timestamp
             FROM activity_events ae
             LEFT JOIN tasks t ON t.id = ae.task_id
             LEFT JOIN projects p ON p.id = ae.project_id
             LEFT JOIN companies c ON c.id = p.company_id
             LEFT JOIN agents a ON a.id = ae.agent_id
             WHERE ae.created_at > ?
               AND (c.slug = ? OR ? = '')
             ORDER BY ae.created_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug) as Array<Record<string, unknown>>;

          // Fetch new comments since last poll
          const comments = db.prepare(
            `SELECT
              tc.id,
              tc.task_id,
              t.title AS task_title,
              t.sequence_number,
              tc.author_name,
              tc.body,
              tc.type,
              tc.created_at AS timestamp,
              p.slug AS project_slug,
              p.name AS project_name,
              c.slug AS company_slug,
              c.company_code
             FROM task_comments tc
             JOIN tasks t ON t.id = tc.task_id
             JOIN projects p ON p.id = t.project_id
             JOIN companies c ON c.id = p.company_id
             WHERE tc.created_at > ?
               AND (c.slug = ? OR ? = '')
             ORDER BY tc.created_at ASC
             LIMIT 50`
          ).all(lastEventTime, companySlug, companySlug) as Array<Record<string, unknown>>;

          let latestTime = lastEventTime;

          for (const event of events) {
            const taskKey = event.sequence_number != null && event.company_code
              ? `${event.company_code}-${event.sequence_number}`
              : undefined;

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
              message: String(event.message ?? ""),
              timestamp: String(event.timestamp),
            };

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            if (String(event.timestamp) > latestTime) latestTime = String(event.timestamp);
          }

          for (const comment of comments) {
            const taskKey = comment.sequence_number != null && comment.company_code
              ? `${comment.company_code}-${comment.sequence_number}`
              : undefined;

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
