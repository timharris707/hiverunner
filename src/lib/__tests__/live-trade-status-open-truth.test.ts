import assert from "node:assert/strict";
import {
  FILLED_LIVE_TRADE_WHERE,
  REAL_OPEN_LIVE_TRADE_WHERE,
  normalizeLiveTradeLifecycleStatus,
} from "@/lib/live-trade-status";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\nLive trade status open-truth regression tests\n");

test("real open trade where includes partial rows", () => {
  assert.match(REAL_OPEN_LIVE_TRADE_WHERE, /'partial'/);
});

test("filled/open bucket includes partial rows", () => {
  assert.match(FILLED_LIVE_TRADE_WHERE, /'partial'/);
});

test("resting partially filled rows normalize to partial", () => {
  assert.equal(normalizeLiveTradeLifecycleStatus("resting", 2, 10), "partial");
});

test("already-partial rows stay partial", () => {
  assert.equal(normalizeLiveTradeLifecycleStatus("partial", 2, 10), "partial");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
