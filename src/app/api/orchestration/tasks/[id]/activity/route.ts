import { NextRequest, NextResponse } from "next/server";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { handleRouteError } from "@/lib/orchestration/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/tasks/{id}/activity
 *
 * Returns the real event history for a task: task_events + comments merged
 * into a single chronological timeline. This powers the task-detail Activity tab.
 *
 * Excludes task.read_marked events (noisy, low-value).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;
    const db = getOrchestrationDb();

    // Fetch task_events (excluding read_marked — too noisy)
    const events = db
      .prepare(
        `SELECT
          te.id,
          te.event_type,
          te.from_status,
          te.to_status,
          te.agent_id,
          te.user_id,
          te.metadata_json,
          te.created_at,
          a.name AS agent_name,
          a.emoji AS agent_emoji
        FROM task_events te
        LEFT JOIN agents a ON a.id = te.agent_id
        WHERE te.task_id = ?
          AND te.event_type NOT IN ('task.read_marked', 'task.comment_added', 'task.reordered')
        ORDER BY te.created_at ASC`
      )
      .all(taskId) as Array<{
      id: string;
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      agent_id: string | null;
      user_id: string | null;
      metadata_json: string | null;
      created_at: string;
      agent_name: string | null;
      agent_emoji: string | null;
    }>;

    // Fetch comments
    const comments = db
      .prepare(
        `SELECT
          c.id,
          c.body,
          c.type,
          c.source,
          c.author_agent_id,
          c.author_user_id,
          c.created_at,
          a.name AS agent_name,
          a.emoji AS agent_emoji
        FROM comments c
        LEFT JOIN agents a ON a.id = c.author_agent_id
        WHERE c.task_id = ?
        ORDER BY c.created_at ASC`
      )
      .all(taskId) as Array<{
      id: string;
      body: string;
      type: string | null;
      source: string | null;
      author_agent_id: string | null;
      author_user_id: string | null;
      created_at: string;
      agent_name: string | null;
      agent_emoji: string | null;
    }>;

    // Merge into a unified timeline
    const timeline: Array<{
      id: string;
      kind: "event" | "comment";
      eventType?: string;
      fromStatus?: string | null;
      toStatus?: string | null;
      body?: string;
      commentType?: string | null;
      commentSource?: string | null;
      actorName: string | null;
      actorEmoji: string | null;
      actorId: string | null;
      metadata?: Record<string, unknown>;
      timestamp: string;
    }> = [];

    for (const e of events) {
      let metadata: Record<string, unknown> | undefined;
      if (e.metadata_json) {
        try { metadata = JSON.parse(e.metadata_json); } catch { /* skip */ }
      }
      timeline.push({
        id: e.id,
        kind: "event",
        eventType: e.event_type,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        actorName: e.agent_name,
        actorEmoji: e.agent_emoji,
        actorId: e.agent_id ?? e.user_id,
        metadata,
        timestamp: e.created_at,
      });
    }

    for (const c of comments) {
      timeline.push({
        id: `comment:${c.id}`,
        kind: "comment",
        body: c.body,
        commentType: c.type,
        commentSource: c.source,
        actorName: c.agent_name,
        actorEmoji: c.agent_emoji,
        actorId: c.author_agent_id ?? c.author_user_id,
        timestamp: c.created_at,
      });
    }

    // Sort chronologically (newest first for display)
    timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json({ timeline, totalEvents: events.length, totalComments: comments.length });
  } catch (error) {
    return handleRouteError(error, "tasks.activity");
  }
}
