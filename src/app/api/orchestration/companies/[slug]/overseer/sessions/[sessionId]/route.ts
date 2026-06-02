import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  assertOverseerSessionCompany,
  listOverseerEvents,
  listOverseerMessages,
  updateOverseerSession,
} from "@/lib/orchestration/overseer/service";
import { readCodexSessionTelemetry } from "@/lib/orchestration/overseer/codex-runtime";
import { buildRawOverseerTranscriptExport } from "@/lib/orchestration/overseer/export";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const patchSessionSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  model: z.string().trim().min(1).max(120).nullable().optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).nullable().optional(),
  fastMode: z.boolean().nullable().optional(),
  provider: z.enum(["anthropic", "codex", "gemini"]).nullable().optional(),
  compaction: z.object({
    mode: z.enum(["ask", "auto", "manual"]).optional(),
    thresholdPercent: z.number().int().min(50).max(95).nullable().optional(),
    manualRequestedAt: z.string().datetime().nullable().optional(),
    status: z.enum(["idle", "requested", "running", "failed"]).nullable().optional(),
    hasMemorySummary: z.boolean().optional(),
    summaryUpdatedAt: z.string().datetime().nullable().optional(),
    summaryTokenEstimate: z.number().int().nonnegative().nullable().optional(),
  }).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    return NextResponse.json({
      session,
      messages: listOverseerMessages(session.id).messages,
      events: listOverseerEvents(session.id).events,
      codexTelemetry: readCodexSessionTelemetry(session.codexSessionId),
      continuityProof: buildRawOverseerTranscriptExport({
        companyIdOrSlug: slug,
        sessionId: session.id,
      }).package.continuityProof,
    });
  } catch (error) {
    return handleRouteError(error, "overseer-session:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    const parsed = patchSessionSchema.parse(await req.json());
    return NextResponse.json(updateOverseerSession({
      sessionId,
      title: parsed.title,
      model: parsed.model,
      reasoningEffort: parsed.reasoningEffort,
      fastMode: parsed.fastMode,
      provider: parsed.provider,
      compaction: parsed.compaction,
      archived: parsed.archived,
    }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Overseer session update payload", error.flatten());
    }
    return handleRouteError(error, "overseer-session:patch");
  }
}
