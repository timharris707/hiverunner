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

  const {
    checkOrchestrationMigrationCompatibility,
    getOrchestrationDb,
    runOrchestrationMigrations,
  } = await import(
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

  await test("reports unknown checksum drift before migrations throw", () => {
    db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run(
      "unknown-checksum"
    );
    const compatibility = checkOrchestrationMigrationCompatibility(db);
    assert.strictEqual(compatibility.ok, false);
    assert.deepStrictEqual(
      compatibility.incompatible.map((issue) => issue.reason),
      ["checksum_mismatch"]
    );
    assert.strictEqual(compatibility.incompatible[0]?.version, 1);
    assert.throws(
      () => runOrchestrationMigrations(db),
      /Migration checksum mismatch for v1/
    );
    db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 1").run(
      canonicalBefore
    );
  });

  await test("allows legacy migration rows below this bundle's latest version", () => {
    db.prepare(
      "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
    ).run(17, "legacy_removed_migration", "legacy-checksum");
    const compatibility = checkOrchestrationMigrationCompatibility(db);
    assert.strictEqual(compatibility.ok, true);
    assert.deepStrictEqual(
      compatibility.legacyExtra.map((issue) => issue.reason),
      ["legacy_extra"]
    );
    assert.strictEqual(compatibility.legacyExtra[0]?.version, 17);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(17);
  });

  await test("reports future DB migrations that this bundle does not know about", () => {
    db.prepare(
      "INSERT INTO schema_migrations(version, name, checksum) VALUES (?, ?, ?)"
    ).run(999, "future_bundle_only_migration", "future-checksum");
    const compatibility = checkOrchestrationMigrationCompatibility(db);
    assert.strictEqual(compatibility.ok, false);
    assert.deepStrictEqual(
      compatibility.incompatible.map((issue) => issue.reason),
      ["future_migration"]
    );
    assert.strictEqual(compatibility.appliedLatestVersion, 999);
    db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(999);
  });


  await test("allows compatible dev-lane v70 runner metadata checksum", () => {
    const DEV_V70_RUNNER_METADATA_CHECKSUM =
      "a7534837ea482874819ad4d1d896c1bf7c8205639452a44b8daa3e8f64c22210";
    db.prepare("UPDATE schema_migrations SET name = ?, checksum = ? WHERE version = 70").run(
      "execution_runs_runner_metadata",
      DEV_V70_RUNNER_METADATA_CHECKSUM
    );

    const compatibility = checkOrchestrationMigrationCompatibility(db);
    assert.strictEqual(compatibility.ok, true);
    assert.doesNotThrow(() => runOrchestrationMigrations(db));

    const row = db
      .prepare("SELECT name, checksum FROM schema_migrations WHERE version = 70")
      .get() as { name: string; checksum: string } | undefined;
    assert.strictEqual(row?.name, "execution_runs_add_runner_identity");
    assert.notStrictEqual(row?.checksum, DEV_V70_RUNNER_METADATA_CHECKSUM);

    const indexRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_execution_runs_runner_identity'")
      .get() as { name: string } | undefined;
    assert.strictEqual(indexRow?.name, "idx_execution_runs_runner_identity");
  });

  await test("records execution-engine migrations when schema was applied out of band", () => {
    db.prepare("DELETE FROM schema_migrations WHERE version IN (63, 64)").run();
    assert.doesNotThrow(() => runOrchestrationMigrations(db));

    const rows = db
      .prepare("SELECT version, name FROM schema_migrations WHERE version IN (63, 64) ORDER BY version")
      .all() as Array<{ version: number; name: string }>;
    assert.deepStrictEqual(rows, [
      { version: 63, name: "tasks_add_execution_engine" },
      { version: 64, name: "execution_runs_add_symphony_provider" },
    ]);
  });

  await test("repairs legacy memory writeback log foreign keys after v101 index rebuild", () => {
    db.exec(`
      DROP TABLE IF EXISTS memory_writeback_log;
      DROP TABLE IF EXISTS memory_source_index_v101_backup;
      CREATE TABLE memory_source_index_v101_backup (
        record_id TEXT PRIMARY KEY
      );
      INSERT INTO memory_source_index_v101_backup(record_id) VALUES ('legacy-record');
      CREATE TABLE memory_writeback_log (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id        TEXT NOT NULL REFERENCES "memory_source_index_v101_backup"(record_id) ON DELETE CASCADE,
        source_path      TEXT NOT NULL,
        action           TEXT NOT NULL CHECK (action IN ('tag_write','archive','unarchive')),
        before_snapshot  TEXT,
        after_snapshot   TEXT,
        written_at       REAL NOT NULL,
        attribution      TEXT NOT NULL DEFAULT 'operator',
        error            TEXT,
        company_id       TEXT,
        candidate_id     TEXT
      );
      INSERT INTO memory_writeback_log(record_id, source_path, action, written_at, attribution)
      VALUES ('legacy-record', '/tmp/legacy-memory.md', 'tag_write', 1, 'operator');
    `);

    assert.doesNotThrow(() => runOrchestrationMigrations(db));

    const foreignKeys = db
      .prepare("PRAGMA foreign_key_list(memory_writeback_log)")
      .all() as Array<{ table: string }>;
    assert.ok(!foreignKeys.some((row) => row.table === "memory_source_index_v101_backup"));

    db.prepare(`
      INSERT INTO memory_writeback_log
        (id, company_id, candidate_id, record_id, source_path, action, before_snapshot, after_snapshot, attribution, error)
      VALUES ('repair-test', NULL, NULL, NULL, '/tmp/repair-test.md', 'create', NULL, NULL, 'test', NULL)
    `).run();

    const repaired = db
      .prepare("SELECT action FROM memory_writeback_log WHERE id = 'legacy-1'")
      .get() as { action: string } | undefined;
    assert.strictEqual(repaired?.action, "legacy_tag_write");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
