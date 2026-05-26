import assert from "node:assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Point MC_DATA_DIR at a fresh tmp dir and pre-plant a malformed tasks.db
// there BEFORE importing tasks-db so its module-level DB_PATH resolves to
// the corrupt file. The import must happen after the env is set.
const TMP_DATA_DIR = path.join(os.tmpdir(), `mc-tasks-db-corruption-${Date.now()}`);
mkdirSync(TMP_DATA_DIR, { recursive: true });

// A 256-byte header-only "SQLite format 3\0" blob would be valid but empty.
// To reliably trip SQLITE_CORRUPT / SQLITE_NOTADB, write garbage.
writeFileSync(
  path.join(TMP_DATA_DIR, "tasks.db"),
  Buffer.from("this is definitely not a valid sqlite database file ".repeat(64))
);

process.env.MC_DATA_DIR = TMP_DATA_DIR;

import {
  dbReadTasks,
  dbWriteTasks,
  dbUpsertTask,
  dbJournalTransition,
  dbGetTransitions,
  dbCheckpoint,
  dbGetSnapshots,
} from "@/lib/tasks-db";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  \u2713 ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  \u2717 ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\ntasks-db Corruption Silencing Tests\n");

  // Capture stderr to prove only one log line per operation class.
  const originalErr = console.error;
  const logLines: string[] = [];
  console.error = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };

  try {
    await test("dbReadTasks returns [] on corrupt legacy db", () => {
      assert.deepStrictEqual(dbReadTasks(), []);
    });

    await test("dbWriteTasks is a silent no-op on corrupt legacy db", () => {
      dbWriteTasks([{ id: "t1", status: "backlog", project: "x", updated: "now" }]);
      // No throw; no return value; pass.
    });

    await test("dbUpsertTask is a silent no-op on corrupt legacy db", () => {
      dbUpsertTask({ id: "t2", status: "backlog", project: "x", updated: "now" });
    });

    await test("dbJournalTransition is a silent no-op on corrupt legacy db", () => {
      dbJournalTransition("t1", "backlog", "to-do", "test", "corruption-test");
    });

    await test("dbGetTransitions returns [] on corrupt legacy db", () => {
      assert.deepStrictEqual(dbGetTransitions(), []);
      assert.deepStrictEqual(dbGetTransitions("t1"), []);
    });

    await test("dbCheckpoint returns zeroed result on corrupt legacy db", () => {
      const result = dbCheckpoint("corruption-test");
      assert.deepStrictEqual(result, {
        pagesWritten: 0,
        pagesRemaining: 0,
        taskCount: 0,
      });
    });

    await test("dbGetSnapshots returns [] on corrupt legacy db", () => {
      assert.deepStrictEqual(dbGetSnapshots(), []);
    });

    await test("corruption is logged exactly once across all operations", () => {
      const corruptionLines = logLines.filter((line) =>
        line.includes("LEGACY tasks.db IS CORRUPT")
      );
      assert.strictEqual(
        corruptionLines.length,
        1,
        `expected 1 LEGACY-corrupt log line, got ${corruptionLines.length}: ${JSON.stringify(corruptionLines)}`
      );
    });
  } finally {
    console.error = originalErr;
    rmSync(TMP_DATA_DIR, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
