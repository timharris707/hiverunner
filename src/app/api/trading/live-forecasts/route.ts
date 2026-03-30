import { NextResponse } from "next/server";

const CITIES: Record<string, { lat: number; lon: number; tz: string }> = {
  austin: { lat: 30.27, lon: -97.74, tz: "America/Chicago" },
  miami: { lat: 25.76, lon: -80.19, tz: "America/New_York" },
  new_york: { lat: 40.71, lon: -74.01, tz: "America/New_York" },
  chicago: { lat: 41.88, lon: -87.63, tz: "America/Chicago" },
  denver: { lat: 39.74, lon: -104.99, tz: "America/Denver" },
  seattle: { lat: 47.61, lon: -122.33, tz: "America/Los_Angeles" },
  los_angeles: { lat: 34.05, lon: -118.24, tz: "America/Los_Angeles" },
  phoenix: { lat: 33.45, lon: -112.07, tz: "America/Phoenix" },
  houston: { lat: 29.76, lon: -95.37, tz: "America/Chicago" },
  atlanta: { lat: 33.75, lon: -84.39, tz: "America/New_York" },
  oklahoma_city: { lat: 35.47, lon: -97.52, tz: "America/Chicago" },
  washington_dc: { lat: 38.91, lon: -77.04, tz: "America/New_York" },
  boston: { lat: 42.36, lon: -71.06, tz: "America/New_York" },
  san_antonio: { lat: 29.42, lon: -98.49, tz: "America/Chicago" },
  dallas: { lat: 32.78, lon: -96.80, tz: "America/Chicago" },
  minneapolis: { lat: 44.98, lon: -93.27, tz: "America/Chicago" },
  new_orleans: { lat: 29.95, lon: -90.07, tz: "America/Chicago" },
  san_francisco: { lat: 37.77, lon: -122.42, tz: "America/Los_Angeles" },
};

/**
 * Fetches current high temperature forecasts from Open-Meteo for all cities.
 * Returns { [city]: { [date]: tempF } }
 * Cached for 10 minutes via stale-while-revalidate.
 */

let cache: { data: Record<string, Record<string, number>>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function GET() {
  try {
    // Return cache if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        forecasts: cache.data,
        cached: true,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
      });
    }

    const forecasts: Record<string, Record<string, number>> = {};

    // Batch fetch all cities — both highs and lows
    const entries = Object.entries(CITIES);
    const results = await Promise.allSettled(
      entries.map(async ([city, { lat, lon, tz }]) => {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(tz)}&forecast_days=4`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { city, data: null };
        const json = await res.json();
        const dates: string[] = json.daily?.time ?? [];
        const highs: number[] = json.daily?.temperature_2m_max ?? [];
        const lows: number[] = json.daily?.temperature_2m_min ?? [];
        const byDate: Record<string, { high: number; low: number }> = {};
        for (let i = 0; i < dates.length; i++) {
          byDate[dates[i]] = {
            high: Math.round((highs[i] * 9) / 5 + 32),
            low: Math.round((lows[i] * 9) / 5 + 32),
          };
        }
        return { city, data: byDate };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.data) {
        forecasts[result.value.city] = result.value.data;
      }
    }

    cache = { data: forecasts, fetchedAt: Date.now() };

    return NextResponse.json({
      forecasts,
      cached: false,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[trading/live-forecasts] Error:", error);
    return NextResponse.json({ forecasts: {}, error: String(error) }, { status: 500 });
  }
}
