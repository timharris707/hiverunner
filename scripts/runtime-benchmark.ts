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
};

function usage(): never {
  console.error("Usage: npm run tsx -- scripts/runtime-benchmark.ts [--db path] [--goal INS-G006] [--format markdown|json] [--out path]");
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dbPath: process.env.ORCHESTRATION_DB_PATH || path.join(process.cwd(), "data", "orchestration.db"),
    goalKey: "INS-G006",
    format: "markdown",
    outPath: null,
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
    const summary = buildRuntimeBenchmarkSummary(db, options.goalKey);
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
