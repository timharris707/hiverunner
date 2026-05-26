'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type AgentStatus = 'online' | 'active' | 'building' | 'pending' | 'offline';

export interface AgentStatusEntry {
  id: string;
  status: AgentStatus;
  label?: string;
  lastActivity?: number;
  activeSessions?: number;
  model?: string;
}

export interface AgentStatusResponse {
  agents: AgentStatusEntry[];
  gatewayReachable: boolean;
  gatewayPort?: number;
  updatedAt: number;
  error?: string;
}

// Dev mode: 60s to reduce webpack dev server pressure.
const DEFAULT_POLL_INTERVAL = process.env.NODE_ENV === "development" ? 60_000 : 30_000;

/**
 * Hook that polls /api/agents/status every `intervalMs` (default 30s).
 * Returns a map from agent ID → AgentStatusEntry for O(1) lookups.
 */
export function useAgentStatus(intervalMs: number = DEFAULT_POLL_INTERVAL) {
  const [statusMap, setStatusMap] = useState<Record<string, AgentStatusEntry>>({});
  const [gatewayReachable, setGatewayReachable] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: AgentStatusResponse = await res.json();
      if (!mountedRef.current) return;

      const map: Record<string, AgentStatusEntry> = {};
      for (const agent of data.agents) {
        map[agent.id] = agent;
      }

      setStatusMap(map);
      setGatewayReachable(data.gatewayReachable);
      setLastUpdated(data.updatedAt);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();

    const interval = setInterval(fetchStatus, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchStatus, intervalMs]);

  return {
    statusMap,
    gatewayReachable,
    lastUpdated,
    loading,
    error,
    refetch: fetchStatus,
  };
}

/**
 * Map an AgentStatusEntry status to the display format used in agent cards.
 */
export function mapToDisplayStatus(status: AgentStatus): 'ONLINE' | 'BUILDING' | 'ACTIVE' | 'NOT DEPLOYED' | 'OFFLINE' {
  switch (status) {
    case 'online': return 'ONLINE';
    case 'building': return 'BUILDING';
    case 'active': return 'ACTIVE';
    case 'pending': return 'NOT DEPLOYED';
    case 'offline': return 'OFFLINE';
  }
}
