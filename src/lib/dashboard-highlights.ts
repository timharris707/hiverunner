import { existsSync, readFileSync } from "fs";

import {
  resolveHiveRunnerWorkspaceRoot,
  resolveOpenClawDir,
} from "@/lib/workspaces/root";

const OPENCLAW_DIR = resolveOpenClawDir();
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || resolveHiveRunnerWorkspaceRoot();

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr: string; tz: string };
  state?: { nextRunAtMs?: number; lastRunAtMs?: number; lastRunStatus?: string };
}

export interface DashboardHighlights {
  todayTasks: string[];
  nextCron: { name: string; nextAt: string; in: string } | null;
  providers: { name: string; icon: string; primary: boolean; active?: boolean }[];
}

function getNextCronRun(jobs: CronJob[], now = Date.now()): { name: string; nextAt: Date; diffMs: number } | null {
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
  if (ms < 0) return "overdue";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `in ${days}d ${hours % 24}h`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  return `in ${minutes}m`;
}

export function getDashboardHighlights(now = Date.now()): DashboardHighlights {
  const tasksLogPath = `${WORKSPACE_DIR}/memory/tasks-log.md`;
  let todayTasks: string[] = [];

  if (existsSync(tasksLogPath)) {
    const content = readFileSync(tasksLogPath, "utf-8");
    const today = new Date(now).toISOString().split("T")[0];
    const sections = content.split(/^###\s+/m);

    for (const section of sections) {
      const lines = section.trim().split("\n");
      if (lines[0]?.trim().startsWith(today)) {
        todayTasks = lines
          .slice(1)
          .filter((line) => line.trim().startsWith("- ✅") || line.trim().startsWith("- 🔄") || line.trim().startsWith("- ❌"))
          .map((line) => line.trim())
          .slice(-5);
        break;
      }
    }

    if (todayTasks.length === 0 && sections.length > 1) {
      const lastSection = sections[sections.length - 1];
      const lines = lastSection.trim().split("\n");
      todayTasks = lines
        .filter((line) => line.trim().startsWith("- ✅") || line.trim().startsWith("- 🔄") || line.trim().startsWith("- ❌"))
        .map((line) => line.trim())
        .slice(-5);
    }
  }

  let nextCron: { name: string; nextAt: string; in: string } | null = null;
  const cronJobsPath = `${OPENCLAW_DIR}/cron/jobs.json`;
  if (existsSync(cronJobsPath)) {
    const raw = readFileSync(cronJobsPath, "utf-8");
    const cronData = JSON.parse(raw);
    const jobs: CronJob[] = cronData.jobs || [];
    const next = getNextCronRun(jobs, now);
    if (next) {
      nextCron = {
        name: next.name,
        nextAt: next.nextAt.toISOString(),
        in: formatDuration(next.diffMs),
      };
    }
  }

  let providers: DashboardHighlights["providers"] = [];
  const configPath = `${OPENCLAW_DIR}/openclaw.json`;
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const authProfiles = config?.auth?.profiles || {};
    const hasGemini = !!config?.env?.GEMINI_API_KEY;
    const hasOpenRouter = !!authProfiles["openrouter:default"];
    const hasAnthropic = !!authProfiles["anthropic:default"];
    const hasOpenAI = !!authProfiles["openai-codex:default"];

    providers = [
      { name: "Anthropic", icon: "🤖", primary: true },
      { name: "OpenAI Codex", icon: "🔮", primary: false },
      { name: "Google Gemini", icon: "✨", primary: false },
      { name: "OpenRouter", icon: "🔄", primary: false },
    ].map((provider) => ({
      ...provider,
      active:
        provider.name === "Anthropic"
          ? hasAnthropic
          : provider.name === "OpenAI Codex"
            ? hasOpenAI
            : provider.name === "Google Gemini"
              ? hasGemini
              : hasOpenRouter,
    }));
  }

  return { todayTasks, nextCron, providers };
}
