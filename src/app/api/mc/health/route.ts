import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

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
type PromotionMetadata = {
  release_id?: string;
  release_tag?: string;
  release_commit?: string;
  release_branch?: string;
  release_reason?: string;
  promoted_at?: string;
  promoted_by?: string;
  repo_dirty?: string;
};

function readPromotionMetadata(): PromotionMetadata | null {
  const metadataPath = path.join(process.cwd(), ".promotion-metadata.json");
  try {
    return JSON.parse(fs.readFileSync(metadataPath, "utf8")) as PromotionMetadata;
  } catch {
    return null;
  }
}

export async function GET() {
  const engineTickSetting = (process.env.MC_ENGINE_TICK || "auto").toLowerCase();
  const isDev = process.env.NODE_ENV !== "production";
  const mode = isDev ? "dev" : "stable";
  const baseEngineTickActive =
    engineTickSetting === "on" ? true :
    engineTickSetting === "off" ? false :
    /* auto */ !isDev;
  const devExecutionTestModeGateEnabled =
    isDev &&
    (process.env.PORT || "3010") === "3010" &&
    (process.env.MC_DEV_EXECUTION_TEST_MODE || "").trim() === "1";
  const engineTickActive = baseEngineTickActive || devExecutionTestModeGateEnabled;
  const release = readPromotionMetadata();

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

  const stableMigrationFailure = mode === "stable" && migrationCompatibility?.ok === false;
  const status = stableMigrationFailure ? "unhealthy" : "ok";

  return NextResponse.json({
    status,
    ts: new Date().toISOString(),
    pid: process.pid,
    mode,
    port: process.env.PORT || "3010",
    uptime: Math.floor(process.uptime()),
    build: {
      cwd: process.cwd(),
      releaseId: release?.release_id ?? null,
      releaseTag: release?.release_tag ?? null,
      releaseCommit: release?.release_commit ?? null,
      releaseBranch: release?.release_branch ?? null,
      releaseReason: release?.release_reason ?? null,
      promotedAt: release?.promoted_at ?? null,
      promotedBy: release?.promoted_by ?? null,
      repoDirty: release?.repo_dirty ?? null,
    },
    migrationCompatibility,
    engineTick: engineTickActive ? "active" : "disabled",
    engineTickSetting,
    role: baseEngineTickActive ? "executor" : "observer",
    devExecutionTestModeGate: devExecutionTestModeGateEnabled ? "enabled" : "disabled",
  }, { status: stableMigrationFailure ? 503 : 200 });
}
