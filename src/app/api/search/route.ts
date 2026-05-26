import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { readTasks } from '@/lib/build-queue';
import { HIVE_RUNNER_WORKSPACE } from '@/lib/paths';

const WORKSPACE = HIVE_RUNNER_WORKSPACE;
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const PROJECTS_DIR = path.join(WORKSPACE, 'projects');

interface SearchResult {
  type: 'memory' | 'activity' | 'task' | 'project' | 'workspace';
  title: string;
  snippet: string;
  path?: string;
  timestamp?: string;
  score?: number;
}

function getLineContext(lines: string[], index: number, context = 2): string {
  const start = Math.max(0, index - context);
  const end = Math.min(lines.length - 1, index + context);
  return lines.slice(start, end + 1).join('\n');
}

function searchInFile(filePath: string, query: string, type: SearchResult['type'] = 'memory'): SearchResult[] {
  const results: SearchResult[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const lowerQuery = query.toLowerCase();
    const seenLines = new Set<number>();
    
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(lowerQuery) && !seenLines.has(index)) {
        seenLines.add(index);
        const snippet = getLineContext(lines, index);
        const relPath = filePath.replace(WORKSPACE + '/', '');
        
        results.push({
          type,
          title: path.basename(filePath),
          snippet: snippet.substring(0, 300).trim(),
          path: relPath,
        });
      }
    });
  } catch {
    // Skip files that can't be read
  }
  return results;
}

function walkDir(dir: string, ext: string, maxDepth = 3, depth = 0): string[] {
  if (depth > maxDepth) return [];
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden dirs, node_modules, .venv, etc.
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.venv') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath, ext, maxDepth, depth + 1));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        files.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable dirs
  }
  return files;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q') || '';
  
  if (!query || query.length < 2) {
    return NextResponse.json([]);
  }
  
  const results: SearchResult[] = [];
  const seen = new Set<string>(); // deduplicate by path+snippet

  // 1. Search workspace root .md files
  const rootFiles = [
    path.join(WORKSPACE, 'MEMORY.md'),
    path.join(WORKSPACE, 'AUTONOMOUS.md'),
    path.join(WORKSPACE, 'AGENTS.md'),
    path.join(WORKSPACE, 'SOUL.md'),
    path.join(WORKSPACE, 'USER.md'),
  ].filter(f => fs.existsSync(f));

  for (const file of rootFiles) {
    for (const r of searchInFile(file, query, 'workspace')) {
      const key = r.path + '::' + r.snippet.substring(0, 50);
      if (!seen.has(key)) { seen.add(key); results.push(r); }
    }
  }

  // 2. Search memory/*.md files
  try {
    const memoryFiles = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => path.join(MEMORY_DIR, f));
    for (const file of memoryFiles) {
      for (const r of searchInFile(file, query, 'memory')) {
        const key = r.path + '::' + r.snippet.substring(0, 50);
        if (!seen.has(key)) { seen.add(key); results.push(r); }
      }
    }
  } catch {
    // memory dir may not exist
  }

  // 3. Search projects/**/*.md files
  try {
    const projectMdFiles = walkDir(PROJECTS_DIR, '.md', 2);
    for (const file of projectMdFiles) {
      for (const r of searchInFile(file, query, 'project')) {
        const key = r.path + '::' + r.snippet.substring(0, 50);
        if (!seen.has(key)) { seen.add(key); results.push(r); }
        if (results.length >= 30) break;
      }
      if (results.length >= 30) break;
    }
  } catch {
    // Projects dir may not exist
  }

  // 4. Search activities
  try {
    const activitiesPath = path.join(process.cwd(), 'data', 'activities.json');
    const activities = JSON.parse(fs.readFileSync(activitiesPath, 'utf-8'));
    const lowerQuery = query.toLowerCase();
    for (const activity of activities) {
      if (
        activity.description?.toLowerCase().includes(lowerQuery) ||
        activity.type?.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          type: 'activity',
          title: activity.type,
          snippet: activity.description || '',
          timestamp: activity.timestamp,
        });
      }
    }
  } catch {
    // Skip
  }
  
  // 5. Search tasks
  try {
    const tasks = readTasks();
    const lowerQuery = query.toLowerCase();
    for (const task of tasks) {
      if (
        task.name?.toLowerCase().includes(lowerQuery) ||
        task.description?.toLowerCase().includes(lowerQuery)
      ) {
        results.push({
          type: 'task',
          title: task.name,
          snippet: task.description || '',
          timestamp: task.nextRun,
        });
      }
    }
  } catch {
    // Skip
  }
  
  return NextResponse.json(results.slice(0, 30));
}
