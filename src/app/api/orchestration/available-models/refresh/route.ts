import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { refreshAllAvailableModels } from "@/lib/orchestration/model-catalog-fetcher";
import { listAvailableModelRefreshStatuses } from "@/lib/orchestration/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ statuses: listAvailableModelRefreshStatuses() });
  } catch (error) {
    return handleRouteError(error, "available-models-refresh:list");
  }
}

export async function POST() {
  try {
    return NextResponse.json({ statuses: await refreshAllAvailableModels() });
  } catch (error) {
    return handleRouteError(error, "available-models-refresh:run");
  }
}
