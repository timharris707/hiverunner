import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { listActiveAgentLiveStates } from "@/lib/orchestration/agent-live-state";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/engine/active-agent-runs?company=<slug-or-code>
 *
 * Returns the latest genuinely active heartbeat run per agent. This endpoint is
 * intentionally heartbeat-run based so the sidebar, task cards, and activity
 * panel share one live-state source.
 */
export async function GET(request: NextRequest) {
  try {
    const companyParam = request.nextUrl.searchParams.get("company")?.trim();
    if (!companyParam) {
      return NextResponse.json({ error: "company query param required" }, { status: 400 });
    }

    const db = getOrchestrationDb();
    const company = resolveCompanyIdBySlug(companyParam, db);
    if (!company) {
      return NextResponse.json({ runs: [], timestamp: new Date().toISOString() });
    }

    const runs = listActiveAgentLiveStates({ db, companyId: company.id }).map((state) => ({
      runId: state.runningRunId,
      agentId: state.agentId,
      agentName: state.agentName ?? "Agent",
      agentSlug: state.agentSlug,
      agentEmoji: state.agentEmoji,
      agentAvatarUrl: state.agentHasAvatar
        ? `/api/orchestration/companies/${encodeURIComponent(company.slug)}/agents/${encodeURIComponent(state.agentId)}/avatar?size=48`
        : null,
      status: state.status ?? "running",
      provider: "heartbeat_runs",
      startedAt: state.runningSince ?? null,
      createdAt: state.runningSince ?? new Date().toISOString(),
      updatedAt: state.updatedAt ?? state.runningSince ?? new Date().toISOString(),
      task: {
        id: state.runningTaskId ?? "",
        key: state.runningTaskKey,
        title: state.runningTaskTitle ?? "Task",
        status: state.runningTaskStatus ?? "in-progress",
      },
    }));

    return NextResponse.json({
      company: {
        slug: company.slug,
        code: company.company_code,
      },
      runs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error, "engine.active-agent-runs");
  }
}
