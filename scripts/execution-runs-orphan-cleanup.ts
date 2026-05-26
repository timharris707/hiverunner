import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const APPLY = process.argv.includes("--apply");
const ANCHOR_PROJECT_ID = "system-execution-run-cleanup-project";
const ANCHOR_TASK_ID = "system-execution-run-cleanup-task";
const INACTIVE_TASK_STATUSES = ["done", "cancelled", "blocked", "backlog", "to-do"];

type ExecutionRunRow = {
  id: string;
  task_id: string | null;
  status: string;
  completed_at: string | null;
  error_message: string | null;
  failure_class: string | null;
  process_pid: number | null;
  updated_at: string;
  created_at: string;
};

function sqlString(value: string | null): string {
  if (value === null) return "NULL";
  return `'${value.replace(/'/g, "''")}'`;
}

function resolveDbPath(): string {
  return path.resolve(
    process.env.ORCHESTRATION_DB_PATH || path.join(process.cwd(), "data-dev", "orchestration.db")
  );
}

function ensureAnchorTask(db: Database.Database, reverseSql: string[], now: string): void {
  const existingProject = db.prepare("SELECT id FROM projects WHERE id = ? LIMIT 1").get(ANCHOR_PROJECT_ID) as
    | { id: string }
    | undefined;
  if (!existingProject) {
    reverseSql.push(`DELETE FROM projects WHERE id = '${ANCHOR_PROJECT_ID}';`);
    db.prepare(
      `INSERT INTO projects
        (id, slug, name, description, color, status, owner_user_id, settings_json, created_at, updated_at, archived_at, company_id)
       VALUES (?, ?, ?, ?, ?, 'archived', NULL, '{}', ?, ?, ?, (SELECT id FROM companies ORDER BY created_at ASC LIMIT 1))`
    ).run(
      ANCHOR_PROJECT_ID,
      "system-execution-run-cleanup",
      "System execution run cleanup",
      "Archived anchor project for historical execution runs that were created without a task.",
      "#78716c",
      now,
      now,
      now
    );
  }

  const existingTask = db.prepare("SELECT id FROM tasks WHERE id = ? LIMIT 1").get(ANCHOR_TASK_ID) as
    | { id: string }
    | undefined;
  if (!existingTask) {
    reverseSql.push(`DELETE FROM tasks WHERE id = '${ANCHOR_TASK_ID}';`);
    db.prepare(
      `INSERT INTO tasks
        (id, project_id, title, description, priority, type, status, column_order, assignee_agent_id, assigned_at, created_by, labels_json, depends_on_json, started_at, completed_at, review_notes, blocked_reason, execution_mode, execution_session_id, created_at, updated_at, archived_at, source_review_id, source_takeaway_id, attachments_json, sequence_number, task_number, task_key, consecutive_noop_wakes, artifact_uri, artifact_kind, artifact_registered_at, artifact_sha256, company_id, due_date, execution_engine, model_lane, execution_runtime_provider, execution_runtime_label, execution_model_routing, execution_model_routing_label)
       SELECT ?, p.id, ?, ?, 'medium', 'infrastructure', 'backlog', 0, NULL, NULL, 'system', ?, '[]', NULL, NULL, NULL, NULL, 'manual', NULL, ?, ?, ?, NULL, NULL, '[]', NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, p.company_id, NULL, 'manual', 'default', NULL, NULL, NULL, NULL
       FROM projects p
       WHERE p.id = ?`
    ).run(
      ANCHOR_TASK_ID,
      "Archived execution run cleanup anchor",
      "System anchor used to preserve historical execution_run rows that were originally written without task_id.",
      JSON.stringify(["cleanup", "execution_runs"]),
      now,
      now,
      now,
      ANCHOR_PROJECT_ID
    );
  }
}

