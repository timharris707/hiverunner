import assert from "node:assert";

import { assessProtectedRuntimeRisksForText } from "@/lib/orchestration/service/runtime-governance";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAIL ${name}`);
    console.error(`    ${message}`);
  }
}

console.log("\nRuntime Governance Risk Assessment Tests\n");

test("read-only live trading research does not require protected runtime approval", () => {
  const risks = assessProtectedRuntimeRisksForText(`
    WEA-290
    Quant performance autopsy for Weather Edge relaunch
    Review Trading Floor data and live trading history for realized performance.
    Acceptance criteria: deduped P&L/deployed/win rate since Apr 15, calibration by stated probability bucket,
    Brier score, per-city P&L, HCB/manual-strategy readout, and a clear recommendation on which
    probability/price bands are safe, unsafe, or unproven for automation.
    research
    high
    Weather Edge
  `);

  assert.deepStrictEqual(risks, []);
});

test("production or live environment changes still require approval", () => {
  const risks = assessProtectedRuntimeRisksForText(`
    Deploy the fixed pricing worker to live production and restart the runtime.
  `);

  assert.ok(risks.some((risk) => risk.code === "production_target"));
});

test("database migration commands still require approval", () => {
  const risks = assessProtectedRuntimeRisksForText("Run prisma migrate deploy for Weather Edge.");

  assert.ok(risks.some((risk) => risk.code === "database_change"));
});

test("read-only production review does not require protected runtime approval", () => {
  const risks = assessProtectedRuntimeRisksForText(`
    Review production trading logs and summarize performance by city. Do not change data or deploy anything.
  `);

  assert.deepStrictEqual(risks, []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
