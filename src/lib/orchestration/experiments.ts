import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { resolveCompanyIdBySlug } from "@/lib/orchestration/company-resolver";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import {
  defaultExperimentLaunchLimits,
  type ExperimentLaunchObjectiveKey,
  type ExperimentLaunchSourceKind,
  type ExperimentWorkspaceModeKey,
} from "@/lib/orchestration/experiment-launch";
import {
  EXPERIMENT_COMPARISON_REPORT_SCHEMA,
  getExperimentComparisonReport,
} from "@/lib/orchestration/experiment-reports";
import {
  createImproveRecommendation,
  getImproveRecommendation,
  type ImproveEvidenceInput,
} from "@/lib/orchestration/improvement-recommendations";
import {
  assertNoRunTraceCredentialLeak,
  redactRunTracePayload,
} from "@/lib/orchestration/run-trace";
import type {
  ImprovementRecommendationConfidence,
  ImprovementRecommendationScopeType,
  ImprovementRecommendationSeverity,
  OrchestrationExperimentReportEvidence,
  OrchestrationExperimentReportStatus,
  OrchestrationImprovementRecommendation,
} from "@/lib/orchestration/types";

const EXPERIMENT_SOURCE_SNAPSHOT_SCHEMA = "hiverunner.experiment_source_snapshot.v1" as const;
const EXPERIMENT_LIMIT_SNAPSHOT_SCHEMA = "hiverunner.experiment_limits.v1" as const;
const EXPERIMENT_WORKSPACE_SELECTION_SCHEMA = "hiverunner.experiment_workspace_selection.v1" as const;

export type ExperimentLifecycleStatus =
  | "draft"
  | "awaiting_variant_approval"
  | "approved"
  | "running"
  | "reporting"
  | "completed"
  | "cancelled"
  | "failed"
  | "archived";

export type ExperimentVariantStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export type ExperimentVariantChangeType =
  | "runner_model"
  | "agent"
  | "prompt"
  | "tool_setup"
  | "task_decomposition"
  | "template_slot"
  | "context_package"
  | "other";

export type ExperimentAttemptStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export type ExperimentLimits = {
  variantCap: number;
  attemptLimit: number;
  timeboxMinutes: number;
};

export type ExperimentSourceInput = {
  kind: ExperimentLaunchSourceKind;
  id: string;
};

export type ExperimentVariantInput = {
  id?: string;
  key?: string;
  name: string;
  description?: string | null;
  changeType?: ExperimentVariantChangeType;
  plannedChange?: Record<string, unknown> | null;
  proposedByAgentId?: string | null;
  proposedByUserId?: string | null;
};

export type CreateExperimentDraftInput = {
  id?: string;
  companyIdOrSlug: string;
  source: ExperimentSourceInput;
  objective: ExperimentLaunchObjectiveKey;
  definitionOfBetter?: string | null;
  hypothesis?: string | null;
  workspaceMode?: ExperimentWorkspaceModeKey | null;
  liveWorkspaceConfirmed?: boolean;
  liveWorkspaceReason?: string | null;
  limits?: Partial<ExperimentLimits> | null;
  variants?: ExperimentVariantInput[];
  idempotencyKey?: string | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
};

export type ApproveExperimentVariantsInput = {
  companyIdOrSlug: string;
  experimentId: string;
  variantIds?: string[];
  variantKeys?: string[];
  approvedByAgentId?: string | null;
  approvedByUserId?: string | null;
  liveWorkspaceConfirmed?: boolean;
  liveWorkspaceReason?: string | null;
};

export type RecordExperimentAttemptInput = {
  companyIdOrSlug: string;
  experimentId: string;
  variantId?: string | null;
  variantKey?: string | null;
  attemptNumber: number;
  status: ExperimentAttemptStatus;
  workspaceMode?: ExperimentWorkspaceModeKey | null;
  workspaceRef?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  comparisonSnapshot?: Record<string, unknown> | null;
  executionRunId?: string | null;
  evalCaseId?: string | null;
  traceRoute?: string | null;
  errorMessage?: string | null;
  liveWorkspaceConfirmed?: boolean;
  liveWorkspaceReason?: string | null;
};

export type SaveExperimentReportInput = {
  id?: string;
  companyIdOrSlug: string;
  experimentId: string;
  status?: OrchestrationExperimentReportStatus;
  summary?: string | null;
  report: Record<string, unknown>;
  conclusion?: Record<string, unknown> | null;
  winningVariantId?: string | null;
  winningVariantKey?: string | null;
  recommendationId?: string | null;
  generatedByAgentId?: string | null;
  generatedByUserId?: string | null;
};

export type ExperimentListFilters = {
  status?: ExperimentLifecycleStatus[];
  sourceKind?: ExperimentLaunchSourceKind;
  sourceRunId?: string;
  sourceEvalCaseId?: string;
  sourceTaskId?: string;
  limit?: number;
};

