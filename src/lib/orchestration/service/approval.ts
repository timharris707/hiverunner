import { randomUUID } from "crypto";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { OrchestrationApiError } from "@/lib/orchestration/api";
import { markInboxThreadRead } from "@/lib/orchestration/company-service";
import type {
  OrchestrationApproval,
  OrchestrationApprovalComment,
  ApprovalStatus,
  ApprovalType,
} from "@/lib/orchestration/types";

/* ── Row shapes ── */

type ApprovalRow = {
  id: string;
  company_id: string;
  type: string;
  status: string;
  requested_by_agent_id: string | null;
  payload_json: string;
  decision_note: string | null;
  decided_by_user_id: string | null;
  decided_at: string | null;
  linked_task_id: string | null;
  created_at: string;
  updated_at: string;
  agent_name?: string | null;
};

type CommentRow = {
  id: string;
  approval_id: string;
  author_agent_id: string | null;
  author_user_id: string | null;
  body: string;
  created_at: string;
  agent_name?: string | null;
};

/* ── Mappers ── */

function approvalFromRow(row: ApprovalRow): OrchestrationApproval {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload_json || "{}"); } catch { /* */ }
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type as ApprovalType,
    status: row.status as ApprovalStatus,
    requestedByAgentId: row.requested_by_agent_id,
    requestedByAgentName: row.agent_name ?? null,
    payload,
    decisionNote: row.decision_note,
    decidedByUserId: row.decided_by_user_id,
    decidedAt: row.decided_at,
    linkedTaskId: row.linked_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function commentFromRow(row: CommentRow): OrchestrationApprovalComment {
  return {
    id: row.id,
    approvalId: row.approval_id,
    authorAgentId: row.author_agent_id,
    authorAgentName: row.agent_name ?? null,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

/* ── Helpers ── */

function resolveCompany(db: ReturnType<typeof getOrchestrationDb>, companyIdOrSlug: string) {
  // Try direct match (id or current slug), then fall back to stored slug alias.
  const row = db
    .prepare("SELECT id FROM companies WHERE (id = ? OR slug = ?) AND archived_at IS NULL")
    .get(companyIdOrSlug, companyIdOrSlug) as { id: string } | undefined;
  if (row) return row.id;

  const alias = db
    .prepare("SELECT company_id FROM company_slug_aliases WHERE slug_alias = ? LIMIT 1")
    .get(companyIdOrSlug) as { company_id: string } | undefined;
  if (alias) return alias.company_id;

  throw new OrchestrationApiError(404, "company_not_found", "Company not found");
}

/* ── Approval CRUD ── */

export function listApprovals(input: {
  companyIdOrSlug: string;
  status?: string;
  type?: string;
}): { approvals: OrchestrationApproval[] } {
  const db = getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);
  const where = ["a.company_id = ?"];
  const args: unknown[] = [companyId];
  if (input.status) { where.push("a.status = ?"); args.push(input.status); }
  if (input.type) { where.push("a.type = ?"); args.push(input.type); }
  const rows = db.prepare(
    `SELECT a.*, ag.name AS agent_name FROM approvals a LEFT JOIN agents ag ON ag.id = a.requested_by_agent_id WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC`
  ).all(...args) as ApprovalRow[];
  return { approvals: rows.map(approvalFromRow) };
}

export function createApproval(input: {
  companyIdOrSlug: string;
  type: string;
  requestedByAgentId?: string;
  payload?: Record<string, unknown>;
  linkedTaskId?: string;
}): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const companyId = resolveCompany(db, input.companyIdOrSlug);

  // ── Dedup: prevent duplicate pending approvals for the same target ──
  // Key priority: linked_task_id > payload agent_id > payload name+role.
  // Only pending/revision_requested approvals are considered open.
  const payload = input.payload ?? {};
  const existingId = (() => {
    // Most specific: same type + same linked task
    if (input.linkedTaskId) {
      const row = db.prepare(
        `SELECT id FROM approvals WHERE company_id = ? AND type = ? AND linked_task_id = ? AND status IN ('pending', 'revision_requested') LIMIT 1`
      ).get(companyId, input.type, input.linkedTaskId) as { id: string } | undefined;
      if (row) return row.id;
    }
    // For hire_agent: match on payload agent_id if present, else name+role
    if (input.type === "hire_agent") {
      const targetId = payload.agentId ?? payload.agent_id;
      if (typeof targetId === "string" && targetId) {
        const row = db.prepare(
          `SELECT id FROM approvals WHERE company_id = ? AND type = 'hire_agent' AND status IN ('pending', 'revision_requested') AND json_extract(payload_json, '$.agentId') = ? LIMIT 1`
        ).get(companyId, targetId) as { id: string } | undefined;
        if (row) return row.id;
      }
      const name = typeof payload.name === "string" ? payload.name.trim().toLowerCase() : "";
      const role = typeof payload.role === "string" ? payload.role.trim().toLowerCase() : "";
      if (name) {
        const row = db.prepare(
          `SELECT id FROM approvals WHERE company_id = ? AND type = 'hire_agent' AND status IN ('pending', 'revision_requested') AND LOWER(TRIM(json_extract(payload_json, '$.name'))) = ? AND LOWER(TRIM(json_extract(payload_json, '$.role'))) = ? LIMIT 1`
        ).get(companyId, name, role) as { id: string } | undefined;
        if (row) return row.id;
      }
    }
    return null;
  })();

  if (existingId) {
    return getApproval(existingId);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO approvals (id, company_id, type, status, requested_by_agent_id, payload_json, linked_task_id, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
  ).run(id, companyId, input.type, input.requestedByAgentId ?? null, JSON.stringify(payload), input.linkedTaskId ?? null, now, now);
  return getApproval(id);
}

export function getApproval(approvalId: string): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const row = db.prepare(
    `SELECT a.*, ag.name AS agent_name FROM approvals a LEFT JOIN agents ag ON ag.id = a.requested_by_agent_id WHERE a.id = ?`
  ).get(approvalId) as ApprovalRow | undefined;
  if (!row) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  const approval = approvalFromRow(row);
  approval.comments = listApprovalComments(approvalId);
  return { approval };
}

