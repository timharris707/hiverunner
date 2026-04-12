import { NextRequest, NextResponse } from "next/server";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { createApproval } from "@/lib/orchestration/service/approval";
import { stagePendingHireAgent } from "@/lib/orchestration/service/company-agent-provisioning";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const { name, role, model, emoji } = body;

    if (!name?.trim() || !role?.trim()) {
      return NextResponse.json({ error: "Name and role are required" }, { status: 400 });
    }

    const db = getOrchestrationDb();

    // Find company (alias-aware)
    const resolved = resolveCompanyIdBySlug(slug, db);
    if (!resolved) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    const stagedAgent = stagePendingHireAgent({
      approvalCompanyId: resolved.id,
      payload: body,
      db,
    });

    // Create hire approval — agent stays paused until approved
    const normalizedName = name.trim();
    const normalizedRole = role.trim();
    const normalizedModel =
      typeof model === "string" && model.trim() ? model.trim() : "anthropic/claude-sonnet-4-6";
    const normalizedEmoji =
      typeof emoji === "string" && emoji.trim() ? emoji.trim() : "pixel";

    createApproval({
      companyIdOrSlug: resolved.id,
      type: "hire_agent",
      payload: {
        ...body,
        agentId: stagedAgent.agentId,
        name: normalizedName,
        agentName: normalizedName,
        role: normalizedRole,
        model: normalizedModel,
        emoji: normalizedEmoji,
      },
    });

    return NextResponse.json({
      success: true,
      agent: {
        id: stagedAgent.agentId,
        name: normalizedName,
        openclawAgentId: stagedAgent.openclawAgentId,
      }
    }, { status: 201 });
  } catch (error: unknown) {
    console.error("[agents/hire] error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
