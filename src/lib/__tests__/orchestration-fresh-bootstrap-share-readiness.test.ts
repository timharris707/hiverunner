/**
 * Fresh local bootstrap share-readiness contract.
 *
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/hiverunner-fresh-bootstrap.db \
 *   npx tsx src/lib/__tests__/orchestration-fresh-bootstrap-share-readiness.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { withEdgeRouteMapFallback } from "@/lib/orchestration/edge-route-maps";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";
import { buildEdgeRouteMaps } from "@/lib/orchestration/edge-route-map-service";
import { closeOrchestrationDb, getOrchestrationDb } from "@/lib/orchestration/db";
import { getRootRedirectCompanyCode } from "@/middleware";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [pass] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [fail] ${name}`);
      console.error(`    ${message}`);
    });
}

function mapsForCodes(codes: string[]): EdgeRouteMaps {
  const companyCodeToSlug = Object.fromEntries(
    codes.map((code) => [code, `${code.toLowerCase()}-workspace`]),
  );
  const companySlugToCode = Object.fromEntries(
    codes.map((code) => [`${code.toLowerCase()}-workspace`, code]),
  );

  return {
    companyCodeToSlug,
    companySlugToCode,
    actualCompanyCodes: codes,
    projectIdToSlugByCompany: {},
    projectSlugAliasToCanonical: {},
  };
}

async function run() {
  console.log("\nFresh Bootstrap Share-Readiness Contract Test\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (!dbPath) {
    throw new Error("ORCHESTRATION_DB_PATH is required for this test");
  }

  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });

  try {
    const db = getOrchestrationDb();

    await test("fresh DB creates one neutral HiveRunner workspace", () => {
      const companies = db
        .prepare("SELECT slug, company_code, name, description, owner_user_id FROM companies ORDER BY created_at ASC")
        .all() as Array<{
        slug: string;
        company_code: string;
        name: string;
        description: string;
        owner_user_id: string | null;
      }>;

      assert.equal(companies.length, 1);
      assert.deepEqual(companies[0], {
        slug: "hiverunner-workspace",
        company_code: "HIVE",
        name: "HiveRunner Workspace",
        description: "Workspace for agents, tasks, memory, and runs.",
        owner_user_id: "local-owner",
      });
    });

    await test("fresh DB creates a neutral local owner", () => {
      const users = db
        .prepare("SELECT id, display_name, email FROM users ORDER BY created_at ASC")
        .all() as Array<{ id: string; display_name: string; email: string }>;

      assert.deepEqual(users, [{
        id: "local-owner",
        display_name: "Local Owner",
        email: "owner@localhost.local",
      }]);
    });

    await test("fresh DB does not create legacy route aliases", () => {
      const aliases = db
        .prepare("SELECT slug_alias FROM company_slug_aliases ORDER BY slug_alias ASC")
        .all() as Array<{ slug_alias: string }>;

      assert.deepEqual(aliases, []);
    });

    await test("root redirect uses fresh DB company without private static fallback codes", () => {
      const maps = withEdgeRouteMapFallback(buildEdgeRouteMaps());
      assert.equal(maps.companyCodeToSlug.HIVE, "hiverunner-workspace");
      assert.equal(maps.companyCodeToSlug.INS, undefined);
      assert.equal(getRootRedirectCompanyCode(maps), "HIVE");
    });

    await test("root redirect prefers INS when live data has INS and NEV but no HIVE", () => {
      assert.equal(getRootRedirectCompanyCode(mapsForCodes(["NEV", "INS"])), "INS");
    });

    await test("root redirect lets explicit configured default company code win", () => {
      assert.equal(
        getRootRedirectCompanyCode(mapsForCodes(["HIVE", "INS", "WEA"]), {
          MC_DEFAULT_COMPANY_CODE: "wea",
        } as NodeJS.ProcessEnv),
        "WEA",
      );
    });

    await test("root redirect falls back to the only valid DB-backed company code", () => {
      assert.equal(getRootRedirectCompanyCode(mapsForCodes(["NEV"])), "NEV");
    });

    await test("root redirect ignores fallback aliases when actual DB-backed state exists", () => {
      const maps = mapsForCodes(["NEV"]);
      maps.companyCodeToSlug.HIVE = "hiverunner-workspace";
      assert.equal(getRootRedirectCompanyCode(maps), "NEV");
    });
  } finally {
    closeOrchestrationDb();
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
