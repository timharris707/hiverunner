import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { kickoffCompany, tick } from "@/lib/orchestration/engine/engine";

export const dynamic = "force-dynamic";

const dev = process.env.NODE_ENV !== "production";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const resolved = resolveCompanyIdBySlug(slug);
    if (!resolved) {
      return errorResponse(404, "company_not_found", `Company '${slug}' not found`);
    }
    const company = { id: resolved.id };

    const body = await request.json().catch(() => ({}));
    const direction = typeof body.direction === "string" ? body.direction.trim() : undefined;

    const result = kickoffCompany({
      companyId: company.id,
      direction: direction || undefined,
      requestedBy: "user",
    });

    if (result.status === "no_ceo") {
      return errorResponse(422, "no_ceo_agent", result.message);
    }

    // Dev-only: fire a one-shot tick to process the queued heartbeat run
    // immediately. In production, the background engine tick loop (server.js)
    // handles this. This is gated to dev so stable keeps its normal executor
    // path with no hidden duplicate execution.
    if (dev && (result.status === "queued" || result.status === "already_active")) {
      setTimeout(() => {
        tick().catch((e) =>
          console.warn("[kickoff] dev one-shot tick failed (non-fatal):", e)
        );
      }, 500);
    }

    return NextResponse.json(result, { status: result.status === "queued" ? 202 : 200 });
  } catch (error) {
    return handleRouteError(error, "companies.kickoff");
  }
}
