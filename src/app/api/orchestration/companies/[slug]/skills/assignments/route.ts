import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  assignCompanySkillToAgent,
  listAgentSkillAssignments,
  updateAgentSkillAssignment,
  type AgentSkillAssignmentStatus,
} from "@/lib/orchestration/company-skills";
import { invalidQueryValueResponse, normalizeQueryParam, readRequiredJsonBody } from "../../route-helpers";

export const dynamic = "force-dynamic";

const ASSIGNMENT_STATUSES: readonly (AgentSkillAssignmentStatus | "all")[] = ["all", "draft", "active", "archived"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const status = normalizeQueryParam(request.nextUrl.searchParams, "status", ASSIGNMENT_STATUSES);
    const statusError = invalidQueryValueResponse(status, "invalid_status", "status must be draft, active, archived, or all");
    if (statusError) return statusError;

    return NextResponse.json(listAgentSkillAssignments(slug, {
      agentId: request.nextUrl.searchParams.get("agentId") ?? undefined,
      skillId: request.nextUrl.searchParams.get("skillId") ?? undefined,
      status: status.value,
      includeArchived: request.nextUrl.searchParams.get("includeArchived") === "true",
    }));
  } catch (error) {
    return handleRouteError(error, "company.skills.assignments:get");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const bodyResult = await readRequiredJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const { body } = bodyResult;

    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    const skillId = typeof body.skillId === "string" ? body.skillId : "";
    if (!agentId || !skillId) {
      return errorResponse(400, "missing_assignment_target", "agentId and skillId are required");
    }

    return NextResponse.json(
      assignCompanySkillToAgent(slug, {
        agentId,
        skillId,
        status: typeof body.status === "string" ? body.status as never : undefined,
        source: typeof body.source === "string" ? body.source as never : undefined,
        assignedByAgentId:
          typeof body.assignedByAgentId === "string" || body.assignedByAgentId === null
            ? body.assignedByAgentId
            : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        metadata:
          typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : undefined,
      }),
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "company.skills.assignments:post");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const bodyResult = await readRequiredJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const { body } = bodyResult;

    const assignmentId = typeof body.id === "string" ? body.id : typeof body.assignmentId === "string" ? body.assignmentId : "";
    if (!assignmentId) {
      return errorResponse(400, "missing_assignment_id", "PATCH requires id or assignmentId");
    }

    return NextResponse.json(
      updateAgentSkillAssignment(slug, assignmentId, {
        status: typeof body.status === "string" ? body.status as never : undefined,
        source: typeof body.source === "string" ? body.source as never : undefined,
        assignedByAgentId:
          typeof body.assignedByAgentId === "string" || body.assignedByAgentId === null
            ? body.assignedByAgentId
            : undefined,
        notes: typeof body.notes === "string" ? body.notes : undefined,
        metadata:
          typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : undefined,
      }),
    );
  } catch (error) {
    return handleRouteError(error, "company.skills.assignments:patch");
  }
}
