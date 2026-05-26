import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { runCompanyExecutionHiveProbeSchema } from "@/lib/orchestration/contracts";
import { runCompanyExecutionHiveProbe } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; hiveId: string }> },
) {
  try {
    const { slug, hiveId } = await params;
    const contentType = req.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json") ? await req.json() : {};
    const parsed = runCompanyExecutionHiveProbeSchema.parse(payload);
    return NextResponse.json(runCompanyExecutionHiveProbe({
      companyIdOrSlug: slug,
      hiveId,
      laneId: parsed.laneId,
      kind: parsed.kind,
    }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid execution hive probe payload", error.flatten());
    }
    return handleRouteError(error, "company-execution-hives:probe");
  }
}
