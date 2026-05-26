import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  createCompanySkill,
  listCompanySkills,
  updateCompanySkill,
  type CompanySkillStatus,
} from "@/lib/orchestration/company-skills";

export const dynamic = "force-dynamic";

function parseStatus(value: string | null): CompanySkillStatus | "all" | undefined {
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

    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    return NextResponse.json(listCompanySkills(slug, { includeArchived, status }));
  } catch (error) {
    return handleRouteError(error, "company.skills:get");
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

    const name = typeof body.name === "string" ? body.name : "";
    return NextResponse.json(
      createCompanySkill(slug, {
        name,
        description: typeof body.description === "string" ? body.description : undefined,
        slug: typeof body.slug === "string" ? body.slug : undefined,
        status: typeof body.status === "string" ? body.status as never : undefined,
        source: typeof body.source === "string" ? body.source as never : undefined,
        scope: typeof body.scope === "string" ? body.scope as never : undefined,
        ownerAgentId:
          typeof body.ownerAgentId === "string" || body.ownerAgentId === null
            ? body.ownerAgentId
            : undefined,
        reviewRequired: typeof body.reviewRequired === "boolean" ? body.reviewRequired : undefined,
        reviewState: typeof body.reviewState === "string" ? body.reviewState as never : undefined,
        metadata:
          typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : undefined,
      }),
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "company.skills:post");
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

    const skillId = typeof body.id === "string"
      ? body.id
      : typeof body.skillId === "string"
        ? body.skillId
        : typeof body.slug === "string"
          ? body.slug
          : "";
    if (!skillId) {
      return errorResponse(400, "missing_skill_id", "PATCH requires id, skillId, or slug");
    }

    return NextResponse.json(
      updateCompanySkill(slug, skillId, {
        name: typeof body.name === "string" ? body.name : undefined,
        description: typeof body.description === "string" ? body.description : undefined,
        status: typeof body.status === "string" ? body.status as never : undefined,
        source: typeof body.source === "string" ? body.source as never : undefined,
        scope: typeof body.scope === "string" ? body.scope as never : undefined,
        ownerAgentId:
          typeof body.ownerAgentId === "string" || body.ownerAgentId === null
            ? body.ownerAgentId
            : undefined,
        reviewRequired: typeof body.reviewRequired === "boolean" ? body.reviewRequired : undefined,
        reviewState: typeof body.reviewState === "string" ? body.reviewState as never : undefined,
        metadata:
          typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : undefined,
        bumpVersion: typeof body.bumpVersion === "boolean" ? body.bumpVersion : undefined,
        replacementSkillId:
          typeof body.replacementSkillId === "string" || body.replacementSkillId === null
            ? body.replacementSkillId
            : undefined,
        deprecationReason: typeof body.deprecationReason === "string" ? body.deprecationReason : undefined,
      }),
    );
  } catch (error) {
    return handleRouteError(error, "company.skills:patch");
  }
}
