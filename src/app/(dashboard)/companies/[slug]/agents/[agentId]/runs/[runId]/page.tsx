import RunTraceRoutePage from "@/components/orchestration/RunTraceRoutePage";

export default function AgentRunDetailPage({
  params,
}: {
  params: Promise<{ slug: string; agentId: string; runId: string }>;
}) {
  return <RunTraceRoutePage params={params} routeKind="agent" />;
}
