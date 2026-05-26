import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { getMemoryGraph } from "@/lib/orchestration/memory-vault";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "300");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 300;
    return NextResponse.json(getMemoryGraph(slug, { limit }));
  } catch (error) {
    return handleRouteError(error, "memory.graph:get");
  }
}
