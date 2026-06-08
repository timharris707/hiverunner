import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import {
  buildRuntimeBenchmarkPromotionReport,
  buildRuntimeBenchmarkSummary,
  formatRuntimeBenchmarkMarkdown,
  type RuntimeBenchmarkPromotionReport,
  type RuntimeBenchmarkSummary,
  type RuntimeMetricStats,
  type RuntimePromotionEvidence,
} from "@/lib/orchestration/runtime-benchmark";

type CliOptions = {
  dbPath: string | null;
  candidateSummaryPaths: string[];
  baselineDbPath: string | null;
  baselineSummaryPaths: string[];
  goalKey: string;
  outPath: string | null;
  evidencePath: string | null;
  requiredRepeats: number;
  expectedTaskCount: number;
  format: "markdown" | "json";
};

function usage(): never {
  console.error([
    "Usage: node ./scripts/run-tsx.mjs scripts/runtime-promotion-gate.ts --candidate-summary <new-1.json> --candidate-summary <new-2.json> --candidate-summary <new-3.json> --baseline-summary <old-1.json> --baseline-summary <old-2.json> --baseline-summary <old-3.json> --evidence <proof.json>",
    "       node ./scripts/run-tsx.mjs scripts/runtime-promotion-gate.ts --db <new.db> --baseline-db <old.db> [--goal INS-G006]",
    "Options: [--required-repeats 3] [--expected-tasks 10] [--format markdown|json] [--out path]",
  ].join("\n"));
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: process.env.ORCHESTRATION_DB_PATH || path.join(process.cwd(), "data", "orchestration.db"),
    candidateSummaryPaths: [],
    baselineDbPath: null,
    baselineSummaryPaths: [],
    goalKey: "INS-G006",
    outPath: null,
    evidencePath: null,
    requiredRepeats: 3,
    expectedTaskCount: 10,
    format: "markdown",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--db" && next) {
      options.dbPath = path.resolve(next);
      index += 1;
    } else if (arg === "--candidate-summary" && next) {
      options.candidateSummaryPaths.push(path.resolve(next));
      if (options.dbPath === (process.env.ORCHESTRATION_DB_PATH || path.join(process.cwd(), "data", "orchestration.db"))) {
        options.dbPath = null;
      }
      index += 1;
    } else if (arg === "--baseline-db" && next) {
      options.baselineDbPath = path.resolve(next);
      index += 1;
    } else if (arg === "--baseline-summary" && next) {
      options.baselineSummaryPaths.push(path.resolve(next));
      index += 1;
    } else if (arg === "--goal" && next) {
      options.goalKey = next;
      index += 1;
    } else if (arg === "--evidence" && next) {
      options.evidencePath = path.resolve(next);
      index += 1;
    } else if (arg === "--required-repeats" && next) {
      const requiredRepeats = Number(next);
      if (!Number.isInteger(requiredRepeats) || requiredRepeats < 1) usage();
      options.requiredRepeats = requiredRepeats;
      index += 1;
    } else if (arg === "--expected-tasks" && next) {
      const expectedTaskCount = Number(next);
      if (!Number.isInteger(expectedTaskCount) || expectedTaskCount < 1) usage();
      options.expectedTaskCount = expectedTaskCount;
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

  if (options.candidateSummaryPaths.length === 0 && !options.dbPath) {
    usage();
  }
  if (!options.baselineDbPath && options.baselineSummaryPaths.length === 0) {
    usage();
  }
  return options;
}

function readSummaryFromDb(dbPath: string, goalKey: string, expectedTaskCount: number): RuntimeBenchmarkSummary {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return buildRuntimeBenchmarkSummary(db, goalKey, { expectedTaskCount });
  } finally {
    db.close();
  }
}

function readSummaryPath(summaryPath: string): RuntimeBenchmarkSummary {
  const parsed = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as unknown;
  if (parsed && typeof parsed === "object" && "summary" in parsed) {
    return (parsed as { summary: RuntimeBenchmarkSummary }).summary;
  }
  return parsed as RuntimeBenchmarkSummary;
}

function readEvidence(options: CliOptions): RuntimePromotionEvidence | null {
  if (!options.evidencePath) return null;
  const parsed = JSON.parse(fs.readFileSync(options.evidencePath, "utf8")) as unknown;
  if (parsed && typeof parsed === "object" && "evidence" in parsed) {
    return (parsed as { evidence: RuntimePromotionEvidence }).evidence;
  }
  return parsed as RuntimePromotionEvidence;
}

function readCandidateSummaries(options: CliOptions): RuntimeBenchmarkSummary[] {
  if (options.candidateSummaryPaths.length > 0) {
    return options.candidateSummaryPaths.map(readSummaryPath);
  }
  if (options.dbPath) {
    return [readSummaryFromDb(options.dbPath, options.goalKey, options.expectedTaskCount)];
  }
  usage();
}

