import { NextResponse } from "next/server";

/**
 * Fetches current temperatures from NWS weather stations — the SAME source Kalshi uses
 * for settlement. Each city uses its designated airport weather station.
 */

const STATIONS: Record<string, { stationId: string; name: string }> = {
  new_york: { stationId: "KNYC", name: "New York" },
  chicago: { stationId: "KORD", name: "Chicago" },
  los_angeles: { stationId: "KLAX", name: "Los Angeles" },
  miami: { stationId: "KMIA", name: "Miami" },
  phoenix: { stationId: "KPHX", name: "Phoenix" },
  dallas: { stationId: "KDFW", name: "Dallas" },
  denver: { stationId: "KDEN", name: "Denver" },
  houston: { stationId: "KIAH", name: "Houston" },
  atlanta: { stationId: "KATL", name: "Atlanta" },
  boston: { stationId: "KBOS", name: "Boston" },
  seattle: { stationId: "KSEA", name: "Seattle" },
  san_francisco: { stationId: "KSFO", name: "San Francisco" },
  washington_dc: { stationId: "KDCA", name: "Washington DC" },
  minneapolis: { stationId: "KMSP", name: "Minneapolis" },
  austin: { stationId: "KAUS", name: "Austin" },
  oklahoma_city: { stationId: "KOKC", name: "Oklahoma City" },
  new_orleans: { stationId: "KMSY", name: "New Orleans" },
  san_antonio: { stationId: "KSAT", name: "San Antonio" },
};

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
      // Recompute ageMinutes on each request
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

    // Fetch all stations in parallel
    const entries = Object.entries(STATIONS);
    const results = await Promise.allSettled(
      entries.map(async ([city, { stationId }]) => {
        try {
          const res = await fetch(
            `https://api.weather.gov/stations/${stationId}/observations/latest`,
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
            obs: { tempF, observedAt, stationId, ageMinutes } as StationObs,
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
