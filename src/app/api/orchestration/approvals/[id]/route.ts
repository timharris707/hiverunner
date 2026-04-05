import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  getApproval,
  updateApprovalStatus,
  requestRevision,
  resubmitApproval,
  addApprovalComment,
} from "@/lib/orchestration/service/approval";

export const dynamic = "force-dynamic";

const commentSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  authorUserId: z.string().trim().min(1).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return NextResponse.json(getApproval(id));
  } catch (error) {
    return handleRouteError(error, "approval:get");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "approve") return handleApprove(id, body);
    if (action === "reject") return handleReject(id, body);
    if (action === "request_revision") return handleRequestRevision(id, body);
    if (action === "resubmit") return handleResubmit(id, body);
    if (action === "comment") return handleComment(id, body);

    return errorResponse(400, "invalid_action", "Action must be approve, reject, request_revision, resubmit, or comment");
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid payload", error.flatten());
    }
    return handleRouteError(error, "approval:post");
  }
}

function handleApprove(approvalId: string, body: Record<string, unknown>) {
  const db = getOrchestrationDb();
  const { approval } = getApproval(approvalId);

  if (approval.status !== "pending" && approval.status !== "revision_requested") {
    return errorResponse(400, "not_actionable", `Approval is already ${approval.status}`);
  }

  const result = updateApprovalStatus({
    approvalId,
    status: "approved",
    decidedByUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
    decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : undefined,
  });

  if (approval.type === "hire_agent") {
    const agentId = typeof approval.payload.agentId === "string" ? approval.payload.agentId : null;
    if (agentId) {
      db.prepare(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ? AND status = 'paused'`)
        .run(new Date().toISOString(), agentId);
    }
  }

  return NextResponse.json(result);
}

function handleReject(approvalId: string, body: Record<string, unknown>) {
  const db = getOrchestrationDb();
  const { approval } = getApproval(approvalId);

  if (approval.status !== "pending" && approval.status !== "revision_requested") {
    return errorResponse(400, "not_actionable", `Approval is already ${approval.status}`);
  }

  const result = updateApprovalStatus({
    approvalId,
    status: "rejected",
    decidedByUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
    decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : undefined,
  });

  if (approval.type === "hire_agent") {
    const agentId = typeof approval.payload.agentId === "string" ? approval.payload.agentId : null;
    if (agentId) {
      const now = new Date().toISOString();
      db.prepare(`UPDATE agents SET status = 'offline', archived_at = ?, updated_at = ? WHERE id = ?`)
        .run(now, now, agentId);
    }
  }

  return NextResponse.json(result);
}

function handleRequestRevision(approvalId: string, body: Record<string, unknown>) {
  const result = requestRevision({
    approvalId,
    decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : undefined,
    decidedByUserId: typeof body.decidedByUserId === "string" ? body.decidedByUserId : "operator",
  });
  return NextResponse.json(result);
}

function handleResubmit(approvalId: string, body: Record<string, unknown>) {
  const payload = typeof body.payload === "object" && body.payload !== null
    ? body.payload as Record<string, unknown>
    : undefined;
  const result = resubmitApproval({ approvalId, payload });
  return NextResponse.json(result);
}

function handleComment(approvalId: string, body: Record<string, unknown>) {
  const parsed = commentSchema.parse(body);
  const { approval } = getApproval(approvalId);
  const result = addApprovalComment({
    approvalId,
    companyId: approval.companyId,
    body: parsed.body,
    authorUserId: parsed.authorUserId ?? "operator",
  });
  return NextResponse.json(result, { status: 201 });
}
