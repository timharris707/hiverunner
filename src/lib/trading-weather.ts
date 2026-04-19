export interface TradingStationConfig {
  stationId: string;
  name: string;
  timeZone: string;
  lat: number;
  lon: number;
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
  source?: "cli" | "observations";
}

const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();
const actualCache = new Map<string, { value: TradingActualTemp | null; fetchedAt: number }>();
const ACTUAL_CACHE_TTL_MS = 10 * 60 * 1000;

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

function buildObservationChunks(targetDate: string) {
  const utcMidnight = new Date(`${targetDate}T00:00:00Z`);
  const windowStart = utcMidnight.getTime() - 12 * 60 * 60 * 1000;
  const windowEnd = utcMidnight.getTime() + 36 * 60 * 60 * 1000;
  const chunkMs = 6 * 60 * 60 * 1000; // 6-hour chunks
  const chunks: { start: string; end: string }[] = [];
  for (let t = windowStart; t < windowEnd; t += chunkMs) {
    chunks.push({
      start: new Date(t).toISOString().replace(/\.\d+Z$/, "Z"),
      end: new Date(Math.min(t + chunkMs, windowEnd)).toISOString().replace(/\.\d+Z$/, "Z"),
    });
  }
  return chunks;
}

function getCliLocationCode(stationId: string): string {
  return stationId.replace(/^K/, "");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCliNumber(productText: string, label: "MAXIMUM" | "MINIMUM"): number | null {
  const re = new RegExp(`\\b${escapeRegex(label)}\\s+(-?\\d+(?:\\.\\d+)?)`, "i");
  const match = productText.match(re);
  return match ? Number(match[1]) : null;
}

async function fetchCliActualTempForDate(cityKey: string, targetDate: string, station: TradingStationConfig): Promise<TradingActualTemp | null> {
  const locationCode = getCliLocationCode(station.stationId);
  const listRes = await fetch(
    `https://api.weather.gov/products/types/CLI/locations/${locationCode}`,
    {
      headers: { "User-Agent": "WeatherEdge/1.0 (trading@harrisautonomous.com)" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 600 },
    }
  );

  if (!listRes.ok) return null;

  const listJson = await listRes.json();
  const products = Array.isArray(listJson?.["@graph"]) ? listJson["@graph"] : [];
  const matchingProduct = products.find((item: Record<string, unknown>) => {
    const issuanceTime = typeof item.issuanceTime === "string" ? item.issuanceTime : null;
    return issuanceTime && formatLocalDate(new Date(issuanceTime), station.timeZone) === targetDate;
  });

  if (!matchingProduct?.id) return null;

  const productRes = await fetch(`https://api.weather.gov/products/${matchingProduct.id}`, {
    headers: { "User-Agent": "WeatherEdge/1.0 (trading@harrisautonomous.com)" },
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 600 },
  });

  if (!productRes.ok) return null;

  const productJson = await productRes.json();
  const productText = typeof productJson?.productText === "string" ? productJson.productText : "";
  const high = parseCliNumber(productText, "MAXIMUM");
  const low = parseCliNumber(productText, "MINIMUM");

  if (high == null || low == null) return null;

  const issuanceTime = typeof matchingProduct.issuanceTime === "string" ? matchingProduct.issuanceTime : new Date().toISOString();

  return {
    city: cityKey,
    targetDate,
    stationId: station.stationId,
    timeZone: station.timeZone,
    high,
    highAt: issuanceTime,
    low,
    lowAt: issuanceTime,
    observations: 1,
    complete: true,
    source: "cli",
  };
}

async function fetchObservationActualTempForDate(cityKey: string, targetDate: string, station: TradingStationConfig): Promise<TradingActualTemp | null> {
  const chunks = buildObservationChunks(targetDate);

  // Fetch all chunks in parallel — each 6-hour window stays well under any per-request limit
  const chunkResults = await Promise.all(
    chunks.map(async ({ start, end }) => {
      try {
        const res = await fetch(
          `https://api.weather.gov/stations/${station.stationId}/observations?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
          {
            headers: { "User-Agent": "WeatherEdge/1.0 (trading@harrisautonomous.com)" },
            signal: AbortSignal.timeout(8000),
            next: { revalidate: 600 },
          }
        );
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json.features) ? json.features : [];
      } catch {
        return [];
      }
    })
  );

  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let highAt = "";
  let lowAt = "";
  let observations = 0;

  for (const features of chunkResults) {
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
  }

  if (observations === 0) return null;

  const todayLocal = formatLocalDate(new Date(), station.timeZone);
  return {
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
    source: "observations",
  };
}

export async function fetchActualTempForDate(city: string, targetDate: string): Promise<TradingActualTemp | null> {
  const cityKey = city.toLowerCase();
  const station = TRADING_STATIONS[cityKey];
  if (!station || !targetDate) return null;

  const cacheKey = actualTempKey(cityKey, targetDate);
  const cached = actualCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ACTUAL_CACHE_TTL_MS) {
    return cached.value;
  }

  const todayLocal = formatLocalDate(new Date(), station.timeZone);
  let value: TradingActualTemp | null = null;

  if (targetDate < todayLocal) {
    value = await fetchCliActualTempForDate(cityKey, targetDate, station);
    if (!value) {
      value = await fetchObservationActualTempForDate(cityKey, targetDate, station);
      if (value) value.complete = true;
    }
  } else {
    value = await fetchObservationActualTempForDate(cityKey, targetDate, station);
  }

  actualCache.set(cacheKey, { value, fetchedAt: Date.now() });
  return value;
}
