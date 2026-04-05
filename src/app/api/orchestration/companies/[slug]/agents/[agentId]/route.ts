import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { agentProfileQuerySchema } from "@/lib/orchestration/contracts";
import { getCompanyAgentProfile } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; agentId: string }> }
) {
  try {
    const { slug, agentId } = await params;
    const query = agentProfileQuerySchema.parse({
      executionLimit: req.nextUrl.searchParams.get("executionLimit") ?? undefined,
      activityLimit: req.nextUrl.searchParams.get("activityLimit") ?? undefined,
    });

    return NextResponse.json(
      getCompanyAgentProfile({
        companyIdOrSlug: slug,
        agentId,
        executionLimit: query.executionLimit,
        activityLimit: query.activityLimit,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid agent profile query", error.flatten());
    }
    return handleRouteError(error, "company-agent-profile:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const body = await req.json();
    const db = getOrchestrationDb();

    const agent = db.prepare("SELECT id FROM agents WHERE id = ?").get(agentId) as { id: string } | undefined;
    if (!agent) return errorResponse(404, "agent_not_found", "Agent not found");

    const now = new Date().toISOString();

    // Avatar update
    if ("avatarUrl" in body) {
      const avatarUrl = body.avatarUrl === null || body.avatarUrl === "" ? null : String(body.avatarUrl);
      db.prepare("UPDATE agents SET avatar_url = ?, updated_at = ? WHERE id = ?").run(avatarUrl, now, agentId);
    }

    // Emoji update
    if (typeof body.emoji === "string" && body.emoji.length > 0) {
      db.prepare("UPDATE agents SET emoji = ?, updated_at = ? WHERE id = ?").run(body.emoji, now, agentId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, "company-agent:patch");
  }
}
