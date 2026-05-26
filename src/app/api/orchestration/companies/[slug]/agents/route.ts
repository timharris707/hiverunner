import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { listCompanyAgentsQuerySchema } from "@/lib/orchestration/contracts";
import { listCompanyAgents, syncCompanyAgentsFromOpenClaw } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const query = listCompanyAgentsQuerySchema.parse({
      includeNonProduction: req.nextUrl.searchParams.get("includeNonProduction") ?? undefined,
      includeArchived: req.nextUrl.searchParams.get("includeArchived") ?? undefined,
    });
    const syncRequested = req.nextUrl.searchParams.get("syncOpenClaw");
    const shouldSyncOpenClaw = syncRequested === "true";

    if (shouldSyncOpenClaw) {
      try {
        const openClawResponse = await fetch(new URL("/api/agents", req.url), { cache: "no-store" });
        if (openClawResponse.ok) {
          const payload = (await openClawResponse.json()) as {
            agents?: Array<{
              id?: string;
              name?: string;
              emoji?: string;
              model?: string;
              status?: string;
            }>;
          };

          const snapshots =
            payload.agents
              ?.map((agent) => ({
                id: String(agent.id ?? "").trim(),
                name: String(agent.name ?? "").trim(),
                emoji: agent.emoji ? String(agent.emoji) : undefined,
                model: agent.model ? String(agent.model) : undefined,
                status: agent.status ? String(agent.status) : undefined,
              }))
              .filter((agent) => agent.id && agent.name && !agent.id.startsWith("stress-") && !agent.name.startsWith("stress-") && !agent.name.startsWith("[AGENT-TEST]")) ?? [];

          if (snapshots.length > 0) {
            syncCompanyAgentsFromOpenClaw({
              companyIdOrSlug: slug,
              agents: snapshots,
            });
          }
        }
      } catch (error) {
        console.warn("[orchestration] openclaw agent sync skipped", {
          company: slug,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json(
      listCompanyAgents(slug, {
        includeNonProduction: query.includeNonProduction,
        includeArchived: query.includeArchived,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid company agent list query", error.flatten());
    }
    return handleRouteError(error, "company-agents:get");
  }
}
