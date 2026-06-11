import { randomUUID } from "crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-resolver";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  buildCanonicalCompanyPath,
  buildCanonicalEvalCasePath,
  buildCanonicalEvalsPath,
  buildCanonicalGoalPath,
  buildCanonicalImprovePath,
  buildCanonicalRunTracePath,
  buildCanonicalTaskRunTracePath,
  buildCanonicalTeamPath,
} from "@/lib/orchestration/route-paths";
import {
  recordImproveActivity,
  type ImproveActivitySource,
  type ImproveActivityEventType,
} from "@/lib/orchestration/service/improvement-provenance";
import type {
  ApprovalStatus,
  ImprovementRecommendationConfidence,
  ImprovementRecommendationScopeType,
  ImprovementRecommendationSeverity,
  ImprovementRecommendationSourceType,
  ImprovementRecommendationStatus,
  OrchestrationImprovementCompanyControl,
  OrchestrationImprovementApprovalLink,
  OrchestrationImprovementDashboard,
  OrchestrationImprovementEvidenceSetRecord,
  OrchestrationImprovementEvidenceSet,
  OrchestrationImprovementEvidenceSummary,
  OrchestrationImprovementRecommendation,
  OrchestrationImprovementRecommendationFilters,
  OrchestrationImprovementRecommendationGroup,
  OrchestrationImprovementRecommendationListResult,
  OrchestrationImprovementSourceLink,
  OrchestrationImprovementSuppression,
  OrchestrationImprovementSuppressionReason,
  OrchestrationImprovementTriggerControl,
  OrchestrationImprovementTriggerFiring,
  OrchestrationImprovementTriggerKey,
} from "@/lib/orchestration/types";

const REDACTION_POLICY = "hiverunner.improve.redacted_evidence.v1";

const STATUS_VALUES = new Set<ImprovementRecommendationStatus>([
  "suggested",
  "needs-more-evidence",
  "accepted-for-approval",
  "dismissed",
  "superseded",
  "applied",
]);
const SEVERITY_VALUES = new Set<ImprovementRecommendationSeverity>(["low", "medium", "high", "critical"]);
const CONFIDENCE_VALUES = new Set<ImprovementRecommendationConfidence>(["low", "medium", "high"]);
const SCOPE_TYPE_VALUES = new Set<ImprovementRecommendationScopeType>([
  "company",
  "project",
  "template",
  "task_type",
  "agent",
  "runner",
  "recommendation",
]);
const SOURCE_TYPE_VALUES = new Set<ImprovementRecommendationSourceType>([
  "trace",
  "eval",
  "experiment_report",
  "template",
  "team",
  "task",
  "sprint",
  "goal",
  "review",
  "manual",
]);

const DISMISSAL_REASON_VALUES = new Set(["not_now", "wrong_diagnosis", "too_risky", "already_fixed", "not_worth_it"]);
const SUPPRESSION_REASON_VALUES = new Set([
  "not_now",
  "wrong_diagnosis",
  "too_risky",
  "already_fixed",
  "not_worth_it",
  "duplicate",
  "operator_suppressed",
]);

const ALLOWED_TRANSITIONS: Record<ImprovementRecommendationStatus, ImprovementRecommendationStatus[]> = {
  suggested: ["needs-more-evidence", "accepted-for-approval", "dismissed", "superseded", "applied"],
  "needs-more-evidence": ["suggested", "accepted-for-approval", "dismissed", "superseded", "applied"],
  "accepted-for-approval": ["dismissed", "superseded", "applied"],
  dismissed: ["superseded"],
  superseded: [],
  applied: [],
};

const CREDENTIAL_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

type JsonRecord = Record<string, unknown>;

type RecommendationRow = {
  id: string;
  company_id: string;
  trigger_key: string;
  trigger_class?: string | null;
  source_trigger_firing_id?: string | null;
  evidence_set_id?: string | null;
  scope_type: ImprovementRecommendationScopeType;
  scope_key: string;
  title: string;
  rationale: string;
  proposed_change: string;
  proposed_change_summary?: string | null;
  proposed_change_json?: string | null;
  original_generated_text?: string | null;
  operator_text?: string | null;
  affected_surfaces_json?: string | null;
  rollback_notes?: string | null;
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
  accepted_at?: string | null;
  superseded_at?: string | null;
  applied_at?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  scope_label?: string | null;
  suppression_reason?: string | null;
  suppression_notes?: string | null;
  suppression_active?: number | null;
  suppression_scope_type?: string | null;
  suppression_scope_key?: string | null;
  suppression_expires_at?: string | null;
  suppression_evidence_fingerprint?: string | null;
  suppression_metadata_json?: string | null;
  suppression_created_at?: string | null;
  suppression_updated_at?: string | null;
  approval_status?: ApprovalStatus | null;
  approval_decision_note?: string | null;
  approval_decided_at?: string | null;
  evidence_set_summary?: string | null;
  evidence_set_strength?: "single" | "pattern" | "manual" | "unknown" | null;
  evidence_set_items_json?: string | null;
  evidence_set_redaction_policy?: string | null;
  evidence_set_redaction_summary_json?: string | null;
  evidence_set_metadata_json?: string | null;
  evidence_set_created_by_agent_id?: string | null;
  evidence_set_created_by_user_id?: string | null;
  evidence_set_created_at?: string | null;
  trigger_firing_trigger_key?: string | null;
  trigger_firing_trigger_class?: string | null;
  trigger_firing_scope_type?: string | null;
  trigger_firing_scope_key?: string | null;
  trigger_firing_status?: OrchestrationImprovementTriggerFiring["status"] | null;
  trigger_firing_decision_reason?: string | null;
  trigger_firing_evidence_json?: string | null;
  trigger_firing_recommendation_id?: string | null;
  trigger_firing_suppression_id?: string | null;
  trigger_firing_fired_at?: string | null;
  trigger_firing_source_task_id?: string | null;
  trigger_firing_source_run_id?: string | null;
  trigger_firing_source_eval_case_id?: string | null;
  trigger_firing_thresholds_json?: string | null;
  trigger_firing_metadata_json?: string | null;
  approval_links_json?: string | null;
};

export type ImproveEvidenceInput = {
  id?: string;
  sourceType?: string;
  source?: string;
  sourceId?: string | null;
  runId?: string | null;
  taskId?: string | null;
  taskKey?: string | null;
  evalCaseId?: string | null;
  templateVersionId?: string | null;
  templateIntakeAnswerId?: string | null;
  agentId?: string | null;
  sprintId?: string | null;
  sprintKey?: string | null;
  goalId?: string | null;
  goalKey?: string | null;
  title?: string;
  summary?: string;
  occurredAt?: string | null;
  route?: string | null;
  href?: string | null;
  missingReason?: string | null;
  payload?: unknown;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type CreateImproveRecommendationInput = {
  id?: string;
  companyId: string;
  triggerKey: string;
  scopeType: ImprovementRecommendationScopeType;
  scopeKey: string;
  title: string;
  rationale?: string;
  proposedChange?: string;
  severity?: ImprovementRecommendationSeverity;
  confidence?: ImprovementRecommendationConfidence;
  status?: ImprovementRecommendationStatus;
  evidence?: ImproveEvidenceInput[];
  originalRecommendation?: Record<string, unknown>;
  currentRecommendation?: Record<string, unknown>;
  dismissalReason?: string | null;
  dismissalNotes?: string | null;
  suppressionId?: string | null;
  supersededByRecommendationId?: string | null;
  approvalId?: string | null;
  idempotencyKey?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  createdAt?: string | null;
};

export type UpdateImproveRecommendationInput =
  | {
      action: "edit";
      title?: string;
      rationale?: string;
      proposedChange?: string;
      severity?: ImprovementRecommendationSeverity;
      confidence?: ImprovementRecommendationConfidence;
      category?: string | null;
      summary?: string | null;
      riskNotes?: string | null;
      rollbackNotes?: string | null;
      groupKey?: string | null;
      groupLabel?: string | null;
      tags?: string[];
    }
  | {
      action: "dismiss";
      reason: string;
      notes?: string | null;
      actorAgentId?: string | null;
      actorUserId?: string | null;
    }
  | {
      action: "suppress";
      reason: string;
      notes?: string | null;
      scopeType?: ImprovementRecommendationScopeType;
      scopeKey?: string;
      expiresAt?: string | null;
      actorAgentId?: string | null;
      actorUserId?: string | null;
    }
  | {
      action: "accept_for_approval";
      approvalId?: string | null;
      note?: string | null;
      title?: string;
      proposedChangeSummary?: string;
      rationale?: string;
      preview?: JsonRecord;
      riskNotes?: string | null;
      rollbackNotes?: string | null;
      actorAgentId?: string | null;
      actorUserId?: string | null;
    }
  | {
      action: "transition";
      status: ImprovementRecommendationStatus;
      reason?: string | null;
      approvalId?: string | null;
      supersededByRecommendationId?: string | null;
      actorAgentId?: string | null;
      actorUserId?: string | null;
    };

function compact(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requiredText(value: string | null | undefined, label: string): string {
  const trimmed = compact(value);
  if (!trimmed) {
    throw new OrchestrationApiError(400, "validation_error", `${label} is required`);
  }
  return trimmed;
}

function parseRecord(raw: string | null | undefined): JsonRecord {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function parseArray(raw: string | null | undefined): JsonRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function redactText(value: string): string {
  return CREDENTIAL_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[redacted]"), value);
}

function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactJson);
  if (!value || typeof value !== "object") return value ?? null;
  return Object.fromEntries(
    Object.entries(value as JsonRecord).map(([key, item]) => [key, redactJson(item)]),
  );
}

function hasCredentialLikeText(value: string): boolean {
  if (value.includes("[REDACTED") || value.includes("[redacted]")) return false;
  return CREDENTIAL_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function hasUnredactedCredentialLikeValue(value: unknown): boolean {
  if (typeof value === "string") return hasCredentialLikeText(value);
  if (Array.isArray(value)) return value.some(hasUnredactedCredentialLikeValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value as JsonRecord).some(hasUnredactedCredentialLikeValue);
}

function assertRedactedEvidencePayload(evidenceItems: ImproveEvidenceInput[]): void {
  if (evidenceItems.some(hasUnredactedCredentialLikeValue)) {
    throw new OrchestrationApiError(
      400,
      "unredacted_evidence_payload",
      "Evidence contains an unredacted credential-like value",
    );
  }
}

function stringValue(record: JsonRecord, keys: string[], maxLength = 1000): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
    }
  }
  return null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 25)
    : [];
}

function normalizeSourceType(value: unknown): ImprovementRecommendationSourceType {
  const normalized = String(value ?? "manual").trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "run_trace" || normalized === "trace" || normalized === "run") return "trace";
  if (normalized === "eval_case" || normalized === "eval") return "eval";
  if (normalized === "experiment_report" || normalized === "comparison_report") return "experiment_report";
  if (normalized === "team" || normalized === "agent") return "team";
  if (normalized === "template") return "template";
  if (normalized === "task") return "task";
  if (normalized === "sprint") return "sprint";
  if (normalized === "goal") return "goal";
  if (normalized === "review") return "review";
  return "manual";
}

function assertStatus(value: string): ImprovementRecommendationStatus {
  if (!STATUS_VALUES.has(value as ImprovementRecommendationStatus)) {
    throw new OrchestrationApiError(400, "validation_error", "Invalid recommendation status");
  }
  return value as ImprovementRecommendationStatus;
}

function assertSeverity(value: string): ImprovementRecommendationSeverity {
  if (!SEVERITY_VALUES.has(value as ImprovementRecommendationSeverity)) {
    throw new OrchestrationApiError(400, "validation_error", "Invalid recommendation severity");
  }
  return value as ImprovementRecommendationSeverity;
}

function assertConfidence(value: string): ImprovementRecommendationConfidence {
  if (!CONFIDENCE_VALUES.has(value as ImprovementRecommendationConfidence)) {
    throw new OrchestrationApiError(400, "validation_error", "Invalid recommendation confidence");
  }
  return value as ImprovementRecommendationConfidence;
}

function assertScopeType(value: string): ImprovementRecommendationScopeType {
  if (!SCOPE_TYPE_VALUES.has(value as ImprovementRecommendationScopeType)) {
    throw new OrchestrationApiError(400, "validation_error", "Invalid recommendation scope type");
  }
  return value as ImprovementRecommendationScopeType;
}

function sourceFilterAliases(sourceType: ImprovementRecommendationSourceType): string[] {
  if (sourceType === "trace") return ["trace", "run_trace", "run"];
  if (sourceType === "eval") return ["eval", "eval_case"];
  if (sourceType === "experiment_report") return ["experiment_report", "comparison_report"];
  if (sourceType === "team") return ["team", "agent"];
  return [sourceType];
}

