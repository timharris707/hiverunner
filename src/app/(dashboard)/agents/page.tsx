"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Bot, Building2, GitBranch, Search, Wifi, WifiOff } from "lucide-react";
import { formatAge } from "@/components/orchestration/ui";
import {
  getProjectBoard,
  listCompanies,
  listProjectAgents,
  listProjects,
} from "@/lib/orchestration/client";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
} from "@/lib/orchestration/types";

type GlobalRosterAgent = OrchestrationAgent & {
  primaryProjectId: string;
  primaryProjectName: string;
  companyId?: string;
  companyName: string;
  companySlug?: string;
  projectIds: string[];
  projectNames: string[];
};

const CANONICAL_COMPANY_ID = "6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f";

export default function AgentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrchestrationAgent["status"]>("all");
  const [companyFilter, setCompanyFilter] = useState<string>(CANONICAL_COMPANY_ID);
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"roster" | "org">("roster");
  const [agents, setAgents] = useState<GlobalRosterAgent[]>([]);
  const [companies, setCompanies] = useState<OrchestrationCompany[]>([]);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);

  useEffect(() => {
    let cancelled = false;

    const loadDirectory = async () => {
      setLoading(true);
      setError(null);

      try {
        const [companyRows, projectRows] = await Promise.all([listCompanies(), listProjects()]);

        if (cancelled) return;
        setCompanies(companyRows);
        setProjects(projectRows);

        const companyById = new Map(companyRows.map((company) => [company.id, company]));

        const rosterGroups = await Promise.all(
          projectRows.map(async (project) => {
            const board = await getProjectBoard(project.id);
            const roster = await listProjectAgents(project.id, board?.tasks ?? []);
            const company = project.companyId ? companyById.get(project.companyId) : undefined;

            return roster.map((agent) => ({
              ...agent,
              primaryProjectId: project.id,
              primaryProjectName: project.name,
              companyId: project.companyId,
              companyName: company?.name ?? "Unscoped Company",
              companySlug: company?.slug,
              projectIds: [project.id],
              projectNames: [project.name],
            }));
          })
        );

        if (cancelled) return;

        const deduped = new Map<string, GlobalRosterAgent>();
        for (const group of rosterGroups) {
          for (const agent of group) {
            const key = `${agent.companyId ?? "unscoped"}:${agent.id}`;
            const existing = deduped.get(key);
            if (!existing) {
              deduped.set(key, agent);
              continue;
            }

            const projectIds = Array.from(new Set([...existing.projectIds, ...agent.projectIds]));
            const projectNames = Array.from(new Set([...existing.projectNames, ...agent.projectNames])).sort((a, b) =>
              a.localeCompare(b)
            );

            const existingStatusRank = getStatusRank(existing.status);
            const nextStatusRank = getStatusRank(agent.status);
            const preferred = nextStatusRank > existingStatusRank ? agent : existing;

            deduped.set(key, {
              ...existing,
              ...preferred,
              projectIds,
              projectNames,
              primaryProjectId: existing.primaryProjectId,
              primaryProjectName: existing.primaryProjectName,
            });
          }
        }

        setAgents(Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) {
          setError("Failed to load global agent directory.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDirectory();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();

    return agents.filter((agent) => {
      if (statusFilter !== "all" && agent.status !== statusFilter) return false;
      if (companyFilter !== "all" && agent.companyId !== companyFilter) return false;
      if (roleFilter !== "all" && agent.role !== roleFilter) return false;
      if (!lower) return true;
      const haystack = `${agent.name} ${agent.role} ${agent.companyName} ${agent.projectNames.join(" ")} ${agent.currentTask ?? ""}`.toLowerCase();
      return haystack.includes(lower);
    });
  }, [agents, companyFilter, query, roleFilter, statusFilter]);

  const roleOptions = useMemo(
    () => Array.from(new Set(agents.map((agent) => agent.role).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [agents]
  );

  const stats = useMemo(
    () => ({
      total: agents.length,
      companies: new Set(agents.map((agent) => agent.companyName)).size,
      working: agents.filter((agent) => agent.status === "working").length,
      idle: agents.filter((agent) => agent.status === "idle").length,
      paused: agents.filter((agent) => agent.status === "paused").length,
      offline: agents.filter((agent) => agent.status === "offline").length,
    }),
    [agents]
  );

  const orgGroups = useMemo(() => {
    const byCompany = new Map<
      string,
      {
        key: string;
        companyName: string;
        companySlug?: string;
        lead: GlobalRosterAgent;
        members: GlobalRosterAgent[];
      }
    >();

    for (const agent of filtered) {
      const key = agent.companyId ?? `company:${agent.companyName}`;
      const existing = byCompany.get(key);
      if (!existing) {
        byCompany.set(key, {
          key,
          companyName: agent.companyName,
          companySlug: agent.companySlug,
          lead: agent,
          members: [],
        });
        continue;
      }

      const [nextLead, nextMember] = pickLead(existing.lead, agent);
      existing.lead = nextLead;
      if (nextMember) {
        existing.members.push(nextMember);
      }
    }

    return Array.from(byCompany.values())
      .map((group) => ({
        ...group,
        members: group.members.sort((a, b) => {
          const statusDelta = getStatusRank(b.status) - getStatusRank(a.status);
          if (statusDelta !== 0) return statusDelta;
          return a.name.localeCompare(b.name);
        }),
      }))
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [filtered]);

  return (
    <div className="space-y-6 p-4 md:p-8">
      <section className="orchestra-glass orchestra-enter rounded-3xl p-5 md:p-8">
        <p className="text-[11px] uppercase tracking-[0.24em] text-cyan-100/70">Orchestration Layer</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Global Agent Directory</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">
          Cross-company roster view of every orchestration agent, active assignment, and heartbeat status.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Stat label="Agents" value={stats.total} />
          <Stat label="Companies" value={stats.companies} />
          <Stat label="Working" value={stats.working} accent="#6ee7b7" />
          <Stat label="Idle" value={stats.idle} accent="#93c5fd" />
          <Stat label="Paused" value={stats.paused} accent="#fbbf24" />
          <Stat label="Offline" value={stats.offline} accent="#fda4af" />
        </div>
      </section>

      <section className="orchestra-glass rounded-2xl p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, role, company, project, or task"
              className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-10 py-2.5 text-sm text-white outline-none focus:border-cyan-400/60"
            />
          </div>

          <select
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            <option value="all">All companies</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>

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

          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            <option value="all">All roles</option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          <div className="ml-auto inline-flex items-center gap-1 rounded-xl border border-white/10 bg-slate-900/80 p-1">
            <button
              type="button"
              onClick={() => setViewMode("roster")}
              className={`rounded-lg px-2.5 py-1.5 text-xs ${
                viewMode === "roster"
                  ? "bg-cyan-400/20 text-cyan-100"
                  : "text-slate-300 hover:bg-slate-800/80"
              }`}
              aria-pressed={viewMode === "roster"}
            >
              Roster
            </button>
            <button
              type="button"
              onClick={() => setViewMode("org")}
              className={`rounded-lg px-2.5 py-1.5 text-xs ${
                viewMode === "org"
                  ? "bg-cyan-400/20 text-cyan-100"
                  : "text-slate-300 hover:bg-slate-800/80"
              }`}
              aria-pressed={viewMode === "org"}
            >
              Org Chart
            </button>
          </div>
        </div>

        {error ? <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-slate-900/65" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/55 p-10 text-center text-sm text-slate-400">
            {agents.length === 0 ? "No orchestration agents found yet." : "No agents match this filter."}
            {agents.length > 0 ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setStatusFilter("all");
                    setCompanyFilter("all");
                    setRoleFilter("all");
                  }}
                  className="orchestra-ghost-btn rounded-lg px-2.5 py-1 text-xs text-slate-200"
                >
                  Reset filters
                </button>
              </div>
            ) : null}
          </div>
        ) : viewMode === "org" ? (
          <div className="space-y-3">
            {orgGroups.map((group) => (
              <section key={group.key} className="orchestra-card rounded-2xl p-4">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Company</p>
                    <p className="text-sm font-semibold text-white">{group.companyName}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-md border border-cyan-300/35 bg-cyan-400/12 px-2 py-1 text-[11px] text-cyan-100">
                    <GitBranch className="h-3.5 w-3.5" />
                    {group.members.length + 1} agents
                  </span>
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_1fr]">
                  <OrgNode agent={group.lead} roleLabel="Lead" projectId={group.lead.primaryProjectId} />
                  <div className="relative rounded-xl border border-white/10 bg-slate-950/45 p-3">
                    <div className="pointer-events-none absolute left-1.5 top-0 h-full w-px bg-gradient-to-b from-cyan-300/40 via-cyan-300/15 to-transparent" />
                    {group.members.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-700/75 bg-slate-900/55 px-3 py-2 text-xs text-slate-400">
                        No additional members in current filter scope.
                      </p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {group.members.map((member) => (
                          <OrgNode
                            key={`${member.companyId ?? "unscoped"}:${member.id}`}
                            agent={member}
                            roleLabel="Member"
                            projectId={member.primaryProjectId}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((agent) => (
              <article
                key={`${agent.companyId ?? "unscoped"}:${agent.id}`}
                className="orchestra-card rounded-2xl p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <AgentGlyph agent={agent} />
                  <StatusBadge status={agent.status} />
                </div>

                <Link
                  href={`/agents/${encodeURIComponent(agent.id)}?projectId=${encodeURIComponent(agent.primaryProjectId)}`}
                  className="text-sm font-semibold text-white hover:text-cyan-100"
                >
                  {agent.name}
                </Link>
                <p className="mt-1 text-xs text-slate-400">{agent.role}</p>

                <div className="mt-3 space-y-2 text-xs">
                  <InfoRow icon={<Activity className="h-3.5 w-3.5" />} label="Current Task" value={agent.currentTask || "Idle — ready"} />
                  <InfoRow icon={<Bot className="h-3.5 w-3.5" />} label="Model" value={agent.model || "Pending Forge contract"} />
                  <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Company" value={agent.companyName} />
                  <InfoRow
                    icon={agent.lastHeartbeat ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    label="Heartbeat"
                    value={agent.lastHeartbeat ? `${formatAge(agent.lastHeartbeat)} ago` : "No heartbeat yet"}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-slate-400">
                    {agent.projectNames.length <= 1
                      ? `Project: ${agent.primaryProjectName}`
                      : `Projects: ${agent.projectNames[0]} +${agent.projectNames.length - 1}`}
                  </p>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/agents/${encodeURIComponent(agent.id)}?projectId=${encodeURIComponent(agent.primaryProjectId)}`}
                      className="text-[11px] text-emerald-200 hover:text-emerald-100"
                    >
                      View profile
                    </Link>
                    <Link href={`/projects/${agent.primaryProjectId}/board`} className="text-[11px] text-cyan-200 hover:text-cyan-100">
                      Open board
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/55 p-4 text-xs text-slate-400">
        {projects.length} projects scanned across {companies.length} companies.
      </section>
    </div>
  );
}

function getStatusRank(status: OrchestrationAgent["status"]): number {
  switch (status) {
    case "working":
      return 4;
    case "idle":
      return 3;
    case "paused":
      return 2;
    case "offline":
      return 1;
    default:
      return 0;
  }
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/55 p-3">
      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold" style={{ color: accent ?? "#e2e8f0" }}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: OrchestrationAgent["status"] }) {
  const palette: Record<OrchestrationAgent["status"], { text: string; bg: string; border: string }> = {
    working: { text: "#6ee7b7", bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.45)" },
    idle: { text: "#93c5fd", bg: "rgba(59,130,246,0.16)", border: "rgba(59,130,246,0.4)" },
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

function AgentGlyph({ agent }: { agent: GlobalRosterAgent }) {
  const live = agent.status === "working";
  return (
    <span
      className={`inline-flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-slate-800 text-lg ${
        live ? "orchestra-live-avatar border-emerald-300/45" : ""
      }`}
    >
      {agent.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={agent.avatar} alt={`${agent.name} avatar`} className="h-full w-full object-cover" />
      ) : (
        agent.emoji
      )}
      {live ? <span className="orchestra-live-dot" aria-hidden="true" /> : null}
    </span>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
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

function pickLead(
  current: GlobalRosterAgent,
  incoming: GlobalRosterAgent
): [GlobalRosterAgent, GlobalRosterAgent | null] {
  const currentLeadScore = getLeadScore(current);
  const incomingLeadScore = getLeadScore(incoming);

  if (incomingLeadScore > currentLeadScore) {
    return [incoming, current];
  }

  return [current, incoming];
}

function getLeadScore(agent: GlobalRosterAgent): number {
  const role = agent.role.toLowerCase();
  const leadKeyword = /(lead|manager|director|chief|head|ceo|cto|cpo|coo|principal)/.test(role) ? 10 : 0;
  return leadKeyword + getStatusRank(agent.status);
}

function OrgNode({
  agent,
  roleLabel,
  projectId,
}: {
  agent: GlobalRosterAgent;
  roleLabel: string;
  projectId: string;
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-slate-900/75 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <AgentGlyph agent={agent} />
        <StatusBadge status={agent.status} />
      </div>
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{roleLabel}</p>
      <p className="mt-1 text-sm font-semibold text-white">{agent.name}</p>
      <p className="text-xs text-slate-400">{agent.role}</p>
      <p className="mt-2 text-[11px] text-slate-400">
        {agent.currentTask || "Idle - ready for assignment"}
      </p>
      <div className="mt-3 flex items-center justify-end">
        <Link
          href={`/agents/${encodeURIComponent(agent.id)}?projectId=${encodeURIComponent(projectId)}`}
          className="text-[11px] text-cyan-200 hover:text-cyan-100"
        >
          Open profile
        </Link>
      </div>
    </article>
  );
}
