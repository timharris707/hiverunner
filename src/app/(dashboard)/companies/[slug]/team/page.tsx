"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Activity, ArchiveRestore, BriefcaseBusiness, Search, Trash2, UserPlus, Users, Wifi, WifiOff } from "lucide-react";
import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { AvatarGlyph } from "@/components/orchestration/AvatarGlyph";
import { formatAge } from "@/components/orchestration/ui";
import { DIVISIONS, getAgentByAnyId } from "@/config/agents";
import { deleteCompanyAgent, listCompanies, listCompanyAgents, listProjects, restoreCompanyAgent } from "@/lib/orchestration/client";
import { buildCanonicalAgentPath, buildCanonicalNewAgentPath, buildCanonicalOrgPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationAgent, OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";

type TeamAgent = OrchestrationAgent & {
  projectName: string;
  department: string;
  departmentLabel: string;
  departmentColor: string;
  reportsToName: string;
};

function readableDivisionColor(color: string): string {
  if (color === "#f59e0b" || color === "#d97706") return "var(--accent)";
  if (color === "#10b981" || color === "#22c55e") return "var(--positive)";
  return color;
}

export default function CompanyTeamPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<TeamAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrchestrationAgent["status"]>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows] = await Promise.all([listCompanies(), listProjects({ company: slug })]);
        const current = companyRows.find((row) => row.slug === slug || row.code === slug.toUpperCase()) ?? null;
        if (cancelled) return;
        setCompany(current);

        if (!current) {
          setProjects([]);
          setAgents([]);
          return;
        }

        const projectNameById = new Map(projectRows.map((project) => [project.id, project.name]));
        const companyAgents = await listCompanyAgents(current.slug, { includeArchived: showArchived });

        if (!cancelled) {
          setProjects(projectRows);
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
  }, [slug, showArchived, refreshKey]);

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
        color: readableDivisionColor(agent.departmentColor),
        agents: [agent],
      });
    }

    return Array.from(grouped.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredAgents]);

  const stats = useMemo(
    () => ({
      total: agents.filter((agent) => !agent.archivedAt).length,
      working: agents.filter((agent) => agent.status === "working").length,
      online: agents.filter((agent) => agent.status === "working" || agent.status === "idle").length,
      departments: new Set(agents.map((agent) => agent.departmentLabel)).size,
      archived: agents.filter((agent) => agent.archivedAt).length,
    }),
    [agents]
  );
  const companyCode = company?.code || slug.slice(0, 3).toUpperCase();

  const handleRestoreAgent = async (agent: TeamAgent) => {
    const ok = await restoreCompanyAgent(agent.id);
    if (ok) setRefreshKey((value) => value + 1);
  };

  const handleDeleteAgent = async (agent: TeamAgent) => {
    const confirmed = window.confirm(`Delete ${agent.name}? This permanently deletes the agent identity, private runtime artifacts, and agent workspace files.`);
    if (!confirmed) return;
    const ok = await deleteCompanyAgent(agent.id, { replacementFallback: "the team" });
    if (ok) setRefreshKey((value) => value + 1);
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <CompanyShell
      eyebrow="Company Workspace"
      title={company ? `${company.name} Team` : "Team"}
      description="This roster view combines company agents with role grouping, project assignment, and reporting line."
      accentColor="var(--accent)"
    >
      <section className="grid gap-3 md:grid-cols-4">
        <StatCard label="Agents" value={stats.total} accentColor="var(--accent)" />
        <StatCard label="Working Now" value={stats.working} accentColor="var(--positive)" />
        <StatCard label="Online" value={stats.online} accentColor="var(--accent)" />
        <StatCard label="Role Groups" value={stats.departments} accentColor="var(--accent)" />
      </section>

      <section className="p-0" style={{ marginTop: 16 }}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
            <input
              className="w-full rounded-lg border bg-transparent px-10 py-2.5 text-sm outline-none"
              style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="Search roster"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="rounded-lg border bg-transparent px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
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
          <div className="rounded-lg border bg-transparent px-3 py-2 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
            {projects.length} projects in company
          </div>
          <button
            type="button"
            onClick={() => setShowArchived((value) => !value)}
            className="rounded-lg border bg-transparent px-3 py-2 text-xs transition"
            style={{ borderColor: "var(--border)", color: showArchived ? "var(--accent)" : "var(--text-primary)" }}
          >
            {showArchived ? "Hide archived" : `Show archived${stats.archived ? ` (${stats.archived})` : ""}`}
          </button>
          <Link
            href={buildCanonicalNewAgentPath(companyCode)}
            className="inline-flex items-center gap-2 rounded-lg border bg-transparent px-3 py-2 text-xs transition"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add Agent
          </Link>
          <Link
            href={buildCanonicalOrgPath(companyCode)}
            className="rounded-lg border bg-transparent px-3 py-2 text-xs transition"
            style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
          >
            Open Org Chart
          </Link>
        </div>

	        <div className="grid gap-4 xl:grid-cols-2">
	          {departmentGroups.map((group) => (
	            <section
	              key={group.key}
	              className="rounded-xl border bg-transparent p-4"
	              style={{
	                borderColor: "var(--border)",
	                boxShadow: `inset 3px 0 0 ${group.color}`,
	              }}
	            >
	              <div className="mb-4 flex items-center justify-between gap-3">
	                <div>
	                  <p className="text-xs uppercase tracking-[0.22em]" style={{ color: group.color }}>
	                    Role Group
	                  </p>
	                  <h2 className="mt-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>{group.label}</h2>
	                </div>
	                <div className="rounded-full px-3 py-1 text-xs" style={{ background: "var(--surface-hover)", color: "var(--text-secondary)" }}>{group.agents.length} agents</div>
	              </div>
	              <div className="space-y-3">
	                {group.agents.map((agent) => (
                    <AgentTeamCard
                      key={agent.id}
                      agent={agent}
                      companyCode={companyCode}
                      onRestore={handleRestoreAgent}
                      onDelete={handleDeleteAgent}
                    />
                ))}
              </div>
            </section>
          ))}
        </div>

	        {!loading && filteredAgents.length === 0 ? (
	          <div className="rounded-lg border border-dashed bg-transparent p-8 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
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

function StatusPill({
  status,
  hireApprovalStatus,
  archivedAt,
}: {
  status: OrchestrationAgent["status"];
  hireApprovalStatus?: OrchestrationAgent["hireApprovalStatus"];
  archivedAt?: string;
}) {
  if (archivedAt) {
    return (
      <span
        className="rounded-full px-2 py-1 text-[11px] font-medium"
        style={{
          color: "var(--text-muted)",
          backgroundColor: "var(--surface-hover)",
        }}
      >
        Archived
      </span>
    );
  }

  if (hireApprovalStatus === "pending" || hireApprovalStatus === "revision_requested") {
    return (
      <span
        className="rounded-full px-2 py-1 text-[11px] font-medium"
        style={{
          color: "var(--warning)",
          backgroundColor: "var(--warning-soft)",
        }}
      >
        Pending approval
      </span>
    );
  }

  const tones: Record<OrchestrationAgent["status"], { color: string; bg: string; label: string }> = {
    working: { color: "var(--positive)", bg: "var(--surface-hover)", label: "Working" },
    idle: { color: "var(--accent)", bg: "var(--surface-hover)", label: "Idle" },
    paused: { color: "var(--warning)", bg: "var(--surface-hover)", label: "Paused" },
    offline: { color: "var(--text-muted)", bg: "var(--surface-hover)", label: "Offline" },
    error: { color: "var(--negative)", bg: "var(--surface-hover)", label: "Error" },
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

function AgentTeamCard({
  agent,
  companyCode,
  onRestore,
  onDelete,
}: {
  agent: TeamAgent;
  companyCode: string;
  onRestore: (agent: TeamAgent) => Promise<void>;
  onDelete: (agent: TeamAgent) => Promise<void>;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
              style={{ borderColor: "var(--border)", background: "var(--surface-hover)" }}
            >
              <AvatarGlyph value={agent.emoji} size={14} color="var(--text-primary)" />
            </span>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{agent.name}</h3>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>{agent.role}</p>
        </div>
        <StatusPill status={agent.status} hireApprovalStatus={agent.hireApprovalStatus} archivedAt={agent.archivedAt} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <InfoRow icon={<BriefcaseBusiness className="h-4 w-4" />} label="Project" value={agent.projectName} />
        <InfoRow icon={<Users className="h-4 w-4" />} label="Reports To" value={agent.reportsToName} />
        <InfoRow icon={<Activity className="h-4 w-4" />} label="Current Task" value={agent.currentTask ?? "No active task"} />
        <InfoRow
          icon={agent.status === "offline" ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
          label={agent.archivedAt ? "Archived" : "Heartbeat"}
          value={agent.archivedAt ? formatAge(agent.archivedAt) : (agent.lastHeartbeat ? formatAge(agent.lastHeartbeat) : "No heartbeat")}
        />
      </div>
    </>
  );

  if (!agent.archivedAt) {
    return (
      <Link
        href={buildCanonicalAgentPath(companyCode, agent.slug || agent.id)}
        className="block rounded-lg border bg-transparent p-3 transition"
        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
      >
        {body}
      </Link>
    );
  }

  return (
    <div
      className="rounded-lg border bg-transparent p-3"
      style={{ borderColor: "var(--border)", color: "var(--text-primary)", opacity: 0.85 }}
    >
      {body}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void onRestore(agent)}
          className="inline-flex items-center gap-2 rounded-lg border bg-transparent px-3 py-2 text-xs transition"
          style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
        >
          <ArchiveRestore className="h-3.5 w-3.5" />
          Restore
        </button>
        <button
          type="button"
          onClick={() => void onDelete(agent)}
          className="inline-flex items-center gap-2 rounded-lg border bg-transparent px-3 py-2 text-xs transition"
          style={{ borderColor: "var(--negative)", color: "var(--negative)" }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </div>
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
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--text-primary)" }}>{value}</p>
    </div>
  );
}
