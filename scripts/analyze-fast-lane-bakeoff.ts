/**
 * Fast-lane bake-off analysis (companion to scripts/run-fast-lane-bakeoff.ts).
 *
 * Read-only: walks the bake-off experiments (idempotency key
 * `fast-lane-bakeoff-v1:*`), applies the automated half of the quality gate,
 * and emits per-model + per-cell aggregates ranked by duration and
 * fresh-input tokens. Fresh-input mirrors run-performance-trigger.ts
 * freshInputFor(): codex/gemini subtract cacheRead from input; anthropic
 * input is already net of cache.
 *
 *   ORCHESTRATION_DB_PATH="$PWD/data-exec-dev/orchestration.db" \
 *     node ./scripts/run-ts-test.mjs scripts/analyze-fast-lane-bakeoff.ts
 *
 * Flags:
 *   --json <path>          also write the full analysis as JSON
 *   --dump-results <dir>   write per-cell resultText markdown for the manual
 *                          (or LLM-judge) half of the quality review
 */
import fs from "node:fs";
import path from "node:path";

import { getOrchestrationDb } from "@/lib/orchestration/db";

const BAKEOFF_PREFIX = "fast-lane-bakeoff-v1:";
const REPEAT_TARGET = 3;

type AttemptRow = {
  experiment_id: string;
  idempotency_key: string;
  variant_key: string;
  planned_change_json: string;
  attempt_number: number;
  attempt_status: string;
  error_message: string | null;
  comparison_snapshot_json: string;
  execution_run_id: string | null;
  run_status: string | null;
  duration_ms: number | null;
  token_usage_json: string | null;
};

