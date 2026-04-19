import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { REAL_OPEN_LIVE_TRADE_WHERE, normalizeLiveTradeLifecycleStatus } from "@/lib/live-trade-status";
import { reconcileOpenTradesWithExchangeTruth } from "@/lib/trading-open-position-truth";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";
const LIVE_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "live_trading.db");
const DASHBOARD_BASE_URL = process.env.TRADING_DASHBOARD_BASE_URL || "http://127.0.0.1:8050";

const KALSHI_PORTFOLIO_TIMEOUT_MS = Number(process.env.TRADING_KALSHI_PORTFOLIO_TIMEOUT_MS || 90_000);
const WEATHER_TRUTH_TIMEOUT_MS = Number(process.env.TRADING_WEATHER_TRUTH_TIMEOUT_MS || 35_000);
const WEATHER_TRUTH_ATTEMPTS = Math.max(1, Number(process.env.TRADING_WEATHER_TRUTH_ATTEMPTS || 2));
const WEATHER_TRUTH_RETRY_DELAY_MS = Number(process.env.TRADING_WEATHER_TRUTH_RETRY_DELAY_MS || 300);

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type WeatherTruth = {
  implied_forecast_f: number | null;
  selected_market_yes_chance: number | null;
  probability_source: string | null;
  checked_at: string;
};

const weatherTruthCache = new Map<string, WeatherTruth>();
let lastReportedOpenPositions: Record<string, unknown>[] = [];
let lastReportedCheckedAt: string | null = null;

function pickOpenPositions(rawPortfolio: unknown): Record<string, unknown>[] {
  const root = (rawPortfolio && typeof rawPortfolio === "object") ? rawPortfolio as Record<string, unknown> : {};
  const nestedPortfolio = (root.portfolio && typeof root.portfolio === "object") ? root.portfolio as Record<string, unknown> : {};
  const nestedData = (root.data && typeof root.data === "object") ? root.data as Record<string, unknown> : {};

  const candidates: unknown[] = [
    root.open_positions,
    root.market_positions,
    root.positions,
    nestedPortfolio.open_positions,
    nestedPortfolio.market_positions,
    nestedPortfolio.positions,
    nestedData.open_positions,
    nestedData.market_positions,
    nestedData.positions,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as Record<string, unknown>[];
    }
  }

  return [];
}

