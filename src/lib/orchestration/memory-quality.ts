import { createHash, randomUUID } from "node:crypto";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type MemoryQualityTargetType = "source_index" | "memory_record";
export type MemoryQualityQueueType =
  | "all"
  | "duplicates"
  | "stale"
  | "weak_provenance"
  | "broken_links"
  | "low_confidence";
export type MemoryQualitySignalQueue = Exclude<MemoryQualityQueueType, "all">;
export type MemoryQualitySeverity = "critical" | "high" | "medium" | "low";
export type MemoryCurationState = "open" | "reviewed" | "acknowledged" | "resolved" | "dismissed" | "superseded" | "archived" | "rewrite_requested" | "merge_candidate";
export type MemoryCurationAction = "mark_reviewed" | "acknowledge" | "resolve" | "dismiss" | "supersede" | "reopen" | "archive" | "request_rewrite" | "suggest_merge" | "restore";
export type MemoryQualityRecomputationStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type MemoryQualityTargetSummary = {
  id: string;
  type: MemoryQualityTargetType;
  title: string;
  excerpt: string;
  sourcePath: string | null;
  layer: string | null;
  status: string | null;
  source: string | null;
  confidence: number | null;
  tags: string[];
  linkedIds: string[];
  updatedAt: string | null;
};

export type MemoryQualitySignal = {
  id: string;
  companyId: string;
  targetType: MemoryQualityTargetType;
  targetId: string;
  queue: MemoryQualitySignalQueue;
  severity: MemoryQualitySeverity;
  qualityScore: number;
  confidence: number | null;
  reason: string;
  evidence: Record<string, unknown>;
  scoringContract: string;
  sourceFingerprint: string;
  computedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryQualityScore = {
  id: string;
  companyId: string;
  targetType: MemoryQualityTargetType;
  targetId: string;
  qualityScore: number;
  issueCount: number;
  recomputationKey: string;
  sourceFingerprint: string;
  computedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryQualityQueueItem = MemoryQualityScore & {
  curationState: MemoryCurationState;
  target: MemoryQualityTargetSummary;
  queues: MemoryQualitySignalQueue[];
  severity: MemoryQualitySeverity;
  reasons: string[];
  signalDetails: MemoryQualitySignal[];
};

export type MemoryQualityDashboard = {
  company: { id: string; slug: string; name: string };
  kpis: {
    totalScored: number;
    openIssues: number;
    reviewedIssues: number;
    acknowledgedIssues: number;
    resolvedIssues: number;
    dismissedIssues: number;
    supersededIssues: number;
    archivedIssues: number;
    rewriteRequestedIssues: number;
    mergeCandidateIssues: number;
    averageQualityScore: number | null;
    criticalIssues: number;
  };
  queues: Record<MemoryQualitySignalQueue, { count: number; worstScore: number | null }>;
  recentRecomputation: MemoryQualityRecomputation | null;
};

export type MemoryCurationStateRecord = {
  id: string;
  companyId: string;
  targetType: MemoryQualityTargetType;
  targetId: string;
  state: MemoryCurationState;
  previousState: MemoryCurationState | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  dismissedAt: string | null;
  supersededAt: string | null;
  archivedAt: string | null;
  actor: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MemoryCurationActionRecord = {
  id: string;
  companyId: string;
  targetType: MemoryQualityTargetType;
  targetId: string;
  action: MemoryCurationAction;
  fromState: MemoryCurationState | null;
  toState: MemoryCurationState;
  actor: string | null;
  note: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type MemoryQualityRecomputation = {
  id: string;
  companyId: string;
  scope: "company" | "target";
  targetType: MemoryQualityTargetType | null;
  targetId: string | null;
  recomputationKey: string;
  inputHash: string;
  status: MemoryQualityRecomputationStatus;
  scoresWritten: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const QUEUES: readonly MemoryQualitySignalQueue[] = ["duplicates", "stale", "weak_provenance", "broken_links", "low_confidence"];
const STATES: readonly MemoryCurationState[] = ["open", "reviewed", "acknowledged", "resolved", "dismissed", "superseded", "archived", "rewrite_requested", "merge_candidate"];
const ACTIONS: readonly MemoryCurationAction[] = ["mark_reviewed", "acknowledge", "resolve", "dismiss", "supersede", "reopen", "archive", "request_rewrite", "suggest_merge", "restore"];

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}

function resolveCompany(companyIdOrSlug: string): { id: string; slug: string; name: string } {
  const needle = companyIdOrSlug.trim();
  const row = getOrchestrationDb()
    .prepare("SELECT id, slug, name FROM companies WHERE id = ? OR slug = ? OR UPPER(company_code) = UPPER(?) LIMIT 1")
    .get(needle, needle, needle) as { id: string; slug: string; name: string } | undefined;
  if (!row) throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  return row;
}

function resolveCompanyId(companyIdOrSlug: string): string {
  return resolveCompany(companyIdOrSlug).id;
}

function assertTargetType(value: unknown): MemoryQualityTargetType {
  if (value === "source_index" || value === "memory_record") return value;
  throw new OrchestrationApiError(400, "invalid_target_type", "targetType must be source_index or memory_record");
}

function assertQueue(value: unknown): MemoryQualityQueueType {
  if (value === "all" || (typeof value === "string" && (QUEUES as readonly string[]).includes(value))) {
    return value as MemoryQualityQueueType;
  }
  throw new OrchestrationApiError(400, "invalid_quality_queue", `queue must be one of: all, ${QUEUES.join(", ")}`);
}

function assertSignalQueue(value: unknown): MemoryQualitySignalQueue {
  if (typeof value === "string" && (QUEUES as readonly string[]).includes(value)) return value as MemoryQualitySignalQueue;
  throw new OrchestrationApiError(400, "invalid_quality_queue", `queue must be one of: ${QUEUES.join(", ")}`);
}

function assertCurationStateFilter(value: unknown): MemoryCurationState | "all" | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "all" || (typeof value === "string" && (STATES as readonly string[]).includes(value))) {
    return value as MemoryCurationState | "all";
  }
  throw new OrchestrationApiError(400, "invalid_curation_state", `state must be one of: all, ${STATES.join(", ")}`);
}

function assertLimit(value: unknown, fallback = 100): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new OrchestrationApiError(400, "invalid_limit", "limit must be a positive number");
  }
  return Math.min(Math.floor(parsed), 500);
}

