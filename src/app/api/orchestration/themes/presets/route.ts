import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { listAvatarThemePresets } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(listAvatarThemePresets());
  } catch (error) {
    return handleRouteError(error, "themes-presets:get");
  }
}
