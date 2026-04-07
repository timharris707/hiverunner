import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listCompanyInboxQuerySchema } from "@/lib/orchestration/contracts";
import { listCompanyInbox } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listCompanyInboxQuerySchema.parse({
      projectId: req.nextUrl.searchParams.get("projectId") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      search: req.nextUrl.searchParams.get("search") ?? undefined,
      includeDone: req.nextUrl.searchParams.get("includeDone") ?? undefined,
      limit: req.nextUrl.searchParams.get("limit") ?? undefined,
      cursor: req.nextUrl.searchParams.get("cursor") ?? undefined,
      unreadSince: req.nextUrl.searchParams.get("unreadSince") ?? undefined,
      includeTaskSnapshot: req.nextUrl.searchParams.get("includeTaskSnapshot") ?? undefined,
    });

    // Fetch extra events to compensate for thread de-duplication, then collapse.
    // With ~340 task events across ~40 tasks, we need a high multiplier to ensure
    // 25 unique threads from sorted raw events where recent tasks may have many comments.
    const rawLimit = query.limit ?? 50;
    const overFetchLimit = Math.min(rawLimit * 40, 2000);

    const raw = listCompanyInbox({
      companyIdOrSlug: slug,
      projectId: query.projectId,
      status: query.status,
      search: query.search,
      includeDone: query.includeDone,
      limit: overFetchLimit,
      cursor: query.cursor,
      unreadSince: query.unreadSince,
      includeTaskSnapshot: query.includeTaskSnapshot,
    });

    // De-duplicate by thread: keep only the first (most recent) event per task/approval
    const seen = new Set<string>();
    const deduped = [];
    for (const event of raw.events) {
      const threadKey =
        event.kind === "approval" && event.approvalId
          ? `a:${event.approvalId}`
          : event.taskKey
            ? `t:${event.taskKey}`
            : `e:${event.id}`;
      if (!seen.has(threadKey)) {
        seen.add(threadKey);
        deduped.push(event);
      }
    }

    const pageEvents = deduped.slice(0, rawLimit);
    // Only signal hasMore if we actually produced more unique threads than the limit.
    // If deduped <= rawLimit, we've exhausted all unique threads in the raw data.
    const hasMore = deduped.length > rawLimit;

    // Build cursor from the last de-duplicated event using the server's format: base64url(createdAt|id)
    const lastEvent = pageEvents.at(-1);
    let nextCursor: string | undefined;
    if (hasMore && lastEvent) {
      nextCursor = Buffer.from(`${lastEvent.timestamp}|${lastEvent.id}`, "utf8").toString("base64url");
    }

    return NextResponse.json({
      ...raw,
      events: pageEvents,
      page: {
        limit: rawLimit,
        nextCursor,
        hasMore,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company inbox query", error.flatten());
    }
    return handleRouteError(error, "company-inbox:get");
  }
}
