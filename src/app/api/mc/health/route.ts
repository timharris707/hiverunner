import { NextResponse } from "next/server";

import { getAppBuildMetadata } from "@/lib/app-build-metadata";
import { getRuntimeLaneStatus } from "@/lib/orchestration/runtime-lane-status";

export const dynamic = "force-dynamic";

/**
 * GET /api/mc/health
 *
 * Purpose-built healthcheck endpoint for HiveRunner watchdogs.
 *
 * Design principles:
 * - Lightweight: no external calls
 * - Honest: returns what the server actually knows about itself
 * - Stable: fails loudly when the served bundle cannot safely read the DB
 *
 * Used by:
 * - scripts/healthcheck_dev_service.sh
 * - scripts/healthcheck_stable_service.sh
 * - scripts/doctor.sh
 * - launchd watchdog plist
 *
 * NOT used for comprehensive system health (use /api/health for that).
 */
export async function GET() {
  const appBuild = getAppBuildMetadata();
  const runtime = getRuntimeLaneStatus({
    ...process.env,
    PORT: appBuild.port,
  });

  let migrationCompatibility:
    | {
        ok: boolean;
        dbPath?: string;
        expectedLatestVersion?: number;
        expectedLatestName?: string;
        appliedLatestVersion?: number | null;
        appliedLatestName?: string | null;
        checkedCount?: number;
        pendingCount?: number;
        legacyExtraCount?: number;
        legacyExtra?: Array<{
          version: number;
          name: string;
          reason: string;
          actualChecksum?: string;
        }>;
        incompatibleCount?: number;
        incompatible?: Array<{
          version: number;
          name: string;
          reason: string;
          expectedChecksum?: string;
          actualChecksum?: string;
        }>;
        error?: string;
      }
    | null = null;

  try {
    const [{ default: Database }, orchestrationDb] = await Promise.all([
      import("better-sqlite3"),
      import("@/lib/orchestration/db"),
    ]);
    const dbPath = orchestrationDb.getOrchestrationDbPath();
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const compatibility = orchestrationDb.checkOrchestrationMigrationCompatibility(db);
      migrationCompatibility = {
        ok: compatibility.ok,
        dbPath,
        expectedLatestVersion: compatibility.expectedLatestVersion,
        expectedLatestName: compatibility.expectedLatestName,
        appliedLatestVersion: compatibility.appliedLatestVersion,
        appliedLatestName: compatibility.appliedLatestName,
        checkedCount: compatibility.checkedCount,
        pendingCount: compatibility.pending.length,
        legacyExtraCount: compatibility.legacyExtra.length,
        legacyExtra: compatibility.legacyExtra.map((issue) => ({
          version: issue.version,
          name: issue.name,
          reason: issue.reason,
          actualChecksum: issue.actualChecksum,
        })),
        incompatibleCount: compatibility.incompatible.length,
        incompatible: compatibility.incompatible.map((issue) => ({
          version: issue.version,
          name: issue.name,
          reason: issue.reason,
          expectedChecksum: issue.expectedChecksum,
          actualChecksum: issue.actualChecksum,
        })),
      };
    } finally {
      db.close();
    }
  } catch (error) {
    migrationCompatibility = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const stableMigrationFailure = runtime.mode === "stable" && migrationCompatibility?.ok === false;
  const status = stableMigrationFailure ? "unhealthy" : "ok";

  return NextResponse.json({
    status,
    ts: new Date().toISOString(),
    pid: process.pid,
    mode: runtime.mode,
    port: runtime.port,
    uptime: Math.floor(process.uptime()),
    build: {
      version: appBuild.version,
      versionLabel: appBuild.versionLabel,
      displayLabel: appBuild.displayLabel,
      cwd: process.cwd(),
      buildTag: appBuild.buildTag,
      buildCommit: appBuild.buildCommit,
      buildCommitShort: appBuild.buildCommitShort,
      buildTime: appBuild.buildTime,
      releaseId: appBuild.release.releaseId,
      releaseTag: appBuild.release.releaseTag,
      releaseCommit: appBuild.release.releaseCommit,
      releaseCommitShort: appBuild.release.releaseCommitShort,
      releaseBranch: appBuild.release.releaseBranch,
      releaseReason: appBuild.release.releaseReason,
      promotedAt: appBuild.release.promotedAt,
      promotedBy: appBuild.release.promotedBy,
      repoDirty: appBuild.release.repoDirty,
      gitCommit: appBuild.git.commit,
      gitCommitShort: appBuild.git.commitShort,
      gitBranch: appBuild.git.branch,
      gitDirty: appBuild.git.dirty,
    },
    migrationCompatibility,
    engineTick: runtime.engineTick,
    engineTickSetting: runtime.engineTickSetting,
    requestedEngineTickSetting: runtime.requestedEngineTickSetting,
    engineTickForcedObserver: runtime.engineTickForcedObserver,
    role: runtime.role,
    observerOnly: runtime.observerOnly,
    executionDisabledReason: runtime.executionDisabledReason,
    devExecutionTestModeGate: runtime.devExecutionTestModeGate,
  }, { status: stableMigrationFailure ? 503 : 200 });
}
