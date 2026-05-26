import { randomUUID } from "node:crypto";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";

export type CompanyMemoryKind =
  | "fact"
  | "decision"
  | "preference"
  | "architecture"
  | "domain_constraint"
  | "workflow_note"
  | "skill_evidence";

export type CompanyMemoryScope = "company" | "project" | "agent";
export type CompanyMemoryStatus = "draft" | "active" | "rejected" | "archived";
export type CompanyMemorySource = "manual" | "task" | "run" | "extractor" | "imported";
export type CompanyMemoryReviewState = "not_requested" | "requested" | "approved" | "rejected";

export type CompanyMemoryRecord = {
  id: string;
  companyId: string;
  companySlug: string;
  companyName: string;
  projectId: string | null;
  projectName: string | null;
  agentId: string | null;
  agentName: string | null;
  taskId: string | null;
  taskKey: string | null;
  executionRunId: string | null;
  slug: string;
  title: string;
  body: string;
  kind: CompanyMemoryKind;
  scope: CompanyMemoryScope;
  status: CompanyMemoryStatus;
  source: CompanyMemorySource;
  confidence: number;
  reviewRequired: boolean;
  reviewState: CompanyMemoryReviewState;
  reviewedByAgentId: string | null;
  reviewedByAgentName: string | null;
  reviewedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type CompanyMemoryRecordRow = {
  id: string;
  company_id: string;
  company_slug: string;
  company_name: string;
  project_id: string | null;
  project_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  task_id: string | null;
  task_key: string | null;
  execution_run_id: string | null;
  slug: string;
  title: string;
  body: string;
  kind: CompanyMemoryKind;
  scope: CompanyMemoryScope;
  status: CompanyMemoryStatus;
  source: CompanyMemorySource;
  confidence: number;
  review_required: 0 | 1;
  review_state: CompanyMemoryReviewState;
  reviewed_by_agent_id: string | null;
  reviewed_by_agent_name: string | null;
  reviewed_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type CompanyRef = { id: string; slug: string; name: string };

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "memory";
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function serializeMetadata(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {});
}

function assertChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T, field: string): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new OrchestrationApiError(400, `invalid_${field}`, `${field} must be one of: ${allowed.join(", ")}`);
}

function assertConfidence(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new OrchestrationApiError(400, "invalid_confidence", "confidence must be a number from 0 to 1");
  }
  return parsed;
}

function resolveCompany(companyIdOrSlug: string): CompanyRef {
  const needle = companyIdOrSlug.trim();
  const row = getOrchestrationDb()
    .prepare("SELECT id, slug, name FROM companies WHERE id = ? OR slug = ? OR UPPER(company_code) = UPPER(?) LIMIT 1")
    .get(needle, needle, needle) as CompanyRef | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return row;
}

function resolveCompanyProject(companyId: string, projectIdOrSlugOrName: string | null | undefined): { id: string } | null {
  if (!projectIdOrSlugOrName?.trim()) return null;
  const needle = projectIdOrSlugOrName.trim();
  const row = getOrchestrationDb()
    .prepare("SELECT id FROM projects WHERE company_id = ? AND (id = ? OR slug = ? OR name = ?) LIMIT 1")
    .get(companyId, needle, needle, needle) as { id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "project_not_found", "Project not found");
  }
  return row;
}

function resolveCompanyAgent(companyId: string, agentIdOrSlugOrName: string | null | undefined): { id: string } | null {
  if (!agentIdOrSlugOrName?.trim()) return null;
  const needle = agentIdOrSlugOrName.trim();
  const row = getOrchestrationDb()
    .prepare("SELECT id FROM agents WHERE company_id = ? AND archived_at IS NULL AND (id = ? OR slug = ? OR name = ?) LIMIT 1")
    .get(companyId, needle, needle, needle) as { id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "agent_not_found", "Agent not found");
  }
  return row;
}

