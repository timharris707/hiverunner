import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { configureCompanyExecutionHiveSchema } from "@/lib/orchestration/contracts";
import { configureCompanyExecutionHive } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; hiveId: string }> },
) {
  try {
    const { slug, hiveId } = await params;
    const contentType = req.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await req.json() : {};
    const parsed = configureCompanyExecutionHiveSchema.parse(payload);
    return NextResponse.json(configureCompanyExecutionHive({ companyIdOrSlug: slug, hiveId, ...parsed }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid execution hive configuration payload", error.flatten());
    }
    return handleRouteError(error, "company-execution-hives:configure");
  }
}
