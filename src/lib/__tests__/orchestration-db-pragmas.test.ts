/**
 * Contract tests for orchestration SQLite connection pragmas.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-db-pragmas.db
 * npx tsx src/lib/__tests__/orchestration-db-pragmas.test.ts
 */

import assert from "node:assert";
import { rmSync } from "node:fs";

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
  console.log("\nOrchestration DB Pragma Contract Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });

  const { getOrchestrationDb } = await import("@/lib/orchestration/db");
  const db = getOrchestrationDb();

  await test("connection enables WAL journal mode", () => {
    const mode = db.pragma("journal_mode", { simple: true });
    assert.strictEqual(mode, "wal");
  });

  await test("connection enables foreign key enforcement", () => {
    const enabled = db.pragma("foreign_keys", { simple: true });
    assert.strictEqual(enabled, 1);
  });

  await test("connection sets busy timeout to 5000ms", () => {
    const timeoutMs = db.pragma("busy_timeout", { simple: true });
    assert.strictEqual(timeoutMs, 5000);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
