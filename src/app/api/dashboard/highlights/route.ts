import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/Users/timharris/.openclaw';
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/Users/timharris/.openclaw/workspace';

export const dynamic = 'force-dynamic';

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr: string; tz: string };
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; lastRunStatus?: string };
}

function getNextCronRun(jobs: CronJob[]): { name: string; nextAt: Date; diffMs: number } | null {
  const now = Date.now();
  let soonest: { name: string; nextAt: Date; diffMs: number } | null = null;

  for (const job of jobs) {
    if (!job.enabled) continue;
    const nextMs = job.state?.nextRunAtMs;
    if (!nextMs) continue;
    const diffMs = nextMs - now;
    if (!soonest || diffMs < soonest.diffMs) {
      soonest = { name: job.name, nextAt: new Date(nextMs), diffMs };
    }
  }

  return soonest;
}

function formatDuration(ms: number): string {
  if (ms < 0) return 'overdue';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  return `in ${minutes}m`;
}

export async function GET() {
  try {
    // 1. Parse tasks-log.md for today's highlights
    const tasksLogPath = `${WORKSPACE_DIR}/memory/tasks-log.md`;
    let todayTasks: string[] = [];
    
    if (existsSync(tasksLogPath)) {
      const content = readFileSync(tasksLogPath, 'utf-8');
      const today = new Date().toISOString().split('T')[0];
      
      // Find today's section
      const sections = content.split(/^###\s+/m);
      for (const section of sections) {
        const lines = section.trim().split('\n');
        if (lines[0]?.trim().startsWith(today)) {
          todayTasks = lines
            .slice(1)
            .filter(l => l.trim().startsWith('- ✅') || l.trim().startsWith('- 🔄') || l.trim().startsWith('- ❌'))
            .map(l => l.trim())
            .slice(-5); // last 5
          break;
        }
      }

      // If no today section, get the most recent section
      if (todayTasks.length === 0 && sections.length > 1) {
        const lastSection = sections[sections.length - 1];
        const lines = lastSection.trim().split('\n');
        todayTasks = lines
          .filter(l => l.trim().startsWith('- ✅') || l.trim().startsWith('- 🔄') || l.trim().startsWith('- ❌'))
          .map(l => l.trim())
          .slice(-5);
      }
    }

    // 2. Get next cron job
    let nextCron: { name: string; nextAt: string; in: string } | null = null;
    const cronJobsPath = `${OPENCLAW_DIR}/cron/jobs.json`;
    if (existsSync(cronJobsPath)) {
      const raw = readFileSync(cronJobsPath, 'utf-8');
      const cronData = JSON.parse(raw);
      const jobs: CronJob[] = cronData.jobs || [];
      const next = getNextCronRun(jobs);
      if (next) {
        nextCron = {
          name: next.name,
          nextAt: next.nextAt.toISOString(),
          in: formatDuration(next.diffMs),
        };
      }
    }

    // 3. Provider stack from openclaw.json
    const configPath = `${OPENCLAW_DIR}/openclaw.json`;
    let providerSummary: { name: string; icon: string; primary: boolean }[] = [];
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const authProfiles = config?.auth?.profiles || {};
      const hasGemini = !!config?.env?.GEMINI_API_KEY;
      const hasOpenRouter = !!authProfiles['openrouter:default'];
      const hasAnthropic = !!authProfiles['anthropic:default'];
      const hasOpenAI = !!authProfiles['openai-codex:default'];

      providerSummary = [
        { name: 'Anthropic', icon: '🤖', primary: true },
        { name: 'OpenAI Codex', icon: '🔮', primary: false },
        { name: 'Google Gemini', icon: '✨', primary: false },
        { name: 'OpenRouter', icon: '🔄', primary: false },
      ].map(p => ({
        ...p,
        active: p.name === 'Anthropic' ? hasAnthropic : 
                p.name === 'OpenAI Codex' ? hasOpenAI :
                p.name === 'Google Gemini' ? hasGemini :
                hasOpenRouter,
      }));
    }

    return NextResponse.json({
      todayTasks,
      nextCron,
      providers: providerSummary,
    });
  } catch (err) {
    console.error('Dashboard highlights error:', err);
    return NextResponse.json({ todayTasks: [], nextCron: null, providers: [] });
  }
}
