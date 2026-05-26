import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listMemoryIndexRecords } from "@/lib/orchestration/memory-vault";

export const dynamic = "force-dynamic";

function parseStatus(value: string | null): "active" | "archived" | "error" | "all" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "active" || normalized === "archived" || normalized === "error" || normalized === "all") {
    return normalized;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const statusParam = request.nextUrl.searchParams.get("status");
    const status = parseStatus(statusParam);
    if (statusParam && !status) {
      return errorResponse(400, "invalid_status", "status must be active, archived, error, or all");
    }

    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "200");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 200;

    return NextResponse.json(
      listMemoryIndexRecords(slug, {
        q: request.nextUrl.searchParams.get("q") ?? undefined,
        layer: request.nextUrl.searchParams.get("layer") ?? undefined,
        sourceId: request.nextUrl.searchParams.get("sourceId") ?? undefined,
        tag: request.nextUrl.searchParams.get("tag") ?? undefined,
        status,
        limit,
      }),
    );
  } catch (error) {
    return handleRouteError(error, "memory.index:get");
  }
}
