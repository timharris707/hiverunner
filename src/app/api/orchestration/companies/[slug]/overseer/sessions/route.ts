import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  appendOverseerMessage,
  createOverseerSession,
  listOverseerMessages,
  listOverseerSessions,
} from "@/lib/orchestration/overseer/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSessionSchema = z.object({
  projectId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(180).optional(),
  provider: z.enum(["anthropic", "codex", "gemini"]).nullable().optional(),
  initialMessage: z.string().trim().min(1).max(12000).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const projectId = req.nextUrl.searchParams.get("projectId");
    return NextResponse.json(listOverseerSessions({ companyIdOrSlug: slug, projectId }));
  } catch (error) {
    return handleRouteError(error, "overseer-sessions:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const parsed = createSessionSchema.parse(await req.json().catch(() => ({})));
    const { session } = createOverseerSession({
      companyIdOrSlug: slug,
      projectId: parsed.projectId,
      title: parsed.title,
      provider: parsed.provider,
      createdBy: "operator",
    });
    if (parsed.initialMessage) {
      appendOverseerMessage({
        sessionId: session.id,
        role: "user",
        content: parsed.initialMessage,
      });
    }
    return NextResponse.json(
      {
        session,
        messages: listOverseerMessages(session.id).messages,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid Overseer session payload", error.flatten());
    }
    return handleRouteError(error, "overseer-sessions:post");
  }
}
