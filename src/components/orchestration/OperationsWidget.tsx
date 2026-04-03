"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Gauge,
  HeartPulse,
  Layers3,
  RefreshCw,
} from "lucide-react";
import { AGENT_CONFIGS } from "@/config/agents";
import { formatAge, getStaleSignal, statusTheme, type StaleSeverity } from "@/components/orchestration/ui";
import { getBridgeStatus, getProjectBoard, listActivityFeed, listProjects } from "@/lib/orchestration/client";
import type { OrchestrationActivityEvent, TaskStatus } from "@/lib/orchestration/types";

type StaleAlertItem = {
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  projectId: string;
  projectName: string;
  ageMinutes: number;
  thresholdMinutes: number;
  severity: Exclude<StaleSeverity, "none">;
};

type OperationsSnapshot = {
  activeAgents: number;
  tasksToday: number;
  velocityPerDay: number;
  weeklyDone: number;
  staleAlerts: number;
  reviewQueue: number;
  bridge: {
    tone: "connected" | "degraded" | "down";
    label: string;
    details: string;
    checkedAt?: string;
    endpointData: ReturnType<typeof getBridgeStatus> extends Promise<infer T> ? T : null;
  };
  recent: OrchestrationActivityEvent[];
  staleItems: StaleAlertItem[];
  flow: {
    backlog: number;
    onDeck: number;
    inProgress: number;
    review: number;
    done: number;
    blocked: number;
    total: number;
  };
};

const POLL_MS = 30_000;
const ONE_MINUTE_MS = 60_000;
const ONE_DAY_MS = 24 * 60 * ONE_MINUTE_MS;

function normalizeAgentKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAgentVisual(agentName?: string): { avatar?: string; emoji?: string; label: string } {
  if (!agentName) {
    return { label: "System" };
  }

  const key = normalizeAgentKey(agentName);
  const match = AGENT_CONFIGS.find((agent) => {
    const nameKey = normalizeAgentKey(agent.name);
    return nameKey === key || nameKey.includes(key) || key.includes(nameKey);
  });

  if (!match) return { label: agentName };
  return { avatar: match.avatar, emoji: match.emoji, label: match.name.replace(/\s+[^\p{L}\p{N}]+$/u, "") };
}

