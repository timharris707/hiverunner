import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  assertOverseerSessionCompany,
  getOverseerCompactionState,
  requestOverseerSessionCompaction,
  updateOverseerCompactionSettings,
} from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const updateCompactionSchema = z.object({
  policy: z.enum(["manual", "ask", "auto"]).optional(),
  contextThreshold: z.number().int().min(1).max(100).optional(),
  actorUserId: z.string().trim().min(1).max(120).optional(),
}).refine((value) => value.policy !== undefined || value.contextThreshold !== undefined, {
  message: "At least one compaction setting is required",
});

const requestCompactionSchema = z.object({
  summary: z.string().trim().min(1).max(200_000),
  source: z.enum(["manual", "runtime", "auto"]).optional(),
  reason: z.string().trim().min(1).max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requestedBy: z.string().trim().min(1).max(120).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    return NextResponse.json(getOverseerCompactionState(session.id));
  } catch (error) {
    return handleRouteError(error, "overseer-session-compaction:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    const parsed = updateCompactionSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(updateOverseerCompactionSettings({
      sessionId: session.id,
      policy: parsed.policy,
      contextThreshold: parsed.contextThreshold,
      actorUserId: parsed.actorUserId,
    }));
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Overseer compaction settings payload", error.flatten());
    }
    return handleRouteError(error, "overseer-session-compaction:patch");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    const parsed = requestCompactionSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(
      requestOverseerSessionCompaction({
        sessionId: session.id,
        summary: parsed.summary,
        source: parsed.source,
        reason: parsed.reason,
        metadata: parsed.metadata,
        requestedBy: parsed.requestedBy,
      }),
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Overseer compaction request payload", error.flatten());
    }
    return handleRouteError(error, "overseer-session-compaction:post");
  }
}
