import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { detectCodexModelCatalog, detectCodexStatus } from "@/lib/orchestration/overseer/codex-runtime";
import {
  getOverseerReadiness,
  getOverseerSettings,
  updateOverseerSettings,
} from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const updateOverseerSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  codexCommand: z.string().trim().min(1).max(240).optional(),
  approvalMode: z.enum(["writes", "manual"]).optional(),
  compaction: z.object({
    enabled: z.boolean().optional(),
    triggerPercent: z.number().int().min(50).max(95).optional(),
  }).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const projectId = req.nextUrl.searchParams.get("projectId");
    const settings = getOverseerSettings(slug).settings;
    const codexStatus = detectCodexStatus(settings.codexCommand);
    return NextResponse.json({
      ...getOverseerReadiness({ companyIdOrSlug: slug, projectId, codexStatus }),
      modelCatalog: detectCodexModelCatalog(settings.codexCommand),
    });
  } catch (error) {
    return handleRouteError(error, "company-overseer-settings:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const parsed = updateOverseerSettingsSchema.parse(await req.json());
    const result = updateOverseerSettings({
      companyIdOrSlug: slug,
      enabled: parsed.enabled,
      codexCommand: parsed.codexCommand,
      approvalMode: parsed.approvalMode,
      compaction: parsed.compaction,
    });
    const codexStatus = detectCodexStatus(result.settings.codexCommand);
    return NextResponse.json({
      ...getOverseerReadiness({ companyIdOrSlug: slug, codexStatus }),
      modelCatalog: detectCodexModelCatalog(result.settings.codexCommand),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Overseer settings payload", error.flatten());
    }
    return handleRouteError(error, "company-overseer-settings:patch");
  }
}
