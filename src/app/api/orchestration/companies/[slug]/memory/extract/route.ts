import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { extractCompanyMemoryCandidates } from "@/lib/orchestration/memory-extractor";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const taskId = typeof body.taskId === "string" ? body.taskId : undefined;
    const limit = typeof body.limit === "number" ? body.limit : undefined;
    const dryRun = typeof body.dryRun === "boolean" ? body.dryRun : undefined;
    if (body.taskId !== undefined && !taskId?.trim()) {
      return errorResponse(400, "invalid_task_id", "taskId must be a non-empty string");
    }

    return NextResponse.json(extractCompanyMemoryCandidates(slug, { taskId, limit, dryRun }));
  } catch (error) {
    return handleRouteError(error, "company.memory.extract:post");
  }
}
