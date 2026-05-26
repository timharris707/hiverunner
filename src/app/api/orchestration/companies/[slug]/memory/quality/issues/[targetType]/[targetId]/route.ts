import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import {
  getMemoryQualityIssueDetail,
  applyMemoryCurationAction,
  type MemoryQualityTargetType,
  type MemoryCurationAction,
} from "@/lib/orchestration/memory-quality";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; targetType: string; targetId: string }> },
) {
  try {
    const { slug, targetType, targetId } = await params;
    const body = await request.json();
    const action = body.action as MemoryCurationAction;
    const actor = body.actor as string | undefined;

    return NextResponse.json(applyMemoryCurationAction(slug, {
      targetType: targetType as MemoryQualityTargetType,
      targetId: decodeURIComponent(targetId),
      action,
      actor,
    }));
  } catch (error) {
    return handleRouteError(error, "memory.quality.issue:patch");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; targetType: string; targetId: string }> },
) {
  try {
    const { slug, targetType, targetId } = await params;
    return NextResponse.json(getMemoryQualityIssueDetail(
      slug,
      targetType as MemoryQualityTargetType,
      decodeURIComponent(targetId),
    ));
  } catch (error) {
    return handleRouteError(error, "memory.quality.issue:get");
  }
}
