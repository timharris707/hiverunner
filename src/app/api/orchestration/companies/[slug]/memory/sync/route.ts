import { NextRequest, NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { syncCompanyMemoryVault } from "@/lib/orchestration/memory-vault";

export const dynamic = "force-dynamic";

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
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "memory.sync:post");
  }
}
