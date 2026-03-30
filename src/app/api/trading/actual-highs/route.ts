import { NextResponse } from "next/server";

/**
 * Fetches today's actual recorded high and low temperatures from NWS stations.
 * Computes max/min from the last 24 hours of observations.
 * This is the SAME source Kalshi uses for settlement.
 */

const STATIONS: Record<string, string> = {
  new_york: "KNYC", chicago: "KORD", los_angeles: "KLAX", miami: "KMIA",
  phoenix: "KPHX", dallas: "KDFW", denver: "KDEN", houston: "KIAH",
  atlanta: "KATL", boston: "KBOS", seattle: "KSEA", san_francisco: "KSFO",
  washington_dc: "KDCA", minneapolis: "KMSP", austin: "KAUS",
  oklahoma_city: "KOKC", new_orleans: "KMSY", san_antonio: "KSAT",
};

interface ActualTemp {
  high: number;
  highAt: string;
  low: number;
  lowAt: string;
  observations: number;
}

let cache: { data: Record<string, ActualTemp>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function GET() {
  try {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({ actuals: cache.data, cached: true, fetchedAt: new Date(cache.fetchedAt).toISOString() });
    }

    const actuals: Record<string, ActualTemp> = {};
    const now = new Date();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");

    const entries = Object.entries(STATIONS);
    const results = await Promise.allSettled(
      entries.map(async ([city, stationId]) => {
        try {
          const res = await fetch(
            `https://api.weather.gov/stations/${stationId}/observations?start=${start}&limit=48`,
            {
              headers: { "User-Agent": "WeatherEdge/1.0 (trading@harrisautonomous.com)" },
              signal: AbortSignal.timeout(8000),
            }
          );
          if (!res.ok) return { city, data: null };
          const json = await res.json();
          const features = json.features || [];

          let high = -999, highAt = "";
          let low = 999, lowAt = "";
          let count = 0;

          for (const f of features) {
            const tempC = f.properties?.temperature?.value;
            const ts = f.properties?.timestamp || "";
            if (tempC == null) continue;
            const tempF = Math.round(((tempC * 9) / 5 + 32) * 10) / 10;
            count++;
            if (tempF > high) { high = tempF; highAt = ts; }
            if (tempF < low) { low = tempF; lowAt = ts; }
          }

          if (count === 0) return { city, data: null };
          return { city, data: { high, highAt, low, lowAt, observations: count } as ActualTemp };
        } catch {
          return { city, data: null };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.data) {
        actuals[result.value.city] = result.value.data;
      }
    }

    cache = { data: actuals, fetchedAt: Date.now() };
    return NextResponse.json({ actuals, cached: false, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[trading/actual-highs] Error:", error);
    return NextResponse.json({ actuals: {}, error: String(error) }, { status: 500 });
  }
}
