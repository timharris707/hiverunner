#!/usr/bin/env npx tsx
/**
 * repair-passive-report-history.ts
 *
 * Cleans historical passive-report loop noise from the orchestration DB:
 * - exact openclaw NO_REPLY placeholder comments tied to zero-action heartbeat runs
 * - matching task.comment_added events created by engine heartbeat imports
 * - stale continuation_passive_report_only wake rows (failed/finished, plus stale queued/claimed rows with no running heartbeat)
 * - historical heartbeat_run_events that only recorded the bad continuation enqueue
 * - stale queued heartbeat_runs linked to stale passive continuation wake rows
 *
 * Usage:
 *   npx tsx scripts/repair-passive-report-history.ts
 *   npx tsx scripts/repair-passive-report-history.ts --apply
 *   npx tsx scripts/repair-passive-report-history.ts --db /path/to/orchestration.db --backup-dir /tmp/repairs
 */

import Database from "better-sqlite3";
import path from "node:path";

import { resolveHiveRunnerDataDir } from "../src/lib/runtime-paths";
import {
  inspectPassiveReportHistory,
  repairPassiveReportHistory,
} from "../src/lib/orchestration/repairs/passive-report-history";

function parseArgs(argv: string[]) {
  let dbPath = process.env.ORCHESTRATION_DB_PATH
    ?? path.join(resolveHiveRunnerDataDir(process.env), "orchestration.db");
  let backupDir = path.join(process.cwd(), "tmp", "repairs", "passive-report-history");
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--db") {
      dbPath = argv[index + 1] ?? dbPath;
      index += 1;
      continue;
    }
    if (arg === "--backup-dir") {
      backupDir = argv[index + 1] ?? backupDir;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  npx tsx scripts/repair-passive-report-history.ts [--apply] [--db PATH] [--backup-dir PATH]",
        "",
        "Default mode is dry-run. Pass --apply to mutate the database.",
      ].join("\n"));
      process.exit(0);
    }
  }

  return { dbPath, backupDir, apply };
}

function printSummary(prefix: string, summary: ReturnType<typeof inspectPassiveReportHistory>) {
  console.log(prefix);
  console.log(`  NO_REPLY comments: ${summary.noReplyComments.length}`);
  console.log(`  matching task.comment_added events: ${summary.noReplyTaskEvents.length}`);
  console.log(`  passive continuation wake rows: ${summary.passiveContinuationWakeRows.length}`);
  console.log(`  queued-passive heartbeat events: ${summary.passiveContinuationHeartbeatEvents.length}`);
  console.log(`  stale queued passive heartbeat runs: ${summary.stalePassiveContinuationHeartbeatRuns.length}`);
}

async function main() {
  const { dbPath, backupDir, apply } = parseArgs(process.argv.slice(2));
  const db = new Database(dbPath);

  try {
    const inspection = inspectPassiveReportHistory(db);
    console.log(`DB: ${dbPath}`);
    console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
    console.log(`Backup dir: ${backupDir}`);
    printSummary("Current passive-report noise:", inspection);

    const result = repairPassiveReportHistory({
      db,
      backupDir,
      apply,
    });

    if (!apply) {
      console.log("\nDry-run only. Re-run with --apply to perform the cleanup.");
      return;
    }

    console.log("\nRepair applied.");
    console.log(`Backup artifact: ${result.backupPath}`);
    const post = inspectPassiveReportHistory(db);
    printSummary("Remaining passive-report noise:", post);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error("repair-passive-report-history failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
