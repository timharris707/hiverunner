"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, UsersRound } from "lucide-react";
import { usePathname } from "next/navigation";

import { AgentAvatar } from "@/components/AgentAvatar";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { useEventStream, type StreamEvent } from "@/lib/orchestration/use-event-stream";
import { P, radius } from "@/lib/ui/tokens";

type ActiveAgentRun = {
  runId: string;
  agentId: string;
  agentName: string;
  agentSlug: string | null;
  agentEmoji: string | null;
  agentAvatarUrl: string | null;
  status: "running" | string;
  provider: string;
  startedAt: string | null;
  createdAt: string;
  updatedAt: string;
  task: {
    id: string;
    key: string | null;
    title: string;
    status: string;
  };
};

type ActiveAgentRunsResponse = {
  company?: {
    slug: string;
    code: string | null;
  };
  runs?: ActiveAgentRun[];
};

const NON_COMPANY_ROOTS = new Set([
  "api",
  "auth",
  "_next",
  "login",
  "projects",
  "ideas",
  "marketing",
  "voice",
  "terminal",
  "sessions",
  "logs",
  "search",
  "settings",
  "skills",
  "workflows",
  "system",
  "office",
  "monitoring",
  "reliability",
  "reports",
  "memory",
  "files",
  "git",
  "cron",
  "factory",
  "org",
  "tasks",
  "agents",
]);

const ACTIVE_RUN_STATUSES = new Set(["running"]);
const EXCLUDED_TASK_STATUSES = new Set(["backlog", "done", "blocked", "cancelled"]);

function useCompanyParamFromPath(): string {
  const pathname = usePathname();

  return useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return "";

    if (segments[0] === "companies") {
      const slug = segments[1] ?? "";
      return slug && slug !== "new" ? slug : "";
    }

    const root = segments[0];
    return NON_COMPANY_ROOTS.has(root.toLowerCase()) ? "" : root;
  }, [pathname]);
}

