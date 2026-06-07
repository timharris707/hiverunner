import { createHash, randomUUID } from "crypto";
import type Database from "better-sqlite3";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import { recordTemplateGeneratedWork } from "@/lib/orchestration/template-persistence";
import type {
  RunTraceAnnotationSnapshot,
  RunTraceCaptureQuality,
  RunTraceEvidenceGap,
  RunTraceRedactedExport,
} from "@/lib/orchestration/run-trace";

const RUN_TRACE_REDACTED_EXPORT_SCHEMA = "hiverunner.run_trace_redacted_export.v1";
const RUN_TRACE_REDACTION_POLICY = "hiverunner.run_trace_redaction.v1";

const CREDENTIAL_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/i,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export type EvalCaseReviewOutcome = "accepted" | "returned" | "rejected" | "blocked";

export type CreateEvalCaseInput = {
  id?: string;
  companyId: string;
  projectId?: string | null;
  sourceTask: {
    id: string;
    key: string;
    title: string;
    type?: string | null;
  };
  sourceRun: {
    id: string;
    traceRoute: string;
    executionEngine?: "hiverunner" | "symphony" | "manual" | null;
    runnerProvider?: string | null;
    providerId?: string | null;
    runnerModel?: string | null;
    agentId?: string | null;
    agentName?: string | null;
  };
  sourceSprint?: {
    id?: string | null;
    key?: string | null;
  } | null;
  sourceGoal?: {
    id?: string | null;
    key?: string | null;
  } | null;
  templateContext?: Record<string, unknown> | null;
  sourceTemplateVersionId?: string | null;
  templateIntakeAnswerId?: string | null;
  review: {
    outcome: EvalCaseReviewOutcome;
    rationale: string;
    notes?: string | null;
    reviewerAgentId?: string | null;
    reviewerName?: string | null;
    reviewedAt?: string | null;
  };
  captureQuality: RunTraceCaptureQuality;
  evidenceGaps: RunTraceEvidenceGap[];
  annotationSnapshot?: RunTraceAnnotationSnapshot | null;
  redactedSnapshot: RunTraceRedactedExport;
  version?: number;
  parentEvalCaseId?: string | null;
  idempotencyKey?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  createdAt?: string | null;
};

type EvalCaseRow = {
  id: string;
  company_id: string;
  project_id: string | null;
  source_task_id: string | null;
  source_task_key: string;
  source_task_title: string;
  source_task_type: string | null;
  source_run_id: string;
  trace_route: string;
  source_sprint_id: string | null;
  source_sprint_key: string | null;
  source_goal_id: string | null;
  source_goal_key: string | null;
  template_context_json: string;
  source_template_version_id: string | null;
  template_intake_answer_id: string | null;
  review_outcome: EvalCaseReviewOutcome;
  reviewer_rationale: string;
  reviewer_notes: string | null;
  reviewer_agent_id: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  execution_engine: "hiverunner" | "symphony" | "manual" | null;
  runner_provider: string | null;
  provider_id: string | null;
  runner_model: string | null;
  runner_agent_id: string | null;
  runner_agent_name: string | null;
  capture_quality: RunTraceCaptureQuality;
  evidence_gaps_json: string;
  annotation_snapshot_json: string;
  redacted_snapshot_schema: typeof RUN_TRACE_REDACTED_EXPORT_SCHEMA;
  redaction_policy: string;
  redaction_summary_json: string;
  redacted_snapshot_json: string;
  snapshot_sha256: string;
  version: number;
  parent_eval_case_id: string | null;
  idempotency_key: string | null;
  created_by_agent_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
};

