/**
 * GET /api/reliability
 * Returns real reliability data: cron failures, agent errors, cost guards, and config
 */
import { NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/Users/timharris/.openclaw";

interface ReliabilityConfig {
  maxRetries: number;
  backoffPattern: number[]; // seconds
  dailyOrgBudget: number; // USD
  perTaskTokenLimit: number;
  hardStopThreshold: number; // percent
  warningThreshold: number; // percent
  criticalThreshold: number; // percent
}

function loadReliabilityConfig(): ReliabilityConfig {
  const defaults: ReliabilityConfig = {
    maxRetries: 3,
    backoffPattern: [1, 5, 30],
    dailyOrgBudget: 50,
    perTaskTokenLimit: 100000,
    hardStopThreshold: 115,
    warningThreshold: 80,
    criticalThreshold: 100,
  };

  const configPath = join(OPENCLAW_DIR, "openclaw.json");
  if (!existsSync(configPath)) return defaults;

  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const r = raw?.reliability || {};
    return {
      maxRetries: r.maxRetries ?? defaults.maxRetries,
      backoffPattern: r.backoffPattern ?? defaults.backoffPattern,
      dailyOrgBudget: r.dailyOrgBudget ?? defaults.dailyOrgBudget,
      perTaskTokenLimit: r.perTaskTokenLimit ?? defaults.perTaskTokenLimit,
      hardStopThreshold: r.hardStopThreshold ?? defaults.hardStopThreshold,
      warningThreshold: r.warningThreshold ?? defaults.warningThreshold,
      criticalThreshold: r.criticalThreshold ?? defaults.criticalThreshold,
    };
  } catch {
    return defaults;
  }
}

interface CronRunEntry {
  ts?: number;
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  durationMs?: number;
  runAtMs?: number;
}

interface CronJobData {
  id: string;
  name?: string;
  status?: string;
  errorCount: number;
  recentRuns: { status: string; ts: number; error?: string }[];
}

function loadCronData(): CronJobData[] {
  const runsDir = join(OPENCLAW_DIR, "cron", "runs");
  const cronDir = join(OPENCLAW_DIR, "cron");
  
  const results: CronJobData[] = [];
  
  if (!existsSync(runsDir)) return results;
  
  // Load cron job config to get names
  const cronConfigPath = join(cronDir, "crons.json");
  let cronConfig: Record<string, { name?: string; status?: string }> = {};
  if (existsSync(cronConfigPath)) {
    try {
      cronConfig = JSON.parse(readFileSync(cronConfigPath, "utf-8"));
    } catch {}
  }
  
  const files = readdirSync(runsDir).filter(f => f.endsWith(".jsonl"));
  
  for (const file of files) {
    const jobId = file.replace(".jsonl", "");
    const filePath = join(runsDir, file);
    
    try {
      const raw = readFileSync(filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      
      const runs: { status: string; ts: number; error?: string }[] = [];
      let errorCount = 0;
      
      for (const line of lines) {
        try {
          const entry: CronRunEntry = JSON.parse(line);
          if (entry.action !== "finished") continue;
          
          const status = entry.status === "ok" ? "success" : (entry.status || "unknown");
          if (status !== "success") errorCount++;
          
          runs.push({
            status,
            ts: entry.ts || entry.runAtMs || 0,
            error: entry.error,
          });
        } catch {}
      }
      
      // Most recent first
      runs.sort((a, b) => b.ts - a.ts);
      
      results.push({
        id: jobId,
        name: cronConfig[jobId]?.name,
        status: cronConfig[jobId]?.status,
        errorCount,
        recentRuns: runs.slice(0, 10),
      });
    } catch {}
  }
  
  return results;
}

function getSessionStats(): { totalErrors: number; recentErrorCount: number } {
  const sessionsPath = join(OPENCLAW_DIR, "agents", "main", "sessions", "sessions.json");
  if (!existsSync(sessionsPath)) return { totalErrors: 0, recentErrorCount: 0 };
  
  try {
    const data = JSON.parse(readFileSync(sessionsPath, "utf-8"));
    let totalErrors = 0;
    let recentErrorCount = 0;
    const oneDayAgo = Date.now() - 86400000;
    
    for (const [key, session] of Object.entries(data as Record<string, Record<string, unknown>>)) {
      if (key.includes(":run:")) continue;
      if (session.abortedLastRun) {
        totalErrors++;
        const updatedAt = (session.updatedAt as number) || 0;
        if (updatedAt > oneDayAgo) recentErrorCount++;
      }
    }
    
    return { totalErrors, recentErrorCount };
  } catch {
    return { totalErrors: 0, recentErrorCount: 0 };
  }
}

export async function GET() {
  try {
    const cronData = loadCronData();
    const sessionStats = getSessionStats();
    const config = loadReliabilityConfig();

    const totalCronRuns = cronData.reduce((sum, job) => sum + job.recentRuns.length, 0);
    const totalCronErrors = cronData.reduce((sum, job) => sum + job.errorCount, 0);
    const hasActiveCronErrors = cronData.some(job => job.errorCount > 0);

    return NextResponse.json({
      cronJobs: cronData,
      totalCronRuns,
      totalCronErrors,
      hasActiveCronErrors,
      sessionErrors: sessionStats.totalErrors,
      recentSessionErrors: sessionStats.recentErrorCount,
      circuitBreakerState: hasActiveCronErrors || sessionStats.recentErrorCount > config.maxRetries ? "open" : "closed",
      config,
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to load reliability data" }, { status: 500 });
  }
}
