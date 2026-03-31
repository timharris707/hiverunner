import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  FILLED_LIVE_TRADE_COST_EXPR,
  FILLED_LIVE_TRADE_COUNT_EXPR,
  REAL_OPEN_LIVE_TRADE_COST_EXPR,
  REAL_OPEN_LIVE_TRADE_COUNT_EXPR,
  TRUE_RESTING_LIVE_TRADE_COST_EXPR,
  TRUE_RESTING_LIVE_TRADE_COUNT_EXPR,
  type AccountTruth,
  type LocalExposureTruth,
  type RealizedPerformanceTruth,
} from "@/lib/live-trade-status";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";

const LIVE_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "live_trading.db");

let lastSuccessfulResponse: Record<string, unknown> | null = null;

/**
 * Returns Kalshi portfolio data, preferring the weather dashboard bankroll endpoint,
 * but falling back to locally computable values so the Trading Floor KPIs do not blank
 * when the upstream proxy flakes.
 */
export async function GET() {
  try {
    const dashboardUrl = "http://localhost:8050";

    const bankrollPath = join(WEATHER_TRADING_DIR, "data", "bankroll.json");
    let initialDeposit = 1000;
    if (existsSync(bankrollPath)) {
      try {
        const bdata = JSON.parse(readFileSync(bankrollPath, "utf-8"));
        initialDeposit = bdata.initial_deposit || 1000;
      } catch {
        /* default */
      }
    }

    let versionBreakdown: unknown[] = [];
    let won = 0;
    let lost = 0;
    let realizedPnl = 0;
    let totalFees = 0;
    let pnl24h = 0;
    let portfolio24hAgo: number | null = null;
    let openCost = 0;
    let localOpenMarketValue = 0;
    let openPositionsCount = 0;
    let trueRestingCount = 0;
    let trueRestingCost = 0;
    let filledOpenCount = 0;
    let filledOpenCost = 0;

    let positionsData: Record<string, unknown>[] = [];
    try {
      const posRes = await fetch("http://localhost:3000/api/trading/kalshi-positions", {
        signal: AbortSignal.timeout(8000),
      });
      if (posRes.ok) {
        const pd = await posRes.json();
        positionsData = pd.positions || [];
      }
    } catch {
      /* skip */
    }

    openPositionsCount = positionsData.length;
    openCost = positionsData.reduce((sum, pos) => sum + Number(pos.cost || 0), 0);
    localOpenMarketValue = positionsData.reduce((sum, pos) => {
      const qty = Number(pos.quantity || 0);
      const cost = Number(pos.cost || 0);
      const nowPrice = pos.now_price != null ? Number(pos.now_price) : null;
      return sum + (nowPrice != null ? nowPrice * qty : cost);
    }, 0);

    if (existsSync(LIVE_TRADING_DB)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Database = require("better-sqlite3");
        const db = new Database(LIVE_TRADING_DB, { readonly: true });
        const rawVersions = db.prepare(
          `SELECT strategy_version,
                  COUNT(*) as total,
                  SUM(${REAL_OPEN_LIVE_TRADE_COUNT_EXPR}) as open,
                  SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
                  SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost,
                  SUM(CASE WHEN status IN ('settled_won','settled_lost') THEN pnl ELSE 0 END) as realized_pnl,
                  SUM(${REAL_OPEN_LIVE_TRADE_COST_EXPR}) as open_cost,
                  SUM(cost) as total_cost,
                  SUM(CASE WHEN target_date < date('now') AND status NOT IN ('settled_won','settled_lost','failed','cancelled') THEN 1 ELSE 0 END) as stale_count
           FROM live_trades WHERE status != 'failed'
           GROUP BY strategy_version`
        ).all() as Record<string, unknown>[];

        const unrealizedByVersion: Record<string, number> = {};
        for (const pos of positionsData) {
          const version = String(pos.strategy_version || "unknown");
          const cost = Number(pos.cost || 0);
          const nowPrice = pos.now_price != null ? Number(pos.now_price) : null;
          const qty = Number(pos.quantity || 0);
          if (!unrealizedByVersion[version]) unrealizedByVersion[version] = 0;
          unrealizedByVersion[version] += nowPrice != null ? (nowPrice * qty) - cost : 0;
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
            SUM(CASE WHEN status IN ('settled_won','settled_lost') AND settled_at > datetime('now', '-24 hours') THEN pnl ELSE 0 END) as pnl_24h,
            SUM(${TRUE_RESTING_LIVE_TRADE_COUNT_EXPR}) as true_resting_count,
            SUM(${TRUE_RESTING_LIVE_TRADE_COST_EXPR}) as true_resting_cost,
            SUM(${FILLED_LIVE_TRADE_COUNT_EXPR}) as filled_open_count,
            SUM(${FILLED_LIVE_TRADE_COST_EXPR}) as filled_open_cost
           FROM live_trades WHERE status != 'failed'`
        ).get() as Record<string, number>;
        won = totals?.won ?? 0;
        lost = totals?.lost ?? 0;
        realizedPnl = totals?.realized_pnl ?? 0;
        pnl24h = totals?.pnl_24h ?? 0;
        trueRestingCount = totals?.true_resting_count ?? 0;
        trueRestingCost = totals?.true_resting_cost ?? 0;
        filledOpenCount = totals?.filled_open_count ?? 0;
        filledOpenCost = totals?.filled_open_cost ?? 0;

        try {
          const snap = db.prepare(
            `SELECT portfolio_total FROM portfolio_snapshots
             WHERE timestamp < datetime('now', '-23 hours')
             ORDER BY timestamp DESC LIMIT 1`
          ).get() as { portfolio_total: number } | undefined;
          if (snap) portfolio24hAgo = snap.portfolio_total;
        } catch {
          /* snapshots table may not exist yet */
        }
        db.close();
      } catch (dbErr) {
        console.error("[kalshi-portfolio] DB block error:", dbErr);
      }
    }

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
    } catch {
      /* skip */
    }

    let bankroll: Record<string, unknown> | null = null;
    let degraded = false;
    let balanceError: string | null = null;
    try {
      const bankrollRes = await fetch(`${dashboardUrl}/api/bankroll`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!bankrollRes.ok) {
        degraded = true;
        balanceError = `Dashboard bankroll API returned ${bankrollRes.status}`;
      } else {
        bankroll = await bankrollRes.json();
      }
    } catch (error) {
      degraded = true;
      balanceError = String(error);
    }

    const cash = bankroll?.kalshi_balance != null
      ? Number(bankroll.kalshi_balance)
      : (lastSuccessfulResponse?.cash != null ? Number(lastSuccessfulResponse.cash) : null);
    const positions = bankroll?.kalshi_portfolio_value != null
      ? Number(bankroll.kalshi_portfolio_value)
      : localOpenMarketValue;
    const portfolio = bankroll?.kalshi_total != null
      ? Number(bankroll.kalshi_total)
      : (cash != null ? cash + positions : null);
    const positionsCount = bankroll?.open_positions != null
      ? Number(bankroll.open_positions)
      : openPositionsCount;
    const costBasis = bankroll?.deployed != null
      ? Number(bankroll.deployed)
      : openCost;

    // --- Truth Layer 1: Account (authoritative Kalshi values only) ---
    // In degraded mode, return null — never substitute fake zero cash.
    const authCash = bankroll?.kalshi_balance != null ? Number(bankroll.kalshi_balance) : null;
    const authPortfolioValue = bankroll?.kalshi_portfolio_value != null ? Number(bankroll.kalshi_portfolio_value) : null;
    const authTotalValue = bankroll?.kalshi_total != null
      ? Number(bankroll.kalshi_total)
      : (authCash != null && authPortfolioValue != null ? authCash + authPortfolioValue : null);
    const authPnl = authTotalValue != null ? Math.round((authTotalValue - initialDeposit) * 100) / 100 : null;

    const account: AccountTruth = {
      cash: authCash,
      portfolioValue: authPortfolioValue,
      totalValue: authTotalValue,
      pnl: authPnl,
      source: "kalshi",
    };

    // --- Truth Layer 2: Local Exposure Audit (local DB row-model) ---
    // These are audit/reconciliation figures, not exchange account value.
    const localOpenRowCount = filledOpenCount + trueRestingCount;
    const localOpenCostBasis = Math.round((filledOpenCost + trueRestingCost) * 100) / 100;

    const localExposure: LocalExposureTruth = {
      openRowCount: localOpenRowCount,
      openCostBasis: localOpenCostBasis,
      filledAwaitingSettlementCount: filledOpenCount,
      filledAwaitingSettlementCostBasis: Math.round(filledOpenCost * 100) / 100,
      trueRestingOrderCount: trueRestingCount,
      trueRestingOrderCostBasis: Math.round(trueRestingCost * 100) / 100,
      source: "local-audit",
    };

    // --- Truth Layer 3: Realized Performance (settled trades only) ---
    // This is NOT current account value — it is settled-only performance.
    const realizedBankroll = initialDeposit + realizedPnl;

    const realized: RealizedPerformanceTruth = {
      pnl: Math.round(realizedPnl * 100) / 100,
      bankroll: Math.round(realizedBankroll * 100) / 100,
      won,
      lost,
      pnl24h: Math.round(pnl24h * 100) / 100,
      source: "settled",
    };

    const response = {
      // --- Truth Layer Groups (preferred API surface) ---
      account,
      localExposure,
      realized,

      // --- Legacy flat fields (deprecated, kept for transition compatibility) ---
      // @deprecated Use account.cash instead
      cash,
      // @deprecated Use account.portfolioValue instead; `positions` is ambiguous between exchange and local row model
      positions,
      positionsCount,
      // @deprecated Use account.totalValue instead
      portfolio,
      openBreakdown: {
        totalCount: openPositionsCount,
        totalCost: openCost,
        trueRestingCount,
        trueRestingCost,
        filledOpenCount,
        filledOpenCost,
      },
      initialDeposit,
      // @deprecated Use account.pnl instead (account-level delta, not row-level MTM)
      pnl: portfolio != null ? portfolio - initialDeposit : null,
      pnlPercent: portfolio != null && initialDeposit > 0 ? ((portfolio - initialDeposit) / initialDeposit) * 100 : null,
      // @deprecated Use realized.pnl instead
      realizedPnl,
      pnl24h,
      portfolio24hAgo,
      unrealizedPnl: portfolio != null ? (portfolio - initialDeposit) - realizedPnl : null,
      won,
      lost,
      totalFees: Math.round(totalFees * 100) / 100,
      // @deprecated Use localExposure.openCostBasis instead; costBasis is local audit cost basis, not account value
      costBasis,
      versionBreakdown,
      kalshiConfigured: bankroll?.kalshi_configured ?? false,
      balanceError,
      degraded,
      cashAvailable: cash != null,
      checkedAt: bankroll?.checked_at ?? new Date().toISOString(),
      source: bankroll ? "dashboard" : "local-fallback",
    };

    lastSuccessfulResponse = response;
    return NextResponse.json(response);
  } catch (error) {
    console.error("[trading/kalshi-portfolio] Error:", error);
    if (lastSuccessfulResponse) {
      return NextResponse.json({
        ...lastSuccessfulResponse,
        degraded: true,
        source: "stale-cache",
        balanceError: String(error),
      });
    }
    return NextResponse.json(
      { error: "Failed to fetch Kalshi portfolio", detail: String(error) },
      { status: 500 }
    );
  }
}
