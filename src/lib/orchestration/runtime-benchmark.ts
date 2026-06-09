import type Database from "better-sqlite3";

import { EXECUTION_FAILURE_CLASS } from "@/lib/orchestration/execution-failure-class";

export type RuntimeBenchmarkScope = {
  goalKey: string;
  goalSprintId: string;
  sprintIds: string[];
  taskIds: string[];
  companyIds: string[];
  runStartedAt: string | null;
  runEndedAt: string | null;
  overseerScope: "company_all_turns";
};

export type RuntimeUsageTotals = {
  inputTokens: number;
  cacheReadInputTokens: number;
  freshInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
};

type RuntimeExecutionUsageValidation = {
  completedRunCount: number;
  withUsageCount: number;
  missingUsageCount: number;
  invalidUsageCount: number;
  missingUsageRunIds: string[];
  invalidUsageRunIds: string[];
};

export type RuntimeFinalTaskStatusMetrics = {
  total: number;
  done: number;
  nonDone: number;
  missingStatusCount: number;
  blockedWithoutReason: number;
  byStatus: Record<string, number>;
  nonDoneTaskKeys: string[];
  blockedWithoutReasonTaskKeys: string[];
};

export type RuntimeFailureBuckets = {
  deterministicPreflight: number;
  intentionalCancellation: number;
  runtimeQuality: number;
};

export type RuntimeRepeatedFailure = {
  taskKey: string | null;
  failureSignature: string;
  count: number;
};

export type RuntimeActionLedgerMetrics = {
  total: number;
  terminal: number;
  nonTerminalParsed: number;
  parseFailed: number;
  pendingApproval: number;
  untracked: number;
};

export type RuntimeBrowserProofMetrics = {
  total: number;
  succeeded: number;
  failed: number;
  succeededUnder30s: number;
  maxDurationMs: number;
};

export type RuntimeBenchmarkArm = "baseline" | "candidate";

export type RuntimeBenchmarkProtocol = {
  fixtureId: string | null;
  arm: RuntimeBenchmarkArm | null;
  repeatIndex: number | null;
  requiredRepeats: number;
  expectedTaskCount: number;
  frozenTaskKeys: string[];
};

export type RuntimeLatencyPercentiles = {
  sampleCount: number;
  medianMs: number | null;
  p95Ms: number | null;
};

export type RuntimeLatencyMetrics = {
  firstEvidenceMs: RuntimeLatencyPercentiles;
  detectUnhealthyMs: RuntimeLatencyPercentiles;
};

/**
 * Counts of the runtime-platform safety signals observed within the summary's run
 * window, derived from real DB rows (not asserted). Used to attest that the
 * marquee safety features actually fired. detect-unhealthy lives on
 * `latency.detectUnhealthyMs.sampleCount` and overseer turns on
 * `overseerTurnCount`/`overseerUsage`; this struct carries the two that had no home.
 */
export type RuntimeSafetySignalCounts = {
  /** runtime_preflight_results rows with classification='deterministic_preflight' (circuit opened). */
  preflightCircuitOpenCount: number;
  /** distinct runtime_fingerprint values among those circuit-open rows (>1 row/fingerprint = churn). */
  preflightDistinctFingerprintCount: number;
  /** execution_runs rows with fallback_used=1 (a provider fallback was taken). */
  fallbackUsedCount: number;
};

export type RuntimeBenchmarkSummary = {
  scope: RuntimeBenchmarkScope;
  protocol: RuntimeBenchmarkProtocol;
  finalTaskStatus: RuntimeFinalTaskStatusMetrics;
  taskCount: number;
  executionRunCount: number;
  completedRunCount: number;
  nonCompletedRunCount: number;
  tasksWithBreakdowns: number;
  tasksWithMultipleRuns: number;
  averageRunsPerTask: number;
  recordedDurationMs: number;
  executionUsage: RuntimeUsageTotals;
  executionUsageValidation: RuntimeExecutionUsageValidation;
  overseerTurnCount: number;
  overseerUsage: RuntimeUsageTotals;
  combinedUsage: RuntimeUsageTotals;
  failureBuckets: RuntimeFailureBuckets;
  repeatedFailures: RuntimeRepeatedFailure[];
  actionLedger: RuntimeActionLedgerMetrics;
  browserProof: RuntimeBrowserProofMetrics;
  latency: RuntimeLatencyMetrics;
  safetySignals: RuntimeSafetySignalCounts;
};

export type RuntimePromotionGateCheck = {
  name: string;
  ok: boolean;
  value: string | number;
  threshold: string | number;
  detail?: string;
};

export type RuntimePromotionGateResult = {
  ok: boolean;
  checks: RuntimePromotionGateCheck[];
};

export type RuntimePromotionEvidenceCheck = {
  ok: boolean;
  source: string;
  count?: number;
  detail?: string;
};

/**
 * Attestations that each runtime safety signal fired in a dedicated demonstration
 * run. Built from a real demo summary via buildSafetySignalEvidenceFromSummary
 * (the counts come from DB rows, not hand-assertion). The promotion gate requires
 * all four. `count` is the observed row/sample count; `detail` records the source
 * run window and, for overseerWatch, the token total vs the ceiling.
 */
export type RuntimePromotionSafetySignalEvidence = {
  preflightCircuitOpen?: RuntimePromotionEvidenceCheck;
  detectUnhealthy?: RuntimePromotionEvidenceCheck;
  overseerWatch?: RuntimePromotionEvidenceCheck;
  providerFallback?: RuntimePromotionEvidenceCheck;
};

export type RuntimePromotionEvidence = {
  schema?: string;
  uiConsistency?: RuntimePromotionEvidenceCheck;
  untrackedActions?: RuntimePromotionEvidenceCheck;
  safetySignals?: RuntimePromotionSafetySignalEvidence;
};

export type RuntimePromotionGateOptions = {
  requiredTaskCount?: number;
  requiredRepeats?: number;
  candidateRepeatCount?: number;
  baselineRepeatCount?: number;
  firstEvidenceNoiseMs?: number;
  detectUnhealthyNoiseMs?: number;
  evidence?: RuntimePromotionEvidence | null;
  requireEvidenceProofs?: boolean;
  /** Max FRESH-input overseer-turn tokens allowed for the "low-token watch mode" claim (cache-read excluded). Default 50000. */
  overseerTokenCeiling?: number;
};

/** Default ceiling (fresh input tokens, cache-read excluded) for the bounded overseer watch-turn safety check. */
export const DEFAULT_OVERSEER_TOKEN_CEILING = 50_000;

export type RuntimeBenchmarkSummaryOptions = {
  fixtureId?: string | null;
  arm?: RuntimeBenchmarkArm | null;
  repeatIndex?: number | null;
  requiredRepeats?: number;
  expectedTaskCount?: number;
  frozenTaskKeys?: string[];
  taskKeys?: string[];
  runStartedAfter?: string | null;
  runStartedBefore?: string | null;
};

export type RuntimeMetricStats = {
  sampleCount: number;
  median: number | null;
  p95: number | null;
  noise: number;
};

export type RuntimeBenchmarkArmStats = {
  repeatCount: number;
  metrics: Record<string, RuntimeMetricStats>;
};

export type RuntimeBenchmarkPromotionReport = {
  candidate: RuntimeBenchmarkArmStats;
  baseline: RuntimeBenchmarkArmStats;
  gate: RuntimePromotionGateResult;
};

const EMPTY_ACTION_LEDGER_METRICS: RuntimeActionLedgerMetrics = {
  total: 0,
  terminal: 0,
  nonTerminalParsed: 0,
  parseFailed: 0,
  pendingApproval: 0,
  untracked: 0,
};

const EMPTY_BROWSER_PROOF_METRICS: RuntimeBrowserProofMetrics = {
  total: 0,
  succeeded: 0,
  failed: 0,
  succeededUnder30s: 0,
  maxDurationMs: 0,
};

const EMPTY_LATENCY_METRICS: RuntimeLatencyMetrics = {
  firstEvidenceMs: { sampleCount: 0, medianMs: null, p95Ms: null },
  detectUnhealthyMs: { sampleCount: 0, medianMs: null, p95Ms: null },
};

const EMPTY_SAFETY_SIGNALS: RuntimeSafetySignalCounts = {
  preflightCircuitOpenCount: 0,
  preflightDistinctFingerprintCount: 0,
  fallbackUsedCount: 0,
};

const EMPTY_EXECUTION_USAGE_VALIDATION: RuntimeExecutionUsageValidation = {
  completedRunCount: 0,
  withUsageCount: 0,
  missingUsageCount: 0,
  invalidUsageCount: 0,
  missingUsageRunIds: [],
  invalidUsageRunIds: [],
};

const EMPTY_FINAL_TASK_STATUS: RuntimeFinalTaskStatusMetrics = {
  total: 0,
  done: 0,
  nonDone: 0,
  missingStatusCount: 0,
  blockedWithoutReason: 0,
  byStatus: {},
  nonDoneTaskKeys: [],
  blockedWithoutReasonTaskKeys: [],
};

type SprintRow = {
  id: string;
  parent_id: string | null;
};

type TaskRow = {
  id: string;
  task_key: string | null;
  company_id: string | null;
  status: string | null;
  blocked_reason: string | null;
};

type RunRow = {
  id: string;
  task_id: string;
  status: string;
  failure_class: string | null;
  error_message: string | null;
  token_usage_json: string | null;
  duration_ms: number | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
  fallback_used: number | null;
};

type PreflightCircuitRow = {
  runtime_fingerprint: string | null;
};

type OverseerTurnRow = {
  usage_json: string | null;
};

type RuntimeActionLedgerRow = {
  status: string;
  execution_status?: string | null;
  task_id: string | null;
  execution_run_id: string | null;
  heartbeat_run_id: string | null;
  overseer_turn_id: string | null;
};

type RuntimeBrowserProofAuditRow = {
  status: string;
  duration_ms: number | null;
};

type RuntimeLatencyEventRow = {
  execution_run_id: string;
  occurred_at: string | null;
};

function actionLedgerExecutionStatus(row: RuntimeActionLedgerRow): string {
  return row.execution_status ?? (row.status === "parsed" ? "not_started" : row.status);
}

type JsonRecord = Record<string, unknown>;

const USAGE_VALUE_KEYS = [
  "inputTokens",
  "input_tokens",
  "promptTokens",
  "prompt_tokens",
  "totalInputTokens",
  "cacheReadInputTokens",
  "cache_read_input_tokens",
  "cacheReadTokens",
  "cache_read_tokens",
  "cachedInputTokens",
  "cached_input_tokens",
  "outputTokens",
  "output_tokens",
  "completionTokens",
  "completion_tokens",
  "totalTokens",
  "total_tokens",
];

function safeJson(value: string | null | undefined): JsonRecord {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : {};
  } catch {
    return {};
  }
}