function main() {
  const dbPath = resolveDbPath();
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const orphanRuns = db
    .prepare(
      `SELECT id, task_id, status, completed_at, error_message, failure_class, process_pid, updated_at, created_at
       FROM execution_runs
       WHERE task_id IS NULL
       ORDER BY created_at ASC`
    )
    .all() as ExecutionRunRow[];

  const staleRuns = db
    .prepare(
      `SELECT er.id, er.task_id, er.status, er.completed_at, er.error_message, er.failure_class, er.process_pid, er.updated_at, er.created_at
       FROM execution_runs er
       INNER JOIN tasks t ON t.id = er.task_id
       WHERE er.status = 'running'
         AND t.status IN (${INACTIVE_TASK_STATUSES.map(() => "?").join(",")})
       ORDER BY er.created_at ASC`
    )
    .all(...INACTIVE_TASK_STATUSES) as ExecutionRunRow[];

  console.log(`[Execution runs cleanup] mode=${APPLY ? "apply" : "dry-run"}`);
  console.log(`DB: ${dbPath}`);
  console.log(`Taskless execution_runs: ${orphanRuns.length}`);
  for (const run of orphanRuns) {
    console.log(`- orphan ${run.id} created=${run.created_at} status=${run.status}`);
  }
  console.log(`Running runs on inactive tasks: ${staleRuns.length}`);
  for (const run of staleRuns) {
    console.log(`- stale ${run.id} task=${run.task_id} created=${run.created_at}`);
  }

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to update the dev DB.");
    db.close();
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupDir = path.join(process.cwd(), "output", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `execution-runs-orphan-cleanup-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);

  const reverseSql: string[] = [
    "-- Reverse SQL for scripts/execution-runs-orphan-cleanup.ts",
    "-- Prefer restoring the backup DB. These statements reverse only execution_run row edits and anchor inserts.",
    `-- Backup: ${backupPath}`,
    "BEGIN;",
  ];

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (orphanRuns.length > 0) {
      ensureAnchorTask(db, reverseSql, now);
    }

    for (const run of orphanRuns) {
      reverseSql.push(
        `UPDATE execution_runs SET task_id = NULL, status = ${sqlString(run.status)}, completed_at = ${sqlString(run.completed_at)}, error_message = ${sqlString(run.error_message)}, failure_class = ${sqlString(run.failure_class)}, process_pid = ${run.process_pid ?? "NULL"}, updated_at = ${sqlString(run.updated_at)} WHERE id = ${sqlString(run.id)};`
      );
      db.prepare(
        `UPDATE execution_runs
         SET task_id = ?,
             status = 'cancelled',
             completed_at = COALESCE(completed_at, ?),
             error_message = COALESCE(error_message, 'Cancelled: cleanup-orphan missing task_id'),
             failure_class = COALESCE(failure_class, 'cancelled'),
             process_pid = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(ANCHOR_TASK_ID, now, now, run.id);
    }

    for (const run of staleRuns) {
      reverseSql.push(
        `UPDATE execution_runs SET status = ${sqlString(run.status)}, completed_at = ${sqlString(run.completed_at)}, error_message = ${sqlString(run.error_message)}, failure_class = ${sqlString(run.failure_class)}, process_pid = ${run.process_pid ?? "NULL"}, updated_at = ${sqlString(run.updated_at)} WHERE id = ${sqlString(run.id)};`
      );
      db.prepare(
        `UPDATE execution_runs
         SET status = 'cancelled',
             completed_at = COALESCE(completed_at, ?),
             error_message = COALESCE(error_message, 'Cancelled: cleanup-stale-leak inactive task'),
             failure_class = COALESCE(failure_class, 'cancelled'),
             process_pid = NULL,
             updated_at = ?
         WHERE id = ?`
      ).run(now, now, run.id);
    }
  });
  tx();

  reverseSql.push("COMMIT;");
  const reversePath = path.join(process.cwd(), "output", `execution-runs-orphan-cleanup-reverse-${stamp}.sql`);
  fs.mkdirSync(path.dirname(reversePath), { recursive: true });
  fs.writeFileSync(reversePath, `${reverseSql.join("\n")}\n`, "utf8");

  console.log(`Backup: ${backupPath}`);
  console.log(`Reverse SQL: ${reversePath}`);
  db.close();
}

main();
