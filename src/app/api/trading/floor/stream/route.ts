import { NextRequest } from "next/server";
import { formatLocalDate, TRADING_STATIONS } from "@/lib/trading-weather";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

interface TradingFloorPositionsData {
  positions: unknown[];
  resolvedPositions: unknown[];
  cityBreakdown: unknown[];
  liveCityBreakdown: unknown[];
  paperCityBreakdown: unknown[];
}

interface TradingFloorSnapshot {
  positionsData?: TradingFloorPositionsData;
  kalshiPortfolio?: JsonRecord;
  liveForecasts?: Record<string, Record<string, { high: number; low: number }>>;
  currentTemps?: Record<string, { tempF: number; ageMinutes: number; stationId: string }>;
  forecastFetchedAt?: string | null;
  actualHighs?: Record<string, unknown>;
  fetchedAt?: string;
}

const SNAPSHOT_INTERVAL_MS = 5_000;
const KEEPALIVE_INTERVAL_MS = 20_000;
const REQUEST_TIMEOUT_MS = 12_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTargetDateFromTicker(ticker: string): string | null {
  const match = ticker.match(/-(\d{2})([A-Z]{3})(\d{2})-/i);
  if (!match) return null;
  const monthMap: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const [, yy, monRaw, dd] = match;
  const mon = monthMap[monRaw.toUpperCase()];
  if (!mon) return null;
  return `20${yy}-${mon}-${dd}`;
}

function getEffectiveTargetDate(ticker: string, fallbackTargetDate: string): string {
  return parseTargetDateFromTicker(ticker) || fallbackTargetDate;
}

function getLocalTodayForCity(city: string): string {
  const station = TRADING_STATIONS[city.toLowerCase()];
  return station ? formatLocalDate(new Date(), station.timeZone) : new Date().toISOString().slice(0, 10);
}

function getActualPairs(snapshot: TradingFloorSnapshot): string[] {
  const positionsData = snapshot.positionsData;
  if (!positionsData) return [];

  const pairs = new Set<string>();
  const trades = [...positionsData.positions, ...positionsData.resolvedPositions];

  for (const trade of trades) {
    if (!isRecord(trade)) continue;
    const cityRaw = trade.city;
    const targetDateRaw = trade.target_date;
    if (typeof cityRaw !== "string" || typeof targetDateRaw !== "string") continue;

    const city = cityRaw.toLowerCase().trim();
    if (!city) continue;

    const ticker = typeof trade.ticker === "string" ? trade.ticker : "";
    const effectiveTargetDate = getEffectiveTargetDate(ticker, targetDateRaw);
    if (effectiveTargetDate <= getLocalTodayForCity(city)) {
      pairs.add(`${city}|${effectiveTargetDate}`);
    }
  }

  return Array.from(pairs.values());
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
    };
  }
}

async function nextSnapshot(origin: string, previous: TradingFloorSnapshot): Promise<TradingFloorSnapshot> {
  const snapshot: TradingFloorSnapshot = { ...previous };

  const [positionsRes, portfolioRes, forecastsRes, tempsRes] = await Promise.all([
    fetchJson(`${origin}/api/trading/kalshi-positions`),
    fetchJson(`${origin}/api/trading/kalshi-portfolio`),
    fetchJson(`${origin}/api/trading/live-forecasts`),
    fetchJson(`${origin}/api/trading/current-temps`),
  ]);

  if (positionsRes.ok && isRecord(positionsRes.data) && !("error" in positionsRes.data)) {
    const positions = Array.isArray(positionsRes.data.positions) ? positionsRes.data.positions : null;
    const resolved = Array.isArray(positionsRes.data.resolved) ? positionsRes.data.resolved : null;
    if (positions && resolved) {
      snapshot.positionsData = {
        positions,
        resolvedPositions: resolved,
        cityBreakdown: [],
        liveCityBreakdown: [],
        paperCityBreakdown: [],
      };
    }
  }

  if (portfolioRes.ok && isRecord(portfolioRes.data) && !("error" in portfolioRes.data)) {
    snapshot.kalshiPortfolio = portfolioRes.data;
  }

  if (forecastsRes.ok && isRecord(forecastsRes.data) && !("error" in forecastsRes.data)) {
    if (isRecord(forecastsRes.data.forecasts)) {
      snapshot.liveForecasts = forecastsRes.data.forecasts as Record<string, Record<string, { high: number; low: number }>>;
    }
    if (typeof forecastsRes.data.fetchedAt === "string" || forecastsRes.data.fetchedAt === null) {
      snapshot.forecastFetchedAt = forecastsRes.data.fetchedAt;
    }
  }

  if (tempsRes.ok && isRecord(tempsRes.data) && !("error" in tempsRes.data) && isRecord(tempsRes.data.observations)) {
    snapshot.currentTemps = tempsRes.data.observations as Record<string, { tempF: number; ageMinutes: number; stationId: string }>;
  }

  const pairs = getActualPairs(snapshot);
  if (pairs.length === 0) {
    snapshot.actualHighs = {};
  } else {
    const query = pairs.map((pair) => `pair=${encodeURIComponent(pair)}`).join("&");
    const actualsRes = await fetchJson(`${origin}/api/trading/actual-highs?${query}`);
    if (actualsRes.ok && isRecord(actualsRes.data) && !("error" in actualsRes.data) && isRecord(actualsRes.data.actuals)) {
      snapshot.actualHighs = actualsRes.data.actuals;
    }
  }

  snapshot.fetchedAt = new Date().toISOString();
  return snapshot;
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();
  const origin = request.nextUrl.origin;
  let closed = false;
  let snapshot: TradingFloorSnapshot = {};
  let inFlight = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // Ignore enqueue failures for closed streams.
        }
      };

      const poll = async () => {
        if (closed || inFlight) return;
        inFlight = true;
        try {
          snapshot = await nextSnapshot(origin, snapshot);
          send({ type: "snapshot", payload: snapshot, ts: snapshot.fetchedAt });
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error), ts: new Date().toISOString() });
        } finally {
          inFlight = false;
        }
      };

      send({ type: "connected", ts: new Date().toISOString() });
      void poll();

      const pollTimer = setInterval(() => {
        void poll();
      }, SNAPSHOT_INTERVAL_MS);

      const keepAliveTimer = setInterval(() => {
        send({ type: "ping", ts: new Date().toISOString() });
      }, KEEPALIVE_INTERVAL_MS);

      request.signal?.addEventListener("abort", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(keepAliveTimer);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