function firstNumber(record: JsonRecord, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function parseUsageRecord(value: string | null | undefined): { record: JsonRecord | null; invalid: boolean } {
  if (value === null || value === undefined || !value.trim()) {
    return { record: null, invalid: false };
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { record: null, invalid: true };
    }
    return { record: parsed as JsonRecord, invalid: false };
  } catch {
    return { record: null, invalid: true };
  }
}

function usageRecordHasNonNullUsage(record: JsonRecord): { hasUsage: boolean; invalid: boolean } {
  let invalid = false;
  for (const key of USAGE_VALUE_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "number") {
      if (Number.isFinite(value)) return { hasUsage: true, invalid: false };
      invalid = true;
      continue;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return { hasUsage: true, invalid: false };
      invalid = true;
      continue;
    }
    invalid = true;
  }
  return { hasUsage: false, invalid };
}

function executionUsageValidationForRuns(runRows: RunRow[]): RuntimeExecutionUsageValidation {
  const validation: RuntimeExecutionUsageValidation = {
    completedRunCount: 0,
    withUsageCount: 0,
    missingUsageCount: 0,
    invalidUsageCount: 0,
    missingUsageRunIds: [],
    invalidUsageRunIds: [],
  };

  for (const run of runRows) {
    if (run.status !== "completed") continue;
    validation.completedRunCount += 1;
    const parsed = parseUsageRecord(run.token_usage_json);
    if (parsed.invalid || !parsed.record) {
      const target = parsed.invalid ? validation.invalidUsageRunIds : validation.missingUsageRunIds;
      target.push(run.id);
      if (parsed.invalid) validation.invalidUsageCount += 1;
      else validation.missingUsageCount += 1;
      continue;
    }
    const usageStatus = usageRecordHasNonNullUsage(parsed.record);
    if (usageStatus.hasUsage) {
      validation.withUsageCount += 1;
    } else if (usageStatus.invalid) {
      validation.invalidUsageCount += 1;
      validation.invalidUsageRunIds.push(run.id);
    } else {
      validation.missingUsageCount += 1;
      validation.missingUsageRunIds.push(run.id);
    }
  }

  return validation;
}

export function usageTotalsFromJson(rows: Array<{ usage_json?: string | null; token_usage_json?: string | null }>): RuntimeUsageTotals {
  let inputTokens = 0;
  let cacheReadInputTokens = 0;
  let freshInputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCostUsd = 0;
  let hasEstimatedCost = false;

  for (const row of rows) {
    const record = safeJson(row.token_usage_json ?? row.usage_json ?? null);
    const input = firstNumber(record, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens", "totalInputTokens"]);
    const cacheRead = firstNumber(record, [
      "cacheReadInputTokens",
      "cache_read_input_tokens",
      "cacheReadTokens",
      "cache_read_tokens",
      "cachedInputTokens",
      "cached_input_tokens",
    ]);
    const output = firstNumber(record, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
    const total = firstNumber(record, ["totalTokens", "total_tokens"]);
    const cost = firstNumber(record, ["totalCostUsd", "costUsd", "estimatedCostUsd"]);

    inputTokens += input;
    cacheReadInputTokens += cacheRead;
    freshInputTokens += Math.max(0, input - cacheRead);
    outputTokens += output;
    totalTokens += total || input + output;
    if (cost > 0) {
      estimatedCostUsd += cost;
      hasEstimatedCost = true;
    }
  }

  return {
    inputTokens,
    cacheReadInputTokens,
    freshInputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: hasEstimatedCost ? estimatedCostUsd : null,
  };
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function taskDisplayKey(task: Pick<TaskRow, "id" | "task_key">): string {
  return task.task_key ?? task.id;
}

function normalizedTaskStatus(status: string | null | undefined): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized || "missing";
}

function sortedStatusCounts(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function statusCountsSummary(counts: Record<string, number>): string {
  const entries = Object.entries(sortedStatusCounts(counts));
  return entries.length > 0
    ? entries.map(([status, count]) => `${status}:${count}`).join(", ")
    : "none";
}

function finalTaskStatusMetricsForTasks(taskRows: TaskRow[]): RuntimeFinalTaskStatusMetrics {
  const counts: Record<string, number> = {};
  const nonDoneTaskKeys: string[] = [];
  const blockedWithoutReasonTaskKeys: string[] = [];
  let done = 0;
  let missingStatusCount = 0;

  for (const task of taskRows) {
    const status = normalizedTaskStatus(task.status);
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === "done") {
      done += 1;
    } else {
      nonDoneTaskKeys.push(taskDisplayKey(task));
    }
    if (status === "missing") {
      missingStatusCount += 1;
    }
    if (status === "blocked" && !String(task.blocked_reason ?? "").trim()) {
      blockedWithoutReasonTaskKeys.push(taskDisplayKey(task));
    }
  }

  return {
    total: taskRows.length,
    done,
    nonDone: taskRows.length - done,
    missingStatusCount,
    blockedWithoutReason: blockedWithoutReasonTaskKeys.length,
    byStatus: sortedStatusCounts(counts),
    nonDoneTaskKeys,
    blockedWithoutReasonTaskKeys,
  };
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function nullableColumnSelect(db: Database.Database, tableName: string, columnName: string): string {
  return hasColumn(db, tableName, columnName) ? columnName : `NULL AS ${columnName}`;
}

function appendCreatedAtWindow(
  db: Database.Database,
  tableName: string,
  where: string[],
  params: unknown[],
  after: string | null,
  before: string | null,
): void {
  if (!hasColumn(db, tableName, "created_at")) return;
  if (after) {
    where.push("created_at >= ?");
    params.push(after);
  }
  if (before) {
    where.push("created_at < ?");
    params.push(before);
  }
}

function dateMax(values: Array<string | null>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered.sort().at(-1) ?? null : null;
}

function dateMin(values: Array<string | null>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered.sort()[0] ?? null : null;
}

function normalizeTaskKeyList(taskKeys: string[] | undefined): string[] {
  return Array.from(new Set((taskKeys ?? []).map((key) => key.trim()).filter(Boolean))).sort();
}

function assertValidIsoBoundary(value: string | null | undefined, label: string): string | null {
  if (!value) return null;
  if (timestampMs(value) === null) {
    throw new Error(`${label} must be an ISO timestamp, received ${value}`);
  }
  return value;
}

export function classifyRunFailure(run: Pick<RunRow, "status" | "failure_class" | "error_message">): keyof RuntimeFailureBuckets | null {
  if (run.status === "completed") return null;

  const failureClass = (run.failure_class ?? "").toLowerCase();
  const message = (run.error_message ?? "").toLowerCase();
  const combined = `${failureClass} ${message}`;

  if (
    failureClass === EXECUTION_FAILURE_CLASS.deterministicPreflight ||
    failureClass === EXECUTION_FAILURE_CLASS.circuitBlocked ||
    failureClass === "runtime_error" ||
    combined.includes("env: node: no such file") ||
    combined.includes("err_module_not_found") ||
    combined.includes("module_not_found") ||
    combined.includes("project directory does not exist") ||
    combined.includes("no such file or directory")
  ) {
    return "deterministicPreflight";
  }

  if (
    run.status === "cancelled" &&
    (
      failureClass === "coalesced" ||
      failureClass === EXECUTION_FAILURE_CLASS.coalesced ||
      failureClass === EXECUTION_FAILURE_CLASS.operatorCancellation ||
      failureClass === EXECUTION_FAILURE_CLASS.taskTransitionCancellation ||
      failureClass === EXECUTION_FAILURE_CLASS.budgetThresholdBlocked ||
      failureClass === EXECUTION_FAILURE_CLASS.budgetOverrideRequired ||
      failureClass === EXECUTION_FAILURE_CLASS.protectedRuntimeApprovalRequired ||
      combined.includes("task transitioned") ||
      combined.includes("requires approval") ||
      combined.includes("coalesced") ||
      combined.includes("cleanup-orphan") ||
      combined.includes("duplicate") ||
      combined.includes("load-balancing") ||
      combined.includes("runtime reroute")
    )
  ) {
    return "intentionalCancellation";
  }

  return "runtimeQuality";
}

function failureSignature(run: RunRow): string {
  const message = (run.error_message ?? "").replace(/\s+/g, " ").trim();
  const normalizedMessage = message
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\bPID \d+\b/g, "PID <pid>")
    .replace(/\b\d{4}-\d{2}-\d{2}T[0-9:.]+Z\b/g, "<timestamp>");
  return [
    run.status || "unknown",
    run.failure_class || "none",
    normalizedMessage.slice(0, 220) || "no-message",
  ].join(" | ");
}

function collectChildSprintIds(rows: SprintRow[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const current = childrenByParent.get(row.parent_id) ?? [];
    current.push(row.id);
    childrenByParent.set(row.parent_id, current);
  }

  const result: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (result.includes(id)) continue;
    result.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

function timestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (percentileValue === 0.5 && sorted.length % 2 === 0) {
    const upper = sorted.length / 2;
    return (sorted[upper - 1] + sorted[upper]) / 2;
  }
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

function latencyPercentiles(values: number[]): RuntimeLatencyPercentiles {
  return {
    sampleCount: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  };
}

function earliestEventByRun(rows: RuntimeLatencyEventRow[]): Map<string, number> {
  const byRun = new Map<string, number>();
  for (const row of rows) {
    const occurredAt = timestampMs(row.occurred_at);
    if (occurredAt === null) continue;
    const current = byRun.get(row.execution_run_id);
    if (current === undefined || occurredAt < current) {
      byRun.set(row.execution_run_id, occurredAt);
    }
  }
  return byRun;
}

function mergeEarliestEventMaps(maps: Array<Map<string, number>>): Map<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [runId, occurredAt] of map.entries()) {
      const current = merged.get(runId);
      if (current === undefined || occurredAt < current) {
        merged.set(runId, occurredAt);
      }
    }
  }
  return merged;
}

function elapsedFromRunStart(run: RunRow, eventMs: number | undefined): number | null {
  if (eventMs === undefined) return null;
  const startMs = timestampMs(run.started_at ?? run.created_at);
  if (startMs === null) return null;
  return Math.max(0, eventMs - startMs);
}

