import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import {
  buildRuntimeBenchmarkSummary,
  formatRuntimeBenchmarkMarkdown,
} from "@/lib/orchestration/runtime-benchmark";

type CliOptions = {
  dbPath: string;
  goalKey: string;
  format: "markdown" | "json";
  outPath: string | null;
  fixtureId: string | null;
  arm: "baseline" | "candidate" | null;
  repeatIndex: number | null;
  requiredRepeats: number;
  expectedTaskCount: number;
  taskKeys: string[];
  runStartedAfter: string | null;
  runStartedBefore: string | null;
};

function usage(): never {
  console.error([
    "Usage: npm run tsx -- scripts/runtime-benchmark.ts [--db path] [--goal INS-G006] [--format markdown|json] [--out path]",
    "       [--fixture-id ins-g006-runtime-replay-v1] [--arm baseline|candidate] [--repeat 1] [--required-repeats 3] [--expected-tasks 10]",
    "       [--task-key INS-205] [--task-keys INS-205,INS-208] [--run-started-after ISO] [--run-started-before ISO]",
  ].join("\n"));
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: process.env.ORCHESTRATION_DB_PATH || path.join(process.cwd(), "data", "orchestration.db"),
    goalKey: "INS-G006",
    format: "markdown",
    outPath: null,
    fixtureId: null,
    arm: null,
    repeatIndex: null,
    requiredRepeats: 3,
    expectedTaskCount: 10,
    taskKeys: [],
    runStartedAfter: null,
    runStartedBefore: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--db" && next) {
      options.dbPath = next;
      index += 1;
    } else if (arg === "--goal" && next) {
      options.goalKey = next;
      index += 1;
    } else if (arg === "--format" && next) {
      if (next !== "markdown" && next !== "json") usage();
      options.format = next;
      index += 1;
    } else if (arg === "--out" && next) {
      options.outPath = next;
      index += 1;
    } else if (arg === "--fixture-id" && next) {
      options.fixtureId = next;
      index += 1;
    } else if (arg === "--arm" && next) {
      if (next !== "baseline" && next !== "candidate") usage();
      options.arm = next;
      index += 1;
    } else if (arg === "--repeat" && next) {
      const repeatIndex = Number(next);
      if (!Number.isInteger(repeatIndex) || repeatIndex < 1) usage();
      options.repeatIndex = repeatIndex;
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
    } else if (arg === "--task-key" && next) {
      options.taskKeys.push(next);
      index += 1;
    } else if (arg === "--task-keys" && next) {
      options.taskKeys.push(...next.split(","));
      index += 1;
    } else if (arg === "--run-started-after" && next) {
      options.runStartedAfter = next;
      index += 1;
    } else if (arg === "--run-started-before" && next) {
      options.runStartedBefore = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new Database(options.dbPath, { readonly: true, fileMustExist: true });
  try {
    const summary = buildRuntimeBenchmarkSummary(db, options.goalKey, {
      fixtureId: options.fixtureId,
      arm: options.arm,
      repeatIndex: options.repeatIndex,
      requiredRepeats: options.requiredRepeats,
      expectedTaskCount: options.expectedTaskCount,
      taskKeys: options.taskKeys,
      runStartedAfter: options.runStartedAfter,
      runStartedBefore: options.runStartedBefore,
    });
    const output = options.format === "json"
      ? `${JSON.stringify(summary, null, 2)}\n`
      : formatRuntimeBenchmarkMarkdown(summary);

    if (options.outPath) {
      fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
      fs.writeFileSync(options.outPath, output);
    } else {
      process.stdout.write(output);
    }
  } finally {
    db.close();
  }
}

main();
