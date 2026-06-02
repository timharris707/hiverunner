import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { assertOverseerSessionCompany, recordOverseerEvent } from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    if (!session.processPid) {
      return errorResponse(409, "overseer_session_not_running", "No running Codex process is attached to this session.");
    }
    try {
      process.kill(session.processPid, "SIGTERM");
    } catch (error) {
      return errorResponse(
        409,
        "overseer_cancel_failed",
        error instanceof Error ? error.message : "Could not signal Codex process.",
      );
    }
    recordOverseerEvent({
      sessionId: session.id,
      eventType: "codex.cancel.requested",
      event: { processPid: session.processPid },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, "overseer-session-cancel:post");
  }
}
