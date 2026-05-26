import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getCompanyMemorySettings } from "@/lib/orchestration/memory-vault";
import { getWikiWritebackRequest } from "@/lib/orchestration/wiki-writeback-requests";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; requestId: string }> },
) {
  try {
    const { slug, requestId } = await params;
    const { company } = getCompanyMemorySettings(slug, { persistDefaults: true });
    const request = getWikiWritebackRequest(requestId);
    if (!request || request.companyId !== company.id) {
      return errorResponse(404, "wiki_writeback_request_not_found", "Wiki write-back request not found");
    }

    return NextResponse.json({
      requestId: request.id,
      companyId: request.companyId,
      approvalState: request.approvalState,
      targetPath: request.targetPath,
      previousFileHash: request.previousFileHash,
      rollback: request.rollback,
      writtenAt: request.writtenAt,
      rolledBackAt: request.rolledBackAt,
    });
  } catch (error) {
    return handleRouteError(error, "wiki.writeback.rollback:get");
  }
}
