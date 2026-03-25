import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";

const PAPER_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "paper_trading.db");
const DASHBOARD_SUMMARY = join(WEATHER_TRADING_DIR, "data", "dashboard", "summary.json");
const DAILY_PNL_JSON = join(WEATHER_TRADING_DIR, "data", "dashboard", "daily_pnl.json");

export async function GET() {
  try {
    const hasData = existsSync(WEATHER_TRADING_DIR);
    const hasDb = existsSync(PAPER_TRADING_DB);
    const hasSummary = existsSync(DASHBOARD_SUMMARY);

    if (!hasData) {
      return NextResponse.json({ available: false, reason: "weather-trading project not found" });
    }

    // Read dashboard summary (pre-computed by the weather-trading bot)
    let summary = null;
    if (hasSummary) {
      try {
        summary = JSON.parse(readFileSync(DASHBOARD_SUMMARY, "utf-8"));
      } catch {
        // ignore parse errors
      }
    }

    // Read daily P&L data
    let dailyPnl = null;
    if (existsSync(DAILY_PNL_JSON)) {
      try {
        dailyPnl = JSON.parse(readFileSync(DAILY_PNL_JSON, "utf-8"));
      } catch {
        // ignore
      }
    }

    // Read live stats from SQLite if available
    let liveStats = null;
    if (hasDb) {
      try {
        // Use better-sqlite3 which is already a project dependency
        const Database = require("better-sqlite3");
        const db = new Database(PAPER_TRADING_DB, { readonly: true });

        const tradeStats = db
          .prepare(
            `SELECT
              COUNT(*) as total_trades,
              SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_trades,
              SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as won,
              SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as lost,
              SUM(pnl) as total_pnl,
              SUM(CASE WHEN status='open' THEN cost ELSE 0 END) as open_exposure
            FROM trades`
          )
          .get() as Record<string, number>;

        const bankroll = db
          .prepare(`SELECT bankroll FROM bankroll_history ORDER BY id DESC LIMIT 1`)
          .get() as { bankroll: number } | undefined;

        const recentTrades = db
          .prepare(
            `SELECT trade_id, ticker, side, price, cost, status, pnl, city, target_date, created_at
             FROM trades ORDER BY created_at DESC LIMIT 5`
          )
          .all();

        db.close();

        const resolved = (tradeStats.won || 0) + (tradeStats.lost || 0);
        liveStats = {
          totalTrades: tradeStats.total_trades || 0,
          openTrades: tradeStats.open_trades || 0,
          won: tradeStats.won || 0,
          lost: tradeStats.lost || 0,
          winRate: resolved > 0 ? ((tradeStats.won || 0) / resolved) * 100 : 0,
          totalPnl: tradeStats.total_pnl || 0,
          openExposure: tradeStats.open_exposure || 0,
          bankroll: bankroll?.bankroll ?? null,
          recentTrades,
        };
      } catch {
        // SQLite read failed — continue with summary data only
      }
    }

    return NextResponse.json({
      available: true,
      summary: summary?.headline_metrics ?? null,
      backtestPeriod: summary?.backtest_period ?? null,
      backtestStatus: summary?.status ?? null,
      liveStats,
      dailyPnl,
    });
  } catch (error) {
    console.error("[trading/weather-stats] Error:", error);
    return NextResponse.json({ available: false, error: String(error) }, { status: 500 });
  }
}