export type EvalCaseRecord = {
  id: string;
  companyId: string;
  projectId: string | null;
  sourceProject: {
    id: string | null;
    slug: string | null;
    name: string | null;
    color: string | null;
  };
  sourceTask: {
    id: string | null;
    key: string;
    title: string;
    type: string | null;
    tags: string[];
  };
  sourceRun: {
    id: string;
    traceRoute: string;
    executionEngine: "hiverunner" | "symphony" | "manual" | null;
    runnerProvider: string | null;
    providerId: string | null;
    runnerModel: string | null;
    agentId: string | null;
    agentName: string | null;
  };
  sourceSprint: {
    id: string | null;
    key: string | null;
  };
  sourceGoal: {
    id: string | null;
    key: string | null;
  };
  templateContext: Record<string, unknown>;
  sourceTemplateVersionId: string | null;
  templateIntakeAnswerId: string | null;
  review: {
    outcome: EvalCaseReviewOutcome;
    rationale: string;
    notes: string | null;
    reviewerAgentId: string | null;
    reviewerName: string | null;
    reviewedAt: string | null;
  };
  captureQuality: RunTraceCaptureQuality;
  evidenceGaps: RunTraceEvidenceGap[];
  annotationSnapshot: RunTraceAnnotationSnapshot;
  redactedSnapshot: RunTraceRedactedExport;
  snapshotSha256: string;
  version: number;
  parentEvalCaseId: string | null;
  idempotencyKey: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
};

