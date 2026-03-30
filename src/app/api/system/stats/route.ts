import { NextResponse } from "next/server";
import { getSystemStats } from "@/lib/system-stats";

export async function GET() {
  try {
    return NextResponse.json(await getSystemStats());
  } catch (error) {
    console.error("Error fetching system stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch system stats" },
      { status: 500 }
    );
  }
}
