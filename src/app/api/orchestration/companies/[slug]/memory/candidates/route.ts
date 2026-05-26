import { NextRequest, NextResponse } from "next/server";

import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  getMemoryCandidate,
  listMemoryCandidates,
  reviewMemoryCandidate,
  type MemoryCandidateStatus,
} from "@/lib/orchestration/memory-candidates";
import { MemoryWritebackError, writeBackApprovedCandidate } from "@/lib/orchestration/memory-writeback";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { PUBLIC_HUMAN_LABEL } from "@/lib/public-identity";

export const dynamic = "force-dynamic";

type FailedWriteback = {
  status: "failed";
  error: string;
  filePath: string | null;
};

function parseStatus(value: string | null): MemoryCandidateStatus | "all" | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "all" || v === "pending" || v === "approved" || v === "specialist_approved" || v === "rejected") {
    return v as MemoryCandidateStatus | "all";
  }
  return undefined;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const statusParam = request.nextUrl.searchParams.get("status");
    const routingTarget = request.nextUrl.searchParams.get("routingTarget") ?? undefined;
    const status = parseStatus(statusParam) ?? "pending";

    if (statusParam && !parseStatus(statusParam)) {
      return errorResponse(400, "invalid_status", "status must be pending, approved, specialist_approved, rejected, or all");
    }

    const candidates = listMemoryCandidates(slug, { status, routingTarget });
    return NextResponse.json({ candidates });
  } catch (error) {
    return handleRouteError(error, "memory.candidates:get");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) {
      return errorResponse(400, "invalid_body", "Request body must be valid JSON");
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return errorResponse(400, "missing_id", "id is required");
    }

    const decision = typeof body.decision === "string" ? body.decision.trim() : "";
    if (decision !== "approved" && decision !== "rejected") {
      return errorResponse(400, "invalid_decision", "decision must be 'approved' or 'rejected'");
    }

    const reviewedBy = typeof body.reviewedBy === "string" ? body.reviewedBy.trim() : PUBLIC_HUMAN_LABEL;
    if (!reviewedBy) {
      return errorResponse(400, "missing_reviewer", "reviewedBy is required");
    }

    const db = getOrchestrationDb();
    const company = db
      .prepare("SELECT id FROM companies WHERE id = ? OR slug = ? OR UPPER(company_code) = UPPER(?) LIMIT 1")
      .get(slug, slug, slug) as { id: string } | undefined;
    const existing = getMemoryCandidate(id);
    if (!company || !existing || (existing.companyId && existing.companyId !== company.id)) {
      return errorResponse(404, "not_found", "Memory candidate not found for this company");
    }

    if (existing.status !== "pending" && existing.status !== "specialist_approved") {
      return errorResponse(409, "already_reviewed", `Candidate is already ${existing.status}`);
    }

    if (
      existing.status === "pending" &&
      existing.routingTarget &&
      existing.routingTarget.toLowerCase() !== reviewedBy.toLowerCase()
    ) {
      return errorResponse(403, "not_authorized", `Not authorized: candidate is routed to ${existing.routingTarget}, not ${reviewedBy}`);
    }

    const isSpecialistPreApproval =
      decision === "approved" &&
      existing.status === "pending" &&
      !!existing.routingTarget &&
      existing.routingTarget.toLowerCase() === reviewedBy.toLowerCase();
    const isFinalApproval = decision === "approved" && !isSpecialistPreApproval;

    let reviewResult: Awaited<ReturnType<typeof reviewMemoryCandidate>>;
    try {
      if (isFinalApproval) {
        const now = new Date().toISOString();
        const updated = db.prepare(`
          UPDATE memory_candidates
          SET status = 'approved', reviewed_by = ?, reviewed_at = ?, routing_target = NULL
          WHERE id = ? AND status IN ('pending', 'specialist_approved')
        `).run(reviewedBy, now, id);
        if (updated.changes !== 1) {
          const latest = getMemoryCandidate(id);
          return NextResponse.json(
            {
              candidate: latest,
              outcome: latest?.status ?? "approved",
              writeback: null,
              error: "Candidate changed before approval could be recorded",
            },
            { status: 409 },
          );
        }
        const approvedCandidate = getMemoryCandidate(id);
        if (!approvedCandidate) {
          return errorResponse(404, "not_found", "Memory candidate not found for this company");
        }
        const writeback = await writeBackApprovedCandidate(approvedCandidate, slug, reviewedBy);
        return NextResponse.json({
          candidate: {
            ...existing,
            status: "approved",
            reviewedBy,
            reviewedAt: now,
            routingTarget: null,
          },
          outcome: "approved",
          writeback,
        });
      }

      reviewResult = reviewMemoryCandidate(id, decision, reviewedBy);
    } catch (reviewError) {
      const message = reviewError instanceof Error ? reviewError.message : "Review failed";
      if (isFinalApproval) {
        db.prepare(`
          UPDATE memory_candidates
          SET status = ?, reviewed_by = ?, reviewed_at = ?, routing_target = ?
          WHERE id = ?
            AND status = 'approved'
        `).run(existing.status, existing.reviewedBy, existing.reviewedAt, existing.routingTarget, id);
        const latest = getMemoryCandidate(id);
        const writeback: FailedWriteback = {
          status: "failed",
          error: message,
          filePath: latest?.targetSourceFile ?? null,
        };
        return NextResponse.json(
          {
            candidate: latest,
            outcome: latest?.status ?? existing.status,
            writeback,
            error: "Memory writeback failed; candidate was not approved",
          },
          { status: reviewError instanceof MemoryWritebackError ? reviewError.status : 500 },
        );
      }
      if (message.includes("Not authorized")) {
        return errorResponse(403, "not_authorized", message);
      }
      if (message.includes("not found")) {
        return errorResponse(404, "not_found", message);
      }
      if (message.includes("already")) {
        return errorResponse(409, "already_reviewed", message);
      }
      throw reviewError;
    }

    const { candidate, outcome } = reviewResult;

    return NextResponse.json({ candidate, outcome, writeback: null });
  } catch (error) {
    return handleRouteError(error, "memory.candidates:patch");
  }
}
