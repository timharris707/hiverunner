import type { LiveRun } from "@/hooks/useLiveRuns";
import type { OrchestrationAgent } from "@/lib/orchestration/types";

type LiveRunState = Pick<LiveRun, "status" | "finishedAt" | "liveIndicatorUntil">;
type LiveRunLookup = Map<string, LiveRunState>;

export function isRunLive(runOrStatus?: string | LiveRunState | null, now = Date.now()): boolean {
  if (!runOrStatus) return false;

  if (typeof runOrStatus === "string") {
    return runOrStatus === "queued" || runOrStatus === "pending" || runOrStatus === "running";
  }

  if (isRunLive(runOrStatus.status, now)) return true;

  if (runOrStatus.liveIndicatorUntil) {
    const liveUntilMs = new Date(runOrStatus.liveIndicatorUntil).getTime();
    return Number.isFinite(liveUntilMs) && liveUntilMs > now;
  }

  return false;
}

export function isAgentLive(input: {
  agentId: string;
  agentStatus?: OrchestrationAgent["status"];
  liveAgentIds?: ReadonlySet<string>;
  liveRunsByAgentId?: LiveRunLookup;
}): boolean {
  const liveRun = input.liveRunsByAgentId?.get(input.agentId);
  if (liveRun) {
    return isRunLive(liveRun);
  }

  return input.liveAgentIds?.has(input.agentId) ?? false;
}
