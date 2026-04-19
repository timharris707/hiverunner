import assert from "node:assert/strict";
import {
  evaluatePositionOutcomeFromActual,
  getLockedPositionOutcomeFromActual,
  getMarketPropositionLabel,
} from "@/lib/trading-floor-market-semantics";

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

console.log("\nTrading Floor market semantics regression tests\n");

test("humanizes strict-inequality threshold proposition text from Kalshi metadata", () => {
  const cases = [
    {
      ticker: "KXLOWTMIA-26APR16-T71",
      marketFloorStrike: 71,
      marketTitle: "Will the minimum temperature be >71° on Apr 16, 2026?",
      expected: "72° or above",
    },
    {
      ticker: "KXLOWTCHI-26APR16-T56",
      marketFloorStrike: 56,
      marketTitle: "Will the minimum temperature be >56° on Apr 16, 2026?",
      expected: "57° or above",
    },
    {
      ticker: "KXLOWTDEN-26APR16-T39",
      marketCapStrike: 39,
      marketTitle: "Will the minimum temperature be <39° on Apr 16, 2026?",
      expected: "38° or below",
    },
    {
      ticker: "KXLOWTAUS-26APR16-T70",
      marketFloorStrike: 70,
      marketTitle: "Will the minimum temperature be >70° on Apr 16, 2026?",
      expected: "71° or above",
    },
    {
      ticker: "KXHIGHTNOLA-26APR16-T83",
      marketCapStrike: 83,
      marketTitle: "Will the maximum temperature be <83° on Apr 16, 2026?",
      expected: "82° or below",
    },
    {
      ticker: "KXHIGHLAX-26APR15-T73",
      marketFloorStrike: 73,
      marketTitle: "Will the maximum temperature be >73° on Apr 15, 2026?",
      expected: "74° or above",
    },
  ] as const;

  for (const row of cases) {
    assert.equal(getMarketPropositionLabel(row), row.expected, row.ticker);
  }
});

test("keeps proposition semantics independent from YES/NO side", () => {
  const common = {
    ticker: "KXLOWTMIA-26APR16-T71",
    marketFloorStrike: 71,
    marketTitle: "Will the minimum temperature be >71° on Apr 16, 2026?",
    actual: { high: 84, low: 72, complete: false },
  };

  const yesOutcome = evaluatePositionOutcomeFromActual({ ...common, side: "yes" });
  const noOutcome = evaluatePositionOutcomeFromActual({ ...common, side: "no" });

  assert.equal(getMarketPropositionLabel(common), "72° or above");
  assert.equal(yesOutcome, true);
  assert.equal(noOutcome, false);
});

test("does not lock same-day unresolved HIGH contracts before irreversibility (LAX regression)", () => {
  const nowMs = Date.parse("2026-04-15T13:40:00-07:00");
  const settlementAt = "2026-04-16T00:30:00-07:00";

  const notLockedYet = getLockedPositionOutcomeFromActual({
    ticker: "KXHIGHLAX-26APR15-T73",
    side: "yes",
    marketFloorStrike: 73,
    marketTitle: "Will the maximum temperature be >73° on Apr 15, 2026?",
    actual: { high: 71, low: 56, complete: false },
    marketStatus: "active",
    settlementAt,
    nowMs,
  });

  assert.equal(notLockedYet, null);

  const lockedAfterCross = getLockedPositionOutcomeFromActual({
    ticker: "KXHIGHLAX-26APR15-T73",
    side: "yes",
    marketFloorStrike: 73,
    marketTitle: "Will the maximum temperature be >73° on Apr 15, 2026?",
    actual: { high: 74, low: 56, complete: false },
    marketStatus: "active",
    settlementAt,
    nowMs,
  });

  assert.equal(lockedAfterCross, true);
});

test("treats post-close contracts as locked from final proposition semantics", () => {
  const nowMs = Date.parse("2026-04-16T02:00:00-07:00");

  const outcome = getLockedPositionOutcomeFromActual({
    ticker: "KXHIGHLAX-26APR15-T73",
    side: "yes",
    marketFloorStrike: 73,
    marketTitle: "Will the maximum temperature be >73° on Apr 15, 2026?",
    actual: { high: 71, low: 56, complete: false },
    settlementAt: "2026-04-16T00:30:00-07:00",
    marketStatus: "closed",
    nowMs,
  });

  assert.equal(outcome, false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
