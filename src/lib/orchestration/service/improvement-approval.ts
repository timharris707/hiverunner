import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-resolver";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { buildCanonicalImprovePath } from "@/lib/orchestration/route-paths";
import { createApproval } from "@/lib/orchestration/service/approval";
import { recordImproveActivity } from "@/lib/orchestration/service/improvement-provenance";
import type {
  OrchestrationImprovementConfidence as ImprovementRecommendationConfidence,
  OrchestrationImprovementRecommendationStatus as ImprovementRecommendationStatus,
  OrchestrationImprovementScopeType,
  OrchestrationImprovementSeverity as ImprovementRecommendationSeverity,
  OrchestrationImprovementTriggerKey,
  ImprovementRecommendationSourceType,
  OrchestrationApproval,
  OrchestrationImprovementApprovalLink,
  OrchestrationImprovementRecommendation,
} from "@/lib/orchestration/types";

type RecommendationRow = {
  id: string;
  company_id: string;
  trigger_key: OrchestrationImprovementTriggerKey;
  scope_type: OrchestrationImprovementScopeType;
  scope_key: string;
  title: string;
  rationale: string;
  proposed_change: string;
  severity: ImprovementRecommendationSeverity;
  confidence: ImprovementRecommendationConfidence;
  status: ImprovementRecommendationStatus;
  evidence_json: string;
  original_recommendation_json: string;
  current_recommendation_json: string;
  dismissal_reason: string | null;
  dismissal_notes: string | null;
  dismissed_at: string | null;
  suppression_id: string | null;
  superseded_by_recommendation_id: string | null;
  approval_id: string | null;
  idempotency_key: string | null;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalLinkRow = {
  id: string;
  company_id: string;
  recommendation_id: string;
  approval_id: string | null;
  status: OrchestrationImprovementApprovalLink["status"];
  approval_package_json: string;
  rollback_notes: string;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type ResolvedCompany = {
  id: string;
  slug: string;
  companyCode: string;
};

type ApprovalPackageRecommendation = {
  id: string;
  title: string;
  status: ImprovementRecommendationStatus;
  triggerKey: string;
  scopeType: string;
  scopeKey: string;
  severity: string;
  confidence: string;
  rationale: string;
  proposedChange: string;
  evidence: unknown[];
  improveBackLink: string;
};

const EVIDENCE_REDACTION_POLICY = "hiverunner.improve.redacted_evidence.v1";
const CREDENTIAL_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function redactText(value: string): string {
  return CREDENTIAL_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}

function stringField(record: Record<string, unknown>, keys: string[], maxLength = 1000): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = nonEmpty(value);
    if (trimmed) return redactText(trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed);
  }
  return null;
}

function sanitizedEvidenceItem(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    const summary = nonEmpty(String(item ?? ""));
    return summary ? { summary: redactText(summary), redactionPolicy: EVIDENCE_REDACTION_POLICY } : null;
  }

  const record = item as Record<string, unknown>;
  const evidence: Record<string, unknown> = {
    redactionPolicy: EVIDENCE_REDACTION_POLICY,
  };
  const id = stringField(record, ["id", "evidenceId"], 160);
  const sourceType = stringField(record, ["sourceType", "source", "kind"], 120);
  const sourceId = stringField(record, ["sourceId", "runId", "taskId", "evalCaseId", "approvalId"], 160);
  const title = stringField(record, ["title", "sourceLabel", "label"], 240);
  const summary = stringField(record, ["summary", "redactedSummary", "body"], 2000);
  const occurredAt = stringField(record, ["occurredAt", "createdAt", "timestamp"], 80);
  const missingReason = stringField(record, ["missingReason"], 500);

  if (id) evidence.id = id;
  if (sourceType) evidence.sourceType = sourceType;
  if (sourceId) evidence.sourceId = sourceId;
  if (title) evidence.title = title;
  if (summary) evidence.summary = summary;
  if (occurredAt) evidence.occurredAt = occurredAt;
  if (missingReason) evidence.missingReason = missingReason;

  for (const key of ["taskId", "taskKey", "runId", "evalCaseId"] as const) {
    const value = stringField(record, [key], 160);
    if (value) evidence[key] = value;
  }

  return Object.keys(evidence).length > 1 ? evidence : null;
}

