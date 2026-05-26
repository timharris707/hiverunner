/**
 * Focused regression coverage for companies.owner_user_id filtering.
 * Run: ORCHESTRATION_DB_PATH=/tmp/orchestration-company-owner-filtering.db npx tsx src/lib/__tests__/orchestration-company-owner-filtering.test.ts
 */

import assert from "node:assert/strict";
import { rmSync } from "node:fs";

import { createCompany, listCompanies } from "@/lib/orchestration/company-service";

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

async function run() {
  console.log("\nOrchestration Company Owner Filtering Test\n");

  const dbPath = process.env.ORCHESTRATION_DB_PATH;
  if (dbPath) {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
  }

  const timestamp = Date.now();

  const ownedByA = createCompany({
    name: `Owner Filter A ${timestamp}`,
    slug: `owner-filter-a-${timestamp}`,
    description: "Owner filtering fixture A",
    status: "active",
    owner: {
      displayName: "Owner A",
      email: "owner-a@example.test",
    },
  }).company;

  const ownedByB = createCompany({
    name: `Owner Filter B ${timestamp}`,
    slug: `owner-filter-b-${timestamp}`,
    description: "Owner filtering fixture B",
    status: "active",
    owner: {
      displayName: "Owner B",
      email: "owner-b@example.test",
    },
  }).company;

  const ownerA = ownedByA.owner?.id;
  const ownerB = ownedByB.owner?.id;
  assert.ok(ownerA, "Expected owner A fixture to expose an owner id");
  assert.ok(ownerB, "Expected owner B fixture to expose an owner id");
  assert.notEqual(ownerA, ownerB, "Expected fixtures to belong to distinct owners");

  await test("unscoped company list can still return both owned fixtures", () => {
    const companies = listCompanies({ includeNonProduction: true }).companies;
    const slugs = new Set(companies.map((company) => company.slug));

    assert.equal(slugs.has(ownedByA.slug), true);
    assert.equal(slugs.has(ownedByB.slug), true);
  });

  await test("ownerUserId limits company list to companies owned by that user", () => {
    const companies = listCompanies({
      includeNonProduction: true,
      ownerUserId: ownerA,
    } as Parameters<typeof listCompanies>[0] & { ownerUserId: string }).companies;
    const slugs = new Set(companies.map((company) => company.slug));

    assert.equal(slugs.has(ownedByA.slug), true, "Expected owner A to see their company");
    assert.equal(slugs.has(ownedByB.slug), false, "Expected owner A not to see owner B company");
  });

  await test("non-owner context returns no companies for another owner's fixture", () => {
    const companies = listCompanies({
      includeNonProduction: true,
      ownerUserId: "not-the-owner",
    } as Parameters<typeof listCompanies>[0] & { ownerUserId: string }).companies;
    const slugs = new Set(companies.map((company) => company.slug));

    assert.equal(slugs.has(ownedByA.slug), false);
    assert.equal(slugs.has(ownedByB.slug), false);
  });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