export type ExperimentVariantRecord = {
  id: string;
  experimentId: string;
  key: string;
  name: string;
  description: string;
  changeType: ExperimentVariantChangeType;
  plannedChange: Record<string, unknown>;
  status: ExperimentVariantStatus;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentAttemptRecord = {
  id: string;
  experimentId: string;
  variantId: string;
  attemptNumber: number;
  status: ExperimentAttemptStatus;
  workspaceMode: ExperimentWorkspaceModeKey;
  workspaceRef: string | null;
  executionRunId: string | null;
  evalCaseId: string | null;
  traceRoute: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExperimentRecord = {
  id: string;
  companyId: string;
  projectId: string | null;
  sourceKind: "run_trace" | "eval_case" | "mixed";
  primarySourceRunId: string | null;
  primarySourceEvalCaseId: string | null;
  sourceTaskId: string | null;
  sourceTraceRoute: string | null;
  objective: string;
  objectiveKind: string;
  definitionOfBetter: string;
  hypothesis: string;
  workspaceMode: ExperimentWorkspaceModeKey;
  limits: ExperimentLimits;
  status: ExperimentLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  variants: ExperimentVariantRecord[];
  attempts: ExperimentAttemptRecord[];
  reports: OrchestrationExperimentReportEvidence[];
};

type ExperimentRow = {
  id: string;
  company_id: string;
  project_id: string | null;
  source_kind: "run_trace" | "eval_case" | "mixed";
  primary_source_run_id: string | null;
  primary_source_eval_case_id: string | null;
  source_task_id: string | null;
  source_trace_route: string | null;
  objective: string;
  objective_kind: string;
  definition_of_better: string;
  hypothesis: string;
  workspace_mode: ExperimentWorkspaceModeKey;
  workspace_snapshot_json: string;
  limit_snapshot_json: string;
  status: ExperimentLifecycleStatus;
  approved_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
};

type VariantRow = {
  id: string;
  experiment_id: string;
  variant_key: string;
  name: string;
  description: string;
  change_type: ExperimentVariantChangeType;
  planned_change_json: string;
  status: ExperimentVariantStatus;
  created_at: string;
  updated_at: string;
};

type AttemptRow = {
  id: string;
  experiment_id: string;
  variant_id: string;
  attempt_number: number;
  status: ExperimentAttemptStatus;
  workspace_mode: ExperimentWorkspaceModeKey;
  workspace_ref: string | null;
  execution_run_id: string | null;
  eval_case_id: string | null;
  trace_route: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

type ResolvedSource = {
  kind: ExperimentLaunchSourceKind;
  projectId: string | null;
  sourceRunId: string | null;
  sourceEvalCaseId: string | null;
  sourceTaskId: string | null;
  traceRoute: string | null;
  snapshot: Record<string, unknown>;
  snapshotSha256: string;
  redactionSummary: Record<string, unknown>;
};

const OBJECTIVE_TO_KIND: Record<ExperimentLaunchObjectiveKey, string> = {
  reduce_review_returns: "better_reviewer_acceptance",
  improve_acceptance: "better_reviewer_acceptance",
  reduce_cost: "lower_token_cost",
  shorten_runtime: "shorter_runtime",
};

const OBJECTIVE_KEYS = new Set<ExperimentLaunchObjectiveKey>([
  "reduce_review_returns",
  "improve_acceptance",
  "reduce_cost",
  "shorten_runtime",
]);

const WORKSPACE_MODES = new Set<ExperimentWorkspaceModeKey>(["snapshot", "branch", "live"]);
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "completed", "failed", "cancelled", "timed_out"]);
const REVIEWED_TASK_STATUSES = new Set(["review", "done", "blocked"]);
const TERMINAL_ATTEMPT_STATUSES = new Set<ExperimentAttemptStatus>(["succeeded", "failed", "cancelled", "timed_out"]);
const ATTEMPT_RUNNABLE_VARIANT_STATUSES = new Set<ExperimentVariantStatus>(["approved", "running", "completed", "failed"]);
const ALLOWED_ATTEMPT_TRANSITIONS: Record<ExperimentAttemptStatus, ExperimentAttemptStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled", "timed_out"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

function compactText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  const source = raw?.trim();
  if (!source) return fallback;
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function redactedJson(value: unknown, label: string): { value: Record<string, unknown>; redaction: Record<string, unknown>; serialized: string; sha256: string } {
  const redacted = redactRunTracePayload(value);
  assertNoRunTraceCredentialLeak(redacted.value, label);
  const serialized = jsonString(redacted.value);
  return {
    value: redacted.value as Record<string, unknown>,
    redaction: redacted.redaction as unknown as Record<string, unknown>,
    serialized,
    sha256: sha256(serialized),
  };
}

function assertRequiredText(value: string | null | undefined, code: string, message: string): string {
  const normalized = compactText(value);
  if (!normalized) {
    throw new OrchestrationApiError(400, code, message);
  }
  return normalized;
}

function assertObjective(value: string): ExperimentLaunchObjectiveKey {
  if (!OBJECTIVE_KEYS.has(value as ExperimentLaunchObjectiveKey)) {
    throw new OrchestrationApiError(
      400,
      "invalid_experiment_objective",
      "Experiment objective must be one of the supported launch objectives",
    );
  }
  return value as ExperimentLaunchObjectiveKey;
}

function normalizeWorkspaceMode(value: string | null | undefined): ExperimentWorkspaceModeKey {
  const mode = (compactText(value) ?? "snapshot") as ExperimentWorkspaceModeKey;
  if (!WORKSPACE_MODES.has(mode)) {
    throw new OrchestrationApiError(400, "invalid_workspace_mode", "Experiment workspace mode must be snapshot, branch, or live");
  }
  return mode;
}

function assertLiveGovernance(
  mode: ExperimentWorkspaceModeKey,
  confirmed: boolean | undefined,
  reason: string | null | undefined,
  phase: string,
): void {
  if (mode !== "live") return;
  if (confirmed !== true || !compactText(reason)) {
    throw new OrchestrationApiError(
      409,
      "live_workspace_requires_governed_selection",
      `Live workspace mode requires explicit governed operator selection before ${phase}`,
    );
  }
}

function normalizeLimits(input: Partial<ExperimentLimits> | null | undefined): ExperimentLimits {
  const defaults = defaultExperimentLaunchLimits();
  const limits = {
    variantCap: input?.variantCap ?? defaults.variantCap.defaultValue,
    attemptLimit: input?.attemptLimit ?? defaults.attemptLimit.defaultValue,
    timeboxMinutes: input?.timeboxMinutes ?? defaults.timeboxMinutes.defaultValue,
  };
  const specs = [
    ["variantCap", limits.variantCap, defaults.variantCap.min, defaults.variantCap.max],
    ["attemptLimit", limits.attemptLimit, defaults.attemptLimit.min, defaults.attemptLimit.max],
    ["timeboxMinutes", limits.timeboxMinutes, defaults.timeboxMinutes.min, defaults.timeboxMinutes.max],
  ] as const;
  for (const [name, value, min, max] of specs) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new OrchestrationApiError(
        400,
        "experiment_limit_out_of_range",
        `${name} must be an integer between ${min} and ${max}`,
      );
    }
  }
  return limits;
}

function limitSnapshot(limits: ExperimentLimits): { serialized: string; sha256: string } {
  const serialized = jsonString({
    schema: EXPERIMENT_LIMIT_SNAPSHOT_SCHEMA,
    variantCap: limits.variantCap,
    attemptLimit: limits.attemptLimit,
    timeboxMinutes: limits.timeboxMinutes,
  });
  return { serialized, sha256: sha256(serialized) };
}

function readLimits(row: Pick<ExperimentRow, "limit_snapshot_json">): ExperimentLimits {
  const defaults = normalizeLimits(null);
  const parsed = parseJson<Partial<ExperimentLimits>>(row.limit_snapshot_json, {});
  return normalizeLimits({
    variantCap: parsed.variantCap ?? defaults.variantCap,
    attemptLimit: parsed.attemptLimit ?? defaults.attemptLimit,
    timeboxMinutes: parsed.timeboxMinutes ?? defaults.timeboxMinutes,
  });
}

function resolveCompany(companyIdOrSlug: string, db: Database.Database): { id: string; code: string | null } {
  const company = resolveCompanyIdBySlug(companyIdOrSlug, db);
  if (!company) {
    throw new OrchestrationApiError(404, "company_not_found", "Company not found");
  }
  return { id: company.id, code: compactText(company.company_code) };
}

function sourceScopeError(kind: ExperimentLaunchSourceKind, sourceId: string, companyId: string): OrchestrationApiError {
  return new OrchestrationApiError(
    403,
    "experiment_source_company_scope_mismatch",
    `${kind} source ${sourceId} does not belong to company ${companyId}`,
  );
}

function resolveEvalCaseSource(companyId: string, sourceId: string, db: Database.Database): ResolvedSource {
  const row = db
    .prepare(
      `SELECT id, company_id, project_id, source_task_id, source_task_key, source_task_title,
              source_run_id, trace_route, review_outcome, reviewed_at, capture_quality,
              redacted_snapshot_json, snapshot_sha256, redaction_summary_json
       FROM eval_cases
       WHERE id = ? LIMIT 1`,
    )
    .get(sourceId) as {
      id: string;
      company_id: string;
      project_id: string | null;
      source_task_id: string | null;
      source_task_key: string;
      source_task_title: string;
      source_run_id: string;
      trace_route: string;
      review_outcome: string;
      reviewed_at: string | null;
      capture_quality: string;
      redacted_snapshot_json: string;
      snapshot_sha256: string;
      redaction_summary_json: string;
    } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "experiment_source_not_found", "Eval Case source not found");
  }
  if (row.company_id !== companyId) {
    throw sourceScopeError("eval_case", sourceId, companyId);
  }
  assertNoRunTraceCredentialLeak(row.redacted_snapshot_json, "Experiment Eval Case source snapshot");
  const snapshot = parseJson<Record<string, unknown>>(row.redacted_snapshot_json, {});
  const sourceSnapshot = {
    schema: EXPERIMENT_SOURCE_SNAPSHOT_SCHEMA,
    sourceType: "eval_case",
    evalCase: {
      id: row.id,
      sourceRunId: row.source_run_id,
      sourceTaskId: row.source_task_id,
      sourceTaskKey: row.source_task_key,
      sourceTaskTitle: row.source_task_title,
      reviewOutcome: row.review_outcome,
      reviewedAt: row.reviewed_at,
      captureQuality: row.capture_quality,
      snapshotSha256: row.snapshot_sha256,
    },
    redactedSnapshot: snapshot,
  };
  const serialized = jsonString(sourceSnapshot);
  assertNoRunTraceCredentialLeak(serialized, "Experiment Eval Case source snapshot");
  return {
    kind: "eval_case",
    projectId: row.project_id,
    sourceRunId: row.source_run_id,
    sourceEvalCaseId: row.id,
    sourceTaskId: row.source_task_id,
    traceRoute: row.trace_route,
    snapshot: sourceSnapshot,
    snapshotSha256: sha256(serialized),
    redactionSummary: parseJson<Record<string, unknown>>(row.redaction_summary_json, {}),
  };
}

