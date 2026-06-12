import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
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

test("parses complete decision metadata and derives a short summary", () => {
  const result = parseDecisionLogMarkdown(fixture("complete-metadata.md"));

  assert.deepStrictEqual(result, {
    title: "Adopt Local-First Review Queue",
    status: "accepted",
    owner: "Mannie",
    date: "2026-06-09",
    tags: ["orchestration", "review", "local-first"],
    summary:
      "Use the local review queue as the default handoff path so QA can verify artifacts before sprint completion.",
    warnings: [],
  });
});

test("handles missing optional metadata with nulls and empty tags", () => {
  const result = parseDecisionLogMarkdown(fixture("missing-optional-metadata.md"));

  assert.strictEqual(result.title, "Keep Scratch Benchmarks Out of Runtime");
  assert.strictEqual(result.status, "proposed");
  assert.strictEqual(result.owner, null);
  assert.strictEqual(result.date, null);
  assert.deepStrictEqual(result.tags, []);
  assert.strictEqual(
    result.summary,
    "Benchmark utilities should live outside application runtime paths unless they become maintained product tooling.",
  );
});

test("does not crash on malformed metadata and records warnings", () => {
  const result = parseDecisionLogMarkdown(fixture("malformed-metadata.md"));

  assert.strictEqual(result.title, "Tolerate Partial Decision Logs");
  assert.strictEqual(result.status, "draft");
  assert.strictEqual(result.owner, "Anvil");
  assert.deepStrictEqual(result.tags, ["parser"]);
  assert.ok(result.warnings.length >= 1);
  assert.match(result.warnings[0], /Malformed metadata line/);
});

test("formats a readable markdown summary with fallback values", () => {
  const parsed = parseDecisionLogMarkdown(fixture("missing-optional-metadata.md"));
  const output = formatDecisionLogSummary(parsed);

  assert.strictEqual(
    output,
    [
      "## Keep Scratch Benchmarks Out of Runtime",
      "",
      "- Status: proposed",
      "- Owner: unassigned",
      "- Date: undated",
      "- Tags: none",
      "- Summary: Benchmark utilities should live outside application runtime paths unless they become maintained product tooling.",
    ].join("\n"),
  );
});

test("summarizes multiple fixture files in deterministic file order", () => {
  const output = summarizeDecisionLogFiles([
    path.join(fixtureDir, "complete-metadata.md"),
    path.join(fixtureDir, "missing-optional-metadata.md"),
  ]);

  assert.match(output, /^## Adopt Local-First Review Queue/);
  assert.match(output, /## Keep Scratch Benchmarks Out of Runtime/);
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
