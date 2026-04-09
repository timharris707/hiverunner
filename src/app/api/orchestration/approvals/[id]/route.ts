import { NextRequest, NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { randomUUID } from "crypto";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import {
  getApproval,
  updateApprovalStatus,
  requestRevision,
  resubmitApproval,
  addApprovalComment,
} from "@/lib/orchestration/service/approval";
import { enqueueWakeup } from "@/lib/orchestration/engine/engine";
import { generateAgentAvatarDataUrl } from "@/lib/orchestration/avatar";

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
      // Agent was pre-created by the hire API — just unpause it
      db.prepare(`UPDATE agents SET status = 'idle', updated_at = ? WHERE id = ? AND status = 'paused'`)
        .run(new Date().toISOString(), agentId);
    } else {
      // Agent was requested by the engine (executeHireAgent) which only
      // created the approval, not the agent record. Materialize the agent
      // now from the approval payload.
      const p = approval.payload;
      const name = typeof p.name === "string" ? p.name.trim() : "Unnamed Agent";
      const role = typeof p.role === "string" ? p.role.trim() : "General";
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const model = typeof p.model === "string" ? p.model : "anthropic/claude-sonnet-4-6";
      const emoji = typeof p.emoji === "string" ? p.emoji : "pixel";
      const personality = typeof p.capabilities === "string" && p.capabilities
        ? `Role: ${role}. ${p.capabilities}`
        : `Role: ${role} at the company`;
      const now = new Date().toISOString();
      const newAgentId = randomUUID();
      const avatarUrl = generateAgentAvatarDataUrl({
        name, role, personality, emoji,
        theme: { name: "Corporate Noir", promptTemplate: "dark premium portrait", keywords: [] },
      });
      db.prepare(
        `INSERT INTO agents
          (id, company_id, name, slug, emoji, role, personality, avatar_url, model, status, reporting_to, skills_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, '[]', ?, ?)`
      ).run(
        newAgentId, approval.companyId, name, slug, emoji, role, personality,
        avatarUrl, model, approval.requestedByAgentId ?? null, now, now,
      );
    }
  }

  // Approval feedback loop: queue wakeup for the requesting agent so they can act on the decision
  if (approval.requestedByAgentId) {
    try {
      enqueueWakeup({
        agentId: approval.requestedByAgentId,
        companyId: approval.companyId,
        source: "explicit",
        reason: `Approval ${approvalId} was approved (${approval.type})`,
        payload: {
          approvalId,
          approvalType: approval.type,
          approvalStatus: "approved",
          decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
        },
        idempotencyKey: `approval-feedback:${approvalId}:approved`,
      }, db);
    } catch (wakeErr) {
      console.error("[approval] feedback wakeup failed:", wakeErr instanceof Error ? wakeErr.message : String(wakeErr));
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

  // Approval feedback loop: queue wakeup for the requesting agent so they can adjust
  if (approval.requestedByAgentId) {
    try {
      enqueueWakeup({
        agentId: approval.requestedByAgentId,
        companyId: approval.companyId,
        source: "explicit",
        reason: `Approval ${approvalId} was rejected (${approval.type})`,
        payload: {
          approvalId,
          approvalType: approval.type,
          approvalStatus: "rejected",
          decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
        },
        idempotencyKey: `approval-feedback:${approvalId}:rejected`,
      }, db);
    } catch (wakeErr) {
      console.error("[approval] feedback wakeup failed:", wakeErr instanceof Error ? wakeErr.message : String(wakeErr));
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
