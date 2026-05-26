/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * tasks-db.ts — SQLite WAL-backed task store
 *
 * Architecture:
 *   - tasks table:            one row per task, full JSON blob
 *   - task_transitions table: application-level journal — every status change
 *   - snapshots table:        records WAL checkpoint events
 *
 * Crash safety:
 *   SQLite WAL mode journals every write before applying it to the main DB.
 *   On crash, the WAL is replayed automatically on next open — no partial writes.
 *
 *   Additionally, `transitionTask()` writes to task_transitions before writing
 *   to tasks. On startup, `_replayCheck()` detects any mismatch (journal says
 *   X → Y but DB still has X) and applies the journaled transition — recovering
 *   state changes that were lost in a crash between the two writes.
 *
 * Snapshot / WAL truncation:
 *   Call `dbCheckpoint()` to force all WAL pages to the main DB file and
 *   truncate the WAL. This creates a clean on-disk snapshot. The auto-
 *   checkpoint fires at 1000 pages (SQLite default); manual checkpoints via
 *   dbCheckpoint() or POST /api/tasks/checkpoint give explicit control.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { MC_DATA_DIR, MC_DATA_DIR_IS_NON_DEFAULT } from './data-dir';

// Some ephemeral deployments expose a read-only app directory. That mode is
// not the supported local-first path, but this opt-in keeps diagnostics usable.
const DATA_DIR = process.env.HIVERUNNER_EPHEMERAL_DATA_DIR === "1"
  ? '/tmp/hiverunner'
  : MC_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, 'tasks.db');
const TASKS_JSON_PATH = path.join(process.cwd(), 'data', 'tasks.json');

let _db: Database.Database | null = null;
let _transitionIdUsesIntegerPk: boolean | null = null;

// Legacy tasks.db has been corrupt since March; the app keeps running because
// live flows route through orchestration.db. To stop the corrupt file from
// spamming ~87K "database disk image is malformed" lines into the logs, each
// exported operation short-circuits to an empty/no-op result once corruption
// has been observed, and the first failure is logged exactly once. B4-proper
// (retiring build-queue + its 13 legacy API routes) is tracked in the
// roadmap; this is the narrow noise-suppression fix.
let _corrupted = false;
let _corruptionLogged = false;

function isLegacyDbCorruptionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const code = (err as { code?: string }).code ?? "";
  return (
    msg.includes("malformed") ||
    msg.includes("corrupt") ||
    code === "SQLITE_CORRUPT" ||
    code === "SQLITE_NOTADB" ||
    code === "SQLITE_IOERR_SHORT_READ"
  );
}

function markLegacyDbCorruptedOnce(err: unknown, context: string): void {
  _corrupted = true;
  if (!_corruptionLogged) {
    _corruptionLogged = true;
    console.error(
      `[tasks-db] LEGACY tasks.db IS CORRUPT — further failures from ${context} and other tasks-db operations will be silently no-oped. Data flows via orchestration.db.`,
      err,
    );
  }
}

const VALID_TASK_STATUSES = new Set([
  "backlog",
  "to-do",
  "in-progress",
  "review",
  "blocked",
  "done",
]);

