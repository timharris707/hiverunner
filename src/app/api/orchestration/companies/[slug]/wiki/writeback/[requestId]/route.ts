import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { getCompanyMemorySettings } from "@/lib/orchestration/memory-vault";
import {
  getWikiWritebackRequest,
  updateWikiWritebackApprovalState,
} from "@/lib/orchestration/wiki-writeback-requests";

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
    return NextResponse.json({ request });
  } catch (error) {
    return handleRouteError(error, "wiki.writeback.request:get");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; requestId: string }> },
) {
  try {
    const { slug, requestId } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (action !== "approve" && action !== "reject") {
      return errorResponse(400, "invalid_action", "action must be 'approve' or 'reject'");
    }

    const { company } = getCompanyMemorySettings(slug, { persistDefaults: true });
    const existing = getWikiWritebackRequest(requestId);
    if (!existing || existing.companyId !== company.id) {
      return errorResponse(404, "wiki_writeback_request_not_found", "Wiki write-back request not found");
    }

    const allowedFromStates = action === "approve" ? ["requested"] : ["requested", "approved"];
    if (!allowedFromStates.includes(existing.approvalState)) {
      return errorResponse(
        409,
        "invalid_approval_state_transition",
        `Cannot ${action} a request in state '${existing.approvalState}'`,
      );
    }

    const approvedBy = typeof body.approvedBy === "string" ? body.approvedBy.trim() || undefined : undefined;
    const rejectionReason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim() || undefined : undefined;

    const updated = updateWikiWritebackApprovalState(requestId, {
      approvalState: action === "approve" ? "approved" : "rejected",
      approvedBy: action === "approve" ? (approvedBy ?? null) : null,
      rejectionReason: action === "reject" ? (rejectionReason ?? null) : null,
    });

    return NextResponse.json({ request: updated });
  } catch (error) {
    return handleRouteError(error, "wiki.writeback.request:patch");
  }
}