function assertScore(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new OrchestrationApiError(400, "invalid_quality_score", "qualityScore must be a number from 0 to 100");
  }
  return value;
}

function assertConfidence(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new OrchestrationApiError(400, "invalid_confidence", "confidence must be a number from 0 to 1");
  }
  return value;
}

function assertTargetBelongsToCompany(companyId: string, targetType: MemoryQualityTargetType, targetId: string): void {
  const db = getOrchestrationDb();
  const exists = targetType === "source_index"
    ? db.prepare("SELECT 1 FROM memory_source_index WHERE company_id = ? AND record_id = ? LIMIT 1").get(companyId, targetId)
    : db.prepare("SELECT 1 FROM company_memory_records WHERE company_id = ? AND id = ? LIMIT 1").get(companyId, targetId);
  if (!exists) throw new OrchestrationApiError(404, "memory_quality_target_not_found", "Memory quality target not found for company");
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

function parseUnknownStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") return parseJsonStringArray(value);
  return [];
}

function severityForScore(score: number): MemoryQualitySeverity {
  if (score < 35) return "critical";
  if (score < 55) return "high";
  if (score < 75) return "medium";
  return "low";
}

function mapSignal(row: {
  id: string;
  company_id: string;
  target_type: MemoryQualityTargetType;
  target_id: string;
  queue: MemoryQualitySignalQueue;
  severity: MemoryQualitySeverity;
  quality_score: number;
  confidence: number | null;
  reason: string;
  evidence_json: string;
  scoring_contract: string;
  source_fingerprint: string;
  computed_at: string;
  created_at: string;
  updated_at: string;
}): MemoryQualitySignal {
  return {
    id: row.id,
    companyId: row.company_id,
    targetType: row.target_type,
    targetId: row.target_id,
    queue: row.queue,
    severity: row.severity,
    qualityScore: Number(row.quality_score),
    confidence: row.confidence === null ? null : Number(row.confidence),
    reason: row.reason,
    evidence: parseJsonObject(row.evidence_json),
    scoringContract: row.scoring_contract,
    sourceFingerprint: row.source_fingerprint,
    computedAt: row.computed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRecomputation(row: {
  id: string;
  company_id: string;
  scope: "company" | "target";
  target_type: MemoryQualityTargetType | null;
  target_id: string | null;
  recomputation_key: string;
  input_hash: string;
  status: MemoryQualityRecomputationStatus;
  scores_written: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}): MemoryQualityRecomputation {
  return {
    id: row.id,
    companyId: row.company_id,
    scope: row.scope,
    targetType: row.target_type,
    targetId: row.target_id,
    recomputationKey: row.recomputation_key,
    inputHash: row.input_hash,
    status: row.status,
    scoresWritten: Number(row.scores_written),
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCurationState(row: {
  id: string;
  company_id: string;
  target_type: MemoryQualityTargetType;
  target_id: string;
  state: MemoryCurationState;
  previous_state: MemoryCurationState | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
  dismissed_at: string | null;
  superseded_at: string | null;
  archived_at: string | null;
  actor: string | null;
  note: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}): MemoryCurationStateRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    targetType: row.target_type,
    targetId: row.target_id,
    state: row.state,
    previousState: row.previous_state,
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    dismissedAt: row.dismissed_at,
    supersededAt: row.superseded_at,
    archivedAt: row.archived_at,
    actor: row.actor,
    note: row.note,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCurationAction(row: {
  id: string;
  company_id: string;
  target_type: MemoryQualityTargetType;
  target_id: string;
  action: MemoryCurationAction;
  from_state: MemoryCurationState | null;
  to_state: MemoryCurationState;
  actor: string | null;
  note: string | null;
  idempotency_key: string;
  metadata_json: string;
  created_at: string;
}): MemoryCurationActionRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    targetType: row.target_type,
    targetId: row.target_id,
    action: row.action,
    fromState: row.from_state,
    toState: row.to_state,
    actor: row.actor,
    note: row.note,
    idempotencyKey: row.idempotency_key,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
  };
}

export function recordMemoryQualitySignal(companyIdOrSlug: string, input: {
  targetType: MemoryQualityTargetType;
  targetId: string;
  queue: MemoryQualitySignalQueue;
  qualityScore: number;
  severity?: MemoryQualitySeverity;
  confidence?: number | null;
  reason?: string;
  evidence?: Record<string, unknown>;
  scoringContract: string;
  sourceFingerprint: string;
  computedAt?: string;
}): MemoryQualitySignal {
  const companyId = resolveCompanyId(companyIdOrSlug);
  const targetType = assertTargetType(input.targetType);
  const targetId = input.targetId.trim();
  if (!targetId) throw new OrchestrationApiError(400, "missing_target_id", "targetId is required");
  assertTargetBelongsToCompany(companyId, targetType, targetId);
  const queue = assertSignalQueue(input.queue);
  const scoringContract = input.scoringContract.trim();
  const sourceFingerprint = input.sourceFingerprint.trim();
  if (!scoringContract) throw new OrchestrationApiError(400, "missing_scoring_contract", "scoringContract is required");
  if (!sourceFingerprint) throw new OrchestrationApiError(400, "missing_source_fingerprint", "sourceFingerprint is required");

  const now = new Date().toISOString();
  const id = stableId([companyId, targetType, targetId, queue, scoringContract]);
  getOrchestrationDb().prepare(`
    INSERT INTO memory_quality_signals (
      id, company_id, target_type, target_id, queue, severity, quality_score,
      confidence, reason, evidence_json, scoring_contract, source_fingerprint,
      computed_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, target_type, target_id, queue, scoring_contract) DO UPDATE SET
      severity = excluded.severity,
      quality_score = excluded.quality_score,
      confidence = excluded.confidence,
      reason = excluded.reason,
      evidence_json = excluded.evidence_json,
      source_fingerprint = excluded.source_fingerprint,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at
  `).run(
    id,
    companyId,
    targetType,
    targetId,
    queue,
    input.severity ?? severityForScore(input.qualityScore),
    assertScore(input.qualityScore),
    assertConfidence(input.confidence),
    input.reason?.trim() || defaultReason(queue),
    JSON.stringify(input.evidence ?? {}),
    scoringContract,
    sourceFingerprint,
    input.computedAt ?? now,
    now,
    now,
  );

  const row = getOrchestrationDb().prepare("SELECT * FROM memory_quality_signals WHERE id = ?").get(id) as Parameters<typeof mapSignal>[0];
  return mapSignal(row);
}

function latestSignalRows(companyId: string, filters: {
  targetType?: MemoryQualityTargetType;
  state?: MemoryCurationState | "all";
} = {}): Array<Parameters<typeof mapSignal>[0] & { curation_state: MemoryCurationState }> {
  const where = ["latest.company_id = ?"];
  const params: unknown[] = [companyId];
  if (filters.targetType) {
    where.push("latest.target_type = ?");
    params.push(assertTargetType(filters.targetType));
  }
  if (filters.state && filters.state !== "all") {
    where.push("COALESCE(mcs.state, 'open') = ?");
    params.push(filters.state);
  }
  return getOrchestrationDb().prepare(`
    WITH latest AS (
      SELECT mqs.*
      FROM memory_quality_signals mqs
      WHERE NOT EXISTS (
        SELECT 1
        FROM memory_quality_signals newer
        WHERE newer.company_id = mqs.company_id
          AND newer.target_type = mqs.target_type
          AND newer.target_id = mqs.target_id
          AND newer.queue = mqs.queue
          AND (
            newer.computed_at > mqs.computed_at
            OR (newer.computed_at = mqs.computed_at AND newer.updated_at > mqs.updated_at)
            OR (newer.computed_at = mqs.computed_at AND newer.updated_at = mqs.updated_at AND newer.id > mqs.id)
          )
      )
    )
    SELECT latest.*, COALESCE(mcs.state, 'open') AS curation_state
    FROM latest
    LEFT JOIN memory_curation_states mcs
      ON mcs.company_id = latest.company_id
     AND mcs.target_type = latest.target_type
     AND mcs.target_id = latest.target_id
    WHERE ${where.join(" AND ")}
    ORDER BY latest.quality_score ASC, latest.updated_at DESC
  `).all(...params) as Array<Parameters<typeof mapSignal>[0] & { curation_state: MemoryCurationState }>;
}

function aggregateSignals(signals: MemoryQualitySignal[], curationState: MemoryCurationState): {
  score: MemoryQualityScore & { curationState: MemoryCurationState };
  severity: MemoryQualitySeverity;
  queues: MemoryQualitySignalQueue[];
  reasons: string[];
} {
  const sorted = [...signals].sort((a, b) => a.qualityScore - b.qualityScore || a.queue.localeCompare(b.queue));
  const first = sorted[0];
  const queues = sorted.map((signal) => signal.queue);
  const score = {
    id: stableId([first.companyId, first.targetType, first.targetId, first.scoringContract]),
    companyId: first.companyId,
    targetType: first.targetType,
    targetId: first.targetId,
    qualityScore: first.qualityScore,
    issueCount: signals.length,
    recomputationKey: first.scoringContract,
    sourceFingerprint: first.sourceFingerprint,
    computedAt: sorted.reduce((max, signal) => signal.computedAt > max ? signal.computedAt : max, first.computedAt),
    createdAt: sorted.reduce((min, signal) => signal.createdAt < min ? signal.createdAt : min, first.createdAt),
    updatedAt: sorted.reduce((max, signal) => signal.updatedAt > max ? signal.updatedAt : max, first.updatedAt),
    curationState,
  };
  return {
    score,
    severity: sorted.some((signal) => signal.severity === "critical") ? "critical" : severityForScore(first.qualityScore),
    queues,
    reasons: sorted.map((signal) => signal.reason).filter(Boolean),
  };
}

function groupedSignalItems(companyId: string, filters: {
  targetType?: MemoryQualityTargetType;
  state?: MemoryCurationState | "all";
} = {}): Array<ReturnType<typeof aggregateSignals> & { signalDetails: MemoryQualitySignal[] }> {
  const rows = latestSignalRows(companyId, filters);
  const grouped = new Map<string, { curationState: MemoryCurationState; signals: MemoryQualitySignal[] }>();
  for (const row of rows) {
    const signal = mapSignal(row);
    const key = `${signal.targetType}\u001f${signal.targetId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.signals.push(signal);
    } else {
      grouped.set(key, { curationState: row.curation_state, signals: [signal] });
    }
  }
  return [...grouped.values()]
    .map(({ curationState, signals }) => ({ ...aggregateSignals(signals, curationState), signalDetails: signals }))
    .sort((a, b) => a.score.qualityScore - b.score.qualityScore || b.score.updatedAt.localeCompare(a.score.updatedAt));
}

export function listMemoryQualityScores(companyIdOrSlug: string, filters: {
  targetType?: MemoryQualityTargetType;
  state?: MemoryCurationState | "all";
  limit?: number;
} = {}): Array<MemoryQualityScore & { curationState: MemoryCurationState }> {
  const companyId = resolveCompanyId(companyIdOrSlug);
  return groupedSignalItems(companyId, filters).slice(0, filters.limit ?? 200).map((item) => item.score);
}

export function listMemoryQualityQueue(companyIdOrSlug: string, filters: {
  queue?: MemoryQualityQueueType;
  state?: MemoryCurationState | "all";
  targetType?: MemoryQualityTargetType;
  limit?: number | string;
} = {}): { company: { id: string; slug: string; name: string }; queue: MemoryQualityQueueType; items: MemoryQualityQueueItem[] } {
  const company = resolveCompany(companyIdOrSlug);
  const queue = assertQueue(filters.queue ?? "all");
  const state = assertCurationStateFilter(filters.state);
  const limit = assertLimit(filters.limit);
  const items = groupedSignalItems(company.id, { targetType: filters.targetType, state })
    .filter((item) => queue === "all" || item.queues.includes(queue as MemoryQualitySignalQueue))
    .slice(0, limit)
    .map((item) => ({
      ...item.score,
      target: loadTargetSummary(item.score.companyId, item.score.targetType, item.score.targetId),
      queues: item.queues,
      severity: item.severity,
      reasons: item.reasons.length > 0 ? item.reasons : ["Quality signal requires review"],
      signalDetails: item.signalDetails.sort((a, b) => a.queue.localeCompare(b.queue)),
    }));
  return { company, queue, items };
}

export function getMemoryQualityIssueDetail(
  companyIdOrSlug: string,
  targetType: MemoryQualityTargetType,
  targetId: string,
): { company: { id: string; slug: string; name: string }; issue: MemoryQualityQueueItem; actions: MemoryCurationActionRecord[] } {
  const company = resolveCompany(companyIdOrSlug);
  const type = assertTargetType(targetType);
  const found = listMemoryQualityQueue(company.id, { queue: "all", state: "all", targetType: type, limit: 500 })
    .items.find((item) => item.targetId === targetId);
  if (!found) throw new OrchestrationApiError(404, "memory_quality_issue_not_found", "Memory quality issue not found");
  return { company, issue: found, actions: listMemoryCurationActions(company.id, type, targetId) };
}

export function getMemoryQualityDashboard(companyIdOrSlug: string): MemoryQualityDashboard {
  const company = resolveCompany(companyIdOrSlug);
  const allItems = listMemoryQualityQueue(company.id, { queue: "all", state: "all", limit: 500 }).items;
  const queues = Object.fromEntries(QUEUES.map((queue) => {
    const queueItems = allItems.filter((item) => item.queues.includes(queue));
    return [queue, {
      count: queueItems.length,
      worstScore: queueItems.length > 0 ? Math.min(...queueItems.map((item) => item.qualityScore)) : null,
    }];
  })) as MemoryQualityDashboard["queues"];
  const scores = allItems.map((item) => item.qualityScore);
  const recentRow = getOrchestrationDb().prepare(`
    SELECT *
    FROM memory_quality_recomputations
    WHERE company_id = ?
    ORDER BY updated_at DESC, started_at DESC
    LIMIT 1
  `).get(company.id) as Parameters<typeof mapRecomputation>[0] | undefined;
  return {
    company,
    kpis: {
      totalScored: allItems.length,
      openIssues: allItems.filter((item) => item.curationState === "open" && item.queues.length > 0).length,
      reviewedIssues: allItems.filter((item) => item.curationState === "reviewed").length,
      acknowledgedIssues: allItems.filter((item) => item.curationState === "acknowledged").length,
      resolvedIssues: allItems.filter((item) => item.curationState === "resolved").length,
      dismissedIssues: allItems.filter((item) => item.curationState === "dismissed").length,
      supersededIssues: allItems.filter((item) => item.curationState === "superseded").length,
      archivedIssues: allItems.filter((item) => item.curationState === "archived").length,
      rewriteRequestedIssues: allItems.filter((item) => item.curationState === "rewrite_requested").length,
      mergeCandidateIssues: allItems.filter((item) => item.curationState === "merge_candidate").length,
      averageQualityScore: scores.length > 0 ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : null,
      criticalIssues: allItems.filter((item) => item.severity === "critical").length,
    },
    queues,
    recentRecomputation: recentRow ? mapRecomputation(recentRow) : null,
  };
}

export function recordMemoryQualityRecomputation(companyIdOrSlug: string, input: {
  recomputationKey: string;
  inputHash: string;
  status?: MemoryQualityRecomputationStatus;
  scoresWritten?: number;
  error?: string | null;
  targetType?: MemoryQualityTargetType | null;
  targetId?: string | null;
  startedAt?: string;
  completedAt?: string | null;
}): MemoryQualityRecomputation {
  const companyId = resolveCompanyId(companyIdOrSlug);
  const targetType = input.targetType ? assertTargetType(input.targetType) : null;
  const targetId = input.targetId?.trim() || null;
  const scope = targetType && targetId ? "target" : "company";
  if (targetType && targetId) assertTargetBelongsToCompany(companyId, targetType, targetId);
  const recomputationKey = input.recomputationKey.trim();
  const inputHash = input.inputHash.trim();
  if (!recomputationKey) throw new OrchestrationApiError(400, "missing_recomputation_key", "recomputationKey is required");
  if (!inputHash) throw new OrchestrationApiError(400, "missing_input_hash", "inputHash is required");

  const status = input.status ?? "completed";
  const now = new Date().toISOString();
  const id = stableId([companyId, scope, targetType ?? "", targetId ?? "", recomputationKey, inputHash]);
  getOrchestrationDb().prepare(`
    INSERT INTO memory_quality_recomputations (
      id, company_id, scope, target_type, target_id, recomputation_key, input_hash,
      status, scores_written, error, started_at, completed_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      scores_written = excluded.scores_written,
      error = excluded.error,
      completed_at = excluded.completed_at,
      updated_at = excluded.updated_at
  `).run(
    id,
    companyId,
    scope,
    targetType,
    targetId,
    recomputationKey,
    inputHash,
    status,
    input.scoresWritten ?? 0,
    input.error ?? null,
    input.startedAt ?? now,
    input.completedAt === undefined ? (status === "completed" || status === "failed" || status === "skipped" ? now : null) : input.completedAt,
    now,
    now,
  );
  const row = getOrchestrationDb().prepare("SELECT * FROM memory_quality_recomputations WHERE id = ?").get(id) as Parameters<typeof mapRecomputation>[0];
  return mapRecomputation(row);
}

function loadTargetSummary(companyId: string, targetType: MemoryQualityTargetType, targetId: string): MemoryQualityTargetSummary {
  const db = getOrchestrationDb();
  if (targetType === "source_index") {
    const row = db.prepare(`
      SELECT record_id, source_path, layer, title, content_excerpt, status,
             COALESCE(updated_at, file_mtime, indexed_at) AS updated_at,
             tags_json, linked_ids_json
      FROM memory_source_index
      WHERE company_id = ? AND record_id = ?
      LIMIT 1
    `).get(companyId, targetId) as {
      record_id: string;
      source_path: string;
      layer: string | null;
      title: string | null;
      content_excerpt: string | null;
      status: string | null;
      updated_at: string | null;
      tags_json: string | null;
      linked_ids_json: string | null;
    } | undefined;
    if (!row) {
      return {
        id: targetId,
        type: targetType,
        title: `Missing Source: ${targetId.slice(0, 8)}`,
        excerpt: "This source index record is missing from the database.",
        sourcePath: null,
        layer: null,
        status: "missing",
        source: null,
        confidence: null,
        tags: [],
        linkedIds: [],
        updatedAt: null,
      };
    }
    return {
      id: row.record_id,
      type: targetType,
      title: row.title || row.record_id,
      excerpt: row.content_excerpt || "",
      sourcePath: row.source_path,
      layer: row.layer,
      status: row.status,
      source: null,
      confidence: null,
      tags: parseJsonStringArray(row.tags_json),
      linkedIds: parseJsonStringArray(row.linked_ids_json),
      updatedAt: row.updated_at,
    };
  }

  const row = db.prepare(`
    SELECT id, title, body, status, source, confidence, scope, updated_at, metadata_json
    FROM company_memory_records
    WHERE company_id = ? AND id = ?
    LIMIT 1
  `).get(companyId, targetId) as {
    id: string;
    title: string;
    body: string;
    status: string;
    source: string;
    confidence: number;
    scope: string;
    updated_at: string;
    metadata_json: string;
  } | undefined;
  if (!row) {
    return {
      id: targetId,
      type: targetType,
      title: `Missing Record: ${targetId.slice(0, 8)}`,
      excerpt: "This memory record is missing from the database.",
      sourcePath: null,
      layer: null,
      status: "missing",
      source: null,
      confidence: null,
      tags: [],
      linkedIds: [],
      updatedAt: null,
    };
  }
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: row.id,
    type: targetType,
    title: row.title || row.id,
    excerpt: row.body.slice(0, 240),
    sourcePath: typeof metadata.sourcePath === "string" ? metadata.sourcePath : null,
    layer: row.scope,
    status: row.status,
    source: row.source,
    confidence: Number(row.confidence),
    tags: parseUnknownStringArray(metadata.tags),
    linkedIds: parseUnknownStringArray(metadata.linkedIds),
    updatedAt: row.updated_at,
  };
}

function getMemoryCurationStateOrNull(companyId: string, targetType: MemoryQualityTargetType, targetId: string): MemoryCurationStateRecord | null {
  const row = getOrchestrationDb().prepare(`
    SELECT *
    FROM memory_curation_states
    WHERE company_id = ? AND target_type = ? AND target_id = ?
    LIMIT 1
  `).get(companyId, targetType, targetId) as Parameters<typeof mapCurationState>[0] | undefined;
  return row ? mapCurationState(row) : null;
}

export function getMemoryCurationState(
  companyIdOrSlug: string,
  targetType: MemoryQualityTargetType,
  targetId: string,
): MemoryCurationStateRecord {
  const companyId = resolveCompanyId(companyIdOrSlug);
  const row = getMemoryCurationStateOrNull(companyId, assertTargetType(targetType), targetId);
  if (!row) throw new OrchestrationApiError(404, "curation_state_not_found", "Memory curation state not found");
  return row;
}

function nextStateForAction(current: MemoryCurationStateRecord | null, action: MemoryCurationAction): MemoryCurationState {
  if (action === "mark_reviewed") return "reviewed";
  if (action === "acknowledge") return "acknowledged";
  if (action === "resolve") return "resolved";
  if (action === "dismiss") return "dismissed";
  if (action === "archive") return "archived";
  if (action === "supersede") return "superseded";
  if (action === "request_rewrite") return "rewrite_requested";
  if (action === "suggest_merge") return "merge_candidate";
  if (action === "reopen") return "open";
  if (action === "restore") return current?.previousState ?? "open";
  return current?.state ?? "open";
}

export function applyMemoryCurationAction(companyIdOrSlug: string, input: {
  targetType: MemoryQualityTargetType;
  targetId: string;
  action: MemoryCurationAction;
  actor?: string | null;
  note?: string | null;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): { state: MemoryCurationStateRecord; action: MemoryCurationActionRecord; idempotent: boolean } {
  const companyId = resolveCompanyId(companyIdOrSlug);
  const targetType = assertTargetType(input.targetType);
  const targetId = input.targetId.trim();
  if (!targetId) throw new OrchestrationApiError(400, "missing_target_id", "targetId is required");
  assertTargetBelongsToCompany(companyId, targetType, targetId);
  const action = input.action;
  if (!(ACTIONS as readonly string[]).includes(action)) {
    throw new OrchestrationApiError(400, "invalid_curation_action", "Unsupported memory curation action");
  }
  const idempotencyKey = input.idempotencyKey?.trim() || stableId([
    companyId,
    targetType,
    targetId,
    action,
    input.actor ?? "",
    input.note ?? "",
    JSON.stringify(input.metadata ?? {}),
  ]);

  const db = getOrchestrationDb();
  const existingAction = db.prepare(`
    SELECT *
    FROM memory_curation_actions
    WHERE company_id = ? AND target_type = ? AND target_id = ? AND idempotency_key = ?
    LIMIT 1
  `).get(companyId, targetType, targetId, idempotencyKey) as Parameters<typeof mapCurationAction>[0] | undefined;
  if (existingAction) {
    return {
      state: getMemoryCurationState(companyId, targetType, targetId),
      action: mapCurationAction(existingAction),
      idempotent: true,
    };
  }

  const apply = db.transaction(() => {
    const current = getMemoryCurationStateOrNull(companyId, targetType, targetId);
    const fromState = current?.state ?? "open";
    const nextState = nextStateForAction(current, action);
    const now = new Date().toISOString();
    const stateId = current?.id ?? randomUUID();
    db.prepare(`
      INSERT INTO memory_curation_states (
        id, company_id, target_type, target_id, state, previous_state,
        acknowledged_at, resolved_at, dismissed_at, superseded_at, archived_at,
        actor, note, metadata_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id, target_type, target_id) DO UPDATE SET
        state = excluded.state,
        previous_state = excluded.previous_state,
        acknowledged_at = excluded.acknowledged_at,
        resolved_at = excluded.resolved_at,
        dismissed_at = excluded.dismissed_at,
        superseded_at = excluded.superseded_at,
        archived_at = excluded.archived_at,
        actor = excluded.actor,
        note = excluded.note,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at
    `).run(
      stateId,
      companyId,
      targetType,
      targetId,
      nextState,
      fromState,
      (nextState === "reviewed" || nextState === "acknowledged") ? now : current?.acknowledgedAt ?? null,
      nextState === "resolved" ? now : current?.resolvedAt ?? null,
      nextState === "dismissed" ? now : current?.dismissedAt ?? null,
      nextState === "superseded" ? now : current?.supersededAt ?? null,
      nextState === "archived" ? now : current?.archivedAt ?? null,
      input.actor?.trim() || null,
      input.note?.trim() || null,
      JSON.stringify(input.metadata ?? {}),
      now,
      now,
    );

    const actionId = randomUUID();
    db.prepare(`
      INSERT INTO memory_curation_actions (
        id, company_id, target_type, target_id, action, from_state, to_state,
        actor, note, idempotency_key, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actionId,
      companyId,
      targetType,
      targetId,
      action,
      fromState,
      nextState,
      input.actor?.trim() || null,
      input.note?.trim() || null,
      idempotencyKey,
      JSON.stringify(input.metadata ?? {}),
      now,
    );

    return {
      state: getMemoryCurationState(companyId, targetType, targetId),
      action: mapCurationAction(db.prepare("SELECT * FROM memory_curation_actions WHERE id = ?").get(actionId) as Parameters<typeof mapCurationAction>[0]),
      idempotent: false,
    };
  });

  return apply();
}

export function listMemoryCurationActions(
  companyIdOrSlug: string,
  targetType: MemoryQualityTargetType,
  targetId: string,
): MemoryCurationActionRecord[] {
  const companyId = resolveCompanyId(companyIdOrSlug);
  const rows = getOrchestrationDb().prepare(`
    SELECT *
    FROM memory_curation_actions
    WHERE company_id = ? AND target_type = ? AND target_id = ?
    ORDER BY created_at ASC, rowid ASC
  `).all(companyId, assertTargetType(targetType), targetId) as Array<Parameters<typeof mapCurationAction>[0]>;
  return rows.map(mapCurationAction);
}

function defaultReason(queue: MemoryQualitySignalQueue): string {
  if (queue === "duplicates") return "Potential duplicate memory content";
  if (queue === "stale") return "Record may be stale";
  if (queue === "weak_provenance") return "Record has weak or missing provenance";
  if (queue === "broken_links") return "Record has broken or unresolved links";
  return "Record has low confidence";
}
