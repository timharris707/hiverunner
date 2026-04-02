/**
 * Regression test for legacy migration checksum compatibility.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-migration-checksum-compat.db
 * npx tsx src/lib/__tests__/orchestration-migration-checksum-compat.test.ts
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
  console.log("\nOrchestration Migration Checksum Compatibility Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });

  const LEGACY_V1_CHECKSUM =
    "24e5dfcd9269ac7fe8c4ec5256204194dcca1cd84552f934469d5bd6cd2a4a18";

  const { getOrchestrationDb, runOrchestrationMigrations } = await import(
    "@/lib/orchestration/db"
  );
  const db = getOrchestrationDb();
  const canonicalBefore = (
    db.prepare("SELECT checksum FROM schema_migrations WHERE version = 1").get() as
      | { checksum: string }
      | undefined
  )?.checksum;
  if (!canonicalBefore) {
    throw new Error("Expected version 1 migration row to exist");
  }

  await test("allows known legacy v1 checksum without throwing", () => {
    db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run(
      LEGACY_V1_CHECKSUM
    );
    assert.doesNotThrow(() => runOrchestrationMigrations(db));
  });

  await test("normalizes legacy checksum row back to canonical checksum", () => {
    const row = db
      .prepare("SELECT checksum FROM schema_migrations WHERE version = 1")
      .get() as { checksum: string } | undefined;
    assert.ok(row);
    assert.strictEqual(row?.checksum, canonicalBefore);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
