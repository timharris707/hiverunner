import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";

import { OrchestrationApiError } from "@/lib/orchestration/api";
import { getOrchestrationDb } from "@/lib/orchestration/db";
import type { ExperimentWorkspaceModeKey } from "@/lib/orchestration/experiment-launch";
import {
  getExperiment,
  recordExperimentAttempt,
  type ExperimentAttemptStatus,
  type ExperimentLimits,
  type ExperimentRecord,
  type ExperimentVariantRecord,
} from "@/lib/orchestration/experiments";
import {
  assertNoRunTraceCredentialLeak,
  redactRunTracePayload,
  type RunTraceRedactionSummary,
} from "@/lib/orchestration/run-trace";
import { persistExecutionTranscriptEvents } from "@/lib/orchestration/service/execution-transcript";

const ATTEMPT_CONTEXT_SCHEMA = "hiverunner.experiment_attempt_context.v1" as const;
const ATTEMPT_TRACE_SCHEMA = "hiverunner.experiment_attempt_trace.v1" as const;
const DEFAULT_MAX_ITERATIONS = 1;
const DEFAULT_MAX_COST_USD = 1;
const DEFAULT_MAX_TOKENS = 200_000;
const DEFAULT_RUNNER_PROVIDER = "symphony";

export type ExperimentAttemptRuntimeLimits = {
  timeboxMs?: number;
  maxIterations?: number;
  maxCostUsd?: number;
  maxTokens?: number;
};

export type ExperimentAttemptExecutorResult = {
  status?: "succeeded" | "failed" | "cancelled";
  resultText?: string | null;
  errorMessage?: string | null;
  metrics?: Record<string, unknown> | null;
  verification?: Record<string, unknown> | null;
  transcriptEvents?: unknown[] | null;
};

export type ExperimentAttemptExecutorContext = {
  experiment: ExperimentRecord;
  variant: ExperimentVariantRecord;
  attemptNumber: number;
  workspace: {
    mode: ExperimentWorkspaceModeKey;
    cwd: string;
    ref: string;
    tempRoot: string | null;
  };
  contextSnapshot: Record<string, unknown>;
  limits: Required<ExperimentAttemptRuntimeLimits>;
  signal: AbortSignal;
  recordIteration: (usage?: { costUsd?: number; tokens?: number }) => void;
  recordTraceEvent: (event: unknown) => void;
};

export type ExperimentAttemptExecutor = (
  context: ExperimentAttemptExecutorContext,
) => Promise<ExperimentAttemptExecutorResult> | ExperimentAttemptExecutorResult;

export type RunExperimentAttemptInput = {
  companyIdOrSlug: string;
  experimentId: string;
  variantId?: string | null;
  variantKey?: string | null;
  attemptNumber: number;
  sourceWorkspaceRoot?: string | null;
  liveWorkspaceConfirmed?: boolean;
  liveWorkspaceReason?: string | null;
  runtimeLimits?: ExperimentAttemptRuntimeLimits | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  cleanupTempWorkspace?: boolean;
  signal?: AbortSignal | null;
  executor: ExperimentAttemptExecutor;
};

export type RunExperimentAttemptResult = {
  experiment: ExperimentRecord;
  executionRunId: string;
  traceRoute: string;
  status: ExperimentAttemptStatus;
  workspaceRef: string;
  workspaceRoot: string;
  tempRoot: string | null;
  cleanedUp: boolean;
  contextId: string;
  transcriptEventCount: number;
};

type ExperimentSourceSnapshot = {
  sourceType: string;
  sourceRunId: string | null;
  sourceEvalCaseId: string | null;
  sourceTaskId: string | null;
  traceRoute: string | null;
  sourceSnapshot: Record<string, unknown>;
  sourceSnapshotSha256: string | null;
};

type AttemptTaskContext = {
  taskId: string;
  taskKey: string | null;
  taskTitle: string | null;
  agentId: string | null;
  companySlug: string;
};

type WorkspaceLease = {
  mode: ExperimentWorkspaceModeKey;
  cwd: string;
  ref: string;
  tempRoot: string | null;
  cleanup: () => boolean;
};

type AttemptUsage = {
  iterations: number;
  costUsd: number;
  tokens: number;
};

class ExperimentAttemptLimitError extends Error {
  readonly status: ExperimentAttemptStatus;
  readonly code: string;