function latencyMetricsForRuns(
  db: Database.Database,
  runRows: RunRow[],
  runIds: string[],
): RuntimeLatencyMetrics {
  if (runIds.length === 0) return EMPTY_LATENCY_METRICS;
  const runPlaceholders = placeholders(runIds.length);

  const firstEvidenceMaps: Array<Map<string, number>> = [];
  if (hasTable(db, "execution_run_transcript_events")) {
    firstEvidenceMaps.push(earliestEventByRun(
      db
        .prepare(
          `SELECT execution_run_id, MIN(occurred_at) AS occurred_at
             FROM execution_run_transcript_events
            WHERE execution_run_id IN (${runPlaceholders})
              AND LOWER(event_kind) NOT IN ('thinking_summary', 'reasoning')
            GROUP BY execution_run_id`,
        )
        .all(...runIds) as RuntimeLatencyEventRow[],
    ));
  }
  if (
    hasTable(db, "runtime_action_ledger") &&
    hasColumn(db, "runtime_action_ledger", "execution_run_id") &&
    hasColumn(db, "runtime_action_ledger", "created_at")
  ) {
    firstEvidenceMaps.push(earliestEventByRun(
      db
        .prepare(
          `SELECT execution_run_id, MIN(created_at) AS occurred_at
             FROM runtime_action_ledger
            WHERE execution_run_id IN (${runPlaceholders})
            GROUP BY execution_run_id`,
        )
        .all(...runIds) as RuntimeLatencyEventRow[],
    ));
  }
  if (hasTable(db, "runtime_browser_proof_audit") && hasColumn(db, "runtime_browser_proof_audit", "execution_run_id")) {
    firstEvidenceMaps.push(earliestEventByRun(
      db
        .prepare(
          `SELECT execution_run_id, MIN(created_at) AS occurred_at
             FROM runtime_browser_proof_audit
            WHERE execution_run_id IN (${runPlaceholders})
            GROUP BY execution_run_id`,
        )
        .all(...runIds) as RuntimeLatencyEventRow[],
    ));
  }
  const firstEvidenceByRun = mergeEarliestEventMaps(firstEvidenceMaps);

  const unhealthyMaps: Array<Map<string, number>> = [];
  if (hasTable(db, "execution_run_attempt_events")) {
    unhealthyMaps.push(earliestEventByRun(
      db
        .prepare(
          `SELECT execution_run_id, MIN(created_at) AS occurred_at
             FROM execution_run_attempt_events
            WHERE execution_run_id IN (${runPlaceholders})
              AND event_type IN ('preflight_blocked', 'watchdog_timeout', 'failed', 'cancelled', 'task.execution.failed')
            GROUP BY execution_run_id`,
        )
        .all(...runIds) as RuntimeLatencyEventRow[],
    ));
  }
  const unhealthyByRun = mergeEarliestEventMaps(unhealthyMaps);

  const firstEvidenceValues = runRows
    .map((run) => elapsedFromRunStart(run, firstEvidenceByRun.get(run.id)))
    .filter((value): value is number => value !== null);
  const unhealthyValues = runRows
    .filter((run) => classifyRunFailure(run) === "runtimeQuality")
    .map((run) => {
      const detectedAt = unhealthyByRun.get(run.id)
        ?? timestampMs(run.completed_at ?? run.updated_at ?? run.created_at)
        ?? undefined;
      return elapsedFromRunStart(run, detectedAt);
    })
    .filter((value): value is number => value !== null);

  return {
    firstEvidenceMs: latencyPercentiles(firstEvidenceValues),
    detectUnhealthyMs: latencyPercentiles(unhealthyValues),
  };
}

export function buildRuntimeBenchmarkSummary(
  db: Database.Database,
  goalKey: string,
  options: RuntimeBenchmarkSummaryOptions = {},
): RuntimeBenchmarkSummary {
  const goal = db.prepare("SELECT id FROM sprints WHERE goal_key = ? LIMIT 1").get(goalKey) as { id: string } | undefined;
  if (!goal) {
    throw new Error(`Goal sprint not found for goal key ${goalKey}`);
  }

  const sprintRows = db.prepare("SELECT id, parent_id FROM sprints").all() as SprintRow[];
  const sprintIds = collectChildSprintIds(sprintRows, goal.id);
  const allTaskRows = db
    .prepare(
      `SELECT id,
              task_key,
              company_id,
              ${nullableColumnSelect(db, "tasks", "status")},
              ${nullableColumnSelect(db, "tasks", "blocked_reason")}
         FROM tasks
        WHERE sprint_id IN (${placeholders(sprintIds.length)})`,
    )
    .all(...sprintIds) as TaskRow[];
  const requestedTaskKeys = normalizeTaskKeyList(options.taskKeys);
  const taskRows = requestedTaskKeys.length > 0
    ? allTaskRows.filter((row) => row.task_key !== null && requestedTaskKeys.includes(row.task_key))
    : allTaskRows;
  if (requestedTaskKeys.length > 0) {
    const foundTaskKeys = new Set(taskRows.map((row) => row.task_key).filter((key): key is string => Boolean(key)));
    const missingTaskKeys = requestedTaskKeys.filter((key) => !foundTaskKeys.has(key));
    if (missingTaskKeys.length > 0) {
      throw new Error(`Frozen fixture task keys not found under ${goalKey}: ${missingTaskKeys.join(", ")}`);
    }
  }
  const taskIds = taskRows.map((row) => row.id);
  const runStartedAfter = assertValidIsoBoundary(options.runStartedAfter, "runStartedAfter");
  const runStartedBefore = assertValidIsoBoundary(options.runStartedBefore, "runStartedBefore");

  let runRows: RunRow[] = [];
  if (taskIds.length > 0) {
    const runWhere = [`task_id IN (${placeholders(taskIds.length)})`];
    const runParams: unknown[] = [...taskIds];
    if (runStartedAfter) {
      runWhere.push("COALESCE(started_at, created_at) >= ?");
      runParams.push(runStartedAfter);
    }
    if (runStartedBefore) {
      runWhere.push("COALESCE(started_at, created_at) < ?");
      runParams.push(runStartedBefore);
    }
    runRows = db
      .prepare(`SELECT * FROM execution_runs WHERE ${runWhere.join(" AND ")}`)
      .all(...runParams) as RunRow[];
  }
  const runIds = runRows.map((run) => run.id);

  const runStartedAt = dateMin(runRows.map((run) => run.started_at ?? run.created_at));
  const runEndedAt = dateMax(runRows.map((run) => run.completed_at ?? run.updated_at ?? run.created_at));
  const companyIds = unique(taskRows.map((row) => row.company_id));

  let overseerTurns: OverseerTurnRow[] = [];
  if (companyIds.length > 0) {
    const turnWhere = [`company_id IN (${placeholders(companyIds.length)})`];
    const turnParams: unknown[] = [...companyIds];
    if (runStartedAfter) {
      turnWhere.push("created_at >= ?");
      turnParams.push(runStartedAfter);
    }
    if (runStartedBefore) {
      turnWhere.push("created_at < ?");
      turnParams.push(runStartedBefore);
    }
    overseerTurns = db
      .prepare(`SELECT usage_json FROM overseer_turns WHERE ${turnWhere.join(" AND ")}`)
      .all(...turnParams) as OverseerTurnRow[];
  }

  const runsByTask = new Map<string, RunRow[]>();
  for (const run of runRows) {
    const current = runsByTask.get(run.task_id) ?? [];
    current.push(run);
    runsByTask.set(run.task_id, current);
  }

  const failureBuckets: RuntimeFailureBuckets = {
    deterministicPreflight: 0,
    intentionalCancellation: 0,
    runtimeQuality: 0,
  };
  const repeatedFailureMap = new Map<string, { taskKey: string | null; failureSignature: string; count: number }>();
  const taskKeyById = new Map(taskRows.map((task) => [task.id, task.task_key] as const));

  for (const run of runRows) {
    const bucket = classifyRunFailure(run);
    if (bucket) failureBuckets[bucket] += 1;
    if (run.status !== "completed") {
      const signature = failureSignature(run);
      const key = `${run.task_id}\0${signature}`;
      const current = repeatedFailureMap.get(key) ?? {
        taskKey: taskKeyById.get(run.task_id) ?? null,
        failureSignature: signature,
        count: 0,
      };
      current.count += 1;
      repeatedFailureMap.set(key, current);
    }
  }

  const executionUsage = usageTotalsFromJson(runRows.map((run) => ({ token_usage_json: run.token_usage_json })));
  const executionUsageValidation = executionUsageValidationForRuns(runRows);
  const overseerUsage = usageTotalsFromJson(overseerTurns.map((turn) => ({ usage_json: turn.usage_json })));
  let actionLedgerRows: RuntimeActionLedgerRow[] = [];
  if (taskIds.length > 0 && hasTable(db, "runtime_action_ledger")) {
    const actionWhere = [`task_id IN (${placeholders(taskIds.length)})`];
    const actionParams: unknown[] = [...taskIds];
    appendCreatedAtWindow(db, "runtime_action_ledger", actionWhere, actionParams, runStartedAfter, runStartedBefore);
    actionLedgerRows = db
      .prepare(
        `SELECT status,
                ${nullableColumnSelect(db, "runtime_action_ledger", "execution_status")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "task_id")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "execution_run_id")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "heartbeat_run_id")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "overseer_turn_id")}
           FROM runtime_action_ledger
          WHERE ${actionWhere.join(" AND ")}`,
      )
      .all(...actionParams) as RuntimeActionLedgerRow[];
  }
  let browserProofRows: RuntimeBrowserProofAuditRow[] = [];
  if (taskIds.length > 0 && hasTable(db, "runtime_browser_proof_audit")) {
    const proofWhere = [`task_id IN (${placeholders(taskIds.length)})`];
    const proofParams: unknown[] = [...taskIds];
    appendCreatedAtWindow(db, "runtime_browser_proof_audit", proofWhere, proofParams, runStartedAfter, runStartedBefore);
    browserProofRows = db
      .prepare(`SELECT status, duration_ms FROM runtime_browser_proof_audit WHERE ${proofWhere.join(" AND ")}`)
      .all(...proofParams) as RuntimeBrowserProofAuditRow[];
  }
  const executionLinkedActionRows = runIds.length > 0
    && hasTable(db, "runtime_action_ledger")
    && hasColumn(db, "runtime_action_ledger", "execution_run_id")
    ? db
      .prepare(
        `SELECT status,
                ${nullableColumnSelect(db, "runtime_action_ledger", "execution_status")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "task_id")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "execution_run_id")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "heartbeat_run_id")},
                ${nullableColumnSelect(db, "runtime_action_ledger", "overseer_turn_id")}
           FROM runtime_action_ledger
          WHERE execution_run_id IN (${placeholders(runIds.length)}) AND task_id IS NULL`,
      )
      .all(...runIds) as RuntimeActionLedgerRow[]
    : [];
  actionLedgerRows.push(...executionLinkedActionRows);
  const executionLinkedBrowserProofRows = runIds.length > 0
    && hasTable(db, "runtime_browser_proof_audit")
    && hasColumn(db, "runtime_browser_proof_audit", "execution_run_id")
    ? db
      .prepare(
        `SELECT status, duration_ms
           FROM runtime_browser_proof_audit
          WHERE execution_run_id IN (${placeholders(runIds.length)}) AND task_id IS NULL`,
      )
      .all(...runIds) as RuntimeBrowserProofAuditRow[]
    : [];
  browserProofRows.push(...executionLinkedBrowserProofRows);
  const latency = latencyMetricsForRuns(db, runRows, runIds);

  // Safety signal #4 (provider fallback): execution_runs.fallback_used=1 in window.
  const fallbackUsedCount = runRows.filter((run) => Number(run.fallback_used) === 1).length;
  // Safety signal #1 (deterministic preflight circuit-break): runtime_preflight_results
  // rows with classification='deterministic_preflight' in the run window. Scoped by the
  // created_at window only (NOT task_id) — a fingerprint circuit row can have task_id=NULL,
  // and the demo run window already isolates these rows.
  let preflightCircuitOpenCount = 0;
  let preflightDistinctFingerprintCount = 0;
  if (hasTable(db, "runtime_preflight_results")) {
    const preflightWhere = ["classification = 'deterministic_preflight'"];
    const preflightParams: unknown[] = [];
    appendCreatedAtWindow(db, "runtime_preflight_results", preflightWhere, preflightParams, runStartedAfter, runStartedBefore);
    const preflightRows = db
      .prepare(`SELECT runtime_fingerprint FROM runtime_preflight_results WHERE ${preflightWhere.join(" AND ")}`)
      .all(...preflightParams) as PreflightCircuitRow[];
    preflightCircuitOpenCount = preflightRows.length;
    preflightDistinctFingerprintCount = unique(preflightRows.map((row) => row.runtime_fingerprint)).length;
  }

  const expectedTaskCount = options.expectedTaskCount ?? 10;
  const frozenTaskKeys = options.frozenTaskKeys
    ?? (requestedTaskKeys.length > 0
      ? requestedTaskKeys
      : taskRows.length === expectedTaskCount
      ? taskRows.map((task) => task.task_key ?? task.id).sort()
      : []);
  const finalTaskStatus = finalTaskStatusMetricsForTasks(taskRows);

  return {
    scope: {
      goalKey,
      goalSprintId: goal.id,
      sprintIds,
      taskIds,
      companyIds,
      runStartedAt,
      runEndedAt,
      overseerScope: "company_all_turns",
    },
    protocol: {
      fixtureId: options.fixtureId ?? null,
      arm: options.arm ?? null,
      repeatIndex: options.repeatIndex ?? null,
      requiredRepeats: options.requiredRepeats ?? 3,
      expectedTaskCount,
      frozenTaskKeys,
    },
    finalTaskStatus,
    taskCount: taskRows.length,
    executionRunCount: runRows.length,
    completedRunCount: runRows.filter((run) => run.status === "completed").length,
    nonCompletedRunCount: runRows.filter((run) => run.status !== "completed").length,
    tasksWithBreakdowns: Array.from(runsByTask.values()).filter((runs) => runs.some((run) => run.status !== "completed")).length,
    tasksWithMultipleRuns: Array.from(runsByTask.values()).filter((runs) => runs.length > 1).length,
    averageRunsPerTask: taskRows.length > 0 ? runRows.length / taskRows.length : 0,
    recordedDurationMs: runRows.reduce((sum, run) => sum + Math.max(0, run.duration_ms ?? 0), 0),
    executionUsage,
    executionUsageValidation,
    overseerTurnCount: overseerTurns.length,
    overseerUsage,
    combinedUsage: {
      inputTokens: executionUsage.inputTokens + overseerUsage.inputTokens,
      cacheReadInputTokens: executionUsage.cacheReadInputTokens + overseerUsage.cacheReadInputTokens,
      freshInputTokens: executionUsage.freshInputTokens + overseerUsage.freshInputTokens,
      outputTokens: executionUsage.outputTokens + overseerUsage.outputTokens,
      totalTokens: executionUsage.totalTokens + overseerUsage.totalTokens,
      estimatedCostUsd:
        executionUsage.estimatedCostUsd === null && overseerUsage.estimatedCostUsd === null
          ? null
          : (executionUsage.estimatedCostUsd ?? 0) + (overseerUsage.estimatedCostUsd ?? 0),
    },
    failureBuckets,
    repeatedFailures: Array.from(repeatedFailureMap.values())
      .filter((entry) => entry.count > 1)
      .sort((a, b) => b.count - a.count || String(a.taskKey).localeCompare(String(b.taskKey))),
    safetySignals: {
      preflightCircuitOpenCount,
      preflightDistinctFingerprintCount,
      fallbackUsedCount,
    },
    actionLedger: {
      total: actionLedgerRows.length,
      terminal: actionLedgerRows.filter((row) => actionLedgerExecutionStatus(row) !== "not_started").length,
      nonTerminalParsed: actionLedgerRows.filter((row) => actionLedgerExecutionStatus(row) === "not_started").length,
      parseFailed: actionLedgerRows.filter((row) => actionLedgerExecutionStatus(row) === "parse_failed").length,
      pendingApproval: actionLedgerRows.filter((row) => actionLedgerExecutionStatus(row) === "pending_approval").length,
      untracked: actionLedgerRows.filter((row) => !row.task_id && !row.execution_run_id && !row.heartbeat_run_id && !row.overseer_turn_id).length,
    },
    browserProof: {
      total: browserProofRows.length,
      succeeded: browserProofRows.filter((row) => row.status === "succeeded").length,
      failed: browserProofRows.filter((row) => row.status === "failed").length,
      succeededUnder30s: browserProofRows.filter((row) => row.status === "succeeded" && (row.duration_ms ?? Number.POSITIVE_INFINITY) <= 30_000).length,
      maxDurationMs: browserProofRows.reduce((max, row) => Math.max(max, row.duration_ms ?? 0), 0),
    },
    latency,
  };
}