function resolveRunTraceSource(companyId: string, sourceId: string, db: Database.Database): ResolvedSource {
  const row = db
    .prepare(
      `SELECT r.id, r.status, r.completed_at, r.task_id, t.company_id, t.project_id,
              t.task_key, t.title, t.status AS task_status
       FROM execution_runs r
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.id = ? LIMIT 1`,
    )
    .get(sourceId) as {
      id: string;
      status: string;
      completed_at: string | null;
      task_id: string | null;
      company_id: string | null;
      project_id: string | null;
      task_key: string | null;
      title: string | null;
      task_status: string | null;
    } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "experiment_source_not_found", "Run Trace source not found");
  }
  if (row.company_id !== companyId) {
    throw sourceScopeError("run_trace", sourceId, companyId);
  }
  if (!TERMINAL_RUN_STATUSES.has(row.status)) {
    throw new OrchestrationApiError(
      409,
      "run_trace_source_not_terminal",
      "Run Trace sources must be terminal before launching an experiment",
    );
  }
  if (!REVIEWED_TASK_STATUSES.has((row.task_status ?? "").toLowerCase())) {
    throw new OrchestrationApiError(
      409,
      "run_trace_source_not_reviewed",
      "Run Trace sources must have a reviewed task outcome before launching an experiment",
    );
  }
  const traceRoute = row.task_key
    ? `/companies/${companyId}/tasks/${encodeURIComponent(row.task_key)}/runs/${encodeURIComponent(row.id)}`
    : `/runs/${encodeURIComponent(row.id)}`;
  const sourceSnapshot = {
    schema: EXPERIMENT_SOURCE_SNAPSHOT_SCHEMA,
    sourceType: "run_trace",
    runTrace: {
      id: row.id,
      status: row.status,
      completedAt: row.completed_at,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.title,
      taskStatus: row.task_status,
    },
  };
  const serialized = jsonString(sourceSnapshot);
  assertNoRunTraceCredentialLeak(serialized, "Experiment Run Trace source snapshot");
  return {
    kind: "run_trace",
    projectId: row.project_id,
    sourceRunId: row.id,
    sourceEvalCaseId: null,
    sourceTaskId: row.task_id,
    traceRoute,
    snapshot: sourceSnapshot,
    snapshotSha256: sha256(serialized),
    redactionSummary: {},
  };
}

function resolveSource(companyId: string, input: ExperimentSourceInput, db: Database.Database): ResolvedSource {
  const sourceId = assertRequiredText(input.id, "missing_experiment_source", "Experiment source id is required");
  if (input.kind === "eval_case") {
    return resolveEvalCaseSource(companyId, sourceId, db);
  }
  if (input.kind === "run_trace") {
    return resolveRunTraceSource(companyId, sourceId, db);
  }
  throw new OrchestrationApiError(400, "invalid_experiment_source_kind", "Experiment source kind must be eval_case or run_trace");
}

function variantCountGuard(count: number, cap: number): void {
  if (!Number.isInteger(count) || count < 1 || count > 3) {
    throw new OrchestrationApiError(400, "experiment_variant_count_out_of_range", "Experiments must select one to three variants");
  }
  if (count > cap) {
    throw new OrchestrationApiError(400, "experiment_variant_cap_exceeded", "Selected variants exceed the experiment variant cap");
  }
}

function normalizeVariantInput(input: ExperimentVariantInput, index: number): Required<Pick<ExperimentVariantInput, "id" | "name">> & {
  key: string;
  description: string;
  changeType: ExperimentVariantChangeType;
  plannedChange: Record<string, unknown>;
  proposedByAgentId: string | null;
  proposedByUserId: string | null;
} {
  const name = assertRequiredText(input.name, "missing_variant_name", "Variant name is required");
  const key = compactText(input.key) ?? `variant-${index + 1}`;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(key)) {
    throw new OrchestrationApiError(400, "invalid_variant_key", "Variant keys must be short URL-safe identifiers");
  }
  return {
    id: input.id ?? randomUUID(),
    key,
    name,
    description: compactText(input.description) ?? "",
    changeType: input.changeType ?? "other",
    plannedChange: input.plannedChange ?? {},
    proposedByAgentId: compactText(input.proposedByAgentId),
    proposedByUserId: compactText(input.proposedByUserId),
  };
}

function loadExperimentRow(companyId: string, experimentId: string, db: Database.Database): ExperimentRow {
  const row = db.prepare("SELECT * FROM experiments WHERE id = ? LIMIT 1").get(experimentId) as ExperimentRow | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "experiment_not_found", "Experiment not found");
  }
  if (row.company_id !== companyId) {
    throw new OrchestrationApiError(403, "experiment_company_scope_mismatch", "Experiment does not belong to this company");
  }
  return row;
}

function loadVariants(experimentId: string, db: Database.Database): VariantRow[] {
  return db
    .prepare("SELECT * FROM experiment_variants WHERE experiment_id = ? ORDER BY created_at ASC, variant_key ASC")
    .all(experimentId) as VariantRow[];
}

function loadAttempts(experimentId: string, db: Database.Database): AttemptRow[] {
  return db
    .prepare("SELECT * FROM experiment_attempts WHERE experiment_id = ? ORDER BY attempt_number ASC, created_at ASC")
    .all(experimentId) as AttemptRow[];
}

function mapVariant(row: VariantRow): ExperimentVariantRecord {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    key: row.variant_key,
    name: row.name,
    description: row.description,
    changeType: row.change_type,
    plannedChange: parseJson<Record<string, unknown>>(row.planned_change_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttempt(row: AttemptRow): ExperimentAttemptRecord {
  return {
    id: row.id,
    experimentId: row.experiment_id,
    variantId: row.variant_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    workspaceMode: row.workspace_mode,
    workspaceRef: row.workspace_ref,
    executionRunId: row.execution_run_id,
    evalCaseId: row.eval_case_id,
    traceRoute: row.trace_route,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExperiment(row: ExperimentRow, db: Database.Database): ExperimentRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    projectId: row.project_id,
    sourceKind: row.source_kind,
    primarySourceRunId: row.primary_source_run_id,
    primarySourceEvalCaseId: row.primary_source_eval_case_id,
    sourceTaskId: row.source_task_id,
    sourceTraceRoute: row.source_trace_route,
    objective: row.objective,
    objectiveKind: row.objective_kind,
    definitionOfBetter: row.definition_of_better,
    hypothesis: row.hypothesis,
    workspaceMode: row.workspace_mode,
    limits: readLimits(row),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    failedAt: row.failed_at,
    variants: loadVariants(row.id, db).map(mapVariant),
    attempts: loadAttempts(row.id, db).map(mapAttempt),
    reports: [],
  };
}

function withReports(record: ExperimentRecord, db: Database.Database): ExperimentRecord {
  const rows = db
    .prepare("SELECT id FROM experiment_comparison_reports WHERE experiment_id = ? ORDER BY created_at DESC")
    .all(record.id) as Array<{ id: string }>;
  return {
    ...record,
    reports: rows
      .map((row) => getExperimentComparisonReport(record.companyId, row.id, db))
      .filter((report): report is OrchestrationExperimentReportEvidence => report !== null),
  };
}

function verifyLinkedExecutionRun(companyId: string, executionRunId: string | null | undefined, db: Database.Database): void {
  const id = compactText(executionRunId);
  if (!id) return;
  const row = db
    .prepare(
      `SELECT t.company_id
       FROM execution_runs r
       LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.id = ? LIMIT 1`,
    )
    .get(id) as { company_id: string | null } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "attempt_execution_run_not_found", "Attempt execution run not found");
  }
  if (row.company_id !== companyId) {
    throw new OrchestrationApiError(403, "attempt_execution_run_company_scope_mismatch", "Attempt execution run belongs to another company");
  }
}

