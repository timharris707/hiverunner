import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  buildCanonicalCompanyPath,
  buildCanonicalEvalCasePath,
  buildCanonicalImprovePath,
  buildCanonicalTaskRunTracePath,
  buildCanonicalRunTracePath,
} from "@/lib/orchestration/route-paths";
import { recordCompanyAuditEvent } from "@/lib/orchestration/service/audit";

export const IMPROVE_ACTIVITY_EVENT_TYPES = [
  "improve.recommendation_created",
  "improve.recommendation_dismissed",
  "improve.recommendation_suppressed",
  "improve.approval_package_created",
  "improve.approval_decision_synced",
  "improve.recommendation_applied",
] as const;

export type ImproveActivityEventType = typeof IMPROVE_ACTIVITY_EVENT_TYPES[number];

export type ImproveActivitySource = {
  recommendationId: string;
  recommendationStatus?: string | null;
  recommendationType?: string | null;
  category?: string | null;
  severity?: string | null;
  confidence?: number | string | null;
  projectId?: string | null;
  taskId?: string | null;
  taskKey?: string | null;
  agentId?: string | null;
  triggerId?: string | null;
  triggerHistoryId?: string | null;
  evidenceSetId?: string | null;
  evidenceCount?: number | null;
  evalCaseId?: string | null;
  sourceRunId?: string | null;
  suppressionId?: string | null;
  suppressionScope?: string | null;
  dismissalCategory?: string | null;
  reasonCode?: string | null;
  approvalPackageId?: string | null;
  approvalId?: string | null;
  approvalStatus?: string | null;
  approvalDecision?: string | null;
  appliedChangeId?: string | null;
  appliedOutcome?: string | null;
  rollbackNoteId?: string | null;
  correctionNoteId?: string | null;
  summary?: string | null;
};

export type RecordImproveActivityInput = {
  companyId: string;
  companyCode?: string | null;
  eventType: ImproveActivityEventType;
  actorAgentId?: string | null;
  actorUserId?: string | null;
  source: ImproveActivitySource;
};

export type RecordedImproveActivity = {
  auditEventId: string;
  eventType: ImproveActivityEventType;
  metadata: Record<string, unknown>;
};

const MAX_TEXT_LENGTH = 280;

function stringValue(value: unknown, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function boundedCount(value: unknown): number | undefined {
  const count = numberValue(value);
  if (count === undefined) return undefined;
  return Math.max(0, Math.min(Math.trunc(count), 999));
}

function confidenceValue(value: unknown): number | string | undefined {
  const numeric = numberValue(value);
  if (numeric !== undefined) return numeric;
  return stringValue(value, 40);
}

function resolveProjectId(
  db: Database.Database,
  input: { companyId: string; projectId?: string | null; taskId?: string | null },
): string {
  const explicitProjectId = stringValue(input.projectId, 120);
  if (explicitProjectId) {
    const project = db
      .prepare("SELECT id, company_id FROM projects WHERE id = ? AND archived_at IS NULL LIMIT 1")
      .get(explicitProjectId) as { id: string; company_id: string } | undefined;
    if (!project) {
      throw new OrchestrationApiError(404, "project_not_found", "Project not found");
    }
    if (project.company_id !== input.companyId) {
      throw new OrchestrationApiError(400, "project_company_mismatch", "Project does not belong to the company");
    }
    return project.id;
  }

  const taskId = stringValue(input.taskId, 120);
  if (taskId) {
    const task = db
      .prepare(
        `SELECT t.project_id, p.company_id
         FROM tasks t
         INNER JOIN projects p ON p.id = t.project_id
         WHERE t.id = ? AND t.archived_at IS NULL AND p.archived_at IS NULL
         LIMIT 1`,
      )
      .get(taskId) as { project_id: string; company_id: string } | undefined;
    if (!task) {
      throw new OrchestrationApiError(404, "task_not_found", "Task not found");
    }
    if (task.company_id !== input.companyId) {
      throw new OrchestrationApiError(400, "task_company_mismatch", "Task does not belong to the company");
    }
    return task.project_id;
  }

  throw new OrchestrationApiError(
    400,
    "project_required",
    "Improve Activity events require projectId or a linked taskId",
  );
}

function resolveCompanyCode(db: Database.Database, companyId: string, explicitCode?: string | null): string | null {
  const explicit = stringValue(explicitCode, 16);
  if (explicit) return explicit;

  const company = db
    .prepare("SELECT company_code, slug FROM companies WHERE id = ? LIMIT 1")
    .get(companyId) as { company_code: string | null; slug: string | null } | undefined;
  return stringValue(company?.company_code, 16) ?? stringValue(company?.slug, 80) ?? null;
}

function buildSourceLinks(input: {
  companyCode: string | null;
  recommendationId: string;
  approvalId?: string;
  evalCaseId?: string;
  sourceRunId?: string;
  taskKey?: string;
}): Record<string, string> {
  if (!input.companyCode) return {};

  return {
    improve: buildCanonicalImprovePath(input.companyCode, { recommendation: input.recommendationId }),
    ...(input.approvalId ? { approval: buildCanonicalCompanyPath(input.companyCode, `/approvals/${encodeURIComponent(input.approvalId)}`) } : {}),
    ...(input.evalCaseId ? { evalCase: buildCanonicalEvalCasePath(input.companyCode, input.evalCaseId) } : {}),
    ...(input.sourceRunId && input.taskKey
      ? { runTrace: buildCanonicalTaskRunTracePath(input.companyCode, input.taskKey, input.sourceRunId) }
      : input.sourceRunId
        ? { runTrace: buildCanonicalRunTracePath(input.companyCode, input.sourceRunId) }
        : {}),
    ...(input.taskKey ? { task: buildCanonicalCompanyPath(input.companyCode, `/tasks/${encodeURIComponent(input.taskKey)}`) } : {}),
  };
}

function setStringField(
  metadata: Record<string, unknown>,
  key: string,
  value: unknown,
  maxLength = MAX_TEXT_LENGTH,
): string | undefined {
  const normalized = stringValue(value, maxLength);
  if (normalized) metadata[key] = normalized;
  return normalized;
}

function setDefinedField(metadata: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) metadata[key] = value;
}

