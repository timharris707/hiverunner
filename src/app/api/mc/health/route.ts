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
  const engineTickSetting = (process.env.MC_ENGINE_TICK || "auto").toLowerCase();
  const isDev = process.env.NODE_ENV !== "production";
  const baseEngineTickActive =
    engineTickSetting === "on" ? true :
    engineTickSetting === "off" ? false :
    /* auto */ !isDev;
  const devExecutionTestModeGateEnabled =
    isDev &&
    (process.env.PORT || "3010") === "3010" &&
    (process.env.MC_DEV_EXECUTION_TEST_MODE || "").trim() === "1";
  const engineTickActive = baseEngineTickActive || devExecutionTestModeGateEnabled;

  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    pid: process.pid,
    mode: isDev ? "dev" : "stable",
    port: process.env.PORT || "3010",
    uptime: Math.floor(process.uptime()),
    engineTick: engineTickActive ? "active" : "disabled",
    engineTickSetting,
    role: baseEngineTickActive ? "executor" : "observer",
    devExecutionTestModeGate: devExecutionTestModeGateEnabled ? "enabled" : "disabled",
  });
}
