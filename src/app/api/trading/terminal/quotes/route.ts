import { NextResponse, NextRequest } from "next/server";

const POLYGON_KEY = "6ebM7bBe1jn0zH4d3f093X2VW9BCCCZh";

const CRYPTO_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
};

export const dynamic = "force-dynamic";

let cachedQuotes: Record<string, unknown> = {};
let cacheTime = 0;
const CACHE_TTL = 15000;

export async function GET(req: NextRequest) {
  const symbols =
    req.nextUrl.searchParams.get("symbols")?.split(",").filter(Boolean) || [];

  const now = Date.now();
  if (now - cacheTime < CACHE_TTL && Object.keys(cachedQuotes).length > 0) {
    const filtered: Record<string, unknown> = {};
    for (const s of symbols) {
      if (cachedQuotes[s]) filtered[s] = cachedQuotes[s];
    }
    if (Object.keys(filtered).length === symbols.length) {
      return NextResponse.json(filtered);
    }
  }

  const stockSymbols = symbols.filter((s) => !CRYPTO_MAP[s]);
  const cryptoSymbols = symbols.filter((s) => CRYPTO_MAP[s]);

  const results: Record<string, unknown> = {};

  const stockPromises = stockSymbols.map(async (symbol) => {
    try {
      const res = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${symbol}/prev?apiKey=${POLYGON_KEY}`,
        { next: { revalidate: 30 } }
      );
      const data = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0];
        const change = r.c - r.o;
        const changePercent = (change / r.o) * 100;
        results[symbol] = {
          symbol,
          price: r.c,
          change,
          changePercent,
          open: r.o,
          high: r.h,
          low: r.l,
          close: r.c,
          volume: r.v,
        };
      }
    } catch (e) {
      console.error(`Failed to fetch ${symbol}:`, e);
    }
  });

  let cryptoPromise: Promise<void> | null = null;
  if (cryptoSymbols.length > 0) {
    cryptoPromise = (async () => {
      try {
        const ids = cryptoSymbols.map((s) => CRYPTO_MAP[s]).join(",");
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`
        );
        const data = await res.json();
        for (const symbol of cryptoSymbols) {
          const id = CRYPTO_MAP[symbol];
          if (data[id]) {
            const price = data[id].usd;
            const changePercent = data[id].usd_24h_change || 0;
            const change = price * (changePercent / 100);
            results[symbol] = {
              symbol,
              price,
              change,
              changePercent,
              open: price - change,
              high: price,
              low: price,
              close: price,
              volume: data[id].usd_24h_vol || 0,
            };
          }
        }
      } catch (e) {
        console.error("Failed to fetch crypto:", e);
      }
    })();
  }

  await Promise.all([...stockPromises, cryptoPromise].filter(Boolean));

  Object.assign(cachedQuotes, results);
  cacheTime = now;

  return NextResponse.json(results);
}
