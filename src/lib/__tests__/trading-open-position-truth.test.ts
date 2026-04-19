import assert from "node:assert/strict";
import { reconcileOpenTradesWithExchangeTruth } from "@/lib/trading-open-position-truth";

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

console.log("\nTrading Floor open-position exchange-truth regression tests\n");

const localOpenTrades = [
  { ticker: "KXLOWTCHI-26APR16-T56", side: "no", quantity: 11, fill_quantity: 2, cost: 9.46, price: 0.86, status: "partial", trade_id: "chi-1", created_at: "2026-04-15T20:20:55.881263+00:00" },
  { ticker: "KXLOWTAUS-26APR16-T70", side: "no", quantity: 12, fill_quantity: 5, cost: 9.72, price: 0.81, status: "partial", trade_id: "aus-1", created_at: "2026-04-15T20:20:54.165538+00:00" },
  { ticker: "KXHIGHTNOLA-26APR16-T83", side: "yes", quantity: 76, fill_quantity: 29, cost: 9.88, price: 0.13, status: "partial", trade_id: "nola-1", created_at: "2026-04-15T20:20:53.552463+00:00" },
  { ticker: "KXLOWTDEN-26APR16-T39", side: "no", quantity: 14, fill_quantity: 14, cost: 9.38, price: 0.67, status: "filled", trade_id: "den-1", created_at: "2026-04-15T20:20:55.331543+00:00" },
  { ticker: "KXLOWTMIA-26APR16-T71", side: "no", quantity: 13, fill_quantity: 13, cost: 9.36, price: 0.72, status: "filled", trade_id: "mia-1", created_at: "2026-04-15T20:20:54.709002+00:00" },
  { ticker: "KXHIGHLAX-26APR15-T73", side: "yes", quantity: 100, fill_quantity: 100, cost: 5.0, price: 0.05, status: "filled", trade_id: "lax-1", created_at: "2026-04-15T00:57:05.344168Z" },
] as Record<string, unknown>[];

const exchangeOpenPositions = [
  { ticker: "KXHIGHTNOLA-26APR16-T83", side: "YES", quantity: 64, cost: 8.32, avg_price: 0.13 },
  { ticker: "KXLOWTAUS-26APR16-T70", side: "NO", quantity: 5, cost: 4.05, avg_price: 0.81 },
  { ticker: "KXLOWTMIA-26APR16-T71", side: "NO", quantity: 13, cost: 9.36, avg_price: 0.72 },
  { ticker: "KXLOWTCHI-26APR16-T56", side: "NO", quantity: 2, cost: 1.72, avg_price: 0.86 },
  { ticker: "KXLOWTDEN-26APR16-T39", side: "NO", quantity: 14, cost: 9.38, avg_price: 0.67 },
  { ticker: "KXHIGHLAX-26APR15-T73", side: "YES", quantity: 100, cost: 5.0, avg_price: 0.05 },
] as Record<string, unknown>[];

test("exchange truth overrides stale local partial quantities/costs", () => {
  const reconciled = reconcileOpenTradesWithExchangeTruth(
    localOpenTrades,
    exchangeOpenPositions,
    "2026-04-15T21:24:00.000Z",
  );

  const byTicker = new Map(reconciled.map((row) => [String(row.ticker), row]));

  assert.equal(Number(byTicker.get("KXLOWTCHI-26APR16-T56")?.quantity), 2);
  assert.equal(Number(byTicker.get("KXLOWTCHI-26APR16-T56")?.cost), 1.72);

  assert.equal(Number(byTicker.get("KXLOWTAUS-26APR16-T70")?.quantity), 5);
  assert.equal(Number(byTicker.get("KXLOWTAUS-26APR16-T70")?.cost), 4.05);

  assert.equal(Number(byTicker.get("KXHIGHTNOLA-26APR16-T83")?.quantity), 64);
  assert.equal(Number(byTicker.get("KXHIGHTNOLA-26APR16-T83")?.cost), 8.32);

  assert.equal(Number(byTicker.get("KXLOWTDEN-26APR16-T39")?.quantity), 14);
  assert.equal(Number(byTicker.get("KXLOWTMIA-26APR16-T71")?.quantity), 13);
  assert.equal(Number(byTicker.get("KXHIGHLAX-26APR15-T73")?.quantity), 100);
});

test("local row values are preserved only as audit metadata", () => {
  const reconciled = reconcileOpenTradesWithExchangeTruth(
    localOpenTrades,
    exchangeOpenPositions,
    "2026-04-15T21:24:00.000Z",
  );

  const nola = reconciled.find((row) => String(row.ticker) === "KXHIGHTNOLA-26APR16-T83");
  assert.equal(String(nola?.exchange_truth_source), "kalshi");
  assert.equal(Number(nola?.quantity), 64);
  assert.equal(Number(nola?.local_quantity), 76);
  assert.equal(Number(nola?.cost), 8.32);
  assert.equal(Number(nola?.local_cost), 9.88);
});

test("local fallback rows remain when no exchange position exists", () => {
  const localOnly = [{ ticker: "KXLOWTNYC-26APR20-T44", side: "no", quantity: 7, fill_quantity: 0, cost: 3.5, status: "resting" }] as Record<string, unknown>[];

  const reconciled = reconcileOpenTradesWithExchangeTruth(
    localOnly,
    [],
    "2026-04-15T21:24:00.000Z",
  );

  assert.equal(reconciled.length, 1);
  assert.equal(Number(reconciled[0].quantity), 7);
  assert.equal(reconciled[0].exchange_quantity, null);
  assert.equal(String(reconciled[0].exchange_truth_source), "local-fallback");
});

test("local partial rows derive filled quantity and proportional cost when exchange is unavailable", () => {
  const localOnly = [{ ticker: "KXLOWTCHI-26APR16-T56", side: "no", quantity: 11, fill_quantity: 2, cost: 9.46, status: "partial" }] as Record<string, unknown>[];

  const reconciled = reconcileOpenTradesWithExchangeTruth(
    localOnly,
    [],
    "2026-04-15T21:24:00.000Z",
  );

  assert.equal(reconciled.length, 1);
  assert.equal(Number(reconciled[0].quantity), 2);
  assert.equal(Number(Number(reconciled[0].cost).toFixed(2)), 1.72);
  assert.equal(String(reconciled[0].exchange_truth_source), "local-fill-derived");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
