import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type CliOptions = {
  sourceDbPath: string;
  targetDbPath: string;
  manifestPath: string;
  goalKey: string;
};

function usage(): never {
  console.error("Usage: node ./scripts/run-tsx.mjs scripts/prepare-exec-dev-benchmark.ts [--source-db data/orchestration.db] [--target-db data-exec-dev/orchestration.db] [--goal INS-G006]");
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const appDir = process.cwd();
  const options: CliOptions = {
    sourceDbPath: path.join(appDir, "data", "orchestration.db"),
    targetDbPath: path.join(appDir, "data-exec-dev", "orchestration.db"),
    manifestPath: path.join(appDir, "data-exec-dev", "benchmark-manifest.json"),
    goalKey: "INS-G006",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--source-db" && next) {
      options.sourceDbPath = path.resolve(next);
      index += 1;
    } else if (arg === "--target-db" && next) {
      options.targetDbPath = path.resolve(next);
      options.manifestPath = path.join(path.dirname(options.targetDbPath), "benchmark-manifest.json");
      index += 1;
    } else if (arg === "--manifest" && next) {
      options.manifestPath = path.resolve(next);
      index += 1;
    } else if (arg === "--goal" && next) {
      options.goalKey = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      usage();
    } else {
      usage();
    }
  }

  return options;
}

function assertSafeTarget(sourceDbPath: string, targetDbPath: string): void {
  const appDir = process.cwd();
  const source = path.resolve(sourceDbPath);
  const target = path.resolve(targetDbPath);
  const stableDir = path.resolve(appDir, "data");
  const observerDevDir = path.resolve(appDir, "data-dev");

  if (source === target) {
    throw new Error("Refusing to copy benchmark DB onto itself.");
  }
  if (target.startsWith(`${stableDir}${path.sep}`) || target === stableDir) {
    throw new Error(`Refusing to write execution benchmark DB inside stable data dir: ${stableDir}`);
  }
  if (target.startsWith(`${observerDevDir}${path.sep}`) || target === observerDevDir) {
    throw new Error(`Refusing to write execution benchmark DB inside observer dev data dir: ${observerDevDir}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertSafeTarget(options.sourceDbPath, options.targetDbPath);

  fs.mkdirSync(path.dirname(options.targetDbPath), { recursive: true });

  const source = new Database(options.sourceDbPath, { readonly: true, fileMustExist: true });
  try {
    source.pragma("query_only = ON");
    const goal = source
      .prepare("SELECT id, goal_key, name, status FROM sprints WHERE goal_key = ? LIMIT 1")
      .get(options.goalKey) as { id: string; goal_key: string; name: string; status: string } | undefined;
    if (!goal) {
      throw new Error(`Goal ${options.goalKey} not found in source DB.`);
    }

    if (fs.existsSync(options.targetDbPath)) {
      fs.rmSync(options.targetDbPath);
    }
    await source.backup(options.targetDbPath);

    const copied = new Database(options.targetDbPath, { readonly: true, fileMustExist: true });
    try {
      copied.pragma("query_only = ON");
      const copiedGoal = copied.prepare("SELECT id FROM sprints WHERE goal_key = ? LIMIT 1").get(options.goalKey);
      if (!copiedGoal) {
        throw new Error(`Copied DB is missing goal ${options.goalKey}.`);
      }
    } finally {
      copied.close();
    }

    const manifest = {
      schema: "hiverunner.exec-dev-benchmark-manifest.v1",
      createdAt: new Date().toISOString(),
      goalKey: options.goalKey,
      sourceDbPath: path.resolve(options.sourceDbPath),
      targetDbPath: path.resolve(options.targetDbPath),
      targetDataDir: path.dirname(path.resolve(options.targetDbPath)),
      goal,
      notes: [
        "Copied with better-sqlite3 backup from a readonly/query_only source handle.",
        "Target is intended for an execution-dev lane only, not stable 3001 or observer-only 3010.",
      ],
    };
    fs.writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Prepared execution-dev benchmark DB: ${options.targetDbPath}`);
    console.log(`Manifest: ${options.manifestPath}`);
  } finally {
    source.close();
  }
}

main().catch((error) => {
  console.error(`[prepare-exec-dev-benchmark] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
