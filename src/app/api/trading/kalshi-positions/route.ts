import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { REAL_OPEN_LIVE_TRADE_WHERE, normalizeLiveTradeLifecycleStatus } from "@/lib/live-trade-status";

const WEATHER_TRADING_DIR =
  process.env.WEATHER_TRADING_DIR ||
  "/Users/timharris/.openclaw/workspace/projects/weather-trading";
const LIVE_TRADING_DB = join(WEATHER_TRADING_DIR, "data", "live_trading.db");

/**
 * Returns enriched position data: local DB trades + current Kalshi market prices.
 */
export async function GET() {
  try {
    if (!existsSync(LIVE_TRADING_DB)) {
      return NextResponse.json({ positions: [], resolved: [] });
    }

    const Database = require("better-sqlite3");
    const db = new Database(LIVE_TRADING_DB, { readonly: true });

    // Open positions
    const openTrades = db.prepare(
      `SELECT trade_id, order_id, contract_id as ticker, side, quantity,
              COALESCE(fill_price, price) as price, cost, edge,
              city, target_date, threshold, forecast_mean,
              status, fill_quantity, created_at, strategy_version, our_probability, market_probability
       FROM live_trades
       WHERE ${REAL_OPEN_LIVE_TRADE_WHERE}
       ORDER BY created_at DESC`
    ).all() as Record<string, unknown>[];

    // Settled positions
    const settledTrades = db.prepare(
      `SELECT trade_id, order_id, contract_id as ticker, side, quantity,
              COALESCE(fill_price, price) as price, cost, edge,
              city, target_date, threshold, forecast_mean,
              CASE WHEN status='settled_won' THEN 'won' ELSE 'lost' END as status,
              pnl, actual_outcome, actual_temp, settled_at as resolved_at,
              created_at, strategy_version, our_probability, market_probability
       FROM live_trades
       WHERE status IN ('settled_won', 'settled_lost')
       ORDER BY settled_at DESC`
    ).all() as Record<string, unknown>[];

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

    const enrichWithSettlement = (trade: Record<string, unknown>) => {
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
        // Weather contracts should settle shortly after the target weather day ends,
        // not at an arbitrary next-day fallback. Use city-local end-of-day + a small buffer
        // until authoritative Kalshi close_time is attached below.
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
      // Compute fees from fills for settled trades
      const fillFees = (enriched.fills as Record<string, unknown>[])?.reduce(
        (sum: number, f: Record<string, unknown>) => sum + Number(f.fee || 0), 0
      ) ?? 0;
      enriched.fees = fillFees;
      return enriched;
    });

    // Fetch fees per position from Kalshi portfolio positions
    const feesMap: Record<string, number> = {};
    try {
      const kalshiPosRes = await fetch("http://localhost:8050/api/kalshi/portfolio", {
        signal: AbortSignal.timeout(5000),
      });
      if (kalshiPosRes.ok) {
        const kpData = await kalshiPosRes.json();
        const kPositions = kpData.market_positions || kpData.positions || [];
        for (const kp of kPositions) {
          const ticker = kp.ticker || "";
          feesMap[ticker] = parseFloat(kp.fees_paid_dollars || "0");
        }
      }
    } catch { /* skip */ }

    // Fetch market data from Kalshi via dashboard proxy.
    // We need this for BOTH open and settled rows so the Trading Floor can
    // prefer source-of-truth market results/metadata over poisoned local fields.
    const tickers = [...new Set([...positions, ...resolved].map((p) => String(p.ticker)))];

    type MarketData = {
      yes_bid: number | null;
      yes_ask: number | null;
      last: number | null;
      close_time: string | null;
      result: string | null;
      market_status: string | null;
      title: string | null;
      subtitle: string | null;
      floor_strike: number | null;
      cap_strike: number | null;
    };
    const marketDataByTicker: Record<string, MarketData> = {};

    // Fetch market data in parallel (batch of 10 at a time to avoid rate limits)
    const batchSize = 10;
    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
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
            yes_bid: d.yes_bid_dollars ? parseFloat(d.yes_bid_dollars) : null,
            yes_ask: d.yes_ask_dollars ? parseFloat(d.yes_ask_dollars) : null,
            last: d.last_price_dollars ? parseFloat(d.last_price_dollars) : null,
            close_time: d.close_time || null,
            result: typeof d.result === "string" ? d.result.toLowerCase() : null,
            market_status: typeof d.status === "string" ? d.status : null,
            title: typeof d.title === "string" ? d.title : null,
            subtitle: typeof d.subtitle === "string" ? d.subtitle : null,
            floor_strike: d.floor_strike != null ? Number(d.floor_strike) : null,
            cap_strike: d.cap_strike != null ? Number(d.cap_strike) : null,
          };
        }
      }
    }

    const enrichWithMarketData = (trade: Record<string, unknown>) => {
      const ticker = String(trade.ticker || "");
      const market = marketDataByTicker[ticker];
      const enriched = { ...trade };

      if (market?.close_time) {
        enriched.settlement_scheduled_at = String(market.close_time);
      }
      if (market?.result) {
        enriched.market_result = market.result;
      }
      if (market?.market_status) {
        enriched.market_status = market.market_status;
      }
      if (market?.title) {
        enriched.market_title = market.title;
      }
      if (market?.subtitle) {
        enriched.market_subtitle = market.subtitle;
      }
      if (market?.floor_strike != null) {
        enriched.market_floor_strike = market.floor_strike;
      }
      if (market?.cap_strike != null) {
        enriched.market_cap_strike = market.cap_strike;
      }

      return { enriched, market };
    };

    // Enrich positions with current price
    const enrichedPositions = positions.map((p) => {
      const ticker = String(p.ticker);
      const { enriched, market } = enrichWithMarketData(p);
      const side = String(enriched.side).toLowerCase();

      let nowPrice: number | null = null;
      if (market) {
        // Use mid-market when available, otherwise best available price
        // Avoid using last_price alone in illiquid markets (can be very stale)
        const yesBid = market.yes_bid;
        const yesAsk = market.yes_ask;
        let yesPrice: number | null = null;

        if (yesBid != null && yesAsk != null && yesBid > 0 && yesAsk > 0) {
          // Use midpoint when both sides have liquidity
          yesPrice = (yesBid + yesAsk) / 2;
        } else if (yesAsk != null && yesAsk > 0 && (yesBid == null || yesBid === 0)) {
          // Only ask exists — market is one-sided, use ask but flag as illiquid
          yesPrice = yesAsk;
        } else if (yesBid != null && yesBid > 0) {
          yesPrice = yesBid;
        } else {
          yesPrice = market.last;
        }

        if (yesPrice != null) {
          nowPrice = side === "yes" ? yesPrice : 1 - yesPrice;
        }
      }

      // Compute fees: prefer Kalshi positions API, fall back to fills table
      const apiFees = feesMap[ticker];
      const fillFees = (enriched.fills as Record<string, unknown>[])?.reduce(
        (sum: number, f: Record<string, unknown>) => sum + Number(f.fee || 0), 0
      ) ?? 0;
      const fees = apiFees ?? (fillFees > 0 ? fillFees : 0);

      return { ...enriched, now_price: nowPrice, fees };
    });

    const enrichedResolved = resolved.map((p) => {
      const { enriched } = enrichWithMarketData(p);
      return enriched;
    });

    return NextResponse.json({
      positions: enrichedPositions,
      resolved: enrichedResolved,
    });
  } catch (error) {
    console.error("[trading/kalshi-positions] Error:", error);
    return NextResponse.json({ positions: [], resolved: [], error: String(error) }, { status: 500 });
  }
}
