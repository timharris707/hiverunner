/**
 * Sessions API
 * GET /api/sessions          → list local runtime sessions
 * GET /api/sessions?id=xxx   → get messages from a specific session (reads JSONL)
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolveOpenClawDir } from "@/lib/workspaces/root";

const LEGACY_RUNTIME_DIR = resolveOpenClawDir();

interface RawSession {
  key: string;
  kind: string;
  updatedAt: number;
  ageMs: number;
  sessionId?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
}

interface ParsedSession {
  id: string;
  key: string;
  type: 'main' | 'cron' | 'subagent' | 'direct' | 'unknown';
  typeLabel: string;
  typeEmoji: string;
  sessionId: string | null;
  cronJobId?: string;
  subagentId?: string;
  updatedAt: number;
  ageMs: number;
  model: string;
  modelProvider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  contextUsedPercent: number | null;
  aborted: boolean;
}

function parseSessionKey(key: string): {
  type: 'main' | 'cron' | 'subagent' | 'direct' | 'unknown';
  typeLabel: string;
  typeEmoji: string;
  cronJobId?: string;
  subagentId?: string;
  isRunEntry: boolean;
} {
  // Examples:
  // agent:main:main
  // agent:main:cron:<jobId>
  // agent:main:cron:<jobId>:run:<sessionId>
  // agent:main:subagent:<subagentId>
  // agent:main:telegram:<chatId> or agent:main:direct:<...>

  const parts = key.split(':');

  // Skip the ":run:" duplicate entries - these are redundant
  if (parts.includes('run')) {
    return { type: 'unknown', typeLabel: 'Run Entry', typeEmoji: '🔁', isRunEntry: true };
  }

  if (parts[2] === 'main') {
    return { type: 'main', typeLabel: 'Main Session', typeEmoji: '🦞', isRunEntry: false };
  }

  if (parts[2] === 'cron') {
    return {
      type: 'cron',
      typeLabel: 'Cron Job',
      typeEmoji: '🕐',
      cronJobId: parts[3],
      isRunEntry: false,
    };
  }

  if (parts[2] === 'subagent') {
    return {
      type: 'subagent',
      typeLabel: 'Sub-agent',
      typeEmoji: '🤖',
      subagentId: parts[3],
      isRunEntry: false,
    };
  }

  // telegram, direct, etc.
  return {
    type: 'direct',
    typeLabel: parts[2] ? `${parts[2].charAt(0).toUpperCase() + parts[2].slice(1)} Chat` : 'Direct Chat',
    typeEmoji: '💬',
    isRunEntry: false,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('id');

  // Return messages for a specific session
  if (sessionId) {
    return getSessionMessages(sessionId);
  }

  // Return list of all sessions
  return listSessions();
}

async function listSessions(): Promise<NextResponse> {
  try {
    const sessionsJsonPath = join(LEGACY_RUNTIME_DIR, 'agents', 'main', 'sessions', 'sessions.json');
    
    let sessionMap: Record<string, Record<string, unknown>> = {};
    if (existsSync(sessionsJsonPath)) {
      const raw = readFileSync(sessionsJsonPath, 'utf-8');
      sessionMap = JSON.parse(raw);
    }

    // Convert the key-value map to an array of RawSession objects
    const now = Date.now();
    const rawSessions: RawSession[] = Object.entries(sessionMap)
      .filter(([key]) => !key.includes(':run:')) // skip run entries
      .map(([key, value]) => {
        const v = value as Record<string, unknown>;
        const updatedAt = (v.updatedAt as number) || now;
        return {
          key,
          kind: 'session',
          updatedAt,
          ageMs: now - updatedAt,
          sessionId: v.sessionId as string | undefined,
          systemSent: v.systemSent as boolean | undefined,
          abortedLastRun: v.abortedLastRun as boolean | undefined,
          inputTokens: v.inputTokens as number | undefined,
          outputTokens: v.outputTokens as number | undefined,
          totalTokens: v.totalTokens as number | undefined,
          totalTokensFresh: v.totalTokensFresh as boolean | undefined,
          model: v.model as string | undefined,
          modelProvider: v.modelProvider as string | undefined,
          contextTokens: v.contextTokens as number | undefined,
        } as RawSession;
      });

    const sessions: ParsedSession[] = rawSessions
      .reduce<ParsedSession[]>((acc, raw) => {
        const parsed = parseSessionKey(raw.key);

        // Skip run-entry duplicates and unknown types
        if (parsed.isRunEntry || parsed.type === 'unknown') return acc;

        const totalTokens = raw.totalTokens || 0;
        const contextTokens = raw.contextTokens || 0;
        const contextUsedPercent =
          contextTokens > 0 && raw.totalTokensFresh
            ? Math.round((totalTokens / contextTokens) * 100)
            : null;

        acc.push({
          id: raw.key,
          key: raw.key,
          type: parsed.type,
          typeLabel: parsed.typeLabel,
          typeEmoji: parsed.typeEmoji,
          sessionId: raw.sessionId || null,
          cronJobId: parsed.cronJobId,
          subagentId: parsed.subagentId,
          updatedAt: raw.updatedAt,
          ageMs: raw.ageMs,
          model: raw.model || 'unknown',
          modelProvider: raw.modelProvider || 'anthropic',
          inputTokens: raw.inputTokens || 0,
          outputTokens: raw.outputTokens || 0,
          totalTokens,
          contextTokens,
          contextUsedPercent,
          aborted: raw.abortedLastRun || false,
        });
        return acc;
      }, []);

    // Sort by updatedAt desc
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);

    return NextResponse.json({ sessions, total: sessions.length });
  } catch (error) {
    console.error('[sessions] Error listing sessions:', error);
    return NextResponse.json({ error: 'Failed to list sessions', sessions: [] }, { status: 500 });
  }
}

interface JsonlContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
  arguments?: unknown;
}

interface JsonlLine {
  type: string;
  id?: string;
  timestamp?: string;
  message?: {
    role: string;
    content: string | JsonlContentBlock[];
    timestamp?: number;
    toolName?: string;
    toolCallId?: string;
  };
  provider?: string;
  modelId?: string;
  customType?: string;
  data?: unknown;
}

function isInternalControlUserText(text: string): boolean {
  const normalized = text.trim();
  return normalized.startsWith('A new session was started via /new or /reset.')
    || normalized.startsWith('Read HEARTBEAT.md if it exists')
    || normalized.startsWith('[Subagent Context]')
    || normalized.includes('[Subagent Task]:')
    || normalized.startsWith('System: [') && normalized.includes('Exec completed');
}

function classifyMessageRole(role: string | undefined, content: string): 'user' | 'assistant' | 'system' | 'tool_result' {
  if (role === 'toolResult') return 'tool_result';
  if (role === 'user') return isInternalControlUserText(content) ? 'system' : 'user';
  if (role === 'system') return 'system';
  return 'assistant';
}

async function getSessionMessages(sessionId: string): Promise<NextResponse> {
  // Security: only allow UUID-like session IDs
  if (!/^[a-f0-9-]{36}$/.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  const sessionsDir = join(LEGACY_RUNTIME_DIR, 'agents', 'main', 'sessions');
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Session not found', messages: [] }, { status: 404 });
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);

    interface ParsedMessage {
      id: string;
      type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'model_change' | 'system';
      role?: string;
      content: string;
      timestamp: string;
      model?: string;
      toolName?: string;
    }

    const messages: ParsedMessage[] = [];
    let currentModel = '';

    for (const line of lines) {
      try {
        const obj: JsonlLine = JSON.parse(line);

        if (obj.type === 'model_change' && obj.modelId) {
          currentModel = obj.modelId;
        }

        if (obj.type !== 'message' || !obj.message) continue;

        const msg = obj.message;
        const role = msg.role;
        const timestamp = obj.timestamp || new Date().toISOString();

        if (typeof msg.content === 'string') {
          messages.push({
            id: obj.id || Math.random().toString(),
            type: classifyMessageRole(role, msg.content),
            role,
            content: msg.content,
            timestamp,
            model: currentModel || undefined,
          });
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'thinking') continue;

            if (block.type === 'text' && block.text) {
              messages.push({
                id: (obj.id || '') + '-text',
                type: classifyMessageRole(role, block.text),
                role,
                content: block.text,
                timestamp,
                model: currentModel || undefined,
              });
            } else if ((block.type === 'tool_use' || block.type === 'toolCall') && block.name) {
              const input = block.input ?? block.arguments;
              messages.push({
                id: block.id || (obj.id || '') + '-tool',
                type: 'tool_use',
                role,
                content: `${block.name}(${input ? JSON.stringify(input).slice(0, 200) : ''})`,
                timestamp,
                toolName: block.name,
                model: currentModel || undefined,
              });
            } else if (block.type === 'tool_result' || role === 'toolResult') {
              const resultContent = (block.text as string) || '';
              messages.push({
                id: (obj.id || '') + '-result',
                type: 'tool_result',
                role,
                content: resultContent.slice(0, 500),
                timestamp,
                toolName: msg.toolName,
                model: currentModel || undefined,
              });
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return NextResponse.json({
      sessionId,
      messages,
      total: messages.length,
    });
  } catch (error) {
    console.error('[sessions] Error reading session file:', error);
    return NextResponse.json({ error: 'Failed to read session', messages: [] }, { status: 500 });
  }
}
