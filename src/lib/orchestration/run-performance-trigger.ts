import Database from "better-sqlite3";

import { getOrchestrationDb } from "./db";
import {
  suggestImprovementRecommendation,
  type ImproveEvidenceInput,
  type SuggestImprovementRecommendationResult,
} from "./improvement-recommendations";

/**
 * Run performance trigger ("slow_expensive_run").
 *
 * Watches completed execution runs and raises an Improve recommendation when a
 * run is a duration or token outlier versus the efficiency baseline proven by
 * INS-G006 (46.7K fresh input tokens/task after the 60% reduction; 117K was the
 * pre-fix average). Fresh input = inputTokens minus cacheReadInputTokens, so
 * prompt-cache hits are not punished.
 */

export const RUN_PERFORMANCE_TRIGGER_KEY = "slow_expensive_run" as const;

export const INS_G006_BASELINE_FRESH_INPUT_TOKENS = 46_700;

export type RunPerformanceThresholds = {
  /** Completed-run wall clock above this is "slow". Default ≈ 1.5x the p95 (13.2 min) of the first 525 instrumented runs. */
  maxDurationMs: number;
  /** Fresh (non-cache-read) input tokens above this is "expensive". Default = pre-INS-G006 average, 2.5x the proven baseline. */
  maxFreshInputTokens: number;
};

export const DEFAULT_RUN_PERFORMANCE_THRESHOLDS: RunPerformanceThresholds = {
  maxDurationMs: 1_200_000,
  maxFreshInputTokens: 117_000,
};

/** Either metric at or beyond this multiple of its threshold escalates severity to high. */
const HIGH_SEVERITY_MULTIPLE = 2;

export type RunPerformanceMetrics = {
  durationMs: number | null;
  inputTokens: number | null;
  cacheReadTokens: number;
  freshInputTokens: number | null;
  outputTokens: number | null;
  hasTokenData: boolean;
};

export type RunPerformanceOutlierReason = "slow" | "expensive";

export type RunPerformanceEvaluation = {
  isOutlier: boolean;
  reasons: RunPerformanceOutlierReason[];
  severity: "medium" | "high";
  baselineMultiple: number | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberFromUsage(usage: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = finiteNumber(usage[key]);
    if (value !== null) return value;
  }
  return null;
}

function parseUsage(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Key lists mirror cost-ledger.ts normalization so every provider that reports
 * usage (codex CLI camelCase, anthropic bridge, snake_case writers) is read the
 * same way the cost ledger reads it.
 */
export function extractRunPerformanceMetrics(run: {
  duration_ms: number | null;
  token_usage_json: string | null;
}): RunPerformanceMetrics {
  const usage = parseUsage(run.token_usage_json);
  const inputTokens = numberFromUsage(usage, ["totalInputTokens", "inputTokens", "input_tokens"]);
  const outputTokens = numberFromUsage(usage, ["totalOutputTokens", "outputTokens", "output_tokens"]);
  const cacheReadTokens = numberFromUsage(usage, [
    "cacheReadTokens",
    "cachedReadTokens",
    "cacheReadInputTokens",
    "cache_read_tokens",
  ]) ?? 0;
  const freshInputTokens = inputTokens === null ? null : Math.max(0, inputTokens - cacheReadTokens);
  return {
    durationMs: finiteNumber(run.duration_ms),
    inputTokens,
    cacheReadTokens,
    freshInputTokens,
    outputTokens,
    hasTokenData: inputTokens !== null || outputTokens !== null,
  };
}

function thresholdOverride(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value) ?? (typeof value === "string" ? finiteNumber(Number(value)) : null);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

/** Per-company overrides come from improvement_trigger_controls.threshold_json; anything missing falls back to defaults. */
export function resolveRunPerformanceThresholds(
  db: Database.Database,
  companyId: string,
): RunPerformanceThresholds {
  const row = db
    .prepare("SELECT threshold_json FROM improvement_trigger_controls WHERE company_id = ? AND trigger_key = ? LIMIT 1")
    .get(companyId, RUN_PERFORMANCE_TRIGGER_KEY) as { threshold_json: string | null } | undefined;
  const stored = parseUsage(row?.threshold_json);
  return {
    maxDurationMs: thresholdOverride(stored.maxDurationMs, DEFAULT_RUN_PERFORMANCE_THRESHOLDS.maxDurationMs),
    maxFreshInputTokens: thresholdOverride(
      stored.maxFreshInputTokens,
      DEFAULT_RUN_PERFORMANCE_THRESHOLDS.maxFreshInputTokens,
    ),
  };
}

export function evaluateRunPerformance(
  metrics: RunPerformanceMetrics,
  thresholds: RunPerformanceThresholds = DEFAULT_RUN_PERFORMANCE_THRESHOLDS,
): RunPerformanceEvaluation {
  const reasons: RunPerformanceOutlierReason[] = [];
  let worstMultiple = 0;

  if (metrics.durationMs !== null && metrics.durationMs > thresholds.maxDurationMs) {
    reasons.push("slow");
    worstMultiple = Math.max(worstMultiple, metrics.durationMs / thresholds.maxDurationMs);
  }
  if (metrics.freshInputTokens !== null && metrics.freshInputTokens > thresholds.maxFreshInputTokens) {
    reasons.push("expensive");
    worstMultiple = Math.max(worstMultiple, metrics.freshInputTokens / thresholds.maxFreshInputTokens);
  }

  return {
    isOutlier: reasons.length > 0,
    reasons,
    severity: worstMultiple >= HIGH_SEVERITY_MULTIPLE ? "high" : "medium",
    baselineMultiple: metrics.freshInputTokens === null
      ? null
      : metrics.freshInputTokens / INS_G006_BASELINE_FRESH_INPUT_TOKENS,
  };
}

type ExecutionRunContextRow = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  status: string;
  completed_at: string | null;
  duration_ms: number | null;
  token_usage_json: string | null;
  runner_provider: string | null;
  runner_model: string | null;
  model_lane: string | null;
  task_key: string | null;
  task_title: string | null;
  project_id: string | null;
  task_company_id: string | null;
  agent_company_id: string | null;
  agent_name: string | null;
  agent_role: string | null;
};

