import { randomUUID } from "node:crypto";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type MemoryCandidateStatus = "pending" | "approved" | "specialist_approved" | "rejected";
export type MemoryCandidateScope = "role_project" | "company";

export type MemoryCandidate = {
  id: string;
  companyId: string | null;
  body: string;
  type: string | null;
  tags: string | null;
  category: string | null;
  status: MemoryCandidateStatus;
  scope: MemoryCandidateScope;
  proposedByAgent: string | null;
  sourceTaskId: string | null;
  sourceTaskKey: string | null;
  sourceRunId: string | null;
  proposedAt: string;
  routingTarget: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  targetSourceFile: string | null;
};

type MemoryCandidateRow = {
  id: string;
  company_id: string | null;
  body: string;
  type: string | null;
  tags: string | null;
  category: string | null;
  status: MemoryCandidateStatus;
  scope: MemoryCandidateScope;
  proposed_by_agent: string | null;
  source_task_id: string | null;
  source_task_key: string | null;
  source_run_id: string | null;
  proposed_at: string;
  routing_target: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  target_source_file: string | null;
};

function rowToCandidate(row: MemoryCandidateRow): MemoryCandidate {
  return {
    id: row.id,
    companyId: row.company_id,
    body: row.body,
    type: row.type,
    tags: row.tags,
    category: row.category,
    status: row.status,
    scope: row.scope,
    proposedByAgent: row.proposed_by_agent,
    sourceTaskId: row.source_task_id,
    sourceTaskKey: row.source_task_key,
    sourceRunId: row.source_run_id,
    proposedAt: row.proposed_at,
    routingTarget: row.routing_target,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    targetSourceFile: row.target_source_file,
  };
}

function resolveCompanyId(companyIdOrSlug: string): string {
  const needle = companyIdOrSlug.trim();
  const row = getOrchestrationDb()
    .prepare("SELECT id FROM companies WHERE id = ? OR slug = ? OR UPPER(company_code) = UPPER(?) LIMIT 1")
    .get(needle, needle, needle) as { id: string } | undefined;
  if (!row) {
    throw new Error(`Company not found: ${companyIdOrSlug}`);
  }
  return row.id;
}

export function listMemoryCandidates(
  companyIdOrSlug: string,
  options: {
    status?: MemoryCandidateStatus | "all";
    routingTarget?: string;
    limit?: number;
  } = {},
): MemoryCandidate[] {
  const db = getOrchestrationDb();
  const companyId = resolveCompanyId(companyIdOrSlug);
  const { status = "pending", routingTarget, limit = 200 } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];

  conditions.push("(mc.company_id = ? OR (mc.company_id IS NULL AND p.company_id = ?))");
  params.push(companyId, companyId);

  if (status !== "all") {
    conditions.push("mc.status = ?");
    params.push(status);
  }

  if (routingTarget) {
    conditions.push("mc.routing_target = ?");
    params.push(routingTarget);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare<unknown[], MemoryCandidateRow>(`
    SELECT
      mc.id,
      mc.company_id,
      mc.body,
      mc.type,
      mc.tags,
      mc.category,
      mc.status,
      mc.scope,
      mc.proposed_by_agent,
      mc.source_task_id,
      t.task_key AS source_task_key,
      mc.source_run_id,
      mc.proposed_at,
      mc.routing_target,
      mc.reviewed_by,
      mc.reviewed_at,
      mc.target_source_file
    FROM memory_candidates mc
    LEFT JOIN tasks t ON t.id = mc.source_task_id
    LEFT JOIN projects p ON p.id = t.project_id
    ${where}
    ORDER BY mc.proposed_at DESC
    LIMIT ?
  `).all(...params, limit);

  return rows.map(rowToCandidate);
}

export function getMemoryCandidate(id: string): MemoryCandidate | null {
  const db = getOrchestrationDb();

  const row = db.prepare<[string], MemoryCandidateRow>(`
    SELECT
      mc.id, mc.company_id, mc.body, mc.type, mc.tags, mc.category, mc.status, mc.scope,
      mc.proposed_by_agent, mc.source_task_id, t.task_key AS source_task_key,
      mc.source_run_id, mc.proposed_at, mc.routing_target,
      mc.reviewed_by, mc.reviewed_at, mc.target_source_file
    FROM memory_candidates mc
    LEFT JOIN tasks t ON t.id = mc.source_task_id
    WHERE mc.id = ?
  `).get(id);

  return row ? rowToCandidate(row) : null;
}

