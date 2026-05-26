import { NextRequest, NextResponse } from "next/server";

import { getProjectBoard } from "@/lib/orchestration/service";
import { handleRouteError } from "@/lib/orchestration/api";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(getProjectBoard(id));
  } catch (error) {
    return handleRouteError(error, "project-board:get");
  }
}