export type RunPerformanceTriggerResult = {
  outcome:
    | "skipped_not_found"
    | "skipped_status"
    | "skipped_no_company"
    | "skipped_no_metrics"
    | "below_threshold"
    | SuggestImprovementRecommendationResult["outcome"];
  metrics?: RunPerformanceMetrics;
  evaluation?: RunPerformanceEvaluation;
  thresholds?: RunPerformanceThresholds;
  suggestion?: SuggestImprovementRecommendationResult;
};

function loadRunContext(db: Database.Database, executionRunId: string): ExecutionRunContextRow | undefined {
  return db
    .prepare(
      `SELECT
         r.id, r.task_id, r.agent_id, r.status, r.completed_at, r.duration_ms,
         r.token_usage_json, r.runner_provider, r.runner_model, r.model_lane,
         t.task_key AS task_key,
         t.title AS task_title,
         t.project_id AS project_id,
         p.company_id AS task_company_id,
         a.company_id AS agent_company_id,
         a.name AS agent_name,
         a.role AS agent_role
       FROM execution_runs r
       LEFT JOIN tasks t ON t.id = r.task_id
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN agents a ON a.id = r.agent_id
       WHERE r.id = ?
       LIMIT 1`,
    )
    .get(executionRunId) as ExecutionRunContextRow | undefined;
}

