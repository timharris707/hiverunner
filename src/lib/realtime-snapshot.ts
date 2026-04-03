import { getAgentStatusSnapshot } from "@/lib/agent-status";
import { getAdvisorySessionsList } from "@/lib/advisory-sessions";
import { getDashboardHighlights, type DashboardHighlights } from "@/lib/dashboard-highlights";
import { getDashboardStats, type DashboardStats } from "@/lib/dashboard-stats";
import { getIdeasProcessedState } from "@/lib/ideas";
import { getProjects } from "@/lib/projects";
import { getSystemStats, type SystemStats } from "@/lib/system-stats";
import { readTasks } from "@/lib/build-queue";

function readTasksSafely(): any[] {
  try {
    return readTasks();
  } catch (error) {
    console.error("[realtime-snapshot] Falling back to empty tasks after readTasks failure:", error);
    return [];
  }
}

export interface MissionControlRealtimeSnapshot {
  generatedAt: string;
  dashStats: DashboardStats;
  highlights: DashboardHighlights;
  tasks: any[];
  projects: any[];
  advisorySessions: any[];
  agentStatuses: Record<string, any>;
  systemStats: SystemStats;
  ideas: {
    processedIds: string[];
    unprocessedIds: string[];
    unprocessedCount: number;
  };
}

export async function getMissionControlRealtimeSnapshot(now = Date.now()): Promise<MissionControlRealtimeSnapshot> {
  const [ideas, systemStats] = await Promise.all([
    getIdeasProcessedState(),
    getSystemStats(now),
  ]);

  const agentStatusSnapshot = getAgentStatusSnapshot(now);
  const agentStatuses = Object.fromEntries(
    (agentStatusSnapshot.agents || []).map((agent: any) => [agent.id, agent]),
  );

  return {
    generatedAt: new Date(now).toISOString(),
    dashStats: getDashboardStats(now),
    highlights: getDashboardHighlights(now),
    tasks: readTasksSafely(),
    projects: getProjects(),
    advisorySessions: getAdvisorySessionsList().slice(0, 10),
    agentStatuses,
    systemStats,
    ideas,
  };
}
