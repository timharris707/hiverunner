"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";
import { fetchLiveRunsCoalesced } from "@/lib/orchestration/live-runs-cache";

/* ── types ── */

export interface LiveRunTranscriptEntry {
  kind: "comment" | "event" | "action";
  id: string;
  message: string;
  ts: string;
  type?: string;
}

export type LiveRunLiveness = "live" | "quiet" | "stalled" | "completed";

export interface LiveRun {
  runId: string;
  taskId: string | null;
  agentId: string;
  agentName: string;
  agentSlug: string;
  agentEmoji: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  liveIndicatorUntil: string | null;
  runnerProvider?: string | null;
  runnerModel?: string | null;
  runnerPid?: number | null;
  /** Tri-state liveness of the runner process at the last poll. */
  runnerPidAlive?: boolean | null;
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
  /** ISO timestamp of the newest visible signal for this run (event, comment,
   * task transition). Null when nothing has been emitted yet. Used by the UI
   * to show "no signal for Xs" without waiting for the next poll cycle. */
  lastEventAt?: string | null;
  /** Server-side snapshot of how long since the last signal (ms). Refined
   * client-side with a ticking timer for sub-poll smoothness. */
  lastEventAgeMs?: number | null;
  /** Operator-facing classification: live (recent signal), quiet (alive but
   * no recent signal), stalled (likely hung), completed (terminal). */
  liveness?: LiveRunLiveness;
  /** Pre-formatted label matching `liveness`, server-rendered for SSR/initial
   * paint. The dashboard recomputes client-side as the clock advances. */
  livenessLabel?: string;
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

// Poll fast enough to catch short attended replies. A human follow-up can
// complete in under 15s, so a slow dev poll can miss the whole live window.
const ACTIVE_POLL_INTERVAL_MS = 3_000;
const IDLE_POLL_INTERVAL_MS = process.env.NODE_ENV === "development" ? 15_000 : 10_000;
const COOLDOWN_MS = 2 * 60 * 1000; // keep polling 2min after last active run

export function shouldPollLiveRuns({
  enabled,
  lastActiveAt,
  now = Date.now(),
  cooldownMs = COOLDOWN_MS,
}: {
  enabled: boolean;
  lastActiveAt: number;
  now?: number;
  cooldownMs?: number;
}): boolean {
  return enabled || now - lastActiveAt < cooldownMs;
}

/* ── hook ── */

export function useLiveRuns({ companySlug, enabled }: UseLiveRunsOptions): UseLiveRunsResult {
  const [runsByAgentId, setRunsByAgentId] = useState<Map<string, LiveRun>>(new Map());
  const [transitions, setTransitions] = useState<LiveRunTransition[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const lastActiveRef = useRef<number>(0);
  const hasActiveRunsRef = useRef(false);
  const lastRunsKeyRef = useRef<string>("");
  const pollingStateTimerRef = useRef<number | null>(null);
  const requestInFlightRef = useRef(false);

  const schedulePollingState = useCallback((next: boolean) => {
    if (typeof window === "undefined") return;

    if (pollingStateTimerRef.current !== null) {
      window.clearTimeout(pollingStateTimerRef.current);
    }

    pollingStateTimerRef.current = window.setTimeout(() => {
      pollingStateTimerRef.current = null;
      setIsPolling(next);
    }, 0);
  }, []);

  const fetchLiveRuns = useCallback(async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    try {
      // Coalesced so the Dock, dashboard, and task board share one in-flight
      // live-runs request per company during boot instead of each firing its own.
      const data = await fetchLiveRunsCoalesced(companySlug);
      const runs: LiveRun[] = (data.runs as LiveRun[] | undefined) ?? [];

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
      const hasActive = runs.some((r) => r.status === "running");
      hasActiveRunsRef.current = hasActive;
      if (hasActive) {
        lastActiveRef.current = Date.now();
      }

      // Only update state (triggering re-render) if the runs actually changed.
      // Serializing the map is cheaper than re-rendering the entire dashboard.
      const now = Date.now();
      const runsKey = JSON.stringify(
        Array.from(byAgent.entries()).map(([id, r]) => [
          id,
          r.status,
          r.runId,
          r.taskId,
          r.startedAt,
          r.finishedAt,
          r.latestOutput,
          r.transcript.length,
          r.transcript[r.transcript.length - 1]?.id ?? null,
          r.transcript[r.transcript.length - 1]?.ts ?? null,
          r.liveIndicatorUntil,
          r.liveIndicatorUntil ? new Date(r.liveIndicatorUntil).getTime() > now : false,
          r.lastEventAt ?? null,
          r.liveness ?? null,
          r.runnerPid ?? null,
          r.runnerPidAlive ?? null,
        ]),
      );
      if (runsKey !== lastRunsKeyRef.current) {
        lastRunsKeyRef.current = runsKey;
        setRunsByAgentId(byAgent);
      }
      if (newTransitions.length > 0) {
        setTransitions(newTransitions);
      }
    } catch {
      // Non-fatal — silently retry next cycle
    } finally {
      requestInFlightRef.current = false;
    }
  }, [companySlug]);

  useEventStream({
    companySlug,
    enabled: Boolean(companySlug && enabled),
    onEvent: useCallback((event: StreamEvent) => {
      if (event.type !== "execution_run_terminated" && event.type !== "heartbeat_run_state_changed") return;

      setRunsByAgentId((current) => {
        let changed = false;
        const next = new Map(current);
        for (const [agentId, run] of current) {
          if (
            (event.agentId && agentId === event.agentId)
            || (event.taskId && run.taskId === event.taskId)
            || (event.runId && run.runId === event.runId)
          ) {
            next.delete(agentId);
            changed = true;
          }
        }
        if (changed) {
          lastRunsKeyRef.current = "";
        }
        return changed ? next : current;
      });
      void fetchLiveRuns();
    }, [fetchLiveRuns]),
  });

  useEffect(() => {
    const clearPendingPollingState = () => {
      if (pollingStateTimerRef.current !== null) {
        window.clearTimeout(pollingStateTimerRef.current);
        pollingStateTimerRef.current = null;
      }
    };

    if (!companySlug) {
      schedulePollingState(false);
      return clearPendingPollingState;
    }

    const shouldPoll = shouldPollLiveRuns({ enabled, lastActiveAt: lastActiveRef.current });
    if (!shouldPoll) {
      schedulePollingState(false);
      return clearPendingPollingState;
    }

    let cancelled = false;
    let timer: number | null = null;

    const scheduleNextPoll = (delayMs: number) => {
      timer = window.setTimeout(async () => {
        if (cancelled) return;
        const stillNeeded = shouldPollLiveRuns({ enabled, lastActiveAt: lastActiveRef.current });
        if (!stillNeeded) {
          schedulePollingState(false);
          return;
        }
        await fetchLiveRuns();
        if (!cancelled) {
          scheduleNextPoll(hasActiveRunsRef.current ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
        }
      }, delayMs);
    };

    schedulePollingState(true);
    scheduleNextPoll(0);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      clearPendingPollingState();
    };
  }, [companySlug, enabled, fetchLiveRuns, schedulePollingState]);

  // Clear transitions after they've been consumed (next render cycle)
  useEffect(() => {
    if (transitions.length > 0) {
      const timer = window.setTimeout(() => setTransitions([]), 100);
      return () => window.clearTimeout(timer);
    }
  }, [transitions]);

  const hasActiveRuns = Array.from(runsByAgentId.values()).some(
    (r) => r.status === "running"
  );

  return { runsByAgentId, transitions, isPolling, hasActiveRuns };
}
