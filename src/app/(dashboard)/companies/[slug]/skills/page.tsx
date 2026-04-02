"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Layers, Search, Sparkles, TriangleAlert, Users } from "lucide-react";

import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { listCompanies, listCompanyAgents } from "@/lib/orchestration/client";
import type { OrchestrationAgent, OrchestrationCompany } from "@/lib/orchestration/types";

type SkillSource = "workspace" | "system";

type RegistrySkill = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  fileCount: number;
};

type CompanySkillRow = {
  id: string;
  name: string;
  description: string;
  source?: SkillSource;
  fileCount?: number;
  owners: string[];
  ownerCount: number;
  linkedToRegistry: boolean;
};

export default function CompanySkillsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [registrySkills, setRegistrySkills] = useState<RegistrySkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SkillSource | "unmapped">("all");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [companyRows, companyAgents, registryResponse] = await Promise.all([
          listCompanies(),
          listCompanyAgents(slug),
          fetch("/api/skills", { cache: "no-store" }).then((res) => (res.ok ? res.json() : null)).catch(() => null),
        ]);

        if (cancelled) return;

        const current = companyRows.find((row) => row.slug === slug) ?? null;
        setCompany(current);
        setAgents(companyAgents);

        const registryRows = Array.isArray((registryResponse as { skills?: unknown[] } | null)?.skills)
          ? ((registryResponse as { skills: unknown[] }).skills as Array<Record<string, unknown>>)
          : [];

        setRegistrySkills(
          registryRows
            .filter((row) => typeof row.id === "string" && row.id.trim().length > 0)
            .map((row) => ({
              id: String(row.id),
              name: String(row.name ?? row.id),
              description: String(row.description ?? "No description provided."),
              source: row.source === "system" ? "system" : "workspace",
              fileCount: Number(row.fileCount ?? 0),
            }))
        );
      } catch {
        if (!cancelled) {
          setError("Unable to load company skills right now.");
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

  const skillRows = useMemo<CompanySkillRow[]>(() => {
    const ownerMap = new Map<string, Set<string>>();

    for (const agent of agents) {
      const ownerName = agent.name?.trim() || "Unknown agent";
      const skillIds = Array.isArray(agent.skills) ? agent.skills : [];
      const deduped = new Set(skillIds.map((skill) => skill.trim()).filter(Boolean));

      for (const skillId of deduped) {
        const owners = ownerMap.get(skillId) ?? new Set<string>();
        owners.add(ownerName);
        ownerMap.set(skillId, owners);
      }
    }

    const registryById = new Map(registrySkills.map((skill) => [skill.id, skill]));

    return Array.from(ownerMap.entries())
      .map(([skillId, ownersSet]) => {
        const meta = registryById.get(skillId);
        const owners = Array.from(ownersSet).sort((a, b) => a.localeCompare(b));

        return {
          id: skillId,
          name: meta?.name ?? skillId,
          description: meta?.description ?? "Assigned to company agents but not found in local skill registry.",
          source: meta?.source,
          fileCount: meta?.fileCount,
          owners,
          ownerCount: owners.length,
          linkedToRegistry: Boolean(meta),
        } satisfies CompanySkillRow;
      })
      .sort((a, b) => {
        if (b.ownerCount !== a.ownerCount) return b.ownerCount - a.ownerCount;
        return a.name.localeCompare(b.name);
      });
  }, [agents, registrySkills]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return skillRows.filter((row) => {
      if (sourceFilter === "workspace" && row.source !== "workspace") return false;
      if (sourceFilter === "system" && row.source !== "system") return false;
      if (sourceFilter === "unmapped" && row.linkedToRegistry) return false;

      if (!needle) return true;
      const ownerText = row.owners.join(" ").toLowerCase();
      return (`${row.name} ${row.id} ${row.description}`.toLowerCase().includes(needle) || ownerText.includes(needle));
    });
  }, [query, skillRows, sourceFilter]);

  const summary = useMemo(() => {
    const workspace = skillRows.filter((row) => row.source === "workspace").length;
    const system = skillRows.filter((row) => row.source === "system").length;
    const unmapped = skillRows.filter((row) => !row.linkedToRegistry).length;
    const skilledAgents = agents.filter((agent) => (agent.skills?.length ?? 0) > 0).length;

    return {
      total: skillRows.length,
      workspace,
      system,
      unmapped,
      skilledAgents,
    };
  }, [agents, skillRows]);

  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="This company could not be resolved from orchestration records."
        href="/companies"
      />
    );
  }

  return (
    <CompanyShell
      eyebrow="Company Skills"
      title={loading ? "Loading skills..." : `${company?.name ?? "Company"} Skills`}
      description="Directory of skills actively assigned to this company team, with registry metadata when available."
      accentColor="#f59e0b"
    >
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Installed" value={summary.total} detail="Unique skills assigned to team" accentColor="#f59e0b" />
        <StatCard label="Skilled Agents" value={summary.skilledAgents} detail="Agents with one or more skills" accentColor="#d97706" />
        <StatCard label="Workspace" value={summary.workspace} detail="Resolved from workspace registry" accentColor="#34d399" />
        <StatCard label="System" value={summary.system} detail="Resolved from system registry" accentColor="#d97706" />
        <StatCard label="Unmapped" value={summary.unmapped} detail="Assigned but missing registry metadata" accentColor="#fb7185" />
      </section>

      {error ? (
        <section className="rounded-2xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 grid gap-3 lg:grid-cols-12">
          <div className="relative lg:col-span-7">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-white outline-none focus:border-stone-400/60"
              placeholder="Search by skill, id, description, or agent"
            />
          </div>

          <select
            className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none lg:col-span-5"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value as "all" | SkillSource | "unmapped")}
          >
            <option value="all">All sources</option>
            <option value="workspace">Workspace only</option>
            <option value="system">System only</option>
            <option value="unmapped">Unmapped only</option>
          </select>
        </div>

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-2xl border border-white/10 bg-slate-900/80" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-slate-900/60 px-4 py-10 text-center text-sm text-slate-300">
            <p className="font-medium text-slate-100">No matching skills found for this company.</p>
            <p className="mt-2 text-slate-400">
              Skill assignments usually come from agent configuration. Confirm with team setup in{" "}
              <Link href={`/companies/${slug}/team`} className="text-stone-200 hover:text-stone-100">
                company team
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredRows.map((row) => {
              const sourceBadge = row.source
                ? row.source === "workspace"
                  ? "Workspace"
                  : "System"
                : "Unmapped";

              const sourceClasses = row.source
                ? row.source === "workspace"
                  ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100"
                  : "border-amber-300/25 bg-amber-400/10 text-amber-100"
                : "border-rose-300/25 bg-rose-400/10 text-rose-100";

              return (
                <article key={row.id} className="rounded-2xl border border-white/10 bg-slate-900/75 p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-white">{row.name}</h2>
                      <p className="mt-1 text-[11px] text-slate-400">{row.id}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${sourceClasses}`}>{sourceBadge}</span>
                  </div>

                  <p className="line-clamp-2 text-sm text-slate-300">{row.description}</p>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2">
                      <p className="text-slate-500">Assigned Agents</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-sm text-slate-100">
                        <Users className="h-3.5 w-3.5" />
                        {row.ownerCount}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2">
                      <p className="text-slate-500">Skill Files</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-sm text-slate-100">
                        <Layers className="h-3.5 w-3.5" />
                        {typeof row.fileCount === "number" ? row.fileCount : "-"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/70 px-2.5 py-2 text-xs">
                    <p className="mb-1 text-slate-500">Owners</p>
                    <p className="line-clamp-2 text-slate-200">{row.owners.join(", ")}</p>
                  </div>

                  {!row.linkedToRegistry ? (
                    <div className="mt-3 inline-flex items-center gap-1 rounded-lg border border-rose-300/25 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      Registry metadata unavailable
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <BookOpen className="h-4 w-4 text-stone-200" />
            What this page shows
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li>Skills are sourced from current company agent assignments.</li>
            <li>Metadata (description/source/file count) is merged from the local skill registry at <code>/api/skills</code>.</li>
            <li>Unmapped skills indicate an agent assignment that does not resolve to a local registry entry.</li>
          </ul>
        </article>

        <article className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-amber-200" />
            Related routes
          </h2>
          <div className="mt-3 grid gap-2 text-sm text-amber-100">
            <Link href={`/companies/${slug}/team`} className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 hover:border-amber-200/40">
              Open company team
            </Link>
            <Link href="/skills" className="rounded-lg border border-amber-300/20 bg-amber-400/10 px-3 py-2 hover:border-amber-200/40">
              Open global skill manager
            </Link>
          </div>
        </article>
      </section>
    </CompanyShell>
  );
}
