import { NextResponse } from "next/server";
import {
  AGENT_CONFIGS,
  getDisplayName,
  DIVISIONS,
} from "@/config/agents";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/registry
 * Returns the full agent registry — the single source of truth for all agent metadata.
 * Every page and component that needs agent data should read from this endpoint
 * (or import directly from @/config/agents for server components).
 */
export async function GET() {
  const agents = AGENT_CONFIGS.map((a) => ({
    id: a.id,
    name: a.name,
    displayName: getDisplayName(a),
    emoji: a.emoji,
    role: a.role,
    division: a.division,
    divisionColor: a.divisionColor,
    avatar: a.avatar,
    description: a.description,
    model: a.model,
    reportsTo: a.reportsTo,
    capabilities: a.capabilities,
    isBuilder: a.isBuilder ?? false,
    routingTags: a.routingTags ?? [],
    recommendedOverlays: a.recommendedOverlays ?? [],
  }));

  return NextResponse.json({
    agents,
    divisions: DIVISIONS,
    count: agents.length,
  });
}
