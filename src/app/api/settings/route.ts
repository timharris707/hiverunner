import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/Users/timharris/.openclaw';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const configPath = `${OPENCLAW_DIR}/openclaw.json`;
    if (!existsSync(configPath)) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Sanitize secrets before sending to frontend
    const sanitized = JSON.parse(JSON.stringify(config));
    
    // Redact sensitive values
    if (sanitized?.channels?.telegram?.botToken) {
      sanitized.channels.telegram.botToken = '***redacted***';
    }
    if (sanitized?.gateway?.auth?.token) {
      sanitized.gateway.auth.token = '***redacted***';
    }
    if (sanitized?.env) {
      for (const key of Object.keys(sanitized.env)) {
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
          sanitized.env[key] = '***redacted***';
        }
      }
    }
    if (sanitized?.skills?.entries) {
      for (const skill of Object.values(sanitized.skills.entries) as any[]) {
        if (skill?.apiKey) skill.apiKey = '***redacted***';
      }
    }
    if (sanitized?.plugins?.entries) {
      for (const plugin of Object.values(sanitized.plugins.entries) as any[]) {
        if (plugin?.config?.webSearch?.apiKey) plugin.config.webSearch.apiKey = '***redacted***';
      }
    }
    if (sanitized?.auth?.profiles) {
      for (const profile of Object.values(sanitized.auth.profiles) as any[]) {
        if (profile?.token) profile.token = '***redacted***';
        if (profile?.apiKey) profile.apiKey = '***redacted***';
      }
    }

    return NextResponse.json({ config: sanitized });
  } catch (err) {
    console.error('Settings error:', err);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}