/**
 * Fresh (billable) input tokens per COMPLETED task — the goal-spec metric (Sprint 4
 * acceptance #238: "fresh/billable input per completed task"). Divides fresh input by
 * the number of tasks that reached `done`, so a build that burns tokens without
 * finishing tasks (or re-runs them) is correctly charged for that waste. Returns
 * Infinity when nothing completed. NOTE: this intentionally divides by completed
 * tasks, not by execution runs — dividing by runs measures cost-per-invocation and
 * washes out the runs-per-task win; see freshInputPerCompletedRun for that view.
 */
function freshInputPerCompletedTask(summary: RuntimeBenchmarkSummary): number {
  const completedTasks = summary.finalTaskStatus?.done ?? 0;
  return completedTasks > 0 ? summary.combinedUsage.freshInputTokens / completedTasks : Number.POSITIVE_INFINITY;
}

/** Fresh input per completed execution run (cost per agent invocation). Reported for transparency; not gated. */
function freshInputPerCompletedRun(summary: RuntimeBenchmarkSummary): number {
  return summary.completedRunCount > 0 ? summary.combinedUsage.freshInputTokens / summary.completedRunCount : Number.POSITIVE_INFINITY;
}

/** Fresh input per fixture task (every task counts, completed or not). Reported for transparency; not gated. */
function freshInputPerFixtureTask(summary: RuntimeBenchmarkSummary): number {
  return summary.taskCount > 0 ? summary.combinedUsage.freshInputTokens / summary.taskCount : Number.POSITIVE_INFINITY;
}

function executionUsageValidationForSummary(summary: RuntimeBenchmarkSummary): RuntimeExecutionUsageValidation | null {
  return summary.executionUsageValidation ?? null;
}

function finalTaskStatusForSummary(summary: RuntimeBenchmarkSummary): RuntimeFinalTaskStatusMetrics | null {
  return summary.finalTaskStatus ?? null;
}

function completedRunUsageEvidenceCheck(summary: RuntimeBenchmarkSummary, label: string): RuntimePromotionGateCheck {
  const validation = executionUsageValidationForSummary(summary);
  if (!validation) {
    return {
      name: `${label} completed runs have no missing_usage/invalid usage`,
      ok: false,
      value: "missing validation",
      threshold: "0 missing_usage/invalid",
      detail: "summary does not include executionUsageValidation evidence",
    };
  }

  const missingOrInvalid = validation.missingUsageCount + validation.invalidUsageCount;
  const countMatches = validation.completedRunCount === summary.completedRunCount
    && validation.withUsageCount + missingOrInvalid === validation.completedRunCount;
  const sampleRunIds = [...validation.missingUsageRunIds, ...validation.invalidUsageRunIds].slice(0, 5);
  return {
    name: `${label} completed runs have no missing_usage/invalid usage`,
    ok: countMatches && missingOrInvalid === 0,
    value: missingOrInvalid,
    threshold: "0 missing_usage/invalid",
    detail: countMatches
      ? `${validation.withUsageCount}/${validation.completedRunCount} completed runs have non-null usage${sampleRunIds.length > 0 ? `; sample run ids ${sampleRunIds.join(", ")}` : ""}`
      : `usage validation covers ${validation.completedRunCount}/${summary.completedRunCount} completed runs`,
  };
}

function finalTaskStatusEvidenceCheck(summary: RuntimeBenchmarkSummary, label: string): RuntimePromotionGateCheck {
  const finalStatus = finalTaskStatusForSummary(summary);
  if (!finalStatus) {
    return {
      name: `${label} final fixture tasks are all done`,
      ok: false,
      value: "missing final task status evidence",
      threshold: "all done",
      detail: "summary does not include finalTaskStatus evidence",
    };
  }

  const statusCounts = statusCountsSummary(finalStatus.byStatus);
  const countMatches = finalStatus.total === summary.taskCount && finalStatus.done + finalStatus.nonDone === finalStatus.total;
  const nonDoneSample = finalStatus.nonDoneTaskKeys.slice(0, 8);
  const blockedWithoutReasonSample = finalStatus.blockedWithoutReasonTaskKeys.slice(0, 8);
  const details = [
    countMatches
      ? `${finalStatus.done}/${finalStatus.total} final tasks done`
      : `final task status covers ${finalStatus.total}/${summary.taskCount} tasks`,
    `status counts ${statusCounts}`,
  ];
  if (nonDoneSample.length > 0) details.push(`non-done task keys ${nonDoneSample.join(", ")}`);
  if (blockedWithoutReasonSample.length > 0) details.push(`blocked without reason ${blockedWithoutReasonSample.join(", ")}`);

  return {
    name: `${label} final fixture tasks are all done`,
    ok: countMatches && finalStatus.missingStatusCount === 0 && finalStatus.nonDone === 0,
    value: statusCounts,
    threshold: "all done",
    detail: details.join("; "),
  };
}

function repeatedDeterministicEnvFailureCount(summary: RuntimeBenchmarkSummary): number {
  return summary.repeatedFailures.filter((failure) => {
    const signature = failure.failureSignature.toLowerCase();
    return signature.includes("env: node: no such file")
      || signature.includes("module_not_found")
      || signature.includes("no such file or directory");
  }).length;
}

