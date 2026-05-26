import { NextRequest, NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import {
  findCompanyCeo,
  listHeartbeatRuns,
  listWakeupRequests,
} from "@/lib/orchestration/engine/engine";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();

    const resolved = resolveCompanyIdBySlug(slug, db);
    if (!resolved) {
      return errorResponse(404, "company_not_found", `Company '${slug}' not found`);
    }
    const company = { id: resolved.id, name: resolved.name };

    const ceo = findCompanyCeo(company.id, db);
    const recentRuns = listHeartbeatRuns({ companyId: company.id, limit: 20 }, db);
    const pendingWakeups = listWakeupRequests({ companyId: company.id, status: "queued", limit: 10 }, db);

    // Get runtime state for CEO
    let ceoRuntimeState = null;
    if (ceo) {
      const row = db
        .prepare(
          `SELECT agent_id, session_id, last_run_id, last_run_status,
                  total_input_tokens, total_output_tokens, total_cost_cents, last_error
           FROM agent_runtime_state WHERE agent_id = ? LIMIT 1`
        )
        .get(ceo.id) as Record<string, unknown> | undefined;
      ceoRuntimeState = row ?? null;
    }

    return NextResponse.json({
      companyId: company.id,
      companyName: company.name,
      ceo: ceo
        ? { id: ceo.id, name: ceo.name, role: ceo.role, runtimeState: ceoRuntimeState }
        : null,
      recentHeartbeatRuns: recentRuns,
      pendingWakeups,
      engineStatus: ceo ? "ready" : "no_ceo",
    });
  } catch (error) {
    return handleRouteError(error, "companies.engine");
  }
}
