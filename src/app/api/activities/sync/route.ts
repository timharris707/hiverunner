/**
 * Tasks Log Sync API
 * POST /api/activities/sync  → reads tasks-log.md and syncs completed tasks into the activities DB
 * GET  /api/activities/sync  → preview what would be synced
 */
import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { MC_DATA_DIR } from '@/lib/data-dir';
import { HIVE_RUNNER_WORKSPACE } from '@/lib/paths';

const TASKS_LOG_PATH = path.join(HIVE_RUNNER_WORKSPACE, 'memory', 'tasks-log.md');
const DB_PATH = path.join(MC_DATA_DIR, 'activities.db');

interface ParsedTask {
  id: string;
  date: string;
  description: string;
  type: string;
  taskNum: number;
}

function inferTaskType(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes('cron') || lower.includes('brief') || lower.includes('schedule') || lower.includes('overnight employee')) return 'cron';
  if (lower.includes('bug') || lower.includes('fix') || lower.includes('phase') || lower.includes('login') || lower.includes('committed') || lower.includes('commit')) return 'build';
  if (lower.includes('api key') || lower.includes('secret') || lower.includes('secured') || lower.includes('auth setup')) return 'security';
  if (lower.includes('memory.md') || lower.includes('memory file')) return 'memory';
  if (lower.includes('approved') || lower.includes('logged in')) return 'message';
  return 'task';
}

function parseDateFromSection(section: string): string {
  const match = section.match(/###\s+(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : new Date().toISOString().split('T')[0];
}

function parseTasksLog(content: string): ParsedTask[] {
  const tasks: ParsedTask[] = [];
  const sections = content.split(/(?=###\s+\d{4}-\d{2}-\d{2})/);
  let globalIndex = 0;

  for (const section of sections) {
    const date = parseDateFromSection(section);
    const lines = section.split('\n');

    for (const line of lines) {
      // Match lines like: - ✅ TASK-001: description
      const match = line.match(/^-\s+✅\s+(TASK-(\d+)):\s+(.+)$/);
      if (match) {
        const taskId = match[1]; // e.g. TASK-001
        const taskNum = parseInt(match[2], 10);
        const description = `${taskId}: ${match[3].trim()}`;
        tasks.push({
          id: `tasks-log-${taskId.toLowerCase()}`,
          date,
          description,
          type: inferTaskType(description),
          taskNum,
        });
        globalIndex++;
      }
    }
  }

  return tasks;
}

export async function POST() {
  try {
    if (!existsSync(TASKS_LOG_PATH)) {
      return NextResponse.json({ 
        success: false, 
        error: 'tasks-log.md not found',
        path: TASKS_LOG_PATH 
      }, { status: 404 });
    }

    const content = readFileSync(TASKS_LOG_PATH, 'utf-8');
    const tasks = parseTasksLog(content);

    if (tasks.length === 0) {
      return NextResponse.json({ success: true, synced: 0, message: 'No tasks found in tasks-log.md' });
    }

    const db = new Database(DB_PATH);

    const insert = db.prepare(`
      INSERT OR IGNORE INTO activities (id, timestamp, type, description, status, duration_ms, tokens_used, agent, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let synced = 0;
    let skipped = 0;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      
      // Create timestamp: base date + incremental 30 min slots
      const baseDate = new Date(`${task.date}T05:00:00.000Z`);
      baseDate.setMinutes(baseDate.getMinutes() + i * 30);

      const result = insert.run(
        task.id,
        baseDate.toISOString(),
        task.type,
        task.description,
        'success',
        null,
        null,
        'HiveRunner',
        JSON.stringify({ source: 'tasks-log.md', taskNum: task.taskNum })
      );

      if (result.changes > 0) {
        synced++;
      } else {
        skipped++;
      }
    }

    db.close();

    return NextResponse.json({ 
      success: true, 
      synced, 
      skipped,
      total: tasks.length,
      message: `Synced ${synced} new tasks (${skipped} already existed)`
    });
  } catch (error) {
    console.error('[activities/sync] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: String(error) 
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (!existsSync(TASKS_LOG_PATH)) {
      return NextResponse.json({ 
        found: false, 
        path: TASKS_LOG_PATH,
        tasks: [] 
      });
    }

    const content = readFileSync(TASKS_LOG_PATH, 'utf-8');
    const tasks = parseTasksLog(content);

    return NextResponse.json({
      found: true,
      path: TASKS_LOG_PATH,
      taskCount: tasks.length,
      tasks: tasks.slice(-5), // preview last 5
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