function verifyLinkedEvalCase(companyId: string, evalCaseId: string | null | undefined, db: Database.Database): void {
  const id = compactText(evalCaseId);
  if (!id) return;
  const row = db.prepare("SELECT company_id FROM eval_cases WHERE id = ? LIMIT 1").get(id) as { company_id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "attempt_eval_case_not_found", "Attempt Eval Case not found");
  }
  if (row.company_id !== companyId) {
    throw new OrchestrationApiError(403, "attempt_eval_case_company_scope_mismatch", "Attempt Eval Case belongs to another company");
  }
}

function resolveVariantByInput(
  experimentId: string,
  variantId: string | null | undefined,
  variantKey: string | null | undefined,
  db: Database.Database,
): VariantRow {
  const normalizedId = compactText(variantId);
  const normalizedKey = compactText(variantKey);
  const row = normalizedId
    ? db.prepare("SELECT * FROM experiment_variants WHERE experiment_id = ? AND id = ? LIMIT 1").get(experimentId, normalizedId)
    : normalizedKey
      ? db.prepare("SELECT * FROM experiment_variants WHERE experiment_id = ? AND variant_key = ? LIMIT 1").get(experimentId, normalizedKey)
      : undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "experiment_variant_not_found", "Experiment variant not found");
  }
  return row as VariantRow;
}

export function createExperimentDraft(input: CreateExperimentDraftInput, db = getOrchestrationDb()): ExperimentRecord {
  const company = resolveCompany(input.companyIdOrSlug, db);
  const idempotencyKey = compactText(input.idempotencyKey);
  if (idempotencyKey) {
    const existing = db
      .prepare("SELECT id FROM experiments WHERE company_id = ? AND idempotency_key = ? LIMIT 1")
      .get(company.id, idempotencyKey) as { id: string } | undefined;
    if (existing) return getExperiment(company.id, existing.id, db);
  }

  const source = resolveSource(company.id, input.source, db);
  const objective = assertObjective(input.objective);
  const workspaceMode = normalizeWorkspaceMode(input.workspaceMode);
  assertLiveGovernance(workspaceMode, input.liveWorkspaceConfirmed, input.liveWorkspaceReason, "draft creation");
  const limits = normalizeLimits(input.limits);
  const variants = input.variants?.map(normalizeVariantInput) ?? [];
  if (variants.length > 0) {
    variantCountGuard(variants.length, limits.variantCap);
  }
  const variantKeys = new Set(variants.map((variant) => variant.key));
  if (variantKeys.size !== variants.length) {
    throw new OrchestrationApiError(400, "duplicate_experiment_variant_key", "Experiment variant keys must be unique");
  }

  const experimentId = input.id ?? randomUUID();
  const now = new Date().toISOString();
  const workspaceSelection = redactedJson({
    schema: EXPERIMENT_WORKSPACE_SELECTION_SCHEMA,
    mode: workspaceMode,
    liveGovernance: workspaceMode === "live"
      ? {
          confirmed: true,
          reason: compactText(input.liveWorkspaceReason),
          selectedAt: now,
          selectedByAgentId: compactText(input.createdByAgentId),
          selectedByUserId: compactText(input.createdByUserId),
        }
      : null,
  }, "Experiment workspace selection");
  const limitsSnapshot = limitSnapshot(limits);
  const sourceSerialized = jsonString(source.snapshot);

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO experiments (
         id, company_id, project_id, source_kind, primary_source_run_id,
         primary_source_eval_case_id, source_task_id, source_trace_route,
         objective, objective_kind, definition_of_better, hypothesis,
         workspace_mode, workspace_snapshot_json, limit_snapshot_json,
         limit_snapshot_sha256, status, idempotency_key, created_by_agent_id,
         created_by_user_id, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
    ).run(
      experimentId,
      company.id,
      source.projectId,
      source.kind,
      source.sourceRunId,
      source.sourceEvalCaseId,
      source.sourceTaskId,
      source.traceRoute,
      objective,
      OBJECTIVE_TO_KIND[objective],
      compactText(input.definitionOfBetter) ?? objective,
      compactText(input.hypothesis) ?? "",
      workspaceMode,
      workspaceSelection.serialized,
      limitsSnapshot.serialized,
      limitsSnapshot.sha256,
      idempotencyKey,
      compactText(input.createdByAgentId),
      compactText(input.createdByUserId),
      now,
      now,
    );

    db.prepare(
      `INSERT INTO experiment_sources (
         id, experiment_id, company_id, source_type, source_run_id,
         source_eval_case_id, source_task_id, trace_route,
         source_snapshot_json, source_snapshot_sha256, redaction_summary_json, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      experimentId,
      company.id,
      source.kind,
      source.sourceRunId,
      source.sourceEvalCaseId,
      source.sourceTaskId,
      source.traceRoute,
      sourceSerialized,
      source.snapshotSha256,
      jsonString(source.redactionSummary),
      now,
    );

    for (const variant of variants) {
      const plannedChange = redactedJson(variant.plannedChange, "Experiment variant planned change");
      db.prepare(
        `INSERT INTO experiment_variants (
           id, experiment_id, company_id, variant_key, name, description,
           change_type, planned_change_json, status, limit_snapshot_json,
           limit_snapshot_sha256, proposed_by_agent_id, proposed_by_user_id,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
      ).run(
        variant.id,
        experimentId,
        company.id,
        variant.key,
        variant.name,
        variant.description,
        variant.changeType,
        plannedChange.serialized,
        limitsSnapshot.serialized,
        limitsSnapshot.sha256,
        variant.proposedByAgentId,
        variant.proposedByUserId,
        now,
        now,
      );
    }
  });
  transaction();

  return getExperiment(company.id, experimentId, db);
}

export function listExperiments(
  companyIdOrSlug: string,
  filters: ExperimentListFilters = {},
  db = getOrchestrationDb(),
): ExperimentRecord[] {
  const company = resolveCompany(companyIdOrSlug, db);
  const where: string[] = ["company_id = ?"];
  const args: unknown[] = [company.id];
  if (filters.status?.length) {
    where.push(`status IN (${filters.status.map(() => "?").join(", ")})`);
    args.push(...filters.status);
  }
  if (filters.sourceKind) {
    where.push("source_kind = ?");
    args.push(filters.sourceKind);
  }
  if (filters.sourceRunId) {
    where.push("primary_source_run_id = ?");
    args.push(filters.sourceRunId);
  }
  if (filters.sourceEvalCaseId) {
    where.push("primary_source_eval_case_id = ?");
    args.push(filters.sourceEvalCaseId);
  }
  if (filters.sourceTaskId) {
    where.push("source_task_id = ?");
    args.push(filters.sourceTaskId);
  }
  const limit = typeof filters.limit === "number"
    ? Math.max(1, Math.min(200, Math.trunc(filters.limit)))
    : 50;
  const rows = db
    .prepare(`SELECT * FROM experiments WHERE ${where.join(" AND ")} ORDER BY updated_at DESC, created_at DESC LIMIT ?`)
    .all(...args, limit) as ExperimentRow[];
  return rows.map((row) => mapExperiment(row, db));
}

