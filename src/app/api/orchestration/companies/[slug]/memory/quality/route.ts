import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import {
  getMemoryQualityDashboard,
  listMemoryQualityQueue,
  type MemoryCurationState,
  type MemoryQualityQueueType,
  type MemoryQualityTargetType,
} from "@/lib/orchestration/memory-quality";

export const dynamic = "force-dynamic";

function optionalString(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const view = request.nextUrl.searchParams.get("view")?.trim().toLowerCase() || "dashboard";
    if (view === "dashboard") {
      return NextResponse.json(getMemoryQualityDashboard(slug));
    }
    if (view !== "queue") {
      return NextResponse.json(
        { error: { code: "invalid_quality_view", message: "view must be dashboard or queue" } },
        { status: 400 },
      );
    }

    return NextResponse.json(listMemoryQualityQueue(slug, {
      queue: optionalString(request.nextUrl.searchParams.get("queue")) as MemoryQualityQueueType | undefined,
      state: optionalString(request.nextUrl.searchParams.get("state")) as MemoryCurationState | "all" | undefined,
      targetType: optionalString(request.nextUrl.searchParams.get("targetType")) as MemoryQualityTargetType | undefined,
      limit: optionalString(request.nextUrl.searchParams.get("limit")),
    }));
  } catch (error) {
    return handleRouteError(error, "memory.quality:get");
  }
}
