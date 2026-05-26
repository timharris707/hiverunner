import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/dashboard-stats";

export const dynamic = "force-dynamic";

const EMPTY_METRICS = {
  activeAgents: {
    label: "Active Agents",
    subtitle: "Unavailable",
    definition: "Live agent status is unavailable.",
    source: "unavailable",
    timeRange: "unavailable",
    verification: "The dashboard stats endpoint failed before metrics could be verified.",
  },
  tasksToday: {
    label: "Task Log Entries",
    subtitle: "Unavailable",
    definition: "Task log metrics are unavailable.",
    source: "unavailable",
    timeRange: "unavailable",
    verification: "The dashboard stats endpoint failed before metrics could be verified.",
  },
  activeSessions: {
    label: "Sessions Updated",
    subtitle: "Unavailable",
    definition: "Session metrics are unavailable.",
    source: "unavailable",
    timeRange: "unavailable",
    verification: "The dashboard stats endpoint failed before metrics could be verified.",
  },
  costToday: {
    label: "Approved Spend",
    subtitle: "Unavailable",
    definition: "Spend metrics are unavailable.",
    source: "unavailable",
    timeRange: "unavailable",
    verification: "The dashboard stats endpoint failed before metrics could be verified.",
  },
};

export async function GET() {
  try {
    return NextResponse.json(getDashboardStats());
  } catch (error) {
    console.error("[dashboard/stats] Error:", error);
    return NextResponse.json(
      {
        activeSessions: 0,
        totalSessions: 0,
        tasksToday: 0,
        costToday: 0,
        costByAgentToday: [],
        activeAgents: 0,
        metrics: EMPTY_METRICS,
      },
      { status: 500 }
    );
  }
}