export function getExperiment(
  companyIdOrSlug: string,
  experimentId: string,
  db = getOrchestrationDb(),
): ExperimentRecord {
  const company = resolveCompany(companyIdOrSlug, db);
  const row = loadExperimentRow(company.id, experimentId, db);
  return withReports(mapExperiment(row, db), db);
}

export function approveExperimentVariants(input: ApproveExperimentVariantsInput, db = getOrchestrationDb()): ExperimentRecord {
  const company = resolveCompany(input.companyIdOrSlug, db);
  const experiment = loadExperimentRow(company.id, input.experimentId, db);
  assertLiveGovernance(experiment.workspace_mode, input.liveWorkspaceConfirmed, input.liveWorkspaceReason, "variant approval");
  const limits = readLimits(experiment);
  const selectedTokens = [
    ...(input.variantIds ?? []).map(compactText).filter((value): value is string => value !== null),
    ...(input.variantKeys ?? []).map(compactText).filter((value): value is string => value !== null),
  ];
  const uniqueSelected = Array.from(new Set(selectedTokens));
  variantCountGuard(uniqueSelected.length, limits.variantCap);

  const variants = loadVariants(experiment.id, db);
  const selectedIds = new Set<string>();
  for (const token of uniqueSelected) {
    const match = variants.find((variant) => variant.id === token || variant.variant_key === token);
    if (!match) {
      throw new OrchestrationApiError(404, "experiment_variant_not_found", `Experiment variant ${token} not found`);
    }
    selectedIds.add(match.id);
  }
  if (selectedIds.size !== uniqueSelected.length) {
    throw new OrchestrationApiError(400, "duplicate_experiment_variant_selection", "Variant selection contains duplicates");
  }

  const now = new Date().toISOString();
  const approvalSnapshot = redactedJson({
    selectedVariantIds: Array.from(selectedIds),
    selectedVariantCount: selectedIds.size,
    liveGovernance: experiment.workspace_mode === "live"
      ? {
          confirmed: true,
          reason: compactText(input.liveWorkspaceReason),
        }
      : null,
  }, "Experiment variant approval snapshot");
  const transaction = db.transaction(() => {
    for (const variant of variants) {
      if (selectedIds.has(variant.id)) {
        db.prepare(
          `UPDATE experiment_variants
           SET status = 'approved',
               approval_snapshot_json = ?,
               approved_by_agent_id = ?,
               approved_by_user_id = ?,
               approved_at = ?,
               updated_at = ?
           WHERE id = ?`,
        ).run(
          approvalSnapshot.serialized,
          compactText(input.approvedByAgentId),
          compactText(input.approvedByUserId),
          now,
          now,
          variant.id,
        );
      } else if (variant.status === "draft" || variant.status === "awaiting_approval") {
        db.prepare(
          `UPDATE experiment_variants
           SET status = 'rejected', rejected_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(now, now, variant.id);
      }
    }
    db.prepare(
      `UPDATE experiments
       SET status = 'approved',
           approved_by_agent_id = ?,
           approved_by_user_id = ?,
           approved_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      compactText(input.approvedByAgentId),
      compactText(input.approvedByUserId),
      now,
      now,
      experiment.id,
    );
  });
  transaction();
  return getExperiment(company.id, experiment.id, db);
}

type PreparedAttemptWrite = {
  companyId: string;
  experimentId: string;
  variantId: string;
  attemptNumber: number;
  status: ExperimentAttemptStatus;
  workspaceMode: ExperimentWorkspaceModeKey;
  workspaceRef: string | null;
  contextSnapshotJson: string;
  limitSnapshotJson: string;
  limitSnapshotSha256: string;
  executionRunId: string | null;
  evalCaseId: string | null;
  traceRoute: string | null;
  comparisonSnapshotJson: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  now: string;
};

function attemptVariantStatus(status: ExperimentAttemptStatus): ExperimentVariantStatus {
  if (status === "running") return "running";
  if (status === "succeeded") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "timed_out") return "failed";
  return "approved";
}

function attemptExperimentStatus(status: ExperimentAttemptStatus, fallback: ExperimentLifecycleStatus): ExperimentLifecycleStatus {
  if (status === "running" || status === "queued") return "running";
  if (status === "succeeded") return "reporting";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "timed_out") return "failed";
  return fallback;
}

function attemptTimestamps(status: ExperimentAttemptStatus, existing: AttemptRow | undefined, now: string): {
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
} {
  return {
    startedAt: status === "running" ? now : existing?.started_at ?? null,
    completedAt: ["succeeded", "failed", "timed_out"].includes(status) ? now : existing?.completed_at ?? null,
    cancelledAt: status === "cancelled" ? now : existing?.cancelled_at ?? null,
  };
}

function updateExistingAttempt(db: Database.Database, existing: AttemptRow, write: PreparedAttemptWrite): void {
  db.prepare(
    `UPDATE experiment_attempts
     SET status = ?,
         workspace_ref = COALESCE(?, workspace_ref),
         context_snapshot_json = ?,
         limit_snapshot_json = ?,
         limit_snapshot_sha256 = ?,
         execution_run_id = COALESCE(?, execution_run_id),
         eval_case_id = COALESCE(?, eval_case_id),
         trace_route = COALESCE(?, trace_route),
         comparison_snapshot_json = ?,
         error_message = ?,
         started_at = COALESCE(?, started_at),
         completed_at = COALESCE(?, completed_at),
         cancelled_at = COALESCE(?, cancelled_at),
         updated_at = ?
     WHERE id = ?`,
  ).run(
    write.status,
    write.workspaceRef,
    write.contextSnapshotJson,
    write.limitSnapshotJson,
    write.limitSnapshotSha256,
    write.executionRunId,
    write.evalCaseId,
    write.traceRoute,
    write.comparisonSnapshotJson,
    write.errorMessage,
    write.startedAt,
    write.completedAt,
    write.cancelledAt,
    write.now,
    existing.id,
  );
}

function insertAttempt(db: Database.Database, write: PreparedAttemptWrite): void {
  db.prepare(
    `INSERT INTO experiment_attempts (
       id, experiment_id, variant_id, company_id, attempt_number, status,
       workspace_mode, workspace_ref, context_snapshot_json, limit_snapshot_json,
       limit_snapshot_sha256, execution_run_id, eval_case_id, trace_route,
       comparison_snapshot_json, error_message, started_at, completed_at,
       cancelled_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    write.experimentId,
    write.variantId,
    write.companyId,
    write.attemptNumber,
    write.status,
    write.workspaceMode,
    write.workspaceRef,
    write.contextSnapshotJson,
    write.limitSnapshotJson,
    write.limitSnapshotSha256,
    write.executionRunId,
    write.evalCaseId,
    write.traceRoute,
    write.comparisonSnapshotJson,
    write.errorMessage,
    write.startedAt,
    write.completedAt,
    write.cancelledAt,
    write.now,
    write.now,
  );
}

function updateExperimentAfterAttempt(
  db: Database.Database,
  experiment: ExperimentRow,
  variantId: string,
  status: ExperimentAttemptStatus,
  now: string,
): void {
  const experimentStatus = attemptExperimentStatus(status, experiment.status);
  db.prepare("UPDATE experiment_variants SET status = ?, updated_at = ? WHERE id = ?")
    .run(attemptVariantStatus(status), now, variantId);
  db.prepare(
    `UPDATE experiments
     SET status = ?,
         started_at = COALESCE(started_at, ?),
         completed_at = CASE WHEN ? = 'reporting' THEN ? ELSE completed_at END,
         cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
         failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    experimentStatus,
    experimentStatus === "running" ? now : null,
    experimentStatus,
    experimentStatus === "reporting" ? now : null,
    experimentStatus,
    experimentStatus === "cancelled" ? now : null,
    experimentStatus,
    experimentStatus === "failed" ? now : null,
    now,
    experiment.id,
  );
}