function resolveCompanyTask(companyId: string, taskIdOrKey: string | null | undefined): { id: string } | null {
  if (!taskIdOrKey?.trim()) return null;
  const needle = taskIdOrKey.trim();
  const row = getOrchestrationDb()
    .prepare(
      `SELECT t.id
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE p.company_id = ?
         AND t.archived_at IS NULL
         AND (t.id = ? OR t.task_key = ?)
       LIMIT 1`,
    )
    .get(companyId, needle, needle) as { id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "task_not_found", "Task not found");
  }
  return row;
}

function uniqueMemorySlug(companyId: string, baseSlug: string): string {
  const db = getOrchestrationDb();
  const existing = db
    .prepare("SELECT slug FROM company_memory_records WHERE company_id = ? AND slug LIKE ?")
    .all(companyId, `${baseSlug}%`) as Array<{ slug: string }>;
  if (!existing.some((row) => row.slug === baseSlug)) return baseSlug;
  const used = new Set(existing.map((row) => row.slug));
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${baseSlug}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${baseSlug}-${randomUUID().slice(0, 8)}`;
}

function memorySelectSql(): string {
  return `
    SELECT
      cmr.id,
      cmr.company_id,
      c.slug AS company_slug,
      c.name AS company_name,
      cmr.project_id,
      p.name AS project_name,
      cmr.agent_id,
      ag.name AS agent_name,
      cmr.task_id,
      t.task_key,
      cmr.execution_run_id,
      cmr.slug,
      cmr.title,
      cmr.body,
      cmr.kind,
      cmr.scope,
      cmr.status,
      cmr.source,
      cmr.confidence,
      cmr.review_required,
      cmr.review_state,
      cmr.reviewed_by_agent_id,
      reviewer.name AS reviewed_by_agent_name,
      cmr.reviewed_at,
      cmr.metadata_json,
      cmr.created_at,
      cmr.updated_at,
      cmr.archived_at
    FROM company_memory_records cmr
    JOIN companies c ON c.id = cmr.company_id
    LEFT JOIN projects p ON p.id = cmr.project_id
    LEFT JOIN agents ag ON ag.id = cmr.agent_id
    LEFT JOIN agents reviewer ON reviewer.id = cmr.reviewed_by_agent_id
    LEFT JOIN tasks t ON t.id = cmr.task_id
  `;
}

function mapMemory(row: CompanyMemoryRecordRow): CompanyMemoryRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    companySlug: row.company_slug,
    companyName: row.company_name,
    projectId: row.project_id,
    projectName: row.project_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    taskId: row.task_id,
    taskKey: row.task_key,
    executionRunId: row.execution_run_id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    kind: row.kind,
    scope: row.scope,
    status: row.status,
    source: row.source,
    confidence: Number(row.confidence),
    reviewRequired: row.review_required === 1,
    reviewState: row.review_state,
    reviewedByAgentId: row.reviewed_by_agent_id,
    reviewedByAgentName: row.reviewed_by_agent_name,
    reviewedAt: row.reviewed_at,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export function listCompanyMemoryRecords(companyIdOrSlug: string, input?: {
  status?: CompanyMemoryStatus | "all";
  kind?: CompanyMemoryKind;
  scope?: CompanyMemoryScope;
  projectId?: string;
  agentId?: string;
  includeArchived?: boolean;
}): { company: CompanyRef; memories: CompanyMemoryRecord[] } {
  const company = resolveCompany(companyIdOrSlug);
  const where = ["cmr.company_id = ?"];
  const params: unknown[] = [company.id];

  if (!input?.includeArchived && input?.status !== "archived" && input?.status !== "all") {
    where.push("cmr.archived_at IS NULL");
  }
  if (input?.status && input.status !== "all") {
    where.push("cmr.status = ?");
    params.push(input.status);
  }
  if (input?.kind) {
    where.push("cmr.kind = ?");
    params.push(input.kind);
  }
  if (input?.scope) {
    where.push("cmr.scope = ?");
    params.push(input.scope);
  }
  if (input?.projectId) {
    const project = resolveCompanyProject(company.id, input.projectId);
    where.push("cmr.project_id = ?");
    params.push(project?.id ?? "");
  }
  if (input?.agentId) {
    const agent = resolveCompanyAgent(company.id, input.agentId);
    where.push("cmr.agent_id = ?");
    params.push(agent?.id ?? "");
  }

  const rows = getOrchestrationDb()
    .prepare(
      `${memorySelectSql()}
       WHERE ${where.join(" AND ")}
       ORDER BY
         CASE cmr.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
         cmr.updated_at DESC`,
    )
    .all(...params) as CompanyMemoryRecordRow[];

  return { company, memories: rows.map(mapMemory) };
}

export function createCompanyMemoryRecord(companyIdOrSlug: string, input: {
  title: string;
  body?: string;
  slug?: string;
  kind?: CompanyMemoryKind;
  scope?: CompanyMemoryScope;
  status?: CompanyMemoryStatus;
  source?: CompanyMemorySource;
  confidence?: number;
  projectId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  executionRunId?: string | null;
  reviewRequired?: boolean;
  reviewState?: CompanyMemoryReviewState;
  reviewedByAgentId?: string | null;
  metadata?: Record<string, unknown>;
}): { company: CompanyRef; memory: CompanyMemoryRecord } {
  const company = resolveCompany(companyIdOrSlug);
  const title = input.title.trim();
  if (!title) {
    throw new OrchestrationApiError(400, "missing_title", "Memory title is required");
  }

  const status = assertChoice(input.status, ["draft", "active", "rejected", "archived"], "draft", "status");
  const reviewRequired = input.reviewRequired ?? true;
  const reviewState = assertChoice(
    input.reviewState,
    ["not_requested", "requested", "approved", "rejected"],
    "not_requested",
    "review_state",
  );
  if (status === "active" && reviewRequired && reviewState !== "approved") {
    throw new OrchestrationApiError(400, "memory_review_required", "Memory must be approved before it can become active");
  }

  const project = resolveCompanyProject(company.id, input.projectId);
  const agent = resolveCompanyAgent(company.id, input.agentId);
  const task = resolveCompanyTask(company.id, input.taskId);
  const reviewedBy = resolveCompanyAgent(company.id, input.reviewedByAgentId);
  const now = new Date().toISOString();
  const slug = uniqueMemorySlug(company.id, normalizeSlug(input.slug?.trim() || title));
  const id = randomUUID();

  getOrchestrationDb()
    .prepare(
      `INSERT INTO company_memory_records (
         id, company_id, project_id, agent_id, task_id, execution_run_id, slug,
         title, body, kind, scope, status, source, confidence,
         review_required, review_state, reviewed_by_agent_id, reviewed_at,
         metadata_json, created_at, updated_at, archived_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      company.id,
      project?.id ?? null,
      agent?.id ?? null,
      task?.id ?? null,
      input.executionRunId?.trim() || null,
      slug,
      title,
      input.body?.trim() ?? "",
      assertChoice(input.kind, ["fact", "decision", "preference", "architecture", "domain_constraint", "workflow_note", "skill_evidence"], "fact", "kind"),
      assertChoice(input.scope, ["company", "project", "agent"], "company", "scope"),
      status,
      assertChoice(input.source, ["manual", "task", "run", "extractor", "imported"], "manual", "source"),
      assertConfidence(input.confidence, 0.5),
      reviewRequired ? 1 : 0,
      reviewState,
      reviewedBy?.id ?? null,
      reviewedBy ? now : null,
      serializeMetadata(input.metadata),
      now,
      now,
      status === "archived" ? now : null,
    );

  return { company, memory: getCompanyMemoryRecord(company.id, id) };
}