type AttemptFacts = {
  taskKey: string;
  variantKey: string;
  provider: string;
  model: string;
  attemptNumber: number;
  status: string;
  durationMs: number | null;
  inputTokens: number | null;
  cacheReadInputTokens: number | null;
  outputTokens: number | null;
  freshInputTokens: number | null;
  totalTokens: number | null;
  exitCode: number | null;
  timedOut: boolean;
  resultTextLength: number;
  resultText: string;
  gatePassed: boolean;
  gateFailures: string[];
  executionRunId: string | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Mirrors freshInputFor in src/lib/orchestration/run-performance-trigger.ts.
function freshInput(provider: string, inputTokens: number | null, cacheRead: number | null): number | null {
  if (inputTokens === null) return null;
  const cached = cacheRead ?? 0;
  if (provider === "codex" || provider === "gemini") return Math.max(0, inputTokens - cached);
  if (provider) return inputTokens;
  return cached <= inputTokens ? inputTokens - cached : inputTokens;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "-";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function fmtTok(tokens: number | null): string {
  if (tokens === null) return "-";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(Math.round(tokens));
}

function loadAttempts(): AttemptFacts[] {
  const db = getOrchestrationDb();
  const rows = db.prepare(
    `SELECT e.id AS experiment_id, e.idempotency_key,
            v.variant_key, v.planned_change_json,
            a.attempt_number, a.status AS attempt_status, a.error_message,
            a.comparison_snapshot_json, a.execution_run_id,
            r.status AS run_status, r.duration_ms, r.token_usage_json
     FROM experiments e
     JOIN experiment_variants v ON v.experiment_id = e.id
     LEFT JOIN experiment_attempts a ON a.variant_id = v.id
     LEFT JOIN execution_runs r ON r.id = a.execution_run_id
     WHERE e.idempotency_key LIKE ?
     ORDER BY e.idempotency_key, a.attempt_number`,
  ).all(`${BAKEOFF_PREFIX}%`) as AttemptRow[];

  const facts: AttemptFacts[] = [];
  for (const row of rows) {
    if (row.attempt_number === null || row.attempt_number === undefined) continue;
    const taskKey = row.idempotency_key.slice(BAKEOFF_PREFIX.length).split(":")[0] ?? "unknown";
    let planned: Record<string, unknown> = {};
    let snapshot: Record<string, unknown> = {};
    let usage: Record<string, unknown> = {};
    try { planned = JSON.parse(row.planned_change_json ?? "{}"); } catch { planned = {}; }
    try { snapshot = JSON.parse(row.comparison_snapshot_json ?? "{}"); } catch { snapshot = {}; }
    try { usage = JSON.parse(row.token_usage_json ?? "{}"); } catch { usage = {}; }
    const metrics = (snapshot.metrics && typeof snapshot.metrics === "object" ? snapshot.metrics : {}) as Record<string, unknown>;
    const provider = String(planned.runnerProvider ?? metrics.runnerProvider ?? usage.runnerProvider ?? "");
    const model = String(planned.runnerModel ?? metrics.runnerModel ?? usage.runnerModel ?? "");
    const inputTokens = numberOrNull(metrics.inputTokens ?? usage.inputTokens);
    const cacheRead = numberOrNull(metrics.cacheReadInputTokens ?? usage.cacheReadInputTokens);
    const outputTokens = numberOrNull(metrics.outputTokens ?? usage.outputTokens);
    const totalTokens = numberOrNull(metrics.totalTokens ?? usage.totalTokens);
    const durationMs = numberOrNull(row.duration_ms ?? metrics.durationMs ?? usage.durationMs);
    const exitCode = numberOrNull(metrics.exitCode ?? usage.exitCode);
    const timedOut = metrics.timedOut === true || usage.timedOut === true;
    const resultText = typeof snapshot.resultText === "string" ? snapshot.resultText : "";

    const gateFailures: string[] = [];
    if (row.attempt_status !== "succeeded") gateFailures.push(`status=${row.attempt_status}`);
    if (exitCode !== 0) gateFailures.push(`exitCode=${exitCode ?? "null"}`);
    if (timedOut) gateFailures.push("timedOut");
    if (resultText.trim().length === 0) gateFailures.push("emptyResultText");
    if (!totalTokens || totalTokens <= 0) gateFailures.push("noTokenData");

    facts.push({
      taskKey,
      variantKey: row.variant_key,
      provider,
      model,
      attemptNumber: row.attempt_number,
      status: row.attempt_status,
      durationMs,
      inputTokens,
      cacheReadInputTokens: cacheRead,
      outputTokens,
      freshInputTokens: freshInput(provider, inputTokens, cacheRead),
      totalTokens,
      exitCode,
      timedOut,
      resultTextLength: resultText.length,
      resultText,
      gatePassed: gateFailures.length === 0,
      gateFailures,
      executionRunId: row.execution_run_id,
    });
  }
  return facts;
}

function main(): void {
  const argv = process.argv.slice(2);
  let jsonPath: string | null = null;
  let dumpDir: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") jsonPath = String(argv[++index] ?? "");
    else if (argv[index] === "--dump-results") dumpDir = String(argv[++index] ?? "");
  }

  const attempts = loadAttempts();
  const taskKeys = [...new Set(attempts.map((item) => item.taskKey))].sort();
  const variantKeys = [...new Set(attempts.map((item) => item.variantKey))].sort();

  // --- Matrix completeness ---
  console.log("=== Matrix completeness (recorded/target, ✓=all succeeded) ===");
  const header = ["task".padEnd(9), ...variantKeys.map((key) => key.padEnd(17))].join("");
  console.log(header);
  let totalRecorded = 0;
  let totalSucceeded = 0;
  const missingCells: string[] = [];
  for (const taskKey of taskKeys) {
    const cols = [taskKey.padEnd(9)];
    for (const variantKey of variantKeys) {
      const cell = attempts.filter((item) => item.taskKey === taskKey && item.variantKey === variantKey);
      const succeeded = cell.filter((item) => item.status === "succeeded").length;
      const terminal = cell.filter((item) => ["succeeded", "failed", "timed_out"].includes(item.status)).length;
      totalRecorded += terminal;
      totalSucceeded += succeeded;
      const missing = REPEAT_TARGET - terminal;
      if (missing > 0) missingCells.push(`${taskKey}×${variantKey}: ${missing} missing`);
      const mark = succeeded === REPEAT_TARGET ? "✓" : terminal === REPEAT_TARGET ? "!" : " ";
      cols.push(`${terminal}/${REPEAT_TARGET}${mark}`.padEnd(17));
    }
    console.log(cols.join(""));
  }
  console.log(`recorded terminal attempts: ${totalRecorded} (succeeded ${totalSucceeded})`);
  if (missingCells.length > 0) console.log(`missing: ${missingCells.join("; ")}`);

  // --- Quality gate ---
  const gateFailed = attempts.filter((item) => !item.gatePassed && item.status !== "running" && item.status !== "queued");
  console.log("\n=== Automated quality gate ===");
  console.log(`pass ${attempts.filter((item) => item.gatePassed).length} / terminal ${totalRecorded}`);
  for (const item of gateFailed) {
    console.log(`  GATE-FAIL ${item.taskKey} ${item.variantKey} #${item.attemptNumber}: ${item.gateFailures.join(",")}`);
  }

  // --- Per-model aggregates over gate-passing attempts ---
  console.log("\n=== Per-model aggregates (gate-passing attempts only) ===");
  console.log(
    "model".padEnd(18) + "n".padEnd(5) + "med dur".padEnd(10) + "mean dur".padEnd(10) +
    "med fresh".padEnd(11) + "med output".padEnd(12) + "med total".padEnd(11) + "gate rate",
  );
  const perModel: Record<string, Record<string, number | string | null>> = {};
  for (const variantKey of variantKeys) {
    const all = attempts.filter((item) => item.variantKey === variantKey && ["succeeded", "failed", "timed_out"].includes(item.status));
    const passed = all.filter((item) => item.gatePassed);
    const durations = passed.map((item) => item.durationMs).filter((value): value is number => value !== null);
    const fresh = passed.map((item) => item.freshInputTokens).filter((value): value is number => value !== null);
    const output = passed.map((item) => item.outputTokens).filter((value): value is number => value !== null);
    const total = passed.map((item) => item.totalTokens).filter((value): value is number => value !== null);
    const aggregates = {
      n: passed.length,
      medianDurationMs: median(durations),
      meanDurationMs: mean(durations),
      medianFreshInputTokens: median(fresh),
      medianOutputTokens: median(output),
      medianTotalTokens: median(total),
      gateRate: all.length > 0 ? passed.length / all.length : null,
    };
    perModel[variantKey] = aggregates;
    console.log(
      variantKey.padEnd(18) + String(aggregates.n).padEnd(5) +
      fmtMs(aggregates.medianDurationMs).padEnd(10) + fmtMs(aggregates.meanDurationMs).padEnd(10) +
      fmtTok(aggregates.medianFreshInputTokens).padEnd(11) + fmtTok(aggregates.medianOutputTokens).padEnd(12) +
      fmtTok(aggregates.medianTotalTokens).padEnd(11) +
      (aggregates.gateRate === null ? "-" : `${Math.round(aggregates.gateRate * 100)}%`),
    );
  }

  // --- Per-cell medians (duration / fresh) for the report appendix ---
  console.log("\n=== Per-cell medians: duration | fresh-input (gate-passing) ===");
  console.log(["task".padEnd(9), ...variantKeys.map((key) => key.padEnd(17))].join(""));
  for (const taskKey of taskKeys) {
    const cols = [taskKey.padEnd(9)];
    for (const variantKey of variantKeys) {
      const cell = attempts.filter((item) => item.taskKey === taskKey && item.variantKey === variantKey && item.gatePassed);
      const cellDuration = median(cell.map((item) => item.durationMs).filter((value): value is number => value !== null));
      const cellFresh = median(cell.map((item) => item.freshInputTokens).filter((value): value is number => value !== null));
      cols.push(`${fmtMs(cellDuration)}|${fmtTok(cellFresh)}`.padEnd(17));
    }
    console.log(cols.join(""));
  }

  if (jsonPath) {
    const payload = {
      generatedAt: new Date().toISOString(),
      repeatTarget: REPEAT_TARGET,
      attempts: attempts.map(({ resultText: _omit, ...rest }) => rest),
      perModel,
      missingCells,
    };
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    console.log(`\n[analysis] json written: ${jsonPath}`);
  }

  if (dumpDir) {
    fs.mkdirSync(dumpDir, { recursive: true });
    for (const taskKey of taskKeys) {
      const lines: string[] = [`# ${taskKey} — bake-off result texts\n`];
      for (const variantKey of variantKeys) {
        for (const item of attempts.filter((entry) => entry.taskKey === taskKey && entry.variantKey === variantKey)) {
          lines.push(`## ${variantKey} attempt ${item.attemptNumber} (${item.status}, ${fmtMs(item.durationMs)}, fresh ${fmtTok(item.freshInputTokens)})\n`);
          lines.push(item.resultText.trim().length > 0 ? item.resultText.trim() : "_(empty resultText)_");
          lines.push("");
        }
      }
      fs.writeFileSync(path.join(dumpDir, `${taskKey}.md`), lines.join("\n"));
    }
    console.log(`[analysis] result texts dumped: ${dumpDir}`);
  }
}

main();