export function recordExperimentAttempt(input: RecordExperimentAttemptInput, db = getOrchestrationDb()): ExperimentRecord {
  const company = resolveCompany(input.companyIdOrSlug, db);
  const experiment = loadExperimentRow(company.id, input.experimentId, db);
  const variant = resolveVariantByInput(experiment.id, input.variantId, input.variantKey, db);
  const limits = readLimits(experiment);
  if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1 || input.attemptNumber > limits.attemptLimit) {
    throw new OrchestrationApiError(400, "experiment_attempt_limit_exceeded", "Attempt number exceeds the experiment attempt limit");
  }
  const existing = db
    .prepare("SELECT * FROM experiment_attempts WHERE variant_id = ? AND attempt_number = ? LIMIT 1")
    .get(variant.id, input.attemptNumber) as AttemptRow | undefined;
  if (!existing && !ATTEMPT_RUNNABLE_VARIANT_STATUSES.has(variant.status)) {
    throw new OrchestrationApiError(409, "experiment_variant_not_approved", "Experiment attempts can only run against approved variants");
  }
  const workspaceMode = normalizeWorkspaceMode(input.workspaceMode ?? experiment.workspace_mode);
  if (workspaceMode !== experiment.workspace_mode) {
    throw new OrchestrationApiError(400, "attempt_workspace_mode_mismatch", "Attempt workspace mode must match the experiment workspace mode");
  }
  assertLiveGovernance(workspaceMode, input.liveWorkspaceConfirmed, input.liveWorkspaceReason, "attempt execution");
  if (TERMINAL_ATTEMPT_STATUSES.has(input.status) && !compactText(input.executionRunId) && !compactText(input.evalCaseId) && !compactText(input.traceRoute)) {
    throw new OrchestrationApiError(
      400,
      "terminal_attempt_requires_evidence",
      "Terminal attempt states require an execution run, Eval Case, or trace route link",
    );
  }
  verifyLinkedExecutionRun(company.id, input.executionRunId, db);
  verifyLinkedEvalCase(company.id, input.evalCaseId, db);

  if (existing && existing.status !== input.status && !ALLOWED_ATTEMPT_TRANSITIONS[existing.status].includes(input.status)) {
    throw new OrchestrationApiError(
      409,
      "invalid_attempt_lifecycle_transition",
      `Cannot transition experiment attempt from ${existing.status} to ${input.status}`,
    );
  }

  const now = new Date().toISOString();
  const limitsSnapshot = limitSnapshot(limits);
  const contextSnapshot = redactedJson(input.contextSnapshot ?? {}, "Experiment attempt context snapshot");
  const comparisonSnapshot = redactedJson(input.comparisonSnapshot ?? {}, "Experiment attempt comparison snapshot");
  const timestamps = attemptTimestamps(input.status, existing, now);
  const attemptWrite: PreparedAttemptWrite = {
    companyId: company.id,
    experimentId: experiment.id,
    variantId: variant.id,
    attemptNumber: input.attemptNumber,
    status: input.status,
    workspaceMode,
    workspaceRef: compactText(input.workspaceRef),
    contextSnapshotJson: contextSnapshot.serialized,
    limitSnapshotJson: limitsSnapshot.serialized,
    limitSnapshotSha256: limitsSnapshot.sha256,
    executionRunId: compactText(input.executionRunId),
    evalCaseId: compactText(input.evalCaseId),
    traceRoute: compactText(input.traceRoute),
    comparisonSnapshotJson: comparisonSnapshot.serialized,
    errorMessage: compactText(input.errorMessage),
    startedAt: timestamps.startedAt,
    completedAt: timestamps.completedAt,
    cancelledAt: timestamps.cancelledAt,
    now,
  };

  const transaction = db.transaction(() => {
    if (existing) {
      updateExistingAttempt(db, existing, attemptWrite);
    } else {
      insertAttempt(db, attemptWrite);
    }
    updateExperimentAfterAttempt(db, experiment, variant.id, input.status, now);
  });
  transaction();
  return getExperiment(company.id, experiment.id, db);
}

function verifyRecommendation(companyId: string, recommendationId: string | null | undefined, db: Database.Database): void {
  const id = compactText(recommendationId);
  if (!id) return;
  const row = db.prepare("SELECT company_id FROM improvement_recommendations WHERE id = ? LIMIT 1").get(id) as { company_id: string } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "experiment_report_recommendation_not_found", "Improve recommendation not found");
  }
  if (row.company_id !== companyId) {
    throw new OrchestrationApiError(403, "experiment_report_recommendation_scope_mismatch", "Improve recommendation belongs to another company");
  }
}

type ExistingReportRow = {
  id: string;
  experiment_id: string;
};

type PreparedReportWrite = {
  id: string;
  experiment: ExperimentRow;
  companyId: string;
  status: OrchestrationExperimentReportStatus;
  summary: string;
  reportJson: string;
  conclusionJson: string;
  winningVariantId: string | null;
  recommendationId: string | null;
  reportSha256: string;
  reportRedaction: Record<string, unknown>;
  conclusionRedaction: Record<string, unknown>;
  generatedByAgentId: string | null;
  generatedByUserId: string | null;
  now: string;
};

function reportExperimentStatus(
  reportStatus: OrchestrationExperimentReportStatus,
  fallback: ExperimentLifecycleStatus,
): ExperimentLifecycleStatus {
  if (reportStatus === "accepted") return "completed";
  if (reportStatus === "archived") return fallback;
  return "reporting";
}

function updateExistingReport(db: Database.Database, write: PreparedReportWrite): void {
  db.prepare(
    `UPDATE experiment_comparison_reports
     SET status = ?,
         summary = ?,
         report_json = ?,
         conclusion_json = ?,
         winning_variant_id = ?,
         recommendation_id = ?,
         report_sha256 = ?,
         updated_at = ?,
         accepted_at = CASE WHEN ? = 'accepted' THEN COALESCE(accepted_at, ?) ELSE accepted_at END,
         returned_at = CASE WHEN ? = 'returned' THEN COALESCE(returned_at, ?) ELSE returned_at END,
         archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) ELSE archived_at END
     WHERE id = ?`,
  ).run(
    write.status,
    write.summary,
    write.reportJson,
    write.conclusionJson,
    write.winningVariantId,
    write.recommendationId,
    write.reportSha256,
    write.now,
    write.status,
    write.now,
    write.status,
    write.now,
    write.status,
    write.now,
    write.id,
  );
}

