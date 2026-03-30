"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { MissionControlRealtimeSnapshot } from "@/lib/realtime-snapshot";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface RealtimeContextValue {
  snapshot: MissionControlRealtimeSnapshot | null;
  connectionStatus: ConnectionStatus;
  lastMessageAt: number | null;
  staleSince: number | null;
}

const SNAPSHOT_STORAGE_KEY = "mission-control:last-live-snapshot";
const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

function getSocketUrl() {
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/live`;
}

function readStoredSnapshot() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MissionControlRealtimeSnapshot;
  } catch {
    return null;
  }
}

function relativeAgeLabel(timestampMs: number) {
  const deltaMs = Date.now() - timestampMs;
  const seconds = Math.max(0, Math.floor(deltaMs / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function MissionControlRealtimeProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<MissionControlRealtimeSnapshot | null>(() => readStoredSnapshot());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(() => {
    const stored = readStoredSnapshot();
    return stored?.generatedAt ? new Date(stored.generatedAt).getTime() : null;
  });
  const [staleSince, setStaleSince] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const hasConnectedRef = useRef(false);

  useEffect(() => {
    if (!snapshot) return;
    try {
      window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore storage failures.
    }
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialSnapshot = async () => {
      try {
        const response = await fetch("/api/live/snapshot", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as MissionControlRealtimeSnapshot;
        if (cancelled) return;
        setSnapshot(data);
        setLastMessageAt(new Date(data.generatedAt).getTime());
      } catch {
        // Keep rendering cached data if the bootstrap fetch fails.
      }
    };

    void loadInitialSnapshot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const clearReconnectTimer = () => {
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const connect = () => {
      clearReconnectTimer();
      const ws = new window.WebSocket(getSocketUrl());
      socketRef.current = ws;
      setConnectionStatus(hasConnectedRef.current ? "reconnecting" : "connecting");

      ws.onopen = () => {
        if (disposed) return;
        reconnectAttemptRef.current = 0;
        hasConnectedRef.current = true;
        setConnectionStatus("connected");
        setStaleSince(null);
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const message = JSON.parse(event.data) as { type?: string; snapshot?: MissionControlRealtimeSnapshot };
          if (message.type === "snapshot" && message.snapshot) {
            setSnapshot(message.snapshot);
            setLastMessageAt(new Date(message.snapshot.generatedAt).getTime());
          }
        } catch {
          // Ignore malformed frames from the server.
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onclose = () => {
        if (disposed) return;
        setStaleSince((current) => current ?? Date.now());
        setConnectionStatus(hasConnectedRef.current ? "reconnecting" : "disconnected");
        const nextAttempt = reconnectAttemptRef.current + 1;
        reconnectAttemptRef.current = nextAttempt;
        const delayMs = Math.min(15_000, 1000 * 2 ** Math.min(nextAttempt - 1, 4));
        reconnectTimeoutRef.current = window.setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(() => ({
    snapshot,
    connectionStatus,
    lastMessageAt,
    staleSince,
  }), [snapshot, connectionStatus, lastMessageAt, staleSince]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useMissionControlRealtime() {
  return useContext(RealtimeContext);
}

export function RealtimeStatusBanner() {
  const realtime = useMissionControlRealtime();
  if (!realtime) return null;

  const { connectionStatus, lastMessageAt, staleSince } = realtime;
  if (connectionStatus === "connected") {
    return null;
  }

  const liveUpdatesUnavailable = connectionStatus === "disconnected";
  const detail = lastMessageAt
    ? `Showing last-known state from ${relativeAgeLabel(lastMessageAt)} while the socket reconnects.`
    : "Live data is temporarily unavailable. The dashboard stays usable and will resume live updates automatically.";
  const staleLabel = staleSince ? relativeAgeLabel(staleSince) : "waiting";

  return (
    <div
      role="status"
      className="mb-4 rounded-xl border px-4 py-3"
      style={{
        backgroundColor: "rgba(245, 158, 11, 0.12)",
        borderColor: "rgba(245, 158, 11, 0.35)",
        color: "#fcd34d",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            Live updates {liveUpdatesUnavailable ? "unavailable" : "disconnected"}.
          </p>
          <p className="text-xs" style={{ color: "rgba(253, 224, 71, 0.88)" }}>
            {detail}
          </p>
        </div>
        <span className="text-xs font-semibold uppercase tracking-[0.18em]">
          stale {staleLabel}
        </span>
      </div>
    </div>
  );
}
