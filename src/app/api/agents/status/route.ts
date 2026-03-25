/**
 * Agent Status API
 * GET /api/agents/status → Returns live status for all org agents based on active OpenClaw sessions
 *
 * Logic:
 * - Henry always shows "online" if the sessions file is readable (gateway reachability proxy)
 * - Subagents active within the last 2 hours map to org agents via label keyword matching
 * - Agents with no active sessions show "pending" (gray / Not Deployed)
 */
import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const OPENCLAW_DIR = process.env.OPENCLAW_DIR || '/Users/timharris/.openclaw';
const SESSIONS_FILE = join(OPENCLAW_DIR, 'agents', 'main', 'sessions', 'sessions.json');

// How recent a session must be to count as "active" (2 hours)
const ACTIVE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

// Keyword → agent ID mapping for label matching
const LABEL_TO_AGENT: Array<{ keywords: string[]; agentId: string }> = [
  { keywords: ['crypto', 'cipher', 'ccxt', 'bitcoin', 'btc'], agentId: 't3' },
  { keywords: ['atlas', 'stock', 'options', 'equity'], agentId: 't1' },
  { keywords: ['nimbus', 'weather', 'polymarket', 'kalshi', 'weather-trading', 'weather-auto'], agentId: 't2' },
  { keywords: ['quant', 'strategy', 'backtest', 'quantitative'], agentId: 'quant' },
  { keywords: ['forge', 'backend', 'infra', 'infrastructure', 'database', 'supabase'], agentId: 'backend' },
  { keywords: ['pixel', 'fullstack', 'dashboard', 'mission-control', 'ui', 'frontend'], agentId: 'fullstack' },
  { keywords: ['scout', 'research', 'intel'], agentId: 'scout' },
  { keywords: ['quill', 'creative', 'content', 'marketing', 'copy'], agentId: 'quill' },
  { keywords: ['counsel', 'legal', 'compliance', 'contract'], agentId: 'counsel' },
];

type AgentStatus = 'online' | 'active' | 'building' | 'pending' | 'offline';

interface AgentStatusEntry {
  id: string;
  status: AgentStatus;
  label?: string; // most recent active session label if any
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

export async function GET(): Promise<NextResponse> {
  try {
    // Check if sessions file exists (gateway reachability proxy)
    const gatewayReachable = existsSync(SESSIONS_FILE);

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

    if (gatewayReachable) {
      const raw = readFileSync(SESSIONS_FILE, 'utf-8');
      const sessionMap: Record<string, Record<string, unknown>> = JSON.parse(raw);
      const now = Date.now();

      // Find all active subagent sessions
      const activeSessions: Array<{ key: string; label: string; ageMs: number }> = [];

      for (const [key, value] of Object.entries(sessionMap)) {
        // Skip non-subagent and run entries
        if (!key.includes(':subagent:') || key.includes(':run:')) continue;

        const updatedAt = (value.updatedAt as number) || 0;
        const ageMs = now - updatedAt;
        if (ageMs > ACTIVE_THRESHOLD_MS) continue;

        const label = (value.label as string) || '';
        activeSessions.push({ key, label, ageMs });
      }

      // Sort by most recent first
      activeSessions.sort((a, b) => a.ageMs - b.ageMs);

      // Map active sessions to agents
      const mappedAgents = new Set<string>();
      for (const session of activeSessions) {
        const agentId = matchLabelToAgent(session.label);
        if (agentId && !mappedAgents.has(agentId)) {
          mappedAgents.add(agentId);
          // Very recent (< 10 min) = building, otherwise active
          const status: AgentStatus = session.ageMs < 10 * 60 * 1000 ? 'building' : 'active';
          agentStatuses[agentId] = {
            id: agentId,
            status,
            label: session.label,
          };
        }
      }
    }

    return NextResponse.json({
      agents: Object.values(agentStatuses),
      gatewayReachable,
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
