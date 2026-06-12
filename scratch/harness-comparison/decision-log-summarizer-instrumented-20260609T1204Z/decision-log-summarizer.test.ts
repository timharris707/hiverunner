import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  formatDecisionLogReport,
  formatDecisionLogSummary,
  parseDecisionLogMarkdown,
  summarizeDecisionLogFiles,
} from "./decision-log-summarizer";

type TestFn = () => void;

const fixtureDir = path.join(__dirname, "fixtures");
const tests: Array<[string, TestFn]> = [];

function test(name: string, fn: TestFn): void {
  tests.push([name, fn]);
}

function fixture(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf8");
}

test("parses complete decision metadata and records instrumentation", () => {
  const markdown = fixture("complete-metadata.md");
  const result = parseDecisionLogMarkdown(markdown, { sourcePath: "complete-metadata.md" });

  assert.strictEqual(result.title, "Adopt Instrumented Decision Summaries");
  assert.strictEqual(result.status, "accepted");
  assert.strictEqual(result.owner, "Anvil");
  assert.strictEqual(result.date, "2026-06-09");
  assert.deepStrictEqual(result.tags, ["benchmark", "instrumentation", "parser"]);
  assert.strictEqual(
    result.summary,
    "Capture decision-log summaries with local parser metrics so QA can verify extraction behavior and runtime cost without touching production code.",
  );
  assert.deepStrictEqual(result.warnings, []);
  assert.deepStrictEqual(result.instrumentation, {
    sourcePath: "complete-metadata.md",
    inputBytes: Buffer.byteLength(markdown, "utf8"),
    inputLines: markdown.trimStart().split("\n").length,
    metadataFieldCount: 5,
    warningCount: 0,
    summarySource: "metadata",
  });
});

test("handles missing optional metadata with fallback values", () => {
  const result = parseDecisionLogMarkdown(fixture("missing-optional-metadata.md"));

  assert.strictEqual(result.title, "Keep Benchmark Utilities Local");
  assert.strictEqual(result.status, "proposed");
  assert.strictEqual(result.owner, null);
  assert.strictEqual(result.date, null);
  assert.deepStrictEqual(result.tags, []);
  assert.strictEqual(
    result.summary,
    "Local benchmark utilities should remain in scratch unless they graduate into maintained tooling.",
  );
  assert.strictEqual(result.instrumentation.summarySource, "body");
  assert.strictEqual(result.instrumentation.metadataFieldCount, 1);
});

test("does not crash on malformed metadata and records warnings", () => {
  const result = parseDecisionLogMarkdown(fixture("malformed-metadata.md"));

  assert.strictEqual(result.title, "Tolerate Damaged Metadata");
  assert.strictEqual(result.status, "draft");
  assert.strictEqual(result.owner, "Anvil");
  assert.strictEqual(result.date, null);
  assert.deepStrictEqual(result.tags, ["parser", "resilience"]);
  assert.strictEqual(
    result.summary,
    "The parser should keep usable fields and produce warnings when metadata lines are malformed.",
  );
  assert.ok(result.warnings.length >= 1);
  assert.match(result.warnings[0], /Malformed metadata line/);
  assert.strictEqual(result.instrumentation.warningCount, result.warnings.length);
});

test("formats a readable markdown summary with instrumentation", () => {
  const parsed = parseDecisionLogMarkdown(fixture("missing-optional-metadata.md"));
  const output = formatDecisionLogSummary(parsed);

  assert.match(output, /^## Keep Benchmark Utilities Local/);
  assert.match(output, /- Owner: unassigned/);
  assert.match(output, /- Date: undated/);
  assert.match(output, /- Tags: none/);
  assert.match(output, /- Instrumentation: \d+ bytes, 1 metadata fields, 0 warnings, summary source body/);
});

test("summarizes multiple fixture files and emits run metrics", () => {
  const report = summarizeDecisionLogFiles([
    path.join(fixtureDir, "complete-metadata.md"),
    path.join(fixtureDir, "malformed-metadata.md"),
    path.join(fixtureDir, "missing-optional-metadata.md"),
  ]);
  const output = formatDecisionLogReport(report);

  assert.strictEqual(report.summaries.length, 3);
  assert.strictEqual(report.metrics.fileCount, 3);
  assert.strictEqual(report.metrics.decisionCount, 3);
  assert.ok(report.metrics.totalInputBytes > 0);
  assert.ok(report.metrics.elapsedMs >= 0);
  assert.ok(report.metrics.warningCount >= 1);
  assert.match(output, /## Instrumentation/);
  assert.match(output, /- Files: 3/);
  assert.match(output, /- Decisions: 3/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

console.log(`\n${tests.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
