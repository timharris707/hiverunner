import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { getMemoryIndexStatus, syncCompanyMemoryVault } from "@/lib/orchestration/memory-vault";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    return NextResponse.json({ indexStatus: getMemoryIndexStatus(slug) });
  } catch (error) {
    return handleRouteError(error, "memory.sync:get");
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null) as { includeGlobalWiki?: boolean } | null;
    const result = syncCompanyMemoryVault(slug, {
      includeGlobalWiki: body?.includeGlobalWiki,
    });
    return NextResponse.json({
      ...result,
      indexStatus: getMemoryIndexStatus(slug),
    });
  } catch (error) {
    return handleRouteError(error, "memory.sync:post");
  }
}
