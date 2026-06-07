import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import {
  buildRuntimeBenchmarkSummary,
  evaluateRuntimeBenchmarkPromotionGate,
  formatRuntimeBenchmarkMarkdown,
  type RuntimeBenchmarkSummary,
  type RuntimePromotionGateResult,
} from "@/lib/orchestration/runtime-benchmark";

type CliOptions = {
  dbPath: string;
  baselineDbPath: string | null;
  baselineSummaryPath: string | null;
  goalKey: string;
  outPath: string | null;
  format: "markdown" | "json";
};

function usage(): never {
  console.error([
    "Usage: node ./scripts/run-tsx.mjs scripts/runtime-promotion-gate.ts --db <new.db> --baseline-db <old.db> [--goal INS-G006] [--format markdown|json] [--out path]",
    "       node ./scripts/run-tsx.mjs scripts/runtime-promotion-gate.ts --db <new.db> --baseline-summary <old-summary.json>",
  ].join("\n"));
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: process.env.ORCHESTRATION_DB_PATH || path.join(process.cwd(), "data", "orchestration.db"),
    baselineDbPath: null,
    baselineSummaryPath: null,
    goalKey: "INS-G006",
    outPath: null,
    format: "markdown",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--db" && next) {
      options.dbPath = path.resolve(next);
      index += 1;
    } else if (arg === "--baseline-db" && next) {
      options.baselineDbPath = path.resolve(next);
      index += 1;
    } else if (arg === "--baseline-summary" && next) {
      options.baselineSummaryPath = path.resolve(next);
      index += 1;
    } else if (arg === "--goal" && next) {
      options.goalKey = next;
      index += 1;
    } else if (arg === "--format" && next) {
      if (next !== "markdown" && next !== "json") usage();
      options.format = next;
      index += 1;
    } else if (arg === "--out" && next) {
      options.outPath = path.resolve(next);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
  }

  if (!options.baselineDbPath && !options.baselineSummaryPath) {
    usage();
  }
  return options;
}

function readSummaryFromDb(dbPath: string, goalKey: string): RuntimeBenchmarkSummary {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return buildRuntimeBenchmarkSummary(db, goalKey);
  } finally {
    db.close();
  }
}

function readBaselineSummary(options: CliOptions): RuntimeBenchmarkSummary {
  if (options.baselineSummaryPath) {
    return JSON.parse(fs.readFileSync(options.baselineSummaryPath, "utf8")) as RuntimeBenchmarkSummary;
  }
  if (options.baselineDbPath) {
    return readSummaryFromDb(options.baselineDbPath, options.goalKey);
  }
  usage();
}

function formatGateMarkdown(input: {
  summary: RuntimeBenchmarkSummary;
  baseline: RuntimeBenchmarkSummary;
  gate: RuntimePromotionGateResult;
}): string {
  return [
    `# Runtime Promotion Gate - ${input.summary.scope.goalKey}`,
    "",
    `Status: ${input.gate.ok ? "PASS" : "FAIL"}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Value | Threshold | Detail |",
    "| --- | --- | ---: | ---: | --- |",
    ...input.gate.checks.map((check) => [
      check.name,
      check.ok ? "PASS" : "FAIL",
      String(check.value),
      String(check.threshold),
      check.detail ?? "",
    ].map((value) => value.replace(/\|/g, "\\|")).join(" | ")).map((row) => `| ${row} |`),
    "",
    "## New Summary",
    "",
    formatRuntimeBenchmarkMarkdown(input.summary),
    "",
    "## Baseline Summary",
    "",
    formatRuntimeBenchmarkMarkdown(input.baseline),
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = readSummaryFromDb(options.dbPath, options.goalKey);
  const baseline = readBaselineSummary(options);
  const gate = evaluateRuntimeBenchmarkPromotionGate(summary, baseline);
  const output = options.format === "json"
    ? `${JSON.stringify({ ok: gate.ok, gate, summary, baseline }, null, 2)}\n`
    : formatGateMarkdown({ summary, baseline, gate });

  if (options.outPath) {
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, output, "utf8");
  } else {
    process.stdout.write(output);
  }

  if (!gate.ok) process.exit(1);
}

main();