export type EvalCaseLibraryFilters = {
  projectId?: string;
  taskType?: string;
  template?: string;
  sourceTemplateVersionId?: string;
  templateIntakeAnswerId?: string;
  agent?: string;
  runner?: string;
  model?: string;
  reviewOutcome?: EvalCaseReviewOutcome;
  tag?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type EvalCaseLibraryFacet = {
  value: string;
  label: string;
  count: number;
};

export type EvalCaseLibraryFacets = {
  projects: EvalCaseLibraryFacet[];
  taskTypes: EvalCaseLibraryFacet[];
  templates: EvalCaseLibraryFacet[];
  agents: EvalCaseLibraryFacet[];
  runners: EvalCaseLibraryFacet[];
  models: EvalCaseLibraryFacet[];
  reviewOutcomes: EvalCaseLibraryFacet[];
  tags: EvalCaseLibraryFacet[];
};

export type EvalCaseLibraryResult = {
  cases: EvalCaseRecord[];
  total: number;
  filters: EvalCaseLibraryFilters;
  facets: EvalCaseLibraryFacets;
};

type EvalCaseLibraryRow = EvalCaseRow & {
  project_slug?: string | null;
  project_name?: string | null;
  project_color?: string | null;
  source_task_tags_json?: string | null;
};

function compactText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function requiredText(value: string | null | undefined, label: string): string {
  const trimmed = compactText(value);
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parsed = parseJson<unknown>(raw, []);
  return Array.isArray(parsed)
    ? parsed.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function snapshotHash(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

function assertRedactedSnapshot(snapshot: RunTraceRedactedExport, serialized: string): void {
  if (snapshot.schema !== RUN_TRACE_REDACTED_EXPORT_SCHEMA) {
    throw new Error("Eval cases must store the redacted Run Trace export schema");
  }
  if (snapshot.redaction?.policy !== RUN_TRACE_REDACTION_POLICY) {
    throw new Error("Eval cases must use the Run Trace redaction policy");
  }
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error("Eval case snapshot contains an unredacted credential-like value");
    }
  }
}

function mapEvalCaseRow(row: EvalCaseRow): EvalCaseRecord {
  const libraryRow = row as EvalCaseLibraryRow;
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    sourceProject: {
      id: row.project_id,
      slug: libraryRow.project_slug ?? null,
      name: libraryRow.project_name ?? null,
      color: libraryRow.project_color ?? null,
    },
    sourceTask: {
      id: row.source_task_id,
      key: row.source_task_key,
      title: row.source_task_title,
      type: row.source_task_type,
      tags: parseStringArray(libraryRow.source_task_tags_json),
    },
    sourceRun: {
      id: row.source_run_id,
      traceRoute: row.trace_route,
      executionEngine: row.execution_engine,
      runnerProvider: row.runner_provider,
      providerId: row.provider_id,
      runnerModel: row.runner_model,
      agentId: row.runner_agent_id,
      agentName: row.runner_agent_name,
    },
    sourceSprint: {
      id: row.source_sprint_id,
      key: row.source_sprint_key,
    },
    sourceGoal: {
      id: row.source_goal_id,
      key: row.source_goal_key,
    },
    templateContext: parseJson<Record<string, unknown>>(row.template_context_json, {}),
    sourceTemplateVersionId: row.source_template_version_id,
    templateIntakeAnswerId: row.template_intake_answer_id,
    review: {
      outcome: row.review_outcome,
      rationale: row.reviewer_rationale,
      notes: row.reviewer_notes,
      reviewerAgentId: row.reviewer_agent_id,
      reviewerName: row.reviewer_name,
      reviewedAt: row.reviewed_at,
    },
    captureQuality: row.capture_quality,
    evidenceGaps: parseJson<RunTraceEvidenceGap[]>(row.evidence_gaps_json, []),
    annotationSnapshot: parseJson<RunTraceAnnotationSnapshot>(
      row.annotation_snapshot_json,
      row.redacted_snapshot_json
        ? (parseJson<RunTraceRedactedExport>(row.redacted_snapshot_json, {} as RunTraceRedactedExport).annotations)
        : ({} as RunTraceAnnotationSnapshot),
    ),
    redactedSnapshot: parseJson<RunTraceRedactedExport>(row.redacted_snapshot_json, {} as RunTraceRedactedExport),
    snapshotSha256: row.snapshot_sha256,
    version: row.version,
    parentEvalCaseId: row.parent_eval_case_id,
    idempotencyKey: row.idempotency_key,
    createdByAgentId: row.created_by_agent_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}

function templateLabelFromContext(context: Record<string, unknown>): { value: string; label: string } | null {
  const candidates = [
    context.templateId,
    context.templateSlug,
    context.templateKey,
    context.template,
    context.templateName,
    context.name,
  ];
  const value = candidates
    .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
    .find(Boolean);
  if (!value) return null;

  const label = [context.templateName, context.name, context.templateLabel]
    .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
    .find(Boolean) ?? value;

  return { value, label };
}

function addFacet(map: Map<string, EvalCaseLibraryFacet>, value: string | null | undefined, label?: string | null): void {
  const normalized = value?.trim();
  if (!normalized) return;
  const existing = map.get(normalized);
  if (existing) {
    existing.count += 1;
    return;
  }
  map.set(normalized, { value: normalized, label: label?.trim() || normalized, count: 1 });
}

function sortFacets(map: Map<string, EvalCaseLibraryFacet>): EvalCaseLibraryFacet[] {
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function buildFacets(cases: EvalCaseRecord[]): EvalCaseLibraryFacets {
  const projects = new Map<string, EvalCaseLibraryFacet>();
  const taskTypes = new Map<string, EvalCaseLibraryFacet>();
  const templates = new Map<string, EvalCaseLibraryFacet>();
  const agents = new Map<string, EvalCaseLibraryFacet>();
  const runners = new Map<string, EvalCaseLibraryFacet>();
  const models = new Map<string, EvalCaseLibraryFacet>();
  const reviewOutcomes = new Map<string, EvalCaseLibraryFacet>();
  const tags = new Map<string, EvalCaseLibraryFacet>();

  for (const item of cases) {
    addFacet(projects, item.sourceProject.id ?? item.projectId, item.sourceProject.name ?? item.sourceProject.slug);
    addFacet(taskTypes, item.sourceTask.type);
    const template = templateLabelFromContext(item.templateContext);
    addFacet(templates, item.sourceTemplateVersionId ?? template?.value, template?.label);
    addFacet(agents, item.sourceRun.agentId ?? item.sourceRun.agentName, item.sourceRun.agentName);
    addFacet(runners, item.sourceRun.runnerProvider ?? item.sourceRun.providerId);
    addFacet(models, item.sourceRun.runnerModel);
    addFacet(reviewOutcomes, item.review.outcome);
    for (const tag of item.sourceTask.tags) addFacet(tags, tag);
  }

  return {
    projects: sortFacets(projects),
    taskTypes: sortFacets(taskTypes),
    templates: sortFacets(templates),
    agents: sortFacets(agents),
    runners: sortFacets(runners),
    models: sortFacets(models),
    reviewOutcomes: sortFacets(reviewOutcomes),
    tags: sortFacets(tags),
  };
}

function getEvalCaseById(db: Database.Database, id: string): EvalCaseRecord | null {
  const row = db
    .prepare("SELECT * FROM eval_cases WHERE id = ? LIMIT 1")
    .get(id) as EvalCaseRow | undefined;
  return row ? mapEvalCaseRow(row) : null;
}

function getEvalCaseByIdempotencyKey(
  db: Database.Database,
  companyId: string,
  idempotencyKey: string,
): EvalCaseRecord | null {
  const row = db
    .prepare("SELECT * FROM eval_cases WHERE company_id = ? AND idempotency_key = ? LIMIT 1")
    .get(companyId, idempotencyKey) as EvalCaseRow | undefined;
  return row ? mapEvalCaseRow(row) : null;
}

export function createEvalCase(
  input: CreateEvalCaseInput,
  db = getOrchestrationDb(),
): EvalCaseRecord {
  const redactedSnapshotJson = jsonString(input.redactedSnapshot);
  assertRedactedSnapshot(input.redactedSnapshot, redactedSnapshotJson);

  const snapshotCaptureQuality = input.redactedSnapshot.captureQuality?.label;
  if (snapshotCaptureQuality && snapshotCaptureQuality !== input.captureQuality) {
    throw new Error("Eval case capture quality must match the redacted Run Trace export");
  }

  const idempotencyKey = compactText(input.idempotencyKey);
  const sha256 = snapshotHash(redactedSnapshotJson);
  if (idempotencyKey) {
    const existing = getEvalCaseByIdempotencyKey(db, input.companyId, idempotencyKey);
    if (existing) {
      if (existing.snapshotSha256 !== sha256) {
        throw new Error("Eval case idempotency key already exists with a different snapshot");
      }
      return existing;
    }
  }

  const id = input.id ?? randomUUID();
  const rationale = requiredText(input.review.rationale, "reviewer rationale");
  const sourceTaskKey = requiredText(input.sourceTask.key, "source task key");
  const sourceTaskTitle = requiredText(input.sourceTask.title, "source task title");
  const sourceRunId = requiredText(input.sourceRun.id, "source run id");
  const traceRoute = requiredText(input.sourceRun.traceRoute, "trace route");
  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("eval case version must be a positive integer");
  }

  const evidenceGapsJson = jsonString(input.evidenceGaps);
  const annotationSnapshot = input.annotationSnapshot ?? input.redactedSnapshot.annotations;
  const annotationSnapshotJson = jsonString(annotationSnapshot);
  const templateContext = {
    ...(input.templateContext ?? {}),
    ...(input.sourceTemplateVersionId ? { sourceTemplateVersionId: input.sourceTemplateVersionId } : {}),
    ...(input.templateIntakeAnswerId ? { templateIntakeAnswerId: input.templateIntakeAnswerId } : {}),
  };
  const templateContextJson = jsonString(templateContext);
  const redactionSummaryJson = jsonString(input.redactedSnapshot.redaction);

  db.prepare(
    `INSERT INTO eval_cases (
       id, company_id, project_id, source_task_id, source_task_key, source_task_title,
       source_task_type, source_run_id, trace_route, source_sprint_id, source_sprint_key,
       source_goal_id, source_goal_key, template_context_json, source_template_version_id,
       template_intake_answer_id, review_outcome,
       reviewer_rationale, reviewer_notes, reviewer_agent_id, reviewer_name, reviewed_at,
       execution_engine, runner_provider, provider_id, runner_model, runner_agent_id,
       runner_agent_name, capture_quality, evidence_gaps_json, annotation_snapshot_json,
       redacted_snapshot_schema, redaction_policy, redaction_summary_json,
       redacted_snapshot_json, snapshot_sha256, version, parent_eval_case_id,
       idempotency_key, created_by_agent_id, created_by_user_id, created_at
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     )`,
  ).run(
    id,
    input.companyId,
    input.projectId ?? null,
    input.sourceTask.id,
    sourceTaskKey,
    sourceTaskTitle,
    compactText(input.sourceTask.type),
    sourceRunId,
    traceRoute,
    compactText(input.sourceSprint?.id),
    compactText(input.sourceSprint?.key),
    compactText(input.sourceGoal?.id),
    compactText(input.sourceGoal?.key),
    templateContextJson,
    compactText(input.sourceTemplateVersionId),
    compactText(input.templateIntakeAnswerId),
    input.review.outcome,
    rationale,
    compactText(input.review.notes),
    compactText(input.review.reviewerAgentId),
    compactText(input.review.reviewerName),
    compactText(input.review.reviewedAt),
    input.sourceRun.executionEngine ?? null,
    compactText(input.sourceRun.runnerProvider),
    compactText(input.sourceRun.providerId),
    compactText(input.sourceRun.runnerModel),
    compactText(input.sourceRun.agentId),
    compactText(input.sourceRun.agentName),
    input.captureQuality,
    evidenceGapsJson,
    annotationSnapshotJson,
    RUN_TRACE_REDACTED_EXPORT_SCHEMA,
    input.redactedSnapshot.redaction?.policy ?? RUN_TRACE_REDACTION_POLICY,
    redactionSummaryJson,
    redactedSnapshotJson,
    sha256,
    version,
    compactText(input.parentEvalCaseId),
    idempotencyKey,
    compactText(input.createdByAgentId),
    compactText(input.createdByUserId),
    compactText(input.createdAt),
  );

  if (input.sourceTemplateVersionId) {
    const existingTaskId = compactText(input.sourceTask.id);
    const existingSprintId = compactText(input.sourceSprint?.id);
    const existingGoalId = compactText(input.sourceGoal?.id);
    const taskId = existingTaskId && db.prepare("SELECT 1 FROM tasks WHERE id = ? LIMIT 1").get(existingTaskId) ? existingTaskId : null;
    const sprintId = existingSprintId && db.prepare("SELECT 1 FROM sprints WHERE id = ? LIMIT 1").get(existingSprintId) ? existingSprintId : null;
    const goalId = existingGoalId && db.prepare("SELECT 1 FROM sprints WHERE id = ? LIMIT 1").get(existingGoalId) ? existingGoalId : null;
    recordTemplateGeneratedWork({
      companyId: input.companyId,
      templateVersionId: input.sourceTemplateVersionId,
      intakeAnswerId: input.templateIntakeAnswerId,
      generatedType: "eval_case",
      generatedId: id,
      evalCaseId: id,
      taskId,
      sprintId,
      goalId,
      provenance: {
        source: "eval_case_capture",
        sourceRunId,
        traceRoute,
        reviewOutcome: input.review.outcome,
      },
    });
  }

  const created = getEvalCaseById(db, id);
  if (!created) {
    throw new Error("Failed to create eval case");
  }
  return created;
}

function evalCaseLibrarySelectSql(): string {
  return `SELECT
      ec.*,
      p.slug AS project_slug,
      p.name AS project_name,
      p.color AS project_color,
      CASE WHEN json_valid(t.labels_json) THEN t.labels_json ELSE '[]' END AS source_task_tags_json
    FROM eval_cases ec
    LEFT JOIN projects p ON p.id = ec.project_id
    LEFT JOIN tasks t ON t.id = ec.source_task_id`;
}

function evalCaseLibraryWhere(filters: EvalCaseLibraryFilters): { whereSql: string; args: unknown[] } {
  const whereParts = ["ec.company_id = ?"];
  const args: unknown[] = [];

  if (filters.projectId) {
    whereParts.push("(ec.project_id = ? OR p.slug = ? OR lower(p.name) = lower(?))");
    args.push(filters.projectId, filters.projectId, filters.projectId);
  }

  if (filters.taskType) {
    whereParts.push("ec.source_task_type = ?");
    args.push(filters.taskType);
  }

  if (filters.template) {
    whereParts.push(`(
      ec.source_template_version_id = ?
      OR ec.template_intake_answer_id = ?
      OR
      lower(COALESCE(
        CAST(json_extract(ec.template_context_json, '$.templateId') AS TEXT),
        CAST(json_extract(ec.template_context_json, '$.sourceTemplateVersionId') AS TEXT),
        CAST(json_extract(ec.template_context_json, '$.templateIntakeAnswerId') AS TEXT),
        CAST(json_extract(ec.template_context_json, '$.templateSlug') AS TEXT),
        CAST(json_extract(ec.template_context_json, '$.templateKey') AS TEXT),
        CAST(json_extract(ec.template_context_json, '$.template') AS TEXT),
        CAST(json_extract(ec.template_context_json, '$.templateName') AS TEXT),
        CAST(json_extract(ec.template_context_json, '$.name') AS TEXT),
        ''
      )) = lower(?)
      OR lower(ec.template_context_json) LIKE '%' || lower(?) || '%'
    )`);
    args.push(filters.template, filters.template, filters.template, filters.template);
  }

  if (filters.sourceTemplateVersionId) {
    whereParts.push(`(
      ec.source_template_version_id = ?
      OR CAST(json_extract(ec.template_context_json, '$.sourceTemplateVersionId') AS TEXT) = ?
      OR CAST(json_extract(ec.template_context_json, '$.templateVersionId') AS TEXT) = ?
    )`);
    args.push(filters.sourceTemplateVersionId, filters.sourceTemplateVersionId, filters.sourceTemplateVersionId);
  }

  if (filters.templateIntakeAnswerId) {
    whereParts.push(`(
      ec.template_intake_answer_id = ?
      OR CAST(json_extract(ec.template_context_json, '$.templateIntakeAnswerId') AS TEXT) = ?
      OR CAST(json_extract(ec.template_context_json, '$.intakeAnswerId') AS TEXT) = ?
    )`);
    args.push(filters.templateIntakeAnswerId, filters.templateIntakeAnswerId, filters.templateIntakeAnswerId);
  }

  if (filters.agent) {
    whereParts.push("(ec.runner_agent_id = ? OR lower(ec.runner_agent_name) = lower(?))");
    args.push(filters.agent, filters.agent);
  }

  if (filters.runner) {
    whereParts.push("(lower(ec.runner_provider) = lower(?) OR lower(ec.provider_id) = lower(?))");
    args.push(filters.runner, filters.runner);
  }

  if (filters.model) {
    whereParts.push("lower(ec.runner_model) = lower(?)");
    args.push(filters.model);
  }

  if (filters.reviewOutcome) {
    whereParts.push("ec.review_outcome = ?");
    args.push(filters.reviewOutcome);
  }

  if (filters.tag) {
    whereParts.push(`EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(t.labels_json) THEN t.labels_json ELSE '[]' END)
      WHERE lower(json_each.value) = lower(?)
    )`);
    args.push(filters.tag);
  }

  if (filters.dateFrom) {
    whereParts.push("ec.created_at >= ?");
    args.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    whereParts.push("ec.created_at <= ?");
    args.push(filters.dateTo);
  }

  return {
    whereSql: whereParts.join(" AND "),
    args,
  };
}

export function listEvalCases(
  companyId: string,
  filters: EvalCaseLibraryFilters = {},
  db = getOrchestrationDb(),
): EvalCaseLibraryResult {
  const limit = typeof filters.limit === "number"
    ? Math.max(1, Math.min(200, Math.trunc(filters.limit)))
    : 100;
  const sanitizedFilters: EvalCaseLibraryFilters = {
    ...filters,
    limit,
  };
  const scopedFilters = evalCaseLibraryWhere(sanitizedFilters);
  const whereSql = scopedFilters.whereSql;
  const args = [companyId, ...scopedFilters.args];
  const total = db
    .prepare(`${evalCaseLibrarySelectSql()} WHERE ${whereSql}`)
    .all(...args).length;
  const rows = db
    .prepare(`${evalCaseLibrarySelectSql()} WHERE ${whereSql} ORDER BY ec.created_at DESC, ec.id ASC LIMIT ?`)
    .all(...args, limit) as EvalCaseLibraryRow[];
  const facetRows = db
    .prepare(`${evalCaseLibrarySelectSql()} WHERE ec.company_id = ? ORDER BY ec.created_at DESC, ec.id ASC LIMIT 1000`)
    .all(companyId) as EvalCaseLibraryRow[];

  return {
    cases: rows.map(mapEvalCaseRow),
    total,
    filters: sanitizedFilters,
    facets: buildFacets(facetRows.map(mapEvalCaseRow)),
  };
}
