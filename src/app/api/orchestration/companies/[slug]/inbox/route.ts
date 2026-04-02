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
    });

    return NextResponse.json(
      listCompanyInbox({
        companyIdOrSlug: slug,
        projectId: query.projectId,
        status: query.status,
        search: query.search,
        includeDone: query.includeDone,
        limit: query.limit,
        cursor: query.cursor,
        unreadSince: query.unreadSince,
        includeTaskSnapshot: query.includeTaskSnapshot,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company inbox query", error.flatten());
    }
    return handleRouteError(error, "company-inbox:get");
  }
}
