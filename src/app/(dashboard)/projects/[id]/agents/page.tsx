"use client";

import { use, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Activity, Bot, Loader2, Search, Sparkles, Wifi, WifiOff } from "lucide-react";
import { ProjectShellNav } from "@/components/orchestration/ProjectShellNav";
import { formatAge } from "@/components/orchestration/ui";
import { getProjectBoard, listCompanies, listProjectAgents, triggerAgentHeartbeat } from "@/lib/orchestration/client";
import type { OrchestrationAgent } from "@/lib/orchestration/types";

export default function ProjectAgentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [projectName, setProjectName] = useState("Project");
  const [companySlug, setCompanySlug] = useState<string | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrchestrationAgent["status"]>("all");
  const [heartbeatNotice, setHeartbeatNotice] = useState<string | null>(null);
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [heartbeatPendingById, setHeartbeatPendingById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let mounted = true;

    getProjectBoard(id)
      .then(async (board) => {
        if (!board || !mounted) {
          setError("Project not found.");
          return;
        }

        setProjectName(board.project.name);
        const companies = await listCompanies();
        const company = board.project.companyId
          ? companies.find((candidate) => candidate.id === board.project.companyId)
          : null;
        const roster = await listProjectAgents(id, board.tasks);
        if (mounted) {
          setCompanySlug(company?.slug ?? null);
          setAgents(roster);
          setError(null);
        }
      })
      .catch(() => {
        if (mounted) setError("Failed to load project roster.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const filteredAgents = useMemo(() => {
    const lower = query.trim().toLowerCase();

    return agents.filter((agent) => {
      if (statusFilter !== "all" && agent.status !== statusFilter) return false;
      if (!lower) return true;
      const text = `${agent.name} ${agent.role} ${agent.currentTask ?? ""}`.toLowerCase();
      return text.includes(lower);
    });
  }, [agents, query, statusFilter]);

  const stats = useMemo(
    () => ({
      active: agents.filter((agent) => agent.status === "working").length,
      idle: agents.filter((agent) => agent.status === "idle").length,
      paused: agents.filter((agent) => agent.status === "paused").length,
    }),
    [agents]
  );

  const handleTriggerHeartbeat = async (agentId: string) => {
    setHeartbeatError(null);
    setHeartbeatNotice(null);
    setHeartbeatPendingById((prev) => ({ ...prev, [agentId]: true }));

    const result = await triggerAgentHeartbeat(agentId, { source: "manual" });

    setHeartbeatPendingById((prev) => ({ ...prev, [agentId]: false }));

    if (!result) {
      setHeartbeatError("Heartbeat trigger failed. Try again in a moment.");
      return;
    }

    setHeartbeatNotice(`Heartbeat received for ${result.agent.name}.`);
    setAgents((prev) =>
      prev.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              status: result.agent.status,
              lastHeartbeat: result.agent.lastHeartbeat,
            }
          : agent
      )
    );
  };

  return (
    <div className="orchestra-shell p-4 md:p-8">
      <ProjectShellNav projectId={id} projectName={projectName} />

      <section className="orchestra-glass mb-4 rounded-2xl p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Project Agent Roster</h2>
            <p className="mt-1 text-sm text-slate-400">Company-owned agents assigned to this project&apos;s workstream.</p>
          </div>
          <button type="button" className="orchestra-cta inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-amber-100">
            <Sparkles className="h-3.5 w-3.5" />
            Add Agent
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="Total Agents" value={agents.length} />
          <Stat label="Working Now" value={stats.active} accent="text-emerald-300" />
          <Stat label="Idle / Paused" value={stats.idle + stats.paused} />
        </div>
      </section>

      <section className="orchestra-panel rounded-2xl p-4 backdrop-blur-xl md:p-5">
        {error ? <div className="mb-3 rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
        {heartbeatError ? (
          <div className="mb-3 rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">
            {heartbeatError}
          </div>
        ) : null}
        {heartbeatNotice ? (
          <div className="mb-3 rounded-xl border border-amber-300/35 bg-amber-400/10 p-3 text-sm text-amber-100">
            {heartbeatNotice}
          </div>
        ) : null}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search roster"
              className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            <option value="all">All statuses</option>
            <option value="working">Working</option>
            <option value="idle">Idle</option>
            <option value="paused">Paused</option>
            <option value="offline">Offline</option>
          </select>
        </div>

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="orchestra-skeleton h-40 rounded-2xl border border-white/10 bg-slate-900/65" />
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/55 p-10 text-center text-sm text-slate-400">
            No agents match this filter yet.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredAgents.map((agent) => (
              <article key={agent.id} className="orchestra-card group rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300/40">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-slate-800 text-lg">
                    {agent.emoji}
                  </div>
                  <StatusBadge status={agent.status} />
                </div>

                <h3 className="text-sm font-semibold text-white transition-colors group-hover:text-amber-100">{agent.name}</h3>
                <p className="mt-1 text-xs text-slate-400">{agent.role}</p>

                <div className="mt-3 space-y-2 text-xs">
                  <InfoRow
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label="Current Task"
                    value={agent.currentTask || "Idle — ready for assignment"}
                  />
                  <InfoRow
                    icon={<Bot className="h-3.5 w-3.5" />}
                    label="Model"
                    value={agent.model || "Pending Forge contract"}
                  />
                  <InfoRow
                    icon={agent.lastHeartbeat ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    label="Heartbeat"
                    value={agent.lastHeartbeat ? `${formatAge(agent.lastHeartbeat)} ago` : "No heartbeat yet"}
                  />
                </div>

                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => void handleTriggerHeartbeat(agent.id)}
                    disabled={Boolean(heartbeatPendingById[agent.id])}
                    className="mr-2 inline-flex items-center gap-1 rounded-md border border-amber-300/35 bg-amber-400/10 px-2 py-1 text-[11px] text-amber-100 disabled:opacity-50"
                  >
                    {heartbeatPendingById[agent.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
                    Ping
                  </button>
                  <Link
                    href={
                      companySlug
                        ? `/companies/${encodeURIComponent(companySlug)}/agents/${encodeURIComponent(agent.slug || agent.id)}`
                        : `/agents/${encodeURIComponent(agent.slug || agent.id)}?projectId=${encodeURIComponent(id)}`
                    }
                    className="text-[11px] text-emerald-200 hover:text-emerald-100"
                  >
                    View profile
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="orchestra-panel rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold text-white ${accent ?? ""}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: OrchestrationAgent["status"] }) {
  const palette: Record<OrchestrationAgent["status"], { text: string; bg: string; border: string }> = {
    working: { text: "#6ee7b7", bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.45)" },
    idle: { text: "#fbbf24", bg: "rgba(217,119,6,0.16)", border: "rgba(217,119,6,0.4)" },
    paused: { text: "#fcd34d", bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.4)" },
    offline: { text: "#fda4af", bg: "rgba(244,63,94,0.16)", border: "rgba(244,63,94,0.4)" },
    error: { text: "#f87171", bg: "rgba(239,68,68,0.18)", border: "rgba(239,68,68,0.5)" },
  };

  return (
    <span
      className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]"
      style={{
        color: palette[status].text,
        borderColor: palette[status].border,
        backgroundColor: palette[status].bg,
      }}
    >
      {status}
    </span>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
      <p className="inline-flex items-center gap-1 text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-slate-200">{value}</p>
    </div>
  );
}
