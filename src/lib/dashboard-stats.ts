import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { getAgentStatusSnapshot } from "@/lib/agent-status";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/timharris/.openclaw";
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || "/Users/timharris/.openclaw/workspace";

interface SessionRecord {
  updatedAt?: number;
  startedAt?: number;
  estimatedCostUsd?: number;
}

export interface DashboardStats {
  activeSessions: number;
  totalSessions: number;
  tasksToday: number;
  costToday: number;
  activeAgents: number;
}

function isoDateFromMs(ms: number): string {
  return new Date(ms).toISOString().split("T")[0];
}

function getSessionsData(): Record<string, SessionRecord> {
  const sessionsJsonPath = join(OPENCLAW_DIR, "agents", "main", "sessions", "sessions.json");
  if (!existsSync(sessionsJsonPath)) return {};

  try {
    return JSON.parse(readFileSync(sessionsJsonPath, "utf-8"));
  } catch {
    return {};
  }
}

function countTaskLogEntriesForDate(date: string): number {
  const tasksLogPath = join(WORKSPACE, "memory", "tasks-log.md");
  if (!existsSync(tasksLogPath)) return 0;

  try {
    const raw = readFileSync(tasksLogPath, "utf-8");
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

export function getDashboardStats(now = Date.now()): DashboardStats {
  const today = isoDateFromMs(now);
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  const sessions = getSessionsData();

  let activeSessions = 0;
  let totalSessions = 0;
  let costToday = 0;

  for (const [key, session] of Object.entries(sessions)) {
    if (key.includes(":run:")) continue;

    totalSessions += 1;

    const updatedAt = session.updatedAt || 0;
    if (updatedAt >= twoHoursAgo) {
      activeSessions += 1;
    }

    // sessions.json stores cumulative session cost, so attribute spend to the session start day
    const attributionMs = session.startedAt || session.updatedAt || 0;
    if (isoDateFromMs(attributionMs) === today) {
      costToday += session.estimatedCostUsd || 0;
    }
  }

  const statusSnapshot = getAgentStatusSnapshot(now);
  const activeAgents = statusSnapshot.agents.filter((agent) =>
    agent.status === "online" || agent.status === "active" || agent.status === "building"
  ).length;

  return {
    activeSessions,
    totalSessions,
    tasksToday: countTaskLogEntriesForDate(today),
    costToday: parseFloat(costToday.toFixed(4)),
    activeAgents,
  };
}
