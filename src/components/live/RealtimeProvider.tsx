"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import type { HiveRunnerRealtimeSnapshot } from "@/lib/realtime-snapshot";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

interface RealtimeContextValue {
  snapshot: HiveRunnerRealtimeSnapshot | null;
  connectionStatus: ConnectionStatus;
  lastMessageAt: number | null;
  staleSince: number | null;
}

const SNAPSHOT_STORAGE_KEY = "hiverunner:last-live-snapshot";
const RealtimeContext = createContext<RealtimeContextValue | undefined>(undefined);

function getSnapshotUrl() {
  return "/api/live/snapshot";
}

function readStoredSnapshot() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HiveRunnerRealtimeSnapshot;
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

// Dev mode polls much slower to avoid hammering the webpack dev server
// with 1.2 MB snapshot responses every 5 seconds.  Production keeps 5s.
const SNAPSHOT_POLL_MS = process.env.NODE_ENV === "development" ? 30_000 : 5_000;

export function HiveRunnerRealtimeProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<HiveRunnerRealtimeSnapshot | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  // lastMessageAt is stored as a ref instead of state to avoid triggering
  // re-renders every poll cycle. It's only used by the (suppressed) status
  // banner and doesn't need to drive component updates.
  const lastMessageAtRef = useRef<number | null>(null);
  const [staleSince, setStaleSince] = useState<number | null>(null);

  const pollIntervalRef = useRef<number | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const consecutiveFailuresRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const lastSnapshotJsonRef = useRef<string>("");

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
      const stored = readStoredSnapshot();
      if (stored && !cancelled) {
        setSnapshot(stored);
        lastMessageAtRef.current = stored.generatedAt ? new Date(stored.generatedAt).getTime() : null;
      }

      try {
        const response = await fetch(getSnapshotUrl(), { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as HiveRunnerRealtimeSnapshot;
        if (cancelled) return;
        setSnapshot(data);
        lastMessageAtRef.current =(new Date(data.generatedAt).getTime());
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

    const clearPollInterval = () => {
      if (pollIntervalRef.current !== null) {
        window.clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    const pollSnapshot = async () => {
      try {
        const response = await fetch(getSnapshotUrl(), { cache: "no-store" });
        if (!response.ok) throw new Error(`snapshot request failed: ${response.status}`);
        const raw = await response.text();
        if (disposed) return;

        // Skip re-render if the snapshot payload is materially identical.
        // generatedAt changes every poll, so strip it before comparing.
        // This prevents the entire component tree from re-rendering every
        // poll cycle when nothing has actually changed.
        const data = JSON.parse(raw) as HiveRunnerRealtimeSnapshot;
        const contentKey = raw.replace(/"generatedAt":"[^"]*"/, "");
        if (contentKey !== lastSnapshotJsonRef.current) {
          lastSnapshotJsonRef.current = contentKey;
          setSnapshot(data);
        }
        lastMessageAtRef.current =(new Date(data.generatedAt).getTime());

        reconnectAttemptRef.current = 0;
        consecutiveFailuresRef.current = 0;
        hasConnectedRef.current = true;
        setConnectionStatus("connected");
        setStaleSince(null);
      } catch {
        if (disposed) return;
        consecutiveFailuresRef.current += 1;
        // Only show the disconnection banner after 3+ consecutive failures.
        // A single transient miss (server busy, HMR recompile) is not worth
        // alarming the user about.
        if (consecutiveFailuresRef.current >= 3) {
          setStaleSince((current) => current ?? Date.now());
          setConnectionStatus(hasConnectedRef.current ? "reconnecting" : "disconnected");
        }
      }
    };

    const connect = () => {
      clearReconnectTimer();
      void pollSnapshot();
      clearPollInterval();
      pollIntervalRef.current = window.setInterval(() => {
        void pollSnapshot();
      }, SNAPSHOT_POLL_MS);
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearPollInterval();
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(() => ({
    snapshot,
    connectionStatus,
    lastMessageAt: lastMessageAtRef.current as number | null,
    staleSince,
  }), [snapshot, connectionStatus, staleSince]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useHiveRunnerRealtime() {
  return useContext(RealtimeContext);
}

/**
 * RealtimeStatusBanner — suppressed.
 * The yellow reconnection banner flashed constantly due to transient poll
 * failures and made the app look broken. The component is kept as a no-op
 * export so existing imports don't break.
 */
export function RealtimeStatusBanner() {
  return null;
}
