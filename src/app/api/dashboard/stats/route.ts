import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/timharris/.openclaw";
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || "/Users/timharris/.openclaw/workspace";

function getTodayString(): string {
  return new Date().toISOString().split("T")[0];
}

function countTasksToday(): number {
  const today = getTodayString();
  const tasksLogPath = join(WORKSPACE, "memory", "tasks-log.md");
  if (!existsSync(tasksLogPath)) return 0;
  try {
    const raw = readFileSync(tasksLogPath, "utf-8");
    const lines = raw.split("\n");
    // Find the section for today (### YYYY-MM-DD) and count task lines
    let inToday = false;
    let count = 0;
    for (const line of lines) {
      if (line.startsWith("### ")) {
        inToday = line.includes(today);
        continue;
      }
      if (inToday && line.match(/^- [✅🔄❌]/)) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

interface SessionRecord {
  key?: string;
  updatedAt?: number;
  model?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

function getSessionsData(): Record<string, SessionRecord> {
  const sessionsJsonPath = join(OPENCLAW_DIR, "agents", "main", "sessions", "sessions.json");
  if (!existsSync(sessionsJsonPath)) return {};
  try {
    const raw = readFileSync(sessionsJsonPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const sessions = getSessionsData();
    const today = getTodayString();
    const now = Date.now();
    const oneDayAgo = now - 86400000;

    // Active sessions = sessions updated in last 2 hours
    const twoHoursAgo = now - 7200000;
    let activeSessions = 0;
    let costToday = 0;
    let totalSessions = 0;

    for (const [key, session] of Object.entries(sessions)) {
      if (key.includes(":run:")) continue;
      totalSessions++;

      const updatedAt = session.updatedAt || 0;
      if (updatedAt >= twoHoursAgo) {
        activeSessions++;
      }

      // Cost today
      const dateStr = new Date(updatedAt).toISOString().split("T")[0];
      if (dateStr === today) {
        costToday += session.estimatedCostUsd || 0;
      }
    }

    const tasksToday = countTasksToday();

    return NextResponse.json({
      activeSessions,
      totalSessions,
      tasksToday,
      costToday: parseFloat(costToday.toFixed(4)),
      // Active agents: count of session types that are non-cron, non-subagent, recently active
      activeAgents: activeSessions > 0 ? 1 : 0, // Henry is the main agent
    });
  } catch (error) {
    console.error("[dashboard/stats] Error:", error);
    return NextResponse.json(
      { activeSessions: 0, totalSessions: 0, tasksToday: 0, costToday: 0, activeAgents: 0 },
      { status: 500 }
    );
  }
}
