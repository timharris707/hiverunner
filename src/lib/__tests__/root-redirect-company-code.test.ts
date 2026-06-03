import assert from "node:assert/strict";

import { getRootRedirectCompanyCode } from "@/proxy";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  [FAIL] ${name}`);
    console.error(`    ${message}`);
  }
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

console.log("\nRoot Redirect Company Code Tests\n");

test("fresh default HiveRunner Workspace remains the fallback when it is the only company", () => {
  assert.equal(getRootRedirectCompanyCode(mapsForCodes(["HIVE"])), "HIVE");
});

test("root redirect prefers the last real company over empty HiveRunner Workspace", () => {
  assert.equal(getRootRedirectCompanyCode(mapsForCodes(["HIVE", "ACME"])), "ACME");
  assert.equal(getRootRedirectCompanyCode(mapsForCodes(["HIVE", "ACME", "WIND"])), "WIND");
});

test("explicit configured default company code still wins", () => {
  assert.equal(
    getRootRedirectCompanyCode(mapsForCodes(["HIVE", "ACME"]), {
      MC_DEFAULT_COMPANY_CODE: "hive",
    } as NodeJS.ProcessEnv),
    "HIVE",
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
