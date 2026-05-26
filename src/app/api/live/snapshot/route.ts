import { NextResponse } from "next/server";

import { getHiveRunnerRealtimeSnapshot } from "@/lib/realtime-snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getHiveRunnerRealtimeSnapshot());
  } catch (error) {
    console.error("[api/live/snapshot] Error:", error);
    return NextResponse.json({ error: "Failed to build live snapshot" }, { status: 500 });
  }
}
