import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { restoreCompanyAgent } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(restoreCompanyAgent({ agentId: id }));
  } catch (error) {
    return handleRouteError(error, "agent:restore");
  }
}
