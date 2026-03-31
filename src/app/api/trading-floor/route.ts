import { NextResponse } from "next/server";

/**
 * Backwards-compatible legacy Trading Floor endpoint.
 * Keeps old clients/monitors from hitting a 404 while the page now reads the
 * split trading APIs directly.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    deprecated: true,
    endpoints: {
      weatherStats: "/api/trading/weather-stats",
      positions: "/api/trading/kalshi-positions",
      portfolio: "/api/trading/kalshi-portfolio",
      forecasts: "/api/trading/live-forecasts",
      currentTemps: "/api/trading/current-temps",
      actuals: "/api/trading/actual-highs",
    },
  });
}
