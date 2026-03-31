import { NextResponse } from "next/server";
import { TRADING_STATIONS } from "@/lib/trading-weather";

// Coordinates match exact NWS/Kalshi settlement station locations.
// Do NOT use generic city-center coordinates.
const CITIES = Object.fromEntries(
  Object.entries(TRADING_STATIONS).map(([city, station]) => [
    city,
    { lat: station.lat!, lon: station.lon!, tz: station.timeZone },
  ])
) as Record<string, { lat: number; lon: number; tz: string }>;

let cache: { data: Record<string, Record<string, { high: number; low: number }>>; fetchedAt: number; currentTemps: Record<string, number> } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET() {
  try {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        forecasts: cache.data,
        currentTemps: cache.currentTemps,
        cached: true,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
      });
    }

    const forecasts: Record<string, Record<string, { high: number; low: number }>> = {};
    const entries = Object.entries(CITIES);
    const results = await Promise.allSettled(
      entries.map(async ([city, { lat, lon, tz }]) => {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&current=temperature_2m&timezone=${encodeURIComponent(tz)}&forecast_days=4`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { city, data: null };
        const json = await res.json();
        const dates: string[] = json.daily?.time ?? [];
        const highs: number[] = json.daily?.temperature_2m_max ?? [];
        const lows: number[] = json.daily?.temperature_2m_min ?? [];
        const currentC = json.current?.temperature_2m;
        const currentF = currentC != null ? Math.round((currentC * 9) / 5 + 32) : null;
        const byDate: Record<string, { high: number; low: number }> = {};
        for (let i = 0; i < dates.length; i++) {
          byDate[dates[i]] = {
            high: Math.round((highs[i] * 9) / 5 + 32),
            low: Math.round((lows[i] * 9) / 5 + 32),
          };
        }
        return { city, data: byDate, currentTemp: currentF };
      })
    );

    const currentTemps: Record<string, number> = {};
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.data) {
        forecasts[result.value.city] = result.value.data;
        if (result.value.currentTemp != null) {
          currentTemps[result.value.city] = result.value.currentTemp;
        }
      }
    }

    cache = { data: forecasts, fetchedAt: Date.now(), currentTemps };

    return NextResponse.json({
      forecasts,
      currentTemps,
      cached: false,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[trading/live-forecasts] Error:", error);
    return NextResponse.json({ forecasts: {}, error: String(error) }, { status: 500 });
  }
}
