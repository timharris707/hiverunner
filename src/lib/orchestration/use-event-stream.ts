"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface StreamEvent {
  type: "activity" | "comment" | "connected";
  id?: string;
  eventType?: string;
  taskId?: string;
  taskTitle?: string;
  taskKey?: string;
  projectSlug?: string;
  projectName?: string;
  agentId?: string;
  agentName?: string;
  message?: string;
  author?: string;
  body?: string;
  commentType?: string;
  timestamp?: string;
  since?: string;
}

interface UseEventStreamOptions {
  companySlug: string;
  enabled?: boolean;
  onEvent?: (event: StreamEvent) => void;
}

/**
 * Hook that connects to the orchestration SSE stream and delivers events.
 * Reconnects automatically on disconnect.
 */
export function useEventStream({ companySlug, enabled = true, onEvent }: UseEventStreamOptions) {
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!companySlug || !enabled) return;

    const url = `/api/orchestration/events/stream?company=${encodeURIComponent(companySlug)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as StreamEvent;
        if (event.type === "connected") {
          setConnected(true);
          return;
        }
        setEventCount((c) => c + 1);
        onEventRef.current?.(event);
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      // Reconnect after 5s
      setTimeout(connect, 5000);
    };
  }, [companySlug, enabled]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [connect]);

  return { connected, eventCount };
}
