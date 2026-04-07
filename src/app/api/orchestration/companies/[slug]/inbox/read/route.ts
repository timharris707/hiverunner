import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { markInboxEventsRead, markAllInboxRead, markInboxThreadRead } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestration/companies/:slug/inbox/read
 *
 * Mark inbox events as read.
 *
 * Body:
 *   { eventIds: string[] }  — mark specific events
 *   { all: true, beforeTimestamp?: string }  — mark all as read
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = (await req.json()) as {
      eventIds?: string[];
      all?: boolean;
      beforeTimestamp?: string;
      userId?: string;
      threadKey?: string;
      threadKind?: "task" | "approval";
    };

    if (body.all) {
      const result = markAllInboxRead({
        companyIdOrSlug: slug,
        userId: body.userId,
        beforeTimestamp: body.beforeTimestamp,
      });
      return NextResponse.json(result);
    }

    // Thread-level mark-as-read: marks ALL events for a task/approval thread
    if (body.threadKey && body.threadKind) {
      const result = markInboxThreadRead({
        companyIdOrSlug: slug,
        threadKey: body.threadKey,
        threadKind: body.threadKind,
        userId: body.userId,
      });
      return NextResponse.json(result);
    }

    if (!body.eventIds || !Array.isArray(body.eventIds) || body.eventIds.length === 0) {
      return errorResponse(400, "validation_error", "eventIds array is required (or use { all: true } or { threadKey, threadKind })");
    }

    const result = markInboxEventsRead({
      companyIdOrSlug: slug,
      eventIds: body.eventIds,
      userId: body.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[inbox-read] Error:", error);
    return handleRouteError(error, "company-inbox-read:post");
  }
}
