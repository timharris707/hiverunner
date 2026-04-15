import type { LiveRun } from "@/hooks/useLiveRuns";
import type { OrchestrationAgent } from "@/lib/orchestration/types";

type LiveRunLookup = Map<string, Pick<LiveRun, "status">>;

export function isRunLive(status?: string | null): boolean {
  return status === "queued" || status === "pending" || status === "running";
}

export function isAgentLive(input: {
  agentId: string;
  agentStatus?: OrchestrationAgent["status"];
  liveAgentIds?: ReadonlySet<string>;
  liveRunsByAgentId?: LiveRunLookup;
}): boolean {
  const liveRun = input.liveRunsByAgentId?.get(input.agentId);
  if (liveRun) {
    return isRunLive(liveRun.status);
  }

  if (input.liveAgentIds?.has(input.agentId)) {
    return true;
  }

  return input.agentStatus === "working";
}
