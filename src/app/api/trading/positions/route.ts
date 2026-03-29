import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";

const PAPER_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "paper_trading.db");
const LIVE_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "live_trading.db");

export async function GET() {
  try {
    if (!existsSync(PAPER_TRADING_DB) && !existsSync(LIVE_TRADING_DB)) {
      return NextResponse.json({ positions: [], cityBreakdown: [] });
    }

    const Database = require("better-sqlite3");

    // --- Paper trading ---
    let paperPositions: object[] = [];
    let paperCityBreakdown: object[] = [];
    let paperResolvedPositions: object[] = [];

    if (existsSync(PAPER_TRADING_DB)) {
      const paperDb = new Database(PAPER_TRADING_DB, { readonly: true });

      paperPositions = paperDb
        .prepare(
          `SELECT trade_id, ticker, side, quantity, price, cost, edge, composite_score,
                  city, target_date, settlement_scheduled_at, forecast_mean, forecast_std, n_models,
                  status, created_at, 'paper' as trade_type,
                  CASE
                    WHEN settlement_scheduled_at IS NOT NULL AND settlement_scheduled_at <= datetime('now') THEN 'awaiting_settlement'
                    ELSE 'open'
                  END as lifecycle_status
           FROM trades
           WHERE status = 'open'
           ORDER BY target_date ASC, city ASC`
        )
        .all();

      paperCityBreakdown = paperDb
        .prepare(
          `SELECT city,
                  COUNT(*) as trade_count,
                  SUM(cost) as total_deployed,
                  SUM(CASE WHEN status='won' THEN pnl WHEN status='lost' THEN pnl ELSE 0 END) as realized_pnl,
                  SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_count,
                  SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as won,
                  SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as lost
           FROM trades
           GROUP BY city
           ORDER BY total_deployed DESC`
        )
        .all();

      paperResolvedPositions = paperDb
        .prepare(
          `SELECT trade_id, ticker, side, quantity, price, cost, edge, composite_score,
                  city, target_date, threshold, forecast_mean, forecast_std, n_models,
                  status, pnl, payout, actual_outcome, actual_temp,
                  settlement_scheduled_at, resolved_at, created_at, 'paper' as trade_type
           FROM trades
           WHERE status IN ('won', 'lost')
           ORDER BY resolved_at DESC
           LIMIT 30`
        )
        .all();

      paperDb.close();
    }

    // --- Live (Kalshi) trading ---
    let livePositions: object[] = [];
    let liveCityBreakdown: object[] = [];
    let liveResolvedPositions: object[] = [];

    if (existsSync(LIVE_TRADING_DB)) {
      const liveDb = new Database(LIVE_TRADING_DB, { readonly: true });

      livePositions = liveDb
        .prepare(
          `SELECT trade_id, contract_id as ticker, side, quantity,
                  COALESCE(fill_price, price) as price, cost, edge, composite_score,
                  city, target_date, NULL as settlement_scheduled_at,
                  forecast_mean, NULL as forecast_std, NULL as n_models,
                  'open' as status, created_at, 'live' as trade_type, 'open' as lifecycle_status
           FROM live_trades
           WHERE status IN ('pending', 'filled', 'resting')
           ORDER BY target_date ASC, city ASC`
        )
        .all();

      liveCityBreakdown = liveDb
        .prepare(
          `SELECT city,
                  COUNT(*) as trade_count,
                  SUM(cost) as total_deployed,
                  SUM(CASE WHEN status='settled_won' THEN pnl WHEN status='settled_lost' THEN pnl ELSE 0 END) as realized_pnl,
                  SUM(CASE WHEN status IN ('pending','filled','resting') THEN 1 ELSE 0 END) as open_count,
                  SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
                  SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost
           FROM live_trades
           WHERE status != 'failed'
           GROUP BY city
           ORDER BY total_deployed DESC`
        )
        .all();

      liveResolvedPositions = liveDb
        .prepare(
          `SELECT trade_id, contract_id as ticker, side, quantity,
                  COALESCE(fill_price, price) as price, cost, edge, composite_score,
                  city, target_date, threshold, forecast_mean,
                  NULL as forecast_std, NULL as n_models,
                  CASE WHEN status='settled_won' THEN 'won' ELSE 'lost' END as status,
                  pnl, pnl as payout, actual_outcome, actual_temp,
                  NULL as settlement_scheduled_at, settled_at as resolved_at, created_at,
                  'live' as trade_type
           FROM live_trades
           WHERE status IN ('settled_won', 'settled_lost')
           ORDER BY settled_at DESC
           LIMIT 30`
        )
        .all();

      liveDb.close();
    }

    // Live positions first so they appear at the top
    const positions = [...livePositions, ...paperPositions];
    const resolvedPositions = [...liveResolvedPositions, ...paperResolvedPositions];

    // Merged city breakdown (all combined)
    type CityRow = {
      city: string;
      trade_count: number;
      total_deployed: number;
      realized_pnl: number;
      open_count: number;
      won: number;
      lost: number;
    };

    const cityMap = new Map<string, CityRow>();
    for (const row of [...liveCityBreakdown, ...paperCityBreakdown] as CityRow[]) {
      if (!cityMap.has(row.city)) {
        cityMap.set(row.city, { ...row });
      } else {
        const e = cityMap.get(row.city)!;
        e.trade_count += row.trade_count;
        e.total_deployed += row.total_deployed;
        e.realized_pnl += row.realized_pnl;
        e.open_count += row.open_count;
        e.won += row.won;
        e.lost += row.lost;
      }
    }
    const cityBreakdown = Array.from(cityMap.values()).sort(
      (a, b) => b.total_deployed - a.total_deployed
    );

    return NextResponse.json({
      positions,
      cityBreakdown,
      resolvedPositions,
      liveCityBreakdown,
      paperCityBreakdown,
    });
  } catch (error) {
    console.error("[trading/positions] Error:", error);
    return NextResponse.json({ positions: [], cityBreakdown: [] }, { status: 500 });
  }
}
