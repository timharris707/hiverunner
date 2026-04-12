"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Types ── */

export interface StreamEvent {
  type:
    | "assistant_delta"
    | "assistant_final"
    | "tool_start"
    | "tool_end"
    | "lifecycle_start"
    | "lifecycle_end"
    | "lifecycle_error"
    | "error"
    | "connected";
  agentId?: string;
  runId?: string;
  detail?: string;
  text?: string;
  delta?: string;
  toolName?: string;
  seq?: number;
  ts?: number;
}

export interface AgentStreamState {
  /** Accumulated assistant text from streaming deltas */
  streamingText: string;
  /** Active run ID for the current stream, when known */
  runId?: string;
  /** True while the provider is actively executing this agent's run */
  isActive: boolean;
  /** Whether the agent is actively generating text */
  isStreaming: boolean;
  /** Recent stream events (tool calls, lifecycle, etc.) — last 20 */
  events: StreamTranscriptEntry[];
  /** Last update timestamp */
  lastEventTs: number;
}

export interface StreamTranscriptEntry {
  id: string;
  runId?: string;
  kind: "assistant_delta" | "assistant_final" | "tool_start" | "tool_end" | "lifecycle_start" | "lifecycle_end" | "lifecycle_error" | "error" | "action_detected";
  message: string;
  ts: string;
  toolName?: string;
}

interface UseLiveRunStreamOptions {
  companySlug: string;
  enabled: boolean;
}

interface UseLiveRunStreamResult {
  /** Per-agent streaming state, keyed by agent ID */
  streamByAgentId: Map<string, AgentStreamState>;
  /** Whether the SSE connection is active */
  connected: boolean;
}

const MAX_EVENTS_PER_AGENT = 20;

/* ── mc-action detection ── */

const MC_ACTION_PATTERN = /```mc-action[^\n]*\n([\s\S]*?)```/g;

const ACTION_LABELS: Record<string, string> = {
  create_task: "Creating task",
  hire_agent: "Requesting hire",
  report: "Writing report",
  update_task: "Updating task",
  add_comment: "Adding comment",
};

/**
 * Detect completed mc-action blocks in streaming text.
 * Returns newly detected actions since lastDetectedCount.
 */
function detectMcActions(
  text: string,
  lastDetectedCount: number,
): { actions: Array<{ action: string; summary: string }>; totalCount: number } {
  const actions: Array<{ action: string; summary: string }> = [];
  let match: RegExpExecArray | null;
  let totalCount = 0;

  // Reset lastIndex for global regex
  MC_ACTION_PATTERN.lastIndex = 0;

  while ((match = MC_ACTION_PATTERN.exec(text)) !== null) {
    totalCount++;
    if (totalCount <= lastDetectedCount) continue;

    const jsonStr = match[1].trim();
    try {
      const parsed = JSON.parse(jsonStr);
      const actionType = parsed.action ?? "unknown";
      const label = ACTION_LABELS[actionType] ?? actionType;

      let summary = label;
      if (actionType === "add_comment" && parsed.taskKey) {
        summary = `${label} on ${parsed.taskKey}`;
      } else if (actionType === "create_task" && parsed.title) {
        summary = `${label}: ${parsed.title.slice(0, 50)}`;
      } else if (actionType === "hire_agent" && parsed.name) {
        summary = `${label}: ${parsed.name}`;
      } else if (actionType === "update_task" && parsed.taskKey) {
        summary = `${label} ${parsed.taskKey}${parsed.status ? ` → ${parsed.status}` : ""}`;
      } else if (actionType === "report" && parsed.summary) {
        summary = `${label}: ${parsed.summary.slice(0, 50)}`;
      }

      actions.push({ action: actionType, summary });
    } catch {
      actions.push({ action: "unknown", summary: "Action block detected" });
    }
  }

  return { actions, totalCount };
}

/* ── Hook ── */

