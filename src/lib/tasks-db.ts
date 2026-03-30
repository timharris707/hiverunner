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

// On Vercel (and other serverless platforms), process.cwd() is read-only.
// Use /tmp for the DB so SQLite writes succeed in preview deployments.
const DATA_DIR = process.env.VERCEL
  ? '/tmp/mission-control'
  : path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'tasks.db');
const TASKS_JSON_PATH = path.join(process.cwd(), 'data', 'tasks.json');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  _db = new Database(DB_PATH);

  // WAL mode: writes go to WAL file first, then checkpoint to main DB.
  // On crash, SQLite replays uncommitted WAL entries automatically on next open.
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');

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
  const count = (_db.prepare('SELECT COUNT(*) as n FROM tasks').get() as { n: number }).n;
  if (count === 0) {
    _migrateFromJson(_db);
  }

  // Crash replay: detect transitions journaled but not yet reflected in tasks.
  _replayCheck(_db);

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
        insert.run({
          id:      t.id,
          data:    JSON.stringify(t),
          status:  t.status  || 'backlog',
          project: t.project || null,
          updated: t.updated || t.created || new Date().toISOString(),
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

// ── Read / Write ───────────────────────────────────────────────────────────────

/**
 * Read all tasks from SQLite. Ordered newest-updated first (same order as the
 * old tasks.json which stored tasks in insertion/updated order).
 */
export function dbReadTasks(): any[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT data FROM tasks ORDER BY updated DESC'
  ).all() as Array<{ data: string }>;
  return rows.map(r => JSON.parse(r.data));
}

/**
 * Persist a full task array to SQLite.
 * Upserts every task in a single WAL transaction — either all writes land or
 * none do. After a crash, SQLite replays the WAL and the DB is left clean.
 */
export function dbWriteTasks(tasks: any[]): void {
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
      upsert.run({
        id:      t.id,
        data:    JSON.stringify(t),
        status:  t.status  || 'backlog',
        project: t.project || null,
        updated: t.updated || new Date().toISOString(),
      });
    }
  })(tasks);
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
  const db = getDb();
  db.prepare(`
    INSERT INTO task_transitions (id, task_id, from_status, to_status, actor, reason, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), taskId, fromStatus, toStatus, actor, reason ?? null, new Date().toISOString());
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
  const db = getDb();
  if (taskId) {
    return db
      .prepare('SELECT * FROM task_transitions WHERE task_id = ? ORDER BY ts DESC LIMIT ?')
      .all(taskId, limit) as any[];
  }
  return db
    .prepare('SELECT * FROM task_transitions ORDER BY ts DESC LIMIT ?')
    .all(limit) as any[];
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
  const db = getDb();
  return db
    .prepare('SELECT * FROM snapshots ORDER BY ts DESC LIMIT ?')
    .all(limit) as any[];
}
