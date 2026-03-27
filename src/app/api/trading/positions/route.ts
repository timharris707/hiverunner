import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";

const PAPER_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "paper_trading.db");

export async function GET() {
  try {
    if (!existsSync(PAPER_TRADING_DB)) {
      return NextResponse.json({ positions: [], cityBreakdown: [] });
    }

    const Database = require("better-sqlite3");
    const db = new Database(PAPER_TRADING_DB, { readonly: true });

    const positions = db
      .prepare(
        `SELECT trade_id, ticker, side, quantity, price, cost, edge, composite_score,
                city, target_date, settlement_scheduled_at, forecast_mean, forecast_std, n_models, status, created_at,
                CASE
                  WHEN settlement_scheduled_at IS NOT NULL AND settlement_scheduled_at <= datetime('now') THEN 'awaiting_settlement'
                  ELSE 'open'
                END as lifecycle_status
         FROM trades
         WHERE status = 'open'
         ORDER BY target_date ASC, city ASC`
      )
      .all();

    const cityBreakdown = db
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

    const resolvedPositions = db
      .prepare(
        `SELECT trade_id, ticker, side, quantity, price, cost, edge, composite_score,
                city, target_date, threshold, forecast_mean, forecast_std, n_models, status, pnl, payout, actual_outcome, actual_temp, settlement_scheduled_at, resolved_at, created_at
         FROM trades
         WHERE status IN ('won', 'lost')
         ORDER BY resolved_at DESC
         LIMIT 30`
      )
      .all();

    db.close();

    return NextResponse.json({ positions, cityBreakdown, resolvedPositions });
  } catch (error) {
    console.error("[trading/positions] Error:", error);
    return NextResponse.json({ positions: [], cityBreakdown: [] }, { status: 500 });
  }
}
