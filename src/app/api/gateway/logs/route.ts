import { NextResponse } from 'next/server';
import { readFileSync, existsSync, readdirSync, createReadStream } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

export const dynamic = 'force-dynamic';

const LOG_DIR = '/tmp/openclaw';

async function getLastLines(filePath: string, n: number): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = readline.createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });
    rl.on('line', (line) => {
      lines.push(line);
      if (lines.length > n * 2) lines.splice(0, lines.length - n);
    });
    rl.on('close', () => resolve(lines.slice(-n)));
    rl.on('error', () => resolve([]));
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const lines = parseInt(searchParams.get('lines') || '100', 10);

    // Find all openclaw log files
    let logFiles: string[] = [];
    if (existsSync(LOG_DIR)) {
      const files = readdirSync(LOG_DIR)
        .filter(f => f.startsWith('openclaw-') && f.endsWith('.log'))
        .map(f => join(LOG_DIR, f));
      logFiles = files;
    }

    if (logFiles.length === 0) {
      return NextResponse.json({ 
        lines: [], 
        message: 'No gateway log files found in /tmp/openclaw/',
        logFiles: [] 
      });
    }

    // Sort by name (date-based names sort chronologically)
    logFiles.sort();
    const latestLog = logFiles[logFiles.length - 1];

    const logLines = await getLastLines(latestLog, lines);

    // Parse NDJSON log lines into readable format
    const parsed = logLines.map((raw, i) => {
      try {
        const obj = JSON.parse(raw);
        const meta = obj._meta || {};
        return {
          id: i,
          raw,
          ts: meta.date || obj.time || new Date().toISOString(),
          level: meta.logLevelName || 'INFO',
          module: typeof obj['0'] === 'string' ? obj['0'] : JSON.stringify(obj['0'] || ''),
          message: typeof obj['1'] === 'string' ? obj['1'] : JSON.stringify(obj['1'] || ''),
          extra: obj['2'] ? (typeof obj['2'] === 'string' ? obj['2'] : JSON.stringify(obj['2'])) : null,
        };
      } catch {
        return {
          id: i,
          raw,
          ts: new Date().toISOString(),
          level: 'RAW',
          module: '',
          message: raw,
          extra: null,
        };
      }
    });

    return NextResponse.json({
      lines: parsed,
      logFile: latestLog,
      allLogFiles: logFiles.map(f => f.split('/').pop()),
      total: parsed.length,
    });
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Gateway logs error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
