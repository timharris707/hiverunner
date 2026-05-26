import { NextResponse } from "next/server";
import { getDashboardHighlights } from "@/lib/dashboard-highlights";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(getDashboardHighlights());
  } catch (err) {
    console.error("Dashboard highlights error:", err);
    return NextResponse.json({ todayTasks: [], nextCron: null, providers: [] });
  }
}
