import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  listRoleTemplatePatches,
  rollbackRoleTemplatePatch,
} from "@/lib/orchestration/role-template-patches";

export const dynamic = "force-dynamic";

/**
 * H4 — role template patches (Improve → template compounding).
 * GET lists a company's patches (audit trail); PATCH rolls one back.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const company = resolveCompanyIdBySlug(slug);
    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }
    const includeRolledBack = request.nextUrl.searchParams.get("includeRolledBack") === "1";
    const bucketParam = request.nextUrl.searchParams.get("bucket");
    const bucket = bucketParam === "ceo" || bucketParam === "default" ? bucketParam : undefined;
    const patches = listRoleTemplatePatches(getOrchestrationDb(), {
      companyId: company.id,
      bucket,
      includeRolledBack,
    });
    return NextResponse.json({ patches });
  } catch (error) {
    return handleRouteError(error, "improve.template-patches:get");
  }
}

const rollbackSchema = z.object({
  action: z.literal("rollback"),
  patchId: z.string().min(1),
  reason: z.string().max(1000).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const company = resolveCompanyIdBySlug(slug);
    if (!company) {
      return errorResponse(404, "company_not_found", "Company not found");
    }
    const body = rollbackSchema.parse(await request.json());
    const patch = rollbackRoleTemplatePatch({
      companyId: company.id,
      patchId: body.patchId,
      reason: body.reason ?? null,
      actorUserId: "operator",
      db: getOrchestrationDb(),
    });
    return NextResponse.json({ patch });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "invalid_body", "Request body failed validation", error.issues);
    }
    return handleRouteError(error, "improve.template-patches:patch");
  }
}
