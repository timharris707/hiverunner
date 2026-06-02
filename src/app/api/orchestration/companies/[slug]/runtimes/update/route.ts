import { NextRequest, NextResponse } from "next/server";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  detectLocalRuntimeCandidates,
  getLocalRuntimeCliUpdateJob,
  getLocalRuntimeCliUpdateJobForProvider,
  probeCompanyRuntimes,
  startLocalRuntimeCliUpdate,
  type RuntimeCliUpdateJob,
} from "@/lib/orchestration/runtime-registry";
import { resolveCompanyId } from "@/lib/orchestration/service/shared";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

function buildPayload(companyId: string, updateJob: RuntimeCliUpdateJob | null) {
  const runtimeInventory = probeCompanyRuntimes(companyId);
  return {
    update: updateJob?.finished ? updateJob : undefined,
    updateJob,
    ...runtimeInventory,
    detectedLocalRuntimes: detectLocalRuntimeCandidates(),
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();
    const companyId = resolveCompanyId(db, slug);
    if (!companyId) {
      throw new OrchestrationApiError(404, "company_not_found", "Company not found");
    }

    const jobId = req.nextUrl.searchParams.get("jobId")?.trim();
    const provider = req.nextUrl.searchParams.get("provider")?.trim();
    const updateJob = jobId
      ? getLocalRuntimeCliUpdateJob(jobId)
      : provider
        ? getLocalRuntimeCliUpdateJobForProvider(provider)
        : null;

    if (jobId && !updateJob) {
      return NextResponse.json(
        { error: "Runtime CLI update job not found", code: "update_job_not_found" },
        { status: 404 },
      );
    }

    return NextResponse.json(buildPayload(companyId, updateJob));
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[company-runtimes:update] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();
    const companyId = resolveCompanyId(db, slug);
    if (!companyId) {
      throw new OrchestrationApiError(404, "company_not_found", "Company not found");
    }

    const body = await req.json();
    const provider = typeof body?.provider === "string" ? body.provider : "";
    if (!provider.trim()) {
      throw new OrchestrationApiError(400, "missing_provider", "Runtime provider is required");
    }

    const updateJob = startLocalRuntimeCliUpdate(provider);

    return NextResponse.json(buildPayload(companyId, updateJob));
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("[company-runtimes:update] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
