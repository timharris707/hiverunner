import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  assignCompanySkillToAgent,
  listAgentSkillAssignments,
  updateAgentSkillAssignment,
  type AgentSkillAssignmentStatus,
} from "@/lib/orchestration/company-skills";

export const dynamic = "force-dynamic";

function parseStatus(value: string | null): AgentSkillAssignmentStatus | "all" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "all" || normalized === "draft" || normalized === "active" || normalized === "archived") {
    return normalized;
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const statusParam = request.nextUrl.searchParams.get("status");
    const status = parseStatus(statusParam);
    if (statusParam && !status) {
      return errorResponse(400, "invalid_status", "status must be draft, active, archived, or all");
    }

    return NextResponse.json(listAgentSkillAssignments(slug, {
      agentId: request.nextUrl.searchParams.get("agentId") ?? undefined,
      skillId: request.nextUrl.searchParams.get("skillId") ?? undefined,
      status,
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
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

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
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

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
