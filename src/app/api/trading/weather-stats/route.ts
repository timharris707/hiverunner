import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";

const PAPER_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "paper_trading.db");
const LIVE_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "live_trading.db");
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

    // Read paper trading stats from SQLite
    let liveStats = null;
    if (hasDb) {
      try {
        const Database = require("better-sqlite3");
        const db = new Database(PAPER_TRADING_DB, { readonly: true });

        const tradeStats = db
          .prepare(
            `SELECT
              COUNT(*) as total_trades,
              SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_trades,
              SUM(CASE WHEN status='open' AND settlement_scheduled_at IS NOT NULL AND settlement_scheduled_at <= datetime('now') THEN 1 ELSE 0 END) as awaiting_settlement,
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
            `SELECT trade_id, ticker, side, quantity, price, cost, edge, status, pnl, payout, actual_outcome, actual_temp, city, target_date, threshold, forecast_mean, settlement_scheduled_at, resolved_at, created_at
             FROM trades ORDER BY created_at DESC LIMIT 40`
          )
          .all();

        const resolvedTrades = db
          .prepare(
            `SELECT trade_id, ticker, side, quantity, price, cost, edge, status, pnl, payout, actual_outcome, actual_temp, city, target_date, threshold, forecast_mean, settlement_scheduled_at, resolved_at, created_at
             FROM trades WHERE status IN ('won', 'lost') ORDER BY resolved_at DESC LIMIT 30`
          )
          .all();

        db.close();

        const resolved = (tradeStats.won || 0) + (tradeStats.lost || 0);
        liveStats = {
          totalTrades: tradeStats.total_trades || 0,
          openTrades: tradeStats.open_trades || 0,
          awaitingSettlement: tradeStats.awaiting_settlement || 0,
          won: tradeStats.won || 0,
          lost: tradeStats.lost || 0,
          winRate: resolved > 0 ? ((tradeStats.won || 0) / resolved) * 100 : 0,
          totalPnl: tradeStats.total_pnl || 0,
          openExposure: tradeStats.open_exposure || 0,
          bankroll: bankroll?.bankroll ?? null,
          recentTrades,
          resolvedTrades,
        };
      } catch {
        // SQLite read failed — continue with summary data only
      }
    }

    // Read live (Kalshi) trading stats
    let kalshiStats = null;
    if (existsSync(LIVE_TRADING_DB)) {
      try {
        const Database = require("better-sqlite3");
        const liveDb = new Database(LIVE_TRADING_DB, { readonly: true });

        const liveTradeStats = liveDb
          .prepare(
            `SELECT
              COUNT(*) as total_trades,
              SUM(CASE WHEN status IN ('pending','filled','resting') THEN 1 ELSE 0 END) as open_trades,
              SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
              SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost,
              SUM(pnl) as total_pnl,
              SUM(CASE WHEN status IN ('pending','filled','resting') THEN cost ELSE 0 END) as open_exposure
            FROM live_trades
            WHERE status != 'failed'`
          )
          .get() as Record<string, number>;

        const recentLiveTrades = liveDb
          .prepare(
            `SELECT trade_id, contract_id as ticker, side, quantity,
                    COALESCE(fill_price, price) as price, cost, edge,
                    CASE
                      WHEN status IN ('pending','filled','resting') THEN 'open'
                      WHEN status='settled_won' THEN 'won'
                      WHEN status='settled_lost' THEN 'lost'
                      ELSE status
                    END as status,
                    pnl, pnl as payout, actual_outcome, actual_temp,
                    city, target_date, threshold, forecast_mean,
                    NULL as settlement_scheduled_at, settled_at as resolved_at, created_at
             FROM live_trades
             WHERE status != 'failed'
             ORDER BY created_at DESC
             LIMIT 40`
          )
          .all();

        liveDb.close();

        const liveResolved = (liveTradeStats.won || 0) + (liveTradeStats.lost || 0);
        kalshiStats = {
          totalTrades: liveTradeStats.total_trades || 0,
          openTrades: liveTradeStats.open_trades || 0,
          awaitingSettlement: 0,
          won: liveTradeStats.won || 0,
          lost: liveTradeStats.lost || 0,
          winRate: liveResolved > 0 ? ((liveTradeStats.won || 0) / liveResolved) * 100 : 0,
          totalPnl: liveTradeStats.total_pnl || 0,
          openExposure: liveTradeStats.open_exposure || 0,
          bankroll: null, // account balance is in Kalshi API, not local DB
          recentTrades: recentLiveTrades,
          resolvedTrades: recentLiveTrades.filter(
            (t: Record<string, unknown>) => t.status === "won" || t.status === "lost"
          ),
        };
      } catch {
        // live DB read failed
      }
    }

    return NextResponse.json({
      available: true,
      summary: summary?.headline_metrics ?? null,
      backtestPeriod: summary?.backtest_period ?? null,
      backtestStatus: summary?.status ?? null,
      liveStats,
      kalshiStats,
      dailyPnl,
    });
  } catch (error) {
    console.error("[trading/weather-stats] Error:", error);
    return NextResponse.json({ available: false, error: String(error) }, { status: 500 });
  }
}
