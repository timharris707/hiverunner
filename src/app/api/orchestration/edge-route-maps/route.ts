import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { buildEdgeRouteMaps } from "@/lib/orchestration/edge-route-map-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(buildEdgeRouteMaps(), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    return handleRouteError(error, "edge-route-maps:get");
  }
}
