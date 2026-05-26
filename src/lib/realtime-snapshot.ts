import { getAgentStatusSnapshot } from "@/lib/agent-status";
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
    // Legacy tasks.db read — degrade gracefully but log loudly.
    // This is the OLD task system (build-queue / tasks.db). Its failure must
    // not crash the app or block the realtime snapshot. The live task
    // experience now runs on orchestration.db via /api/orchestration/tasks.
    console.error("[realtime-snapshot] LEGACY tasks.db read failed — returning [] (legacy system degradation):", error);
    return [];
  }
}

export interface HiveRunnerRealtimeSnapshot {
  generatedAt: string;
  dashStats: DashboardStats;
  highlights: DashboardHighlights;
  tasks: any[];
  projects: any[];
  agentStatuses: Record<string, any>;
  systemStats: SystemStats;
  ideas: {
    processedIds: string[];
    unprocessedIds: string[];
    unprocessedCount: number;
  };
}

export async function getHiveRunnerRealtimeSnapshot(now = Date.now()): Promise<HiveRunnerRealtimeSnapshot> {
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
    agentStatuses,
    systemStats,
    ideas,
  };
}
