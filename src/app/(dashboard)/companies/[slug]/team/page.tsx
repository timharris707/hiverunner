"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, BriefcaseBusiness, Search, UserPlus, Users, Wifi, WifiOff } from "lucide-react";
import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { formatAge } from "@/components/orchestration/ui";
import { DIVISIONS, getAgentByAnyId } from "@/config/agents";
import { listCompanies, listCompanyAgents, listProjects } from "@/lib/orchestration/client";
import type { OrchestrationAgent, OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";

type TeamAgent = OrchestrationAgent & {
  projectName: string;
  department: string;
  departmentLabel: string;
  departmentColor: string;
  reportsToName: string;
};

export default function CompanyTeamPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<TeamAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrchestrationAgent["status"]>("all");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows] = await Promise.all([listCompanies(), listProjects()]);
        const current = companyRows.find((row) => row.slug === slug) ?? null;
        if (cancelled) return;
        setCompany(current);

        if (!current) {
          setProjects([]);
          setAgents([]);
          return;
        }

        const companyProjects = projectRows.filter((project) => project.companyId === current.id);
        const projectNameById = new Map(companyProjects.map((project) => [project.id, project.name]));
        const companyAgents = await listCompanyAgents(slug);

        if (!cancelled) {
          setProjects(companyProjects);
          setAgents(
            companyAgents
              .map((agent) => enrichAgent(agent, projectNameById))
              .sort((a, b) => a.departmentLabel.localeCompare(b.departmentLabel) || a.name.localeCompare(b.name))
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agents.filter((agent) => {
      if (statusFilter !== "all" && agent.status !== statusFilter) return false;
      if (!needle) return true;
      return `${agent.name} ${agent.role} ${agent.departmentLabel} ${agent.projectName} ${agent.reportsToName}`.toLowerCase().includes(needle);
    });
  }, [agents, query, statusFilter]);

  const departmentGroups = useMemo(() => {
    const grouped = new Map<string, { label: string; color: string; agents: TeamAgent[] }>();

    for (const agent of filteredAgents) {
      const key = agent.department;
      const existing = grouped.get(key);
      if (existing) {
        existing.agents.push(agent);
        continue;
      }
      grouped.set(key, {
        label: agent.departmentLabel,
        color: agent.departmentColor,
        agents: [agent],
      });
    }

    return Array.from(grouped.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredAgents]);

  const stats = useMemo(
    () => ({
      total: agents.length,
      working: agents.filter((agent) => agent.status === "working").length,
      online: agents.filter((agent) => agent.status === "working" || agent.status === "idle").length,
      departments: new Set(agents.map((agent) => agent.departmentLabel)).size,
    }),
    [agents]
  );

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <CompanyShell
      eyebrow="Company Workspace"
      title={company ? `${company.name} Team` : "Team"}
      description="This merged team view combines the company roster with org context: department, role, project assignment, and reporting line."
      accentColor="#f59e0b"
    >
      <section className="grid gap-3 md:grid-cols-4">
        <StatCard label="Agents" value={stats.total} accentColor="#f59e0b" />
        <StatCard label="Working Now" value={stats.working} accentColor="#22c55e" />
        <StatCard label="Online" value={stats.online} accentColor="#d97706" />
        <StatCard label="Departments" value={stats.departments} accentColor="#d97706" />
      </section>

      <section className="p-0" style={{ marginTop: 16 }}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-lg border border-white/8 bg-transparent px-10 py-2.5 text-sm text-white outline-none focus:border-white/20"
              placeholder="Search company team"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="rounded-lg border border-white/8 bg-transparent px-3 py-2.5 text-sm text-white outline-none"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | OrchestrationAgent["status"])}
          >
            <option value="all">All statuses</option>
            <option value="working">Working</option>
            <option value="idle">Idle</option>
            <option value="paused">Paused</option>
            <option value="offline">Offline</option>
            <option value="error">Error</option>
          </select>
          <div className="rounded-lg border border-white/8 bg-transparent px-3 py-2 text-xs text-slate-400">
            {projects.length} projects in company
          </div>
          <Link
            href={`/companies/${encodeURIComponent(slug)}/agents/new`}
            className="inline-flex items-center gap-2 rounded-lg border border-white/8 bg-transparent px-3 py-2 text-xs text-slate-200 transition hover:bg-white/3"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add Agent
          </Link>
          <Link
            href={`/companies/${encodeURIComponent(slug)}/org`}
            className="rounded-lg border border-white/8 bg-transparent px-3 py-2 text-xs text-slate-200 transition hover:bg-white/3"
          >
            Open Org Chart
          </Link>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {departmentGroups.map((group) => (
            <section
              key={group.key}
              className="rounded-xl border border-white/8 bg-transparent p-4"
              style={{
                boxShadow: `inset 3px 0 0 ${group.color}`,
              }}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em]" style={{ color: group.color }}>
                    Department
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{group.label}</h2>
                </div>
                <div className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-400">{group.agents.length} agents</div>
              </div>
              <div className="space-y-3">
                {group.agents.map((agent) => (
                  <Link
                    key={agent.id}
                    href={`/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agent.slug || agent.id)}`}
                    className="block rounded-lg border border-white/6 bg-transparent p-3 transition hover:bg-white/[0.02]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{agent.emoji}</span>
                          <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
                        </div>
                        <p className="mt-1 text-sm text-slate-300">{agent.role}</p>
                      </div>
                      <StatusPill status={agent.status} />
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <InfoRow icon={<BriefcaseBusiness className="h-4 w-4" />} label="Project" value={agent.projectName} />
                      <InfoRow icon={<Users className="h-4 w-4" />} label="Reports To" value={agent.reportsToName} />
                      <InfoRow icon={<Activity className="h-4 w-4" />} label="Current Task" value={agent.currentTask ?? "No active task"} />
                      <InfoRow
                        icon={agent.status === "offline" ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
                        label="Heartbeat"
                        value={agent.lastHeartbeat ? formatAge(agent.lastHeartbeat) : "No heartbeat"}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>

        {!loading && filteredAgents.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/8 bg-transparent p-8 text-center text-sm text-slate-400">
            No company agents matched this filter.
          </div>
        ) : null}
      </section>
    </CompanyShell>
  );
}

function enrichAgent(
  agent: OrchestrationAgent,
  projectNameById: Map<string, string>
): TeamAgent {
  const config = getAgentByAnyId(agent.id) ?? getAgentByAnyId(agent.name);
  const division = config?.division ?? "Leadership";
  const divisionMeta = DIVISIONS[division] ?? { label: "Operations", color: "#94a3b8", icon: "•" };

  return {
    ...agent,
    projectName: (agent.projectId && projectNameById.get(agent.projectId)) || "Unassigned",
    department: division,
    departmentLabel: divisionMeta.label,
    departmentColor: divisionMeta.color,
    reportsToName: agent.reportingToName ?? config?.reportsTo ?? "Unassigned",
  };
}

function StatusPill({ status }: { status: OrchestrationAgent["status"] }) {
  const tones: Record<OrchestrationAgent["status"], { color: string; bg: string; label: string }> = {
    working: { color: "#4ade80", bg: "rgba(74,222,128,0.16)", label: "Working" },
    idle: { color: "#d97706", bg: "rgba(217,119,6,0.16)", label: "Idle" },
    paused: { color: "#f59e0b", bg: "rgba(245,158,11,0.16)", label: "Paused" },
    offline: { color: "#94a3b8", bg: "rgba(148,163,184,0.16)", label: "Offline" },
    error: { color: "#f87171", bg: "rgba(248,113,113,0.16)", label: "Error" },
  };
  const tone = tones[status];

  return (
    <span
      className="rounded-full px-2 py-1 text-[11px] font-medium"
      style={{
        color: tone.color,
        backgroundColor: tone.bg,
      }}
    >
      {tone.label}
    </span>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/6 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm text-slate-200">{value}</p>
    </div>
  );
}
