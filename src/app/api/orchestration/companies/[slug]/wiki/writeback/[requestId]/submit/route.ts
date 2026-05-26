import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getCompanyMemorySettings } from "@/lib/orchestration/memory-vault";
import { executeApprovedWikiMarkdownWriteback } from "@/lib/orchestration/wiki-writeback-service";
import { getWikiWritebackRequest } from "@/lib/orchestration/wiki-writeback-requests";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; requestId: string }> },
) {
  try {
    const { slug, requestId } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

    const actor = typeof body.actor === "string" ? body.actor.trim() : undefined;
    const { company } = getCompanyMemorySettings(slug, { persistDefaults: true });
    const existing = getWikiWritebackRequest(requestId);
    if (!existing || existing.companyId !== company.id) {
      return errorResponse(404, "wiki_writeback_request_not_found", "Wiki write-back request not found");
    }

    const result = await executeApprovedWikiMarkdownWriteback(requestId, { actor });
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error, "wiki.writeback.submit:post");
  }
}
