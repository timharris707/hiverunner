/**
 * GET /api/health
 *
 * Operator-facing platform health. This route used to check Linux systemd and
 * PM2 services that are not part of the current macOS launchd deployment,
 * which made a healthy HiveRunner lane look degraded. Keep this endpoint
 * focused on cheap local dependencies the app actually uses.
 */
import { NextResponse } from "next/server";

type ServiceStatus = "up" | "down" | "degraded" | "unknown";

interface ServiceCheck {
  name: string;
  status: ServiceStatus;
  latency?: number;
  details?: string;
  critical: boolean;
}

function checkProcess(): ServiceCheck {
  return {
    name: "HiveRunner process",
    status: "up",
    details: `pid ${process.pid}; uptime ${Math.floor(process.uptime())}s`,
    critical: true,
  };
}

async function checkOrchestrationDb(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const [{ default: Database }, orchestrationDb] = await Promise.all([
      import("better-sqlite3"),
      import("@/lib/orchestration/db"),
    ]);
    const dbPath = orchestrationDb.getOrchestrationDbPath();
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const compatibility = orchestrationDb.checkOrchestrationMigrationCompatibility(db);
      const latency = Date.now() - start;
      if (!compatibility.ok) {
        return {
          name: "Orchestration DB",
          status: "degraded",
          latency,
          details: `migration compatibility issue; pending ${compatibility.pending.length}, incompatible ${compatibility.incompatible.length}`,
          critical: true,
        };
      }
      return {
        name: "Orchestration DB",
        status: "up",
        latency,
        details: `schema v${compatibility.appliedLatestVersion ?? "unknown"} readable`,
        critical: true,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      name: "Orchestration DB",
      status: "down",
      latency: Date.now() - start,
      details: error instanceof Error ? error.message : String(error),
      critical: true,
    };
  }
}

function overallStatus(checks: ServiceCheck[]): "healthy" | "degraded" | "critical" {
  const criticalChecks = checks.filter((check) => check.critical);
  const criticalDown = criticalChecks.filter((check) => check.status === "down").length;
  const criticalDegraded = criticalChecks.filter((check) => check.status === "degraded").length;
  if (criticalDown > 0) return "critical";
  if (criticalDegraded > 0) return "degraded";
  return "healthy";
}

export async function GET() {
  const checks = await Promise.all([
    Promise.resolve(checkProcess()),
    checkOrchestrationDb(),
  ]);

  return NextResponse.json({
    status: overallStatus(checks),
    checks,
    externalProviderChecks: "disabled",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
