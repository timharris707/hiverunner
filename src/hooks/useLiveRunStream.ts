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
  /** Whether the agent is actively generating text */
  isStreaming: boolean;
  /** Recent stream events (tool calls, lifecycle, etc.) — last 20 */
  events: StreamTranscriptEntry[];
  /** Last update timestamp */
  lastEventTs: number;
}

export interface StreamTranscriptEntry {
  id: string;
  kind: "assistant_delta" | "assistant_final" | "tool_start" | "tool_end" | "lifecycle_start" | "lifecycle_end" | "lifecycle_error" | "error";
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

/* ── Hook ── */

export function useLiveRunStream({ companySlug, enabled }: UseLiveRunStreamOptions): UseLiveRunStreamResult {
  const [streamByAgentId, setStreamByAgentId] = useState<Map<string, AgentStreamState>>(new Map());
  const [connected, setConnected] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const stateRef = useRef<Map<string, AgentStreamState>>(new Map());

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
      isStreaming: false,
      events: [],
      lastEventTs: 0,
    };

    const ts = event.ts ?? Date.now();
    const entry: StreamTranscriptEntry = {
      id: `stream-${ts}-${Math.random().toString(36).slice(2, 7)}`,
      kind: event.type as StreamTranscriptEntry["kind"],
      message: "",
      ts: new Date(ts).toISOString(),
      toolName: event.toolName,
    };

    switch (event.type) {
      case "assistant_delta":
        current.streamingText = event.text ?? current.streamingText + (event.delta ?? "");
        current.isStreaming = true;
        current.lastEventTs = ts;
        // Don't add to events array — too chatty. Text is shown via streamingText.
        stateRef.current.set(agentId, { ...current });
        scheduleFlush();
        return;

      case "assistant_final":
        current.streamingText = event.text ?? current.streamingText;
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Response complete";
        break;

      case "tool_start":
        entry.message = event.detail ?? `Tool: ${event.toolName ?? "unknown"}`;
        current.lastEventTs = ts;
        break;

      case "tool_end":
        entry.message = event.detail ?? `Tool complete: ${event.toolName ?? "unknown"}`;
        current.lastEventTs = ts;
        break;

      case "lifecycle_start":
        current.streamingText = "";
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Session started";
        break;

      case "lifecycle_end":
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Session ended";
        break;

      case "lifecycle_error":
        current.isStreaming = false;
        current.lastEventTs = ts;
        entry.message = event.detail ?? "Session error";
        break;

      case "error":
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
      setConnected(false);
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

  return { streamByAgentId, connected };
}
