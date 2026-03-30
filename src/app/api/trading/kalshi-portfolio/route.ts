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

    // Version breakdown from local DB + current market values for unrealized P&L
    let versionBreakdown: unknown[] = [];
    let won = 0, lost = 0, realizedPnl = 0, totalFees = 0;
    if (existsSync(LIVE_TRADING_DB)) {
      try {
        const Database = require("better-sqlite3");
        const db = new Database(LIVE_TRADING_DB, { readonly: true });
        const rawVersions = db.prepare(
          `SELECT strategy_version,
                  COUNT(*) as total,
                  SUM(CASE WHEN status IN ('pending','filled','resting') THEN 1 ELSE 0 END) as open,
                  SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
                  SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost,
                  SUM(CASE WHEN status IN ('settled_won','settled_lost') THEN pnl ELSE 0 END) as realized_pnl,
                  SUM(CASE WHEN status IN ('pending','filled','resting') THEN cost ELSE 0 END) as open_cost,
                  SUM(cost) as total_cost
           FROM live_trades WHERE status != 'failed'
           GROUP BY strategy_version`
        ).all() as Record<string, unknown>[];

        // Fetch current market values for open positions to compute unrealized P&L
        let positionsData: Record<string, unknown>[] = [];
        try {
          const posRes = await fetch("http://localhost:3000/api/trading/kalshi-positions", {
            signal: AbortSignal.timeout(8000),
          });
          if (posRes.ok) {
            const pd = await posRes.json();
            positionsData = pd.positions || [];
          }
        } catch { /* skip */ }

        // Compute unrealized P&L per version from current market prices
        const unrealizedByVersion: Record<string, number> = {};
        for (const pos of positionsData) {
          const v = String(pos.strategy_version || "unknown");
          const cost = Number(pos.cost || 0);
          const nowPrice = pos.now_price != null ? Number(pos.now_price) : null;
          const qty = Number(pos.quantity || 0);
          if (!unrealizedByVersion[v]) unrealizedByVersion[v] = 0;
          if (nowPrice != null) {
            unrealizedByVersion[v] += (nowPrice * qty) - cost;
          }
        }

        versionBreakdown = rawVersions.map((v) => {
          const version = String(v.strategy_version || "unknown");
          const rPnl = Number(v.realized_pnl || 0);
          const uPnl = unrealizedByVersion[version] ?? 0;
          return {
            ...v,
            realized_pnl: rPnl,
            unrealized_pnl: Math.round(uPnl * 100) / 100,
            total_pnl: Math.round((rPnl + uPnl) * 100) / 100,
          };
        });

        const totals = db.prepare(
          `SELECT
            SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
            SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost,
            SUM(CASE WHEN status IN ('settled_won','settled_lost') THEN pnl ELSE 0 END) as realized_pnl,
            SUM(CASE WHEN status IN ('settled_won','settled_lost') AND settled_at > datetime('now', '-24 hours') THEN pnl ELSE 0 END) as pnl_24h
           FROM live_trades WHERE status != 'failed'`
        ).get() as Record<string, number>;
        won = totals?.won ?? 0;
        lost = totals?.lost ?? 0;
        realizedPnl = totals?.realized_pnl ?? 0;
        var pnl24h = totals?.pnl_24h ?? 0;
        db.close();
      } catch { /* ignore */ }
    }

    // Get total fees from Kalshi positions API
    try {
      const kalshiPosRes = await fetch(`${dashboardUrl}/api/kalshi/portfolio`, {
        signal: AbortSignal.timeout(5000),
      });
      if (kalshiPosRes.ok) {
        const kpData = await kalshiPosRes.json();
        const positions = kpData.market_positions || kpData.positions || [];
        for (const p of positions) {
          totalFees += parseFloat(p.fees_paid_dollars || "0");
        }
      }
    } catch { /* skip */ }

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
      realizedPnl,
      pnl24h: typeof pnl24h !== "undefined" ? pnl24h : 0,
      unrealizedPnl: (portfolio - initialDeposit) - realizedPnl,
      won,
      lost,
      totalFees: Math.round(totalFees * 100) / 100,
      costBasis: bankroll.deployed ?? 0,
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