export function updateApprovalStatus(input: {
  approvalId: string;
  status: string;
  decidedByUserId?: string;
  decisionNote?: string;
}): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const existing = db.prepare("SELECT id, status, company_id FROM approvals WHERE id = ?").get(input.approvalId) as { id: string; status: string; company_id: string } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE approvals SET status = ?, decided_by_user_id = ?, decision_note = ?, decided_at = ?, updated_at = ? WHERE id = ?`
  ).run(input.status, input.decidedByUserId ?? null, input.decisionNote ?? null, now, now, input.approvalId);

  // Mark related inbox events as read when the approval is resolved
  // (approved, rejected, cancelled) — keeps inbox count in sync
  const resolved = ["approved", "rejected", "cancelled"].includes(input.status);
  if (resolved) {
    try {
      markInboxThreadRead({
        companyIdOrSlug: existing.company_id,
        threadKey: input.approvalId,
        threadKind: "approval",
      });
    } catch { /* non-fatal — inbox sync is best-effort */ }
  }

  return getApproval(input.approvalId);
}

/* ── Revision requested flow ── */

export function requestRevision(input: {
  approvalId: string;
  decisionNote?: string;
  decidedByUserId?: string;
}): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const existing = db.prepare("SELECT id, status FROM approvals WHERE id = ?").get(input.approvalId) as { id: string; status: string } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  if (existing.status !== "pending") {
    throw new OrchestrationApiError(400, "not_pending", `Cannot request revision on ${existing.status} approval`);
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE approvals SET status = 'revision_requested', decided_by_user_id = ?, decision_note = ?, decided_at = ?, updated_at = ? WHERE id = ?`
  ).run(input.decidedByUserId ?? "operator", input.decisionNote ?? null, now, now, input.approvalId);
  return getApproval(input.approvalId);
}

export function resubmitApproval(input: {
  approvalId: string;
  payload?: Record<string, unknown>;
}): { approval: OrchestrationApproval } {
  const db = getOrchestrationDb();
  const existing = db.prepare("SELECT id, status, payload_json FROM approvals WHERE id = ?").get(input.approvalId) as { id: string; status: string; payload_json: string } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  if (existing.status !== "revision_requested") {
    throw new OrchestrationApiError(400, "not_revision_requested", `Cannot resubmit: approval is ${existing.status}`);
  }
  const now = new Date().toISOString();
  const payloadJson = input.payload ? JSON.stringify(input.payload) : existing.payload_json;
  db.prepare(
    `UPDATE approvals SET status = 'pending', payload_json = ?, decision_note = NULL, decided_by_user_id = NULL, decided_at = NULL, updated_at = ? WHERE id = ?`
  ).run(payloadJson, now, input.approvalId);
  return getApproval(input.approvalId);
}

/* ── Comments ── */

export function listApprovalComments(approvalId: string): OrchestrationApprovalComment[] {
  const db = getOrchestrationDb();
  const rows = db.prepare(
    `SELECT ac.*, ag.name AS agent_name FROM approval_comments ac LEFT JOIN agents ag ON ag.id = ac.author_agent_id WHERE ac.approval_id = ? ORDER BY ac.created_at ASC`
  ).all(approvalId) as CommentRow[];
  return rows.map(commentFromRow);
}

export function addApprovalComment(input: {
  approvalId: string;
  companyId: string;
  body: string;
  authorAgentId?: string;
  authorUserId?: string;
}): { comment: OrchestrationApprovalComment } {
  const db = getOrchestrationDb();
  const existing = db.prepare("SELECT id FROM approvals WHERE id = ?").get(input.approvalId) as { id: string } | undefined;
  if (!existing) throw new OrchestrationApiError(404, "approval_not_found", "Approval not found");
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO approval_comments (id, company_id, approval_id, author_agent_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.companyId, input.approvalId, input.authorAgentId ?? null, input.authorUserId ?? null, input.body, now, now);
  const row = db.prepare(
    `SELECT ac.*, ag.name AS agent_name FROM approval_comments ac LEFT JOIN agents ag ON ag.id = ac.author_agent_id WHERE ac.id = ?`
  ).get(id) as CommentRow;
  return { comment: commentFromRow(row) };
}