function readBaselineSummaries(options: CliOptions): RuntimeBenchmarkSummary[] {
  if (options.baselineSummaryPaths.length > 0) {
    return options.baselineSummaryPaths.map(readSummaryPath);
  }
  if (options.baselineDbPath) {
    return [readSummaryFromDb(options.baselineDbPath, options.goalKey, options.expectedTaskCount)];
  }
  usage();
}

function formatMetric(stats: RuntimeMetricStats, suffix = ""): string {
  if (stats.median === null) return "n/a";
  const median = Number(stats.median.toFixed(2));
  const p95 = stats.p95 === null ? "n/a" : Number(stats.p95.toFixed(2));
  return `${median}${suffix} (p95 ${p95}${suffix}, noise ${Number(stats.noise.toFixed(2))}${suffix})`;
}

function formatSideBySide(report: RuntimeBenchmarkPromotionReport): string {
  const rows = [
    ["Repeats", String(report.baseline.repeatCount), String(report.candidate.repeatCount)],
    ["Total runs", formatMetric(report.baseline.metrics.totalRuns), formatMetric(report.candidate.metrics.totalRuns)],
    ["Average runs/task", formatMetric(report.baseline.metrics.averageRunsPerTask), formatMetric(report.candidate.metrics.averageRunsPerTask)],
    ["Runtime-quality rate", formatMetric(report.baseline.metrics.runtimeQualityRate, "x"), formatMetric(report.candidate.metrics.runtimeQualityRate, "x")],
    ["Fresh input/completed task", formatMetric(report.baseline.metrics.freshInputPerCompletedTask), formatMetric(report.candidate.metrics.freshInputPerCompletedTask)],
    ["First evidence p50", formatMetric(report.baseline.metrics.firstEvidenceP50Ms, "ms"), formatMetric(report.candidate.metrics.firstEvidenceP50Ms, "ms")],
    ["First evidence p95", formatMetric(report.baseline.metrics.firstEvidenceP95Ms, "ms"), formatMetric(report.candidate.metrics.firstEvidenceP95Ms, "ms")],
    ["Detect unhealthy p50", formatMetric(report.baseline.metrics.detectUnhealthyP50Ms, "ms"), formatMetric(report.candidate.metrics.detectUnhealthyP50Ms, "ms")],
    ["Detect unhealthy p95", formatMetric(report.baseline.metrics.detectUnhealthyP95Ms, "ms"), formatMetric(report.candidate.metrics.detectUnhealthyP95Ms, "ms")],
  ];
  return [
    "| Metric | Baseline arm | Candidate arm |",
    "| --- | ---: | ---: |",
    ...rows.map((row) => `| ${row.map((value) => value.replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n");
}

function formatGateMarkdown(input: {
  candidateSummaries: RuntimeBenchmarkSummary[];
  baselineSummaries: RuntimeBenchmarkSummary[];
  report: RuntimeBenchmarkPromotionReport;
}): string {
  const candidateSummary = input.candidateSummaries[0];
  const baselineSummary = input.baselineSummaries[0];
  return [
    `# Runtime Promotion Gate - ${candidateSummary?.scope.goalKey ?? baselineSummary?.scope.goalKey ?? "unknown"}`,
    "",
    `Status: ${input.report.gate.ok ? "PASS" : "FAIL"}`,
    "",
    "## Checks",
    "",
    "| Check | Status | Value | Threshold | Detail |",
    "| --- | --- | ---: | ---: | --- |",
    ...input.report.gate.checks.map((check) => [
      check.name,
      check.ok ? "PASS" : "FAIL",
      String(check.value),
      String(check.threshold),
      check.detail ?? "",
    ].map((value) => value.replace(/\|/g, "\\|")).join(" | ")).map((row) => `| ${row} |`),
    "",
    "## Side-By-Side",
    "",
    formatSideBySide(input.report),
    "",
    "## Candidate Representative Summary",
    "",
    candidateSummary ? formatRuntimeBenchmarkMarkdown(candidateSummary) : "No candidate summary.",
    "",
    "## Baseline Representative Summary",
    "",
    baselineSummary ? formatRuntimeBenchmarkMarkdown(baselineSummary) : "No baseline summary.",
  ].join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidateSummaries = readCandidateSummaries(options);
  const baselineSummaries = readBaselineSummaries(options);
  const evidence = readEvidence(options);
  const report = buildRuntimeBenchmarkPromotionReport(candidateSummaries, baselineSummaries, {
    requiredTaskCount: options.expectedTaskCount,
    requiredRepeats: options.requiredRepeats,
    evidence,
  });
  const output = options.format === "json"
    ? `${JSON.stringify({ ok: report.gate.ok, report, candidateSummaries, baselineSummaries, evidence }, null, 2)}\n`
    : formatGateMarkdown({ candidateSummaries, baselineSummaries, report });

  if (options.outPath) {
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    fs.writeFileSync(options.outPath, output, "utf8");
  } else {
    process.stdout.write(output);
  }

  if (!report.gate.ok) process.exit(1);
}

main();
