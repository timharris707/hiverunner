import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listCompanyInboxQuerySchema } from "@/lib/orchestration/contracts";
import { listCompanyInbox } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

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
      kinds: req.nextUrl.searchParams.get("kinds") ?? undefined,
    });

    const pageLimit = query.limit ?? 50;

    // Parse optional kind filter (e.g. "task,approval" for the "Mine" tab)
    const kindSet = query.kinds
      ? new Set(query.kinds.split(",").map((k) => k.trim()).filter(Boolean))
      : null;

    // ---------- Unread count ----------
    // Always fetch the full event set (uncapped) for unread thread counting so the
    // badge is accurate regardless of the page limit.
    const fullRaw = listCompanyInbox({
      companyIdOrSlug: slug,
      projectId: query.projectId,
      status: query.status,
      search: query.search,
      includeDone: query.includeDone,
      limit: 5000,       // effectively unlimited — covers all events
      includeTaskSnapshot: false,
    });

    // Count distinct unread threads (matching kind filter)
    const unreadThreadKeys = new Set<string>();
    for (const event of fullRaw.events) {
      if (kindSet && !kindSet.has(event.kind)) continue;
      if (event.isRead) continue;
      const tk =
        event.kind === "approval" && event.approvalId
          ? `a:${event.approvalId}`
          : event.taskKey
            ? `t:${event.taskKey}`
            : `e:${event.id}`;
      unreadThreadKeys.add(tk);
    }
    const threadUnreadCount = unreadThreadKeys.size;

    // ---------- Paginated thread list ----------
    // Over-fetch raw events so we can de-duplicate by thread and fill the page.
    const overFetchLimit = Math.min(pageLimit * 40, 2000);
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

    // De-duplicate by thread, applying kind filter
    const seen = new Set<string>();
    const deduped = [];
    for (const event of raw.events) {
      if (kindSet && !kindSet.has(event.kind)) continue;
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

    const pageEvents = deduped.slice(0, pageLimit);
    const hasMore = deduped.length > pageLimit;

    const lastEvent = pageEvents.at(-1);
    let nextCursor: string | undefined;
    if (hasMore && lastEvent) {
      nextCursor = Buffer.from(`${lastEvent.timestamp}|${lastEvent.id}`, "utf8").toString("base64url");
    }

    return NextResponse.json({
      ...raw,
      events: pageEvents,
      unreadCount: threadUnreadCount,
      page: {
        limit: pageLimit,
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
