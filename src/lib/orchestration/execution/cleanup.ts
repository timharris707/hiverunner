import fs from "fs";
import os from "os";
import path from "path";
import type Database from "better-sqlite3";

/**
 * Delete all temp files in os.tmpdir() that were created for a specific
 * execution run. Files must be named hiverunner-{runId}-*.
 * Errors per file are logged at warn level and never thrown.
 */
export async function cleanupRunArtifacts(runId: string): Promise<void> {
  const tmpDir = os.tmpdir();
  let entries: string[];
  try {
    entries = fs.readdirSync(tmpDir);
  } catch (err) {
    console.warn(`[cleanup] Cannot read tmpdir for run ${runId}:`, err);
    return;
  }
  const prefix = `hiverunner-${runId}-`;
  for (const entry of entries) {
    if (!entry.startsWith(prefix)) continue;
    const filePath = path.join(tmpDir, entry);
    try {
      fs.unlinkSync(filePath);
      console.debug(`[cleanup] Deleted run artifact: ${filePath}`);
    } catch (err) {
      console.warn(`[cleanup] Failed to delete run artifact ${filePath}:`, err);
    }
  }
}

/**
 * Periodic orphan GC: find execution_runs with a terminal status whose
 * completed_at is older than 24 hours, and run cleanupRunArtifacts for each.
 * Capped at 50 runs per call to avoid blocking the engine tick.
 */
export async function cleanupOrphanedRunArtifacts(
  db: Database.Database
): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(
      `SELECT id FROM execution_runs
       WHERE status IN ('completed', 'failed', 'cancelled')
         AND completed_at < ?
       ORDER BY completed_at ASC
       LIMIT 50`
    )
    .all(cutoff) as Array<{ id: string }>;

  if (rows.length === 0) {
    return 0;
  }

  const tmpDir = os.tmpdir();
  let entries: string[];
  try {
    entries = fs.readdirSync(tmpDir);
  } catch (err) {
    console.warn("[cleanup] Cannot read tmpdir for orphan run cleanup:", err);
    return 0;
  }

  for (const entry of entries) {
    if (!entry.startsWith("hiverunner-")) continue;
    if (!rows.some((row) => entry.startsWith(`hiverunner-${row.id}-`))) continue;
    const filePath = path.join(tmpDir, entry);
    try {
      fs.unlinkSync(filePath);
      console.debug(`[cleanup] Deleted orphan run artifact: ${filePath}`);
    } catch (err) {
      console.warn(`[cleanup] Failed to delete orphan run artifact ${filePath}:`, err);
    }
  }
  return rows.length;
}
