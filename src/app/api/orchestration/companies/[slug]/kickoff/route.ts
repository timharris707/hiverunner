import { after, NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { executeHeartbeatRun, kickoffCompany } from "@/lib/orchestration/engine/engine";
import { canAutonomouslyExecuteCompany } from "@/lib/orchestration/service/dev-execution-test-mode";

export const dynamic = "force-dynamic";

async function triggerImmediateHeartbeatRun(runId: string) {
  try {
    const result = await executeHeartbeatRun(runId);
    if (result.status === "failed") {
      console.warn("[kickoff] immediate heartbeat execution failed:", result.error);
    }
  } catch (error) {
    console.warn("[kickoff] immediate heartbeat execution failed (non-fatal):", error);
  }
}

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

    if (
      result.status === "queued" &&
      result.heartbeatRunId &&
      canAutonomouslyExecuteCompany(company.id)
    ) {
      after(async () => {
        await triggerImmediateHeartbeatRun(result.heartbeatRunId);
      });
    }

    return NextResponse.json(result, { status: result.status === "queued" ? 202 : 200 });
  } catch (error) {
    return handleRouteError(error, "companies.kickoff");
  }
}
