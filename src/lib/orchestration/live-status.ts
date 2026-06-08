import type { LiveRun } from "@/hooks/useLiveRuns";
import type { OrchestrationAgent } from "@/lib/orchestration/types";

type LiveRunState = Pick<LiveRun, "status" | "finishedAt" | "liveIndicatorUntil">;
type LiveRunLookup = Map<string, LiveRunState>;

export function isRunActivelyRunning(runOrStatus?: string | LiveRunState | null): boolean {
  const status = typeof runOrStatus === "string" ? runOrStatus : runOrStatus?.status;
  return status === "running";
}

export function isRunLive(runOrStatus?: string | LiveRunState | null, now = Date.now()): boolean {
  if (!runOrStatus) return false;

  if (typeof runOrStatus === "string") {
    return isRunActivelyRunning(runOrStatus);
  }

  if (isRunActivelyRunning(runOrStatus)) return true;

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

export function isAgentActivelyRunning(input: {
  agentId: string;
  liveRunsByAgentId?: LiveRunLookup;
}): boolean {
  return isRunActivelyRunning(input.liveRunsByAgentId?.get(input.agentId));
}
