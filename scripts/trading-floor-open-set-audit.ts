import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MC_BASE_URL = process.env.MC_BASE_URL || "http://127.0.0.1:3010";

type PositionRow = Record<string, unknown>;

const expectedTruthByTicker: Record<string, { quantity: number; cost: number }> = {
  KXLOWTCHI_26APR16_T56: { quantity: 2, cost: 1.72 },
  KXLOWTAUS_26APR16_T70: { quantity: 5, cost: 4.05 },
  KXHIGHTNOLA_26APR16_T83: { quantity: 64, cost: 8.32 },
  KXLOWTDEN_26APR16_T39: { quantity: 14, cost: 9.38 },
  KXLOWTMIA_26APR16_T71: { quantity: 13, cost: 9.36 },
  KXHIGHLAX_26APR15_T73: { quantity: 100, cost: 5.0 },
};

function normTickerKey(ticker: string): string {
  return ticker.toUpperCase().replace(/-/g, "_");
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function toFiniteChance(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

function getDisplayNowChance(row: PositionRow): { chance: number; source: string } | null {
  const side = String(row.side || "").toLowerCase();
  const liveChance = toFiniteChance(row.now_price);
  const truthSource = typeof row.kalshi_weather_truth_probability_source === "string"
    && row.kalshi_weather_truth_probability_source.length > 0;

  if (liveChance != null && (truthSource || (liveChance > 0 && liveChance < 1))) {
    return { chance: liveChance, source: "live" };
  }

  const yesProbability = toFiniteChance(row.market_probability);
  if (yesProbability != null) {
    return {
      chance: side === "yes" ? yesProbability : 1 - yesProbability,
      source: "market-probability",
    };
  }

  if (liveChance != null) {
    return { chance: liveChance, source: "live" };
  }

  const entryChance = toFiniteChance(row.price);
  if (entryChance != null) {
    return { chance: entryChance, source: "entry-price" };
  }

  return null;
}

async function main() {
  const [positionsRes, portfolioRes] = await Promise.all([
    fetch(`${MC_BASE_URL}/api/trading/kalshi-positions`),
    fetch(`${MC_BASE_URL}/api/trading/kalshi-portfolio`),
  ]);

  if (!positionsRes.ok) {
    throw new Error(`kalshi-positions API failed: ${positionsRes.status}`);
  }

  const positionsPayload = await positionsRes.json();
  const portfolioPayload = portfolioRes.ok ? await portfolioRes.json() : null;

  const positions = (Array.isArray(positionsPayload?.positions) ? positionsPayload.positions : [])
    .map((p: PositionRow) => ({
      ...p,
      ticker: String(p.ticker || "").toUpperCase(),
      side: String(p.side || "").toLowerCase(),
    }))
    .sort((a: PositionRow, b: PositionRow) => `${String(a.ticker)}|${String(a.side)}`.localeCompare(`${String(b.ticker)}|${String(b.side)}`));

  const rows = positions.map((p: PositionRow) => {
    const ticker = String(p.ticker || "").toUpperCase();
    const expected = expectedTruthByTicker[normTickerKey(ticker)] ?? null;

    const quantity = Number(p.quantity || 0);
    const cost = Number(p.cost || 0);
    const localQuantity = p.local_quantity == null ? null : Number(p.local_quantity);
    const localCost = p.local_cost == null ? null : Number(p.local_cost);

    const expectedQuantity = expected?.quantity ?? null;
    const expectedCost = expected?.cost ?? null;

    const quantityMatchesExpected = expectedQuantity == null ? null : quantity === expectedQuantity;
    const costMatchesExpected = expectedCost == null ? null : Math.abs(cost - expectedCost) < 0.0001;

    const displayNow = getDisplayNowChance(p);

    return {
      ticker,
      side: String(p.side || "").toLowerCase(),
      quantity,
      cost: round2(cost),
      fill_quantity: Number(p.fill_quantity || 0),
      local_quantity: localQuantity,
      local_cost: localCost == null ? null : round2(localCost),
      exchange_truth_source: p.exchange_truth_source ?? null,
      kalshi_weather_truth_probability_source: p.kalshi_weather_truth_probability_source ?? null,
      kalshi_implied_forecast_f: p.kalshi_implied_forecast_f == null ? null : round2(Number(p.kalshi_implied_forecast_f)),
      now_price: p.now_price == null ? null : Number(p.now_price),
      display_now_chance_pct: displayNow ? round2(displayNow.chance * 100) : null,
      display_now_source: displayNow?.source ?? null,
      expected_quantity: expectedQuantity,
      expected_cost: expectedCost,
      quantity_matches_expected: quantityMatchesExpected,
      cost_matches_expected: costMatchesExpected,
    };
  });

  const partialFillTickers = new Set([
    "KXLOWTCHI-26APR16-T56",
    "KXLOWTAUS-26APR16-T70",
    "KXHIGHTNOLA-26APR16-T83",
  ]);

  const partialFillAudit = rows
    .filter((row) => partialFillTickers.has(String(row.ticker)))
    .map((row) => ({
      ticker: row.ticker,
      local_vs_reconciled_quantity_delta:
        row.local_quantity == null ? null : Number(row.local_quantity) - Number(row.quantity),
      local_vs_reconciled_cost_delta:
        row.local_cost == null ? null : round2(Number(row.local_cost) - Number(row.cost)),
      quantity_matches_expected: row.quantity_matches_expected,
      cost_matches_expected: row.cost_matches_expected,
    }));

  const allExpectedMatched = rows.every(
    (row) => row.quantity_matches_expected === true && row.cost_matches_expected === true,
  );

  const weatherTruthAvailableCount = rows.filter(
    (row) => typeof row.kalshi_weather_truth_probability_source === "string" && row.kalshi_weather_truth_probability_source.length > 0,
  ).length;

  const out = {
    generated_at: new Date().toISOString(),
    mission_control_base_url: MC_BASE_URL,
    open_row_count: rows.length,
    expected_ticker_count: Object.keys(expectedTruthByTicker).length,
    all_expected_truth_matched: allExpectedMatched,
    weather_truth_available_count: weatherTruthAvailableCount,
    weather_truth_missing_count: rows.length - weatherTruthAvailableCount,
    kalshi_portfolio_degraded: portfolioPayload?.degraded ?? null,
    kalshi_portfolio_positions_count: portfolioPayload?.positionsCount ?? null,
    partial_fill_audit: partialFillAudit,
    rows,
  };

  const dir = join(process.cwd(), "artifacts", "trading-floor-parity");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `open-set-audit-${stamp}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(file);
  console.log(
    JSON.stringify(
      {
        openRows: rows.length,
        allExpectedMatched,
        weatherTruthAvailableCount,
        portfolioDegraded: out.kalshi_portfolio_degraded,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
