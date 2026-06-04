import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { getMemoryIndexStatus, listMemoryIndexRecords } from "@/lib/orchestration/memory-vault";
import { invalidQueryValueResponse, normalizeQueryParam } from "../../route-helpers";

export const dynamic = "force-dynamic";

type MemoryIndexStatus = "active" | "archived" | "error" | "all";

const MEMORY_INDEX_STATUSES: readonly MemoryIndexStatus[] = ["active", "archived", "error", "all"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const status = normalizeQueryParam(request.nextUrl.searchParams, "status", MEMORY_INDEX_STATUSES);
    const statusError = invalidQueryValueResponse(status, "invalid_status", "status must be active, archived, error, or all");
    if (statusError) return statusError;

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 200;

    const index = listMemoryIndexRecords(slug, {
      q: request.nextUrl.searchParams.get("q") ?? undefined,
      layer: request.nextUrl.searchParams.get("layer") ?? undefined,
      sourceId: request.nextUrl.searchParams.get("sourceId") ?? undefined,
      tag: request.nextUrl.searchParams.get("tag") ?? undefined,
      status: status.value,
      limit,
    });

    return NextResponse.json({
      ...index,
      indexStatus: getMemoryIndexStatus(slug),
    });
  } catch (error) {
    return handleRouteError(error, "memory.index:get");
  }
}
