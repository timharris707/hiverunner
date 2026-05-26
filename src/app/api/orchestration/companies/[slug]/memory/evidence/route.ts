import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getMemoryInjectionEvidenceForRun } from "@/lib/orchestration/memory-vault";

export const dynamic = "force-dynamic";

function parseTruthy(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const url = request.nextUrl ?? new URL(request.url);
    const executionRunId = url.searchParams.get("executionRunId") ??
      url.searchParams.get("runId");
    if (!executionRunId?.trim()) {
      return errorResponse(400, "missing_execution_run_id", "executionRunId or runId query parameter is required");
    }

    const limitRaw = Number(url.searchParams.get("limit") ?? "20");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 20;

    return NextResponse.json(
      getMemoryInjectionEvidenceForRun(slug, executionRunId, {
        limit,
        includeDiagnostics:
          parseTruthy(url.searchParams.get("includeDiagnostics")) ||
          parseTruthy(url.searchParams.get("diagnostics")) ||
          parseTruthy(url.searchParams.get("includeMemoryDiagnostics")),
      }),
    );
  } catch (error) {
    return handleRouteError(error, "memory.evidence:get");
  }
}