function formatElapsed(startedAt: string | null, createdAt: string, now: number): string {
  const startMs = new Date(startedAt ?? createdAt).getTime();
  if (!Number.isFinite(startMs)) return "0s";

  const totalSeconds = Math.max(0, Math.floor((now - startMs) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes.toString().padStart(2, "0")}m`;
}

function buildTaskHref(input: {
  companyCode: string | null;
  companySlug: string;
  task: ActiveAgentRun["task"];
}): string {
  const taskSegment = input.task.key ? encodeURIComponent(input.task.key) : "";
  const companySegment = encodeURIComponent(input.companyCode || input.companySlug);
  if (taskSegment) return `/${companySegment}/tasks/${taskSegment}`;
  return `/${companySegment}/tasks?task=${encodeURIComponent(input.task.id)}`;
}

function isVisibleRun(run: ActiveAgentRun): boolean {
  return ACTIVE_RUN_STATUSES.has(run.status) && !EXCLUDED_TASK_STATUSES.has(run.task.status);
}

function AgentActivityAvatar({ run }: { run: ActiveAgentRun }) {
  if (!run.agentAvatarUrl) {
    return (
      <AgentAvatar
        agentId={run.agentSlug ?? run.agentId}
        size={24}
        borderWidth={1}
        title={run.agentName}
      />
    );
  }

  return (
    <span style={{ position: "relative", display: "inline-flex", width: 24, height: 24, flexShrink: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={run.agentAvatarUrl}
        alt={run.agentName}
        title={run.agentName}
        width={24}
        height={24}
        style={{
          width: 24,
          height: 24,
          minWidth: 24,
          borderRadius: "50%",
          objectFit: "cover",
          border: `0.5px solid ${P.cardBorder}`,
        }}
        onError={(event) => {
          event.currentTarget.style.display = "none";
          const fallback = event.currentTarget.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "inline-flex";
        }}
      />
      <span
        style={{
          display: "none",
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          border: `0.5px solid ${P.cardBorder}`,
          background: P.surfaceElevated,
          color: P.text,
        }}
      >
        <AvatarGlyph value={run.agentEmoji} size={13} color={P.text} />
      </span>
    </span>
  );
}

export function AgentActivityPanel() {
  const companyParam = useCompanyParamFromPath();
  const [runs, setRuns] = useState<ActiveAgentRun[]>([]);
  const [companySlug, setCompanySlug] = useState("");
  const [companyCode, setCompanyCode] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [isMobile, setIsMobile] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);

  const visibleRuns = useMemo(() => runs.filter(isVisibleRun), [runs]);
  const panelExpanded = expanded && visibleRuns.length > 0;

  const refresh = useCallback(async () => {
    if (!companyParam) {
      setRuns([]);
      setCompanySlug("");
      setCompanyCode(null);
      return;
    }

    try {
      const response = await fetch(
        `/api/orchestration/engine/active-agent-runs?company=${encodeURIComponent(companyParam)}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;

      const data = await response.json() as ActiveAgentRunsResponse;
      const nextRuns = (data.runs ?? []).filter(isVisibleRun);
      setCompanySlug(data.company?.slug ?? "");
      setCompanyCode(data.company?.code ?? null);
      setRuns(nextRuns);
      if (nextRuns.length === 0) {
        setExpanded(false);
      }
    } catch {
      // The panel is non-blocking UI; retry on the next stream event or safety poll.
    }
  }, [companyParam]);

  const scheduleRefresh = useCallback(() => {
    if (typeof window === "undefined") return;
    if (refreshTimerRef.current !== null) return;

    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void refresh();
    }, 300);
  }, [refresh]);

  useEventStream({
    companySlug,
    enabled: Boolean(companySlug),
    onEvent: useCallback((event: StreamEvent) => {
      if (event.type === "connected") return;
      if (event.type === "execution_run_terminated" && event.runId) {
        setRuns((current) => current.filter((run) => run.runId !== event.runId));
      }
      scheduleRefresh();
    }, [scheduleRefresh]),
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (visibleRuns.length === 0) return undefined;

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visibleRuns.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);

  if (!companyParam || visibleRuns.length === 0) {
    return null;
  }

  const activeLabel = `${visibleRuns.length} agent${visibleRuns.length === 1 ? "" : "s"} working`;

  return (
    <aside
      aria-label="Active agents"
      style={{
        position: "fixed",
        right: isMobile ? 12 : 18,
        bottom: isMobile ? 74 : 18,
        zIndex: 45,
        width: expanded ? (isMobile ? "calc(100vw - 24px)" : 340) : "auto",
        maxWidth: "calc(100vw - 24px)",
        color: P.text,
        fontFamily: "var(--font-body)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={panelExpanded}
        style={{
          width: panelExpanded ? "100%" : "auto",
          minHeight: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "7px 10px",
          borderRadius: radius.md,
          border: `0.5px solid ${P.cardBorder}`,
          background: P.surfaceElevated,
          color: P.text,
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.28)",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <UsersRound size={14} strokeWidth={2} color={P.textSec} />
          <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{activeLabel}</span>
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          color={P.textMuted}
          style={{
            transform: panelExpanded ? "rotate(180deg)" : "none",
            transition: "transform 120ms ease",
            flexShrink: 0,
          }}
        />
      </button>

      {panelExpanded ? (
        <div
          style={{
            marginTop: 6,
            display: "grid",
            gap: 5,
            padding: 6,
            borderRadius: radius.md,
            border: `0.5px solid ${P.cardBorder}`,
            background: P.surface,
            boxShadow: "0 14px 36px rgba(0, 0, 0, 0.3)",
          }}
        >
          {visibleRuns.map((run) => {
            const statusLabel = "Running";
            return (
              <a
                key={run.runId}
                href={buildTaskHref({ companyCode, companySlug: companySlug || companyParam, task: run.task })}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 9,
                  minHeight: 44,
                  padding: "7px 8px",
                  borderRadius: radius.sm,
                  color: P.text,
                  textDecoration: "none",
                  background: "transparent",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = P.surfaceHover;
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = "transparent";
                }}
              >
                <AgentActivityAvatar run={run} />
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {run.agentName}
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 2,
                      fontSize: 11,
                      color: P.textMuted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={run.task.title}
                  >
                    {run.task.key ? `${run.task.key}: ` : ""}{run.task.title}
                  </span>
                </span>
                <span
                  style={{
                    display: "grid",
                    justifyItems: "end",
                    gap: 3,
                    fontSize: 10,
                    color: P.textMuted,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span
                      aria-hidden
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: run.status === "running" ? P.success : P.warn,
                      }}
                    />
                    {statusLabel}
                  </span>
                  <span>{formatElapsed(run.startedAt, run.createdAt, now)}</span>
                </span>
              </a>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
