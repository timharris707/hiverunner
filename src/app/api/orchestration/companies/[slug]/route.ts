import { after, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateCompanySchema } from "@/lib/orchestration/contracts";
import {
  archiveCompany,
  cleanupDeletedCompanyOpenClawAgents,
  getCompany,
  hardDeleteCompany,
  resolveCompanyIdBySlug,
  updateCompany,
} from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

// Use stable company ID for protection checks, not mutable slug.
const PROTECTED_COMPANY_IDS = new Set(["6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(getCompany(slug));
  } catch (error) {
    return handleRouteError(error, "company:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanySchema.parse(await req.json());
    return NextResponse.json(
      updateCompany({
        companySlug: slug,
        name: parsed.name,
        slug: parsed.slug,
        description: parsed.description,
        status: parsed.status,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid update company payload", error.flatten());
    }
    return handleRouteError(error, "company:patch");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const db = getOrchestrationDb();

    // Resolve through alias-aware lookup, then check protection by stable ID.
    const resolved = resolveCompanyIdBySlug(slug, db, { includeArchived: true });
    if (!resolved) {
      return errorResponse(404, "not_found", "Company not found");
    }
    if (PROTECTED_COMPANY_IDS.has(resolved.id)) {
      return errorResponse(
        403,
        "protected_company",
        "This core company is protected from deletion in Mission Control"
      );
    }

    const hard = req.nextUrl.searchParams.get("hard") === "true";

    if (hard) {
      const result = hardDeleteCompany(slug);
      after(async () => {
        try {
          await cleanupDeletedCompanyOpenClawAgents(result.openclawAgents.queued);
        } catch (cleanupError) {
          console.error("[company:delete] OpenClaw cleanup failed:", cleanupError);
        }
      });
      return NextResponse.json({ success: true, deleted: true, company: result });
    }

    return NextResponse.json(archiveCompany(slug));
  } catch (error) {
    return handleRouteError(error, "company:delete");
  }
}
