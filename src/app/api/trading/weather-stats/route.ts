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

    const TICKER_CITY_MAP: Record<string, string> = {
      NYC: "new_york", MIA: "miami", CHI: "chicago", DEN: "denver",
      SEA: "seattle", LAX: "los_angeles", PHX: "phoenix", HOU: "houston",
      ATL: "atlanta", OKC: "oklahoma_city", TDC: "washington_dc", BOS: "boston",
      AUS: "austin", SAN: "san_antonio", DAL: "dallas", MIN: "minneapolis",
      MSY: "new_orleans", SFO: "san_francisco", TAUS: "austin", TCHI: "chicago",
      TLAX: "los_angeles", TMIA: "miami", TDEN: "denver", TOKC: "oklahoma_city",
      TNYC: "new_york", THOU: "houston", TATL: "atlanta",
    };
    const MONTH_MAP: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const parseCityFromTicker = (ticker: string): string => {
      const match = ticker.match(/KX(?:HIGH|LOW|RAIN)T?([A-Z]{2,4})-/);
      if (match) {
        const code = match[1];
        return TICKER_CITY_MAP[code] || code.toLowerCase();
      }
      return "";
    };
    const parseDateFromTicker = (ticker: string): string | null => {
      const match = ticker.match(/-(\d{2})([A-Z]{3})(\d{2})-/);
      if (match && MONTH_MAP[match[2]]) {
        return `20${match[1]}-${MONTH_MAP[match[2]]}-${match[3]}`;
      }
      return null;
    };
    const computeWeatherSettlementAt = (targetDate: string, city: string): string | null => {
      if (!targetDate) return null;
      const timeZoneMap: Record<string, string> = {
        new_york: "America/New_York", chicago: "America/Chicago", los_angeles: "America/Los_Angeles",
        miami: "America/New_York", phoenix: "America/Phoenix", dallas: "America/Chicago",
        denver: "America/Denver", houston: "America/Chicago", atlanta: "America/New_York",
        boston: "America/New_York", seattle: "America/Los_Angeles", san_francisco: "America/Los_Angeles",
        washington_dc: "America/New_York", minneapolis: "America/Chicago", austin: "America/Chicago",
        oklahoma_city: "America/Chicago", new_orleans: "America/Chicago", san_antonio: "America/Chicago",
      };
      const tz = timeZoneMap[city.toLowerCase()] || "America/New_York";
      const [y, m, d] = targetDate.split("-").map(Number);
      const utcProbe = new Date(Date.UTC((y || 2026), (m || 1) - 1, d || 1, 23, 59, 0));
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        timeZoneName: "shortOffset",
      }).formatToParts(utcProbe);
      const off = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-0";
      const match = off.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
      const sign = match?.[1] === "-" ? -1 : 1;
      const hours = Number(match?.[2] || 0);
      const mins = Number(match?.[3] || 0);
      const offsetMinutes = sign * (hours * 60 + mins);
      const localEndUtcMs = Date.UTC((y || 2026), (m || 1) - 1, d || 1, 23, 59 + 5, 0) - offsetMinutes * 60_000;
      return new Date(localEndUtcMs).toISOString();
    };

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

        let recentLiveTrades = liveDb
          .prepare(
            `SELECT trade_id, contract_id as ticker, side, quantity,
                    COALESCE(fill_price, price) as price, cost, edge,
                    CASE
                      WHEN status IN ('pending','filled','resting') THEN 'open'
                      WHEN status='settled_won' THEN 'won'
                      WHEN status='settled_lost' THEN 'lost'
                      ELSE status
                    END as status,
                    pnl, pnl as payout, actual_outcome, actual_temp, close_time,
                    city, target_date, threshold, forecast_mean,
                    NULL as settlement_scheduled_at, settled_at as resolved_at, created_at
             FROM live_trades
             WHERE status != 'failed'
             ORDER BY created_at DESC
             LIMIT 40`
          )
          .all() as Record<string, unknown>[];

        const liveTickers = [...new Set(recentLiveTrades.map((t) => String(t.ticker || "")).filter(Boolean))];
        const marketResultByTicker: Record<string, { result: string | null; close_time: string | null }> = {};
        const batchSize = 10;
        for (let i = 0; i < liveTickers.length; i += batchSize) {
          const batch = liveTickers.slice(i, i + batchSize);
          const results = await Promise.allSettled(
            batch.map(async (ticker) => {
              try {
                const res = await fetch(`http://localhost:8050/api/market/${ticker}`, {
                  signal: AbortSignal.timeout(3000),
                });
                if (res.ok) {
                  const data = await res.json();
                  return { ticker, data };
                }
              } catch { /* skip */ }
              return { ticker, data: null };
            })
          );
          for (const result of results) {
            if (result.status === "fulfilled" && result.value.data) {
              const d = result.value.data;
              marketResultByTicker[result.value.ticker] = {
                result: typeof d.result === "string" ? d.result.toUpperCase() : null,
                close_time: typeof d.close_time === "string" ? d.close_time : null,
              };
            }
          }
        }

        recentLiveTrades = recentLiveTrades.map((trade) => {
          const ticker = String(trade.ticker || "");
          const parsedTargetDate = parseDateFromTicker(ticker);
          const city = String(trade.city || parseCityFromTicker(ticker) || "");
          const targetDate = parsedTargetDate || String(trade.target_date || "");
          const market = marketResultByTicker[ticker];
          const isSettled = trade.status === "won" || trade.status === "lost";
          return {
            ...trade,
            city,
            target_date: targetDate,
            settlement_scheduled_at: market?.close_time || String(trade.close_time || computeWeatherSettlementAt(targetDate, city) || ""),
            market_result: market?.result || null,
            actual_outcome: isSettled ? (market?.result || trade.actual_outcome || null) : trade.actual_outcome,
            actual_temp: isSettled ? null : trade.actual_temp,
          };
        });

        // Compute Kalshi bankroll from initial deposit + settled P&L
        const kalshiBankroll = liveDb
          .prepare(
            `SELECT SUM(CASE WHEN status IN ('settled_won','settled_lost') THEN pnl ELSE 0 END) as settled_pnl
             FROM live_trades WHERE status != 'failed'`
          )
          .get() as { settled_pnl: number } | undefined;
        
        // Read initial deposit from bankroll.json
        const bankrollPath = join(WEATHER_TRADING_DIR, "data", "bankroll.json");
        let initialDeposit = 1000;
        if (existsSync(bankrollPath)) {
          try {
            const bdata = JSON.parse(readFileSync(bankrollPath, "utf-8"));
            initialDeposit = bdata.initial_deposit || 1000;
          } catch { /* use default */ }
        }
        const computedBankroll = initialDeposit + (kalshiBankroll?.settled_pnl || 0);
        
        // Get version breakdown
        const versionBreakdown = liveDb
          .prepare(
            `SELECT strategy_version,
                    COUNT(*) as total,
                    SUM(CASE WHEN status IN ('pending','filled','resting') THEN 1 ELSE 0 END) as open,
                    SUM(CASE WHEN status='settled_won' THEN 1 ELSE 0 END) as won,
                    SUM(CASE WHEN status='settled_lost' THEN 1 ELSE 0 END) as lost,
                    SUM(pnl) as pnl
             FROM live_trades WHERE status != 'failed'
             GROUP BY strategy_version`
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
          bankroll: computedBankroll,
          initialDeposit,
          recentTrades: recentLiveTrades,
          resolvedTrades: recentLiveTrades.filter(
            (t: Record<string, unknown>) => t.status === "won" || t.status === "lost"
          ),
          versionBreakdown,
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
