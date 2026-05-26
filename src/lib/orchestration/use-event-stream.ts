"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface StreamEvent {
  type: "activity" | "comment" | "connected" | "execution_run_terminated" | "heartbeat_run_state_changed";
  id?: string;
  eventType?: string;
  runId?: string;
  taskId?: string;
  taskTitle?: string;
  taskKey?: string;
  taskStatus?: string;
  projectSlug?: string;
  projectName?: string;
  companySlug?: string;
  companyCode?: string;
  sprintId?: string;
  sprintName?: string;
  sprintStatus?: string;
  companyGoalId?: string;
  companyGoalName?: string;
  companyGoalStatus?: string;
  agentId?: string;
  agentName?: string;
  fromStatus?: string;
  toStatus?: string;
  /** Parsed task_events.metadata_json — varies by event_type. Useful keys
   *  include `assignee`, `assigneeId`, `priorityChanged`, etc. */
  metadata?: Record<string, unknown>;
  message?: string;
  author?: string;
  body?: string;
  commentType?: string;
  terminalStatus?: "cancelled" | "completed" | "failed" | "timed_out" | string;
  runStatus?: string;
  startedAt?: string;
  finishedAt?: string;
  reason?: string;
  occurredAt?: string;
  timestamp?: string;
  since?: string;
}

interface UseEventStreamOptions {
  companySlug: string;
  enabled?: boolean;
  onEvent?: (event: StreamEvent) => void;
  transport?: "auto" | "sse";
}

/**
 * Hook that connects to the lightweight orchestration task-event WebSocket.
 * Falls back to the SSE stream if the custom server WebSocket is unavailable.
 */
export function useEventStream({ companySlug, enabled = true, onEvent, transport = "auto" }: UseEventStreamOptions) {
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const onEventRef = useRef(onEvent);
  const esRef = useRef<EventSource | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const dispatchWireEvent = useCallback((event: StreamEvent) => {
    if (event.type === "connected") {
      setConnected(true);
      onEventRef.current?.(event);
      return;
    }
    setEventCount((c) => c + 1);
    onEventRef.current?.(event);
  }, []);

  const closeConnections = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const scheduleReconnect = useCallback(() => {
    reconnectTimerRef.current = window.setTimeout(() => {
      connectRef.current();
    }, 5000);
  }, []);

  const connect = useCallback(() => {
    if (!companySlug || !enabled) return;

    closeConnections();

    const connectSse = () => {
      const url = `/api/orchestration/events/stream?company=${encodeURIComponent(companySlug)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (msg) => {
        try {
          dispatchWireEvent(JSON.parse(msg.data) as StreamEvent);
        } catch {
          // ignore malformed
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        scheduleReconnect();
      };
    };

    if (transport === "sse" || typeof window === "undefined" || !("WebSocket" in window)) {
      connectSse();
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/orchestration/events/ws?company=${encodeURIComponent(companySlug)}`;
    let opened = false;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      opened = true;
      setConnected(true);
    };

    ws.onmessage = (msg) => {
      try {
        dispatchWireEvent(JSON.parse(String(msg.data)) as StreamEvent);
      } catch {
        // ignore malformed
      }
    };

    ws.onerror = () => {
      if (!opened) {
        ws.close();
        connectSse();
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setConnected(false);
      if (opened) {
        scheduleReconnect();
      }
    };
  }, [closeConnections, companySlug, dispatchWireEvent, enabled, scheduleReconnect, transport]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      closeConnections();
    };
  }, [closeConnections, connect]);

  return { connected, eventCount };
}