function insertReport(db: Database.Database, write: PreparedReportWrite): void {
  db.prepare(
    `INSERT INTO experiment_comparison_reports (
       id, experiment_id, company_id, status, summary, report_json,
       conclusion_json, winning_variant_id, recommendation_id, report_sha256,
       generated_by_agent_id, generated_by_user_id, accepted_by_agent_id,
       accepted_by_user_id, accepted_at, returned_at, archived_at, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    write.id,
    write.experiment.id,
    write.companyId,
    write.status,
    write.summary,
    write.reportJson,
    write.conclusionJson,
    write.winningVariantId,
    write.recommendationId,
    write.reportSha256,
    write.generatedByAgentId,
    write.generatedByUserId,
    write.status === "accepted" ? write.generatedByAgentId : null,
    write.status === "accepted" ? write.generatedByUserId : null,
    write.status === "accepted" ? write.now : null,
    write.status === "returned" ? write.now : null,
    write.status === "archived" ? write.now : null,
    write.now,
    write.now,
  );
}

function upsertReportEvidence(db: Database.Database, write: PreparedReportWrite): void {
  db.prepare(
    `INSERT INTO experiment_evidence_attachments (
       id, company_id, experiment_id, variant_id, report_id, attachment_scope,
       evidence_type, title, summary, source_run_id, source_eval_case_id,
       recommendation_id, evidence_json, redaction_summary_json,
       created_by_agent_id, created_by_user_id, created_at
     )
     VALUES (?, ?, ?, ?, ?, 'report', 'comparison_report', 'Comparison report', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       summary = excluded.summary,
       recommendation_id = excluded.recommendation_id,
       evidence_json = excluded.evidence_json,
       redaction_summary_json = excluded.redaction_summary_json`,
  ).run(
    `report-evidence-${write.id}`,
    write.companyId,
    write.experiment.id,
    write.winningVariantId,
    write.id,
    write.summary,
    write.experiment.primary_source_run_id,
    write.experiment.primary_source_eval_case_id,
    write.recommendationId,
    jsonString({
      reportId: write.id,
      reportStatus: write.status,
      winningVariantId: write.winningVariantId,
      reportSha256: write.reportSha256,
    }),
    jsonString({
      report: write.reportRedaction,
      conclusion: write.conclusionRedaction,
    }),
    write.generatedByAgentId,
    write.generatedByUserId,
    write.now,
  );
}

function updateExperimentAfterReport(db: Database.Database, write: PreparedReportWrite): void {
  const status = reportExperimentStatus(write.status, write.experiment.status);
  db.prepare(
    `UPDATE experiments
     SET status = ?,
         completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END,
         updated_at = ?
     WHERE id = ?`,
  ).run(status, status, write.now, write.now, write.experiment.id);
}

export function saveExperimentReport(input: SaveExperimentReportInput, db = getOrchestrationDb()): OrchestrationExperimentReportEvidence {
  const company = resolveCompany(input.companyIdOrSlug, db);
  const experiment = loadExperimentRow(company.id, input.experimentId, db);
  const winningVariant = compactText(input.winningVariantId) || compactText(input.winningVariantKey)
    ? resolveVariantByInput(experiment.id, input.winningVariantId, input.winningVariantKey, db)
    : null;
  verifyRecommendation(company.id, input.recommendationId, db);
  const reportStatus = input.status ?? "generated";
  const reportPayload = {
    ...input.report,
    schema: EXPERIMENT_COMPARISON_REPORT_SCHEMA,
  };
  const report = redactedJson(reportPayload, "Experiment comparison report");
  const conclusion = redactedJson(input.conclusion ?? {}, "Experiment comparison conclusion");
  const now = new Date().toISOString();
  const reportId = input.id ?? randomUUID();
  const existing = db
    .prepare("SELECT id, experiment_id FROM experiment_comparison_reports WHERE id = ? AND company_id = ? LIMIT 1")
    .get(reportId, company.id) as ExistingReportRow | undefined;
  if (existing && existing.experiment_id !== experiment.id) {
    throw new OrchestrationApiError(409, "experiment_report_id_conflict", "Experiment report id belongs to another experiment");
  }
  const write: PreparedReportWrite = {
    id: reportId,
    experiment,
    companyId: company.id,
    status: reportStatus,
    summary: compactText(input.summary) ?? "",
    reportJson: report.serialized,
    conclusionJson: conclusion.serialized,
    winningVariantId: winningVariant?.id ?? null,
    recommendationId: compactText(input.recommendationId),
    reportSha256: report.sha256,
    reportRedaction: report.redaction,
    conclusionRedaction: conclusion.redaction,
    generatedByAgentId: compactText(input.generatedByAgentId),
    generatedByUserId: compactText(input.generatedByUserId),
    now,
  };

  const transaction = db.transaction(() => {
    if (existing) {
      updateExistingReport(db, write);
    } else {
      insertReport(db, write);
    }
    upsertReportEvidence(db, write);
    updateExperimentAfterReport(db, write);
  });
  transaction();

  const saved = getExperimentComparisonReport(company.id, reportId, db);
  if (!saved) {
    throw new OrchestrationApiError(500, "experiment_report_save_failed", "Experiment report was not saved");
  }
  return saved;
}

type AttemptReportRow = AttemptRow & {
  comparison_snapshot_json: string | null;
  variant_key: string;
  variant_name: string;
  run_duration_ms: number | null;
  run_token_usage_json: string | null;
  run_status: string | null;
  run_error_message: string | null;
};

function loadAttemptReportRows(experimentId: string, db: Database.Database): AttemptReportRow[] {
  return db
    .prepare(
      `SELECT a.*, v.variant_key AS variant_key, v.name AS variant_name,
              r.duration_ms AS run_duration_ms, r.token_usage_json AS run_token_usage_json,
              r.status AS run_status, r.error_message AS run_error_message
       FROM experiment_attempts a
       INNER JOIN experiment_variants v ON v.id = a.variant_id
       LEFT JOIN execution_runs r ON r.id = a.execution_run_id
       WHERE a.experiment_id = ?
       ORDER BY a.attempt_number ASC, a.created_at ASC`,
    )
    .all(experimentId) as AttemptReportRow[];
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function attemptReportEntry(row: AttemptReportRow): Record<string, unknown> {
  const comparison = parseJson<Record<string, unknown>>(row.comparison_snapshot_json, {});
  const tokenUsage = parseJson<Record<string, unknown>>(row.run_token_usage_json, {});
  return {
    variantKey: row.variant_key,
    variantName: row.variant_name,
    attemptNumber: row.attempt_number,
    status: row.status,
    workspaceMode: row.workspace_mode,
    runtimeMs: numberOrNull(row.run_duration_ms),
    tokenUsage,
    costUsd: numberOrNull(tokenUsage.costUsd) ?? numberOrNull(comparison.costUsd),
    outcome: comparison.outcome ?? comparison.result ?? null,
    evidenceQuality: comparison.evidenceQuality ?? comparison.captureQuality ?? null,
    accepted: typeof comparison.accepted === "boolean" ? comparison.accepted : null,
    score: numberOrNull(comparison.score),
    toolRuntimeError: compactText(row.error_message) ?? compactText(row.run_error_message),
    operatorNotes: comparison.operatorNotes ?? comparison.notes ?? null,
    executionRunId: row.execution_run_id,
    evalCaseId: row.eval_case_id,
    traceRoute: row.trace_route,
    comparisonSnapshot: comparison,
  };
}

/**
 * Assemble a comparison report payload covering the original source and every
 * recorded variant attempt: runtime, token/cost, outcome, evidence quality,
 * tool/runtime errors, operator notes, and source references. The payload is
 * raw — credential redaction is applied by {@link saveExperimentReport} when it
 * is persisted, so callers should pass the result straight through to save.
 */
export function buildExperimentComparisonReport(
  companyIdOrSlug: string,
  experimentId: string,
  db = getOrchestrationDb(),
): Record<string, unknown> {
  const company = resolveCompany(companyIdOrSlug, db);
  const experiment = loadExperimentRow(company.id, experimentId, db);
  const attempts = loadAttemptReportRows(experiment.id, db).map(attemptReportEntry);

  let baseline: Record<string, unknown> | null = null;
  if (experiment.primary_source_run_id) {
    const run = db
      .prepare("SELECT duration_ms, token_usage_json, status, error_message FROM execution_runs WHERE id = ? LIMIT 1")
      .get(experiment.primary_source_run_id) as
      | { duration_ms: number | null; token_usage_json: string | null; status: string | null; error_message: string | null }
      | undefined;
    const tokenUsage = parseJson<Record<string, unknown>>(run?.token_usage_json, {});
    baseline = {
      label: "original_source",
      runId: experiment.primary_source_run_id,
      evalCaseId: experiment.primary_source_eval_case_id,
      traceRoute: experiment.source_trace_route,
      runtimeMs: numberOrNull(run?.duration_ms),
      tokenUsage,
      costUsd: numberOrNull(tokenUsage.costUsd),
      status: run?.status ?? null,
      toolRuntimeError: compactText(run?.error_message),
    };
  }

  return {
    schema: EXPERIMENT_COMPARISON_REPORT_SCHEMA,
    title: `Comparison report — ${experiment.objective}`,
    objective: experiment.objective,
    objectiveKind: experiment.objective_kind,
    definitionOfBetter: experiment.definition_of_better,
    hypothesis: experiment.hypothesis,
    workspaceMode: experiment.workspace_mode,
    source: {
      kind: experiment.source_kind,
      runId: experiment.primary_source_run_id,
      evalCaseId: experiment.primary_source_eval_case_id,
      taskId: experiment.source_task_id,
      traceRoute: experiment.source_trace_route,
    },
    baseline,
    attempts,
    attemptCount: attempts.length,
  };
}

export type ExperimentReportImproveHandoffInput = {
  companyIdOrSlug: string;
  experimentId: string;
  reportId: string;
  trigger?: { configured?: boolean; triggerKey?: string | null; reason?: string | null } | null;
  scopeType?: ImprovementRecommendationScopeType;
  scopeKey?: string | null;
  title?: string | null;
  rationale?: string | null;
  proposedChange?: string | null;
  severity?: ImprovementRecommendationSeverity;
  confidence?: ImprovementRecommendationConfidence;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  idempotencyKey?: string | null;
};

export type ExperimentReportImproveHandoffResult = {
  recommendation: OrchestrationImprovementRecommendation;
  report: OrchestrationExperimentReportEvidence;
  pathway: "accepted" | "triggered";
};

/**
 * Governed Improve handoff: create an improvement recommendation from a
 * comparison report ONLY after operator acceptance (report status `accepted`)
 * or configured trigger evidence. Generating a report never creates a
 * recommendation by itself; this is the single sanctioned creation path. The
 * call is idempotent — once a report is linked to a recommendation, the same
 * recommendation is returned instead of creating a duplicate.
 */
export function createImproveRecommendationFromExperimentReport(
  input: ExperimentReportImproveHandoffInput,
  db = getOrchestrationDb(),
): ExperimentReportImproveHandoffResult {
  const company = resolveCompany(input.companyIdOrSlug, db);
  const experiment = loadExperimentRow(company.id, input.experimentId, db);
  const report = getExperimentComparisonReport(company.id, input.reportId, db);
  if (!report || report.experimentId !== experiment.id) {
    throw new OrchestrationApiError(404, "experiment_report_not_found", "Experiment comparison report not found");
  }

  const accepted = report.status === "accepted";
  const triggered = input.trigger?.configured === true;
  if (!accepted && !triggered) {
    throw new OrchestrationApiError(
      409,
      "experiment_report_handoff_not_governed",
      "Improve recommendations from a comparison report require operator acceptance or configured trigger evidence",
    );
  }
  const pathway: "accepted" | "triggered" = accepted ? "accepted" : "triggered";

  if (report.recommendationId) {
    return {
      recommendation: getImproveRecommendation(company.id, report.recommendationId, db).recommendation,
      report,
      pathway,
    };
  }

  const evidence: ImproveEvidenceInput[] = [{
    id: `experiment-report-${report.id}`,
    sourceType: "experiment_report",
    sourceId: report.id,
    title: report.title,
    summary: report.summary,
    href: report.href,
    runId: report.sourceRunId,
    evalCaseId: report.sourceEvalCaseId,
    taskId: report.sourceTaskId,
    taskKey: report.sourceTaskKey,
    occurredAt: report.createdAt,
    metadata: {
      experimentId: experiment.id,
      reportStatus: report.status,
      winningVariantId: report.winningVariantId,
      winningVariantKey: report.winningVariantKey,
      pathway,
      redactionPolicy: report.redactionPolicy,
      triggerReason: compactText(input.trigger?.reason),
    },
  }];

  const triggerKey = compactText(input.trigger?.triggerKey)
    ?? (accepted ? "experiment_accepted_report" : "experiment_triggered_report");
  const now = new Date().toISOString();

  const created = db.transaction(() => {
    const recommendation = createImproveRecommendation({
      companyId: company.id,
      triggerKey,
      scopeType: input.scopeType ?? "company",
      scopeKey: compactText(input.scopeKey) ?? company.id,
      title: compactText(input.title) ?? `Adopt comparison-winning approach: ${report.title}`,
      rationale: compactText(input.rationale) ?? report.summary ?? "",
      proposedChange: compactText(input.proposedChange) ?? "",
      severity: input.severity ?? "medium",
      confidence: input.confidence ?? "medium",
      evidence,
      originalRecommendation: { source: "experiment_report", reportId: report.id, pathway },
      currentRecommendation: { category: "experiment_report", experimentId: experiment.id, reportId: report.id },
      idempotencyKey: compactText(input.idempotencyKey) ?? `experiment-report-handoff-${report.id}`,
      createdByAgentId: compactText(input.createdByAgentId),
      createdByUserId: compactText(input.createdByUserId),
    }, db);
    db.prepare(
      "UPDATE experiment_comparison_reports SET recommendation_id = ?, updated_at = ? WHERE id = ? AND company_id = ?",
    ).run(recommendation.id, now, report.id, company.id);
    db.prepare(
      "UPDATE experiment_evidence_attachments SET recommendation_id = ? WHERE report_id = ? AND company_id = ?",
    ).run(recommendation.id, report.id, company.id);
    return recommendation;
  })();

  const linkedReport = getExperimentComparisonReport(company.id, report.id, db) ?? report;
  return { recommendation: created, report: linkedReport, pathway };
}

export function markExperimentFailed(input: {
  companyIdOrSlug: string;
  experimentId: string;
  reason?: string | null;
}, db = getOrchestrationDb()): ExperimentRecord {
  const company = resolveCompany(input.companyIdOrSlug, db);
  const experiment = loadExperimentRow(company.id, input.experimentId, db);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE experiments SET status = 'failed', failed_at = COALESCE(failed_at, ?), updated_at = ? WHERE id = ?",
  ).run(now, now, experiment.id);
  return getExperiment(company.id, experiment.id, db);
}

export function markExperimentCancelled(input: {
  companyIdOrSlug: string;
  experimentId: string;
  reason?: string | null;
}, db = getOrchestrationDb()): ExperimentRecord {
  const company = resolveCompany(input.companyIdOrSlug, db);
  const experiment = loadExperimentRow(company.id, input.experimentId, db);
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE experiments SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, ?), updated_at = ? WHERE id = ?",
  ).run(now, now, experiment.id);
  return getExperiment(company.id, experiment.id, db);
}