function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min`;
}

function tokens(count: number): string {
  return count >= 1_000 ? `${(count / 1_000).toFixed(1)}K` : String(count);
}

function breachSummaryParts(
  metrics: RunPerformanceMetrics,
  evaluation: RunPerformanceEvaluation,
  thresholds: RunPerformanceThresholds,
): string[] {
  const parts: string[] = [];
  if (evaluation.reasons.includes("slow") && metrics.durationMs !== null) {
    parts.push(`took ${minutes(metrics.durationMs)} (threshold ${minutes(thresholds.maxDurationMs)})`);
  }
  if (evaluation.reasons.includes("expensive") && metrics.freshInputTokens !== null) {
    parts.push(
      `used ${tokens(metrics.freshInputTokens)} fresh input tokens (threshold ${tokens(thresholds.maxFreshInputTokens)}, INS-G006 baseline ${tokens(INS_G006_BASELINE_FRESH_INPUT_TOKENS)})`,
    );
  }
  return parts;
}

function outlierEvidence(
  run: ExecutionRunContextRow,
  metrics: RunPerformanceMetrics,
  evaluation: RunPerformanceEvaluation,
  reasonParts: string[],
  completedAt: string,
): ImproveEvidenceInput[] {
  return [{
    sourceType: "trace",
    runId: run.id,
    taskId: run.task_id,
    taskKey: run.task_key,
    agentId: run.agent_id,
    title: `${run.task_key ?? "Run"} ${evaluation.reasons.join(" + ")} outlier`,
    summary: [
      `Completed run on ${run.task_key ?? run.id} ${reasonParts.join("; ")}.`,
      metrics.outputTokens !== null ? `Output ${tokens(metrics.outputTokens)} tokens.` : null,
      run.runner_provider ? `Runner ${run.runner_provider}${run.runner_model ? `/${run.runner_model}` : ""}.` : null,
    ].filter(Boolean).join(" "),
    occurredAt: completedAt,
  }];
}

function outlierSuggestionInput(input: {
  companyId: string;
  run: ExecutionRunContextRow;
  metrics: RunPerformanceMetrics;
  evaluation: RunPerformanceEvaluation;
  thresholds: RunPerformanceThresholds;
}): Parameters<typeof suggestImprovementRecommendation>[0] {
  const { companyId, run, metrics, evaluation, thresholds } = input;
  const completedAt = run.completed_at ?? new Date().toISOString();
  const monthBucket = completedAt.slice(0, 7);
  const scope = run.agent_id
    ? { type: "agent" as const, key: run.agent_id }
    : { type: "company" as const, key: companyId };
  const subjectLabel = run.agent_name
    ? `${run.agent_name}${run.agent_role ? ` (${run.agent_role})` : ""}`
    : run.task_key ?? "unassigned runs";
  const reasonParts = breachSummaryParts(metrics, evaluation, thresholds);
  const baselineNote = evaluation.baselineMultiple !== null && evaluation.baselineMultiple > 1
    ? ` That is ${evaluation.baselineMultiple.toFixed(1)}x the proven-achievable fresh-input baseline.`
    : "";

  return {
    companyId,
    triggerKey: RUN_PERFORMANCE_TRIGGER_KEY,
    triggerClass: "run_performance",
    scope,
    title: `Investigate slow/expensive runs by ${subjectLabel}`,
    rationale: `A completed run breached the run-performance thresholds: ${reasonParts.join("; ")}.${baselineNote} Repeated breaches in ${monthBucket} fold into this recommendation; each breach is logged as a trigger firing.`,
    proposedChange: `Review prompt/context assembly and memory loadout for ${subjectLabel} (lane ${run.model_lane ?? "unknown"}, runner ${run.runner_provider ?? "unknown"}). Compare fresh-input spend against the INS-G006 baseline (${tokens(INS_G006_BASELINE_FRESH_INPUT_TOKENS)}/task) and consider trimming injected context, tightening memory relevance, or rerouting the lane.`,
    severity: evaluation.severity,
    confidence: "medium",
    evidence: outlierEvidence(run, metrics, evaluation, reasonParts, completedAt),
    idempotencyKey: `perf_outlier:${companyId}:${scope.key}:${monthBucket}`,
    sourceTaskId: run.task_id,
    sourceRunId: run.id,
    thresholds: {
      maxDurationMs: thresholds.maxDurationMs,
      maxFreshInputTokens: thresholds.maxFreshInputTokens,
    },
    metadata: {
      durationMs: metrics.durationMs,
      freshInputTokens: metrics.freshInputTokens,
      inputTokens: metrics.inputTokens,
      cacheReadTokens: metrics.cacheReadTokens,
      outputTokens: metrics.outputTokens,
      reasons: evaluation.reasons,
      runnerProvider: run.runner_provider,
      runnerModel: run.runner_model,
      modelLane: run.model_lane,
    },
  };
}

/**
 * Evaluate one completed execution run and raise/refresh a slow_expensive_run
 * recommendation when it breaches thresholds. Pause, enable, suppression, and
 * idempotency gating all happen inside suggestImprovementRecommendation; below-
 * threshold runs write nothing at all.
 *
 * Recommendations are agent-scoped with a month-bucketed idempotency key, so a
 * chronically heavy agent yields one open recommendation per month while every
 * outlier run still lands in the trigger-firings log.
 */
export function runPerformanceTriggerForExecutionRun(
  executionRunId: string,
  db: Database.Database = getOrchestrationDb(),
): RunPerformanceTriggerResult {
  const run = loadRunContext(db, executionRunId);
  if (!run) return { outcome: "skipped_not_found" };
  if (run.status !== "completed") return { outcome: "skipped_status" };

  const companyId = run.task_company_id ?? run.agent_company_id;
  if (!companyId) return { outcome: "skipped_no_company" };

  const metrics = extractRunPerformanceMetrics(run);
  if (metrics.durationMs === null && !metrics.hasTokenData) {
    return { outcome: "skipped_no_metrics", metrics };
  }

  const thresholds = resolveRunPerformanceThresholds(db, companyId);
  const evaluation = evaluateRunPerformance(metrics, thresholds);
  if (!evaluation.isOutlier) {
    return { outcome: "below_threshold", metrics, evaluation, thresholds };
  }

  const suggestion = suggestImprovementRecommendation(
    outlierSuggestionInput({ companyId, run, metrics, evaluation, thresholds }),
    db,
  );
  return { outcome: suggestion.outcome, metrics, evaluation, thresholds, suggestion };
}

export type RunPerformanceSweepResult = {
  scanned: number;
  outliers: number;
  outcomes: Record<string, number>;
};

/**
 * Manual/backfill sweep over recent completed runs. Not wired to any schedule —
 * the engine hook in finishRun covers live runs; this exists for verification
 * and one-time backfills (operator-invoked).
 */
export function sweepCompletedRunsForPerformanceOutliers(
  options: { sinceIso?: string; limit?: number } = {},
  db: Database.Database = getOrchestrationDb(),
): RunPerformanceSweepResult {
  const limit = Math.max(1, Math.min(2_000, Math.trunc(options.limit ?? 500)));
  const rows = db
    .prepare(
      `SELECT id FROM execution_runs
       WHERE status = 'completed'
         AND (? IS NULL OR completed_at >= ?)
       ORDER BY completed_at DESC
       LIMIT ?`,
    )
    .all(options.sinceIso ?? null, options.sinceIso ?? null, limit) as Array<{ id: string }>;

  const outcomes: Record<string, number> = {};
  let outliers = 0;
  for (const row of rows) {
    const result = runPerformanceTriggerForExecutionRun(row.id, db);
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    if (result.evaluation?.isOutlier) outliers += 1;
  }
  return { scanned: rows.length, outliers, outcomes };
}
