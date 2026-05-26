"use client";

/**
 * LiveStreamProvider
 *
 * Shared context for real-time SSE streaming state.
 * Wraps useLiveRunStream at the layout level so both the Dock
 * and dashboard consume the same live agent data.
 *
 * Extracts company code from the pathname (e.g. "/NI/dashboard" → "NI")
 * and passes it to the SSE endpoint which accepts both slug and code.
 */

import { createContext, useContext, useMemo } from "react";
import { usePathname } from "next/navigation";

import { useLiveRunStream } from "@/hooks/useLiveRunStream";
import type { AgentStreamState } from "@/hooks/useLiveRunStream";

/* ── Context Shape ── */

interface LiveStreamContextValue {
  /** Per-agent streaming state, keyed by agent ID */
  streamByAgentId: Map<string, AgentStreamState>;
  /** Whether the SSE connection is active */
  connected: boolean;
  /** Set of agent IDs that are currently executing a live run */
  liveAgentIds: Set<string>;
}

const EMPTY_MAP = new Map<string, AgentStreamState>();
const EMPTY_SET = new Set<string>();

const LiveStreamContext = createContext<LiveStreamContextValue>({
  streamByAgentId: EMPTY_MAP,
  connected: false,
  liveAgentIds: EMPTY_SET,
});

/* ── Slug extraction ── */

/**
 * Extract the company code (first path segment) from the current URL.
 * Canonical routes use /{CODE}/... (e.g. "/NI/dashboard").
 * Legacy routes use /companies/{slug}/... — in that case, use the slug.
 *
 * Returns empty string if no company can be determined.
 */
function useCompanySlugFromPath(): string {
  const pathname = usePathname();

  return useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return "";

    const root = segments[0];

    // Legacy path: /companies/{slug}/...
    if (root === "companies" && segments[1]) {
      return segments[1];
    }

    // Canonical path: /{CODE}/... — pass the code directly.
    // The SSE endpoint accepts both slug and company_code.
    // Skip known non-company roots.
    const NON_COMPANY = new Set([
      "api", "auth", "_next", "login", "projects", "ideas",
      "marketing", "voice", "terminal", "sessions",
      "logs", "search", "settings", "skills", "workflows", "system",
      "office", "monitoring", "reliability", "reports", "memory", "files",
      "git", "cron", "factory", "org", "tasks", "agents",
    ]);

    if (!NON_COMPANY.has(root.toLowerCase())) {
      return root;
    }

    return "";
  }, [pathname]);
}

/* ── Provider Component ── */

export function LiveStreamProvider({ children }: { children: React.ReactNode }) {
  const companySlug = useCompanySlugFromPath();

  const { streamByAgentId, connected } = useLiveRunStream({
    companySlug,
    enabled: !!companySlug,
  });

  const liveAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [agentId, state] of streamByAgentId) {
      if (state.isActive) {
        ids.add(agentId);
      }
    }
    return ids;
  }, [streamByAgentId]);

  const value = useMemo<LiveStreamContextValue>(
    () => ({ streamByAgentId, connected, liveAgentIds }),
    [streamByAgentId, connected, liveAgentIds],
  );

  return (
    <LiveStreamContext.Provider value={value}>
      {children}
    </LiveStreamContext.Provider>
  );
}

/* ── Hook ── */

export function useLiveStream(): LiveStreamContextValue {
  return useContext(LiveStreamContext);
}
