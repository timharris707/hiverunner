/**
 * Agent Status API — /api/agents/status
 *
 * Polls the OpenClaw gateway sessions endpoint (or falls back to sessions.json)
 * to determine live agent status. Maps subagent session labels to org agent IDs.
 *
 * Status logic:
 * - Henry → "online" if gateway is reachable, "offline" otherwise
 * - Other agents → "building" if active session < 10 min, "active" if < 2h, "pending" otherwise
 *
 * Returns:
 * {
 *   agents: AgentStatusEntry[],
 *   gatewayReachable: boolean,
 *   updatedAt: number
 * }
 */
import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/Users/timharris/.openclaw';
const SESSIONS_FILE = join(OPENCLAW_DIR, 'agents', 'main', 'sessions', 'sessions.json');

// How recent a session must be to count as "active" (2 hours)
const ACTIVE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
// Very recent = "building" (10 min)
const BUILDING_THRESHOLD_MS = 10 * 60 * 1000;

// Keyword → agent ID mapping for session label matching
const LABEL_TO_AGENT: Array<{ keywords: string[]; agentId: string }> = [
  { keywords: ['crypto', 'cipher', 'ccxt', 'bitcoin', 'btc', 'binance', 'coinbase'], agentId: 't3' },
  { keywords: ['atlas', 'stock', 'options', 'equity', 'equities', 'polygon'], agentId: 't1' },
  { keywords: ['nimbus', 'weather', 'polymarket', 'kalshi', 'weather-trading', 'weather-auto', 'noaa'], agentId: 't2' },
  { keywords: ['quant', 'strategy', 'backtest', 'quantitative', 'karpathy', 'autoresearch'], agentId: 'quant' },
  { keywords: ['forge', 'backend', 'infra', 'infrastructure', 'database', 'supabase', 'docker', 'ci-cd', 'deploy'], agentId: 'backend' },
  { keywords: ['pixel', 'fullstack', 'full-stack', 'dashboard', 'mission-control', 'ui', 'frontend', 'next.js', 'nextjs', 'react'], agentId: 'fullstack' },
  { keywords: ['scout', 'research', 'intel', 'intelligence', 'opportunity', 'trend'], agentId: 'scout' },
  { keywords: ['quill', 'creative', 'content', 'marketing', 'copy', 'insight-marketing', 'blog', 'newsletter'], agentId: 'quill' },
  { keywords: ['counsel', 'legal', 'compliance', 'contract', 'regulatory', 'privacy', 'terms'], agentId: 'counsel' },
];

export type AgentStatus = 'online' | 'active' | 'building' | 'pending' | 'offline';

export interface AgentStatusEntry {
  id: string;
  status: AgentStatus;
  label?: string;
  lastActivity?: number;
  activeSessions?: number;
  model?: string;
}

function matchLabelToAgent(label: string): string | null {
  const lower = label.toLowerCase();
  for (const mapping of LABEL_TO_AGENT) {
    if (mapping.keywords.some(kw => lower.includes(kw))) {
      return mapping.agentId;
    }
  }
  return null;
}

/**
 * Read sessions from the local sessions.json file.
 * This is the primary data source — the gateway doesn't expose a REST sessions list.
 */
function readSessionsFile(): Record<string, Record<string, unknown>> | null {
  try {
    if (!existsSync(SESSIONS_FILE)) return null;
    const raw = readFileSync(SESSIONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read gateway config to check reachability.
 */
function getGatewayConfig(): { port: number; token: string } | null {
  try {
    const configPath = join(OPENCLAW_DIR, 'openclaw.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      port: config.gateway?.port || 18789,
      token: config.gateway?.auth?.token || '',
    };
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const sessionMap = readSessionsFile();
    const gatewayConfig = getGatewayConfig();
    const gatewayReachable = sessionMap !== null;

    // Initialize all agents as pending
    const agentStatuses: Record<string, AgentStatusEntry> = {
      henry: { id: 'henry', status: gatewayReachable ? 'online' : 'offline' },
      t1: { id: 't1', status: 'pending' },
      t2: { id: 't2', status: 'pending' },
      t3: { id: 't3', status: 'pending' },
      quant: { id: 'quant', status: 'pending' },
      backend: { id: 'backend', status: 'pending' },
      fullstack: { id: 'fullstack', status: 'pending' },
      scout: { id: 'scout', status: 'pending' },
      quill: { id: 'quill', status: 'pending' },
      counsel: { id: 'counsel', status: 'pending' },
    };

    // Check Henry's main session for actual activity
    if (sessionMap) {
      const mainSession = sessionMap['agent:main:main'];
      if (mainSession) {
        const updatedAt = (mainSession.updatedAt as number) || 0;
        const ageMs = Date.now() - updatedAt;
        agentStatuses.henry = {
          id: 'henry',
          status: ageMs < ACTIVE_THRESHOLD_MS ? 'online' : 'online', // Henry is always "online" if gateway is reachable
          lastActivity: updatedAt,
          model: (mainSession.model as string) || undefined,
          activeSessions: 0,
        };
      }

      const now = Date.now();

      // Collect ALL subagent sessions with their ages
      const activeSessions: Array<{
        key: string;
        label: string;
        ageMs: number;
        updatedAt: number;
        model?: string;
      }> = [];

      for (const [key, value] of Object.entries(sessionMap)) {
        // Include subagent sessions and cron sessions
        if (!key.includes(':subagent:') && !key.includes(':cron:')) continue;
        // Skip run entries (duplicate tracking)
        if (key.includes(':run:')) continue;

        const updatedAt = (value.updatedAt as number) || 0;
        const ageMs = now - updatedAt;
        if (ageMs > ACTIVE_THRESHOLD_MS) continue;

        const label = (value.label as string) || '';
        activeSessions.push({
          key,
          label,
          ageMs,
          updatedAt,
          model: (value.model as string) || undefined,
        });
      }

      // Sort by most recent first
      activeSessions.sort((a, b) => a.ageMs - b.ageMs);

      // Count Henry's active sessions
      let henryActiveSessions = activeSessions.length;
      agentStatuses.henry.activeSessions = henryActiveSessions;

      // Map sessions to specific agents
      // Track per-agent: most recent match and total session count
      const agentSessionCounts: Record<string, number> = {};

      for (const session of activeSessions) {
        const agentId = matchLabelToAgent(session.label);
        if (!agentId) continue;

        agentSessionCounts[agentId] = (agentSessionCounts[agentId] || 0) + 1;

        // Only update status for the first (most recent) match per agent
        if (agentStatuses[agentId]?.status === 'pending') {
          const status: AgentStatus = session.ageMs < BUILDING_THRESHOLD_MS ? 'building' : 'active';
          agentStatuses[agentId] = {
            id: agentId,
            status,
            label: session.label,
            lastActivity: session.updatedAt,
            activeSessions: agentSessionCounts[agentId],
            model: session.model,
          };
        } else {
          // Update session count for already-mapped agent
          agentStatuses[agentId].activeSessions = agentSessionCounts[agentId];
        }
      }
    }

    return NextResponse.json({
      agents: Object.values(agentStatuses),
      gatewayReachable,
      gatewayPort: gatewayConfig?.port,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error('[agents/status] Error:', error);
    return NextResponse.json(
      {
        agents: [],
        gatewayReachable: false,
        updatedAt: Date.now(),
        error: 'Failed to read agent status',
      },
      { status: 500 },
    );
  }
}
