import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/mc/health
 *
 * Purpose-built healthcheck endpoint for Mission Control watchdogs.
 *
 * Design principles:
 * - Lightweight: no DB queries, no external calls
 * - Honest: returns what the server actually knows about itself
 * - Fast: sub-10ms response target
 * - Stable: no imports that could fail during partial boot
 *
 * Used by:
 * - scripts/healthcheck_dev_service.sh
 * - scripts/healthcheck_stable_service.sh
 * - scripts/doctor.sh
 * - launchd watchdog plist
 *
 * NOT used for comprehensive system health (use /api/health for that).
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    pid: process.pid,
    mode: process.env.NODE_ENV === "production" ? "stable" : "dev",
    port: process.env.PORT || "3000",
    uptime: Math.floor(process.uptime()),
  });
}
