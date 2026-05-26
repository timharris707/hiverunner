import { NextRequest, NextResponse } from "next/server";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-service";
import { normalizeAgentSymbol } from "@/lib/orchestration/avatar-icons";
import {
  defaultModelForRuntimeProvider,
  materializeApprovedHireAgent,
  normalizeModelForRuntimeProvider,
} from "@/lib/orchestration/service/company-agent-provisioning";

export const dynamic = "force-dynamic";

function normalizeRuntimeProvider(value: unknown): string {
  const raw = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "manual";
  if (raw === "claude") return "anthropic";
  if (raw === "openai") return "codex";
  return raw;
}

function resolveReportsToAgentId(
  db: ReturnType<typeof getOrchestrationDb>,
  companyId: string,
  reportsTo: unknown,
): string | null {
  if (typeof reportsTo !== "string" || !reportsTo.trim()) return null;
  const value = reportsTo.trim();
  const row = db
    .prepare(
      `SELECT id
       FROM agents
       WHERE company_id = ?
         AND archived_at IS NULL
         AND (
           id = ?
           OR openclaw_agent_id = ?
           OR lower(name) = lower(?)
         )
       LIMIT 1`,
    )
    .get(companyId, value, value, value) as { id: string } | undefined;
  return row?.id ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const { name, role, model, emoji } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const db = getOrchestrationDb();

    // Find company (alias-aware)
    const resolved = resolveCompanyIdBySlug(slug, db);
    if (!resolved) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }
    const normalizedName = name.trim();
    const normalizedRole = typeof role === "string" && role.trim() ? role.trim() : "General";
    const runtimeProvider = normalizeRuntimeProvider(body?.runtimeProvider);
    const requestedModel =
      typeof model === "string" && model.trim() ? model.trim() : defaultModelForRuntimeProvider(runtimeProvider);
    const normalizedModel = normalizeModelForRuntimeProvider(runtimeProvider, requestedModel);
    const normalizedEmoji = normalizeAgentSymbol(
      typeof emoji === "string" ? emoji : null,
      normalizedRole,
    );
    const reportsToAgentId = resolveReportsToAgentId(db, resolved.id, body?.reportsTo);
    const materializedAgent = materializeApprovedHireAgent({
      approvalCompanyId: resolved.id,
      requestedByAgentId: reportsToAgentId,
      payload: {
        ...body,
        name: normalizedName,
        agentName: normalizedName,
        role: normalizedRole,
        model: normalizedModel,
        emoji: normalizedEmoji,
        reportsTo: reportsToAgentId ?? null,
      },
      db,
    });

    return NextResponse.json({
      success: true,
      approvalRequired: false,
        agent: {
          id: materializedAgent.agentId,
          companyId: resolved.id,
          ...(materializedAgent.projectId ? { projectId: materializedAgent.projectId } : {}),
          slug: materializedAgent.agentSlug,
          name: normalizedName,
          emoji: normalizedEmoji,
          role: normalizedRole,
          status: "idle",
          model: normalizedModel,
          adapterType: runtimeProvider,
          runtimeSlug: materializedAgent.runtimeSlug,
          ...(materializedAgent.openclawAgentId ? { openclawAgentId: materializedAgent.openclawAgentId } : {}),
        }
    }, { status: 201 });
  } catch (error: unknown) {
    console.error("[agents/hire] error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
