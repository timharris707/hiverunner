import { NextResponse } from "next/server";
import { TRADING_STATIONS } from "@/lib/trading-weather";

/**
 * Fetches current temperatures from NWS weather stations — the SAME source Kalshi uses
 * for settlement. Each city uses its designated weather station.
 */

interface StationObs {
  tempF: number;
  observedAt: string;
  stationId: string;
  ageMinutes: number;
}

let cache: { data: Record<string, StationObs>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (NWS updates every ~5-10 min)

export async function GET() {
  try {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      const now = Date.now();
      const updated: Record<string, StationObs> = {};
      for (const [city, obs] of Object.entries(cache.data)) {
        const obsTime = new Date(obs.observedAt).getTime();
        updated[city] = { ...obs, ageMinutes: Math.floor((now - obsTime) / 60000) };
      }
      return NextResponse.json({
        observations: updated,
        cached: true,
        fetchedAt: new Date(cache.fetchedAt).toISOString(),
      });
    }

    const observations: Record<string, StationObs> = {};
    const now = Date.now();
    const entries = Object.entries(TRADING_STATIONS);

    const results = await Promise.allSettled(
      entries.map(async ([city, station]) => {
        try {
          const res = await fetch(
            `https://api.weather.gov/stations/${station.stationId}/observations/latest`,
            {
              headers: { "User-Agent": "WeatherEdge/1.0 (trading@harrisautonomous.com)" },
              signal: AbortSignal.timeout(5000),
            }
          );
          if (!res.ok) return { city, obs: null };
          const json = await res.json();
          const props = json.properties || {};
          const tempC = props.temperature?.value;
          if (tempC == null) return { city, obs: null };
          const tempF = Math.round((tempC * 9) / 5 + 32);
          const observedAt = props.timestamp || "";
          const obsTime = new Date(observedAt).getTime();
          const ageMinutes = Math.floor((now - obsTime) / 60000);
          return {
            city,
            obs: { tempF, observedAt, stationId: station.stationId, ageMinutes } as StationObs,
          };
        } catch {
          return { city, obs: null };
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.obs) {
        observations[result.value.city] = result.value.obs;
      }
    }

    cache = { data: observations, fetchedAt: now };

    return NextResponse.json({
      observations,
      cached: false,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[trading/current-temps] Error:", error);
    return NextResponse.json({ observations: {}, error: String(error) }, { status: 500 });
  }
}
