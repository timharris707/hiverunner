"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── types ── */

export interface LiveRunTranscriptEntry {
  kind: "comment" | "event" | "action";
  id: string;
  message: string;
  ts: string;
  type?: string;
}

export interface LiveRun {
  runId: string;
  agentId: string;
  agentName: string;
  agentSlug: string;
  agentEmoji: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number;
  error: string | null;
  result: {
    messagesImported: number;
    actionsFound: number;
    actionsExecuted: number;
    actionsSkippedDedup: number;
    tasksCreated: string[];
    approvalsCreated: string[];
    reportsImported: number;
    errors: string[];
  } | null;
  latestOutput: string | null;
  transcript: LiveRunTranscriptEntry[];
  triggerDetail: string | null;
}

export interface LiveRunTransition {
  agentId: string;
  agentName: string;
  agentSlug: string;
  runId: string;
  fromStatus: string;
  toStatus: string;
  result: LiveRun["result"];
  error: string | null;
}

interface UseLiveRunsOptions {
  companySlug: string;
  enabled: boolean;
}

interface UseLiveRunsResult {
  runsByAgentId: Map<string, LiveRun>;
  transitions: LiveRunTransition[];
  isPolling: boolean;
  hasActiveRuns: boolean;
}

// Dev mode: 15s to reduce webpack dev server allocation pressure.
// Production: 3s for near-realtime run status.
const POLL_INTERVAL_MS = process.env.NODE_ENV === "development" ? 15_000 : 3_000;
const COOLDOWN_MS = 2 * 60 * 1000; // keep polling 2min after last active run

/* ── hook ── */

export function useLiveRuns({ companySlug, enabled }: UseLiveRunsOptions): UseLiveRunsResult {
  const [runsByAgentId, setRunsByAgentId] = useState<Map<string, LiveRun>>(new Map());
  const [transitions, setTransitions] = useState<LiveRunTransition[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const lastActiveRef = useRef<number>(0);
  const lastRunsKeyRef = useRef<string>("");

  const fetchLiveRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/orchestration/engine/live-runs?company=${encodeURIComponent(companySlug)}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      const runs: LiveRun[] = data.runs ?? [];

      // Build map by agent (most recent run per agent)
      const byAgent = new Map<string, LiveRun>();
      for (const run of runs) {
        const existing = byAgent.get(run.agentId);
        if (!existing || (run.startedAt ?? "") > (existing.startedAt ?? "")) {
          byAgent.set(run.agentId, run);
        }
      }

      // Detect transitions
      const newTransitions: LiveRunTransition[] = [];
      const prevStatuses = prevStatusRef.current;

      for (const [agentId, run] of byAgent) {
        const prevStatus = prevStatuses.get(agentId);
        if (prevStatus && prevStatus !== run.status) {
          // Status changed
          if (
            (prevStatus === "running" || prevStatus === "queued") &&
            (run.status === "succeeded" || run.status === "failed" || run.status === "timed_out")
          ) {
            newTransitions.push({
              agentId,
              agentName: run.agentName,
              agentSlug: run.agentSlug,
              runId: run.runId,
              fromStatus: prevStatus,
              toStatus: run.status,
              result: run.result,
              error: run.error,
            });
          }
        }
      }

      // Update prev status tracking
      const nextStatuses = new Map<string, string>();
      for (const [agentId, run] of byAgent) {
        nextStatuses.set(agentId, run.status);
      }
      prevStatusRef.current = nextStatuses;

      // Track last time we saw active runs
      const hasActive = runs.some((r) => r.status === "running" || r.status === "queued" || r.status === "pending");
      if (hasActive) {
        lastActiveRef.current = Date.now();
      }

      // Only update state (triggering re-render) if the runs actually changed.
      // Serializing the map is cheaper than re-rendering the entire dashboard.
      const runsKey = JSON.stringify(Array.from(byAgent.entries()).map(([id, r]) => [id, r.status, r.runId]));
      if (runsKey !== lastRunsKeyRef.current) {
        lastRunsKeyRef.current = runsKey;
        setRunsByAgentId(byAgent);
      }
      if (newTransitions.length > 0) {
        setTransitions(newTransitions);
      }
    } catch {
      // Non-fatal — silently retry next cycle
    }
  }, [companySlug]);

  useEffect(() => {
    if (!companySlug) return;

    // Should we be polling?
    const shouldPoll = enabled || Date.now() - lastActiveRef.current < COOLDOWN_MS;
    if (!shouldPoll) {
      setIsPolling(false);
      return;
    }

    setIsPolling(true);
    void fetchLiveRuns(); // immediate first fetch

    const interval = window.setInterval(() => {
      // Re-check cooldown each tick
      const stillNeeded = enabled || Date.now() - lastActiveRef.current < COOLDOWN_MS;
      if (!stillNeeded) {
        setIsPolling(false);
        window.clearInterval(interval);
        return;
      }
      void fetchLiveRuns();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [companySlug, enabled, fetchLiveRuns]);

  // Clear transitions after they've been consumed (next render cycle)
  useEffect(() => {
    if (transitions.length > 0) {
      const timer = window.setTimeout(() => setTransitions([]), 100);
      return () => window.clearTimeout(timer);
    }
  }, [transitions]);

  const hasActiveRuns = Array.from(runsByAgentId.values()).some(
    (r) => r.status === "running" || r.status === "queued" || r.status === "pending"
  );

  return { runsByAgentId, transitions, isPolling, hasActiveRuns };
}
