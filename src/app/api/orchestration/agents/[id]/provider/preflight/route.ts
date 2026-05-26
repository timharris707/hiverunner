import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/orchestration/api";
import { computeSwitchPlan } from "@/lib/orchestration/service/provider-switch";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestration/agents/{id}/provider/preflight
 *
 * Read-only simulation: "What would happen if I switched this agent
 * to provider X right now?"
 *
 * Returns a SwitchPlan describing:
 * - Whether the switch is allowed, blocked, or a no-op
 * - What blockers prevent the switch
 * - What warnings the operator should know about
 * - What state would change (preserved vs reset)
 * - Provider display info for current and target
 *
 * This route does NOT mutate anything. It computes the same decision
 * that the PATCH mutation route uses, ensuring the simulation and
 * the real switch can never diverge.
 *
 * Request body:
 *   { "targetProvider": "openclaw" | "codex" | "anthropic" | "hermes" | "gemini", "targetModel"?: string, "ignoreInFlight"?: boolean }
 *
 * Response (200): SwitchPlan
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    let body: { targetProvider?: string; targetModel?: string; ignoreInFlight?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "invalid_body", message: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const { targetProvider } = body;

    if (!targetProvider || typeof targetProvider !== "string") {
      return NextResponse.json(
        {
          error: "missing_target_provider",
          message: 'Request body must include "targetProvider" (string).',
        },
        { status: 400 },
      );
    }

    const validTargets = ["openclaw", "codex", "anthropic", "hermes", "gemini", "symphony"];
    if (!validTargets.includes(targetProvider)) {
      return NextResponse.json(
        {
          error: "invalid_target_provider",
          message: `targetProvider must be one of: ${validTargets.join(", ")}. Got: "${targetProvider}".`,
          note: "Only real HiveRunner providers are switchable here. Planned providers remain unavailable.",
        },
        { status: 400 },
      );
    }

    const plan = computeSwitchPlan(id, targetProvider, undefined, {
      targetModel: typeof body.targetModel === "string" ? body.targetModel : null,
      ignoreInFlight: body.ignoreInFlight === true,
    });

    if (plan.blockReason === "agent_not_found") {
      return NextResponse.json(plan, { status: 404 });
    }

    return NextResponse.json(plan);
  } catch (error) {
    return handleRouteError(error, "agents.provider.preflight");
  }
}
