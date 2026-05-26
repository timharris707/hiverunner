import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { archiveInboxEvents } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestration/companies/:slug/inbox/archive
 *
 * Archive (dismiss) inbox events so they no longer appear in the feed.
 *
 * Body:
 *   { eventIds: string[] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = (await req.json()) as {
      eventIds?: string[];
      userId?: string;
    };

    if (!body.eventIds || !Array.isArray(body.eventIds) || body.eventIds.length === 0) {
      return errorResponse(400, "validation_error", "eventIds array is required");
    }

    const result = archiveInboxEvents({
      companyIdOrSlug: slug,
      eventIds: body.eventIds,
      userId: body.userId,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[inbox-archive] Error:", error);
    return handleRouteError(error, "company-inbox-archive:post");
  }
}
