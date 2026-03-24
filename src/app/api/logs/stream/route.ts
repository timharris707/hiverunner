/**
 * Real-time log streaming via SSE
 * GET /api/logs/stream?service=<name>&backend=<pm2|systemd|file|gateway>
 */
import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const ALLOWED_SERVICES = ['mission-control', 'classvault', 'content-vault', 'postiz-simple', 'brain', 'openclaw-gateway', 'openclaw-log'];

const LOG_DIR = '/tmp/openclaw';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const service = searchParams.get('service') || 'openclaw-log';
  const backend = searchParams.get('backend') || 'gateway';

  if (!ALLOWED_SERVICES.includes(service)) {
    return new Response('Service not allowed', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line: data, ts: new Date().toISOString() })}\n\n`));
        } catch {}
      };

      send(`[stream] Connected to ${service} (${backend})`);

      // Gateway log file streaming
      if (backend === 'gateway' || service === 'openclaw-log') {
        // Find the latest openclaw log
        let logFile: string | null = null;
        if (existsSync(LOG_DIR)) {
          const files = readdirSync(LOG_DIR)
            .filter(f => f.startsWith('openclaw-') && f.endsWith('.log'))
            .sort();
          if (files.length > 0) {
            logFile = join(LOG_DIR, files[files.length - 1]);
          }
        }

        if (!logFile) {
          send('[error] No gateway log file found in /tmp/openclaw/');
          try { controller.close(); } catch {}
          return;
        }

        send(`[stream] Tailing ${logFile}`);

        // Use tail -f to follow the log
        const proc = spawn('tail', ['-n', '80', '-f', logFile], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const raw of lines) {
            // Try to parse NDJSON and make it human-readable
            try {
              const obj = JSON.parse(raw);
              const meta = obj._meta || {};
              const level = meta.logLevelName || 'INFO';
              const module = typeof obj['0'] === 'string' ? obj['0'] : JSON.stringify(obj['0'] || '');
              const msg = typeof obj['1'] === 'string' ? obj['1'] : JSON.stringify(obj['1'] || '');
              const extra = obj['2'] ? (typeof obj['2'] === 'string' ? ` | ${obj['2']}` : ` | ${JSON.stringify(obj['2'])}`) : '';
              const time = obj.time || meta.date || '';
              const timeStr = time ? new Date(time).toLocaleTimeString() : '';
              send(`[${level}] ${timeStr} ${module} — ${msg}${extra}`);
            } catch {
              send(raw);
            }
          }
        });

        proc.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) send(line);
        });

        proc.on('error', (err) => {
          send(`[error] ${err.message}`);
          try { controller.close(); } catch {}
        });

        proc.on('close', () => {
          send('[stream] Tail ended');
          try { controller.close(); } catch {}
        });

        request.signal?.addEventListener('abort', () => {
          proc.kill();
          try { controller.close(); } catch {}
        });
        return;
      }

      // Other services (pm2 / systemd)
      let cmd: string[];
      if (backend === 'pm2') {
        cmd = ['pm2', 'logs', service, '--lines', '50', '--nocolor'];
      } else {
        cmd = ['journalctl', '-u', service, '-n', '50', '--no-pager', '-f'];
      }

      const proc = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) send(line);
      });

      proc.stderr.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) send(line);
      });

      proc.on('error', (err) => {
        send(`[error] ${err.message}`);
        try { controller.close(); } catch {}
      });

      proc.on('close', () => {
        send('[stream] Process ended');
        try { controller.close(); } catch {}
      });

      request.signal?.addEventListener('abort', () => {
        proc.kill();
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