export function useLiveRunStream({ companySlug, enabled }: UseLiveRunStreamOptions): UseLiveRunStreamResult {
  const [streamByAgentId, setStreamByAgentId] = useState<Map<string, AgentStreamState>>(new Map());
  const [connected, setConnected] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const stateRef = useRef<Map<string, AgentStreamState>>(new Map());
  /** Track how many mc-action blocks we've already detected per agent */
  const detectedActionCountRef = useRef<Map<string, number>>(new Map());

  // Batch updates: collect events and flush at animation frame rate
  const pendingUpdateRef = useRef(false);

  const flushState = useCallback(() => {
    pendingUpdateRef.current = false;
    setStreamByAgentId(new Map(stateRef.current));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!pendingUpdateRef.current) {
      pendingUpdateRef.current = true;
      requestAnimationFrame(flushState);
    }
  }, [flushState]);

  const handleEvent = useCallback((event: StreamEvent) => {
    if (event.type === "connected") {
      setConnected(true);
      return;
    }

    const agentId = event.agentId;
    if (!agentId) return;

    const current = stateRef.current.get(agentId) ?? {
      streamingText: "",
      runId: undefined,
      isActive: false,
      isStreaming: false,
      events: [],
      lastEventTs: 0,
    };

    const ts = event.ts ?? Date.now();
    const entry: StreamTranscriptEntry = {
      id: `stream-${ts}-${Math.random().toString(36).slice(2, 7)}`,
      runId: event.runId,
      kind: event.type as StreamTranscriptEntry["kind"],
      message: "",
      ts: new Date(ts).toISOString(),
      toolName: event.toolName,
    };

    switch (event.type) {
      case "assistant_delta": {
        current.streamingText = event.text ?? current.streamingText + (event.delta ?? "");
        current.runId = event.runId ?? current.runId;
        current.isActive = true;
        current.isStreaming = true;
        current.lastEventTs = ts;

        // Detect completed mc-action blocks in the streaming text
        const prevCount = detectedActionCountRef.current.get(agentId) ?? 0;
        const { actions: newActions, totalCount } = detectMcActions(current.streamingText, prevCount);

        if (newActions.length > 0) {
          detectedActionCountRef.current.set(agentId, totalCount);
          const actionEntries: StreamTranscriptEntry[] = newActions.map((a) => ({
            id: `action-${ts}-${Math.random().toString(36).slice(2, 7)}`,
            runId: event.runId,
            kind: "action_detected" as const,
            message: a.summary,
            ts: new Date(ts).toISOString(),
          }));
          const events = [...current.events, ...actionEntries].slice(-MAX_EVENTS_PER_AGENT);
          stateRef.current.set(agentId, { ...current, events });
        } else {
          stateRef.current.set(agentId, { ...current });
        }
        scheduleFlush();
        return;
      }

      case "assistant_final":
        current.streamingText = event.text ?? current.streamingText;
        current.runId = event.runId ?? current.runId;
        current.isActive = true;
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Response complete";
        break;

      case "tool_start":
        current.runId = event.runId ?? current.runId;
        current.isActive = true;
        entry.message = event.detail ?? `Tool: ${event.toolName ?? "unknown"}`;
        current.lastEventTs = ts;
        break;

      case "tool_end":
        current.runId = event.runId ?? current.runId;
        current.isActive = true;
        entry.message = event.detail ?? `Tool complete: ${event.toolName ?? "unknown"}`;
        current.lastEventTs = ts;
        break;

      case "lifecycle_start":
        current.streamingText = "";
        current.runId = event.runId;
        current.isActive = true;
        current.isStreaming = false;
        current.lastEventTs = ts;
        detectedActionCountRef.current.set(agentId, 0);
        entry.message = event.detail ?? "Session started";
        break;

      case "lifecycle_end":
        current.runId = event.runId ?? current.runId;
        current.isActive = false;
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Session ended";
        break;

      case "lifecycle_error":
        current.runId = event.runId ?? current.runId;
        current.isActive = false;
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Session error";
        break;

      case "error":
        current.runId = event.runId ?? current.runId;
        current.isActive = false;
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Stream error";
        break;

      default:
        return;
    }

    // Add to events (capped)
    const events = [...current.events, entry].slice(-MAX_EVENTS_PER_AGENT);
    stateRef.current.set(agentId, { ...current, events });
    scheduleFlush();
  }, [scheduleFlush]);

  // Clean up stale agent state (no events for 3 minutes → clear)
  useEffect(() => {
    const cleanup = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [agentId, state] of stateRef.current) {
        if (now - state.lastEventTs > 3 * 60 * 1000) {
          stateRef.current.delete(agentId);
          changed = true;
        }
      }
      if (changed) {
        setStreamByAgentId(new Map(stateRef.current));
      }
    }, 30_000);
    return () => clearInterval(cleanup);
  }, []);

  // SSE connection
  useEffect(() => {
    if (!companySlug || !enabled) {
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;

      const url = `/api/orchestration/engine/live-stream?company=${encodeURIComponent(companySlug)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (!disposed) setConnected(true);
      };

      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as StreamEvent;
          handleEvent(event);
        } catch {
          // Ignore malformed
        }
      };

      es.onerror = () => {
        if (disposed) return;
        setConnected(false);
        es.close();
        // Reconnect after 5s
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [companySlug, enabled, handleEvent]);

  return { streamByAgentId, connected: enabled && connected };
}
