import { NextResponse, NextRequest } from "next/server";

const POLYGON_KEY = "6ebM7bBe1jn0zH4d3f093X2VW9BCCCZh";

const CRYPTO_POLYGON: Record<string, string> = {
  BTC: "X:BTCUSD",
  ETH: "X:ETHUSD",
  SOL: "X:SOLUSD",
};

export const dynamic = "force-dynamic";

const candleCache: Record<string, { data: unknown; time: number }> = {};
const CACHE_TTL = 60000;

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "SPY";
  const timeframe = req.nextUrl.searchParams.get("timeframe") || "1M";

  const cacheKey = `${symbol}-${timeframe}`;
  const now = Date.now();

  if (candleCache[cacheKey] && now - candleCache[cacheKey].time < CACHE_TTL) {
    return NextResponse.json(candleCache[cacheKey].data);
  }

  const tfMap: Record<
    string,
    { multiplier: number; timespan: string; days: number }
  > = {
    "1D": { multiplier: 5, timespan: "minute", days: 1 },
    "1W": { multiplier: 30, timespan: "minute", days: 7 },
    "1M": { multiplier: 1, timespan: "day", days: 30 },
    "3M": { multiplier: 1, timespan: "day", days: 90 },
    "1Y": { multiplier: 1, timespan: "day", days: 365 },
  };

  const tf = tfMap[timeframe] || tfMap["1M"];
  const to = new Date();
  const from = new Date(to.getTime() - tf.days * 24 * 60 * 60 * 1000);
  const fromStr = from.toISOString().split("T")[0];
  const toStr = to.toISOString().split("T")[0];

  const polygonSymbol = CRYPTO_POLYGON[symbol] || symbol;

  try {
    const res = await fetch(
      `https://api.polygon.io/v2/aggs/ticker/${polygonSymbol}/range/${tf.multiplier}/${tf.timespan}/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=5000&apiKey=${POLYGON_KEY}`
    );
    const data = await res.json();

    const candles = (data.results || []).map(
      (r: { t: number; o: number; h: number; l: number; c: number; v: number }) => ({
        time: Math.floor(r.t / 1000),
        open: r.o,
        high: r.h,
        low: r.l,
        close: r.c,
        volume: r.v,
      })
    );

    candleCache[cacheKey] = { data: candles, time: now };
    return NextResponse.json(candles);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
