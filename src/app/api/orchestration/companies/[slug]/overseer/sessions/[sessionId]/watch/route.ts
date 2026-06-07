import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  assertOverseerSessionCompany,
  listOverseerEvents,
  listOverseerMessages,
  startOverseerWatch,
  stopOverseerWatch,
} from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const watchSchema = z.object({
  action: z.enum(["start", "stop"]),
  intervalMs: z.number().int().positive().max(5 * 60_000).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const parsed = watchSchema.parse(await req.json());
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    const result = parsed.action === "start"
      ? startOverseerWatch({ sessionId: session.id, intervalMs: parsed.intervalMs })
      : stopOverseerWatch({ sessionId: session.id });
    return NextResponse.json({
      ...result,
      session: result.session,
      messages: listOverseerMessages(session.id).messages,
      events: listOverseerEvents(session.id).events,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Overseer watch payload", error.flatten());
    }
    return handleRouteError(error, "overseer-session-watch:post");
  }
}