export function OperationsWidget() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [bridgeDetailsOpen, setBridgeDetailsOpen] = useState(false);

  const buildSnapshot = useCallback(async (): Promise<OperationsSnapshot> => {
    const [projects, bridge, activityFeed] = await Promise.all([
      listProjects(),
      getBridgeStatus(),
      listActivityFeed({ limit: 8 }),
    ]);

    const boards = await Promise.all(
      projects.map(async (project) => ({
        project,
        board: await getProjectBoard(project.id),
      }))
    );

    const activeAgents = projects.reduce((sum, project) => sum + (project.activeAgents ?? 0), 0);
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    const weekWindowMs = now - 7 * ONE_DAY_MS;

    const allTasks = boards.flatMap(({ board, project }) =>
      (board?.tasks ?? []).map((task) => ({ task, project }))
    );

    const staleItems = allTasks
      .map(({ task, project }) => {
        const signal = getStaleSignal(task.status, task.updated);
        if (signal.severity === "none" || !signal.thresholdMinutes) return null;
        return {
          taskId: task.id,
          taskTitle: task.title,
          taskStatus: task.status,
          projectId: project.id,
          projectName: project.name,
          ageMinutes: signal.ageMinutes,
          thresholdMinutes: signal.thresholdMinutes,
          severity: signal.severity,
        } satisfies StaleAlertItem;
      })
      .filter((item): item is StaleAlertItem => Boolean(item))
      .sort((a, b) => {
        if (a.severity === b.severity) {
          return b.ageMinutes - a.ageMinutes;
        }
        return a.severity === "critical" ? -1 : 1;
      });

    const tasksToday = allTasks.filter(({ task }) => {
      const updatedMs = new Date(task.updated).getTime();
      return Number.isFinite(updatedMs) && updatedMs >= startOfTodayMs && task.status !== "backlog";
    }).length;

    const weeklyDone = allTasks.filter(({ task }) => {
      if (task.status !== "done") return false;
      const updatedMs = new Date(task.updated).getTime();
      return Number.isFinite(updatedMs) && updatedMs >= weekWindowMs;
    }).length;

    const velocityPerDay = Math.round((weeklyDone / 7) * 10) / 10;
    const reviewQueue = allTasks.filter(({ task }) => task.status === "review").length;
    const flow = {
      backlog: allTasks.filter(({ task }) => task.status === "backlog").length,
      onDeck: allTasks.filter(({ task }) => task.status === "on-deck").length,
      inProgress: allTasks.filter(({ task }) => task.status === "in-progress").length,
      review: allTasks.filter(({ task }) => task.status === "review").length,
      done: allTasks.filter(({ task }) => task.status === "done").length,
      blocked: allTasks.filter(({ task }) => task.status === "blocked").length,
      total: allTasks.length,
    };

    const recent = activityFeed?.activity ?? [];
    const bridgeSummary = summarizeBridgeHealth(bridge);

    return {
      activeAgents,
      tasksToday,
      velocityPerDay,
      weeklyDone,
      staleAlerts: staleItems.length,
      reviewQueue,
      bridge: bridgeSummary,
      recent,
      staleItems: staleItems.slice(0, 6),
      flow,
    };
  }, []);

  const loadSnapshot = useCallback(
    async ({ initial = false, manual = false }: { initial?: boolean; manual?: boolean } = {}) => {
      if (manual) setRefreshing(true);

      try {
        const nextSnapshot = await buildSnapshot();
        setSnapshot(nextSnapshot);
        setError(null);
      } catch {
        setError("Unable to load orchestration operations snapshot.");
      } finally {
        if (initial) setLoading(false);
        if (manual) setRefreshing(false);
      }
    },
    [buildSnapshot]
  );

  useEffect(() => {
    let cancelled = false;

    const safeLoad = async (opts: { initial?: boolean; manual?: boolean } = {}) => {
      if (cancelled) return;
      await loadSnapshot(opts);
    };

    void safeLoad({ initial: true });
    const timer = window.setInterval(() => {
      void safeLoad();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadSnapshot]);

  const stats = useMemo(
    () => [
      { label: "Active Agents", value: snapshot?.activeAgents ?? 0, icon: <Bot className="h-4 w-4" />, accent: "#fbbf24" },
      { label: "Tasks Today", value: snapshot?.tasksToday ?? 0, icon: <CheckCircle2 className="h-4 w-4" />, accent: "#6ee7b7" },
      {
        label: "Velocity / Day",
        value: snapshot?.velocityPerDay?.toFixed(1) ?? "0.0",
        meta: `${snapshot?.weeklyDone ?? 0} done in 7d`,
        icon: <Gauge className="h-4 w-4" />,
        accent: "#fcd34d",
      },
      { label: "Review Queue", value: snapshot?.reviewQueue ?? 0, icon: <Clock3 className="h-4 w-4" />, accent: "#a8a29e" },
      { label: "Stale Alerts", value: snapshot?.staleAlerts ?? 0, icon: <AlertTriangle className="h-4 w-4" />, accent: "#fbbf24" },
    ],
    [snapshot]
  );

  return (
    <section className="orchestra-glass mb-6 rounded-2xl p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/70">Operations</p>
          <h2 className="text-lg font-semibold text-white">Orchestration Pulse</h2>
          <p className="text-sm text-slate-400">Cross-project runtime health and latest task movement.</p>
          <button
            type="button"
            onClick={() => setBridgeDetailsOpen((prev) => !prev)}
            className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
              snapshot?.bridge.tone === "connected"
                ? "border-emerald-300/45 bg-emerald-400/12 text-emerald-100"
                : snapshot?.bridge.tone === "degraded"
                ? "border-amber-300/45 bg-amber-400/12 text-amber-100"
                : "border-rose-300/45 bg-rose-500/12 text-rose-100"
            }`}
            aria-expanded={bridgeDetailsOpen}
            aria-controls="bridge-health-details"
          >
            <HeartPulse className="h-3.5 w-3.5" />
            Bridge: {snapshot?.bridge.label ?? "Checking"}
          </button>
        </div>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadSnapshot({ manual: true })}
            className="orchestra-ghost-btn inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link href="/projects" className="orchestra-cta inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-amber-100">
            Open Projects
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {bridgeDetailsOpen ? (
        <div
          id="bridge-health-details"
          className="mb-4 rounded-xl border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-200"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Bridge Health</span>
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] ${
                snapshot?.bridge.tone === "connected"
                  ? "border-emerald-300/45 bg-emerald-400/12 text-emerald-100"
                  : snapshot?.bridge.tone === "degraded"
                  ? "border-amber-300/45 bg-amber-400/12 text-amber-100"
                  : "border-rose-300/45 bg-rose-500/12 text-rose-100"
              }`}
            >
              {snapshot?.bridge.label ?? "Unknown"}
            </span>
            {snapshot?.bridge.checkedAt ? (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Clock3 className="h-3 w-3" />
                Checked {formatAge(snapshot.bridge.checkedAt)} ago
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-slate-300">{snapshot?.bridge.details ?? "No bridge details available."}</p>
          {snapshot?.bridge.endpointData ? (
            <div className="mt-2 rounded-lg border border-white/10 bg-slate-950/65 p-2 text-[11px] text-slate-300">
              <p>
                Sync: {snapshot.bridge.endpointData.sync.mappedTaskCount}/
                {snapshot.bridge.endpointData.sync.paperclipTaskCount} mapped
              </p>
              <p>
                Mapping errors: {snapshot.bridge.endpointData.mapping.errorCount}
              </p>
              {snapshot.bridge.endpointData.connection.error ? (
                <p>
                  Error: {snapshot.bridge.endpointData.connection.error.code} - {snapshot.bridge.endpointData.connection.error.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mb-3 rounded-lg border border-rose-400/35 bg-rose-500/10 p-2 text-xs text-rose-100">{error}</p> : null}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="orchestra-skeleton h-20 rounded-xl border border-white/10 bg-slate-900/60" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="orchestra-panel rounded-xl p-3">
                <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                  <span style={{ color: stat.accent }}>{stat.icon}</span>
                  {stat.label}
                </p>
                <p className="mt-1 text-xl font-semibold" style={{ color: stat.accent }}>{stat.value}</p>
                {"meta" in stat && stat.meta ? (
                  <p className="mt-1 text-[11px] text-slate-500">{stat.meta}</p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="orchestra-panel mt-4 rounded-xl p-3">
            <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-slate-400">Stale Task Alerts</p>
            {snapshot?.staleItems.length ? (
              <div className="mb-3 space-y-1.5">
                {snapshot.staleItems.map((item) => {
                  const isCritical = item.severity === "critical";
                  return (
                    <Link
                      key={item.taskId}
                      href={`/projects/${item.projectId}/board?task=${item.taskId}`}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                        isCritical
                          ? "border-rose-300/35 bg-rose-500/10 text-rose-100 hover:bg-rose-500/15"
                          : "border-amber-300/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/15"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.projectName}: {item.taskTitle}</p>
                        <p className={`${isCritical ? "text-rose-200/80" : "text-amber-200/80"}`}>
                          {statusTheme[item.taskStatus].label} · {item.ageMinutes}m ({item.thresholdMinutes}m threshold)
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md border border-current/25 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em]">
                        {isCritical ? "Exceeded" : "Approaching"}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="mb-3 rounded-lg border border-white/10 bg-slate-950/55 px-2.5 py-2 text-xs text-slate-400">
                No stale or approaching tasks right now.
              </p>
            )}
          </div>

          <div className="orchestra-panel rounded-xl p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                <Layers3 className="h-3.5 w-3.5 text-slate-300" />
                Workflow Mix
              </p>
              <span className="rounded-md border border-white/10 bg-slate-900/70 px-2 py-0.5 text-[10px] text-slate-300">
                {snapshot?.flow.total ?? 0} tasks tracked
              </span>
            </div>

            <div className="space-y-2">
              <FlowRow
                label={statusTheme.backlog.label}
                count={snapshot?.flow.backlog ?? 0}
                total={snapshot?.flow.total ?? 0}
                tone="slate"
              />
              <FlowRow
                label={statusTheme["on-deck"].label}
                count={snapshot?.flow.onDeck ?? 0}
                total={snapshot?.flow.total ?? 0}
                tone="amber"
              />
              <FlowRow
                label={statusTheme["in-progress"].label}
                count={snapshot?.flow.inProgress ?? 0}
                total={snapshot?.flow.total ?? 0}
                tone="cyan"
              />
              <FlowRow
                label={statusTheme.review.label}
                count={snapshot?.flow.review ?? 0}
                total={snapshot?.flow.total ?? 0}
                tone="indigo"
              />
              <FlowRow
                label={statusTheme.done.label}
                count={snapshot?.flow.done ?? 0}
                total={snapshot?.flow.total ?? 0}
                tone="emerald"
              />
              <FlowRow
                label={statusTheme.blocked.label}
                count={snapshot?.flow.blocked ?? 0}
                total={snapshot?.flow.total ?? 0}
                tone="rose"
              />
            </div>

            <p className="mt-3 text-[11px] text-slate-400">
              Pressure signal:{" "}
              <span className="text-slate-200">
                {(snapshot?.flow.inProgress ?? 0) + (snapshot?.flow.review ?? 0) + (snapshot?.flow.blocked ?? 0)}{" "}
                active/review/blocked
              </span>
            </p>
          </div>

          <div className="orchestra-panel rounded-xl p-3">
            <p className="mb-2 text-[10px] uppercase tracking-[0.12em] text-slate-400">Recent Activity</p>
            {snapshot?.recent.length ? (
              <div className="space-y-1.5">
                {snapshot.recent.map((entry) => (
                  <Link
                    key={entry.id}
                    href={`/projects/${entry.projectId}/board`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-950/55 px-2.5 py-1.5 text-xs text-slate-200 hover:border-amber-300/35"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="mb-1 inline-flex items-center gap-2">
                        {(() => {
                          const agent = resolveAgentVisual(entry.agentName);
                          return (
                            <>
                              <span className="relative inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-slate-800 text-[10px] text-slate-100">
                                {agent.avatar ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={agent.avatar} alt={agent.label} className="h-full w-full object-cover" />
                                ) : (
                                  agent.emoji ?? agent.label.slice(0, 1).toUpperCase()
                                )}
                              </span>
                              <span className="truncate text-[11px] text-slate-300">{entry.agentName ?? "System"}</span>
                            </>
                          );
                        })()}
                      </span>
                      <p className="truncate text-slate-100">
                        {entry.projectName}: {entry.taskTitle ?? entry.sprintName ?? entry.message}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">{entry.message}</p>
                    </div>
                    <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      {entry.oldStatus && entry.newStatus ? (
                        <span className="rounded-md border border-white/15 bg-slate-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-slate-300">
                          {statusTheme[entry.oldStatus].label} → {statusTheme[entry.newStatus].label}
                        </span>
                      ) : (
                        <span className="rounded-md border border-white/15 bg-slate-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-slate-300">
                          {entry.eventType.replace(".", " ")}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <Clock3 className="h-3 w-3" />
                        {formatAge(entry.timestamp)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No orchestration activity yet.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function summarizeBridgeHealth(
  bridge: Awaited<ReturnType<typeof getBridgeStatus>>
): OperationsSnapshot["bridge"] {
  if (!bridge || !bridge.connection.ok) {
    return {
      tone: "down",
      label: "Down",
      details: bridge?.connection.error?.message ?? "Bridge endpoint unavailable or disconnected.",
      checkedAt: bridge?.checkedAt,
      endpointData: bridge ?? null,
    };
  }

  const hasMappingErrors = bridge.mapping.errorCount > 0;
  const hasMappingGap = bridge.sync.paperclipTaskCount > bridge.sync.mappedTaskCount;

  if (hasMappingErrors || hasMappingGap) {
    return {
      tone: "degraded",
      label: "Degraded",
      details: `${bridge.mapping.errorCount} mapping error(s), ${bridge.sync.mappedTaskCount}/${bridge.sync.paperclipTaskCount} tasks mapped.`,
      checkedAt: bridge.checkedAt,
      endpointData: bridge,
    };
  }

  return {
    tone: "connected",
    label: "Connected",
    details: `Bridge healthy with ${bridge.sync.mappedTaskCount} mapped task(s).`,
    checkedAt: bridge.checkedAt,
    endpointData: bridge,
  };
}

function FlowRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "slate" | "amber" | "cyan" | "indigo" | "emerald" | "rose";
}) {
  const ratio = total > 0 ? Math.max(0, Math.min(100, Math.round((count / total) * 100))) : 0;
  const toneClass =
    tone === "amber"
      ? "bg-amber-300/80"
      : tone === "cyan"
      ? "bg-amber-300/85"
      : tone === "indigo"
      ? "bg-amber-300/80"
      : tone === "emerald"
      ? "bg-emerald-300/85"
      : tone === "rose"
      ? "bg-rose-300/80"
      : "bg-slate-300/70";

  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/55 p-2">
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">
          {count} ({ratio}%)
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-900/90">
        <div className={`h-full rounded-full transition-all duration-500 ${toneClass}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}
