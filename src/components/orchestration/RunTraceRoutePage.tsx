"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader } from "lucide-react";
import { useLiveStream } from "@/components/live/LiveStreamProvider";
import type { StreamTranscriptEntry } from "@/hooks/useLiveRunStream";
import { buildCanonicalCompanyPath, buildCompanyPath } from "@/lib/orchestration/route-paths";
import type { MCLiveEventKind } from "@/lib/orchestration/live-events";
import { P as tokens } from "@/lib/ui/tokens";
import {
  RunTraceView,
  type RunEventsResponse,
  type RunTraceRouteKind,
  type TimelineEvent,
} from "@/components/orchestration/RunTraceView";

export type RunTraceRouteParams = {
  slug: string;
  agentId?: string;
  taskKey?: string;
  runId: string;
};

type CompanyRouteContext = {
  companyCode: string;
  usesShortCompanyCode: boolean;
};

function resolveCompanyRouteContext(slug: string): CompanyRouteContext {
  if (typeof window === "undefined") {
    return { companyCode: slug, usesShortCompanyCode: false };
  }

  const segments = window.location.pathname.split("/").filter(Boolean);
  const root = segments[0] ?? slug;
  if (root === "companies") {
    return { companyCode: slug, usesShortCompanyCode: false };
  }

  return { companyCode: root, usesShortCompanyCode: true };
}

function buildCompanyScopedHref(context: CompanyRouteContext, slug: string, subpath: string): string {
  if (context.usesShortCompanyCode) {
    return buildCanonicalCompanyPath(context.companyCode, subpath);
  }

  return buildCompanyPath(slug, subpath);
}

export default function RunTraceRoutePage({
  params,
  routeKind = "agent",
}: {
  params: Promise<RunTraceRouteParams>;
  routeKind?: RunTraceRouteKind;
}) {
  const { slug, agentId, taskKey, runId } = use(params);
  const [data, setData] = useState<RunEventsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const { streamByAgentId } = useLiveStream();

  useEffect(() => {
    let cancelled = false;

    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    fetch(`/api/orchestration/engine/runs/${encodeURIComponent(runId)}/events`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.json();
      })
      .then((json: RunEventsResponse) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!data?.run.startedAt || data.run.finishedAt || data.run.durationMs !== null) {
      return;
    }

    const updateNow = () => setNowMs(Date.now());
    const timeout = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 1000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [data?.run.durationMs, data?.run.finishedAt, data?.run.startedAt]);

  const companyRouteContext = useMemo(() => resolveCompanyRouteContext(slug), [slug]);
  const companyHref = useCallback(
    (subpath: string) => buildCompanyScopedHref(companyRouteContext, slug, subpath),
    [companyRouteContext, slug],
  );

  const agentStream = data ? streamByAgentId.get(data.run.agentId) ?? null : null;
  const isLive = data?.run.status === "running" && agentStream?.isStreaming === true;
  const liveTimelineEvents = useMemo<TimelineEvent[]>(() => {
    if (!data || !agentStream || !isLive) return [];
    const lastPersistedTs = data.timeline.length > 0 ? data.timeline[data.timeline.length - 1].ts : 0;

    return agentStream.events
      .filter((event: StreamTranscriptEntry) => new Date(event.ts).getTime() > lastPersistedTs)
      .map((event: StreamTranscriptEntry) => ({
        id: event.id,
        kind: event.kind as MCLiveEventKind,
        summary: event.message,
        ts: new Date(event.ts).getTime(),
        source: "live_stream",
      }));
  }, [agentStream, data, isLive]);

  const fallbackBackHref = routeKind === "task" && taskKey
    ? companyHref(`/tasks/${encodeURIComponent(taskKey)}`)
    : companyHref("/tasks");
  const fallbackBackLabel = routeKind === "task" ? "Back to task" : "Back to tasks";

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: tokens.muted, fontSize: 13, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <Loader size={18} style={{ animation: "spin 1.5s linear infinite" }} />
        Loading run...
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <AlertTriangle size={22} style={{ color: "#f87171", marginBottom: 10 }} />
        <div style={{ color: "#f87171", fontSize: 13, marginBottom: 16 }}>
          {error === "404" ? "Run not found" : `Failed to load: ${error}`}
        </div>
        <Link
          href={fallbackBackHref}
          style={{ color: tokens.textSec, fontSize: 12, textDecoration: "none" }}
        >
          {fallbackBackLabel}
        </Link>
      </div>
    );
  }

  return (
    <RunTraceView
      data={data}
      routeKind={routeKind}
      agentId={agentId}
      taskKey={taskKey}
      companyHref={companyHref}
      isLive={isLive}
      liveTimelineEvents={liveTimelineEvents}
      liveStreamingText={agentStream?.streamingText ?? null}
      nowMs={nowMs}
    />
  );
}
