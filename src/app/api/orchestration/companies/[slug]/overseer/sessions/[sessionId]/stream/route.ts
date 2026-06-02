import { NextRequest } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { assertOverseerSessionCompany, listOverseerEvents, listOverseerMessages } from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string; sessionId: string }> },
) {
  try {
    const { slug, sessionId } = await params;
    const session = assertOverseerSessionCompany({ sessionId, companyIdOrSlug: slug });
    const body = [
      sse("snapshot", {
        session,
        messages: listOverseerMessages(session.id).messages,
        events: listOverseerEvents(session.id).events,
      }),
    ].join("");
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return handleRouteError(error, "overseer-session-stream:get");
  }
}
