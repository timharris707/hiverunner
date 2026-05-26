import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveOpenClawDir } from "@/lib/workspaces/root";

export const dynamic = "force-dynamic";

interface Agent {
  id: string;
  name?: string;
  emoji: string;
  color: string;
  model: string;
  workspace: string;
  dmPolicy?: string;
  allowAgents?: string[];
  allowAgentsDetails?: Array<{
    id: string;
    name: string;
    emoji: string;
    color: string;
  }>;
  botToken?: string;
  status: "online" | "offline";
  lastActivity?: string;
  activeSessions: number;
}

// Fallback config used when an agent doesn't define its own ui config in openclaw.json.
// The main agent reads name/emoji from env vars; all others fall back to generic defaults.
// Override via each agent's openclaw.json → ui.emoji / ui.color / name fields.
const DEFAULT_AGENT_CONFIG: Record<string, { emoji: string; color: string; name?: string }> = {
  main: {
    emoji: process.env.NEXT_PUBLIC_AGENT_EMOJI || "⚡",
    color: "#f59e0b",
    name: process.env.NEXT_PUBLIC_AGENT_NAME || "HiveRunner",
  },
};

/**
 * Get agent display info (emoji, color, name) from openclaw.json or defaults
 */
function getAgentDisplayInfo(agentId: string, agentConfig: any): { emoji: string; color: string; name: string } {
  // First try to get from agent's own config in openclaw.json
  const configEmoji = agentConfig?.ui?.emoji;
  const configColor = agentConfig?.ui?.color;
  const configName = agentConfig?.name;

  // Then try defaults
  const defaults = DEFAULT_AGENT_CONFIG[agentId];

  return {
    emoji: configEmoji || defaults?.emoji || "🤖",
    color: configColor || defaults?.color || "#666666",
    name: configName || defaults?.name || agentId,
  };
}

function resolveAgentWorkspace(agent: any, openclawDir: string, config: any): string {
  if (typeof agent?.workspace === "string" && agent.workspace.trim().length > 0) {
    return agent.workspace;
  }

  const defaultWorkspace = config?.agents?.defaults?.workspace;
  if (typeof defaultWorkspace === "string" && defaultWorkspace.trim().length > 0) {
    return defaultWorkspace;
  }

  return join(openclawDir, "workspace");
}

export async function GET() {
  try {
    // Read openclaw config
    const OPENCLAW_DIR = resolveOpenClawDir();
    const configPath = OPENCLAW_DIR + "/openclaw.json";
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    // Build agent list: use config.agents.list if it exists, otherwise synthesize from defaults
    const agentList: any[] = config.agents?.list ?? [
      {
        id: "main",
        name: process.env.NEXT_PUBLIC_AGENT_NAME || "HiveRunner",
        workspace: config.agents?.defaults?.workspace || join(OPENCLAW_DIR, "workspace"),
        subagents: config.agents?.defaults?.subagents,
      },
    ];

    // Get agents from config
    const agents: Agent[] = agentList.map((agent: any) => {
      const agentInfo = getAgentDisplayInfo(agent.id, agent);
      const workspace = resolveAgentWorkspace(agent, OPENCLAW_DIR, config);

      // Get telegram account info
      const telegramAccount =
        config.channels?.telegram?.accounts?.[agent.id];
      const botToken = telegramAccount?.botToken;

      // Check if agent has recent activity
      const memoryPath = join(workspace, "memory");
      let lastActivity = undefined;
      let status: "online" | "offline" = "offline";

      try {
        const today = new Date().toISOString().split("T")[0];
        const memoryFile = join(memoryPath, `${today}.md`);
        const stat = require("fs").statSync(memoryFile);
        lastActivity = stat.mtime.toISOString();
        // Consider online if activity within last 5 minutes
        status =
          Date.now() - stat.mtime.getTime() < 5 * 60 * 1000
            ? "online"
            : "offline";
      } catch (e) {
        // No recent activity
      }

      // Get details of allowed subagents
      const allowAgents = agent.subagents?.allowAgents || [];
      const allowAgentsDetails = allowAgents.map((subagentId: string) => {
        // Find subagent in config
        const subagentConfig = agentList.find(
          (a: any) => a.id === subagentId
        );
        if (subagentConfig) {
          const subagentInfo = getAgentDisplayInfo(subagentId, subagentConfig);
          return {
            id: subagentId,
            name: subagentConfig.name || subagentInfo.name,
            emoji: subagentInfo.emoji,
            color: subagentInfo.color,
          };
        }
        // Fallback if subagent not found in config
        const fallbackInfo = getAgentDisplayInfo(subagentId, null);
        return {
          id: subagentId,
          name: fallbackInfo.name,
          emoji: fallbackInfo.emoji,
          color: fallbackInfo.color,
        };
      });

      return {
        id: agent.id,
        name: agent.name || agentInfo.name,
        emoji: agentInfo.emoji,
        color: agentInfo.color,
        model:
          agent.model?.primary || config.agents.defaults.model.primary,
        workspace,
        dmPolicy:
          telegramAccount?.dmPolicy ||
          config.channels?.telegram?.dmPolicy ||
          "pairing",
        allowAgents,
        allowAgentsDetails,
        botToken: botToken ? "configured" : undefined,
        status,
        lastActivity,
        activeSessions: 0, // TODO: get from sessions API
      };
    });

    return NextResponse.json({ agents });
  } catch (error) {
    console.error("Error reading agents:", error);
    return NextResponse.json(
      { error: "Failed to load agents" },
      { status: 500 }
    );
  }
}
