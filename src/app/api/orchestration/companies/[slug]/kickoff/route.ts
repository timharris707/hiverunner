import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { kickoffCompany } from "@/lib/orchestration/engine/engine";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();

    const company = db
      .prepare("SELECT id FROM companies WHERE slug = ? AND archived_at IS NULL LIMIT 1")
      .get(slug) as { id: string } | undefined;

    if (!company) {
      return errorResponse(404, "company_not_found", `Company '${slug}' not found`);
    }

    const body = await request.json().catch(() => ({}));
    const direction = typeof body.direction === "string" ? body.direction.trim() : undefined;

    const result = kickoffCompany(
      {
        companyId: company.id,
        direction: direction || undefined,
        requestedBy: "user",
      },
      db
    );

    if (result.status === "no_ceo") {
      return errorResponse(422, "no_ceo_agent", result.message);
    }

    return NextResponse.json(result, { status: result.status === "queued" ? 202 : 200 });
  } catch (error) {
    return handleRouteError(error, "companies.kickoff");
  }
}
