import { NextResponse } from "next/server";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { runModelSourceConnectionProbe } from "@/lib/orchestration/model-source-credentials";
import { recordCompanyModelSourceProbe } from "@/lib/orchestration/service";
import { resolveCompanyId } from "@/lib/orchestration/service/shared";

export const dynamic = "force-dynamic";

function assertCompanyExists(slug: string): void {
  const companyId = resolveCompanyId(getOrchestrationDb(), slug);
  if (!companyId) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string; sourceId: string }> },
) {
  try {
    const { slug, sourceId } = await params;
    assertCompanyExists(slug);
    const probe = await runModelSourceConnectionProbe(sourceId);
    return NextResponse.json(recordCompanyModelSourceProbe({
      companyIdOrSlug: slug,
      probe,
    }));
  } catch (error) {
    if (error instanceof OrchestrationApiError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[company-model-sources:probe] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
