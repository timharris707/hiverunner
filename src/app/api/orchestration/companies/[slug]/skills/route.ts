import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  createCompanySkill,
  listCompanySkills,
  updateCompanySkill,
  type CompanySkillStatus,
} from "@/lib/orchestration/company-skills";
import { invalidQueryValueResponse, normalizeQueryParam, readRequiredJsonBody } from "../route-helpers";

export const dynamic = "force-dynamic";

const COMPANY_SKILL_STATUSES: readonly (CompanySkillStatus | "all")[] = ["all", "draft", "active", "archived"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const status = normalizeQueryParam(request.nextUrl.searchParams, "status", COMPANY_SKILL_STATUSES);
    const statusError = invalidQueryValueResponse(status, "invalid_status", "status must be draft, active, archived, or all");
    if (statusError) return statusError;

    const includeArchived = request.nextUrl.searchParams.get("includeArchived") === "true";
    return NextResponse.json(listCompanySkills(slug, { includeArchived, status: status.value }));
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
    const bodyResult = await readRequiredJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const { body } = bodyResult;

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
    const bodyResult = await readRequiredJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const { body } = bodyResult;

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
