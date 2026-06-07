import RunTraceRoutePage from "@/components/orchestration/RunTraceRoutePage";

export default function TaskRunTracePage({
  params,
}: {
  params: Promise<{ slug: string; taskKey: string; runId: string }>;
}) {
  return <RunTraceRoutePage params={params} routeKind="task" />;
}
