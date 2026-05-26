import { NextRequest, NextResponse } from "next/server";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import {
  detectLocalRuntimeCandidates,
  probeCompanyRuntimes,
  updateLocalRuntimeCli,
} from "@/lib/orchestration/runtime-registry";
import { resolveCompanyId } from "@/lib/orchestration/service/shared";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

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

    const update = updateLocalRuntimeCli(provider);
    const runtimeInventory = probeCompanyRuntimes(companyId);

    return NextResponse.json({
      update,
      ...runtimeInventory,
      detectedLocalRuntimes: detectLocalRuntimeCandidates(),
    });
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
