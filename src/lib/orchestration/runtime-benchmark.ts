import type Database from "better-sqlite3";

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
};

export type RuntimeBrowserProofMetrics = {
  total: number;
  succeeded: number;
  failed: number;
  succeededUnder30s: number;
  maxDurationMs: number;
};

export type RuntimeBenchmarkSummary = {
  scope: RuntimeBenchmarkScope;
  taskCount: number;
  executionRunCount: number;
  completedRunCount: number;
  nonCompletedRunCount: number;
  tasksWithBreakdowns: number;
  tasksWithMultipleRuns: number;
  averageRunsPerTask: number;
  recordedDurationMs: number;
  executionUsage: RuntimeUsageTotals;
  overseerTurnCount: number;
  overseerUsage: RuntimeUsageTotals;
  combinedUsage: RuntimeUsageTotals;
  failureBuckets: RuntimeFailureBuckets;
  repeatedFailures: RuntimeRepeatedFailure[];
  actionLedger: RuntimeActionLedgerMetrics;
  browserProof: RuntimeBrowserProofMetrics;
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

const EMPTY_ACTION_LEDGER_METRICS: RuntimeActionLedgerMetrics = {
  total: 0,
  terminal: 0,
  nonTerminalParsed: 0,
  parseFailed: 0,
  pendingApproval: 0,
};

const EMPTY_BROWSER_PROOF_METRICS: RuntimeBrowserProofMetrics = {
  total: 0,
  succeeded: 0,
  failed: 0,
  succeededUnder30s: 0,
  maxDurationMs: 0,
};

type SprintRow = {
  id: string;
  parent_id: string | null;
};

type TaskRow = {
  id: string;
  task_key: string | null;
  company_id: string | null;
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
};

type OverseerTurnRow = {
  usage_json: string | null;
};

type RuntimeActionLedgerRow = {
  status: string;
};

type RuntimeBrowserProofAuditRow = {
  status: string;
  duration_ms: number | null;
};

type JsonRecord = Record<string, unknown>;

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

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function hasTable(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined;
  return row?.name === tableName;
}

function dateMax(values: Array<string | null>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered.sort().at(-1) ?? null : null;
}

function dateMin(values: Array<string | null>): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.length > 0 ? filtered.sort()[0] ?? null : null;
}

