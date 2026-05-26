import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { resolveHiveRunnerWorkspaceRoot } from "@/lib/workspaces/root";

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || resolveHiveRunnerWorkspaceRoot();

export const dynamic = 'force-dynamic';

interface TaskEntry {
  date: string;
  count: number;
  completed: number;
  failed: number;
}

interface AgentActivity {
  agent: string;
  tasks: number;
}

function parseTasksLog(content: string): { byDate: TaskEntry[]; byAgent: AgentActivity[]; total: number; completed: number } {
  const sections = content.split(/^###\s+/m).filter(Boolean);
  const byDate: TaskEntry[] = [];
  const agentMap: Record<string, number> = {};
  let totalCompleted = 0;
  let totalFailed = 0;

  for (const section of sections) {
    const lines = section.trim().split('\n');
    const dateMatch = lines[0]?.trim().match(/^\d{4}-\d{2}-\d{2}$/);
    if (!dateMatch) continue;

    const date = lines[0].trim();
    let completed = 0;
    let failed = 0;

    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('- ')) continue;
      if (trimmed.includes('✅')) {
        completed++;
        totalCompleted++;
        // Extract agent from arrow notation: → projects/... or from name
        const agentMatch = trimmed.match(/(?:T1|T2|T3|HiveRunner|Scout|Quill|Counsel|Backend|Full-Stack)/i);
        if (agentMatch) {
          const a = agentMatch[0];
          agentMap[a] = (agentMap[a] || 0) + 1;
        } else {
          agentMap['HiveRunner'] = (agentMap['HiveRunner'] || 0) + 1;
        }
      } else if (trimmed.includes('❌')) {
        failed++;
        totalFailed++;
      }
    }

    if (completed + failed > 0) {
      byDate.push({ date, count: completed + failed, completed, failed });
    }
  }

  byDate.sort((a, b) => a.date.localeCompare(b.date));

  const byAgent: AgentActivity[] = Object.entries(agentMap)
    .map(([agent, tasks]) => ({ agent, tasks }))
    .sort((a, b) => b.tasks - a.tasks);

  return {
    byDate,
    byAgent,
    total: totalCompleted + totalFailed,
    completed: totalCompleted,
  };
}

function parseProjectProgress() {
  const projects = [
    { name: "HiveRunner", path: "projects/hiverunner", status: "active", completion: 75 },
    { name: "Karpathy Loop", path: "projects/karpathy-loop", status: "design", completion: 20 },
    { name: "Product Studio", path: "projects/product-studio", status: "building", completion: 30 },
    { name: "HiveRunner Workspace", path: null, status: "active", completion: 65 },
  ];

  return projects.map(p => ({
    ...p,
    exists: p.path ? existsSync(`${WORKSPACE_DIR}/${p.path}`) : true,
  }));
}

export async function GET() {
  try {
    const tasksLogPath = `${WORKSPACE_DIR}/memory/tasks-log.md`;
    let analytics = { byDate: [] as TaskEntry[], byAgent: [] as AgentActivity[], total: 0, completed: 0 };

    if (existsSync(tasksLogPath)) {
      const content = readFileSync(tasksLogPath, 'utf-8');
      analytics = parseTasksLog(content);
    }

    const projects = parseProjectProgress();

    // Summary stats
    const today = new Date().toISOString().split('T')[0];
    const todayEntry = analytics.byDate.find(d => d.date === today);
    const last7Days = analytics.byDate.filter(d => {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      return new Date(d.date) >= weekAgo;
    });
    const last7Total = last7Days.reduce((sum, d) => sum + d.completed, 0);
    const avgPerDay = last7Days.length > 0 ? Math.round(last7Total / last7Days.length) : 0;

    return NextResponse.json({
      byDate: analytics.byDate.slice(-30), // last 30 days
      byAgent: analytics.byAgent,
      projects,
      summary: {
        totalTasks: analytics.total,
        completedTasks: analytics.completed,
        completionRate: analytics.total > 0 ? Math.round((analytics.completed / analytics.total) * 100) : 0,
        todayCount: todayEntry?.completed || 0,
        last7Total,
        avgPerDay,
        activeDays: analytics.byDate.length,
      },
    });
  } catch (err) {
    console.error('Reports analytics error:', err);
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
