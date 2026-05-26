import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  listCompanySkillEffectiveness,
  recordExplicitSkillUse,
} from "@/lib/orchestration/skill-effectiveness";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    return NextResponse.json(listCompanySkillEffectiveness(slug, {
      includeArchived: request.nextUrl.searchParams.get("includeArchived") === "true",
    }));
  } catch (error) {
    return handleRouteError(error, "company.skills.effectiveness:get");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }
    const skill = typeof body.skill === "string" ? body.skill
      : typeof body.skillId === "string" ? body.skillId
        : typeof body.skillSlug === "string" ? body.skillSlug
          : "";
    if (!skill.trim()) {
      return errorResponse(400, "missing_skill", "skill, skillId, or skillSlug is required");
    }

    return NextResponse.json(recordExplicitSkillUse({
      companyIdOrSlug: slug,
      skillIdOrSlugOrName: skill,
      agentId: typeof body.agentId === "string" ? body.agentId : null,
      taskIdOrKey:
        typeof body.taskKey === "string" ? body.taskKey
          : typeof body.taskId === "string" ? body.taskId
            : null,
      executionRunId: typeof body.executionRunId === "string" ? body.executionRunId : null,
      heartbeatRunId: typeof body.heartbeatRunId === "string" ? body.heartbeatRunId : null,
      source: body.source === "system" || body.source === "operator" ? body.source : "agent",
      note: typeof body.note === "string" ? body.note : null,
    }));
  } catch (error) {
    return handleRouteError(error, "company.skills.effectiveness:post");
  }
}