function buildImproveActivityMetadata(
  input: RecordImproveActivityInput,
  db: Database.Database = getOrchestrationDb(),
): Record<string, unknown> {
  const recommendationId = stringValue(input.source.recommendationId, 120);
  if (!recommendationId) {
    throw new OrchestrationApiError(400, "recommendation_required", "Improve Activity events require recommendationId");
  }

  const projectId = resolveProjectId(db, {
    companyId: input.companyId,
    projectId: input.source.projectId,
    taskId: input.source.taskId,
  });
  const companyCode = resolveCompanyCode(db, input.companyId, input.companyCode);
  const approvalId = stringValue(input.source.approvalId, 120);
  const evalCaseId = stringValue(input.source.evalCaseId, 120);
  const sourceRunId = stringValue(input.source.sourceRunId, 120);
  const taskKey = stringValue(input.source.taskKey, 80);

  const metadata: Record<string, unknown> = {
    schema: "hiverunner.improve_activity.v1",
    kind: input.eventType,
    projectId,
    recommendationId,
  };

  const source = input.source;
  setStringField(metadata, "recommendationStatus", source.recommendationStatus, 80);
  setStringField(metadata, "recommendationType", source.recommendationType, 80);
  setStringField(metadata, "category", source.category, 80);
  setStringField(metadata, "severity", source.severity, 40);
  setDefinedField(metadata, "confidence", confidenceValue(source.confidence));
  setStringField(metadata, "taskId", source.taskId, 120);
  setStringField(metadata, "taskKey", taskKey, 80);
  setStringField(metadata, "agentId", source.agentId, 120);
  setStringField(metadata, "actorAgentId", input.actorAgentId, 120);
  setStringField(metadata, "triggerId", source.triggerId, 120);
  setStringField(metadata, "triggerHistoryId", source.triggerHistoryId, 120);
  setStringField(metadata, "evidenceSetId", source.evidenceSetId, 120);
  setDefinedField(metadata, "evidenceCount", boundedCount(source.evidenceCount));
  setStringField(metadata, "evalCaseId", evalCaseId, 120);
  setStringField(metadata, "sourceRunId", sourceRunId, 120);
  setStringField(metadata, "suppressionId", source.suppressionId, 120);
  setStringField(metadata, "suppressionScope", source.suppressionScope, 80);
  setStringField(metadata, "dismissalCategory", source.dismissalCategory, 80);
  setStringField(metadata, "reasonCode", source.reasonCode, 80);
  setStringField(metadata, "approvalPackageId", source.approvalPackageId, 120);
  setStringField(metadata, "approvalId", approvalId, 120);
  setStringField(metadata, "approvalStatus", source.approvalStatus, 80);
  setStringField(metadata, "approvalDecision", source.approvalDecision, 80);
  setStringField(metadata, "appliedChangeId", source.appliedChangeId, 120);
  setStringField(metadata, "appliedOutcome", source.appliedOutcome, 80);
  setStringField(metadata, "rollbackNoteId", source.rollbackNoteId, 120);
  setStringField(metadata, "correctionNoteId", source.correctionNoteId, 120);
  setStringField(metadata, "summary", source.summary);
  metadata.sourceLinks = buildSourceLinks({
    companyCode,
    recommendationId,
    approvalId,
    evalCaseId,
    sourceRunId,
    taskKey,
  });

  return metadata;
}

export function recordImproveActivity(
  input: RecordImproveActivityInput,
  db: Database.Database = getOrchestrationDb(),
): RecordedImproveActivity {
  const metadata = buildImproveActivityMetadata(input, db);
  const taskId = stringValue(input.source.taskId, 120) ?? null;
  const approvalId = stringValue(input.source.approvalId, 120) ?? null;
  const agentId =
    stringValue(input.actorAgentId, 120) ??
    stringValue(input.source.agentId, 120) ??
    null;

  const auditEventId = recordCompanyAuditEvent({
    companyId: input.companyId,
    eventType: input.eventType,
    agentId,
    taskId,
    approvalId,
    actorUserId: input.actorUserId ?? null,
    metadata,
  }, db);

  return {
    auditEventId,
    eventType: input.eventType,
    metadata,
  };
}
