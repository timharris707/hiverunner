import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { getAgentStatusSnapshot } from "@/lib/agent-status";
import { getQuotaSummary } from "@/lib/quota-scheduler";
import {
  resolveHiveRunnerWorkspaceRoot,
  resolveOpenClawDir,
} from "@/lib/workspaces/root";

const OPENCLAW_DIR = resolveOpenClawDir();
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || resolveHiveRunnerWorkspaceRoot();
const TASKS_LOG_PATH = join(WORKSPACE, "memory", "tasks-log.md");
const SESSIONS_JSON_PATH = join(OPENCLAW_DIR, "agents", "main", "sessions", "sessions.json");
const QUOTA_STATE_PATH = join(process.cwd(), "data", "quota-state.json");

interface SessionRecord {
  updatedAt?: number;
}

export interface DashboardMetricDefinition {
  label: string;
  subtitle: string;
  definition: string;
  source: string;
  timeRange: string;
  verification: string;
}

export interface DashboardStats {
  activeSessions: number;
  totalSessions: number;
  tasksToday: number;
  costToday: number;
  costByAgentToday: Array<{ agent: string; cost: number }>;
  activeAgents: number;
  metrics: {
    activeAgents: DashboardMetricDefinition;
    tasksToday: DashboardMetricDefinition;
    activeSessions: DashboardMetricDefinition;
    costToday: DashboardMetricDefinition;
  };
}

function isoDateFromMs(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

function getSessionsData(): Record<string, SessionRecord> {
  if (!existsSync(SESSIONS_JSON_PATH)) return {};

  try {
    return JSON.parse(readFileSync(SESSIONS_JSON_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function countTaskLogEntriesForDate(date: string): number {
  if (!existsSync(TASKS_LOG_PATH)) return 0;

  try {
    const raw = readFileSync(TASKS_LOG_PATH, "utf-8");
    let inTargetSection = false;
    let count = 0;

    for (const line of raw.split("\n")) {
      if (line.startsWith("### ")) {
        inTargetSection = line.includes(date);
        continue;
      }

      if (inTargetSection && /^- [✅🔄❌]/.test(line)) {
        count += 1;
      }
    }

    return count;
  } catch {
    return 0;
  }
}

function formatLocalDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(ms));
}

export function getDashboardStats(now = Date.now()): DashboardStats {
  const today = isoDateFromMs(now);
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  const sessions = getSessionsData();

  let activeSessions = 0;
  let totalSessions = 0;

  for (const [key, session] of Object.entries(sessions)) {
    if (key.includes(":run:")) continue;

    totalSessions += 1;

    const updatedAt = session.updatedAt || 0;
    if (updatedAt >= twoHoursAgo) {
      activeSessions += 1;
    }
  }

  const statusSnapshot = getAgentStatusSnapshot(now);
  const quotaSummary = getQuotaSummary(new Date(now));
  const activeAgents = statusSnapshot.agents.filter((agent) =>
    agent.status === "online" || agent.status === "active" || agent.status === "building"
  ).length;
  const localCalendarDay = formatLocalDate(now);

  return {
    activeSessions,
    totalSessions,
    tasksToday: countTaskLogEntriesForDate(today),
    costToday: parseFloat(quotaSummary.totalSpendUsd.toFixed(4)),
    costByAgentToday: quotaSummary.byAgent.map((entry) => ({
      agent: entry.agent,
      cost: parseFloat(entry.cost.toFixed(4)),
    })),
    activeAgents,
    metrics: {
      activeAgents: {
        label: "Active Agents",
        subtitle: "Status = online, active, or building",
        definition: "Counts agents whose computed live status is online, active, or building. Pending and offline agents are excluded.",
        source: SESSIONS_JSON_PATH,
        timeRange: "Rolling 2 hours from the latest session update",
        verification: "Computed directly from live session records on each dashboard request.",
      },
      tasksToday: {
        label: "Task Log Entries",
        subtitle: `Logged under ${today}`,
        definition: "Counts task log lines in today's tasks-log section, including completed, in-progress, and failed entries that were appended for the current date.",
        source: TASKS_LOG_PATH,
        timeRange: `tasks-log.md section for ${today}`,
        verification: "Read directly from the append-only task log on each dashboard request.",
      },
      activeSessions: {
        label: "Sessions Updated",
        subtitle: "Non-run sessions touched in the last 2 hours",
        definition: "Counts OpenClaw sessions whose updatedAt timestamp is within the last 2 hours. Run transcript sessions are excluded.",
        source: SESSIONS_JSON_PATH,
        timeRange: "Rolling 2 hours from now",
        verification: "Computed from sessions.json at request time with the same filter used by the agent status snapshot.",
      },
      costToday: {
        label: "Approved Spend",
        subtitle: `Quota state for ${quotaSummary.date} UTC`,
        definition: "Shows quota-approved estimated build spend accumulated in the daily quota ledger, not downstream provider invoices.",
        source: QUOTA_STATE_PATH,
        timeRange: `${quotaSummary.date} UTC quota day (${localCalendarDay} local when rendered)`,
        verification: "Read from the live quota ledger and summed with the same normalization used on the Costs page.",
      },
    },
  };
}
