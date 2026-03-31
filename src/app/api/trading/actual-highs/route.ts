import { NextRequest, NextResponse } from "next/server";
import { actualTempKey, fetchActualTempForDate, formatLocalDate, TRADING_STATIONS } from "@/lib/trading-weather";

/**
 * Date-aware actual highs/lows keyed by city + target_date.
 * This fixes the previous rolling-24h bug that leaked the wrong day's readings
 * into settlement displays.
 *
 * Query options:
 *   - repeated ?pair=city|YYYY-MM-DD
 *   - if omitted, returns today's local actuals for all configured cities
 */
export async function GET(request: NextRequest) {
  try {
    const pairParams = request.nextUrl.searchParams.getAll("pair");

    const requestedPairs = pairParams.length > 0
      ? pairParams
          .map((pair) => {
            const [rawCity, targetDate] = pair.split("|");
            const city = (rawCity || "").toLowerCase().trim();
            if (!city || !targetDate || !TRADING_STATIONS[city]) return null;
            return { city, targetDate };
          })
          .filter((pair): pair is { city: string; targetDate: string } => Boolean(pair))
      : Object.entries(TRADING_STATIONS).map(([city, station]) => ({
          city,
          targetDate: formatLocalDate(new Date(), station.timeZone),
        }));

    const deduped = new Map<string, { city: string; targetDate: string }>();
    for (const pair of requestedPairs) {
      deduped.set(actualTempKey(pair.city, pair.targetDate), pair);
    }

    const results = await Promise.allSettled(
      Array.from(deduped.values()).map(async ({ city, targetDate }) => {
        const actual = await fetchActualTempForDate(city, targetDate);
        return { key: actualTempKey(city, targetDate), actual };
      })
    );

    const actuals: Record<string, unknown> = {};
    for (const result of results) {
      if (result.status === "fulfilled" && result.value.actual) {
        actuals[result.value.key] = result.value.actual;
      }
    }

    return NextResponse.json({
      actuals,
      requested: deduped.size,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[trading/actual-highs] Error:", error);
    return NextResponse.json({ actuals: {}, error: String(error) }, { status: 500 });
  }
}