export type ReviewOutcome = "approved" | "specialist_approved" | "rejected";

/**
 * Review a memory candidate. Returns the updated candidate and the resolved outcome.
 *
 * State machine:
 *   pending (routed to specialist) + specialist approves  → specialist_approved, routing_target cleared
 *   pending (unrouted)            + any reviewer approves → approved
 *   specialist_approved           + reviewer approves     → approved  (operator final confirmation)
 *   any reviewable state          + rejected              → rejected
 *
 * Write-back to target_source_file and company_memory_record creation are NOT done here;
 * callers must call writeBackApprovedCandidate when outcome === "approved".
 */
export function reviewMemoryCandidate(
  id: string,
  decision: "approved" | "rejected",
  reviewedBy: string,
): { candidate: MemoryCandidate; outcome: ReviewOutcome } {
  const db = getOrchestrationDb();

  const existing = getMemoryCandidate(id);
  if (!existing) {
    throw new Error(`Memory candidate not found: ${id}`);
  }

  if (existing.status !== "pending" && existing.status !== "specialist_approved") {
    throw new Error(`Candidate is already ${existing.status}`);
  }

  // For pending candidates routed to a specialist: only that specialist may review.
  if (
    existing.status === "pending" &&
    existing.routingTarget &&
    existing.routingTarget.toLowerCase() !== reviewedBy.toLowerCase()
  ) {
    throw new Error(
      `Not authorized: candidate is routed to ${existing.routingTarget}, not ${reviewedBy}`,
    );
  }

  const now = new Date().toISOString();

  let outcome: ReviewOutcome;
  let newRoutingTarget: string | null = existing.routingTarget;

  if (decision === "rejected") {
    outcome = "rejected";
  } else if (
    existing.status === "pending" &&
    existing.routingTarget &&
    existing.routingTarget.toLowerCase() === reviewedBy.toLowerCase()
  ) {
    // Specialist pre-approval: move to specialist_approved, clear routing so the operator sees it.
    outcome = "specialist_approved";
    newRoutingTarget = null;
  } else {
    // Full approval: unrouted pending or specialist_approved confirmed by final reviewer.
    outcome = "approved";
  }

  db.prepare(`
    UPDATE memory_candidates
    SET status = ?, reviewed_by = ?, reviewed_at = ?, routing_target = ?
    WHERE id = ?
  `).run(outcome, reviewedBy, now, newRoutingTarget, id);

  return {
    candidate: {
      ...existing,
      status: outcome,
      reviewedBy,
      reviewedAt: now,
      routingTarget: newRoutingTarget,
    },
    outcome,
  };
}

export function insertMemoryCandidate(candidate: {
  companyId?: string | null;
  body: string;
  category?: string | null;
  type?: string | null;
  tags?: string | null;
  scope?: MemoryCandidateScope;
  proposedByAgent?: string | null;
  sourceTaskId?: string | null;
  sourceRunId?: string | null;
  routingTarget?: string | null;
  targetSourceFile?: string | null;
}): MemoryCandidate {
  const db = getOrchestrationDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const sourceCompany = candidate.sourceTaskId
    ? db.prepare(`
        SELECT p.company_id
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.id = ?
        LIMIT 1
      `).get(candidate.sourceTaskId) as { company_id: string } | undefined
    : undefined;
  const companyId = candidate.companyId ?? sourceCompany?.company_id ?? null;

  db.prepare(`
    INSERT INTO memory_candidates
      (id, company_id, body, category, type, tags, scope, proposed_by_agent, source_task_id,
       source_run_id, routing_target, target_source_file, proposed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    companyId,
    candidate.body,
    candidate.category ?? null,
    candidate.type ?? null,
    candidate.tags ?? null,
    candidate.scope ?? "role_project",
    candidate.proposedByAgent ?? null,
    candidate.sourceTaskId ?? null,
    candidate.sourceRunId ?? null,
    candidate.routingTarget ?? null,
    candidate.targetSourceFile ?? null,
    now,
  );

  return getMemoryCandidate(id)!;
}