export function evaluateRuntimeBenchmarkPromotionGate(
  summary: RuntimeBenchmarkSummary,
  baseline?: RuntimeBenchmarkSummary | null,
  options: RuntimePromotionGateOptions = {},
): RuntimePromotionGateResult {
  const requiredTaskCount = options.requiredTaskCount ?? summary.protocol?.expectedTaskCount ?? 10;
  const requiredRepeats = options.requiredRepeats ?? 1;
  const candidateRepeatCount = options.candidateRepeatCount ?? 1;
  const baselineRepeatCount = options.baselineRepeatCount ?? (baseline ? 1 : 0);
  const firstEvidence = summary.latency ?? EMPTY_LATENCY_METRICS;
  const baselineFirstEvidence = baseline?.latency ?? EMPTY_LATENCY_METRICS;
  const detectUnhealthy = firstEvidence.detectUnhealthyMs;
  const baselineDetectUnhealthy = baselineFirstEvidence.detectUnhealthyMs;
  const runtimeQualityRate = summary.executionRunCount > 0
    ? summary.failureBuckets.runtimeQuality / summary.executionRunCount
    : 0;
  const checks: RuntimePromotionGateCheck[] = [
    {
      name: "frozen fixture has expected task count",
      ok: summary.taskCount === requiredTaskCount,
      value: summary.taskCount,
      threshold: requiredTaskCount,
      detail: `fixture ${summary.protocol?.fixtureId ?? "unlabeled"}`,
    },
    finalTaskStatusEvidenceCheck(summary, "candidate"),
    {
      name: "candidate repeat protocol satisfied",
      ok: candidateRepeatCount >= requiredRepeats,
      value: candidateRepeatCount,
      threshold: `>= ${requiredRepeats}`,
    },
    {
      name: "baseline repeat protocol satisfied",
      ok: !baseline || baselineRepeatCount >= requiredRepeats,
      value: baseline ? baselineRepeatCount : "missing",
      threshold: `>= ${requiredRepeats}`,
    },
    {
      name: "total runs below 15",
      ok: summary.executionRunCount < 15,
      value: summary.executionRunCount,
      threshold: "< 15",
    },
    {
      name: "average runs per task below 1.5",
      ok: summary.averageRunsPerTask < 1.5,
      value: Number(summary.averageRunsPerTask.toFixed(2)),
      threshold: "< 1.5",
    },
    {
      name: "runtime-quality failures below 5%",
      ok: runtimeQualityRate < 0.05,
      value: `${(runtimeQualityRate * 100).toFixed(1)}%`,
      threshold: "< 5.0%",
    },
    {
      name: "no repeated deterministic env failures",
      ok: repeatedDeterministicEnvFailureCount(summary) === 0,
      value: repeatedDeterministicEnvFailureCount(summary),
      threshold: "0",
    },
    completedRunUsageEvidenceCheck(summary, "candidate"),
    {
      name: "no non-terminal parsed actions",
      ok: summary.actionLedger.nonTerminalParsed === 0,
      value: summary.actionLedger.nonTerminalParsed,
      threshold: "0",
    },
    {
      name: "no untracked action rows",
      ok: (summary.actionLedger.untracked ?? 0) === 0,
      value: summary.actionLedger.untracked ?? 0,
      threshold: "0",
    },
    {
      name: "first-evidence latency samples cover runs",
      ok: firstEvidence.firstEvidenceMs.sampleCount >= summary.executionRunCount,
      value: firstEvidence.firstEvidenceMs.sampleCount,
      threshold: `>= ${summary.executionRunCount}`,
      detail: `p50 ${firstEvidence.firstEvidenceMs.medianMs ?? "n/a"}ms, p95 ${firstEvidence.firstEvidenceMs.p95Ms ?? "n/a"}ms`,
    },
    {
      name: "browser proof succeeded under 30s",
      ok: summary.browserProof.succeededUnder30s > 0,
      value: summary.browserProof.succeededUnder30s,
      threshold: ">= 1",
      detail: `${summary.browserProof.succeeded}/${summary.browserProof.total} proof runs succeeded`,
    },
  ];

  if (options.requireEvidenceProofs) {
    const uiProof = options.evidence?.uiConsistency;
    const actionProof = options.evidence?.untrackedActions;
    checks.push({
      name: "UI consistency proof passed",
      ok: Boolean(uiProof?.ok),
      value: uiProof?.ok ? "pass" : "missing/fail",
      threshold: "pass",
      detail: uiProof?.detail ?? uiProof?.source,
    });
    checks.push({
      name: "untracked-action proof passed",
      ok: Boolean(actionProof?.ok) && (actionProof?.count ?? 0) === 0,
      value: actionProof?.count ?? "missing",
      threshold: "0",
      detail: actionProof?.detail ?? actionProof?.source,
    });
    for (const check of safetySignalChecks(options.evidence, options)) {
      checks.push(check);
    }
  }

  if (baseline) {
    const currentFresh = freshInputPerCompletedTask(summary);
    const baselineFresh = freshInputPerCompletedTask(baseline);
    const firstEvidenceNoise = options.firstEvidenceNoiseMs ?? 0;
    const detectUnhealthyNoise = options.detectUnhealthyNoiseMs ?? 0;
    checks.push({
      ...completedRunUsageEvidenceCheck(baseline, "baseline"),
    });
    checks.push({
      name: "fresh input per completed task reduced by at least 50%",
      ok: Number.isFinite(currentFresh) && Number.isFinite(baselineFresh) && currentFresh <= baselineFresh * 0.5,
      value: Math.round(currentFresh),
      threshold: `<= ${Math.round(baselineFresh * 0.5)}`,
      detail: `baseline ${Math.round(baselineFresh)} fresh tokens/completed task`,
    });
    checks.push({
      name: "average runs per task does not regress",
      ok: summary.averageRunsPerTask <= baseline.averageRunsPerTask,
      value: Number(summary.averageRunsPerTask.toFixed(2)),
      threshold: `<= ${baseline.averageRunsPerTask.toFixed(2)}`,
    });
    checks.push({
      name: "first-evidence p50 not worse beyond replay noise",
      ok: firstEvidence.firstEvidenceMs.medianMs !== null
        && baselineFirstEvidence.firstEvidenceMs.medianMs !== null
        && firstEvidence.firstEvidenceMs.medianMs <= baselineFirstEvidence.firstEvidenceMs.medianMs + firstEvidenceNoise,
      value: firstEvidence.firstEvidenceMs.medianMs ?? "missing",
      threshold: baselineFirstEvidence.firstEvidenceMs.medianMs === null
        ? "baseline missing"
        : `<= ${baselineFirstEvidence.firstEvidenceMs.medianMs + firstEvidenceNoise}`,
      detail: `baseline p50 ${baselineFirstEvidence.firstEvidenceMs.medianMs ?? "n/a"}ms, noise ${firstEvidenceNoise}ms`,
    });
    checks.push({
      name: "first-evidence p95 not worse beyond replay noise",
      ok: firstEvidence.firstEvidenceMs.p95Ms !== null
        && baselineFirstEvidence.firstEvidenceMs.p95Ms !== null
        && firstEvidence.firstEvidenceMs.p95Ms <= baselineFirstEvidence.firstEvidenceMs.p95Ms + firstEvidenceNoise,
      value: firstEvidence.firstEvidenceMs.p95Ms ?? "missing",
      threshold: baselineFirstEvidence.firstEvidenceMs.p95Ms === null
        ? "baseline missing"
        : `<= ${baselineFirstEvidence.firstEvidenceMs.p95Ms + firstEvidenceNoise}`,
      detail: `baseline p95 ${baselineFirstEvidence.firstEvidenceMs.p95Ms ?? "n/a"}ms, noise ${firstEvidenceNoise}ms`,
    });
    checks.push({
      name: "detect-unhealthy p50 not worse beyond replay noise",
      ok: summary.failureBuckets.runtimeQuality === 0
        || (
          detectUnhealthy.medianMs !== null
          && baselineDetectUnhealthy.medianMs !== null
          && detectUnhealthy.medianMs <= baselineDetectUnhealthy.medianMs + detectUnhealthyNoise
        ),
      value: summary.failureBuckets.runtimeQuality === 0 ? "no runtime-quality failures" : detectUnhealthy.medianMs ?? "missing",
      threshold: baselineDetectUnhealthy.medianMs === null
        ? "baseline missing"
        : `<= ${baselineDetectUnhealthy.medianMs + detectUnhealthyNoise}`,
      detail: `baseline p50 ${baselineDetectUnhealthy.medianMs ?? "n/a"}ms, noise ${detectUnhealthyNoise}ms`,
    });
    checks.push({
      name: "detect-unhealthy p95 not worse beyond replay noise",
      ok: summary.failureBuckets.runtimeQuality === 0
        || (
          detectUnhealthy.p95Ms !== null
          && baselineDetectUnhealthy.p95Ms !== null
          && detectUnhealthy.p95Ms <= baselineDetectUnhealthy.p95Ms + detectUnhealthyNoise
        ),
      value: summary.failureBuckets.runtimeQuality === 0 ? "no runtime-quality failures" : detectUnhealthy.p95Ms ?? "missing",
      threshold: baselineDetectUnhealthy.p95Ms === null
        ? "baseline missing"
        : `<= ${baselineDetectUnhealthy.p95Ms + detectUnhealthyNoise}`,
      detail: `baseline p95 ${baselineDetectUnhealthy.p95Ms ?? "n/a"}ms, noise ${detectUnhealthyNoise}ms`,
    });
  } else {
    checks.push({
      name: "controlled baseline provided",
      ok: false,
      value: "missing",
      threshold: "required",
      detail: "Promotion requires a controlled old-on-fixture baseline summary.",
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

function metricStats(values: Array<number | null | undefined>): RuntimeMetricStats {
  const numericValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const median = percentile(numericValues, 0.5);
  return {
    sampleCount: numericValues.length,
    median,
    p95: percentile(numericValues, 0.95),
    noise: median === null ? 0 : numericValues.reduce((max, value) => Math.max(max, Math.abs(value - median)), 0),
  };
}

function runtimeQualityRate(summary: RuntimeBenchmarkSummary): number {
  return summary.executionRunCount > 0 ? summary.failureBuckets.runtimeQuality / summary.executionRunCount : 0;
}

function finalTaskBlockedCount(summary: RuntimeBenchmarkSummary): number | null {
  const finalStatus = finalTaskStatusForSummary(summary);
  return finalStatus ? finalStatus.byStatus.blocked ?? 0 : null;
}

function armStats(summaries: RuntimeBenchmarkSummary[]): RuntimeBenchmarkArmStats {
  return {
    repeatCount: summaries.length,
    metrics: {
      finalTasksDone: metricStats(summaries.map((summary) => finalTaskStatusForSummary(summary)?.done)),
      finalTasksNonDone: metricStats(summaries.map((summary) => finalTaskStatusForSummary(summary)?.nonDone)),
      finalTasksBlocked: metricStats(summaries.map(finalTaskBlockedCount)),
      finalTasksBlockedWithoutReason: metricStats(summaries.map((summary) => finalTaskStatusForSummary(summary)?.blockedWithoutReason)),
      totalRuns: metricStats(summaries.map((summary) => summary.executionRunCount)),
      averageRunsPerTask: metricStats(summaries.map((summary) => summary.averageRunsPerTask)),
      runtimeQualityRate: metricStats(summaries.map(runtimeQualityRate)),
      freshInputPerCompletedTask: metricStats(summaries.map(freshInputPerCompletedTask)),
      freshInputPerCompletedRun: metricStats(summaries.map(freshInputPerCompletedRun)),
      freshInputPerFixtureTask: metricStats(summaries.map(freshInputPerFixtureTask)),
      firstEvidenceP50Ms: metricStats(summaries.map((summary) => summary.latency?.firstEvidenceMs.medianMs)),
      firstEvidenceP95Ms: metricStats(summaries.map((summary) => summary.latency?.firstEvidenceMs.p95Ms)),
      detectUnhealthyP50Ms: metricStats(summaries.map((summary) => summary.latency?.detectUnhealthyMs.medianMs)),
      detectUnhealthyP95Ms: metricStats(summaries.map((summary) => summary.latency?.detectUnhealthyMs.p95Ms)),
    },
  };
}

function metricCheck(input: {
  name: string;
  candidate: RuntimeMetricStats;
  baseline: RuntimeMetricStats;
  threshold: string;
  ok: boolean;
}): RuntimePromotionGateCheck {
  return {
    name: input.name,
    ok: input.ok,
    value: input.candidate.median === null ? "missing" : Number(input.candidate.median.toFixed(2)),
    threshold: input.threshold,
    detail: `candidate p95 ${input.candidate.p95 ?? "n/a"}, baseline median ${input.baseline.median ?? "n/a"}, baseline noise ${input.baseline.noise}`,
  };
}

function repeatedProtocolChecks(input: {
  candidateSummaries: RuntimeBenchmarkSummary[];
  baselineSummaries: RuntimeBenchmarkSummary[];
  requiredRepeats: number;
  requiredTaskCount: number;
  firstEvidenceSampleCount: number;
  firstEvidenceRequiredSamples: number;
}): RuntimePromotionGateCheck[] {
  const candidateFixtureIds = unique(input.candidateSummaries.map((summary) => summary.protocol.fixtureId));
  const baselineFixtureIds = unique(input.baselineSummaries.map((summary) => summary.protocol.fixtureId));
  const fixtureIds = unique([...candidateFixtureIds, ...baselineFixtureIds]);
  const frozenTaskFingerprints = unique([...input.candidateSummaries, ...input.baselineSummaries].map((summary) => (
    summary.protocol.frozenTaskKeys.length > 0 ? summary.protocol.frozenTaskKeys.join("\n") : null
  )));
  return [
    {
      name: "candidate has at least 3 fixture repeats",
      ok: input.candidateSummaries.length >= input.requiredRepeats,
      value: input.candidateSummaries.length,
      threshold: `>= ${input.requiredRepeats}`,
    },
    {
      name: "baseline has at least 3 fixture repeats",
      ok: input.baselineSummaries.length >= input.requiredRepeats,
      value: input.baselineSummaries.length,
      threshold: `>= ${input.requiredRepeats}`,
    },
    {
      name: "candidate summaries use frozen 10-task fixture",
      ok: input.candidateSummaries.length > 0 && input.candidateSummaries.every((summary) => summary.taskCount === input.requiredTaskCount),
      value: input.candidateSummaries.map((summary) => summary.taskCount).join(",") || "missing",
      threshold: input.requiredTaskCount,
    },
    {
      name: "baseline summaries use frozen 10-task fixture",
      ok: input.baselineSummaries.length > 0 && input.baselineSummaries.every((summary) => summary.taskCount === input.requiredTaskCount),
      value: input.baselineSummaries.map((summary) => summary.taskCount).join(",") || "missing",
      threshold: input.requiredTaskCount,
    },
    {
      name: "all repeats share one fixture id",
      ok: fixtureIds.length === 1,
      value: fixtureIds.join(",") || "missing",
      threshold: "one fixture id",
    },
    {
      name: "all repeats share frozen task keys",
      ok: frozenTaskFingerprints.length === 1,
      value: frozenTaskFingerprints.length,
      threshold: 1,
      detail: frozenTaskFingerprints.length === 1
        ? `${frozenTaskFingerprints[0].split("\n").length} frozen keys`
        : "fixture task-key fingerprints differ or are missing",
    },
    {
      name: "candidate first-evidence samples cover all runs",
      ok: input.firstEvidenceSampleCount >= input.firstEvidenceRequiredSamples,
      value: input.firstEvidenceSampleCount,
      threshold: `>= ${input.firstEvidenceRequiredSamples}`,
    },
  ];
}

function repeatedFinalTaskStatusCheck(summaries: RuntimeBenchmarkSummary[], label: string): RuntimePromotionGateCheck {
  let missingEvidenceCount = 0;
  let total = 0;
  let done = 0;
  let nonDone = 0;
  let missingStatusCount = 0;
  let blockedWithoutReason = 0;
  const aggregateCounts: Record<string, number> = {};
  const nonDoneSamples: string[] = [];
  const blockedWithoutReasonSamples: string[] = [];

  for (const summary of summaries) {
    const finalStatus = finalTaskStatusForSummary(summary);
    if (!finalStatus) {
      missingEvidenceCount += 1;
      continue;
    }
    const repeat = summary.protocol?.repeatIndex ?? "?";
    total += finalStatus.total;
    done += finalStatus.done;
    nonDone += finalStatus.nonDone;
    missingStatusCount += finalStatus.missingStatusCount;
    blockedWithoutReason += finalStatus.blockedWithoutReason;
    for (const [status, count] of Object.entries(finalStatus.byStatus)) {
      aggregateCounts[status] = (aggregateCounts[status] ?? 0) + count;
    }
    nonDoneSamples.push(...finalStatus.nonDoneTaskKeys.slice(0, 5).map((key) => `r${repeat}:${key}`));
    blockedWithoutReasonSamples.push(...finalStatus.blockedWithoutReasonTaskKeys.slice(0, 5).map((key) => `r${repeat}:${key}`));
  }

  const statusCounts = statusCountsSummary(aggregateCounts);
  const details = [
    `${done}/${total} final tasks done`,
    `status counts ${statusCounts}`,
  ];
  if (missingEvidenceCount > 0) details.push(`${missingEvidenceCount} summaries missing finalTaskStatus evidence`);
  if (nonDoneSamples.length > 0) details.push(`non-done task keys ${nonDoneSamples.slice(0, 8).join(", ")}`);
  if (blockedWithoutReason > 0) details.push(`${blockedWithoutReason} blocked tasks missing blocked_reason`);
  if (blockedWithoutReasonSamples.length > 0) {
    details.push(`blocked without reason ${blockedWithoutReasonSamples.slice(0, 8).join(", ")}`);
  }

  return {
    name: `${label} final fixture tasks are all done`,
    ok: summaries.length > 0 && missingEvidenceCount === 0 && missingStatusCount === 0 && nonDone === 0,
    value: missingEvidenceCount > 0 ? `${missingEvidenceCount} missing final task status evidence` : statusCounts,
    threshold: "all done",
    detail: details.join("; "),
  };
}

function candidateQualityChecks(input: {
  candidateSummaries: RuntimeBenchmarkSummary[];
  candidateQualityRates: number[];
  noRepeatedDeterministicFailures: boolean;
}): RuntimePromotionGateCheck[] {
  return [
    repeatedFinalTaskStatusCheck(input.candidateSummaries, "candidate"),
    {
      name: "candidate total runs below 15 in every repeat",
      ok: input.candidateSummaries.length > 0 && input.candidateSummaries.every((summary) => summary.executionRunCount < 15),
      value: input.candidateSummaries.map((summary) => summary.executionRunCount).join(",") || "missing",
      threshold: "< 15",
    },
    {
      name: "candidate average runs per task below 1.5 in every repeat",
      ok: input.candidateSummaries.length > 0 && input.candidateSummaries.every((summary) => summary.averageRunsPerTask < 1.5),
      value: input.candidateSummaries.map((summary) => summary.averageRunsPerTask.toFixed(2)).join(",") || "missing",
      threshold: "< 1.5",
    },
    {
      name: "candidate runtime-quality failures below 5% in every repeat",
      ok: input.candidateQualityRates.length > 0 && input.candidateQualityRates.every((rate) => rate < 0.05),
      value: input.candidateQualityRates.map((rate) => `${(rate * 100).toFixed(1)}%`).join(",") || "missing",
      threshold: "< 5.0%",
    },
    {
      name: "candidate has no repeated deterministic env failures",
      ok: input.noRepeatedDeterministicFailures,
      value: input.noRepeatedDeterministicFailures ? 0 : "present",
      threshold: "0",
    },
    {
      name: "candidate has no non-terminal parsed actions",
      ok: input.candidateSummaries.every((summary) => summary.actionLedger.nonTerminalParsed === 0),
      value: input.candidateSummaries.reduce((sum, summary) => sum + summary.actionLedger.nonTerminalParsed, 0),
      threshold: "0",
    },
    {
      name: "candidate has no untracked action rows",
      ok: input.candidateSummaries.every((summary) => (summary.actionLedger.untracked ?? 0) === 0),
      value: input.candidateSummaries.reduce((sum, summary) => sum + (summary.actionLedger.untracked ?? 0), 0),
      threshold: "0",
    },
    {
      name: "candidate browser proof succeeded under 30s in every repeat",
      ok: input.candidateSummaries.length > 0 && input.candidateSummaries.every((summary) => summary.browserProof.succeededUnder30s > 0),
      value: input.candidateSummaries.map((summary) => summary.browserProof.succeededUnder30s).join(",") || "missing",
      threshold: ">= 1",
    },
  ];
}

function repeatedUsageEvidenceCheck(summaries: RuntimeBenchmarkSummary[], label: string): RuntimePromotionGateCheck {
  let missingValidationCount = 0;
  let completedRunCount = 0;
  let withUsageCount = 0;
  let missingUsageCount = 0;
  let invalidUsageCount = 0;
  const sampleRunIds: string[] = [];

  for (const summary of summaries) {
    const validation = executionUsageValidationForSummary(summary);
    if (!validation) {
      missingValidationCount += 1;
      continue;
    }
    completedRunCount += validation.completedRunCount;
    withUsageCount += validation.withUsageCount;
    missingUsageCount += validation.missingUsageCount;
    invalidUsageCount += validation.invalidUsageCount;
    sampleRunIds.push(...validation.missingUsageRunIds, ...validation.invalidUsageRunIds);
  }

  const missingOrInvalid = missingUsageCount + invalidUsageCount;
  return {
    name: `${label} completed runs have no missing_usage/invalid usage`,
    ok: summaries.length > 0 && missingValidationCount === 0 && missingOrInvalid === 0,
    value: missingValidationCount > 0 ? `${missingValidationCount} missing validation` : missingOrInvalid,
    threshold: "0 missing_usage/invalid",
    detail: `${withUsageCount}/${completedRunCount} completed runs have non-null usage${sampleRunIds.length > 0 ? `; sample run ids ${sampleRunIds.slice(0, 5).join(", ")}` : ""}`,
  };
}

function externalEvidenceChecks(evidence: RuntimePromotionEvidence | null | undefined): RuntimePromotionGateCheck[] {
  return [
    {
      name: "UI consistency proof passed",
      ok: Boolean(evidence?.uiConsistency?.ok),
      value: evidence?.uiConsistency?.ok ? "pass" : "missing/fail",
      threshold: "pass",
      detail: evidence?.uiConsistency?.detail ?? evidence?.uiConsistency?.source,
    },
    {
      name: "untracked-action proof passed",
      ok: Boolean(evidence?.untrackedActions?.ok) && (evidence?.untrackedActions?.count ?? 0) === 0,
      value: evidence?.untrackedActions?.count ?? "missing",
      threshold: "0",
      detail: evidence?.untrackedActions?.detail ?? evidence?.untrackedActions?.source,
    },
  ];
}

/**
 * Positive gate checks that each of the four runtime safety signals actually fired,
 * read from the promotion evidence's safetySignals attestations (built honestly from
 * a real demonstration summary via buildSafetySignalEvidenceFromSummary). The gate
 * FAILS if any attestation is missing or did not fire. This is the fix for the prior
 * gate's structural inability to prove the safety/observability features: it no longer
 * auto-passes when no unhealthy runs exist — it positively requires a demonstrated sample.
 */
/** One safety-signal gate check: the attestation must exist, be ok, and report >=1 occurrence. */
function safetySignalCheck(
  name: string,
  threshold: string,
  attestation: RuntimePromotionEvidenceCheck | undefined,
): RuntimePromotionGateCheck {
  return {
    name,
    ok: Boolean(attestation?.ok) && (attestation?.count ?? 0) >= 1,
    value: attestation?.count ?? "missing",
    threshold,
    detail: attestation?.detail ?? attestation?.source ?? `${name} attestation missing`,
  };
}

function safetySignalChecks(
  evidence: RuntimePromotionEvidence | null | undefined,
  options: RuntimePromotionGateOptions,
): RuntimePromotionGateCheck[] {
  const ceiling = options.overseerTokenCeiling ?? DEFAULT_OVERSEER_TOKEN_CEILING;
  const sig = evidence?.safetySignals;
  return [
    safetySignalCheck("safety: deterministic preflight circuit-break fired (>=1, no churn)", ">= 1 circuit-open row, no churn", sig?.preflightCircuitOpen),
    safetySignalCheck("safety: detect-unhealthy sample observed (>=1)", ">= 1 detect-unhealthy sample", sig?.detectUnhealthy),
    safetySignalCheck(`safety: bounded overseer watch turn (>=1, <= ${ceiling} fresh tokens)`, `>= 1 overseer turn under ${ceiling} fresh tokens`, sig?.overseerWatch),
    safetySignalCheck("safety: provider fallback exercised (>=1)", ">= 1 fallback_used row", sig?.providerFallback),
  ];
}

/**
 * Build the four safety-signal attestations from a real demonstration-run summary.
 * The counts come from DB-derived summary fields (safetySignals, latency, overseer
 * usage) — not hand-assertion — so the resulting promotion-evidence.json is grounded.
 * "No churn" = exactly one circuit-open row per distinct runtime fingerprint.
 */
export function buildSafetySignalEvidenceFromSummary(
  summary: RuntimeBenchmarkSummary,
  options: { overseerTokenCeiling?: number; source?: string } = {},
): RuntimePromotionSafetySignalEvidence {
  const ceiling = options.overseerTokenCeiling ?? DEFAULT_OVERSEER_TOKEN_CEILING;
  const source = options.source
    ?? `demo summary ${summary.protocol?.fixtureId ?? "unlabeled"} ${summary.scope.runStartedAt ?? "?"}..${summary.scope.runEndedAt ?? "?"}`;
  const safety = summary.safetySignals ?? EMPTY_SAFETY_SIGNALS;
  const detectCount = summary.latency?.detectUnhealthyMs.sampleCount ?? 0;
  // Ceiling is measured on FRESH input (billable), not total — cache-read is cheap and the goal's
  // product rule is explicit: do not treat total input tokens as cost.
  const overseerFresh = summary.overseerUsage?.freshInputTokens ?? 0;
  const overseerTotal = summary.overseerUsage?.totalTokens ?? 0;
  const noChurn = safety.preflightCircuitOpenCount >= 1
    && safety.preflightCircuitOpenCount === safety.preflightDistinctFingerprintCount;
  return {
    preflightCircuitOpen: {
      ok: safety.preflightCircuitOpenCount >= 1 && noChurn,
      source,
      count: safety.preflightCircuitOpenCount,
      detail: `${safety.preflightCircuitOpenCount} circuit-open row(s) across ${safety.preflightDistinctFingerprintCount} fingerprint(s)${noChurn ? "" : " — CHURN (>1 row/fingerprint)"}`,
    },
    detectUnhealthy: {
      ok: detectCount >= 1,
      source,
      count: detectCount,
      detail: `detect-unhealthy p50 ${summary.latency?.detectUnhealthyMs.medianMs ?? "n/a"}ms / p95 ${summary.latency?.detectUnhealthyMs.p95Ms ?? "n/a"}ms`,
    },
    overseerWatch: {
      ok: summary.overseerTurnCount >= 1 && overseerFresh <= ceiling,
      source,
      count: summary.overseerTurnCount,
      detail: `${summary.overseerTurnCount} overseer turn(s), ${overseerFresh} fresh-input tokens (ceiling ${ceiling}; total ${overseerTotal} incl. cache-read)`,
    },
    providerFallback: {
      ok: safety.fallbackUsedCount >= 1,
      source,
      count: safety.fallbackUsedCount,
      detail: `${safety.fallbackUsedCount} execution_runs row(s) with fallback_used=1`,
    },
  };
}

function metricRegressionChecks(input: {
  candidate: RuntimeBenchmarkArmStats;
  baseline: RuntimeBenchmarkArmStats;
  candidateRuntimeQualityFailures: number;
}): RuntimePromotionGateCheck[] {
  const candidateFresh = input.candidate.metrics.freshInputPerCompletedTask;
  const baselineFresh = input.baseline.metrics.freshInputPerCompletedTask;
  const candidateFirstP50 = input.candidate.metrics.firstEvidenceP50Ms;
  const candidateFirstP95 = input.candidate.metrics.firstEvidenceP95Ms;
  const baselineFirstP50 = input.baseline.metrics.firstEvidenceP50Ms;
  const baselineFirstP95 = input.baseline.metrics.firstEvidenceP95Ms;
  const candidateDetectP50 = input.candidate.metrics.detectUnhealthyP50Ms;
  const candidateDetectP95 = input.candidate.metrics.detectUnhealthyP95Ms;
  const baselineDetectP50 = input.baseline.metrics.detectUnhealthyP50Ms;
  const baselineDetectP95 = input.baseline.metrics.detectUnhealthyP95Ms;

  const medOf = (s: RuntimeMetricStats) => s.median === null ? "n/a" : Math.round(s.median);
  return [
    {
      name: "fresh input per completed task reduced by at least 50%",
      ok: candidateFresh.median !== null && baselineFresh.median !== null && candidateFresh.median <= baselineFresh.median * 0.5,
      value: candidateFresh.median === null ? "missing" : Math.round(candidateFresh.median),
      threshold: baselineFresh.median === null ? "baseline missing" : `<= ${(baselineFresh.median * 0.5).toFixed(0)}`,
      detail: `metric = fresh ÷ completed(done) tasks per goal spec #238; candidate ${medOf(candidateFresh)} vs baseline ${medOf(baselineFresh)}. `
        + `Transparency — fresh ÷ completed-run: cand ${medOf(input.candidate.metrics.freshInputPerCompletedRun)} vs base ${medOf(input.baseline.metrics.freshInputPerCompletedRun)}; `
        + `fresh ÷ all-fixture-tasks: cand ${medOf(input.candidate.metrics.freshInputPerFixtureTask)} vs base ${medOf(input.baseline.metrics.freshInputPerFixtureTask)}.`,
    },
    metricCheck({
      name: "average runs per task not worse than baseline median plus replay noise",
      candidate: input.candidate.metrics.averageRunsPerTask,
      baseline: input.baseline.metrics.averageRunsPerTask,
      threshold: input.baseline.metrics.averageRunsPerTask.median === null
        ? "baseline missing"
        : `<= ${(input.baseline.metrics.averageRunsPerTask.median + input.baseline.metrics.averageRunsPerTask.noise).toFixed(2)}`,
      ok: input.candidate.metrics.averageRunsPerTask.median !== null
        && input.baseline.metrics.averageRunsPerTask.median !== null
        && input.candidate.metrics.averageRunsPerTask.median <= input.baseline.metrics.averageRunsPerTask.median + input.baseline.metrics.averageRunsPerTask.noise,
    }),
    metricCheck({
      name: "first-evidence p50 not worse than baseline median plus replay noise",
      candidate: candidateFirstP50,
      baseline: baselineFirstP50,
      threshold: baselineFirstP50.median === null ? "baseline missing" : `<= ${(baselineFirstP50.median + baselineFirstP50.noise).toFixed(0)}ms`,
      ok: candidateFirstP50.median !== null
        && baselineFirstP50.median !== null
        && candidateFirstP50.median <= baselineFirstP50.median + baselineFirstP50.noise,
    }),
    metricCheck({
      name: "first-evidence p95 not worse than baseline median plus replay noise",
      candidate: candidateFirstP95,
      baseline: baselineFirstP95,
      threshold: baselineFirstP95.median === null ? "baseline missing" : `<= ${(baselineFirstP95.median + baselineFirstP95.noise).toFixed(0)}ms`,
      ok: candidateFirstP95.median !== null
        && baselineFirstP95.median !== null
        && candidateFirstP95.median <= baselineFirstP95.median + baselineFirstP95.noise,
    }),
    metricCheck({
      name: "detect-unhealthy p50 not worse than baseline median plus replay noise",
      candidate: candidateDetectP50,
      baseline: baselineDetectP50,
      threshold: baselineDetectP50.median === null ? "baseline missing or no candidate unhealthy runs" : `<= ${(baselineDetectP50.median + baselineDetectP50.noise).toFixed(0)}ms`,
      ok: input.candidateRuntimeQualityFailures === 0
        || (
          candidateDetectP50.median !== null
          && baselineDetectP50.median !== null
          && candidateDetectP50.median <= baselineDetectP50.median + baselineDetectP50.noise
        ),
    }),
    metricCheck({
      name: "detect-unhealthy p95 not worse than baseline median plus replay noise",
      candidate: candidateDetectP95,
      baseline: baselineDetectP95,
      threshold: baselineDetectP95.median === null ? "baseline missing or no candidate unhealthy runs" : `<= ${(baselineDetectP95.median + baselineDetectP95.noise).toFixed(0)}ms`,
      ok: input.candidateRuntimeQualityFailures === 0
        || (
          candidateDetectP95.median !== null
          && baselineDetectP95.median !== null
          && candidateDetectP95.median <= baselineDetectP95.median + baselineDetectP95.noise
        ),
    }),
  ];
}

export function buildRuntimeBenchmarkPromotionReport(
  candidateSummaries: RuntimeBenchmarkSummary[],
  baselineSummaries: RuntimeBenchmarkSummary[],
  options: RuntimePromotionGateOptions = {},
): RuntimeBenchmarkPromotionReport {
  const requiredTaskCount = options.requiredTaskCount ?? 10;
  const requiredRepeats = options.requiredRepeats ?? 3;
  const candidate = armStats(candidateSummaries);
  const baseline = armStats(baselineSummaries);
  const candidateQualityRates = candidateSummaries.map(runtimeQualityRate);
  const candidateRuntimeQualityFailures = candidateSummaries.reduce((sum, summary) => sum + summary.failureBuckets.runtimeQuality, 0);
  const firstEvidenceRequiredSamples = candidateSummaries.reduce((sum, summary) => sum + summary.executionRunCount, 0);
  const firstEvidenceSampleCount = candidateSummaries.reduce((sum, summary) => sum + (summary.latency?.firstEvidenceMs.sampleCount ?? 0), 0);
  const noRepeatedDeterministicFailures = candidateSummaries.every((summary) => repeatedDeterministicEnvFailureCount(summary) === 0);
  const evidence = options.evidence;
  const checks: RuntimePromotionGateCheck[] = [
    ...repeatedProtocolChecks({
      candidateSummaries,
      baselineSummaries,
      requiredRepeats,
      requiredTaskCount,
      firstEvidenceSampleCount,
      firstEvidenceRequiredSamples,
    }),
    ...candidateQualityChecks({
      candidateSummaries,
      candidateQualityRates,
      noRepeatedDeterministicFailures,
    }),
    repeatedUsageEvidenceCheck(candidateSummaries, "candidate"),
    repeatedUsageEvidenceCheck(baselineSummaries, "baseline"),
    ...externalEvidenceChecks(evidence),
    ...safetySignalChecks(evidence, options),
    ...metricRegressionChecks({ candidate, baseline, candidateRuntimeQualityFailures }),
  ];

  return {
    candidate,
    baseline,
    gate: {
      ok: checks.every((check) => check.ok),
      checks,
    },
  };
}

export function formatRuntimeBenchmarkMarkdown(summary: RuntimeBenchmarkSummary): string {
  const actionLedger = summary.actionLedger ?? EMPTY_ACTION_LEDGER_METRICS;
  const browserProof = summary.browserProof ?? EMPTY_BROWSER_PROOF_METRICS;
  const latency = summary.latency ?? EMPTY_LATENCY_METRICS;
  const safety = summary.safetySignals ?? EMPTY_SAFETY_SIGNALS;
  const usageValidation = summary.executionUsageValidation ?? EMPTY_EXECUTION_USAGE_VALIDATION;
  const finalTaskStatus = summary.finalTaskStatus ?? EMPTY_FINAL_TASK_STATUS;
  const pct = (value: number, denominator: number) => denominator > 0 ? `${((value / denominator) * 100).toFixed(1)}%` : "0.0%";
  const hours = (ms: number) => (ms / 3_600_000).toFixed(2);
  const tokens = (value: number) => Math.round(value).toLocaleString("en-US");
  const ms = (value: number | null) => value === null ? "n/a" : `${Math.round(value)}ms`;
  const taskKeys = (keys: string[]) => keys.length > 0 ? keys.join(", ") : "none";

  return [
    `# Runtime Benchmark Baseline - ${summary.scope.goalKey}`,
    "",
    "## Scope",
    "",
    `- Fixture: ${summary.protocol?.fixtureId ?? "unlabeled"} (${summary.protocol?.expectedTaskCount ?? 10}-task expected)`,
    `- Arm/repeat: ${summary.protocol?.arm ?? "unlabeled"} / ${summary.protocol?.repeatIndex ?? "n/a"} of ${summary.protocol?.requiredRepeats ?? 3}`,
    `- Frozen task keys: ${summary.protocol?.frozenTaskKeys?.join(", ") || "not recorded"}`,
    `- Sprints: ${summary.scope.sprintIds.length}`,
    `- Tasks: ${summary.taskCount}`,
    `- Company IDs: ${summary.scope.companyIds.join(", ") || "none"}`,
    `- Run window: ${summary.scope.runStartedAt ?? "n/a"} to ${summary.scope.runEndedAt ?? "n/a"}`,
    `- Overseer scope: ${summary.scope.overseerScope} (goal-level turn linkage is not durable yet)`,
    "",
    "## Final Task Status",
    "",
    `- Final tasks done: ${finalTaskStatus.done}/${finalTaskStatus.total}`,
    `- Final non-done tasks: ${finalTaskStatus.nonDone}`,
    `- Status counts: ${statusCountsSummary(finalTaskStatus.byStatus)}`,
    `- Missing task statuses: ${finalTaskStatus.missingStatusCount}`,
    `- Blocked without reason: ${finalTaskStatus.blockedWithoutReason} (${taskKeys(finalTaskStatus.blockedWithoutReasonTaskKeys)})`,
    `- Non-done task keys: ${taskKeys(finalTaskStatus.nonDoneTaskKeys)}`,
    "",
    "## Execution Runs",
    "",
    `- Total runs: ${summary.executionRunCount}`,
    `- Completed runs: ${summary.completedRunCount}`,
    `- Non-completed runs: ${summary.nonCompletedRunCount} (${pct(summary.nonCompletedRunCount, summary.executionRunCount)})`,
    `- Tasks with breakdowns: ${summary.tasksWithBreakdowns} (${pct(summary.tasksWithBreakdowns, summary.taskCount)})`,
    `- Tasks with multiple runs: ${summary.tasksWithMultipleRuns} (${pct(summary.tasksWithMultipleRuns, summary.taskCount)})`,
    `- Average runs per task: ${summary.averageRunsPerTask.toFixed(2)}`,
    `- Recorded process time: ${hours(summary.recordedDurationMs)}h`,
    "",
    "## Failure Buckets",
    "",
    `- Deterministic preflight failures: ${summary.failureBuckets.deterministicPreflight}`,
    `- Intentional/governance cancellations: ${summary.failureBuckets.intentionalCancellation}`,
    `- Runtime-quality failures: ${summary.failureBuckets.runtimeQuality} (${pct(summary.failureBuckets.runtimeQuality, summary.executionRunCount)})`,
    "",
    "## Usage",
    "",
    "| Source | Input | Cache read | Fresh input | Output | Total |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    `| execution_runs | ${tokens(summary.executionUsage.inputTokens)} | ${tokens(summary.executionUsage.cacheReadInputTokens)} | ${tokens(summary.executionUsage.freshInputTokens)} | ${tokens(summary.executionUsage.outputTokens)} | ${tokens(summary.executionUsage.totalTokens)} |`,
    `| overseer_turns (${summary.overseerTurnCount}) | ${tokens(summary.overseerUsage.inputTokens)} | ${tokens(summary.overseerUsage.cacheReadInputTokens)} | ${tokens(summary.overseerUsage.freshInputTokens)} | ${tokens(summary.overseerUsage.outputTokens)} | ${tokens(summary.overseerUsage.totalTokens)} |`,
    `| combined | ${tokens(summary.combinedUsage.inputTokens)} | ${tokens(summary.combinedUsage.cacheReadInputTokens)} | ${tokens(summary.combinedUsage.freshInputTokens)} | ${tokens(summary.combinedUsage.outputTokens)} | ${tokens(summary.combinedUsage.totalTokens)} |`,
    "",
    "## Usage Validation",
    "",
    `- Completed runs with usage: ${usageValidation.withUsageCount}/${usageValidation.completedRunCount}`,
    `- Missing usage runs: ${usageValidation.missingUsageCount}${usageValidation.missingUsageRunIds.length > 0 ? ` (${usageValidation.missingUsageRunIds.join(", ")})` : ""}`,
    `- Invalid usage runs: ${usageValidation.invalidUsageCount}${usageValidation.invalidUsageRunIds.length > 0 ? ` (${usageValidation.invalidUsageRunIds.join(", ")})` : ""}`,
    "",
    "## Action Ledger",
    "",
    `- Total action rows: ${actionLedger.total}`,
    `- Terminal action rows: ${actionLedger.terminal}`,
    `- Non-terminal parsed actions: ${actionLedger.nonTerminalParsed}`,
    `- Parse failed actions: ${actionLedger.parseFailed}`,
    `- Pending approvals: ${actionLedger.pendingApproval}`,
    `- Untracked actions: ${actionLedger.untracked}`,
    "",
    "## Browser Proof",
    "",
    `- Total proof runs: ${browserProof.total}`,
    `- Succeeded: ${browserProof.succeeded}`,
    `- Failed: ${browserProof.failed}`,
    `- Succeeded under 30s: ${browserProof.succeededUnder30s}`,
    `- Max duration: ${browserProof.maxDurationMs}ms`,
    "",
    "## Latency",
    "",
    `- First evidence samples: ${latency.firstEvidenceMs.sampleCount}`,
    `- First evidence p50/p95: ${ms(latency.firstEvidenceMs.medianMs)} / ${ms(latency.firstEvidenceMs.p95Ms)}`,
    `- Detect unhealthy samples: ${latency.detectUnhealthyMs.sampleCount}`,
    `- Detect unhealthy p50/p95: ${ms(latency.detectUnhealthyMs.medianMs)} / ${ms(latency.detectUnhealthyMs.p95Ms)}`,
    "",
    "## Safety Signals",
    "",
    `- Preflight circuit-open rows: ${safety.preflightCircuitOpenCount} (across ${safety.preflightDistinctFingerprintCount} fingerprint(s))`,
    `- Detect-unhealthy samples: ${latency.detectUnhealthyMs.sampleCount}`,
    `- Overseer turns: ${summary.overseerTurnCount} (${tokens(summary.overseerUsage.totalTokens)} combined tokens)`,
    `- Provider fallback_used rows: ${safety.fallbackUsedCount}`,
    "",
    "## Repeated Failures",
    "",
    ...(summary.repeatedFailures.length > 0
      ? summary.repeatedFailures.slice(0, 20).map((entry) => `- ${entry.taskKey ?? "unknown"}: ${entry.count}x ${entry.failureSignature}`)
      : ["- None"]),
    "",
  ].join("\n");
}
