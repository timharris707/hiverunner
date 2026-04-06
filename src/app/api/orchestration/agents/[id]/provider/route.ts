import { NextRequest, NextResponse } from "next/server";
import { handleRouteError } from "@/lib/orchestration/api";
import { switchAgentProvider } from "@/lib/orchestration/service/provider-switch";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/orchestration/agents/{id}/provider
 *
 * Attempt to switch an agent's execution provider.
 *
 * This is the Phase 2 mutation endpoint from the provider-selection
 * contract. It validates the switch, blocks unsafe cases, mutates
 * provider state, and returns a structured result.
 *
 * Request body:
 *   { "targetProvider": "openclaw" | "paperclip" }
 *
 * Response (200): Structured ProviderSwitchResult (success or refusal)
 *
 * This route does NOT distinguish between "refused because validation
 * failed" and "succeeded" via HTTP status codes — both return 200
 * with a structured body. The caller inspects `result.switched` to
 * determine the outcome. This is intentional: refusal is not an error,
 * it's a structured decision.
 *
 * 400 is only returned for malformed requests.
 * 404 is only returned for unknown agents.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Parse request body
    let body: { targetProvider?: string };
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

    // Validate target is a recognized adapter_type value
    const validTargets = ["openclaw", "paperclip"];
    if (!validTargets.includes(targetProvider)) {
      return NextResponse.json(
        {
          error: "invalid_target_provider",
          message: `targetProvider must be one of: ${validTargets.join(", ")}. Got: "${targetProvider}".`,
          note: "Planned providers (hermes, byo-webhook) are not yet switchable.",
        },
        { status: 400 },
      );
    }

    // Execute the switch
    const result = switchAgentProvider(id, targetProvider);

    // Map specific block reasons to HTTP status codes
    if (result.blockReason === "agent_not_found") {
      return NextResponse.json(result, { status: 404 });
    }

    // All other cases (success + structured refusal) return 200
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "agents.provider.patch");
  }
}
