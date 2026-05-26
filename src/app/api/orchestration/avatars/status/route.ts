import { NextResponse } from "next/server";

import { handleRouteError } from "@/lib/orchestration/api";
import { detectAvatarProvider } from "@/lib/orchestration/avatar-provider";

export const dynamic = "force-dynamic";

/**
 * GET /api/orchestration/avatars/status
 *
 * Returns the current avatar generation provider status.
 * The wizard uses this to show appropriate UI:
 *   - If aiAvailable=true: show "AI-Generated Avatar" option with full confidence
 *   - If aiAvailable=false: show "Styled Avatar" with note that it's local SVG,
 *     and include setupHint for how to enable AI
 */
export async function GET() {
  try {
    const status = detectAvatarProvider();
    return NextResponse.json(status);
  } catch (error) {
    return handleRouteError(error, "avatar-status:get");
  }
}