function sanitizedEvidenceItems(items: unknown[]): Record<string, unknown>[] {
  return items
    .map(sanitizedEvidenceItem)
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizeEvidenceSourceType(value: unknown): ImprovementRecommendationSourceType {
  if (
    value === "trace"
    || value === "eval"
    || value === "template"
    || value === "team"
    || value === "task"
    || value === "sprint"
    || value === "goal"
    || value === "review"
    || value === "manual"
  ) {
    return value;
  }
  return "manual";
}

function recommendationEvidenceFromRow(row: RecommendationRow): OrchestrationImprovementRecommendation["evidence"] {
  const summaries = sanitizedEvidenceItems(parseJsonArray(row.evidence_json)).map((item) => {
    const sourceType = normalizeEvidenceSourceType(item.sourceType);
    return {
      id: stringField(item, ["id", "evidenceId"], 160) ?? randomUUID(),
      sourceType,
      sourceId: stringField(item, ["sourceId", "runId", "taskId", "evalCaseId"], 160),
      title: stringField(item, ["title", "sourceLabel", "label"], 240) ?? "Evidence",
      summary: stringField(item, ["summary", "redactedSummary", "body"], 2000) ?? "",
      occurredAt: stringField(item, ["occurredAt", "createdAt", "timestamp"], 80),
      missingReason: stringField(item, ["missingReason"], 500),
      redactionPolicy: EVIDENCE_REDACTION_POLICY,
      links: [],
      metadata: {},
    };
  });

  return {
    state: summaries.some((item) => !item.missingReason) ? "present" : "missing",
    summaries,
  };
}

function confidenceScore(confidence: ImprovementRecommendationConfidence): number {
  if (confidence === "high") return 0.85;
  if (confidence === "low") return 0.25;
  return 0.5;
}

function resolveCompany(db: Database.Database, companyIdOrSlug: string): ResolvedCompany {
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return {
    id: company.id,
    slug: company.slug,
    companyCode: company.company_code?.trim() || company.slug,
  };
}

function recommendationFromRow(row: RecommendationRow): OrchestrationImprovementRecommendation {
  return {
    id: row.id,
    companyId: row.company_id,
    triggerKey: row.trigger_key,
    scope: {
      type: row.scope_type,
      key: row.scope_key,
    },
    title: row.title,
    rationale: row.rationale,
    proposedChange: row.proposed_change,
    severity: row.severity,
    confidence: row.confidence,
    status: row.status,
    evidence: recommendationEvidenceFromRow(row),
    originalRecommendation: parseJsonObject(row.original_recommendation_json),
    currentRecommendation: parseJsonObject(row.current_recommendation_json),
    dismissalReason: row.dismissal_reason as OrchestrationImprovementRecommendation["dismissalReason"],
    dismissalNotes: row.dismissal_notes,
    dismissedAt: row.dismissed_at,
    suppressionId: row.suppression_id,
    supersededByRecommendationId: row.superseded_by_recommendation_id,
    approvalId: row.approval_id,
    idempotencyKey: row.idempotency_key,
    createdByAgentId: row.created_by_agent_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function approvalLinkFromRow(row: ApprovalLinkRow): OrchestrationImprovementApprovalLink {
  const approvalPackage = parseJsonObject(row.approval_package_json);
  const riskNotes = typeof approvalPackage.riskNotes === "string" ? approvalPackage.riskNotes : null;
  return {
    id: row.id,
    companyId: row.company_id,
    recommendationId: row.recommendation_id,
    approvalId: row.approval_id,
    status: row.status,
    approvalPackage,
    riskNotes,
    rollbackNotes: row.rollback_notes,
    createdByAgentId: row.created_by_agent_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRecommendationRow(
  db: Database.Database,
  companyId: string,
  recommendationId: string,
): RecommendationRow | null {
  const row = db
    .prepare(
      `SELECT *
       FROM improvement_recommendations
       WHERE id = ?
         AND company_id = ?
       LIMIT 1`,
    )
    .get(recommendationId, companyId) as RecommendationRow | undefined;
  return row ?? null;
}

function getRecommendationRows(
  db: Database.Database,
  companyId: string,
  recommendationIds: readonly string[],
): RecommendationRow[] {
  if (recommendationIds.length === 0) {
    throw new OrchestrationApiError(400, "recommendation_required", "At least one recommendation is required");
  }
  const uniqueIds = [...new Set(recommendationIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new OrchestrationApiError(400, "recommendation_required", "At least one recommendation is required");
  }

  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT *
       FROM improvement_recommendations
       WHERE company_id = ?
         AND id IN (${placeholders})
       ORDER BY created_at ASC, id ASC`,
    )
    .all(companyId, ...uniqueIds) as RecommendationRow[];

  if (rows.length !== uniqueIds.length) {
    throw new OrchestrationApiError(404, "recommendation_not_found", "One or more recommendations were not found");
  }
  return rows;
}

function resolveProjectForActivity(db: Database.Database, row: RecommendationRow): string | null {
  if (row.scope_type === "project") {
    const project = db
      .prepare("SELECT id FROM projects WHERE id = ? AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(row.scope_key, row.company_id) as { id: string } | undefined;
    if (project) return project.id;
  }

  if (row.scope_type === "agent") {
    const agent = db
      .prepare("SELECT project_id FROM agents WHERE id = ? AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(row.scope_key, row.company_id) as { project_id: string } | undefined;
    if (agent?.project_id) return agent.project_id;
  }

  const fallback = db
    .prepare(
      `SELECT id
       FROM projects
       WHERE company_id = ?
         AND archived_at IS NULL
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(row.company_id) as { id: string } | undefined;
  return fallback?.id ?? null;
}

function riskNotesForPackage(inputRiskNotes: string | undefined, rows: RecommendationRow[]): string {
  const explicit = nonEmpty(inputRiskNotes);
  if (explicit) return explicit;

  for (const row of rows) {
    const current = parseJsonObject(row.current_recommendation_json);
    const riskNotes = typeof current.riskNotes === "string" ? nonEmpty(current.riskNotes) : null;
    if (riskNotes) return riskNotes;
  }

  return "No elevated risk identified by Improve; approval owner should confirm scope before any durable mutation.";
}

function rollbackNotesForPackage(inputRollbackNotes: string | undefined, rows: RecommendationRow[]): string {
  const explicit = nonEmpty(inputRollbackNotes);
  if (explicit) return explicit;

  const candidates = rows
    .map((row) => parseJsonObject(row.current_recommendation_json))
    .map((current) => typeof current.rollbackNotes === "string" ? nonEmpty(current.rollbackNotes) : null)
    .filter((value): value is string => Boolean(value));
  return [...new Set(candidates)].join("\n\n");
}

function previewForPackage(inputPreview: Record<string, unknown> | undefined, rows: RecommendationRow[]): Record<string, unknown> | null {
  if (inputPreview && Object.keys(inputPreview).length > 0) return inputPreview;

  const previews = rows
    .map((row) => parseJsonObject(row.current_recommendation_json).preview)
    .filter((preview) => typeof preview === "object" && preview !== null && !Array.isArray(preview)) as Record<string, unknown>[];
  if (previews.length === 0) return null;
  return previews.length === 1 ? previews[0]! : { groupedPreviews: previews };
}

function rowEvidenceItems(rows: RecommendationRow[]): unknown[] {
  return rows.flatMap((row) => parseJsonArray(row.evidence_json));
}

function isPresentEvidenceItem(item: unknown): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return Boolean(nonEmpty(String(item ?? "")));
  const record = item as Record<string, unknown>;
  const missingReason = stringField(record, ["missingReason"], 500);
  if (missingReason) return false;
  return Boolean(
    stringField(record, ["id", "evidenceId", "sourceId", "runId", "taskId", "evalCaseId", "summary", "redactedSummary", "body", "title"]),
  );
}

function buildApprovalPackage(input: {
  company: ResolvedCompany;
  packageId: string;
  rows: RecommendationRow[];
  title?: string;
  proposedChangeSummary?: string;
  rationale?: string;
  riskNotes: string;
  rollbackNotes: string;
  preview: Record<string, unknown> | null;
}): {
  package: Record<string, unknown>;
  evidence: unknown[];
  recommendations: ApprovalPackageRecommendation[];
} {
  const improveBasePath = buildCanonicalImprovePath(input.company.companyCode);
  const recommendations = input.rows.map((row) => {
    const evidence = sanitizedEvidenceItems(parseJsonArray(row.evidence_json));
    const improveBackLink = `${improveBasePath}?recommendation=${encodeURIComponent(row.id)}`;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      triggerKey: row.trigger_key,
      scopeType: row.scope_type,
      scopeKey: row.scope_key,
      severity: row.severity,
      confidence: row.confidence,
      rationale: row.rationale,
      proposedChange: row.proposed_change,
      evidence,
      improveBackLink,
    };
  });
  const evidence = recommendations.flatMap((recommendation) => recommendation.evidence);
  const proposedChangeSummary = nonEmpty(input.proposedChangeSummary)
    ?? recommendations.map((recommendation) => recommendation.proposedChange).filter(Boolean).join("\n\n");
  const rationale = nonEmpty(input.rationale)
    ?? recommendations.map((recommendation) => recommendation.rationale).filter(Boolean).join("\n\n");

  return {
    evidence,
    recommendations,
    package: {
      schema: "hiverunner.improvement_approval_package.v1",
      source: "improve",
      packageId: input.packageId,
      title: nonEmpty(input.title) ?? (recommendations.length === 1 ? recommendations[0]!.title : `${recommendations.length} Improve recommendations`),
      recommendationIds: recommendations.map((recommendation) => recommendation.id),
      recommendations,
      evidence,
      proposedChangeSummary,
      rationale,
      preview: input.preview,
      riskNotes: input.riskNotes,
      rollbackNotes: input.rollbackNotes,
      improveBackLinks: recommendations.map((recommendation) => ({
        recommendationId: recommendation.id,
        href: recommendation.improveBackLink,
        label: recommendation.title,
      })),
      governance: {
        approvalType: "approve_ceo_strategy",
        durableStateMutated: false,
        rule: "Improve prepares the change package; existing Approvals governs permission before mutation.",
      },
    },
  };
}

export function createImprovementApprovalBridgeRecommendation(input: {
  companyIdOrSlug: string;
  triggerKey: OrchestrationImprovementTriggerKey;
  scopeType: OrchestrationImprovementScopeType;
  scopeKey: string;
  title: string;
  rationale?: string;
  proposedChange?: string;
  severity?: ImprovementRecommendationSeverity;
  confidence?: ImprovementRecommendationConfidence;
  status?: ImprovementRecommendationStatus;
  evidence?: unknown[];
  originalRecommendation?: Record<string, unknown>;
  currentRecommendation?: Record<string, unknown>;
  createdByAgentId?: string;
  createdByUserId?: string;
  idempotencyKey?: string;
  db?: Database.Database;
}): { recommendation: OrchestrationImprovementRecommendation } {
  const db = input.db ?? getOrchestrationDb();
  const company = resolveCompany(db, input.companyIdOrSlug);
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO improvement_recommendations (
       id, company_id, trigger_key, scope_type, scope_key, title, rationale,
       proposed_change, severity, confidence, status, evidence_json,
       original_recommendation_json, current_recommendation_json,
       idempotency_key, created_by_agent_id, created_by_user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    company.id,
    input.triggerKey,
    input.scopeType,
    input.scopeKey,
    input.title,
    input.rationale ?? "",
    input.proposedChange ?? "",
    input.severity ?? "medium",
    input.confidence ?? "medium",
    input.status ?? "suggested",
    JSON.stringify(input.evidence ?? []),
    JSON.stringify(input.originalRecommendation ?? {}),
    JSON.stringify(input.currentRecommendation ?? {}),
    input.idempotencyKey ?? null,
    input.createdByAgentId ?? null,
    input.createdByUserId ?? null,
    now,
    now,
  );

  const row = getRecommendationRow(db, company.id, id);
  if (!row) throw new OrchestrationApiError(500, "recommendation_create_failed", "Recommendation was not created");
  const projectId = resolveProjectForActivity(db, row);
  if (projectId) {
    recordImproveActivity({
      companyId: company.id,
      companyCode: company.companyCode,
      eventType: "improve.recommendation_created",
      actorAgentId: input.createdByAgentId ?? null,
      actorUserId: input.createdByUserId ?? null,
      source: {
        recommendationId: id,
        recommendationStatus: row.status,
        recommendationType: row.trigger_key,
        severity: row.severity,
        confidence: confidenceScore(row.confidence),
        projectId,
        evidenceCount: parseJsonArray(row.evidence_json).length,
        summary: row.title,
      },
    }, db);
  }

  return { recommendation: recommendationFromRow(row) };
}

export function getImprovementApprovalBridgeRecommendation(input: {
  companyIdOrSlug: string;
  recommendationId: string;
  db?: Database.Database;
}): { recommendation: OrchestrationImprovementRecommendation } {
  const db = input.db ?? getOrchestrationDb();
  const company = resolveCompany(db, input.companyIdOrSlug);
  const row = getRecommendationRow(db, company.id, input.recommendationId);
  if (!row) throw new OrchestrationApiError(404, "recommendation_not_found", "Recommendation not found");
  return { recommendation: recommendationFromRow(row) };
}

export function listImprovementApprovalLinksForApproval(input: {
  approvalId: string;
  db?: Database.Database;
}): { links: OrchestrationImprovementApprovalLink[] } {
  const db = input.db ?? getOrchestrationDb();
  const rows = db
    .prepare(
      `SELECT *
       FROM improvement_recommendation_approval_links
       WHERE approval_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(input.approvalId) as ApprovalLinkRow[];
  return { links: rows.map(approvalLinkFromRow) };
}

export function acceptImprovementRecommendationsForApproval(input: {
  companyIdOrSlug: string;
  recommendationIds: string[];
  requestedByAgentId?: string;
  acceptedByUserId?: string;
  acceptanceNote?: string | null;
  title?: string;
  proposedChangeSummary?: string;
  rationale?: string;
  preview?: Record<string, unknown>;
  riskNotes?: string;
  rollbackNotes?: string;
  db?: Database.Database;
}): {
  approval: OrchestrationApproval;
  recommendations: OrchestrationImprovementRecommendation[];
  links: OrchestrationImprovementApprovalLink[];
} {
  const db = input.db ?? getOrchestrationDb();
  const company = resolveCompany(db, input.companyIdOrSlug);
  const rows = getRecommendationRows(db, company.id, input.recommendationIds);
  const blocked = rows.find((row) => ["dismissed", "superseded", "applied"].includes(row.status));
  if (blocked) {
    throw new OrchestrationApiError(
      400,
      "recommendation_not_acceptible",
      `Recommendation ${blocked.id} cannot be accepted from status ${blocked.status}`,
    );
  }

  const evidence = rowEvidenceItems(rows);
  if (!evidence.some(isPresentEvidenceItem)) {
    throw new OrchestrationApiError(
      400,
      "evidence_required",
      "Improvement approval packages require at least one evidence item",
    );
  }

  const rollbackNotes = rollbackNotesForPackage(input.rollbackNotes, rows);
  if (!rollbackNotes) {
    throw new OrchestrationApiError(
      400,
      "rollback_notes_required",
      "Improvement approval packages require rollback or correction notes",
    );
  }

  const riskNotes = riskNotesForPackage(input.riskNotes, rows);
  const preview = previewForPackage(input.preview, rows);
  const packageId = randomUUID();
  const approvalPackage = buildApprovalPackage({
    company,
    packageId,
    rows,
    title: input.title,
    proposedChangeSummary: input.proposedChangeSummary,
    rationale: input.rationale,
    riskNotes,
    rollbackNotes,
    preview,
  });
  const packageTitle = typeof approvalPackage.package.title === "string"
    ? approvalPackage.package.title
    : "Improve approval package";
  const proposedChangeSummary = typeof approvalPackage.package.proposedChangeSummary === "string"
    ? approvalPackage.package.proposedChangeSummary
    : null;
  const rationale = typeof approvalPackage.package.rationale === "string"
    ? approvalPackage.package.rationale
    : null;
  const improveBackLinks = Array.isArray(approvalPackage.package.improveBackLinks)
    ? approvalPackage.package.improveBackLinks
    : [];
  const recommendationIds = rows.map((row) => row.id);

  const now = new Date().toISOString();
  const result = db.transaction(() => {
    const approval = createApproval({
      companyIdOrSlug: company.id,
      type: "approve_ceo_strategy",
      requestedByAgentId: input.requestedByAgentId,
      payload: {
        source: "improve",
        title: packageTitle,
        summary: proposedChangeSummary ?? rationale ?? packageTitle,
        reason: "Accepted Improve recommendations require governed approval before durable mutation.",
        risks: [{ code: "improvement_governed_change" }],
        approvalPackage: approvalPackage.package,
        improvementRecommendationId: recommendationIds.length === 1 ? recommendationIds[0] : null,
        improvementRecommendationIds: recommendationIds,
        recommendationIds,
        improveBackLinks,
        evidence: approvalPackage.evidence,
        riskNotes,
        rollbackNotes,
      },
      db,
    }).approval;

    const insertLink = db.prepare(
      `INSERT INTO improvement_recommendation_approval_links (
         id, company_id, recommendation_id, approval_id, status,
         approval_package_json, rollback_notes, created_by_agent_id,
         created_by_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?)
       ON CONFLICT(recommendation_id, approval_id) DO UPDATE SET
         status = 'submitted',
         approval_package_json = excluded.approval_package_json,
         rollback_notes = excluded.rollback_notes,
         updated_at = excluded.updated_at`,
    );
    const updateRecommendation = db.prepare(
      `UPDATE improvement_recommendations
       SET status = 'accepted-for-approval',
           approval_id = ?,
           current_recommendation_json = ?,
           updated_at = ?
       WHERE id = ?`,
    );
    const links: OrchestrationImprovementApprovalLink[] = [];

    for (const row of rows) {
      const current = {
        ...parseJsonObject(row.current_recommendation_json),
        acceptedApprovalPackageId: packageId,
        approvalId: approval.id,
        rollbackNotes,
        riskNotes,
        acceptanceNote: nonEmpty(input.acceptanceNote),
        acceptedByAgentId: input.requestedByAgentId ?? null,
        acceptedByUserId: input.acceptedByUserId ?? null,
        acceptedAt: now,
      };
      updateRecommendation.run(approval.id, JSON.stringify(current), now, row.id);
      const linkId = randomUUID();
      insertLink.run(
        linkId,
        company.id,
        row.id,
        approval.id,
        JSON.stringify(approvalPackage.package),
        rollbackNotes,
        input.requestedByAgentId ?? null,
        input.acceptedByUserId ?? null,
        now,
        now,
      );
      const linkRow = db
        .prepare("SELECT * FROM improvement_recommendation_approval_links WHERE id = ?")
        .get(linkId) as ApprovalLinkRow;
      links.push(approvalLinkFromRow(linkRow));
    }

    for (const row of rows) {
      const projectId = resolveProjectForActivity(db, row);
      if (!projectId) continue;
      recordImproveActivity({
        companyId: company.id,
        companyCode: company.companyCode,
        eventType: "improve.approval_package_created",
        actorAgentId: input.requestedByAgentId ?? null,
        actorUserId: input.acceptedByUserId ?? null,
        source: {
          recommendationId: row.id,
          recommendationStatus: "accepted-for-approval",
          recommendationType: row.trigger_key,
          severity: row.severity,
          confidence: confidenceScore(row.confidence),
          projectId,
          approvalPackageId: packageId,
          approvalId: approval.id,
          approvalStatus: approval.status,
          evidenceCount: parseJsonArray(row.evidence_json).length,
          summary: row.title,
        },
      }, db);
    }

    const recommendations = rows.map((row) => {
      const updated = getRecommendationRow(db, company.id, row.id);
      if (!updated) throw new OrchestrationApiError(500, "recommendation_update_failed", "Recommendation update failed");
      return recommendationFromRow(updated);
    });

    return { approval, recommendations, links };
  })();

  return result;
}
