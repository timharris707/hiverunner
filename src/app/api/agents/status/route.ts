import { NextResponse } from "next/server";
import { getAgentStatusSnapshot } from "@/lib/agent-status";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(getAgentStatusSnapshot());
  } catch (error) {
    console.error("[agents/status] Error:", error);
    return NextResponse.json(
      {
        agents: [],
        gatewayReachable: false,
        updatedAt: Date.now(),
        error: "Failed to read agent status",
      },
      { status: 500 },
    );
  }
}
