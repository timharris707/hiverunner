import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";

const LIVE_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "live_trading.db");

/**
 * Returns real-time Kalshi portfolio data from the Kalshi API (via dashboard proxy).
 * This is the source of truth — matches what Kalshi shows in their UI.
 */
export async function GET() {
  try {
    const dashboardUrl = "http://localhost:8050";

    const bankrollRes = await fetch(`${dashboardUrl}/api/bankroll`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!bankrollRes.ok) {
      throw new Error(`Dashboard bankroll API returned ${bankrollRes.status}`);
    }

    const bankroll = await bankrollRes.json();

    // Read initial deposit
    const bankrollPath = join(WEATHER_TRADING_DIR, "data", "bankroll.json");
    let initialDeposit = 1000;
    if (existsSync(bankrollPath)) {
      try {
        const bdata = JSON.parse(readFileSync(bankrollPath, "utf-8"));
        initialDeposit = bdata.initial_deposit || 1000;
      } catch { /* default */ }
    }

    // Version breakdown from local DB
    let versionBreakdown: unknown[] = [];
    let won = 0, lost = 0, realizedPnl = 0;
    if (existsSync(LIVE_TRADING_DB)) {
      try {
        const Database = require("better-sqlite3");
        const db = new Database(LIVE_TRADING_DB, { readonly: true });
        versionBreakdown = db.prepare(
          `SELECT strategy_version,
                  COUNT(*) as total,
                  SUM(CASE WHEN status IN ('pending','filled','resting') THEN 1 ELSE 0 END) as open,
                  SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
                  SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost,
                  SUM(CASE WHEN status IN ('settled_won','settled_lost') THEN pnl ELSE 0 END) as pnl,
                  SUM(cost) as total_cost
           FROM live_trades WHERE status != 'failed'
           GROUP BY strategy_version`
        ).all();
        const totals = db.prepare(
          `SELECT
            SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
            SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost,
            SUM(CASE WHEN status IN ('settled_won','settled_lost') THEN pnl ELSE 0 END) as realized_pnl
           FROM live_trades WHERE status != 'failed'`
        ).get() as Record<string, number>;
        won = totals?.won ?? 0;
        lost = totals?.lost ?? 0;
        realizedPnl = totals?.realized_pnl ?? 0;
        db.close();
      } catch { /* ignore */ }
    }

    // Kalshi source of truth numbers
    const cash = bankroll.kalshi_balance ?? 0;
    const positions = bankroll.kalshi_portfolio_value ?? bankroll.deployed ?? 0;
    const portfolio = bankroll.kalshi_total ?? (cash + positions);

    return NextResponse.json({
      cash,
      positions,
      positionsCount: bankroll.open_positions ?? 0,
      portfolio,
      initialDeposit,
      pnl: portfolio - initialDeposit,
      pnlPercent: ((portfolio - initialDeposit) / initialDeposit) * 100,
      won,
      lost,
      realizedPnl,
      costBasis: bankroll.deployed ?? 0,  // What we paid for open positions
      versionBreakdown,
      kalshiConfigured: bankroll.kalshi_configured ?? false,
      balanceError: bankroll.balance_error ?? null,
      checkedAt: bankroll.checked_at ?? new Date().toISOString(),
    });
  } catch (error) {
    console.error("[trading/kalshi-portfolio] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Kalshi portfolio", detail: String(error) },
      { status: 500 }
    );
  }
}
