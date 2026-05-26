import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listCompanyInboxQuerySchema } from "@/lib/orchestration/contracts";
import { countCompanyInboxUnreadThreads, listCompanyInbox } from "@/lib/orchestration/company-service";

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
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
      summary: req.nextUrl.searchParams.get("summary") ?? undefined,
      kinds: req.nextUrl.searchParams.get("kinds") ?? undefined,
    });

    const pageLimit = query.limit ?? 50;

    // Parse optional kind filter (e.g. "task,approval" for the "Mine" tab)
    const kindSet = query.kinds
      ? new Set(query.kinds.split(",").map((k) => k.trim()).filter(Boolean))
      : null;

    if (query.summary) {
      const unreadCount = countCompanyInboxUnreadThreads({
        companyIdOrSlug: slug,
        projectId: query.projectId,
        status: query.status,
        search: query.search,
        includeDone: query.includeDone,
        unreadSince: query.unreadSince,
        includeArchived: query.includeArchived,
        kinds: kindSet ? Array.from(kindSet) : undefined,
      });

      return NextResponse.json({
        events: [],
        unreadCount,
        unreadSince: query.unreadSince,
        tasks: [],
        totals: {
          backlog: 0,
          "to-do": 0,
          "in-progress": 0,
          review: 0,
          done: 0,
          blocked: 0,
        },
        page: {
          limit: pageLimit,
          hasMore: false,
        },
      });
    }

    // ---------- Paginated thread list + unread count ----------
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
      includeArchived: query.includeArchived,
    });

    const threadKeyForEvent = (event: (typeof raw.events)[number]) =>
      event.kind === "approval" && event.approvalId
        ? `a:${event.approvalId}`
        : event.kind === "sprint_plan_draft" && event.draftId
          ? `d:${event.draftId}`
        : event.kind === "lead_supervisor_update" && event.companyGoalId
          ? `ls:${event.companyGoalId}`
        : event.taskKey
          ? `t:${event.taskKey}`
          : `e:${event.id}`;

    const unreadThreadKeys = new Set<string>();
    for (const event of raw.events) {
      if (kindSet && !kindSet.has(event.kind)) continue;
      if (!event.isRead) unreadThreadKeys.add(threadKeyForEvent(event));
    }

    // De-duplicate by thread, applying kind filter. The row read state is also
    // thread-level so the visible item matches the unread badge.
    const seen = new Set<string>();
    const deduped = [];
    for (const event of raw.events) {
      if (kindSet && !kindSet.has(event.kind)) continue;
      const threadKey = threadKeyForEvent(event);
      if (!seen.has(threadKey)) {
        seen.add(threadKey);
        deduped.push(unreadThreadKeys.has(threadKey) ? { ...event, isRead: false } : event);
      }
    }

    const pageEvents = deduped.slice(0, pageLimit);
    const hasMore = deduped.length > pageLimit;
    const threadUnreadCount = countCompanyInboxUnreadThreads({
      companyIdOrSlug: slug,
      projectId: query.projectId,
      status: query.status,
      search: query.search,
      includeDone: query.includeDone,
      unreadSince: query.unreadSince,
      includeArchived: query.includeArchived,
      kinds: kindSet ? Array.from(kindSet) : undefined,
    });

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
