"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Building2, Crown, Layers3, Users } from "lucide-react";
import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { DIVISIONS, getAgentByAnyId } from "@/config/agents";
import { listCompanies, listCompanyAgents } from "@/lib/orchestration/client";
import type { OrchestrationAgent, OrchestrationCompany } from "@/lib/orchestration/types";

type OrgNode = {
  id: string;
  name: string;
  role: string;
  emoji: string;
  avatar?: string;
  status: OrchestrationAgent["status"];
  managerId?: string;
  managerLabel: string;
  departmentColor: string;
};

export default function CompanyOrgPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companies, companyAgents] = await Promise.all([listCompanies(), listCompanyAgents(slug)]);
        if (cancelled) return;
        setCompany(companies.find((candidate) => candidate.slug === slug) ?? null);
        setAgents(companyAgents);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const org = useMemo(() => buildOrg(agents), [agents]);

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/companies" />;
  }

  return (
    <CompanyShell
      eyebrow="Company Workspace"
      title={company ? `${company.name} Org` : "Org"}
      description="Team hierarchy from orchestration roster. Reporting lines are resolved from real company agent relationships first, with config fallbacks only when no DB link exists."
      accentColor="#f59e0b"
    >
      <section className="grid gap-3 md:grid-cols-4">
        <StatCard label="Agents" value={org.totalAgents} accentColor="#f59e0b" />
        <StatCard label="Leads" value={org.rootCount} accentColor="#22c55e" />
        <StatCard label="Levels" value={org.levels.length} accentColor="#d97706" />
        <StatCard label="Relations" value={org.edgeCount} accentColor="#d97706" />
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-amber-100/70">Hierarchy Map</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Reporting Structure</h2>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
            <Building2 className="h-3.5 w-3.5" />
            /companies/{slug}/org
          </div>
        </div>

        {org.levels.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-8 text-center text-sm text-slate-400">
            No company agents found.
          </div>
        ) : (
          <div className="space-y-5">
            {org.levels.map((level, index) => (
              <section key={`level-${index}`} className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Layers3 className="h-3.5 w-3.5" />
                  Level {index + 1}
                </div>
                <div className="flex flex-wrap gap-3">
                  {level.map((node) => {
                    const reports = org.childrenById.get(node.id)?.length ?? 0;
                    const statusTone = toneForStatus(node.status);
                    return (
                      <Link
                        key={node.id}
                        href={`/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(node.id)}`}
                        className="block min-w-[220px] flex-1 rounded-2xl border border-white/10 bg-slate-900/70 p-3 transition hover:border-amber-300/30"
                        style={{ boxShadow: `inset 3px 0 0 ${node.departmentColor}` }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Avatar node={node} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <h3 className="text-sm font-semibold text-white">{node.name}</h3>
                                {isCeo(node) ? <Crown className="h-3.5 w-3.5 text-amber-300" /> : null}
                              </div>
                              <p className="text-xs text-slate-300">{node.role}</p>
                            </div>
                          </div>
                          <span
                            className="rounded-full px-2 py-1 text-[11px] font-medium"
                            style={{ color: statusTone.color, backgroundColor: statusTone.bg }}
                          >
                            {statusTone.label}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                          <InfoLabel icon={<Users className="h-3.5 w-3.5" />} label="Reports" value={String(reports)} />
                          <InfoLabel icon={<ArrowRight className="h-3.5 w-3.5" />} label="Manager" value={node.managerLabel} />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </CompanyShell>
  );
}

function buildOrg(agents: OrchestrationAgent[]) {
  const nodeById = new Map<string, OrgNode>();
  const keyToId = new Map<string, string>();

  for (const agent of agents) {
    const config = getAgentByAnyId(agent.id) ?? getAgentByAnyId(agent.name);
    const division = config?.division ?? "Leadership";
    const divisionMeta = DIVISIONS[division] ?? { label: "Operations", color: "#94a3b8", icon: "•" };

    const node: OrgNode = {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      emoji: agent.emoji,
      avatar: agent.avatar,
      status: agent.status,
      managerLabel: "None",
      departmentColor: divisionMeta.color,
    };

    nodeById.set(node.id, node);
    indexNodeKeys(agent, keyToId);
  }

  const ceoNodes = Array.from(nodeById.values()).filter(isCeo);
  const defaultLeadId = ceoNodes[0]?.id;

  for (const agent of agents) {
    const node = nodeById.get(agent.id);
    if (!node) continue;

    const config = getAgentByAnyId(agent.id) ?? getAgentByAnyId(agent.name);
    const configuredManager = config?.reportsTo;
    const managerId = resolveManagerId(agent.reportingTo, keyToId) ?? resolveManagerId(configuredManager, keyToId);

    if (agent.reportingToName) {
      node.managerLabel = agent.reportingToName;
    }

    if (managerId && managerId !== node.id) {
      node.managerId = managerId;
      node.managerLabel = agent.reportingToName ?? nodeById.get(managerId)?.name ?? "Unknown";
      continue;
    }

    if (!isCeo(node) && defaultLeadId && defaultLeadId !== node.id) {
      node.managerId = defaultLeadId;
      node.managerLabel = nodeById.get(defaultLeadId)?.name ?? "CEO";
    }
  }

  const childrenById = new Map<string, OrgNode[]>();
  for (const node of nodeById.values()) {
    if (!node.managerId) continue;
    const existing = childrenById.get(node.managerId) ?? [];
    existing.push(node);
    childrenById.set(node.managerId, existing);
  }

  const roots = Array.from(nodeById.values()).filter((node) => !node.managerId || !nodeById.has(node.managerId));
  roots.sort(sortNodes);

  const levels: OrgNode[][] = [];
  const visited = new Set<string>();
  let frontier = roots;

  while (frontier.length > 0) {
    const nextLevel: OrgNode[] = [];
    const uniqueLevel = frontier.filter((node) => {
      if (visited.has(node.id)) return false;
      visited.add(node.id);
      return true;
    });

    if (uniqueLevel.length > 0) {
      uniqueLevel.sort(sortNodes);
      levels.push(uniqueLevel);
      for (const node of uniqueLevel) {
        const children = childrenById.get(node.id) ?? [];
        nextLevel.push(...children);
      }
    }

    frontier = nextLevel;
  }

  for (const node of nodeById.values()) {
    if (visited.has(node.id)) continue;
    levels.push([node]);
  }

  return {
    levels,
    childrenById,
    rootCount: roots.length,
    edgeCount: Array.from(nodeById.values()).filter((node) => Boolean(node.managerId)).length,
    totalAgents: nodeById.size,
  };
}

function sortNodes(a: OrgNode, b: OrgNode) {
  if (isCeo(a) && !isCeo(b)) return -1;
  if (!isCeo(a) && isCeo(b)) return 1;
  return a.name.localeCompare(b.name);
}

function isCeo(node: Pick<OrgNode, "role">) {
  return node.role.toLowerCase().includes("ceo");
}

function indexNodeKeys(agent: OrchestrationAgent, keyToId: Map<string, string>) {
  const keys = [agent.id, agent.name, trimManagerLabel(agent.name), agent.openclawAgentId, agent.paperclipAgentId]
    .filter(Boolean)
    .map((value) => normalizeKey(String(value)));

  for (const key of keys) {
    keyToId.set(key, agent.id);
  }
}

function resolveManagerId(candidate: string | undefined, keyToId: Map<string, string>) {
  if (!candidate) return undefined;
  const direct = keyToId.get(normalizeKey(candidate));
  if (direct) return direct;
  return keyToId.get(normalizeKey(trimManagerLabel(candidate)));
}

function trimManagerLabel(value: string) {
  return value.replace(/\(.*?\)/g, "").replace(/[^\x00-\x7F]/g, "").trim();
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toneForStatus(status: OrchestrationAgent["status"]) {
  const tones: Record<OrchestrationAgent["status"], { color: string; bg: string; label: string }> = {
    working: { color: "#4ade80", bg: "rgba(74,222,128,0.16)", label: "Working" },
    idle: { color: "#d97706", bg: "rgba(217,119,6,0.16)", label: "Idle" },
    paused: { color: "#f59e0b", bg: "rgba(245,158,11,0.16)", label: "Paused" },
    offline: { color: "#94a3b8", bg: "rgba(148,163,184,0.16)", label: "Offline" },
    error: { color: "#f87171", bg: "rgba(248,113,113,0.16)", label: "Error" },
  };

  return tones[status];
}

function Avatar({ node }: { node: OrgNode }) {
  if (node.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={node.avatar}
        alt={`${node.name} avatar`}
        className="h-9 w-9 rounded-full border border-white/20 object-cover"
      />
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/5 text-lg">
      {node.emoji || "🤖"}
    </div>
  );
}

function InfoLabel({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <p className="mt-1 text-xs text-slate-200">{value}</p>
    </div>
  );
}
