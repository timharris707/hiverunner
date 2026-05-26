/**
 * Regression test for production project seeding used by sidebar parity.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-seed-projects.db
 * npx tsx src/lib/__tests__/orchestration-seed-projects.test.ts
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

const EXPECTED_SLUGS = [
  "hiverunner-orchestration",
  "research-lab",
  "ops-automation",
  "product-studio",
  "insight-website",
  "signalforge",
  "ideas-pipeline",
  "snapaudit",
] as const;

async function run() {
  console.log("\nOrchestration Seed Projects Tests\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  const {
    closeOrchestrationDb,
    getOrchestrationDb,
    seedOrchestrationDevData,
  } = await import("@/lib/orchestration/db");
  const { listProjects } = await import("@/lib/orchestration/service");

  try {
    seedOrchestrationDevData();

    await test("seed creates all required production project slugs", () => {
      const db = getOrchestrationDb();
      const rows = db
        .prepare(
          `SELECT slug, status, archived_at, company_id
           FROM projects
           WHERE slug IN (${EXPECTED_SLUGS.map(() => "?").join(",")})`
        )
        .all(...EXPECTED_SLUGS) as Array<{
        slug: string;
        status: string;
        archived_at: string | null;
        company_id: string | null;
      }>;

      assert.strictEqual(rows.length, EXPECTED_SLUGS.length);
      const rowBySlug = new Map(rows.map((row) => [row.slug, row]));
      for (const slug of EXPECTED_SLUGS) {
        const row = rowBySlug.get(slug);
        assert.ok(row, `Missing project slug: ${slug}`);
        assert.strictEqual(row?.status, "active", `Expected active status for ${slug}`);
        assert.strictEqual(row?.archived_at, null, `Expected ${slug} to be unarchived`);
        assert.ok(row?.company_id, `Expected ${slug} to be company-scoped`);
      }
    });

    await test("listProjects returns seeded projects without includeNonProduction", () => {
      const visible = listProjects().projects.map((project) => project.slug);
      for (const slug of EXPECTED_SLUGS) {
        assert.ok(
          visible.includes(slug),
          `Expected listProjects() to include seeded slug: ${slug}`
        );
      }
    });

    await test("seed is idempotent for stable slugs", () => {
      seedOrchestrationDevData();
      const db = getOrchestrationDb();
      const rows = db
        .prepare(
          `SELECT slug, COUNT(*) AS total
           FROM projects
           WHERE slug IN (${EXPECTED_SLUGS.map(() => "?").join(",")})
           GROUP BY slug`
        )
        .all(...EXPECTED_SLUGS) as Array<{ slug: string; total: number }>;

      assert.strictEqual(rows.length, EXPECTED_SLUGS.length);
      for (const row of rows) {
        assert.strictEqual(row.total, 1, `Expected single row for slug ${row.slug}`);
      }
    });
  } finally {
    closeOrchestrationDb();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
