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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function codexSessionIdFromEvents(events: ReturnType<typeof listOverseerEvents>["events"]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const record = events[index].event;
    const direct = stringValue(record.thread_id)
      ?? stringValue(record.threadId)
      ?? stringValue(record.session_id)
      ?? stringValue(record.sessionId);
    if (direct) return direct;
    const thread = recordValue(record.thread);
    const nested = thread ? stringValue(thread.id) ?? stringValue(thread.thread_id) : null;
    if (nested) return nested;
  }
  return null;
}

const patchSessionSchema = z.object({
  title: z.string().trim().min(1).max(180).optional(),
  model: z.string().trim().min(1).max(120).nullable().optional(),
  reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).nullable().optional(),
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
    const events = listOverseerEvents(session.id).events;
    const codexSessionId = session.codexSessionId ?? codexSessionIdFromEvents(events);
    return NextResponse.json({
      session,
      messages: listOverseerMessages(session.id).messages,
      events,
      codexTelemetry: readCodexSessionTelemetry(codexSessionId),
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
