import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolveOpenClawDir } from "@/lib/workspaces/root";

const OPENCLAW_DIR = resolveOpenClawDir();

interface RawRun {
  id?: string;
  startedAt?: string;
  createdAt?: string;
  completedAt?: string;
  finishedAt?: string;
  status?: string;
  durationMs?: number;
  error?: string;
  // JSONL format fields
  ts?: number;
  jobId?: string;
  action?: string;
  runAtMs?: number;
  summary?: string;
  delivered?: boolean;
}

interface RunEntry {
  id: string;
  jobId: string;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  durationMs: number | null;
  error: string | null;
  summary?: string;
}

function readJsonlRuns(id: string): RunEntry[] {
  const filePath = `${OPENCLAW_DIR}/cron/runs/${id}.jsonl`;
  if (!existsSync(filePath)) return [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const runs: RunEntry[] = [];

    for (const line of lines) {
      try {
        const entry: RawRun = JSON.parse(line);
        // Only include "finished" action entries
        if (entry.action && entry.action !== 'finished') continue;

        const runAt = entry.runAtMs ? new Date(entry.runAtMs).toISOString() : null;
        const completedTs = entry.ts ? new Date(entry.ts).toISOString() : null;

        runs.push({
          id: `${id}-${entry.ts || entry.runAtMs || Math.random()}`,
          jobId: id,
          startedAt: runAt,
          completedAt: completedTs,
          status: entry.status === 'ok' ? 'success' : entry.status || 'unknown',
          durationMs: entry.durationMs || null,
          error: entry.error || null,
          summary: entry.summary ? entry.summary.slice(0, 200) : undefined,
        });
      } catch {
        continue;
      }
    }

    // Most recent first
    return runs.reverse();
  } catch {
    return [];
  }
}

// GET: Fetch run history for a cron job
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return NextResponse.json({ error: "Invalid job ID" }, { status: 400 });
    }

    let runs: RunEntry[] = [];

    // Try openclaw CLI first
    try {
      const output = execSync(`openclaw cron runs ${id} --json 2>/dev/null`, {
        timeout: 10000,
        encoding: "utf-8",
        env: { ...process.env, PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' },
      });

      const data = JSON.parse(output);
      const rawRuns: RawRun[] = data.runs || data || [];

      runs = rawRuns.map((r: RawRun) => ({
        id: r.id || `${id}-${r.startedAt}`,
        jobId: id,
        startedAt: r.startedAt || r.createdAt || null,
        completedAt: r.completedAt || r.finishedAt || null,
        status: r.status || "unknown",
        durationMs:
          r.durationMs ||
          (r.startedAt && r.completedAt
            ? new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()
            : null),
        error: r.error || null,
      }));
    } catch {
      // Fall back to reading JSONL directly
      runs = readJsonlRuns(id);
    }

    return NextResponse.json({ runs, total: runs.length });
  } catch (error) {
    console.error("Error fetching run history:", error);
    return NextResponse.json({ error: "Failed to fetch run history" }, { status: 500 });
  }
}