  constructor(code: string, message: string, status: ExperimentAttemptStatus = "timed_out") {
    super(message);
    this.name = "ExperimentAttemptLimitError";
    this.code = code;
    this.status = status;
  }
}

function compactText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseRecord(raw: string | null | undefined): Record<string, unknown> {
  const source = raw?.trim();
  if (!source) return {};
  try {
    const parsed: unknown = JSON.parse(source);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function numericMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function redactedPayload<T>(value: T, label: string): { value: T; redaction: RunTraceRedactionSummary } {
  const redacted = redactRunTracePayload(value);
  assertNoRunTraceCredentialLeak(redacted.value, label);
  return redacted;
}

function runtimeLimits(experimentLimits: ExperimentLimits, input: ExperimentAttemptRuntimeLimits | null | undefined): Required<ExperimentAttemptRuntimeLimits> {
  return {
    timeboxMs: input?.timeboxMs ?? experimentLimits.timeboxMinutes * 60_000,
    maxIterations: input?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    maxCostUsd: input?.maxCostUsd ?? DEFAULT_MAX_COST_USD,
    maxTokens: input?.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

function assertRuntimeLimits(limits: Required<ExperimentAttemptRuntimeLimits>): void {
  if (!Number.isFinite(limits.timeboxMs) || limits.timeboxMs <= 0) {
    throw new OrchestrationApiError(400, "invalid_attempt_timebox", "Attempt timebox must be a positive number of milliseconds");
  }
  if (!Number.isInteger(limits.maxIterations) || limits.maxIterations < 1) {
    throw new OrchestrationApiError(400, "invalid_attempt_iteration_limit", "Attempt iteration limit must be a positive integer");
  }
  if (!Number.isFinite(limits.maxCostUsd) || limits.maxCostUsd < 0) {
    throw new OrchestrationApiError(400, "invalid_attempt_cost_limit", "Attempt cost limit must be zero or greater");
  }
  if (!Number.isInteger(limits.maxTokens) || limits.maxTokens < 0) {
    throw new OrchestrationApiError(400, "invalid_attempt_token_limit", "Attempt token limit must be a non-negative integer");
  }
}

function loadExperimentSources(db: Database.Database, experimentId: string): ExperimentSourceSnapshot[] {
  const rows = db
    .prepare(
      `SELECT source_type, source_run_id, source_eval_case_id, source_task_id,
              trace_route, source_snapshot_json, source_snapshot_sha256
       FROM experiment_sources
       WHERE experiment_id = ?
       ORDER BY created_at ASC`,
    )
    .all(experimentId) as Array<{
      source_type: string;
      source_run_id: string | null;
      source_eval_case_id: string | null;
      source_task_id: string | null;
      trace_route: string | null;
      source_snapshot_json: string;
      source_snapshot_sha256: string | null;
    }>;

  return rows.map((row) => ({
    sourceType: row.source_type,
    sourceRunId: row.source_run_id,
    sourceEvalCaseId: row.source_eval_case_id,
    sourceTaskId: row.source_task_id,
    traceRoute: row.trace_route,
    sourceSnapshot: parseRecord(row.source_snapshot_json),
    sourceSnapshotSha256: row.source_snapshot_sha256,
  }));
}

function resolveVariant(experiment: ExperimentRecord, input: RunExperimentAttemptInput): ExperimentVariantRecord {
  const id = compactText(input.variantId);
  const key = compactText(input.variantKey);
  const variant = id
    ? experiment.variants.find((item) => item.id === id)
    : key
      ? experiment.variants.find((item) => item.key === key)
      : null;
  if (!variant) {
    throw new OrchestrationApiError(404, "experiment_variant_not_found", "Experiment variant not found");
  }
  return variant;
}

function resolveTaskContext(db: Database.Database, experiment: ExperimentRecord): AttemptTaskContext {
  if (!experiment.sourceTaskId) {
    throw new OrchestrationApiError(
      409,
      "experiment_attempt_source_task_required",
      "Experiment attempt execution requires a source task so the attempt can create a traceable execution run",
    );
  }
  const row = db
    .prepare(
      `SELECT t.id, t.task_key, t.title, t.assignee_agent_id, c.slug AS company_slug
       FROM tasks t
       INNER JOIN companies c ON c.id = t.company_id
       WHERE t.id = ?
       LIMIT 1`,
    )
    .get(experiment.sourceTaskId) as {
      id: string;
      task_key: string | null;
      title: string | null;
      assignee_agent_id: string | null;
      company_slug: string;
    } | undefined;
  if (!row) {
    throw new OrchestrationApiError(404, "experiment_attempt_source_task_not_found", "Experiment source task was not found");
  }
  return {
    taskId: row.id,
    taskKey: row.task_key,
    taskTitle: row.title,
    agentId: row.assignee_agent_id,
    companySlug: row.company_slug,
  };
}

function copyWorkspace(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const relative = path.relative(source, sourcePath);
      if (!relative) return true;
      const firstPart = relative.split(path.sep)[0];
      return ![".git", ".next", ".stable", "node_modules"].includes(firstPart);
    },
  });
}

function createSnapshotWorkspace(sourceWorkspaceRoot: string): WorkspaceLease {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-experiment-snapshot-"));
  const cwd = path.join(tempRoot, "workspace");
  copyWorkspace(sourceWorkspaceRoot, cwd);
  return {
    mode: "snapshot",
    cwd,
    tempRoot,
    ref: `snapshot:${cwd}`,
    cleanup: () => cleanupTempRoot(tempRoot),
  };
}

function createBranchWorkspace(sourceWorkspaceRoot: string, experimentId: string, attemptNumber: number): WorkspaceLease {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "hiverunner-experiment-branch-"));
  const cwd = path.join(tempRoot, "workspace");
  const branchName = `hiverunner-exp-${experimentId.slice(0, 8)}-attempt-${attemptNumber}-${randomUUID().slice(0, 8)}`;
  const worktree = spawnSync("git", ["-C", sourceWorkspaceRoot, "worktree", "add", "--detach", cwd, "HEAD"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (worktree.status === 0) {
    spawnSync("git", ["-C", cwd, "checkout", "-b", branchName], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return {
      mode: "branch",
      cwd,
      tempRoot,
      ref: `branch:${branchName}:${cwd}`,
      cleanup: () => {
        spawnSync("git", ["-C", sourceWorkspaceRoot, "worktree", "remove", "--force", cwd], {
          encoding: "utf8",
          stdio: "pipe",
        });
        // `worktree remove` detaches the worktree but leaves the throwaway
        // branch registered in the source repo. Delete it so isolated attempts
        // do not accumulate `hiverunner-exp-*` refs in the operator workspace.
        spawnSync("git", ["-C", sourceWorkspaceRoot, "branch", "-D", branchName], {
          encoding: "utf8",
          stdio: "pipe",
        });
        return cleanupTempRoot(tempRoot);
      },
    };
  }

  copyWorkspace(sourceWorkspaceRoot, cwd);
  return {
    mode: "branch",
    cwd,
    tempRoot,
    ref: `branch:${branchName}:${cwd}:copy-fallback`,
    cleanup: () => cleanupTempRoot(tempRoot),
  };
}

function cleanupTempRoot(tempRoot: string): boolean {
  rmSync(tempRoot, { recursive: true, force: true });
  return !existsSync(tempRoot);
}

function createWorkspaceLease(
  mode: ExperimentWorkspaceModeKey,
  sourceWorkspaceRoot: string,
  experimentId: string,
  attemptNumber: number,
): WorkspaceLease {
  if (mode === "snapshot") return createSnapshotWorkspace(sourceWorkspaceRoot);
  if (mode === "branch") return createBranchWorkspace(sourceWorkspaceRoot, experimentId, attemptNumber);
  return {
    mode: "live",
    cwd: sourceWorkspaceRoot,
    tempRoot: null,
    ref: `live:${sourceWorkspaceRoot}`,
    cleanup: () => true,
  };
}

function buildTraceRoute(taskContext: AttemptTaskContext, executionRunId: string): string {
  if (taskContext.taskKey) {
    return `/companies/${encodeURIComponent(taskContext.companySlug)}/tasks/${encodeURIComponent(taskContext.taskKey)}/runs/${encodeURIComponent(executionRunId)}`;
  }
  return `/companies/${encodeURIComponent(taskContext.companySlug)}/runs/${encodeURIComponent(executionRunId)}`;
}

function insertExecutionRun(input: {
  db: Database.Database;
  experiment: ExperimentRecord;
  variant: ExperimentVariantRecord;
  taskContext: AttemptTaskContext;
  attemptNumber: number;
  runnerProvider: string;
  runnerModel: string | null;
  workspaceRef: string;
  startedAt: string;
}): string {
  const id = randomUUID();
  input.db.prepare(
    `INSERT INTO execution_runs (
       id, task_id, agent_id, provider, execution_engine, runner_provider,
       runner_model, model_lane, fallback_used, route_attempts_json, session_id,
       status, started_at, token_usage_json, idempotency_key, metadata_json,
       created_at, updated_at
     )
     VALUES (?, ?, ?, 'symphony', 'symphony', ?, ?, 'default', 0, '[]', ?,
       'running', ?, '{}', ?, ?, ?, ?)`,
  ).run(
    id,
    input.taskContext.taskId,
    input.taskContext.agentId,
    input.runnerProvider,
    input.runnerModel,
    `experiment-attempt:${id}`,
    input.startedAt,
    `experiment-attempt:${input.experiment.id}:${input.variant.id}:${input.attemptNumber}`,
    JSON.stringify({
      schema: "hiverunner.experiment_attempt_execution_run.v1",
      experimentId: input.experiment.id,
      variantId: input.variant.id,
      variantKey: input.variant.key,
      attemptNumber: input.attemptNumber,
      workspaceMode: input.experiment.workspaceMode,
      workspaceRef: input.workspaceRef,
    }),
    input.startedAt,
    input.startedAt,
  );
  return id;
}

function updateExecutionRun(input: {
  db: Database.Database;
  executionRunId: string;
  status: "completed" | "failed" | "cancelled";
  completedAt: string;
  startedAt: string;
  errorMessage: string | null;
  tokenUsage: Record<string, unknown>;
  failureClass: string | null;
}): void {
  input.db.prepare(
    `UPDATE execution_runs
     SET status = ?,
         completed_at = ?,
         error_message = ?,
         token_usage_json = ?,
         duration_ms = ?,
         failure_class = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.status,
    input.completedAt,
    input.errorMessage,
    JSON.stringify(input.tokenUsage),
    Math.max(0, Date.parse(input.completedAt) - Date.parse(input.startedAt)),
    input.failureClass,
    input.completedAt,
    input.executionRunId,
  );
}

function buildContextSnapshot(input: {
  contextId: string;
  experiment: ExperimentRecord;
  variant: ExperimentVariantRecord;
  attemptNumber: number;
  workspace: WorkspaceLease;
  sources: ExperimentSourceSnapshot[];
  limits: Required<ExperimentAttemptRuntimeLimits>;
  builtAt: string;
}): Record<string, unknown> {
  return {
    schema: ATTEMPT_CONTEXT_SCHEMA,
    contextId: input.contextId,
    builtAt: input.builtAt,
    experiment: {
      id: input.experiment.id,
      sourceKind: input.experiment.sourceKind,
      objective: input.experiment.objective,
      objectiveKind: input.experiment.objectiveKind,
      workspaceMode: input.experiment.workspaceMode,
      primarySourceRunId: input.experiment.primarySourceRunId,
      primarySourceEvalCaseId: input.experiment.primarySourceEvalCaseId,
      sourceTaskId: input.experiment.sourceTaskId,
      sourceTraceRoute: input.experiment.sourceTraceRoute,
    },
    variant: {
      id: input.variant.id,
      key: input.variant.key,
      name: input.variant.name,
      changeType: input.variant.changeType,
      plannedChange: input.variant.plannedChange,
    },
    attempt: {
      number: input.attemptNumber,
    },
    workspace: {
      mode: input.workspace.mode,
      ref: input.workspace.ref,
      cwd: input.workspace.cwd,
      tempRoot: input.workspace.tempRoot,
    },
    sourceSnapshots: input.sources,
    limits: input.limits,
  };
}

function enforceReportedMetrics(metrics: Record<string, unknown>, usage: AttemptUsage, limits: Required<ExperimentAttemptRuntimeLimits>): void {
  const reportedIterations = numericMetric(metrics.iterations);
  const reportedCost = numericMetric(metrics.totalCostUsd);
  const reportedTokens = numericMetric(metrics.totalTokens);
  const iterations = Math.max(usage.iterations, reportedIterations ?? 0);
  const costUsd = Math.max(usage.costUsd, reportedCost ?? 0);
  const tokens = Math.max(usage.tokens, reportedTokens ?? 0);

  if (iterations > limits.maxIterations) {
    throw new ExperimentAttemptLimitError("attempt_iteration_limit_exceeded", "Attempt execution exceeded its iteration limit");
  }
  if (costUsd > limits.maxCostUsd) {
    throw new ExperimentAttemptLimitError("attempt_cost_limit_exceeded", "Attempt execution exceeded its cost limit", "cancelled");
  }
  if (tokens > limits.maxTokens) {
    throw new ExperimentAttemptLimitError("attempt_token_limit_exceeded", "Attempt execution exceeded its token limit", "cancelled");
  }
}

async function runWithLimits(input: {
  executor: ExperimentAttemptExecutor;
  executorContext: ExperimentAttemptExecutorContext;
  limits: Required<ExperimentAttemptRuntimeLimits>;
}): Promise<ExperimentAttemptExecutorResult> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let abortHandler: (() => void) | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    if (input.executorContext.signal.aborted) {
      reject(new ExperimentAttemptLimitError("attempt_cancelled", "Attempt execution was cancelled", "cancelled"));
      return;
    }
    timeout = setTimeout(() => {
      reject(new ExperimentAttemptLimitError("attempt_timebox_exceeded", "Attempt execution exceeded its wall-clock timebox"));
    }, input.limits.timeboxMs);
    abortHandler = () => {
      if (timeout) clearTimeout(timeout);
      reject(new ExperimentAttemptLimitError("attempt_cancelled", "Attempt execution was cancelled", "cancelled"));
    };
    input.executorContext.signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => input.executor(input.executorContext)),
      timeoutPromise,
    ]);
    return result ?? {};
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortHandler) {
      input.executorContext.signal.removeEventListener("abort", abortHandler);
    }
  }
}

function createLimitControls(limits: Required<ExperimentAttemptRuntimeLimits>): {
  usage: AttemptUsage;
  recordIteration: ExperimentAttemptExecutorContext["recordIteration"];
} {
  const usage: AttemptUsage = { iterations: 0, costUsd: 0, tokens: 0 };
  return {
    usage,
    recordIteration: (increment = {}) => {
      usage.iterations += 1;
      usage.costUsd += increment.costUsd ?? 0;
      usage.tokens += increment.tokens ?? 0;
      if (usage.iterations > limits.maxIterations) {
        throw new ExperimentAttemptLimitError("attempt_iteration_limit_exceeded", "Attempt execution exceeded its iteration limit");
      }
      if (usage.costUsd > limits.maxCostUsd) {
        throw new ExperimentAttemptLimitError("attempt_cost_limit_exceeded", "Attempt execution exceeded its cost limit", "cancelled");
      }
      if (usage.tokens > limits.maxTokens) {
        throw new ExperimentAttemptLimitError("attempt_token_limit_exceeded", "Attempt execution exceeded its token limit", "cancelled");
      }
    },
  };
}

function terminalAttemptStatus(result: ExperimentAttemptExecutorResult): ExperimentAttemptStatus {
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "failed") return "failed";
  return "succeeded";
}

function terminalExecutionRunStatus(status: ExperimentAttemptStatus): "completed" | "failed" | "cancelled" {
  if (status === "succeeded") return "completed";
  if (status === "cancelled") return "cancelled";
  return "failed";
}

export async function runExperimentAttempt(
  input: RunExperimentAttemptInput,
  db = getOrchestrationDb(),
): Promise<RunExperimentAttemptResult> {
  const experiment = getExperiment(input.companyIdOrSlug, input.experimentId, db);
  const variant = resolveVariant(experiment, input);
  const limits = runtimeLimits(experiment.limits, input.runtimeLimits);
  assertRuntimeLimits(limits);

  if (experiment.workspaceMode === "live" && input.liveWorkspaceConfirmed !== true) {
    throw new OrchestrationApiError(
      409,
      "live_workspace_requires_governed_selection",
      "Live experiment attempts require explicit governed operator selection",
    );
  }

  const sourceWorkspaceRoot = compactText(input.sourceWorkspaceRoot) ?? process.cwd();
  const taskContext = resolveTaskContext(db, experiment);
  const sources = loadExperimentSources(db, experiment.id);
  const workspace = createWorkspaceLease(experiment.workspaceMode, sourceWorkspaceRoot, experiment.id, input.attemptNumber);
  const cleanupTempWorkspace = input.cleanupTempWorkspace !== false && experiment.workspaceMode !== "live";
  const startedAt = new Date().toISOString();
  const runnerProvider = compactText(input.runnerProvider) ?? DEFAULT_RUNNER_PROVIDER;
  const runnerModel = compactText(input.runnerModel);
  const contextId = randomUUID();
  const contextSnapshot = buildContextSnapshot({
    contextId,
    experiment,
    variant,
    attemptNumber: input.attemptNumber,
    workspace,
    sources,
    limits,
    builtAt: startedAt,
  });
  const redactedContext = redactedPayload(contextSnapshot, "Experiment attempt context snapshot");
  const controller = new AbortController();
  const externalSignal = input.signal ?? null;
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  externalSignal?.addEventListener("abort", () => controller.abort(externalSignal.reason), { once: true });

  let cleanedUp = false;
  let executionRunId = "";
  let traceRoute = "";
  let terminalStatus: ExperimentAttemptStatus = "failed";
  let transcriptEventCount = 0;
  let finalResult: Omit<RunExperimentAttemptResult, "cleanedUp"> | null = null;

  try {
    recordExperimentAttempt({
      companyIdOrSlug: input.companyIdOrSlug,
      experimentId: experiment.id,
      variantId: variant.id,
      attemptNumber: input.attemptNumber,
      status: "queued",
      workspaceMode: experiment.workspaceMode,
      workspaceRef: workspace.ref,
      contextSnapshot: redactedContext.value,
      liveWorkspaceConfirmed: input.liveWorkspaceConfirmed,
      liveWorkspaceReason: input.liveWorkspaceReason,
    }, db);

    executionRunId = insertExecutionRun({
      db,
      experiment,
      variant,
      taskContext,
      attemptNumber: input.attemptNumber,
      runnerProvider,
      runnerModel,
      workspaceRef: workspace.ref,
      startedAt,
    });
    traceRoute = buildTraceRoute(taskContext, executionRunId);

    recordExperimentAttempt({
      companyIdOrSlug: input.companyIdOrSlug,
      experimentId: experiment.id,
      variantId: variant.id,
      attemptNumber: input.attemptNumber,
      status: "running",
      workspaceMode: experiment.workspaceMode,
      workspaceRef: workspace.ref,
      contextSnapshot: redactedContext.value,
      executionRunId,
      traceRoute,
      liveWorkspaceConfirmed: input.liveWorkspaceConfirmed,
      liveWorkspaceReason: input.liveWorkspaceReason,
    }, db);

    const traceEvents: unknown[] = [];
    const { usage, recordIteration } = createLimitControls(limits);
    const executorResult = await runWithLimits({
      executor: input.executor,
      limits,
      executorContext: {
        experiment,
        variant,
        attemptNumber: input.attemptNumber,
        workspace: {
          mode: workspace.mode,
          cwd: workspace.cwd,
          ref: workspace.ref,
          tempRoot: workspace.tempRoot,
        },
        contextSnapshot: redactedContext.value,
        limits,
        signal: controller.signal,
        recordIteration,
        recordTraceEvent: (event) => traceEvents.push(event),
      },
    });

    const metrics = {
      ...(executorResult.metrics ?? {}),
      iterations: Math.max(usage.iterations, numericMetric(executorResult.metrics?.iterations) ?? 0),
      totalCostUsd: Math.max(usage.costUsd, numericMetric(executorResult.metrics?.totalCostUsd) ?? 0),
      totalTokens: Math.max(usage.tokens, numericMetric(executorResult.metrics?.totalTokens) ?? 0),
    };
    enforceReportedMetrics(metrics, usage, limits);

    terminalStatus = terminalAttemptStatus(executorResult);
    const completedAt = new Date().toISOString();
    const allTraceEvents = [
      ...traceEvents,
      ...(Array.isArray(executorResult.transcriptEvents) ? executorResult.transcriptEvents : []),
    ];
    const redactedTranscript = redactedPayload(allTraceEvents, "Experiment attempt transcript events");
    transcriptEventCount = persistExecutionTranscriptEvents({
      db,
      executionRunId,
      provider: runnerProvider,
      events: redactedTranscript.value,
      occurredAt: completedAt,
    });

    const comparisonSnapshot = redactedPayload({
      schema: ATTEMPT_TRACE_SCHEMA,
      status: terminalStatus,
      resultText: executorResult.resultText ?? "",
      verification: executorResult.verification ?? {},
      metrics,
      trace: {
        executionRunId,
        traceRoute,
        transcriptEventCount,
        redaction: redactedTranscript.redaction,
      },
    }, "Experiment attempt comparison snapshot");

    updateExecutionRun({
      db,
      executionRunId,
      status: terminalExecutionRunStatus(terminalStatus),
      completedAt,
      startedAt,
      errorMessage: compactText(executorResult.errorMessage),
      tokenUsage: metrics,
      failureClass: terminalStatus === "succeeded" ? null : terminalStatus,
    });

    const updated = recordExperimentAttempt({
      companyIdOrSlug: input.companyIdOrSlug,
      experimentId: experiment.id,
      variantId: variant.id,
      attemptNumber: input.attemptNumber,
      status: terminalStatus,
      workspaceMode: experiment.workspaceMode,
      workspaceRef: workspace.ref,
      contextSnapshot: redactedContext.value,
      comparisonSnapshot: comparisonSnapshot.value,
      executionRunId,
      traceRoute,
      errorMessage: compactText(executorResult.errorMessage),
      liveWorkspaceConfirmed: input.liveWorkspaceConfirmed,
      liveWorkspaceReason: input.liveWorkspaceReason,
    }, db);

    finalResult = {
      experiment: updated,
      executionRunId,
      traceRoute,
      status: terminalStatus,
      workspaceRef: workspace.ref,
      workspaceRoot: workspace.cwd,
      tempRoot: workspace.tempRoot,
      contextId,
      transcriptEventCount,
    };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const limitError = error instanceof ExperimentAttemptLimitError ? error : null;
    terminalStatus = limitError?.status ?? "failed";
    const message = error instanceof Error ? error.message : String(error);

    if (executionRunId) {
      updateExecutionRun({
        db,
        executionRunId,
        status: terminalExecutionRunStatus(terminalStatus),
        completedAt,
        startedAt,
        errorMessage: message,
        tokenUsage: {
          errorCode: limitError?.code ?? "experiment_attempt_failed",
        },
        failureClass: limitError?.code ?? terminalStatus,
      });
      traceRoute ||= buildTraceRoute(taskContext, executionRunId);
      const comparisonSnapshot = redactedPayload({
        schema: ATTEMPT_TRACE_SCHEMA,
        status: terminalStatus,
        error: {
          code: limitError?.code ?? "experiment_attempt_failed",
          message,
        },
        trace: {
          executionRunId,
          traceRoute,
        },
      }, "Experiment failed attempt comparison snapshot");

      const updated = recordExperimentAttempt({
        companyIdOrSlug: input.companyIdOrSlug,
        experimentId: experiment.id,
        variantId: variant.id,
        attemptNumber: input.attemptNumber,
        status: terminalStatus,
        workspaceMode: experiment.workspaceMode,
        workspaceRef: workspace.ref,
        contextSnapshot: redactedContext.value,
        comparisonSnapshot: comparisonSnapshot.value,
        executionRunId,
        traceRoute,
        errorMessage: message,
        liveWorkspaceConfirmed: input.liveWorkspaceConfirmed,
        liveWorkspaceReason: input.liveWorkspaceReason,
      }, db);

      finalResult = {
        experiment: updated,
        executionRunId,
        traceRoute,
        status: terminalStatus,
        workspaceRef: workspace.ref,
        workspaceRoot: workspace.cwd,
        tempRoot: workspace.tempRoot,
        contextId,
        transcriptEventCount,
      };
    }

    if (!finalResult) {
      throw error;
    }
  } finally {
    if (cleanupTempWorkspace && workspace.tempRoot) {
      cleanedUp = workspace.cleanup();
    }
  }
  if (!finalResult) {
    throw new OrchestrationApiError(500, "experiment_attempt_run_missing_result", "Experiment attempt did not produce a result");
  }
  return {
    ...finalResult,
    cleanedUp,
  };
}
