import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";

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
              status, created_at, strategy_version, our_probability, market_probability
       FROM live_trades
       WHERE status IN ('pending', 'filled', 'resting')
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
        const td = new Date(targetDate + "T00:00:00Z");
        const isBracket = /-B\d/.test(ticker);
        const nextDay = new Date(td);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        nextDay.setUTCHours(isBracket ? 19 : 14, 0, 0, 0);
        settlement_scheduled_at = nextDay.toISOString();
      }
      return { ...trade, settlement_scheduled_at };
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

    // Fetch current market prices from Kalshi via dashboard proxy
    // Get unique tickers to batch-fetch
    const tickers = [...new Set(positions.map((p) => String(p.ticker)))];

    type MarketPrice = { yes_bid: number | null; yes_ask: number | null; last: number | null };
    const currentPrices: Record<string, MarketPrice> = {};

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
          currentPrices[result.value.ticker] = {
            yes_bid: d.yes_bid_dollars ? parseFloat(d.yes_bid_dollars) : null,
            yes_ask: d.yes_ask_dollars ? parseFloat(d.yes_ask_dollars) : null,
            last: d.last_price_dollars ? parseFloat(d.last_price_dollars) : null,
          };
        }
      }
    }

    // Enrich positions with current price
    const enrichedPositions = positions.map((p) => {
      const ticker = String(p.ticker);
      const current = currentPrices[ticker];
      const side = String(p.side).toLowerCase();

      let nowPrice: number | null = null;
      if (current) {
        // For YES side: current yes price; For NO side: 1 - yes price
        const yesPrice = current.last ?? current.yes_bid ?? current.yes_ask;
        if (yesPrice != null) {
          nowPrice = side === "yes" ? yesPrice : 1 - yesPrice;
        }
      }

      // Compute fees: prefer Kalshi positions API, fall back to fills table
      const apiFees = feesMap[ticker];
      const fillFees = (p.fills as Record<string, unknown>[])?.reduce(
        (sum: number, f: Record<string, unknown>) => sum + Number(f.fee || 0), 0
      ) ?? 0;
      const fees = apiFees ?? (fillFees > 0 ? fillFees : 0);
      return { ...p, now_price: nowPrice, fees };
    });

    return NextResponse.json({
      positions: enrichedPositions,
      resolved,
    });
  } catch (error) {
    console.error("[trading/kalshi-positions] Error:", error);
    return NextResponse.json({ positions: [], resolved: [], error: String(error) }, { status: 500 });
  }
}