export function updateCompanyMemoryRecord(companyIdOrSlug: string, memoryIdOrSlug: string, input: {
  title?: string;
  body?: string;
  kind?: CompanyMemoryKind;
  scope?: CompanyMemoryScope;
  status?: CompanyMemoryStatus;
  source?: CompanyMemorySource;
  confidence?: number;
  projectId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  executionRunId?: string | null;
  reviewRequired?: boolean;
  reviewState?: CompanyMemoryReviewState;
  reviewedByAgentId?: string | null;
  metadata?: Record<string, unknown>;
}): { company: CompanyRef; memory: CompanyMemoryRecord } {
  const company = resolveCompany(companyIdOrSlug);
  const current = getCompanyMemoryRecord(company.id, memoryIdOrSlug);
  const nextStatus = assertChoice(input.status, ["draft", "active", "rejected", "archived"], current.status, "status");
  const nextReviewRequired = input.reviewRequired ?? current.reviewRequired;
  const nextReviewState = assertChoice(
    input.reviewState,
    ["not_requested", "requested", "approved", "rejected"],
    current.reviewState,
    "review_state",
  );
  if (nextStatus === "active" && nextReviewRequired && nextReviewState !== "approved") {
    throw new OrchestrationApiError(400, "memory_review_required", "Memory must be approved before it can become active");
  }

  const nextTitle = input.title === undefined ? current.title : input.title.trim();
  if (!nextTitle) {
    throw new OrchestrationApiError(400, "missing_title", "Memory title is required");
  }

  const project = input.projectId === undefined
    ? { id: current.projectId }
    : resolveCompanyProject(company.id, input.projectId);
  const agent = input.agentId === undefined
    ? { id: current.agentId }
    : resolveCompanyAgent(company.id, input.agentId);
  const task = input.taskId === undefined
    ? { id: current.taskId }
    : resolveCompanyTask(company.id, input.taskId);
  const reviewedBy = input.reviewedByAgentId === undefined
    ? { id: current.reviewedByAgentId }
    : resolveCompanyAgent(company.id, input.reviewedByAgentId);
  const now = new Date().toISOString();
  const archivedAt = nextStatus === "archived"
    ? current.archivedAt ?? now
    : null;
  const reviewedAt = input.reviewedByAgentId !== undefined && reviewedBy?.id
    ? now
    : current.reviewedAt;

  getOrchestrationDb()
    .prepare(
      `UPDATE company_memory_records
       SET title = ?,
           body = ?,
           kind = ?,
           scope = ?,
           status = ?,
           source = ?,
           confidence = ?,
           project_id = ?,
           agent_id = ?,
           task_id = ?,
           execution_run_id = ?,
           review_required = ?,
           review_state = ?,
           reviewed_by_agent_id = ?,
           reviewed_at = ?,
           metadata_json = ?,
           archived_at = ?,
           updated_at = ?
       WHERE company_id = ?
         AND id = ?`,
    )
    .run(
      nextTitle,
      input.body === undefined ? current.body : input.body.trim(),
      assertChoice(input.kind, ["fact", "decision", "preference", "architecture", "domain_constraint", "workflow_note", "skill_evidence"], current.kind, "kind"),
      assertChoice(input.scope, ["company", "project", "agent"], current.scope, "scope"),
      nextStatus,
      assertChoice(input.source, ["manual", "task", "run", "extractor", "imported"], current.source, "source"),
      assertConfidence(input.confidence, current.confidence),
      project?.id ?? null,
      agent?.id ?? null,
      task?.id ?? null,
      input.executionRunId === undefined ? current.executionRunId : input.executionRunId?.trim() || null,
      nextReviewRequired ? 1 : 0,
      nextReviewState,
      reviewedBy?.id ?? null,
      reviewedAt,
      input.metadata === undefined ? JSON.stringify(current.metadata) : serializeMetadata(input.metadata),
      archivedAt,
      now,
      company.id,
      current.id,
    );

  return { company, memory: getCompanyMemoryRecord(company.id, current.id) };
}

function getCompanyMemoryRecord(companyId: string, memoryIdOrSlug: string): CompanyMemoryRecord {
  const needle = memoryIdOrSlug.trim();
  const row = getOrchestrationDb()
    .prepare(
      `${memorySelectSql()}
       WHERE cmr.company_id = ?
         AND (cmr.id = ? OR cmr.slug = ?)
       LIMIT 1`,
    )
    .get(companyId, needle, needle) as CompanyMemoryRecordRow | undefined;

  if (!row) {
    throw new OrchestrationApiError(404, "memory_not_found", "Company memory record not found");
  }

  return mapMemory(row);
}
