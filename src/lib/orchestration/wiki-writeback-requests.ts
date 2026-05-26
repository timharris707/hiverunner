import { createHash } from "node:crypto";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type WikiWritebackApprovalState =
  | "requested"
  | "approved"
  | "rejected"
  | "written"
  | "failed"
  | "rolled_back";

export type WikiWritebackRequest = {
  id: string;
  companyId: string;
  approvalState: WikiWritebackApprovalState;
  targetPath: string;
  idempotencyKey: string;
  sourceMemoryIds: string[];
  curationActionIds: string[];
  generatedContentHash: string;
  previousFileHash: string | null;
  rollback: Record<string, unknown>;
  requestedBy: string | null;
  approvedBy: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
  approvedAt: string | null;
  writtenAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateWikiWritebackRequestResult = {
  request: WikiWritebackRequest;
  idempotent: boolean;
};

const APPROVAL_STATES: readonly WikiWritebackApprovalState[] = [
  "requested",
  "approved",
  "rejected",
  "written",
  "failed",
  "rolled_back",
];

function resolveCompanyId(companyIdOrSlug: string): string {
  const needle = companyIdOrSlug.trim();
  if (!needle) throw new OrchestrationApiError(400, "missing_company", "companyIdOrSlug is required");
  const row = getOrchestrationDb()
    .prepare("SELECT id FROM companies WHERE id = ? OR slug = ? OR UPPER(company_code) = UPPER(?) LIMIT 1")
    .get(needle, needle, needle) as { id: string } | undefined;
  if (!row) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  return row.id;
}

function stableWritebackId(companyId: string, idempotencyKey: string): string {
  return createHash("sha256").update(`${companyId}\u001f${idempotencyKey}`).digest("hex");
}

export function wikiContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeStringArray(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function assertSourceMemoriesBelongToCompany(companyId: string, sourceMemoryIds: readonly string[]): void {
  if (sourceMemoryIds.length === 0) {
    throw new OrchestrationApiError(400, "missing_source_memory_ids", "sourceMemoryIds must include at least one memory record id");
  }

  const placeholders = sourceMemoryIds.map(() => "?").join(", ");
  const rows = getOrchestrationDb().prepare(`
    SELECT id
    FROM company_memory_records
    WHERE company_id = ?
      AND id IN (${placeholders})
  `).all(companyId, ...sourceMemoryIds) as Array<{ id: string }>;
  const found = new Set(rows.map((row) => row.id));
  const missing = sourceMemoryIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new OrchestrationApiError(
      404,
      "writeback_source_memory_not_found",
      "One or more source memory records were not found for this company",
      { sourceMemoryIds: missing },
    );
  }
}

function assertCurationActionsBelongToCompany(companyId: string, curationActionIds: readonly string[]): void {
  if (curationActionIds.length === 0) return;

  const placeholders = curationActionIds.map(() => "?").join(", ");
  const rows = getOrchestrationDb().prepare(`
    SELECT id
    FROM memory_curation_actions
    WHERE company_id = ?
      AND id IN (${placeholders})
  `).all(companyId, ...curationActionIds) as Array<{ id: string }>;
  const found = new Set(rows.map((row) => row.id));
  const missing = curationActionIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new OrchestrationApiError(
      404,
      "writeback_curation_action_not_found",
      "One or more curation actions were not found for this company",
      { curationActionIds: missing },
    );
  }
}

function assertApprovalState(value: string): WikiWritebackApprovalState {
  if ((APPROVAL_STATES as readonly string[]).includes(value)) return value as WikiWritebackApprovalState;
  throw new OrchestrationApiError(400, "invalid_writeback_approval_state", `approvalState must be one of: ${APPROVAL_STATES.join(", ")}`);
}

