import { NextResponse } from "next/server";

// Coordinates match exact NWS station locations (same source Kalshi uses for settlement)
// DO NOT use generic city-center coordinates — must match the weather station
const CITIES: Record<string, { lat: number; lon: number; tz: string }> = {
  atlanta: { lat: 33.64028, lon: -84.42694, tz: "America/New_York" },        // KATL
  austin: { lat: 30.18304, lon: -97.67987, tz: "America/Chicago" },          // KAUS
  boston: { lat: 42.36056, lon: -71.01056, tz: "America/New_York" },          // KBOS
  chicago: { lat: 41.78417, lon: -87.75528, tz: "America/Chicago" },         // KMDW Midway (Kalshi uses Midway)
  dallas: { lat: 32.89743, lon: -97.02196, tz: "America/Chicago" },          // KDFW
  denver: { lat: 39.84658, lon: -104.65622, tz: "America/Denver" },          // KDEN
  houston: { lat: 29.6375, lon: -95.2825, tz: "America/Chicago" },           // KHOU Hobby (Kalshi uses Hobby)
  los_angeles: { lat: 33.93806, lon: -118.38889, tz: "America/Los_Angeles" },// KLAX
  miami: { lat: 25.79056, lon: -80.31639, tz: "America/New_York" },          // KMIA
  minneapolis: { lat: 44.88306, lon: -93.22889, tz: "America/Chicago" },     // KMSP
  new_orleans: { lat: 29.99278, lon: -90.25083, tz: "America/Chicago" },     // KMSY
  new_york: { lat: 40.78333, lon: -73.96667, tz: "America/New_York" },       // KNYC (Central Park)
  oklahoma_city: { lat: 35.38861, lon: -97.60028, tz: "America/Chicago" },   // KOKC
  phoenix: { lat: 33.4278, lon: -112.00347, tz: "America/Phoenix" },         // KPHX
  san_antonio: { lat: 29.53278, lon: -98.46361, tz: "America/Chicago" },     // KSAT
  san_francisco: { lat: 37.61961, lon: -122.36558, tz: "America/Los_Angeles" },// KSFO
  seattle: { lat: 47.44472, lon: -122.31361, tz: "America/Los_Angeles" },    // KSEA
  washington_dc: { lat: 38.84833, lon: -77.03417, tz: "America/New_York" },  // KDCA
};

/**
 * Fetches current high temperature forecasts from Open-Meteo for all cities.
 * Returns { [city]: { [date]: tempF } }
 * Cached for 10 minutes via stale-while-revalidate.
 */

let cache: { data: Record<string, Record<string, number>>; fetchedAt: number; currentTemps: Record<string, number> } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function GET() {
  try {
    // Return cache if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({
        forecasts: cache.data,
        currentTemps: cache.currentTemps,
        cached: true,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
      });
    }

    const forecasts: Record<string, Record<string, number>> = {};

    // Batch fetch all cities — both highs and lows
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