function isUnitProbability(value: number | null): value is number {
  return value != null && value >= 0 && value <= 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns enriched position data: local DB trades + current Kalshi weather-truth prices.
 */
export async function GET(request: Request) {
  try {
    if (!existsSync(LIVE_TRADING_DB)) {
      return NextResponse.json({ positions: [], resolved: [] });
    }

    const params = new URL(request.url).searchParams;
    const statusFilter = (params.get("status") || "").trim().toLowerCase();
    const openOnly = statusFilter === "open";
    const includeResolved = !openOnly && params.get("includeResolved") !== "0";
    const includeWeatherTruth = params.get("includeWeatherTruth") !== "0";

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(LIVE_TRADING_DB, { readonly: true });

    // Open positions
    let openTrades = db.prepare(
      `SELECT trade_id, order_id, contract_id, contract_id as ticker, side, quantity,
              COALESCE(fill_price, price) as price, cost, edge,
              city, target_date, threshold, forecast_mean,
              status, fill_quantity, created_at, strategy_version, our_probability, market_probability
       FROM live_trades
       WHERE ${REAL_OPEN_LIVE_TRADE_WHERE}
       ORDER BY created_at DESC`
    ).all() as Record<string, unknown>[];

    // Settled positions
    let settledTrades: Record<string, unknown>[] = [];
    if (includeResolved) {
      settledTrades = db.prepare(
        `SELECT trade_id, order_id, contract_id, contract_id as ticker, side, quantity,
                COALESCE(fill_price, price) as price, cost, edge,
                city, target_date, threshold, forecast_mean,
                CASE WHEN status='settled_won' THEN 'won' ELSE 'lost' END as status,
                pnl, actual_outcome, actual_temp, settled_at as resolved_at,
                created_at, strategy_version, our_probability, market_probability
         FROM live_trades
         WHERE status IN ('settled_won', 'settled_lost')
         ORDER BY settled_at DESC`
      ).all() as Record<string, unknown>[];
    }

    // Compute settlement times
    // City code to name mapping for parsing from tickers
    const TICKER_CITY_MAP: Record<string, string> = {
      NYC: "new_york", MIA: "miami", CHI: "chicago", DEN: "denver",
      SEA: "seattle", LAX: "los_angeles", PHX: "phoenix", HOU: "houston",
      ATL: "atlanta", OKC: "oklahoma_city", TDC: "washington_dc", BOS: "boston",
      AUS: "austin", SAN: "san_antonio", DAL: "dallas", MIN: "minneapolis",
      MSY: "new_orleans", SFO: "san_francisco", TAUS: "austin", TCHI: "chicago",
      TLAX: "los_angeles", TMIA: "miami", TDEN: "denver", TOKC: "oklahoma_city",
      TNYC: "new_york", THOU: "houston", TATL: "atlanta",
    };

    const parseCityFromTicker = (ticker: string): string => {
      // Tickers like KXHIGHTATL-26MAR30-T72 or KXRAINNYC-26MAR30-T0 or KXLOWTAUS-26MAR30-T57
      const match = ticker.match(/KX(?:HIGH|LOW|RAIN)T?([A-Z]{2,4})-/);
      if (match) {
        const code = match[1];
        return TICKER_CITY_MAP[code] || code.toLowerCase();
      }
      return "";
    };

    // Load fills from DB
    const fillsByOrder: Record<string, Record<string, unknown>[]> = {};
    try {
      const allFills = db.prepare(
        `SELECT fill_id, order_id, ticker, side, action, quantity, yes_price, no_price, fee, is_taker, filled_at
         FROM fills ORDER BY filled_at`
      ).all() as Record<string, unknown>[];
      for (const f of allFills) {
        const oid = String(f.order_id || "");
        if (!fillsByOrder[oid]) fillsByOrder[oid] = [];
        fillsByOrder[oid].push(f);
      }
    } catch { /* fills table may not exist */ }

    db.close();

    // Canonical open-position truth: always prefer exchange-reported open position
    // quantity/cost/avg_price when Kalshi data is available.
    let reportedOpenPositions: Record<string, unknown>[] = [];
    let kalshiCheckedAt = new Date().toISOString();

    try {
      const rawPortfolioRes = await fetch(`${DASHBOARD_BASE_URL}/api/kalshi/portfolio`, {
        signal: AbortSignal.timeout(KALSHI_PORTFOLIO_TIMEOUT_MS),
      });
      if (rawPortfolioRes.ok) {
        const rawPortfolio = await rawPortfolioRes.json();
        const picked = pickOpenPositions(rawPortfolio);
        if (picked.length > 0) {
          reportedOpenPositions = picked;
          lastReportedOpenPositions = picked;
          const checked = typeof rawPortfolio.checked_at === "string" && rawPortfolio.checked_at
            ? rawPortfolio.checked_at
            : new Date().toISOString();
          kalshiCheckedAt = checked;
          lastReportedCheckedAt = checked;
        }
      }
    } catch {
      /* fall back to cache/local-only open rows */
    }

    if (reportedOpenPositions.length === 0 && lastReportedOpenPositions.length > 0) {
      reportedOpenPositions = lastReportedOpenPositions;
      kalshiCheckedAt = lastReportedCheckedAt || kalshiCheckedAt;
    }

    openTrades = reconcileOpenTradesWithExchangeTruth(openTrades, reportedOpenPositions, kalshiCheckedAt);

    // Parse target date from ticker as source of truth (e.g. KXHIGHMIA-26MAR28-B79.5 → 2026-03-28)
    const MONTH_MAP: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const parseDateFromTicker = (ticker: string): string | null => {
      const match = ticker.match(/-(\d{2})([A-Z]{3})(\d{2})-/);
      if (match && MONTH_MAP[match[2]]) {
        return `20${match[1]}-${MONTH_MAP[match[2]]}-${match[3]}`;
      }
      return null;
    };

    const enrichWithSettlement = (trade: Record<string, unknown>): Record<string, unknown> => {
      const ticker = String(trade.ticker || "");

      // Fill in missing city from ticker
      if (!trade.city || trade.city === "") {
        trade.city = parseCityFromTicker(ticker);
      }

      // Always verify target_date from ticker (safeguard against bad backfills)
      const tickerDate = parseDateFromTicker(ticker);
      if (tickerDate && trade.target_date !== tickerDate) {
        trade.target_date = tickerDate;
      }

      // Attach fills for this trade — match by order_id only
      const orderId = String(trade.trade_id || "").replace("bf-", "");
      const tradeOrderId = String(trade.trade_id || "");
      const rawOrderId = String(trade.order_id || "");
      trade.fills = fillsByOrder[rawOrderId] || fillsByOrder[orderId] || fillsByOrder[tradeOrderId] || [];

      // Compute settlement time from target_date + contract type
      let settlement_scheduled_at: string | null = null;
      const targetDate = String(trade.target_date || "");
      if (targetDate) {
        const city = String(trade.city || "").toLowerCase();
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
        const tz = timeZoneMap[city] || "America/New_York";
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
        settlement_scheduled_at = new Date(localEndUtcMs).toISOString();
      }
      return {
        ...trade,
        status: normalizeLiveTradeLifecycleStatus(
          String(trade.status || ""),
          Number(trade.fill_quantity || 0),
          Number(trade.quantity || 0)
        ),
        settlement_scheduled_at,
      };
    };

    const positions = openTrades.map(enrichWithSettlement);
    const resolved = settledTrades.map((t) => {
      const enriched = enrichWithSettlement(t);
      const fillFees = (enriched.fills as Record<string, unknown>[])?.reduce(
        (sum: number, f: Record<string, unknown>) => sum + Number(f.fee || 0), 0
      ) ?? 0;
      enriched.fees = fillFees;
      return enriched;
    });

    // Fees from exchange open positions where available.
    const feesMap: Record<string, number> = {};
    for (const kp of reportedOpenPositions) {
      const ticker = String(kp.ticker || "").toUpperCase();
      const side = String(kp.side || "").toLowerCase();
      if (!ticker) continue;
      const fee = Number(kp.fees_paid_dollars || kp.fee || 0);
      if (Number.isFinite(fee)) {
        feesMap[`${ticker}|${side}`] = fee;
        if (!(ticker in feesMap)) feesMap[ticker] = fee;
      }
    }

    // Weather-truth enrichment for open rows only.
    const weatherTruthByTicker: Record<string, WeatherTruth> = {};
    const openTickers = [...new Set(positions.map((p) => String(p.ticker || "").toUpperCase()).filter(Boolean))];

    if (includeWeatherTruth) {
      for (const ticker of openTickers) {
        const cached = weatherTruthCache.get(ticker) ?? null;
        let payload: Record<string, unknown> | null = null;

        for (let attempt = 1; attempt <= WEATHER_TRUTH_ATTEMPTS; attempt += 1) {
          try {
            const res = await fetch(`${DASHBOARD_BASE_URL}/api/kalshi/weather-truth/${encodeURIComponent(ticker)}`, {
              signal: AbortSignal.timeout(WEATHER_TRUTH_TIMEOUT_MS),
            });
            if (res.ok) {
              const data = await res.json();
              if (data?.available !== false) {
                payload = data as Record<string, unknown>;
                break;
              }
            }
          } catch {
            /* retry */
          }

          if (attempt < WEATHER_TRUTH_ATTEMPTS) {
            await sleep(WEATHER_TRUTH_RETRY_DELAY_MS);
          }
        }

        if (payload) {
          const truth: WeatherTruth = {
            implied_forecast_f: toFiniteNumber(payload.implied_forecast_f),
            selected_market_yes_chance: toFiniteNumber(payload.selected_market_yes_chance),
            probability_source: typeof payload.probability_source === "string" ? payload.probability_source : null,
            checked_at: typeof payload.checked_at === "string" ? payload.checked_at : kalshiCheckedAt,
          };
          weatherTruthByTicker[ticker] = truth;
          weatherTruthCache.set(ticker, truth);
          continue;
        }

        if (cached) {
          weatherTruthByTicker[ticker] = cached;
        }
      }
    }

    // Enrich positions with now price.
    const enrichedPositions = positions.map((p) => {
      const ticker = String(p.ticker || "").toUpperCase();
      const side = String(p.side).toLowerCase();
      const weatherTruth = weatherTruthByTicker[ticker];

      const exchangeYesChance = weatherTruth?.selected_market_yes_chance;
      const kalshiImpliedForecast = weatherTruth?.implied_forecast_f ?? null;

      let nowPrice: number | null = null;
      if (isUnitProbability(exchangeYesChance)) {
        nowPrice = side === "yes" ? exchangeYesChance : 1 - exchangeYesChance;
      }

      if (nowPrice == null) {
        const localYesChance = toFiniteNumber(p.market_probability);
        if (isUnitProbability(localYesChance)) {
          nowPrice = side === "yes" ? localYesChance : 1 - localYesChance;
        }
      }

      if (nowPrice == null) {
        const entryPrice = toFiniteNumber(p.price);
        if (isUnitProbability(entryPrice)) {
          nowPrice = entryPrice;
        }
      }

      // Compute fees: prefer synthetic exchange fallback row, then Kalshi positions API, then fills table
      const syntheticFees = p.fees_paid_dollars != null ? Number(p.fees_paid_dollars) : null;
      const apiFees = feesMap[`${ticker}|${side}`] ?? feesMap[ticker];
      const fillFees = (p.fills as Record<string, unknown>[])?.reduce(
        (sum: number, f: Record<string, unknown>) => sum + Number(f.fee || 0), 0
      ) ?? 0;
      const fees = syntheticFees ?? apiFees ?? (fillFees > 0 ? fillFees : 0);

      const fallbackForecast = toFiniteNumber(p.forecast_mean);

      return {
        ...p,
        forecast_mean: kalshiImpliedForecast ?? fallbackForecast,
        now_price: nowPrice,
        fees,
        kalshi_implied_forecast_f: kalshiImpliedForecast,
        kalshi_weather_truth_probability_source: weatherTruth?.probability_source ?? null,
        kalshi_weather_truth_checked_at: weatherTruth?.checked_at ?? null,
      };
    });

    return NextResponse.json({
      positions: enrichedPositions,
      resolved: includeResolved ? resolved : [],
    });
  } catch (error) {
    console.error("[trading/kalshi-positions] Error:", error);
    return NextResponse.json({ positions: [], resolved: [], error: String(error) }, { status: 500 });
  }
}
