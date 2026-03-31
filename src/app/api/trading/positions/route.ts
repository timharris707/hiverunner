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
        new_york: "America/New_York",
        chicago: "America/Chicago",
        los_angeles: "America/Los_Angeles",
        miami: "America/New_York",
        phoenix: "America/Phoenix",
        dallas: "America/Chicago",
        denver: "America/Denver",
        houston: "America/Chicago",
        atlanta: "America/New_York",
        boston: "America/New_York",
        seattle: "America/Los_Angeles",
        san_francisco: "America/Los_Angeles",
        washington_dc: "America/New_York",
        minneapolis: "America/Chicago",
        austin: "America/Chicago",
        oklahoma_city: "America/Chicago",
        new_orleans: "America/Chicago",
        san_antonio: "America/Chicago",
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
                  status, created_at, 'paper' as trade_type, strategy_version, our_probability,
                  CASE
                    WHEN settlement_scheduled_at IS NOT NULL AND settlement_scheduled_at <= datetime('now') THEN 'awaiting_settlement'
                    ELSE 'open'
                  END as lifecycle_status
           FROM trades
           WHERE status = 'open'
           ORDER BY created_at DESC`
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
                  settlement_scheduled_at, resolved_at, created_at, 'paper' as trade_type,
                  strategy_version, our_probability
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
                  city, target_date,
                  forecast_mean, NULL as forecast_std, NULL as n_models,
                  status as raw_status, 'open' as status, created_at, 'live' as trade_type, 'open' as lifecycle_status,
                  strategy_version, our_probability, market_probability, threshold
           FROM live_trades
           WHERE status IN ('pending', 'filled', 'resting')
           ORDER BY created_at DESC`
        )
        .all()
        .map((row: Record<string, unknown>) => {
          const ticker = String(row.ticker || "");
          const parsedTargetDate = parseDateFromTicker(ticker);
          const city = String(row.city || parseCityFromTicker(ticker) || "");
          const targetDate = parsedTargetDate || String(row.target_date || "");
          return {
            ...row,
            city,
            target_date: targetDate,
            settlement_scheduled_at: computeWeatherSettlementAt(targetDate, city),
          };
        });

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
                  close_time, settled_at as resolved_at, created_at,
                  'live' as trade_type, strategy_version, our_probability
           FROM live_trades
           WHERE status IN ('settled_won', 'settled_lost')
           ORDER BY settled_at DESC
           LIMIT 30`
        )
        .all()
        .map((row: Record<string, unknown>) => {
          const ticker = String(row.ticker || "");
          const parsedTargetDate = parseDateFromTicker(ticker);
          const city = String(row.city || parseCityFromTicker(ticker) || "");
          const targetDate = parsedTargetDate || String(row.target_date || "");
          return {
            ...row,
            city,
            target_date: targetDate,
            settlement_scheduled_at: String(row.close_time || computeWeatherSettlementAt(targetDate, city) || ""),
          };
        });

      const liveTickers = [...new Set([
        ...livePositions.map((row: Record<string, unknown>) => String(row.ticker || "")),
        ...liveResolvedPositions.map((row: Record<string, unknown>) => String(row.ticker || "")),
      ].filter(Boolean))];

      type MarketData = { result: string | null; close_time: string | null };
      const marketDataByTicker: Record<string, MarketData> = {};
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
            marketDataByTicker[result.value.ticker] = {
              result: typeof d.result === "string" ? d.result.toUpperCase() : null,
              close_time: typeof d.close_time === "string" ? d.close_time : null,
            };
          }
        }
      }

      livePositions = livePositions.map((row: Record<string, unknown>) => {
        const market = marketDataByTicker[String(row.ticker || "")];
        return market?.close_time ? { ...row, settlement_scheduled_at: market.close_time } : row;
      });

      liveResolvedPositions = liveResolvedPositions.map((row: Record<string, unknown>) => {
        const market = marketDataByTicker[String(row.ticker || "")];
        return {
          ...row,
          market_result: market?.result || null,
          settlement_scheduled_at: market?.close_time || row.settlement_scheduled_at,
        };
      });

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