function resolveCompany(input: {
  companyIdOrSlug: string;
  db: Database.Database;
}): { id: string; slug: string; code: string | null; name: string } {
  const company = resolveCompanyIdBySlug(input.companyIdOrSlug, input.db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return {
    id: company.id,
    slug: company.slug,
    code: compact(company.company_code),
    name: company.name,
  };
}

function recommendationSelectSql(): string {
  return `SELECT
      r.*,
      COALESCE(scope_agent.name, scope_project.name) AS scope_label,
      s.reason AS suppression_reason,
      s.notes AS suppression_notes,
      s.active AS suppression_active,
      s.scope_type AS suppression_scope_type,
      s.scope_key AS suppression_scope_key,
      s.expires_at AS suppression_expires_at,
      s.evidence_fingerprint AS suppression_evidence_fingerprint,
      s.metadata_json AS suppression_metadata_json,
      s.created_at AS suppression_created_at,
      s.updated_at AS suppression_updated_at,
      a.status AS approval_status,
      a.decision_note AS approval_decision_note,
      a.decided_at AS approval_decided_at,
      es.summary AS evidence_set_summary,
      es.evidence_strength AS evidence_set_strength,
      es.evidence_items_json AS evidence_set_items_json,
      es.redaction_policy AS evidence_set_redaction_policy,
      es.redaction_summary_json AS evidence_set_redaction_summary_json,
      es.metadata_json AS evidence_set_metadata_json,
      es.created_by_agent_id AS evidence_set_created_by_agent_id,
      es.created_by_user_id AS evidence_set_created_by_user_id,
      es.created_at AS evidence_set_created_at,
      tf.trigger_key AS trigger_firing_trigger_key,
      tf.trigger_class AS trigger_firing_trigger_class,
      tf.scope_type AS trigger_firing_scope_type,
      tf.scope_key AS trigger_firing_scope_key,
      tf.status AS trigger_firing_status,
      tf.decision_reason AS trigger_firing_decision_reason,
      tf.evidence_json AS trigger_firing_evidence_json,
      tf.recommendation_id AS trigger_firing_recommendation_id,
      tf.suppression_id AS trigger_firing_suppression_id,
      tf.fired_at AS trigger_firing_fired_at,
      tf.source_task_id AS trigger_firing_source_task_id,
      tf.source_run_id AS trigger_firing_source_run_id,
      tf.source_eval_case_id AS trigger_firing_source_eval_case_id,
      tf.thresholds_json AS trigger_firing_thresholds_json,
      tf.metadata_json AS trigger_firing_metadata_json,
      COALESCE((
        SELECT json_group_array(json_object(
          'id', l.id,
          'companyId', l.company_id,
          'recommendationId', l.recommendation_id,
          'approvalId', l.approval_id,
          'status', l.status,
          'approvalPackage', json(l.approval_package_json),
          'riskNotes', json_extract(l.approval_package_json, '$.riskNotes'),
          'rollbackNotes', l.rollback_notes,
          'createdByAgentId', l.created_by_agent_id,
          'createdByUserId', l.created_by_user_id,
          'createdAt', l.created_at,
          'updatedAt', l.updated_at
        ))
        FROM improvement_recommendation_approval_links l
        WHERE l.recommendation_id = r.id
        ORDER BY l.created_at ASC, l.id ASC
      ), '[]') AS approval_links_json
    FROM improvement_recommendations r
    LEFT JOIN agents scope_agent
      ON r.scope_type = 'agent'
     AND scope_agent.id = r.scope_key
    LEFT JOIN projects scope_project
      ON r.scope_type = 'project'
     AND scope_project.id = r.scope_key
    LEFT JOIN improvement_suppressions s
      ON s.id = r.suppression_id
    LEFT JOIN approvals a
      ON a.id = r.approval_id
    LEFT JOIN improvement_evidence_sets es
      ON es.id = r.evidence_set_id
    LEFT JOIN improvement_trigger_firings tf
      ON tf.id = r.source_trigger_firing_id`;
}

function buildWhere(filters: OrchestrationImprovementRecommendationFilters): { sql: string; args: unknown[] } {
  const where = ["r.company_id = ?"];
  const args: unknown[] = [];

  if (filters.status?.length) {
    where.push(`r.status IN (${filters.status.map(() => "?").join(", ")})`);
    args.push(...filters.status);
  }
  if (filters.severity?.length) {
    where.push(`r.severity IN (${filters.severity.map(() => "?").join(", ")})`);
    args.push(...filters.severity);
  }
  if (filters.confidence?.length) {
    where.push(`r.confidence IN (${filters.confidence.map(() => "?").join(", ")})`);
    args.push(...filters.confidence);
  }
  if (filters.triggerKey) {
    where.push("r.trigger_key = ?");
    args.push(filters.triggerKey);
  }
  if (filters.category) {
    where.push(`lower(COALESCE(
      json_extract(r.current_recommendation_json, '$.category'),
      json_extract(r.current_recommendation_json, '$.recommendationType'),
      json_extract(r.original_recommendation_json, '$.category'),
      json_extract(r.original_recommendation_json, '$.recommendationType'),
      r.trigger_key
    )) = lower(?)`);
    args.push(filters.category);
  }
  if (filters.scopeType) {
    where.push("r.scope_type = ?");
    args.push(filters.scopeType);
  }
  if (filters.scopeKey) {
    where.push("r.scope_key = ?");
    args.push(filters.scopeKey);
  }
  if (filters.agentId) {
    where.push("(r.scope_type = 'agent' AND r.scope_key = ?)");
    args.push(filters.agentId);
  }
  if (filters.projectId) {
    where.push(`(
      (r.scope_type = 'project' AND r.scope_key IN (
        SELECT p.id FROM projects p WHERE p.company_id = r.company_id AND (p.id = ? OR p.slug = ? OR lower(p.name) = lower(?))
      ))
      OR (r.scope_type = 'agent' AND r.scope_key IN (
        SELECT a.id FROM agents a
        INNER JOIN projects p ON p.id = a.project_id
        WHERE a.company_id = r.company_id AND (p.id = ? OR p.slug = ? OR lower(p.name) = lower(?))
      ))
    )`);
    args.push(filters.projectId, filters.projectId, filters.projectId, filters.projectId, filters.projectId, filters.projectId);
  }
  if (filters.sourceType?.length) {
    const aliases = filters.sourceType.flatMap(sourceFilterAliases);
    where.push(`EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(r.evidence_json) THEN r.evidence_json ELSE '[]' END) e
      WHERE lower(COALESCE(
        json_extract(e.value, '$.sourceType'),
        json_extract(e.value, '$.source'),
        'manual'
      )) IN (${aliases.map(() => "?").join(", ")})
    )`);
    args.push(...aliases);
  }
  if (filters.search) {
    where.push(`(
      lower(r.title) LIKE '%' || lower(?) || '%'
      OR lower(r.rationale) LIKE '%' || lower(?) || '%'
      OR lower(r.proposed_change) LIKE '%' || lower(?) || '%'
    )`);
    args.push(filters.search, filters.search, filters.search);
  }
  if (filters.evidenceState === "missing") {
    where.push(`(
      json_array_length(CASE WHEN json_valid(r.evidence_json) THEN r.evidence_json ELSE '[]' END) = 0
      OR NOT EXISTS (
        SELECT 1
        FROM json_each(CASE WHEN json_valid(r.evidence_json) THEN r.evidence_json ELSE '[]' END) e
        WHERE COALESCE(json_extract(e.value, '$.missingReason'), '') = ''
      )
    )`);
  } else if (filters.evidenceState === "present") {
    where.push(`EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(r.evidence_json) THEN r.evidence_json ELSE '[]' END) e
      WHERE COALESCE(json_extract(e.value, '$.missingReason'), '') = ''
    )`);
  }
  if (!filters.includeSuppressed) {
    where.push("r.suppression_id IS NULL");
  }

  return { sql: where.join(" AND "), args };
}

function buildTaskLink(companyCode: string, taskKey: string): string {
  return buildCanonicalCompanyPath(companyCode, `/tasks/${encodeURIComponent(taskKey)}`);
}

function link(
  type: OrchestrationImprovementSourceLink["type"],
  id: string | null,
  label: string | null,
  href: string | null,
): OrchestrationImprovementSourceLink | null {
  const normalizedId = compact(id);
  const normalizedHref = compact(href);
  if (!normalizedId || !normalizedHref) return null;
  return {
    type,
    id: normalizedId,
    label: compact(label) ?? normalizedId,
    href: normalizedHref,
  };
}

type EvidenceLinkContext = {
  item: JsonRecord;
  sourceType: ImprovementRecommendationSourceType;
  sourceId: string | null;
  companyCode: string | null;
  route: string | null;
  title: string | null;
  taskKey: string | null;
  taskId: string | null;
  runId: string | null;
  evalCaseId: string | null;
  templateVersionId: string | null;
  templateIntakeAnswerId: string | null;
  agentId: string | null;
  sprintKey: string | null;
  sprintId: string | null;
  goalKey: string | null;
  goalId: string | null;
};

function evidenceLinkContext(input: {
  item: JsonRecord;
  sourceType: ImprovementRecommendationSourceType;
  sourceId: string | null;
  companyCode: string | null;
}): EvidenceLinkContext {
  const item = input.item;
  return {
    ...input,
    route: stringValue(item, ["href", "route"], 400),
    title: stringValue(item, ["title", "sourceLabel", "label"], 200),
    taskKey: stringValue(item, ["taskKey", "sourceTaskKey"], 120),
    taskId: stringValue(item, ["taskId", "sourceTaskId"], 120),
    runId: stringValue(item, ["runId", "sourceRunId"], 120),
    evalCaseId: stringValue(item, ["evalCaseId", "sourceEvalCaseId"], 120),
    templateVersionId: stringValue(item, ["templateVersionId", "sourceTemplateVersionId"], 160),
    templateIntakeAnswerId: stringValue(item, ["templateIntakeAnswerId", "intakeAnswerId"], 160),
    agentId: stringValue(item, ["agentId", "sourceAgentId"], 120),
    sprintKey: stringValue(item, ["sprintKey", "sourceSprintKey"], 120),
    sprintId: stringValue(item, ["sprintId", "sourceSprintId"], 120),
    goalKey: stringValue(item, ["goalKey", "sourceGoalKey"], 120),
    goalId: stringValue(item, ["goalId", "sourceGoalId"], 120),
  };
}

function directEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.route?.startsWith("/") || !ctx.sourceId) return null;
  const type = ctx.sourceType === "review" || ctx.sourceType === "manual" ? "task" : ctx.sourceType;
  return link(type, ctx.sourceId, ctx.title, ctx.route);
}

function traceEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode || !ctx.runId) return null;
  const href = ctx.taskKey
    ? buildCanonicalTaskRunTracePath(ctx.companyCode, ctx.taskKey, ctx.runId)
    : buildCanonicalRunTracePath(ctx.companyCode, ctx.runId);
  return link("trace", ctx.runId, "Run trace", href);
}

function evalEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode) return null;
  const evalId = ctx.evalCaseId ?? (ctx.sourceType === "eval" ? ctx.sourceId : null);
  const href = ctx.evalCaseId || ctx.sourceType === "eval"
    ? buildCanonicalEvalCasePath(ctx.companyCode, ctx.evalCaseId ?? ctx.sourceId ?? "")
    : null;
  return link("eval", evalId, ctx.title ?? "Eval case", href);
}

function templateEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode) return null;
  const templateId = ctx.templateVersionId ?? (ctx.sourceType === "template" ? ctx.sourceId : null);
  const href = ctx.templateVersionId
    ? `${buildCanonicalEvalsPath(ctx.companyCode)}?template=${encodeURIComponent(ctx.templateVersionId)}`
    : ctx.templateIntakeAnswerId
      ? `${buildCanonicalEvalsPath(ctx.companyCode)}?templateIntakeAnswerId=${encodeURIComponent(ctx.templateIntakeAnswerId)}`
      : ctx.sourceType === "template" && ctx.sourceId
        ? `${buildCanonicalEvalsPath(ctx.companyCode)}?template=${encodeURIComponent(ctx.sourceId)}`
        : null;
  return link("template", templateId ?? ctx.templateIntakeAnswerId, ctx.title ?? "Template", href);
}

function teamEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode) return null;
  const agentId = ctx.agentId ?? (ctx.sourceType === "team" ? ctx.sourceId : null);
  const href = agentId ? `${buildCanonicalTeamPath(ctx.companyCode)}?agent=${encodeURIComponent(agentId)}` : null;
  return link("team", agentId, ctx.title ?? "Team", href);
}

function taskEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode) return null;
  const taskId = ctx.taskId ?? ctx.taskKey ?? (ctx.sourceType === "task" ? ctx.sourceId : null);
  const href = ctx.taskKey
    ? buildTaskLink(ctx.companyCode, ctx.taskKey)
    : ctx.sourceType === "task" && ctx.sourceId
      ? buildTaskLink(ctx.companyCode, ctx.sourceId)
      : null;
  return link("task", taskId, ctx.title ?? "Task", href);
}

function sprintEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode) return null;
  const sprintId = ctx.sprintKey ?? ctx.sprintId ?? (ctx.sourceType === "sprint" ? ctx.sourceId : null);
  const href = sprintId
    ? `${buildCanonicalCompanyPath(ctx.companyCode, "/goals")}?sprint=${encodeURIComponent(sprintId)}`
    : null;
  return link("sprint", sprintId, ctx.title ?? "Sprint", href);
}

function goalEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode) return null;
  const goalId = ctx.goalKey ?? ctx.goalId ?? (ctx.sourceType === "goal" ? ctx.sourceId : null);
  return link("goal", goalId, ctx.title ?? "Goal", goalId ? buildCanonicalGoalPath(ctx.companyCode, goalId) : null);
}