function mapRequest(row: {
  id: string;
  company_id: string;
  approval_state: string;
  target_path: string;
  idempotency_key: string;
  source_memory_ids_json: string;
  curation_action_ids_json: string;
  generated_content_hash: string;
  previous_file_hash: string | null;
  rollback_json: string;
  requested_by: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  approved_at: string | null;
  written_at: string | null;
  rolled_back_at: string | null;
  created_at: string;
  updated_at: string;
}): WikiWritebackRequest {
  return {
    id: row.id,
    companyId: row.company_id,
    approvalState: assertApprovalState(row.approval_state),
    targetPath: row.target_path,
    idempotencyKey: row.idempotency_key,
    sourceMemoryIds: parseJsonStringArray(row.source_memory_ids_json),
    curationActionIds: parseJsonStringArray(row.curation_action_ids_json),
    generatedContentHash: row.generated_content_hash,
    previousFileHash: row.previous_file_hash,
    rollback: parseJsonObject(row.rollback_json),
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    rejectionReason: row.rejection_reason,
    failureReason: row.failure_reason,
    approvedAt: row.approved_at,
    writtenAt: row.written_at,
    rolledBackAt: row.rolled_back_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getWikiWritebackRequest(id: string): WikiWritebackRequest | null {
  const row = getOrchestrationDb()
    .prepare("SELECT * FROM wiki_writeback_requests WHERE id = ? LIMIT 1")
    .get(id) as Parameters<typeof mapRequest>[0] | undefined;
  return row ? mapRequest(row) : null;
}

export function createWikiWritebackRequest(companyIdOrSlug: string, input: {
  targetPath: string;
  idempotencyKey: string;
  sourceMemoryIds: readonly string[];
  curationActionIds?: readonly string[];
  generatedContentHash: string;
  previousFileHash?: string | null;
  rollback?: Record<string, unknown>;
  requestedBy?: string | null;
}): CreateWikiWritebackRequestResult {
  const companyId = resolveCompanyId(companyIdOrSlug);
  const targetPath = input.targetPath.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const generatedContentHash = input.generatedContentHash.trim();
  const sourceMemoryIds = normalizeStringArray(input.sourceMemoryIds);
  const curationActionIds = normalizeStringArray(input.curationActionIds);
  if (!targetPath) throw new OrchestrationApiError(400, "missing_writeback_target_path", "targetPath is required");
  if (!idempotencyKey) throw new OrchestrationApiError(400, "missing_writeback_idempotency_key", "idempotencyKey is required");
  if (!generatedContentHash) throw new OrchestrationApiError(400, "missing_generated_content_hash", "generatedContentHash is required");

  const db = getOrchestrationDb();
  const now = new Date().toISOString();
  const id = stableWritebackId(companyId, idempotencyKey);
  const existing = getWikiWritebackRequest(id);
  if (existing) {
    return { request: existing, idempotent: true };
  }

  assertSourceMemoriesBelongToCompany(companyId, sourceMemoryIds);
  assertCurationActionsBelongToCompany(companyId, curationActionIds);

  const result = db.prepare(`
    INSERT OR IGNORE INTO wiki_writeback_requests (
      id, company_id, approval_state, target_path, idempotency_key,
      source_memory_ids_json, curation_action_ids_json, generated_content_hash,
      previous_file_hash, rollback_json, requested_by, created_at, updated_at
    )
    VALUES (?, ?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    companyId,
    targetPath,
    idempotencyKey,
    JSON.stringify(sourceMemoryIds),
    JSON.stringify(curationActionIds),
    generatedContentHash,
    input.previousFileHash?.trim() || null,
    JSON.stringify(input.rollback ?? {}),
    input.requestedBy?.trim() || null,
    now,
    now,
  );

  const request = getWikiWritebackRequest(id);
  if (!request) throw new Error("Failed to load wiki write-back request after insert");
  return { request, idempotent: result.changes === 0 };
}

export function updateWikiWritebackApprovalState(id: string, input: {
  approvalState: WikiWritebackApprovalState;
  approvedBy?: string | null;
  rejectionReason?: string | null;
  failureReason?: string | null;
  previousFileHash?: string | null;
  rollback?: Record<string, unknown>;
  writtenAt?: string | null;
  rolledBackAt?: string | null;
}): WikiWritebackRequest {
  const approvalState = assertApprovalState(input.approvalState);
  const existing = getWikiWritebackRequest(id);
  if (!existing) throw new OrchestrationApiError(404, "wiki_writeback_request_not_found", "Wiki write-back request not found");

  const now = new Date().toISOString();
  const approvedAt = approvalState === "approved" && !existing.approvedAt ? now : existing.approvedAt;
  getOrchestrationDb().prepare(`
    UPDATE wiki_writeback_requests
    SET approval_state = ?,
        approved_by = COALESCE(?, approved_by),
        rejection_reason = ?,
        failure_reason = ?,
        previous_file_hash = COALESCE(?, previous_file_hash),
        rollback_json = COALESCE(?, rollback_json),
        approved_at = ?,
        written_at = COALESCE(?, written_at),
        rolled_back_at = COALESCE(?, rolled_back_at),
        updated_at = ?
    WHERE id = ?
  `).run(
    approvalState,
    input.approvedBy?.trim() || null,
    input.rejectionReason?.trim() || null,
    input.failureReason?.trim() || null,
    input.previousFileHash?.trim() || null,
    input.rollback ? JSON.stringify(input.rollback) : null,
    approvedAt,
    input.writtenAt ?? (approvalState === "written" ? now : null),
    input.rolledBackAt ?? (approvalState === "rolled_back" ? now : null),
    now,
    id,
  );

  const updated = getWikiWritebackRequest(id);
  if (!updated) throw new Error("Failed to load wiki write-back request after update");
  return updated;
}

export function listWikiWritebackRequests(companyIdOrSlug: string, filters: {
  approvalState?: WikiWritebackApprovalState | "all";
  limit?: number;
} = {}): WikiWritebackRequest[] {
  const companyId = resolveCompanyId(companyIdOrSlug);
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? 100), 1), 500);
  const params: unknown[] = [companyId];
  let stateClause = "";
  if (filters.approvalState && filters.approvalState !== "all") {
    stateClause = "AND approval_state = ?";
    params.push(assertApprovalState(filters.approvalState));
  }
  params.push(limit);

  const rows = getOrchestrationDb().prepare(`
    SELECT *
    FROM wiki_writeback_requests
    WHERE company_id = ?
      ${stateClause}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT ?
  `).all(...params) as Array<Parameters<typeof mapRequest>[0]>;
  return rows.map(mapRequest);
}