export function classifyRunFailure(run: Pick<RunRow, "status" | "failure_class" | "error_message">): keyof RuntimeFailureBuckets | null {
  if (run.status === "completed") return null;

  const failureClass = (run.failure_class ?? "").toLowerCase();
  const message = (run.error_message ?? "").toLowerCase();
  const combined = `${failureClass} ${message}`;

  if (
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

export function buildRuntimeBenchmarkSummary(db: Database.Database, goalKey: string): RuntimeBenchmarkSummary {
  const goal = db.prepare("SELECT id FROM sprints WHERE goal_key = ? LIMIT 1").get(goalKey) as { id: string } | undefined;
  if (!goal) {
    throw new Error(`Goal sprint not found for goal key ${goalKey}`);
  }

  const sprintRows = db.prepare("SELECT id, parent_id FROM sprints").all() as SprintRow[];
  const sprintIds = collectChildSprintIds(sprintRows, goal.id);
  const taskRows = db
    .prepare(`SELECT id, task_key, company_id FROM tasks WHERE sprint_id IN (${placeholders(sprintIds.length)})`)
    .all(...sprintIds) as TaskRow[];
  const taskIds = taskRows.map((row) => row.id);

  const runRows = taskIds.length > 0
    ? db.prepare(`SELECT * FROM execution_runs WHERE task_id IN (${placeholders(taskIds.length)})`).all(...taskIds) as RunRow[]
    : [];
  const runIds = runRows.map((run) => run.id);

  const runStartedAt = dateMin(runRows.map((run) => run.started_at ?? run.created_at));
  const runEndedAt = dateMax(runRows.map((run) => run.completed_at ?? run.updated_at ?? run.created_at));
  const companyIds = unique(taskRows.map((row) => row.company_id));

  const overseerTurns = companyIds.length > 0
    ? db
      .prepare(
        `SELECT usage_json
           FROM overseer_turns
          WHERE company_id IN (${placeholders(companyIds.length)})`,
      )
      .all(...companyIds) as OverseerTurnRow[]
    : [];

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
  const overseerUsage = usageTotalsFromJson(overseerTurns.map((turn) => ({ usage_json: turn.usage_json })));
  const actionLedgerRows = taskIds.length > 0 && hasTable(db, "runtime_action_ledger")
    ? db
      .prepare(`SELECT status FROM runtime_action_ledger WHERE task_id IN (${placeholders(taskIds.length)})`)
      .all(...taskIds) as RuntimeActionLedgerRow[]
    : [];
  const browserProofRows = taskIds.length > 0 && hasTable(db, "runtime_browser_proof_audit")
    ? db
      .prepare(`SELECT status, duration_ms FROM runtime_browser_proof_audit WHERE task_id IN (${placeholders(taskIds.length)})`)
      .all(...taskIds) as RuntimeBrowserProofAuditRow[]
    : [];
  const executionLinkedActionRows = runIds.length > 0 && hasTable(db, "runtime_action_ledger")
    ? db
      .prepare(`SELECT status FROM runtime_action_ledger WHERE execution_run_id IN (${placeholders(runIds.length)}) AND task_id IS NULL`)
      .all(...runIds) as RuntimeActionLedgerRow[]
    : [];
  actionLedgerRows.push(...executionLinkedActionRows);

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
    taskCount: taskRows.length,
    executionRunCount: runRows.length,
    completedRunCount: runRows.filter((run) => run.status === "completed").length,
    nonCompletedRunCount: runRows.filter((run) => run.status !== "completed").length,
    tasksWithBreakdowns: Array.from(runsByTask.values()).filter((runs) => runs.some((run) => run.status !== "completed")).length,
    tasksWithMultipleRuns: Array.from(runsByTask.values()).filter((runs) => runs.length > 1).length,
    averageRunsPerTask: taskRows.length > 0 ? runRows.length / taskRows.length : 0,
    recordedDurationMs: runRows.reduce((sum, run) => sum + Math.max(0, run.duration_ms ?? 0), 0),
    executionUsage,
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
    actionLedger: {
      total: actionLedgerRows.length,
      terminal: actionLedgerRows.filter((row) => row.status !== "parsed").length,
      nonTerminalParsed: actionLedgerRows.filter((row) => row.status === "parsed").length,
      parseFailed: actionLedgerRows.filter((row) => row.status === "parse_failed").length,
      pendingApproval: actionLedgerRows.filter((row) => row.status === "pending_approval").length,
    },
    browserProof: {
      total: browserProofRows.length,
      succeeded: browserProofRows.filter((row) => row.status === "succeeded").length,
      failed: browserProofRows.filter((row) => row.status === "failed").length,
      succeededUnder30s: browserProofRows.filter((row) => row.status === "succeeded" && (row.duration_ms ?? Number.POSITIVE_INFINITY) <= 30_000).length,
      maxDurationMs: browserProofRows.reduce((max, row) => Math.max(max, row.duration_ms ?? 0), 0),
    },
  };
}

function freshInputPerCompletedTask(summary: RuntimeBenchmarkSummary): number {
  return summary.completedRunCount > 0 ? summary.combinedUsage.freshInputTokens / summary.completedRunCount : Number.POSITIVE_INFINITY;
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
): RuntimePromotionGateResult {
  const runtimeQualityRate = summary.executionRunCount > 0
    ? summary.failureBuckets.runtimeQuality / summary.executionRunCount
    : 0;
  const checks: RuntimePromotionGateCheck[] = [
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
    {
      name: "no non-terminal parsed actions",
      ok: summary.actionLedger.nonTerminalParsed === 0,
      value: summary.actionLedger.nonTerminalParsed,
      threshold: "0",
    },
    {
      name: "browser proof succeeded under 30s",
      ok: summary.browserProof.succeededUnder30s > 0,
      value: summary.browserProof.succeededUnder30s,
      threshold: ">= 1",
      detail: `${summary.browserProof.succeeded}/${summary.browserProof.total} proof runs succeeded`,
    },
  ];

  if (baseline) {
    const currentFresh = freshInputPerCompletedTask(summary);
    const baselineFresh = freshInputPerCompletedTask(baseline);
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

export function formatRuntimeBenchmarkMarkdown(summary: RuntimeBenchmarkSummary): string {
  const actionLedger = summary.actionLedger ?? EMPTY_ACTION_LEDGER_METRICS;
  const browserProof = summary.browserProof ?? EMPTY_BROWSER_PROOF_METRICS;
  const pct = (value: number, denominator: number) => denominator > 0 ? `${((value / denominator) * 100).toFixed(1)}%` : "0.0%";
  const hours = (ms: number) => (ms / 3_600_000).toFixed(2);
  const tokens = (value: number) => Math.round(value).toLocaleString("en-US");

  return [
    `# Runtime Benchmark Baseline - ${summary.scope.goalKey}`,
    "",
    "## Scope",
    "",
    `- Sprints: ${summary.scope.sprintIds.length}`,
    `- Tasks: ${summary.taskCount}`,
    `- Company IDs: ${summary.scope.companyIds.join(", ") || "none"}`,
    `- Run window: ${summary.scope.runStartedAt ?? "n/a"} to ${summary.scope.runEndedAt ?? "n/a"}`,
    `- Overseer scope: ${summary.scope.overseerScope} (goal-level turn linkage is not durable yet)`,
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
    "## Action Ledger",
    "",
    `- Total action rows: ${actionLedger.total}`,
    `- Terminal action rows: ${actionLedger.terminal}`,
    `- Non-terminal parsed actions: ${actionLedger.nonTerminalParsed}`,
    `- Parse failed actions: ${actionLedger.parseFailed}`,
    `- Pending approvals: ${actionLedger.pendingApproval}`,
    "",
    "## Browser Proof",
    "",
    `- Total proof runs: ${browserProof.total}`,
    `- Succeeded: ${browserProof.succeeded}`,
    `- Failed: ${browserProof.failed}`,
    `- Succeeded under 30s: ${browserProof.succeededUnder30s}`,
    `- Max duration: ${browserProof.maxDurationMs}ms`,
    "",
    "## Repeated Failures",
    "",
    ...(summary.repeatedFailures.length > 0
      ? summary.repeatedFailures.slice(0, 20).map((entry) => `- ${entry.taskKey ?? "unknown"}: ${entry.count}x ${entry.failureSignature}`)
      : ["- None"]),
    "",
  ].join("\n");
}