function experimentReportEvidenceLink(ctx: EvidenceLinkContext): OrchestrationImprovementSourceLink | null {
  if (!ctx.companyCode || ctx.sourceType !== "experiment_report") return null;
  return link(
    "experiment_report",
    ctx.sourceId,
    ctx.title ?? "Comparison report",
    ctx.sourceId ? buildCanonicalImprovePath(ctx.companyCode, { surface: "experiments", evidence: ctx.sourceId }) : null,
  );
}

function uniqueSourceLinks(links: Array<OrchestrationImprovementSourceLink | null>): OrchestrationImprovementSourceLink[] {
  const seen = new Set<string>();
  return links.filter((item): item is OrchestrationImprovementSourceLink => {
    if (!item) return false;
    const key = `${item.type}:${item.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceLinks(input: {
  item: JsonRecord;
  sourceType: ImprovementRecommendationSourceType;
  sourceId: string | null;
  companyCode: string | null;
}): OrchestrationImprovementSourceLink[] {
  const ctx = evidenceLinkContext(input);
  return uniqueSourceLinks([
    directEvidenceLink(ctx),
    traceEvidenceLink(ctx),
    evalEvidenceLink(ctx),
    templateEvidenceLink(ctx),
    teamEvidenceLink(ctx),
    taskEvidenceLink(ctx),
    sprintEvidenceLink(ctx),
    goalEvidenceLink(ctx),
    experimentReportEvidenceLink(ctx),
  ]);
}

function evidenceSummary(item: JsonRecord, companyCode: string | null): OrchestrationImprovementEvidenceSummary {
  const sourceType = normalizeSourceType(item.sourceType ?? item.source);
  const sourceId = stringValue(item, ["sourceId", "id", "runId", "evalCaseId", "taskId", "taskKey", "templateVersionId", "agentId", "sprintId", "goalId"], 160);
  const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
    ? redactJson(item.metadata) as JsonRecord
    : {};
  return {
    id: stringValue(item, ["id"], 160) ?? randomUUID(),
    sourceType,
    sourceId,
    title: redactText(stringValue(item, ["title", "sourceLabel", "label"], 200) ?? "Evidence"),
    summary: redactText(stringValue(item, ["summary", "redactedSummary", "body"], 2000) ?? ""),
    occurredAt: stringValue(item, ["occurredAt", "createdAt", "timestamp"], 80),
    missingReason: stringValue(item, ["missingReason"], 500),
    redactionPolicy: REDACTION_POLICY,
    links: evidenceLinks({ item, sourceType, sourceId, companyCode }),
    metadata,
  };
}

function evidenceSet(rawEvidence: JsonRecord[], companyCode: string | null): OrchestrationImprovementEvidenceSet {
  const summaries = rawEvidence.map((item) => evidenceSummary(item, companyCode));
  const hasPresentEvidence = summaries.some((item) => !item.missingReason);
  return {
    state: hasPresentEvidence ? "present" : "missing",
    summaries,
  };
}

function evidenceSetRecordFromRow(row: RecommendationRow): OrchestrationImprovementEvidenceSetRecord | null {
  if (!row.evidence_set_id) return null;
  return {
    id: row.evidence_set_id,
    companyId: row.company_id,
    triggerFiringId: row.source_trigger_firing_id ?? null,
    summary: row.evidence_set_summary ?? "",
    evidenceStrength: row.evidence_set_strength ?? "unknown",
    evidenceItems: parseArray(row.evidence_set_items_json),
    redactionPolicy: row.evidence_set_redaction_policy ?? REDACTION_POLICY,
    redactionSummary: parseRecord(row.evidence_set_redaction_summary_json),
    metadata: parseRecord(row.evidence_set_metadata_json),
    createdByAgentId: row.evidence_set_created_by_agent_id ?? null,
    createdByUserId: row.evidence_set_created_by_user_id ?? null,
    createdAt: row.evidence_set_created_at ?? row.created_at,
  };
}

function triggerFiringFromRecommendationRow(
  row: RecommendationRow,
): OrchestrationImprovementRecommendation["triggerFiring"] {
  if (!row.source_trigger_firing_id) return null;
  return {
    id: row.source_trigger_firing_id,
    companyId: row.company_id,
    triggerKey: dashboardTriggerKey(row.trigger_firing_trigger_key ?? row.trigger_key),
    triggerClass: row.trigger_firing_trigger_class ?? row.trigger_class ?? null,
    scope: {
      type: assertScopeType(row.trigger_firing_scope_type ?? row.scope_type),
      key: row.trigger_firing_scope_key ?? row.scope_key,
    },
    status: row.trigger_firing_status ?? "skipped",
    decisionReason: row.trigger_firing_decision_reason ?? "",
    evidence: parseArray(row.trigger_firing_evidence_json),
    recommendationId: row.trigger_firing_recommendation_id ?? row.id,
    recommendationTitle: row.title,
    suppressionId: row.trigger_firing_suppression_id ?? null,
    suppressionReason: null,
    sourceTaskId: row.trigger_firing_source_task_id ?? null,
    sourceRunId: row.trigger_firing_source_run_id ?? null,
    sourceEvalCaseId: row.trigger_firing_source_eval_case_id ?? null,
    thresholds: parseRecord(row.trigger_firing_thresholds_json),
    metadata: parseRecord(row.trigger_firing_metadata_json),
    firedAt: row.trigger_firing_fired_at ?? row.created_at,
  };
}

function suppressionFromRecommendationRow(row: RecommendationRow): OrchestrationImprovementSuppression | null {
  if (!row.suppression_id || !row.suppression_reason) return null;
  const reason = SUPPRESSION_REASON_VALUES.has(row.suppression_reason)
    ? row.suppression_reason as OrchestrationImprovementSuppressionReason
    : "operator_suppressed";
  return {
    id: row.suppression_id,
    companyId: row.company_id,
    triggerKey: row.trigger_key ? dashboardTriggerKey(row.trigger_key) : null,
    scope: {
      type: assertScopeType(row.suppression_scope_type ?? row.scope_type),
      key: row.suppression_scope_key ?? row.scope_key,
    },
    reason,
    notes: row.suppression_notes ?? null,
    active: row.suppression_active !== 0,
    sourceRecommendationId: row.id,
    evidenceFingerprint: row.suppression_evidence_fingerprint ?? null,
    metadata: parseRecord(row.suppression_metadata_json),
    expiresAt: row.suppression_expires_at ?? null,
    createdAt: row.suppression_created_at ?? row.created_at,
    updatedAt: row.suppression_updated_at ?? row.updated_at,
  };
}

function approvalLinksFromRow(row: RecommendationRow): OrchestrationImprovementApprovalLink[] {
  return parseArray(row.approval_links_json).map((item): OrchestrationImprovementApprovalLink => ({
    id: String(item.id ?? ""),
    companyId: String(item.companyId ?? row.company_id),
    recommendationId: String(item.recommendationId ?? row.id),
    approvalId: typeof item.approvalId === "string" ? item.approvalId : null,
    status: String(item.status ?? "draft") as OrchestrationImprovementApprovalLink["status"],
    approvalPackage: item.approvalPackage && typeof item.approvalPackage === "object" && !Array.isArray(item.approvalPackage)
      ? item.approvalPackage as JsonRecord
      : {},
    riskNotes: typeof item.riskNotes === "string" ? item.riskNotes : null,
    rollbackNotes: typeof item.rollbackNotes === "string" ? item.rollbackNotes : "",
    createdByAgentId: typeof item.createdByAgentId === "string" ? item.createdByAgentId : null,
    createdByUserId: typeof item.createdByUserId === "string" ? item.createdByUserId : null,
    createdAt: typeof item.createdAt === "string" ? item.createdAt : row.created_at,
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : row.updated_at,
  })).filter((item) => item.id);
}

function uniqueLinks(evidence: OrchestrationImprovementEvidenceSet): OrchestrationImprovementSourceLink[] {
  const seen = new Set<string>();
  return evidence.summaries.flatMap((item) => item.links).filter((item) => {
    const key = `${item.type}:${item.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recommendationCategory(original: JsonRecord, current: JsonRecord, triggerKey: string): string | null {
  return stringValue(current, ["category", "recommendationType"], 120)
    ?? stringValue(original, ["category", "recommendationType"], 120)
    ?? triggerKey;
}

function recommendationTags(current: JsonRecord, original: JsonRecord): string[] {
  return stringArrayValue(current.tags).length
    ? stringArrayValue(current.tags)
    : stringArrayValue(original.tags);
}

function mapRecommendationRow(row: RecommendationRow, companyCode: string | null): OrchestrationImprovementRecommendation {
  const originalRecommendation = parseRecord(row.original_recommendation_json);
  const currentRecommendation = parseRecord(row.current_recommendation_json);
  const evidence = evidenceSet(parseArray(row.evidence_json), companyCode);
  const links = uniqueLinks(evidence);
  const affectedSurfaces = parseArray(row.affected_surfaces_json);
  const proposedChangeJson = parseRecord(row.proposed_change_json);
  const evidenceRecord = evidenceSetRecordFromRow(row);
  const triggerFiring = triggerFiringFromRecommendationRow(row);
  const suppression = suppressionFromRecommendationRow(row);
  const approvalLinks = approvalLinksFromRow(row);
  const suppressionScope = row.suppression_scope_type && row.suppression_scope_key
    ? `${row.suppression_scope_type}:${row.suppression_scope_key}`
    : null;
  return {
    id: row.id,
    companyId: row.company_id,
    status: row.status,
    triggerKey: row.trigger_key,
    triggerClass: row.trigger_class ?? null,
    scope: {
      type: row.scope_type,
      key: row.scope_key,
    },
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    scopeLabel: row.scope_label ?? stringValue(currentRecommendation, ["scopeLabel", "targetLabel"], 200),
    category: recommendationCategory(originalRecommendation, currentRecommendation, row.trigger_key),
    severity: row.severity,
    confidence: row.confidence,
    title: row.title,
    summary: stringValue(currentRecommendation, ["summary"], 1000) ?? row.proposed_change_summary ?? row.proposed_change,
    rationale: row.rationale,
    proposedChange: row.proposed_change,
    proposedChangeSummary: row.proposed_change_summary ?? stringValue(currentRecommendation, ["proposedChangeSummary"], 1000) ?? row.proposed_change,
    proposedChangeJson,
    originalRecommendation,
    currentRecommendation,
    originalGeneratedText: row.original_generated_text ?? stringValue(originalRecommendation, ["originalGeneratedText"], 5000) ?? "",
    operatorText: row.operator_text ?? stringValue(currentRecommendation, ["operatorText"], 5000) ?? "",
    evidence,
    evidenceSetId: row.evidence_set_id ?? null,
    evidenceSet: evidenceRecord,
    sourceTriggerFiringId: row.source_trigger_firing_id ?? null,
    triggerFiring,
    affectedSurfaces: affectedSurfaces.length
      ? affectedSurfaces
      : Array.isArray(currentRecommendation.affectedSurfaces)
      ? currentRecommendation.affectedSurfaces.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [],
    preview: currentRecommendation.preview && typeof currentRecommendation.preview === "object" && !Array.isArray(currentRecommendation.preview)
      ? currentRecommendation.preview as JsonRecord
      : null,
    riskNotes: stringValue(currentRecommendation, ["riskNotes"], 1000),
    rollbackNotes: row.rollback_notes ?? stringValue(currentRecommendation, ["rollbackNotes"], 1000),
    latestApprovalId: row.approval_id,
    latestApprovalStatus: row.approval_status ?? null,
    approvalDecisionNote: row.approval_decision_note ?? null,
    approvalSyncedAt: row.approval_decided_at ?? null,
    dismissalReason: row.dismissal_reason as OrchestrationImprovementRecommendation["dismissalReason"],
    dismissalNotes: row.dismissal_notes,
    dismissedAt: row.dismissed_at,
    suppressionId: row.suppression_id,
    suppression,
    suppressionReason: row.suppression_reason ?? null,
    suppressionScope,
    suppressionExpiresAt: row.suppression_expires_at ?? null,
    supersededByRecommendationId: row.superseded_by_recommendation_id,
    supersededAt: row.superseded_at ?? stringValue(currentRecommendation, ["supersededAt"], 120),
    approvalId: row.approval_id,
    approval: row.approval_id
      ? {
          id: row.approval_id,
          status: row.approval_status ?? null,
          decisionNote: row.approval_decision_note ?? null,
          decidedAt: row.approval_decided_at ?? null,
        }
      : null,
    approvalLinks,
    idempotencyKey: row.idempotency_key,
    createdByAgentId: row.created_by_agent_id,
    createdByUserId: row.created_by_user_id,
    acceptedByUserId: stringValue(currentRecommendation, ["acceptedByUserId"], 120),
    acceptedAt: row.accepted_at ?? stringValue(currentRecommendation, ["acceptedAt"], 120) ?? (row.status === "accepted-for-approval" ? row.updated_at : null),
    appliedAt: row.applied_at ?? stringValue(currentRecommendation, ["appliedAt"], 120) ?? (row.status === "applied" ? row.updated_at : null),
    archivedAt: row.archived_at ?? null,
    links,
    tags: recommendationTags(currentRecommendation, originalRecommendation),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function loadRecommendation(input: {
  companyId: string;
  companyCode: string | null;
  recommendationId: string;
  db: Database.Database;
}): OrchestrationImprovementRecommendation {
  const row = input.db
    .prepare(`${recommendationSelectSql()} WHERE r.company_id = ? AND r.id = ? LIMIT 1`)
    .get(input.companyId, input.recommendationId) as RecommendationRow | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "improvement_recommendation_not_found", "Improve recommendation not found");
  }
  return mapRecommendationRow(row, input.companyCode);
}

function confidenceForActivity(confidence: ImprovementRecommendationConfidence): string {
  return confidence;
}

function evidenceCountForActivity(recommendation: OrchestrationImprovementRecommendation): number | undefined {
  const evidence = recommendation.evidence as { summaries?: unknown[] } | null | undefined;
  if (Array.isArray(evidence?.summaries)) return evidence.summaries.length;
  if (Array.isArray(recommendation.evidenceSet?.evidenceItems)) return recommendation.evidenceSet.evidenceItems.length;
  return undefined;
}

function resolveTaskContextForActivity(
  db: Database.Database,
  companyId: string,
  taskId: string | null | undefined,
): { projectId: string; taskId: string; taskKey: string | null } | null {
  const id = compact(taskId);
  if (!id) return null;
  const row = db
    .prepare(
      `SELECT t.id, t.task_key, t.project_id
       FROM tasks t
       INNER JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?
         AND p.company_id = ?
         AND t.archived_at IS NULL
         AND p.archived_at IS NULL
       LIMIT 1`,
    )
    .get(id, companyId) as { id: string; task_key: string | null; project_id: string } | undefined;
  return row ? { projectId: row.project_id, taskId: row.id, taskKey: row.task_key } : null;
}

function resolveProjectIdForActivity(
  db: Database.Database,
  companyId: string,
  recommendation: OrchestrationImprovementRecommendation,
  taskContext: { projectId: string } | null,
): string | null {
  if (taskContext?.projectId) return taskContext.projectId;

  const scopeType = recommendation.scopeType ?? recommendation.scope.type;
  const scopeKey = compact(recommendation.scopeKey ?? recommendation.scope.key);
  if (scopeType === "project" && scopeKey) {
    const project = db
      .prepare("SELECT id FROM projects WHERE id = ? AND company_id = ? AND archived_at IS NULL LIMIT 1")
      .get(scopeKey, companyId) as { id: string } | undefined;
    if (project) return project.id;
  }

  if (scopeType === "agent" && scopeKey) {
    const agent = db
      .prepare(
        `SELECT a.project_id
         FROM agents a
         INNER JOIN projects p ON p.id = a.project_id
         WHERE a.id = ?
           AND a.company_id = ?
           AND a.archived_at IS NULL
           AND p.archived_at IS NULL
         LIMIT 1`,
      )
      .get(scopeKey, companyId) as { project_id: string | null } | undefined;
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
    .get(companyId) as { id: string } | undefined;
  return fallback?.id ?? null;
}

type RecommendationMutationActivityInput = {
  db: Database.Database;
  companyId: string;
  companyCode: string | null;
  recommendation: OrchestrationImprovementRecommendation;
  eventType: ImproveActivityEventType;
  recommendationStatus: ImprovementRecommendationStatus;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  dismissalCategory?: string | null;
  reasonCode?: string | null;
  suppressionId?: string | null;
  suppressionScope?: string | null;
  approvalId?: string | null;
  approvalStatus?: string | null;
  appliedOutcome?: string | null;
};

type RecommendationActivityContext = {
  projectId: string;
  taskId?: string;
  taskKey?: string | null;
  agentId?: string | null;
};

function resolveRecommendationActivityContext(
  input: RecommendationMutationActivityInput,
): RecommendationActivityContext | null {
  const taskContext = resolveTaskContextForActivity(
    input.db,
    input.companyId,
    input.recommendation.triggerFiring?.sourceTaskId,
  );
  const projectId = resolveProjectIdForActivity(input.db, input.companyId, input.recommendation, taskContext);
  if (!projectId) return null;

  const scopeType = input.recommendation.scopeType ?? input.recommendation.scope.type;
  const scopeKey = compact(input.recommendation.scopeKey ?? input.recommendation.scope.key);
  return {
    projectId,
    taskId: taskContext?.taskId,
    taskKey: taskContext?.taskKey,
    agentId: scopeType === "agent" ? scopeKey : null,
  };
}

function suppressionScopeForActivity(input: RecommendationMutationActivityInput): string | null {
  return (
    compact(input.suppressionScope) ??
    input.recommendation.suppressionScope ??
    (input.recommendation.suppression
      ? `${input.recommendation.suppression.scope.type}:${input.recommendation.suppression.scope.key}`
      : null)
  );
}

function buildMutationActivitySource(
  input: RecommendationMutationActivityInput,
  context: RecommendationActivityContext,
): ImproveActivitySource {
  const recommendation = input.recommendation;
  return {
    recommendationId: recommendation.id,
    recommendationStatus: input.recommendationStatus,
    recommendationType: recommendation.triggerKey,
    category: recommendation.category,
    severity: recommendation.severity,
    confidence: confidenceForActivity(recommendation.confidence),
    projectId: context.projectId,
    taskId: context.taskId,
    taskKey: context.taskKey,
    agentId: context.agentId,
    triggerId: recommendation.triggerKey,
    triggerHistoryId: recommendation.sourceTriggerFiringId,
    evidenceSetId: recommendation.evidenceSetId,
    evidenceCount: evidenceCountForActivity(recommendation),
    evalCaseId: recommendation.triggerFiring?.sourceEvalCaseId,
    sourceRunId: recommendation.triggerFiring?.sourceRunId,
    suppressionId: input.suppressionId ?? recommendation.suppressionId,
    suppressionScope: suppressionScopeForActivity(input),
    dismissalCategory: input.dismissalCategory,
    reasonCode: input.reasonCode,
    approvalId: input.approvalId ?? recommendation.approvalId,
    approvalStatus: input.approvalStatus ?? recommendation.latestApprovalStatus,
    appliedOutcome: input.appliedOutcome,
    summary: recommendation.title,
  };
}

function recordRecommendationMutationActivity(input: RecommendationMutationActivityInput): void {
  const context = resolveRecommendationActivityContext(input);
  if (!context) return;
  recordImproveActivity({
    companyId: input.companyId,
    companyCode: input.companyCode,
    eventType: input.eventType,
    actorAgentId: input.actorAgentId ?? null,
    actorUserId: input.actorUserId ?? null,
    source: buildMutationActivitySource(input, context),
  }, input.db);
}

function groupRecommendations(
  recommendations: OrchestrationImprovementRecommendation[],
  groupBy: OrchestrationImprovementRecommendationFilters["groupBy"],
): OrchestrationImprovementRecommendationGroup[] {
  if (!groupBy) return [];

  const groups = new Map<string, OrchestrationImprovementRecommendationGroup>();
  for (const recommendation of recommendations) {
    const key = (() => {
      if (groupBy === "status") return recommendation.status;
      if (groupBy === "severity") return recommendation.severity;
      if (groupBy === "confidence") return recommendation.confidence;
      if (groupBy === "category") return recommendation.category ?? "uncategorized";
      if (groupBy === "trigger") return recommendation.triggerKey;
      if (groupBy === "scope") return `${recommendation.scopeType}:${recommendation.scopeKey}`;
      if (groupBy === "source") return recommendation.evidence.summaries[0]?.sourceType ?? "missing";
      return "all";
    })();
    const label = (() => {
      if (groupBy === "scope") return recommendation.scopeLabel ?? key;
      if (groupBy === "category") return recommendation.category ?? "Uncategorized";
      if (groupBy === "trigger") return recommendation.triggerKey;
      if (groupBy === "source") return recommendation.evidence.summaries[0]?.sourceType ?? "Missing evidence";
      return key;
    })();
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.recommendationIds.push(recommendation.id);
    } else {
      groups.set(key, { key, label, count: 1, recommendationIds: [recommendation.id] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function listImproveRecommendations(
  companyIdOrSlug: string,
  filters: OrchestrationImprovementRecommendationFilters = {},
  db = getOrchestrationDb(),
): OrchestrationImprovementRecommendationListResult {
  const company = resolveCompany({ companyIdOrSlug, db });
  const limit = typeof filters.limit === "number" ? Math.max(1, Math.min(Math.trunc(filters.limit), 200)) : 100;
  const sanitizedFilters: OrchestrationImprovementRecommendationFilters = {
    ...filters,
    status: filters.status?.map(assertStatus),
    severity: filters.severity?.map(assertSeverity),
    confidence: filters.confidence?.map(assertConfidence),
    sourceType: filters.sourceType?.map((item) => {
      if (!SOURCE_TYPE_VALUES.has(item)) {
        throw new OrchestrationApiError(400, "validation_error", "Invalid recommendation source type");
      }
      return item;
    }),
    scopeType: filters.scopeType ? assertScopeType(filters.scopeType) : undefined,
    triggerKey: compact(filters.triggerKey) ?? undefined,
    category: compact(filters.category) ?? undefined,
    scopeKey: compact(filters.scopeKey) ?? undefined,
    projectId: compact(filters.projectId) ?? undefined,
    agentId: compact(filters.agentId) ?? undefined,
    search: compact(filters.search) ?? undefined,
    limit,
  };
  const where = buildWhere(sanitizedFilters);
  const args = [company.id, ...where.args];
  const rows = db
    .prepare(`${recommendationSelectSql()} WHERE ${where.sql} ORDER BY r.updated_at DESC, r.created_at DESC, r.id ASC LIMIT ?`)
    .all(...args, limit) as RecommendationRow[];
  const total = (db
    .prepare(`SELECT COUNT(*) AS count FROM improvement_recommendations r WHERE ${where.sql}`)
    .get(...args) as { count: number }).count;
  const recommendations = rows.map((row) => mapRecommendationRow(row, company.code));

  return {
    recommendations,
    total,
    filters: sanitizedFilters,
    groups: groupRecommendations(recommendations, sanitizedFilters.groupBy),
  };
}

export function getImproveRecommendation(
  companyIdOrSlug: string,
  recommendationId: string,
  db = getOrchestrationDb(),
): { recommendation: OrchestrationImprovementRecommendation } {
  const company = resolveCompany({ companyIdOrSlug, db });
  return {
    recommendation: loadRecommendation({
      companyId: company.id,
      companyCode: company.code,
      recommendationId,
      db,
    }),
  };
}

function assertTransition(input: {
  from: ImprovementRecommendationStatus;
  to: ImprovementRecommendationStatus;
  recommendation: OrchestrationImprovementRecommendation;
}): void {
  if (input.from === input.to) return;
  if (!ALLOWED_TRANSITIONS[input.from]?.includes(input.to)) {
    throw new OrchestrationApiError(
      400,
      "invalid_improvement_status_transition",
      `Improve recommendation transition ${input.from} -> ${input.to} is not allowed`,
    );
  }
}

function updateCurrentRecommendation(
  current: JsonRecord,
  patch: JsonRecord,
): JsonRecord {
  return {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  };
}

function setStatus(input: {
  db: Database.Database;
  recommendation: OrchestrationImprovementRecommendation;
  status: ImprovementRecommendationStatus;
  approvalId?: string | null;
  supersededByRecommendationId?: string | null;
  currentPatch?: JsonRecord;
  dismissalReason?: string | null;
  dismissalNotes?: string | null;
  suppressionId?: string | null;
}): void {
  assertTransition({
    from: input.recommendation.status,
    to: input.status,
    recommendation: input.recommendation,
  });
  const now = new Date().toISOString();
  const current = updateCurrentRecommendation(input.recommendation.currentRecommendation, input.currentPatch ?? {});
  input.db.prepare(
    `UPDATE improvement_recommendations
     SET status = ?,
         current_recommendation_json = ?,
         dismissal_reason = COALESCE(?, dismissal_reason),
         dismissal_notes = COALESCE(?, dismissal_notes),
         dismissed_at = CASE WHEN ? = 'dismissed' THEN COALESCE(dismissed_at, ?) ELSE dismissed_at END,
         accepted_at = CASE WHEN ? = 'accepted-for-approval' THEN COALESCE(accepted_at, ?) ELSE accepted_at END,
         superseded_at = CASE WHEN ? = 'superseded' THEN COALESCE(superseded_at, ?) ELSE superseded_at END,
         applied_at = CASE WHEN ? = 'applied' THEN COALESCE(applied_at, ?) ELSE applied_at END,
         suppression_id = COALESCE(?, suppression_id),
         superseded_by_recommendation_id = COALESCE(?, superseded_by_recommendation_id),
         approval_id = COALESCE(?, approval_id),
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.status,
    jsonString(current),
    input.dismissalReason ?? null,
    input.dismissalNotes ?? null,
    input.status,
    now,
    input.status,
    now,
    input.status,
    now,
    input.status,
    now,
    input.suppressionId ?? null,
    input.supersededByRecommendationId ?? null,
    input.approvalId ?? null,
    now,
    input.recommendation.id,
  );
}

function mappedDismissalReason(reason: string): string {
  const normalized = reason.trim();
  return DISMISSAL_REASON_VALUES.has(normalized) ? normalized : "not_now";
}

function assertApprovalExists(db: Database.Database, companyId: string, approvalId: string | null | undefined): string | null {
  const id = compact(approvalId);
  if (!id) return null;
  const row = db
    .prepare("SELECT id FROM approvals WHERE id = ? AND company_id = ? LIMIT 1")
    .get(id, companyId) as { id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(400, "approval_not_found", "Approval does not belong to this company");
  }
  return id;
}

type ImproveMutationContext<T extends UpdateImproveRecommendationInput> = {
  db: Database.Database;
  company: ReturnType<typeof resolveCompany>;
  recommendation: OrchestrationImprovementRecommendation;
  input: T;
  now: string;
};

function hasEditPatch(input: Extract<UpdateImproveRecommendationInput, { action: "edit" }>): boolean {
  return Object.entries(input).some(([key, value]) => key !== "action" && value !== undefined);
}

function setCompactPatch(patch: JsonRecord, key: string, value: string | null | undefined): void {
  if (value !== undefined) patch[key] = compact(value);
}

function buildEditCurrentPatch(input: Extract<UpdateImproveRecommendationInput, { action: "edit" }>, now: string): JsonRecord {
  const patch: JsonRecord = { editedAt: now };
  setCompactPatch(patch, "category", input.category);
  if (input.summary !== undefined) patch.summary = compact(input.summary) ?? "";
  setCompactPatch(patch, "riskNotes", input.riskNotes);
  setCompactPatch(patch, "rollbackNotes", input.rollbackNotes);
  setCompactPatch(patch, "groupKey", input.groupKey);
  setCompactPatch(patch, "groupLabel", input.groupLabel);
  if (input.tags !== undefined) {
    patch.tags = input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 25);
  }
  return patch;
}

function applyEditMutation(ctx: ImproveMutationContext<Extract<UpdateImproveRecommendationInput, { action: "edit" }>>): void {
  const { db, input, now, recommendation } = ctx;
  const title = input.title === undefined ? recommendation.title : requiredText(input.title, "title");
  const rationale = input.rationale === undefined ? recommendation.rationale : compact(input.rationale) ?? "";
  const proposedChange = input.proposedChange === undefined ? recommendation.proposedChange : compact(input.proposedChange) ?? "";
  const severity = input.severity === undefined ? recommendation.severity : assertSeverity(input.severity);
  const confidence = input.confidence === undefined ? recommendation.confidence : assertConfidence(input.confidence);
  if (!hasEditPatch(input)) {
    throw new OrchestrationApiError(400, "validation_error", "Edit action requires at least one field");
  }
  const current = updateCurrentRecommendation(recommendation.currentRecommendation, buildEditCurrentPatch(input, now));
  db.prepare(
    `UPDATE improvement_recommendations
     SET title = ?,
         rationale = ?,
         proposed_change = ?,
         severity = ?,
         confidence = ?,
         current_recommendation_json = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(title, rationale, proposedChange, severity, confidence, jsonString(current), now, recommendation.id);
}

function applyDismissMutation(ctx: ImproveMutationContext<Extract<UpdateImproveRecommendationInput, { action: "dismiss" }>>): void {
  const { db, company, input, now, recommendation } = ctx;
  const reason = requiredText(input.reason, "dismissal reason");
  const dismissalCategory = mappedDismissalReason(reason);
  setStatus({
    db,
    recommendation,
    status: "dismissed",
    dismissalReason: dismissalCategory,
    dismissalNotes: compact(input.notes),
    currentPatch: {
      dismissalReason: reason,
      dismissedByAgentId: compact(input.actorAgentId),
      dismissedByUserId: compact(input.actorUserId),
      dismissedAt: now,
    },
  });
  recordRecommendationMutationActivity({
    db,
    companyId: company.id,
    companyCode: company.code,
    recommendation,
    eventType: "improve.recommendation_dismissed",
    recommendationStatus: "dismissed",
    actorAgentId: input.actorAgentId,
    actorUserId: input.actorUserId,
    dismissalCategory,
    reasonCode: reason,
  });
}

function applySuppressMutation(ctx: ImproveMutationContext<Extract<UpdateImproveRecommendationInput, { action: "suppress" }>>): void {
  const { db, company, input, now, recommendation } = ctx;
  const reason = requiredText(input.reason, "suppression reason");
  const suppressionReason = SUPPRESSION_REASON_VALUES.has(reason) ? reason : "operator_suppressed";
  const scopeType = assertScopeType(input.scopeType ?? recommendation.scopeType ?? recommendation.scope.type);
  const scopeKey = requiredText(input.scopeKey ?? recommendation.scopeKey ?? recommendation.scope.key, "suppression scope key");
  const suppressionId = randomUUID();
  db.prepare(
    `INSERT INTO improvement_suppressions (
       id, company_id, trigger_key, scope_type, scope_key, reason, notes, active,
       source_recommendation_id, expires_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    suppressionId,
    company.id,
    recommendation.triggerKey,
    scopeType,
    scopeKey,
    suppressionReason,
    compact(input.notes),
    recommendation.id,
    compact(input.expiresAt),
    now,
    now,
  );
  setStatus({
    db,
    recommendation,
    status: "dismissed",
    dismissalReason: "not_now",
    dismissalNotes: compact(input.notes),
    suppressionId,
    currentPatch: {
      suppressionReason,
      suppressedByAgentId: compact(input.actorAgentId),
      suppressedByUserId: compact(input.actorUserId),
      suppressedAt: now,
    },
  });
  recordRecommendationMutationActivity({
    db,
    companyId: company.id,
    companyCode: company.code,
    recommendation,
    eventType: "improve.recommendation_suppressed",
    recommendationStatus: "dismissed",
    actorAgentId: input.actorAgentId,
    actorUserId: input.actorUserId,
    suppressionId,
    suppressionScope: `${scopeType}:${scopeKey}`,
    reasonCode: suppressionReason,
  });
}

function applyAcceptForApprovalMutation(
  ctx: ImproveMutationContext<Extract<UpdateImproveRecommendationInput, { action: "accept_for_approval" }>>,
): void {
  const { db, company, input, now, recommendation } = ctx;
  const approvalId = assertApprovalExists(db, company.id, input.approvalId);
  setStatus({
    db,
    recommendation,
    status: "accepted-for-approval",
    approvalId,
    currentPatch: {
      acceptanceNote: compact(input.note),
      acceptedByAgentId: compact(input.actorAgentId),
      acceptedByUserId: compact(input.actorUserId),
      acceptedAt: now,
    },
  });
}

function applyTransitionMutation(ctx: ImproveMutationContext<Extract<UpdateImproveRecommendationInput, { action: "transition" }>>): void {
  const { db, company, input, now, recommendation } = ctx;
  const status = assertStatus(input.status);
  const approvalId = assertApprovalExists(db, company.id, input.approvalId);
  setStatus({
    db,
    recommendation,
    status,
    approvalId,
    supersededByRecommendationId: compact(input.supersededByRecommendationId),
    dismissalReason: status === "dismissed" ? mappedDismissalReason(input.reason ?? "not_now") : null,
    dismissalNotes: status === "dismissed" ? compact(input.reason) : null,
    currentPatch: {
      transitionReason: compact(input.reason),
      transitionedByAgentId: compact(input.actorAgentId),
      transitionedByUserId: compact(input.actorUserId),
      transitionedAt: now,
    },
  });
  if (status === "dismissed") {
    const reason = compact(input.reason) ?? "not_now";
    recordRecommendationMutationActivity({
      db,
      companyId: company.id,
      companyCode: company.code,
      recommendation,
      eventType: "improve.recommendation_dismissed",
      recommendationStatus: "dismissed",
      actorAgentId: input.actorAgentId,
      actorUserId: input.actorUserId,
      dismissalCategory: mappedDismissalReason(reason),
      reasonCode: reason,
    });
  } else if (status === "applied") {
    recordRecommendationMutationActivity({
      db,
      companyId: company.id,
      companyCode: company.code,
      recommendation,
      eventType: "improve.recommendation_applied",
      recommendationStatus: "applied",
      actorAgentId: input.actorAgentId,
      actorUserId: input.actorUserId,
      approvalId,
      appliedOutcome: compact(input.reason) ?? "applied",
    });
  }
}

export function updateImproveRecommendation(
  companyIdOrSlug: string,
  recommendationId: string,
  input: UpdateImproveRecommendationInput,
  db = getOrchestrationDb(),
): { recommendation: OrchestrationImprovementRecommendation } {
  const company = resolveCompany({ companyIdOrSlug, db });
  const recommendation = loadRecommendation({
    companyId: company.id,
    companyCode: company.code,
    recommendationId,
    db,
  });
  const now = new Date().toISOString();

  if (input.action === "edit") {
    applyEditMutation({ db, company, recommendation, input, now });
  } else if (input.action === "dismiss") {
    applyDismissMutation({ db, company, recommendation, input, now });
  } else if (input.action === "suppress") {
    applySuppressMutation({ db, company, recommendation, input, now });
  } else if (input.action === "accept_for_approval") {
    applyAcceptForApprovalMutation({ db, company, recommendation, input, now });
  } else {
    applyTransitionMutation({ db, company, recommendation, input, now });
  }

  return getImproveRecommendation(companyIdOrSlug, recommendationId, db);
}

function evidenceHasPresentItems(evidence: ImproveEvidenceInput[]): boolean {
  return evidence.some((item) => !compact(item.missingReason));
}

function normalizeEvidenceForStorage(evidence: ImproveEvidenceInput[]): JsonRecord[] {
  return evidence.map((item) => ({
    ...item,
    sourceType: normalizeSourceType(item.sourceType ?? item.source),
    summary: redactText(item.summary ?? ""),
    title: item.title ? redactText(item.title) : undefined,
    metadata: item.metadata ? redactJson(item.metadata) : undefined,
  }));
}

export function createImproveRecommendation(
  input: CreateImproveRecommendationInput,
  db = getOrchestrationDb(),
): OrchestrationImprovementRecommendation {
  const idempotencyKey = compact(input.idempotencyKey);
  if (idempotencyKey) {
    const existing = db
      .prepare("SELECT id FROM improvement_recommendations WHERE company_id = ? AND idempotency_key = ? LIMIT 1")
      .get(input.companyId, idempotencyKey) as { id: string } | undefined;
    if (existing) {
      const company = db.prepare("SELECT company_code FROM companies WHERE id = ? LIMIT 1").get(input.companyId) as { company_code: string | null } | undefined;
      return loadRecommendation({
        companyId: input.companyId,
        companyCode: compact(company?.company_code),
        recommendationId: existing.id,
        db,
      });
    }
  }
  assertImprovementWritesEnabled(input.companyId, db);

  const scopeType = assertScopeType(input.scopeType);
  const severity = assertSeverity(input.severity ?? "medium");
  const confidence = assertConfidence(input.confidence ?? "medium");
  const evidence = input.evidence ?? [];
  const status = input.status ?? (evidenceHasPresentItems(evidence) ? "suggested" : "needs-more-evidence");
  assertStatus(status);
  const id = input.id ?? randomUUID();
  const currentRecommendation = input.currentRecommendation ?? {};
  db.prepare(
    `INSERT INTO improvement_recommendations (
       id, company_id, trigger_key, scope_type, scope_key, title, rationale, proposed_change,
       severity, confidence, status, evidence_json, original_recommendation_json,
       current_recommendation_json, dismissal_reason, dismissal_notes, dismissed_at,
       suppression_id, superseded_by_recommendation_id, approval_id, idempotency_key,
       created_by_agent_id, created_by_user_id, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')), COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ).run(
    id,
    input.companyId,
    requiredText(input.triggerKey, "trigger key"),
    scopeType,
    requiredText(input.scopeKey, "scope key"),
    requiredText(input.title, "title"),
    compact(input.rationale) ?? "",
    compact(input.proposedChange) ?? "",
    severity,
    confidence,
    status,
    jsonString(normalizeEvidenceForStorage(evidence)),
    jsonString(input.originalRecommendation ?? {
      title: input.title,
      rationale: input.rationale ?? "",
      proposedChange: input.proposedChange ?? "",
    }),
    jsonString(currentRecommendation),
    input.dismissalReason ? mappedDismissalReason(input.dismissalReason) : null,
    compact(input.dismissalNotes),
    compact(input.suppressionId),
    compact(input.supersededByRecommendationId),
    compact(input.approvalId),
    idempotencyKey,
    compact(input.createdByAgentId),
    compact(input.createdByUserId),
    compact(input.createdAt),
    compact(input.createdAt),
  );

  const company = db.prepare("SELECT company_code FROM companies WHERE id = ? LIMIT 1").get(input.companyId) as { company_code: string | null } | undefined;
  return loadRecommendation({
    companyId: input.companyId,
    companyCode: compact(company?.company_code),
    recommendationId: id,
    db,
  });
}

const TRIGGER_DEFINITIONS: Array<{
  triggerKey: OrchestrationImprovementTriggerKey;
  label: string;
  description: string;
  threshold: Record<string, unknown>;
}> = [
  {
    triggerKey: "severe_single_failure",
    label: "Severe single failure",
    description: "Creates recommendations from one serious run or review failure.",
    threshold: { minSeverity: "high" },
  },
  {
    triggerKey: "repeated_review_return",
    label: "Repeated review return",
    description: "Creates recommendations when similar review returns repeat.",
    threshold: { minReturnedReviews: 2 },
  },
  {
    triggerKey: "missing_capability",
    label: "Missing capability",
    description: "Creates recommendations for missing skills or agent capabilities.",
    threshold: { minEvidenceCount: 1 },
  },
  {
    triggerKey: "missing_tool_runtime",
    label: "Missing tool or runtime",
    description: "Creates recommendations for unavailable low-risk tools or runtimes.",
    threshold: { minEvidenceCount: 1 },
  },
  {
    triggerKey: "template_drift",
    label: "Template drift",
    description: "Creates recommendations when generated work repeatedly needs the same correction.",
    threshold: { minPatternCount: 2 },
  },
  {
    triggerKey: "runner_mismatch",
    label: "Runner mismatch",
    description: "Creates recommendations when task needs and execution lane repeatedly diverge.",
    threshold: { minPatternCount: 2 },
  },
  {
    triggerKey: "reviewer_request",
    label: "Reviewer request",
    description: "Creates recommendations from explicit reviewer improvement requests.",
    threshold: { minEvidenceCount: 1 },
  },
  {
    triggerKey: "slow_expensive_run",
    label: "Slow or expensive run",
    description: "Creates recommendations when a completed run is a duration or fresh-input-token outlier versus the configured efficiency baseline.",
    threshold: { maxDurationMs: 1_200_000, maxFreshInputTokens: 117_000, freshInputBaselineTokens: 46_700 },
  },
];

const TRIGGER_KEYS = new Set<string>(TRIGGER_DEFINITIONS.map((trigger) => trigger.triggerKey));
const TRIGGER_KEY_ALIASES: Record<string, OrchestrationImprovementTriggerKey> = {
  missing_skill: "missing_capability",
  suggested_new_agent_role: "missing_capability",
  bench_or_exclude_agent: "repeated_review_return",
  template_capability_slot_change: "template_drift",
  reviewer_notes: "reviewer_request",
};

function dashboardTriggerKey(value: string | null | undefined): OrchestrationImprovementTriggerKey {
  const key = compact(value) ?? "reviewer_request";
  const alias = TRIGGER_KEY_ALIASES[key];
  if (alias) return alias;
  return TRIGGER_KEYS.has(key) ? key as OrchestrationImprovementTriggerKey : "reviewer_request";
}

function parseThreshold(raw: string | null | undefined, fallback: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseRecord(raw);
  return Object.keys(parsed).length > 0 ? parsed : fallback;
}

function companyControlFromRow(
  companyId: string,
  row: { automation_paused: number; paused_reason: string | null; paused_at: string | null; updated_at: string } | undefined,
): OrchestrationImprovementCompanyControl {
  return {
    companyId,
    automationPaused: row?.automation_paused === 1,
    pausedReason: row?.paused_reason ?? null,
    pausedAt: row?.paused_at ?? null,
    updatedAt: row?.updated_at ?? new Date(0).toISOString(),
  };
}

function firingFromRow(row: {
  id: string;
  company_id: string;
  trigger_key: string;
  scope_type: ImprovementRecommendationScopeType;
  scope_key: string;
  status: string;
  decision_reason: string;
  evidence_json: string;
  recommendation_id: string | null;
  recommendation_title?: string | null;
  suppression_id: string | null;
  suppression_reason?: string | null;
  fired_at: string;
}): OrchestrationImprovementTriggerFiring {
  const suppressionReason = row.suppression_reason && SUPPRESSION_REASON_VALUES.has(row.suppression_reason)
    ? row.suppression_reason as OrchestrationImprovementSuppressionReason
    : null;
  return {
    id: row.id,
    companyId: row.company_id,
    triggerKey: dashboardTriggerKey(row.trigger_key),
    scope: {
      type: row.scope_type,
      key: row.scope_key,
    },
    status: row.status as OrchestrationImprovementTriggerFiring["status"],
    decisionReason: row.decision_reason,
    evidence: parseArray(row.evidence_json),
    recommendationId: row.recommendation_id,
    recommendationTitle: row.recommendation_title ?? null,
    suppressionId: row.suppression_id,
    suppressionReason,
    firedAt: row.fired_at,
  };
}

function suppressionFromRow(row: {
  id: string;
  company_id: string;
  trigger_key: string | null;
  scope_type: ImprovementRecommendationScopeType;
  scope_key: string;
  reason: string;
  notes: string | null;
  active: number;
  source_recommendation_id: string | null;
  evidence_fingerprint?: string | null;
  metadata_json?: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}): OrchestrationImprovementSuppression {
  const reason = SUPPRESSION_REASON_VALUES.has(row.reason)
    ? row.reason as OrchestrationImprovementSuppressionReason
    : "operator_suppressed";
  return {
    id: row.id,
    companyId: row.company_id,
    triggerKey: row.trigger_key ? dashboardTriggerKey(row.trigger_key) : null,
    scope: {
      type: row.scope_type,
      key: row.scope_key,
    },
    reason,
    notes: row.notes,
    active: row.active === 1,
    sourceRecommendationId: row.source_recommendation_id,
    evidenceFingerprint: row.evidence_fingerprint ?? null,
    metadata: parseRecord(row.metadata_json),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function latestFiringForTrigger(
  db: Database.Database,
  companyId: string,
  triggerKey: string,
): OrchestrationImprovementTriggerFiring | null {
  const row = db
    .prepare(
      `SELECT
         f.*,
         r.title AS recommendation_title,
         s.reason AS suppression_reason
       FROM improvement_trigger_firings f
       LEFT JOIN improvement_recommendations r ON r.id = f.recommendation_id
       LEFT JOIN improvement_suppressions s ON s.id = f.suppression_id
       WHERE f.company_id = ?
         AND f.trigger_key = ?
       ORDER BY f.fired_at DESC, f.created_at DESC
       LIMIT 1`,
    )
    .get(companyId, triggerKey) as Parameters<typeof firingFromRow>[0] | undefined;
  return row ? firingFromRow(row) : null;
}

function getCompanyControlRow(db: Database.Database, companyId: string) {
  return db
    .prepare("SELECT automation_paused, paused_reason, paused_at, updated_at FROM improvement_company_controls WHERE company_id = ?")
    .get(companyId) as { automation_paused: number; paused_reason: string | null; paused_at: string | null; updated_at: string } | undefined;
}

function triggerEnabled(db: Database.Database, companyId: string, triggerKey: string): boolean {
  const row = db
    .prepare("SELECT enabled FROM improvement_trigger_controls WHERE company_id = ? AND trigger_key = ? LIMIT 1")
    .get(companyId, dashboardTriggerKey(triggerKey)) as { enabled: number } | undefined;
  return row ? row.enabled === 1 : true;
}

function activeSuppressionFor(input: {
  db: Database.Database;
  companyId: string;
  triggerKey: string;
  scopeType: ImprovementRecommendationScopeType;
  scopeKey: string;
  now: string;
}): OrchestrationImprovementSuppression | null {
  const row = input.db
    .prepare(
      `SELECT *
       FROM improvement_suppressions
       WHERE company_id = ?
         AND active = 1
         AND (expires_at IS NULL OR expires_at > ?)
         AND (trigger_key IS NULL OR trigger_key = ?)
         AND (
           (scope_type = 'company' AND (scope_key = ? OR scope_key = '*'))
           OR (scope_type = ? AND scope_key = ?)
         )
       ORDER BY
         CASE WHEN trigger_key = ? THEN 0 ELSE 1 END,
         CASE WHEN scope_type = ? AND scope_key = ? THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 1`,
    )
    .get(
      input.companyId,
      input.now,
      dashboardTriggerKey(input.triggerKey),
      input.companyId,
      input.scopeType,
      input.scopeKey,
      dashboardTriggerKey(input.triggerKey),
      input.scopeType,
      input.scopeKey,
    ) as Parameters<typeof suppressionFromRow>[0] | undefined;
  return row ? suppressionFromRow(row) : null;
}

export function getImprovementDashboard(
  companyId: string,
  db = getOrchestrationDb(),
): OrchestrationImprovementDashboard {
  const companyControl = companyControlFromRow(
    companyId,
    getCompanyControlRow(db, companyId),
  );

  const controlRows = db
    .prepare("SELECT trigger_key, enabled, threshold_json, updated_at FROM improvement_trigger_controls WHERE company_id = ?")
    .all(companyId) as Array<{ trigger_key: string; enabled: number; threshold_json: string; updated_at: string }>;
  const controlsByKey = new Map(controlRows.map((row) => [row.trigger_key, row]));
  const triggers: OrchestrationImprovementTriggerControl[] = TRIGGER_DEFINITIONS.map((definition) => {
    const row = controlsByKey.get(definition.triggerKey);
    return {
      companyId,
      triggerKey: definition.triggerKey,
      label: definition.label,
      description: definition.description,
      enabled: row ? row.enabled === 1 : true,
      threshold: parseThreshold(row?.threshold_json, definition.threshold),
      updatedAt: row?.updated_at ?? null,
      latestFiring: latestFiringForTrigger(db, companyId, definition.triggerKey),
    };
  });

  const recommendations = listImproveRecommendations(companyId, {
    includeSuppressed: true,
    limit: 200,
  }, db).recommendations;

  const firings = (db
    .prepare(
      `SELECT
         f.*,
         r.title AS recommendation_title,
         s.reason AS suppression_reason
       FROM improvement_trigger_firings f
       LEFT JOIN improvement_recommendations r ON r.id = f.recommendation_id
       LEFT JOIN improvement_suppressions s ON s.id = f.suppression_id
       WHERE f.company_id = ?
       ORDER BY f.fired_at DESC, f.created_at DESC
       LIMIT 100`,
    )
    .all(companyId) as Array<Parameters<typeof firingFromRow>[0]>)
    .map(firingFromRow);

  const suppressions = (db
    .prepare(
      `SELECT *
       FROM improvement_suppressions
       WHERE company_id = ?
       ORDER BY active DESC, updated_at DESC, created_at DESC
       LIMIT 100`,
    )
    .all(companyId) as Array<Parameters<typeof suppressionFromRow>[0]>)
    .map(suppressionFromRow);

  return {
    companyControl,
    triggers,
    recommendations,
    firings,
    suppressions,
  };
}

export function setCompanyImprovementPause(input: {
  companyId: string;
  paused: boolean;
  reason?: string | null;
}, db = getOrchestrationDb()): OrchestrationImprovementCompanyControl {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO improvement_company_controls (
       company_id, automation_paused, paused_reason, paused_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       automation_paused = excluded.automation_paused,
       paused_reason = excluded.paused_reason,
       paused_at = excluded.paused_at,
       updated_at = excluded.updated_at`,
  ).run(
    input.companyId,
    input.paused ? 1 : 0,
    input.paused ? compact(input.reason) : null,
    input.paused ? now : null,
    now,
  );
  return companyControlFromRow(
    input.companyId,
    getCompanyControlRow(db, input.companyId),
  );
}

export function setImprovementTriggerEnabled(input: {
  companyId: string;
  triggerKey: string;
  enabled: boolean;
  threshold?: Record<string, unknown> | null;
}, db = getOrchestrationDb()): void {
  const triggerKey = dashboardTriggerKey(input.triggerKey);
  const definition = TRIGGER_DEFINITIONS.find((trigger) => trigger.triggerKey === triggerKey);
  db.prepare(
    `INSERT INTO improvement_trigger_controls (
       company_id, trigger_key, enabled, threshold_json, updated_at
     )
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(company_id, trigger_key) DO UPDATE SET
       enabled = excluded.enabled,
       threshold_json = excluded.threshold_json,
       updated_at = excluded.updated_at`,
  ).run(
    input.companyId,
    triggerKey,
    input.enabled ? 1 : 0,
    jsonString(input.threshold ?? definition?.threshold ?? {}),
  );
}

export function createImprovementSuppression(input: {
  companyId: string;
  triggerKey?: string | null;
  scope?: { type: ImprovementRecommendationScopeType; key: string };
  scopeType?: ImprovementRecommendationScopeType;
  scopeKey?: string;
  reason: string;
  notes?: string | null;
  sourceRecommendationId?: string | null;
  expiresAt?: string | null;
  evidenceFingerprint?: string | null;
  metadata?: Record<string, unknown>;
}, db = getOrchestrationDb()): OrchestrationImprovementSuppression {
  const id = randomUUID();
  const now = new Date().toISOString();
  const scopeType = assertScopeType(input.scope?.type ?? input.scopeType ?? "company");
  const scopeKey = requiredText(input.scope?.key ?? input.scopeKey ?? input.companyId, "suppression scope key");
  const reason = SUPPRESSION_REASON_VALUES.has(input.reason) ? input.reason : "operator_suppressed";
  db.prepare(
    `INSERT INTO improvement_suppressions (
       id, company_id, trigger_key, scope_type, scope_key, reason, notes, active,
       source_recommendation_id, evidence_fingerprint, metadata_json, expires_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.companyId,
    input.triggerKey ? dashboardTriggerKey(input.triggerKey) : null,
    scopeType,
    scopeKey,
    reason,
    compact(input.notes),
    compact(input.sourceRecommendationId),
    compact(input.evidenceFingerprint),
    jsonString(input.metadata ?? {}),
    compact(input.expiresAt),
    now,
    now,
  );
  const row = db.prepare("SELECT * FROM improvement_suppressions WHERE id = ?").get(id) as Parameters<typeof suppressionFromRow>[0];
  return suppressionFromRow(row);
}

export function deactivateImprovementSuppression(input: {
  companyId: string;
  suppressionId: string;
}, db = getOrchestrationDb()): void {
  db.prepare(
    `UPDATE improvement_suppressions
     SET active = 0,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ?
       AND company_id = ?`,
  ).run(input.suppressionId, input.companyId);
}

function recordDismissedSuppressionActivity(input: {
  db: Database.Database;
  companyId: string;
  companyCode: string | null;
  recommendation: OrchestrationImprovementRecommendation;
  suppression: OrchestrationImprovementSuppression;
  reason: string;
}): void {
  const suppressionScope = `${input.suppression.scope.type}:${input.suppression.scope.key}`;
  recordRecommendationMutationActivity({
    db: input.db,
    companyId: input.companyId,
    companyCode: input.companyCode,
    recommendation: input.recommendation,
    eventType: "improve.recommendation_dismissed",
    recommendationStatus: "dismissed",
    dismissalCategory: mappedDismissalReason(input.reason),
    reasonCode: input.reason,
    suppressionId: input.suppression.id,
    suppressionScope,
  });
  recordRecommendationMutationActivity({
    db: input.db,
    companyId: input.companyId,
    companyCode: input.companyCode,
    recommendation: input.recommendation,
    eventType: "improve.recommendation_suppressed",
    recommendationStatus: "dismissed",
    suppressionId: input.suppression.id,
    suppressionScope,
    reasonCode: input.suppression.reason,
  });
}

export function dismissImprovementRecommendation(input: {
  companyId: string;
  recommendationId: string;
  reason: string;
  notes?: string | null;
}, db = getOrchestrationDb()): OrchestrationImprovementRecommendation {
  const recommendation = loadRecommendation({
    companyId: input.companyId,
    companyCode: null,
    recommendationId: input.recommendationId,
    db,
  });
  const suppression = createImprovementSuppression({
    companyId: input.companyId,
    triggerKey: recommendation.triggerKey,
    scope: {
      type: recommendation.scopeType ?? recommendation.scope.type,
      key: recommendation.scopeKey ?? recommendation.scope.key,
    },
    reason: input.reason,
    notes: input.notes,
    sourceRecommendationId: recommendation.id,
  }, db);
  setStatus({
    db,
    recommendation,
    status: "dismissed",
    dismissalReason: mappedDismissalReason(input.reason),
    dismissalNotes: compact(input.notes),
    suppressionId: suppression.id,
    currentPatch: {
      dismissalReason: input.reason,
      dismissedAt: new Date().toISOString(),
    },
  });
  recordDismissedSuppressionActivity({
    db,
    companyId: input.companyId,
    companyCode: null,
    recommendation,
    suppression,
    reason: input.reason,
  });
  return loadRecommendation({
    companyId: input.companyId,
    companyCode: null,
    recommendationId: input.recommendationId,
    db,
  });
}

export type CreateImprovementTriggerFiringInput = {
  id?: string;
  companyId: string;
  triggerKey: string;
  triggerClass?: string | null;
  scope?: { type: ImprovementRecommendationScopeType; key: string };
  scopeType?: ImprovementRecommendationScopeType;
  scopeKey?: string;
  status: OrchestrationImprovementTriggerFiring["status"];
  decisionReason?: string | null;
  evidence?: ImproveEvidenceInput[];
  recommendationId?: string | null;
  suppressionId?: string | null;
  sourceTaskId?: string | null;
  sourceRunId?: string | null;
  sourceEvalCaseId?: string | null;
  thresholds?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  firedAt?: string | null;
};

export type ImprovementTriggerFiringRecord = OrchestrationImprovementTriggerFiring & {
  triggerClass: string;
  sourceTaskId: string | null;
  sourceRunId: string | null;
  sourceEvalCaseId: string | null;
  thresholds: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export function createImprovementTriggerFiring(
  input: CreateImprovementTriggerFiringInput,
  db = getOrchestrationDb(),
): ImprovementTriggerFiringRecord {
  assertImprovementWritesEnabled(input.companyId, db);
  const id = input.id ?? randomUUID();
  const now = new Date().toISOString();
  const triggerKey = dashboardTriggerKey(input.triggerKey);
  const scopeType = assertScopeType(input.scope?.type ?? input.scopeType ?? "company");
  const scopeKey = requiredText(input.scope?.key ?? input.scopeKey ?? input.companyId, "trigger firing scope key");
  const firedAt = compact(input.firedAt) ?? now;
  db.prepare(
    `INSERT INTO improvement_trigger_firings (
       id, company_id, trigger_key, scope_type, scope_key, status, decision_reason,
       evidence_json, recommendation_id, suppression_id, fired_at, created_at,
       trigger_class, source_task_id, source_run_id, source_eval_case_id, thresholds_json, metadata_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.companyId,
    triggerKey,
    scopeType,
    scopeKey,
    input.status,
    compact(input.decisionReason) ?? "",
    jsonString(normalizeEvidenceForStorage(input.evidence ?? [])),
    compact(input.recommendationId),
    compact(input.suppressionId),
    firedAt,
    now,
    compact(input.triggerClass) ?? "built_in",
    compact(input.sourceTaskId),
    compact(input.sourceRunId),
    compact(input.sourceEvalCaseId),
    jsonString(input.thresholds ?? {}),
    jsonString(input.metadata ?? {}),
  );
  const row = db
    .prepare("SELECT * FROM improvement_trigger_firings WHERE id = ? LIMIT 1")
    .get(id) as (Parameters<typeof firingFromRow>[0] & {
      trigger_class?: string | null;
      source_task_id?: string | null;
      source_run_id?: string | null;
      source_eval_case_id?: string | null;
      thresholds_json?: string | null;
      metadata_json?: string | null;
    });
  return {
    ...firingFromRow(row),
    triggerClass: compact(row.trigger_class) ?? "built_in",
    sourceTaskId: row.source_task_id ?? null,
    sourceRunId: row.source_run_id ?? null,
    sourceEvalCaseId: row.source_eval_case_id ?? null,
    thresholds: parseRecord(row.thresholds_json),
    metadata: parseRecord(row.metadata_json),
  };
}

export type SuggestImprovementRecommendationInput = {
  companyId: string;
  triggerKey: string;
  triggerClass?: string | null;
  scope?: { type: ImprovementRecommendationScopeType; key: string };
  scopeType?: ImprovementRecommendationScopeType;
  scopeKey?: string;
  title: string;
  rationale?: string;
  proposedChange?: string;
  severity?: ImprovementRecommendationSeverity;
  confidence?: ImprovementRecommendationConfidence;
  evidence?: ImproveEvidenceInput[];
  originalRecommendation?: Record<string, unknown>;
  currentRecommendation?: Record<string, unknown>;
  idempotencyKey?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  sourceTaskId?: string | null;
  sourceRunId?: string | null;
  sourceEvalCaseId?: string | null;
  thresholds?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type SuggestImprovementRecommendationResult = {
  outcome: "created" | "existing" | "needs_more_evidence" | "skipped" | "suppressed" | "writes_disabled";
  reason: string | null;
  recommendation: OrchestrationImprovementRecommendation | null;
  firing: ImprovementTriggerFiringRecord | null;
  suppression: OrchestrationImprovementSuppression | null;
};

export function suggestImprovementRecommendation(
  input: SuggestImprovementRecommendationInput,
  db = getOrchestrationDb(),
): SuggestImprovementRecommendationResult {
  const now = new Date().toISOString();
  const triggerKey = dashboardTriggerKey(input.triggerKey);
  const scopeType = assertScopeType(input.scope?.type ?? input.scopeType ?? "company");
  const scopeKey = requiredText(input.scope?.key ?? input.scopeKey ?? input.companyId, "recommendation scope key");
  const evidence = input.evidence ?? [];

  if (!recommendationWritesEnabled(input.companyId, db)) {
    return {
      outcome: "writes_disabled",
      reason: "writes_disabled",
      recommendation: null,
      firing: null,
      suppression: null,
    };
  }

  const companyControl = companyControlFromRow(input.companyId, getCompanyControlRow(db, input.companyId));

  if (companyControl.automationPaused) {
    const firing = createImprovementTriggerFiring({
      ...input,
      triggerKey,
      scope: { type: scopeType, key: scopeKey },
      status: "skipped",
      decisionReason: companyControl.pausedReason ?? "company_paused",
      evidence,
    }, db);
    return {
      outcome: "skipped",
      reason: "company_paused",
      recommendation: null,
      firing,
      suppression: null,
    };
  }

  if (!triggerEnabled(db, input.companyId, triggerKey)) {
    const firing = createImprovementTriggerFiring({
      ...input,
      triggerKey,
      scope: { type: scopeType, key: scopeKey },
      status: "skipped",
      decisionReason: "trigger_disabled",
      evidence,
    }, db);
    return {
      outcome: "skipped",
      reason: "trigger_disabled",
      recommendation: null,
      firing,
      suppression: null,
    };
  }

  const suppression = activeSuppressionFor({
    db,
    companyId: input.companyId,
    triggerKey,
    scopeType,
    scopeKey,
    now,
  });
  if (suppression) {
    const firing = createImprovementTriggerFiring({
      ...input,
      triggerKey,
      scope: { type: scopeType, key: scopeKey },
      status: "suppressed",
      decisionReason: suppression.reason,
      evidence,
      suppressionId: suppression.id,
    }, db);
    return {
      outcome: "suppressed",
      reason: suppression.reason,
      recommendation: null,
      firing,
      suppression,
    };
  }

  const existing = input.idempotencyKey
    ? (db
        .prepare("SELECT id, status FROM improvement_recommendations WHERE company_id = ? AND idempotency_key = ? LIMIT 1")
        .get(input.companyId, input.idempotencyKey) as { id: string; status: ImprovementRecommendationStatus } | undefined) ?? null
    : null;
  if (existing?.status === "applied") {
    const firing = createImprovementTriggerFiring({
      ...input,
      triggerKey,
      scope: { type: scopeType, key: scopeKey },
      status: "suppressed",
      decisionReason: "already_applied",
      evidence,
      recommendationId: existing.id,
    }, db);
    return {
      outcome: "suppressed",
      reason: "already_applied",
      recommendation: loadRecommendation({
        companyId: input.companyId,
        companyCode: null,
        recommendationId: existing.id,
        db,
      }),
      firing,
      suppression: null,
    };
  }
  const recommendation = createImproveRecommendation({
    companyId: input.companyId,
    triggerKey,
    scopeType,
    scopeKey,
    title: input.title,
    rationale: input.rationale,
    proposedChange: input.proposedChange,
    severity: input.severity,
    confidence: input.confidence,
    evidence,
    originalRecommendation: input.originalRecommendation,
    currentRecommendation: {
      ...(input.currentRecommendation ?? {}),
      triggerClass: compact(input.triggerClass) ?? "built_in",
    },
    idempotencyKey: input.idempotencyKey,
    createdByAgentId: input.createdByAgentId,
    createdByUserId: input.createdByUserId,
  }, db);
  const firingStatus = recommendation.status === "needs-more-evidence" ? "needs_more_evidence" : "created_recommendation";
  const firing = createImprovementTriggerFiring({
    ...input,
    triggerKey,
    scope: { type: scopeType, key: scopeKey },
    status: firingStatus,
    decisionReason: firingStatus === "needs_more_evidence" ? "needs_more_evidence" : "recommendation_created",
    evidence,
    recommendationId: recommendation.id,
  }, db);
  db.prepare(
    `UPDATE improvement_recommendations
     SET source_trigger_firing_id = COALESCE(source_trigger_firing_id, ?),
         trigger_class = COALESCE(NULLIF(trigger_class, 'built_in'), ?),
         updated_at = updated_at
     WHERE id = ?`,
  ).run(
    firing.id,
    compact(input.triggerClass) ?? "built_in",
    recommendation.id,
  );

  return {
    outcome: existing ? "existing" : firingStatus === "needs_more_evidence" ? "needs_more_evidence" : "created",
    reason: firing.decisionReason,
    recommendation,
    firing,
    suppression: null,
  };
}

export function setImprovementRecommendationWritesEnabled(input: {
  companyId: string;
  enabled: boolean;
  reason?: string | null;
}, db = getOrchestrationDb()): {
  companyId: string;
  writesEnabled: boolean;
  disabledReason: string | null;
  disabledAt: string | null;
  updatedAt: string;
} {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO improvement_write_controls (
       company_id, writes_enabled, disabled_reason, disabled_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET
       writes_enabled = excluded.writes_enabled,
       disabled_reason = excluded.disabled_reason,
       disabled_at = excluded.disabled_at,
       updated_at = excluded.updated_at`,
  ).run(
    input.companyId,
    input.enabled ? 1 : 0,
    input.enabled ? null : compact(input.reason),
    input.enabled ? null : now,
    now,
  );
  const row = db
    .prepare("SELECT company_id, writes_enabled, disabled_reason, disabled_at, updated_at FROM improvement_write_controls WHERE company_id = ?")
    .get(input.companyId) as { company_id: string; writes_enabled: number; disabled_reason: string | null; disabled_at: string | null; updated_at: string };
  return {
    companyId: row.company_id,
    writesEnabled: row.writes_enabled === 1,
    disabledReason: row.disabled_reason,
    disabledAt: row.disabled_at,
    updatedAt: row.updated_at,
  };
}

function recommendationWritesEnabled(companyId: string, db: Database.Database): boolean {
  const row = db
    .prepare("SELECT writes_enabled FROM improvement_write_controls WHERE company_id = ?")
    .get(companyId) as { writes_enabled: number } | undefined;
  return row?.writes_enabled !== 0;
}

function assertImprovementWritesEnabled(companyId: string, db: Database.Database): void {
  if (!recommendationWritesEnabled(companyId, db)) {
    throw new OrchestrationApiError(
      409,
      "improvement_writes_disabled",
      "Improvement recommendation writes are disabled for rollback",
    );
  }
}

export function createImprovementEvidenceSet(input: {
  id?: string;
  companyId: string;
  triggerFiringId?: string | null;
  summary?: string;
  evidenceStrength?: "single" | "pattern" | "manual" | "unknown";
  evidenceItems?: ImproveEvidenceInput[];
  redactionSummary?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
}, db = getOrchestrationDb()): {
  id: string;
  companyId: string;
  triggerFiringId: string | null;
  summary: string;
  evidenceStrength: "single" | "pattern" | "manual" | "unknown";
  evidenceItems: JsonRecord[];
  createdAt: string;
} {
  assertImprovementWritesEnabled(input.companyId, db);
  const id = input.id ?? randomUUID();
  assertRedactedEvidencePayload(input.evidenceItems ?? []);
  const evidenceItems = normalizeEvidenceForStorage(input.evidenceItems ?? []);
  db.prepare(
    `INSERT INTO improvement_evidence_sets (
       id, company_id, trigger_firing_id, summary, evidence_strength,
       evidence_items_json, redaction_summary_json, metadata_json,
       created_by_agent_id, created_by_user_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.companyId,
    compact(input.triggerFiringId),
    compact(input.summary) ?? "",
    input.evidenceStrength ?? "pattern",
    jsonString(evidenceItems),
    jsonString(input.redactionSummary ?? {}),
    jsonString(input.metadata ?? {}),
    compact(input.createdByAgentId),
    compact(input.createdByUserId),
  );
  const row = db.prepare("SELECT * FROM improvement_evidence_sets WHERE id = ?").get(id) as {
    id: string;
    company_id: string;
    trigger_firing_id: string | null;
    summary: string;
    evidence_strength: "single" | "pattern" | "manual" | "unknown";
    evidence_items_json: string;
    created_at: string;
  };
  return {
    id: row.id,
    companyId: row.company_id,
    triggerFiringId: row.trigger_firing_id,
    summary: row.summary,
    evidenceStrength: row.evidence_strength,
    evidenceItems: parseArray(row.evidence_items_json),
    createdAt: row.created_at,
  };
}

export type AttachImprovementEvidenceTarget =
  | { kind: "recommendation"; id: string }
  | { kind: "eval_case"; id: string };

export function attachImprovementEvidence(input: {
  companyId: string;
  target: AttachImprovementEvidenceTarget;
  evidence: ImproveEvidenceInput[];
  summary?: string;
  evidenceStrength?: "single" | "pattern" | "manual" | "unknown";
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
}, db = getOrchestrationDb()): {
  evidenceSet: ReturnType<typeof createImprovementEvidenceSet>;
  recommendation: OrchestrationImprovementRecommendation | null;
  target: AttachImprovementEvidenceTarget;
} {
  const targetId = requiredText(input.target.id, "evidence target id");
  const evidence = input.evidence ?? [];
  if (evidence.length === 0) {
    throw new OrchestrationApiError(400, "evidence_required", "At least one evidence item is required");
  }

  if (input.target.kind === "recommendation") {
    const recommendation = loadRecommendation({
      companyId: input.companyId,
      companyCode: null,
      recommendationId: targetId,
      db,
    });
    const existingRow = db
      .prepare("SELECT evidence_json FROM improvement_recommendations WHERE id = ? AND company_id = ? LIMIT 1")
      .get(targetId, input.companyId) as { evidence_json: string } | undefined;
    const existingEvidence = parseArray(existingRow?.evidence_json);
    const evidenceSet = createImprovementEvidenceSet({
      companyId: input.companyId,
      summary: input.summary ?? `Evidence attached to recommendation ${targetId}`,
      evidenceStrength: input.evidenceStrength ?? "manual",
      evidenceItems: evidence,
      metadata: {
        target: input.target,
        source: "mcp_tool",
      },
      createdByAgentId: input.createdByAgentId,
      createdByUserId: input.createdByUserId,
    }, db);
    const nextEvidence = [
      ...existingEvidence,
      ...evidenceSet.evidenceItems,
    ];
    db.prepare(
      `UPDATE improvement_recommendations
       SET evidence_set_id = ?,
           evidence_json = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?
         AND company_id = ?`,
    ).run(evidenceSet.id, jsonString(nextEvidence), recommendation.id, input.companyId);
    return {
      evidenceSet,
      recommendation: loadRecommendation({
        companyId: input.companyId,
        companyCode: null,
        recommendationId: recommendation.id,
        db,
      }),
      target: input.target,
    };
  }

  const evalCase = db
    .prepare("SELECT id FROM eval_cases WHERE id = ? AND company_id = ? LIMIT 1")
    .get(targetId, input.companyId) as { id: string } | undefined;
  if (!evalCase) {
    throw new OrchestrationApiError(404, "eval_case_not_found", "Eval case not found");
  }
  const evidenceSet = createImprovementEvidenceSet({
    companyId: input.companyId,
    summary: input.summary ?? `Evidence attached to eval case ${targetId}`,
    evidenceStrength: input.evidenceStrength ?? "manual",
    evidenceItems: evidence,
    metadata: {
      target: input.target,
      source: "mcp_tool",
    },
    createdByAgentId: input.createdByAgentId,
    createdByUserId: input.createdByUserId,
  }, db);
  return {
    evidenceSet,
    recommendation: null,
    target: input.target,
  };
}

export function createImprovementRecommendation(input: Omit<CreateImproveRecommendationInput, "scopeType" | "scopeKey"> & {
  scopeType?: ImprovementRecommendationScopeType;
  scopeKey?: string;
  triggerClass?: string;
  evidenceSetId?: string | null;
  sourceTriggerFiringId?: string | null;
  originalGeneratedText?: string;
  operatorText?: string;
  affectedSurfaces?: JsonRecord[];
  rollbackNotes?: string;
  proposedChangeJson?: JsonRecord;
}, db = getOrchestrationDb()): {
  outcome: "created" | "existing" | "writes_disabled";
  recommendation: OrchestrationImprovementRecommendation | null;
} {
  const idempotencyKey = compact(input.idempotencyKey);
  if (idempotencyKey) {
    const existing = db
      .prepare("SELECT id FROM improvement_recommendations WHERE company_id = ? AND idempotency_key = ? LIMIT 1")
      .get(input.companyId, idempotencyKey) as { id: string } | undefined;
    if (existing) {
      return {
        outcome: "existing",
        recommendation: loadRecommendation({
          companyId: input.companyId,
          companyCode: null,
          recommendationId: existing.id,
          db,
        }),
      };
    }
  }
  if (!recommendationWritesEnabled(input.companyId, db)) {
    return { outcome: "writes_disabled", recommendation: null };
  }

  const currentRecommendation = {
    ...(input.currentRecommendation ?? {}),
    ...(input.operatorText ? { operatorText: input.operatorText } : {}),
    ...(input.affectedSurfaces ? { affectedSurfaces: input.affectedSurfaces } : {}),
    ...(input.rollbackNotes ? { rollbackNotes: input.rollbackNotes } : {}),
    ...(input.proposedChangeJson ? { proposedChangeJson: input.proposedChangeJson } : {}),
  };
  const recommendation = createImproveRecommendation({
    ...input,
    scopeType: input.scopeType ?? "company",
    scopeKey: input.scopeKey ?? input.companyId,
    currentRecommendation,
    originalRecommendation: {
      ...(input.originalRecommendation ?? {}),
      ...(input.originalGeneratedText ? { originalGeneratedText: input.originalGeneratedText } : {}),
    },
  }, db);
  db.prepare(
    `UPDATE improvement_recommendations
     SET trigger_class = ?,
         source_trigger_firing_id = ?,
         evidence_set_id = ?,
         original_generated_text = ?,
         operator_text = ?,
         proposed_change_summary = ?,
         proposed_change_json = ?,
         affected_surfaces_json = ?,
         rollback_notes = ?
     WHERE id = ?`,
  ).run(
    compact(input.triggerClass) ?? "built_in",
    compact(input.sourceTriggerFiringId),
    compact(input.evidenceSetId),
    compact(input.originalGeneratedText) ?? "",
    compact(input.operatorText) ?? "",
    compact(input.proposedChange) ?? "",
    jsonString(input.proposedChangeJson ?? {}),
    jsonString(input.affectedSurfaces ?? []),
    compact(input.rollbackNotes) ?? "",
    recommendation.id,
  );
  if (input.sourceTriggerFiringId) {
    db.prepare(
      `UPDATE improvement_trigger_firings
       SET recommendation_id = ?,
           status = CASE WHEN status IN ('skipped','needs_more_evidence') THEN 'created_recommendation' ELSE status END
       WHERE id = ?`,
    ).run(recommendation.id, input.sourceTriggerFiringId);
  }
  return {
    outcome: "created",
    recommendation: loadRecommendation({
      companyId: input.companyId,
      companyCode: null,
      recommendationId: recommendation.id,
      db,
    }),
  };
}

export function getImprovementRecommendation(
  recommendationId: string,
  db = getOrchestrationDb(),
): OrchestrationImprovementRecommendation | null {
  const row = db
    .prepare("SELECT company_id FROM improvement_recommendations WHERE id = ? LIMIT 1")
    .get(recommendationId) as { company_id: string } | undefined;
  if (!row) return null;
  return loadRecommendation({
    companyId: row.company_id,
    companyCode: null,
    recommendationId,
    db,
  });
}

export function listImprovementRecommendations(input: {
  companyId: string;
  status?: string;
  limit?: number;
}, db = getOrchestrationDb()): OrchestrationImprovementRecommendation[] {
  const company = db
    .prepare("SELECT id FROM companies WHERE id = ? LIMIT 1")
    .get(input.companyId) as { id: string } | undefined;
  if (!company) return [];
  return listImproveRecommendations(input.companyId, {
    status: input.status ? [assertStatus(input.status.replace(/_/g, "-"))] : undefined,
    includeSuppressed: true,
    limit: input.limit,
  }, db).recommendations;
}

export function updateImprovementRecommendationStatus(input: {
  recommendationId: string;
  status: string;
  dismissalReason?: string | null;
  dismissalNotes?: string | null;
  suppressionId?: string | null;
  supersededByRecommendationId?: string | null;
  approvalId?: string | null;
}, db = getOrchestrationDb()): OrchestrationImprovementRecommendation {
  const existing = getImprovementRecommendation(input.recommendationId, db);
  if (!existing) {
    throw new OrchestrationApiError(404, "improvement_recommendation_not_found", "Improve recommendation not found");
  }
  setStatus({
    db,
    recommendation: existing,
    status: assertStatus(input.status.replace(/_/g, "-")),
    dismissalReason: input.dismissalReason ? mappedDismissalReason(input.dismissalReason) : null,
    dismissalNotes: compact(input.dismissalNotes),
    suppressionId: compact(input.suppressionId),
    supersededByRecommendationId: compact(input.supersededByRecommendationId),
    approvalId: compact(input.approvalId),
  });
  return loadRecommendation({
    companyId: existing.companyId,
    companyCode: null,
    recommendationId: existing.id,
    db,
  });
}

export function linkImprovementRecommendationApproval(input: {
  recommendationId: string;
  approvalId: string;
  status?: "draft" | "submitted" | "approved" | "rejected" | "cancelled" | "applied";
  approvalPackage?: Record<string, unknown>;
  rollbackNotes?: string;
}, db = getOrchestrationDb()): {
  id: string;
  approvalId: string | null;
  recommendationId: string;
  approvalPackage: Record<string, unknown>;
} {
  const recommendation = getImprovementRecommendation(input.recommendationId, db);
  if (!recommendation) {
    throw new OrchestrationApiError(404, "improvement_recommendation_not_found", "Improve recommendation not found");
  }
  assertApprovalExists(db, recommendation.companyId, input.approvalId);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO improvement_recommendation_approval_links (
       id, company_id, recommendation_id, approval_id, status,
       approval_package_json, rollback_notes, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(recommendation_id, approval_id) DO UPDATE SET
       status = excluded.status,
       approval_package_json = excluded.approval_package_json,
       rollback_notes = excluded.rollback_notes,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    recommendation.companyId,
    recommendation.id,
    input.approvalId,
    input.status ?? "submitted",
    jsonString(input.approvalPackage ?? {}),
    compact(input.rollbackNotes) ?? "",
  );
  updateImprovementRecommendationStatus({
    recommendationId: recommendation.id,
    status: "accepted-for-approval",
    approvalId: input.approvalId,
  }, db);
  const row = db
    .prepare(
      `SELECT id, approval_id, recommendation_id, approval_package_json
       FROM improvement_recommendation_approval_links
       WHERE recommendation_id = ? AND approval_id = ?
       LIMIT 1`,
    )
    .get(recommendation.id, input.approvalId) as {
      id: string;
      approval_id: string | null;
      recommendation_id: string;
      approval_package_json: string;
    };
  return {
    id: row.id,
    approvalId: row.approval_id,
    recommendationId: row.recommendation_id,
    approvalPackage: parseRecord(row.approval_package_json),
  };
}
