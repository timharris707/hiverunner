import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { resolveOpenClawDir } from "@/lib/workspaces/root";

export const ACTIVE_THRESHOLD_MS = 2 * 60 * 60 * 1000;
export const BUILDING_THRESHOLD_MS = 10 * 60 * 1000;

const OPENCLAW_DIR = resolveOpenClawDir();
const SESSIONS_FILE = join(OPENCLAW_DIR, "agents", "main", "sessions", "sessions.json");

const LABEL_TO_AGENT: Array<{ keywords: string[]; agentId: string }> = [
  { keywords: ["strategy", "backtest", "quantitative", "analysis", "research"], agentId: "scout" },
  { keywords: ["forge", "backend", "infra", "infrastructure", "database", "supabase", "docker", "ci-cd", "deploy"], agentId: "backend" },
  { keywords: ["pixel", "fullstack", "full-stack", "dashboard", "hiverunner", "ui", "frontend", "next.js", "nextjs", "react"], agentId: "fullstack" },
  { keywords: ["scout", "research", "intel", "intelligence", "opportunity", "trend"], agentId: "scout" },
  { keywords: ["quill", "creative", "content", "marketing", "copy", "insight-marketing", "blog", "newsletter"], agentId: "quill" },
  { keywords: ["counsel", "legal", "compliance", "contract", "regulatory", "privacy", "terms"], agentId: "counsel" },
];

export type AgentStatus = "online" | "active" | "building" | "pending" | "offline";

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
    if (mapping.keywords.some((keyword) => lower.includes(keyword))) {
      return mapping.agentId;
    }
  }
  return null;
}

export function readSessionsFile(): Record<string, Record<string, unknown>> | null {
  try {
    if (!existsSync(SESSIONS_FILE)) return null;
    return JSON.parse(readFileSync(SESSIONS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function getGatewayConfig(): { port: number; token: string } | null {
  try {
    const configPath = join(OPENCLAW_DIR, "openclaw.json");
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      port: config.gateway?.port || 18789,
      token: config.gateway?.auth?.token || "",
    };
  } catch {
    return null;
  }
}

export function getAgentStatusSnapshot(now = Date.now()): {
  agents: AgentStatusEntry[];
  gatewayReachable: boolean;
  gatewayPort?: number;
  updatedAt: number;
} {
  const sessionMap = readSessionsFile();
  const gatewayConfig = getGatewayConfig();
  const gatewayReachable = sessionMap !== null;

  const agentStatuses: Record<string, AgentStatusEntry> = {
    coordinator: { id: "coordinator", status: gatewayReachable ? "online" : "offline" },
    backend: { id: "backend", status: "pending" },
    fullstack: { id: "fullstack", status: "pending" },
    scout: { id: "scout", status: "pending" },
    quill: { id: "quill", status: "pending" },
    counsel: { id: "counsel", status: "pending" },
  };

  if (sessionMap) {
    const mainSession = sessionMap["agent:main:main"];
    if (mainSession) {
      const updatedAt = (mainSession.updatedAt as number) || 0;
      agentStatuses.coordinator = {
        id: "coordinator",
        status: "online",
        lastActivity: updatedAt,
        model: (mainSession.model as string) || undefined,
        activeSessions: 0,
      };
    }

    const activeSessions: Array<{
      label: string;
      ageMs: number;
      updatedAt: number;
      model?: string;
    }> = [];

    for (const [key, value] of Object.entries(sessionMap)) {
      if (!key.includes(":subagent:") && !key.includes(":cron:")) continue;
      if (key.includes(":run:")) continue;

      const updatedAt = (value.updatedAt as number) || 0;
      const ageMs = now - updatedAt;
      if (ageMs > ACTIVE_THRESHOLD_MS) continue;

      activeSessions.push({
        label: (value.label as string) || "",
        ageMs,
        updatedAt,
        model: (value.model as string) || undefined,
      });
    }

    activeSessions.sort((a, b) => a.ageMs - b.ageMs);
    agentStatuses.coordinator.activeSessions = activeSessions.length;

    const agentSessionCounts: Record<string, number> = {};

    for (const session of activeSessions) {
      const agentId = matchLabelToAgent(session.label);
      if (!agentId) continue;

      agentSessionCounts[agentId] = (agentSessionCounts[agentId] || 0) + 1;

      if (agentStatuses[agentId]?.status === "pending") {
        agentStatuses[agentId] = {
          id: agentId,
          status: session.ageMs < BUILDING_THRESHOLD_MS ? "building" : "active",
          label: session.label,
          lastActivity: session.updatedAt,
          activeSessions: agentSessionCounts[agentId],
          model: session.model,
        };
      } else {
        agentStatuses[agentId].activeSessions = agentSessionCounts[agentId];
      }
    }
  }

  return {
    agents: Object.values(agentStatuses),
    gatewayReachable,
    gatewayPort: gatewayConfig?.port,
    updatedAt: now,
  };
}
