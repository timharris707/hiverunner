import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { regenerateProjectAgentAvatar } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const { id, agentId } = await params;
    return NextResponse.json(regenerateProjectAgentAvatar({ projectId: id, agentId }));
  } catch (error) {
    return handleRouteError(error, "project-agent-avatar-regenerate:post");
  }
}
