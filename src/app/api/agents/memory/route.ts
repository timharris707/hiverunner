/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { readAgentMemory, listAgentsWithMemory, readAgentMarkdownMemory } from "@/lib/agent-pipeline";

export const dynamic = "force-dynamic";

/**
 * GET /api/agents/memory — List all agents with memory, or a specific agent's memory
 * Query params:
 *   ?agentId=pixel — get a specific agent's memory
 *   (no params) — list all agents with memory summaries
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");

    if (agentId) {
      const memory = readAgentMemory(agentId);
      const markdownMemory = readAgentMarkdownMemory(agentId);
      return NextResponse.json({ ...memory, markdownMemory });
    }

    const allMemory = listAgentsWithMemory();
    const summaries = allMemory.map((m) => ({
      agentId: m.agentId,
      agentName: m.agentName,
      role: m.role,
      entryCount: m.entries.length,
      lastUpdated: m.lastUpdated,
      recentTasks: m.entries.slice(0, 3).map((e) => ({
        taskTitle: e.taskTitle,
        project: e.project,
        timestamp: e.timestamp,
      })),
    }));

    return NextResponse.json({ agents: summaries });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