function normalizeTaskStatus(rawStatus: unknown): string {
  const normalized = String(rawStatus || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (!normalized) return "backlog";

  if (normalized === "to_do" || normalized === "ondeck" || normalized === "todo" || normalized === "queued") {
    return "to-do";
  }
  if (normalized === "in_progress" || normalized === "inprogress" || normalized === "active" || normalized === "working") {
    return "in-progress";
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "closed") {
    return "done";
  }

  const asApiStatus = normalized.replace(/_/g, "-");
  if (VALID_TASK_STATUSES.has(asApiStatus)) {
    return asApiStatus;
  }

  return "backlog";
}

function normalizeTaskRecord(task: any, fallbackStatus?: unknown): { task: any; status: string; changed: boolean } {
  const normalizedStatus = normalizeTaskStatus(task?.status ?? fallbackStatus);
  const nextTask = task && typeof task === "object" ? { ...task } : {};
  const changed = nextTask.status !== normalizedStatus;
  nextTask.status = normalizedStatus;
  if (!nextTask.updated) {
    nextTask.updated = new Date().toISOString();
  }
  return { task: nextTask, status: normalizedStatus, changed };
}

export function getDb(): Database.Database {
  if (_db) return _db;
  if (_corrupted) {
    // Short-circuit: we've already observed this file is corrupt and
    // legacy tasks.db is not used by live flows. Throwing is fine —
    // every exported tasks-db function guards with `if (_corrupted) return …`
    // before ever reaching getDb().
    throw new Error("legacy tasks.db is offline (corrupt)");
  }

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Legacy tasks.db initialization. If the file is corrupt or unreadable,
  // log loudly but do NOT let the error propagate — this is the old task
  // system and its failure must not take down the app. Callers that get
  // a thrown error here will hit the readTasksSafely() catch in
  // realtime-snapshot.ts / projects.ts and degrade to empty legacy tasks.
  try {
    _db = new Database(DB_PATH);
  } catch (e) {
    if (isLegacyDbCorruptionError(e)) {
      markLegacyDbCorruptedOnce(e, "getDb:open");
    } else {
      console.error(`[tasks-db] LEGACY DB OPEN FAILED (${DB_PATH}):`, e);
    }
    throw e;
  }

  try {
    // WAL mode: writes go to WAL file first, then checkpoint to main DB.
    // On crash, SQLite replays uncommitted WAL entries automatically on next open.
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    _db.pragma('foreign_keys = ON');
    // Reduce transient SQLITE_BUSY failures when API routes and background
    // reconciler writes overlap under e2e load.
    _db.pragma('busy_timeout = 5000');

    _db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id      TEXT PRIMARY KEY,
        data    TEXT NOT NULL,
        status  TEXT NOT NULL,
        project TEXT,
        updated TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated DESC);

      -- Application-level transition journal.
      -- Written by transitionTask() BEFORE the task row is updated.
      -- If the DB has task.status != the latest to_status, the transition
      -- was lost in a crash and _replayCheck() will re-apply it on startup.
      CREATE TABLE IF NOT EXISTS task_transitions (
        id          TEXT PRIMARY KEY,
        task_id     TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status   TEXT NOT NULL,
        actor       TEXT NOT NULL DEFAULT 'pipeline',
        reason      TEXT,
        ts          TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_transitions_task_id ON task_transitions(task_id);
      CREATE INDEX IF NOT EXISTS idx_transitions_ts      ON task_transitions(ts DESC);

      -- Snapshot log: records every WAL checkpoint performed.
      CREATE TABLE IF NOT EXISTS snapshots (
        id         TEXT PRIMARY KEY,
        ts         TEXT NOT NULL,
        task_count INTEGER NOT NULL,
        note       TEXT
      );
    `);

    // Migrate from tasks.json on first run (DB is fresh / empty).
    // Skip JSON backfill when MC_DATA_DIR is explicitly set (e.g., data-dev)
    // so non-default data directories start with a clean slate.
    const count = (_db.prepare('SELECT COUNT(*) as n FROM tasks').get() as { n: number }).n;
    if (count === 0 && !MC_DATA_DIR_IS_NON_DEFAULT) {
      _migrateFromJson(_db);
    }

    // Crash replay: detect transitions journaled but not yet reflected in tasks.
    _replayCheck(_db);
    _normalizeStoredTaskStatuses(_db);
  } catch (e) {
    // Schema creation, migration, or replay failed — almost always
    // SQLITE_CORRUPT. Close the broken handle, mark the module corrupt so
    // subsequent exports short-circuit without retrying the open (which is
    // what produced ~87K log lines previously), and throw for the current
    // caller. After this point, getDb() is a no-op throw and every wrapped
    // export returns empty/no-op silently.
    if (isLegacyDbCorruptionError(e)) {
      markLegacyDbCorruptedOnce(e, "getDb:init");
    } else {
      console.error(`[tasks-db] LEGACY DB INIT FAILED (${DB_PATH}) — closing handle:`, e);
    }
    try { _db.close(); } catch { /* ignore close errors */ }
    _db = null;
    throw e;
  }

  return _db;
}

// ── Migration ──────────────────────────────────────────────────────────────────

function _migrateFromJson(db: Database.Database): void {
  if (!fs.existsSync(TASKS_JSON_PATH)) return;
  try {
    const data: any[] = JSON.parse(fs.readFileSync(TASKS_JSON_PATH, 'utf-8'));
    if (!Array.isArray(data) || data.length === 0) return;

    const insert = db.prepare(`
      INSERT OR IGNORE INTO tasks (id, data, status, project, updated)
      VALUES (@id, @data, @status, @project, @updated)
    `);

    db.transaction((tasks: any[]) => {
      for (const t of tasks) {
        if (!t.id) continue;
        const normalized = normalizeTaskRecord(t, t.status || "backlog");
        insert.run({
          id:      t.id,
          data:    JSON.stringify(normalized.task),
          status:  normalized.status,
          project: t.project || null,
          updated: normalized.task.updated || t.created || new Date().toISOString(),
        });
      }
    })(data);

    console.log(`[tasks-db] Migrated ${data.length} tasks from tasks.json → tasks.db`);
  } catch (e) {
    console.warn('[tasks-db] Migration from tasks.json failed:', e);
  }
}

// ── Crash replay ───────────────────────────────────────────────────────────────

function _replayCheck(db: Database.Database): void {
  try {
    // Find tasks where the latest journaled transition disagrees with DB status.
    // This means transitionTask() fired (journal written) but writeTasks()
    // didn't complete before the crash.
    const orphaned = db.prepare(`
      SELECT
        t.task_id,
        t.to_status   AS journaled_status,
        t.from_status AS from_status,
        t.actor,
        t.ts,
        tk.status     AS current_status
      FROM task_transitions t
      JOIN tasks tk ON tk.id = t.task_id
      WHERE t.ts = (
        SELECT MAX(ts) FROM task_transitions WHERE task_id = t.task_id
      )
        AND t.to_status != tk.status
      ORDER BY t.ts DESC
      LIMIT 100
    `).all() as Array<{
      task_id: string;
      journaled_status: string;
      from_status: string;
      actor: string;
      ts: string;
      current_status: string;
    }>;

    if (orphaned.length === 0) return;

    console.warn(`[tasks-db] Crash replay: ${orphaned.length} unfinished transition(s) detected`);

    const updateTask = db.prepare(
      'UPDATE tasks SET data = ?, status = ?, updated = ? WHERE id = ?'
    );

    db.transaction((rows: typeof orphaned) => {
      for (const row of rows) {
        const taskRow = db.prepare('SELECT data FROM tasks WHERE id = ?').get(row.task_id) as
          | { data: string }
          | undefined;
        if (!taskRow) continue;

        const task = JSON.parse(taskRow.data);
        const replayedAt = new Date().toISOString();

        console.warn(
          `[tasks-db]   ↺ task ${row.task_id}: ` +
          `${row.from_status} → ${row.journaled_status} ` +
          `(journaled ${row.ts}, actor: ${row.actor})`
        );

        task.status  = row.journaled_status;
        task.updated = replayedAt;

        updateTask.run(JSON.stringify(task), row.journaled_status, replayedAt, row.task_id);
      }
    })(orphaned);
  } catch (e) {
    console.warn('[tasks-db] Crash replay check failed:', e);
  }
}

function _normalizeStoredTaskStatuses(db: Database.Database): void {
  try {
    const rows = db.prepare("SELECT id, data, status FROM tasks").all() as Array<{
      id: string;
      data: string;
      status: string;
    }>;
    if (rows.length === 0) return;

    const update = db.prepare("UPDATE tasks SET data = ?, status = ?, updated = ? WHERE id = ?");
    let normalizedCount = 0;

    db.transaction((items: typeof rows) => {
      for (const row of items) {
        let parsed: any;
        try {
          parsed = JSON.parse(row.data);
        } catch {
          parsed = { id: row.id };
        }

        const normalized = normalizeTaskRecord(parsed, row.status);
        const shouldPersist =
          row.status !== normalized.status ||
          parsed?.status !== normalized.status ||
          JSON.stringify(parsed) !== JSON.stringify(normalized.task);

        if (!shouldPersist) continue;

        normalizedCount++;
        const updatedAt = typeof normalized.task.updated === "string"
          ? normalized.task.updated
          : new Date().toISOString();
        update.run(JSON.stringify(normalized.task), normalized.status, updatedAt, row.id);
      }
    })(rows);

    if (normalizedCount > 0) {
      console.warn(`[tasks-db] Normalized ${normalizedCount} task status value(s) to canonical API statuses`);
    }
  } catch (error) {
    console.warn("[tasks-db] Task status normalization failed:", error);
  }
}

// ── Read / Write ───────────────────────────────────────────────────────────────

/**
 * Read all tasks from SQLite. Ordered newest-updated first (same order as the
 * old tasks.json which stored tasks in insertion/updated order).
 */
export function dbReadTasks(): any[] {
  if (_corrupted) return [];
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT data FROM tasks ORDER BY updated DESC'
    ).all() as Array<{ data: string }>;
    return rows.map((row) => {
      const parsed = JSON.parse(row.data);
      return normalizeTaskRecord(parsed, parsed?.status).task;
    });
  } catch (err) {
    if (isLegacyDbCorruptionError(err)) {
      markLegacyDbCorruptedOnce(err, "dbReadTasks");
      return [];
    }
    throw err;
  }
}

/**
 * Persist a full task array to SQLite.
 * Upserts every task in a single WAL transaction — either all writes land or
 * none do. After a crash, SQLite replays the WAL and the DB is left clean.
 */
export function dbWriteTasks(tasks: any[]): void {
  if (_corrupted) return;
  try {
    const db = getDb();

    const upsert = db.prepare(`
      INSERT INTO tasks (id, data, status, project, updated)
      VALUES (@id, @data, @status, @project, @updated)
      ON CONFLICT(id) DO UPDATE SET
        data    = excluded.data,
        status  = excluded.status,
        project = excluded.project,
        updated = excluded.updated
    `);

    db.transaction((items: any[]) => {
      for (const t of items) {
        if (!t.id) continue;
        const normalized = normalizeTaskRecord(t, t.status || "backlog");
        upsert.run({
          id:      normalized.task.id,
          data:    JSON.stringify(normalized.task),
          status:  normalized.status,
          project: normalized.task.project || null,
          updated: normalized.task.updated || new Date().toISOString(),
        });
      }
    })(tasks);
  } catch (err) {
    if (isLegacyDbCorruptionError(err)) {
      markLegacyDbCorruptedOnce(err, "dbWriteTasks");
      return;
    }
    throw err;
  }
}

/**
 * Upsert a single task — convenience wrapper around dbWriteTasks.
 */
export function dbUpsertTask(task: any): void {
  dbWriteTasks([task]);
}

// ── Transition journal ─────────────────────────────────────────────────────────

/**
 * Record a status transition in the journal.
 * Called by transitionTask() BEFORE the task row is updated.
 * If the server crashes before the subsequent writeTasks() completes,
 * _replayCheck() will detect the mismatch and apply the transition on restart.
 */
export function dbJournalTransition(
  taskId: string,
  fromStatus: string,
  toStatus: string,
  actor: string = 'pipeline',
  reason?: string
): void {
  if (_corrupted) return;
  try {
    const db = getDb();

    if (_transitionIdUsesIntegerPk === null) {
      const cols = db.prepare("PRAGMA table_info(task_transitions)").all() as Array<{
        name: string;
        type: string;
        pk: number;
      }>;
      const idCol = cols.find((col) => col.name === "id");
      _transitionIdUsesIntegerPk = Boolean(idCol && idCol.pk === 1 && /INT/i.test(idCol.type || ""));
    }

    const ts = new Date().toISOString();
    if (_transitionIdUsesIntegerPk) {
      db.prepare(`
        INSERT INTO task_transitions (task_id, from_status, to_status, actor, reason, ts)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, fromStatus, toStatus, actor, reason ?? null, ts);
      return;
    }

    db.prepare(`
      INSERT INTO task_transitions (id, task_id, from_status, to_status, actor, reason, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), taskId, fromStatus, toStatus, actor, reason ?? null, ts);
  } catch (err) {
    if (isLegacyDbCorruptionError(err)) {
      markLegacyDbCorruptedOnce(err, "dbJournalTransition");
      return;
    }
    throw err;
  }
}

/**
 * Fetch recent transitions — audit trail for a task or all tasks.
 */
export function dbGetTransitions(
  taskId?: string,
  limit = 100
): Array<{
  id: string;
  task_id: string;
  from_status: string;
  to_status: string;
  actor: string;
  reason: string | null;
  ts: string;
}> {
  if (_corrupted) return [];
  try {
    const db = getDb();
    if (taskId) {
      return db
        .prepare('SELECT * FROM task_transitions WHERE task_id = ? ORDER BY ts DESC LIMIT ?')
        .all(taskId, limit) as any[];
    }
    return db
      .prepare('SELECT * FROM task_transitions ORDER BY ts DESC LIMIT ?')
      .all(limit) as any[];
  } catch (err) {
    if (isLegacyDbCorruptionError(err)) {
      markLegacyDbCorruptedOnce(err, "dbGetTransitions");
      return [];
    }
    throw err;
  }
}

// ── Snapshot / Checkpoint ──────────────────────────────────────────────────────

/**
 * Force a WAL checkpoint (TRUNCATE mode).
 * All WAL pages are written to the main DB file and the WAL is truncated,
 * creating a clean on-disk snapshot. Safe to call at any time.
 */
export function dbCheckpoint(note?: string): {
  pagesWritten: number;
  pagesRemaining: number;
  taskCount: number;
} {
  if (_corrupted) return { pagesWritten: 0, pagesRemaining: 0, taskCount: 0 };
  try {
    const db = getDb();

    // TRUNCATE: write all WAL pages to main DB, then zero-out the WAL file
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number;
      log: number;
      checkpointed: number;
    }>;
    const row = result[0] ?? { busy: 0, log: 0, checkpointed: 0 };

    const taskCount = (
      db.prepare('SELECT COUNT(*) as n FROM tasks').get() as { n: number }
    ).n;

    db.prepare(
      'INSERT INTO snapshots (id, ts, task_count, note) VALUES (?, ?, ?, ?)'
    ).run(randomUUID(), new Date().toISOString(), taskCount, note ?? null);

    return {
      pagesWritten:    row.checkpointed,
      pagesRemaining:  row.log - row.checkpointed,
      taskCount,
    };
  } catch (err) {
    if (isLegacyDbCorruptionError(err)) {
      markLegacyDbCorruptedOnce(err, "dbCheckpoint");
      return { pagesWritten: 0, pagesRemaining: 0, taskCount: 0 };
    }
    throw err;
  }
}

/**
 * List recent snapshot events.
 */
export function dbGetSnapshots(limit = 10): Array<{
  id: string;
  ts: string;
  task_count: number;
  note: string | null;
}> {
  if (_corrupted) return [];
  try {
    const db = getDb();
    return db
      .prepare('SELECT * FROM snapshots ORDER BY ts DESC LIMIT ?')
      .all(limit) as any[];
  } catch (err) {
    if (isLegacyDbCorruptionError(err)) {
      markLegacyDbCorruptedOnce(err, "dbGetSnapshots");
      return [];
    }
    throw err;
  }
}
