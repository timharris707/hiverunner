import RunTraceRoutePage from "@/components/orchestration/RunTraceRoutePage";

export default function RunTraceFallbackPage({
  params,
}: {
  params: Promise<{ slug: string; runId: string }>;
}) {
  return <RunTraceRoutePage params={params} routeKind="global" />;
}
