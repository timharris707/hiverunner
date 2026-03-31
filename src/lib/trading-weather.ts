export interface TradingStationConfig {
  stationId: string;
  name: string;
  timeZone: string;
  lat?: number;
  lon?: number;
}

export const TRADING_STATIONS: Record<string, TradingStationConfig> = {
  new_york: { stationId: "KNYC", name: "New York", timeZone: "America/New_York", lat: 40.78333, lon: -73.96667 },
  chicago: { stationId: "KMDW", name: "Chicago", timeZone: "America/Chicago", lat: 41.78417, lon: -87.75528 },
  los_angeles: { stationId: "KLAX", name: "Los Angeles", timeZone: "America/Los_Angeles", lat: 33.93806, lon: -118.38889 },
  miami: { stationId: "KMIA", name: "Miami", timeZone: "America/New_York", lat: 25.79056, lon: -80.31639 },
  phoenix: { stationId: "KPHX", name: "Phoenix", timeZone: "America/Phoenix", lat: 33.4278, lon: -112.00347 },
  dallas: { stationId: "KDFW", name: "Dallas", timeZone: "America/Chicago", lat: 32.89743, lon: -97.02196 },
  denver: { stationId: "KDEN", name: "Denver", timeZone: "America/Denver", lat: 39.84658, lon: -104.65622 },
  houston: { stationId: "KHOU", name: "Houston", timeZone: "America/Chicago", lat: 29.6375, lon: -95.2825 },
  atlanta: { stationId: "KATL", name: "Atlanta", timeZone: "America/New_York", lat: 33.64028, lon: -84.42694 },
  boston: { stationId: "KBOS", name: "Boston", timeZone: "America/New_York", lat: 42.36056, lon: -71.01056 },
  seattle: { stationId: "KSEA", name: "Seattle", timeZone: "America/Los_Angeles", lat: 47.44472, lon: -122.31361 },
  san_francisco: { stationId: "KSFO", name: "San Francisco", timeZone: "America/Los_Angeles", lat: 37.61961, lon: -122.36558 },
  washington_dc: { stationId: "KDCA", name: "Washington DC", timeZone: "America/New_York", lat: 38.84833, lon: -77.03417 },
  minneapolis: { stationId: "KMSP", name: "Minneapolis", timeZone: "America/Chicago", lat: 44.88306, lon: -93.22889 },
  austin: { stationId: "KAUS", name: "Austin", timeZone: "America/Chicago", lat: 30.18304, lon: -97.67987 },
  oklahoma_city: { stationId: "KOKC", name: "Oklahoma City", timeZone: "America/Chicago", lat: 35.38861, lon: -97.60028 },
  new_orleans: { stationId: "KMSY", name: "New Orleans", timeZone: "America/Chicago", lat: 29.99278, lon: -90.25083 },
  san_antonio: { stationId: "KSAT", name: "San Antonio", timeZone: "America/Chicago", lat: 29.53278, lon: -98.46361 },
};

export interface TradingActualTemp {
  city: string;
  targetDate: string;
  stationId: string;
  timeZone: string;
  high: number;
  highAt: string;
  low: number;
  lowAt: string;
  observations: number;
  complete: boolean;
}

const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  const key = `date:${timeZone}`;
  let formatter = DATE_FORMATTER_CACHE.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    DATE_FORMATTER_CACHE.set(key, formatter);
  }
  return formatter;
}

export function formatLocalDate(date: Date, timeZone: string): string {
  const parts = getDateFormatter(timeZone).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function actualTempKey(city: string, targetDate: string): string {
  return `${city.toLowerCase()}|${targetDate}`;
}

function buildObservationWindow(targetDate: string) {
  const utcMidnight = new Date(`${targetDate}T00:00:00Z`);
  const start = new Date(utcMidnight.getTime() - 12 * 60 * 60 * 1000);
  const end = new Date(utcMidnight.getTime() + 36 * 60 * 60 * 1000);
  return {
    start: start.toISOString().replace(/\.\d+Z$/, "Z"),
    end: end.toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

const actualCache = new Map<string, { value: TradingActualTemp | null; fetchedAt: number }>();
const ACTUAL_CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchActualTempForDate(city: string, targetDate: string): Promise<TradingActualTemp | null> {
  const cityKey = city.toLowerCase();
  const station = TRADING_STATIONS[cityKey];
  if (!station || !targetDate) return null;

  const cacheKey = actualTempKey(cityKey, targetDate);
  const cached = actualCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ACTUAL_CACHE_TTL_MS) {
    return cached.value;
  }

  const { start, end } = buildObservationWindow(targetDate);
  const res = await fetch(
    `https://api.weather.gov/stations/${station.stationId}/observations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=200`,
    {
      headers: { "User-Agent": "WeatherEdge/1.0 (trading@harrisautonomous.com)" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 600 },
    }
  );

  if (!res.ok) {
    actualCache.set(cacheKey, { value: null, fetchedAt: Date.now() });
    return null;
  }

  const json = await res.json();
  const features = Array.isArray(json.features) ? json.features : [];

  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let highAt = "";
  let lowAt = "";
  let observations = 0;

  for (const feature of features) {
    const tempC = feature?.properties?.temperature?.value;
    const timestamp = feature?.properties?.timestamp;
    if (tempC == null || !timestamp) continue;
    if (formatLocalDate(new Date(timestamp), station.timeZone) !== targetDate) continue;

    const tempF = Math.round((((tempC * 9) / 5 + 32) * 10)) / 10;
    observations += 1;

    if (tempF > high) {
      high = tempF;
      highAt = timestamp;
    }
    if (tempF < low) {
      low = tempF;
      lowAt = timestamp;
    }
  }

  if (observations === 0) {
    actualCache.set(cacheKey, { value: null, fetchedAt: Date.now() });
    return null;
  }

  const todayLocal = formatLocalDate(new Date(), station.timeZone);
  const value: TradingActualTemp = {
    city: cityKey,
    targetDate,
    stationId: station.stationId,
    timeZone: station.timeZone,
    high,
    highAt,
    low,
    lowAt,
    observations,
    complete: targetDate < todayLocal,
  };

  actualCache.set(cacheKey, { value, fetchedAt: Date.now() });
  return value;
}
