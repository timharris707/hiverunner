import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  checkAllProviderActivations,
  normalizeAgentAdapterType,
  resolveAgentProviderFromRecord,
} from "@/lib/orchestration/service/provider-activation";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/agents/{id}/provider-status
 *
 * Dev/inspection route. Returns the agent's current provider identity
 * and activation status for all known providers.
 *
 * This route is read-only and performs no mutations. It is intended
 * for development inspection and future use by the configuration UI
 * to show which providers are actually activatable.
 *
 * NOT a public API — may change without notice.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const db = getOrchestrationDb();

    const row = db
      .prepare(
        `SELECT id, adapter_type, model, openclaw_agent_id
         FROM agents
         WHERE (id = ? OR slug = ? OR lower(name) = lower(?))
           AND archived_at IS NULL
         LIMIT 1`,
      )
      .get(id, id, id) as {
        id: string;
        adapter_type: string;
        model: string | null;
        openclaw_agent_id: string | null;
      } | undefined;

    if (!row) {
      return NextResponse.json(
        { error: "agent_not_found", message: `Agent '${id}' not found` },
        { status: 404 },
      );
    }

    const adapterType = normalizeAgentAdapterType({
      adapterType: row.adapter_type,
      openclawAgentId: row.openclaw_agent_id,
    });

    // Resolve current provider from normalized adapter state.
    const currentProvider = resolveAgentProviderFromRecord({
      adapterType,
      openclawAgentId: row.openclaw_agent_id ?? undefined,
    });

    // Check activation for all known providers
    const activations = checkAllProviderActivations({
      id: row.id,
      adapterType,
      model: row.model,
      openclawAgentId: row.openclaw_agent_id,
    });

    return NextResponse.json({
      agentId: row.id,
      adapterType,
      currentProvider: {
        providerId: currentProvider.providerId,
        displayName: currentProvider.displayName,
        tier: currentProvider.tier,
        tierLabel: currentProvider.tierLabel,
      },
      model: row.model,
      externalIds: {
        openclaw: row.openclaw_agent_id,
      },
      providerActivations: activations,
    });
  } catch (error) {
    return handleRouteError(error, "agents.provider-status");
  }
}
