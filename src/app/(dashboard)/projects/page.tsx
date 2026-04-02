"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { classifyProjectState } from "@/components/orchestration/ui";
import { listCompanies, listProjects } from "@/lib/orchestration/client";
import type { OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";

type ProjectTab = "active" | "paused" | "archived";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [companies, setCompanies] = useState<OrchestrationCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProjectTab>("active");
  const [query, setQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [projectRows, companyRows] = await Promise.all([listProjects(), listCompanies()]);
        if (cancelled) return;
        setProjects(projectRows);
        setCompanies(companyRows);
      } catch {
        if (!cancelled) setError("Could not load projects right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const companyMap = useMemo(
    () =>
      new Map(
        companies.map((company) => [
          company.id,
          { slug: company.slug, name: company.name, status: company.status },
        ])
      ),
    [companies]
  );

  const visibleProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      const state = classifyProjectState(project.status);
      if (state !== tab) return false;
      if (companyFilter !== "all" && project.companyId !== companyFilter) return false;
      if (!needle) return true;
      const companyName = project.companyId ? companyMap.get(project.companyId)?.name ?? "" : "";
      return `${project.name} ${project.description} ${project.slug} ${project.owner ?? ""} ${companyName}`
        .toLowerCase()
        .includes(needle);
    });
  }, [companyFilter, companyMap, projects, query, tab]);

  const totals = useMemo(
    () =>
      projects.reduce(
        (acc, project) => {
          acc[classifyProjectState(project.status)] += 1;
          acc.tasks += project.taskCount;
          acc.inProgress += project.inProgress;
          acc.review += project.review;
          acc.agents += project.activeAgents ?? 0;
          return acc;
        },
        { active: 0, paused: 0, archived: 0, tasks: 0, inProgress: 0, review: 0, agents: 0 }
      ),
    [projects]
  );

  return (
    <main className="orchestra-screen px-4 pb-12 pt-4 md:px-6">
      <section className="orchestra-glass relative overflow-hidden rounded-3xl p-5 md:p-7">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/70 to-transparent" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-amber-100/75">
              <Sparkles className="h-3.5 w-3.5" />
              Project Hub
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white md:text-3xl">Mission Control Projects</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              Cross-company orchestration view for board flow, ownership, and execution health.
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-white/15 bg-slate-950/70 p-1 backdrop-blur-xl">
            {(["active", "paused", "archived"] as ProjectTab[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium uppercase tracking-[0.12em] transition"
                style={{
                  color: tab === item ? "#fffbeb" : "#94a3b8",
                  background:
                    tab === item
                      ? "linear-gradient(135deg, rgba(217,119,6,0.28), rgba(120,53,15,0.2))"
                      : "transparent",
                  boxShadow: tab === item ? "0 0 0 1px rgba(217,119,6,0.24)" : "none",
                }}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Active Projects" value={totals.active} icon={<BriefcaseBusiness className="h-4 w-4" />} />
          <StatTile label="In Progress" value={totals.inProgress} icon={<Activity className="h-4 w-4" />} />
          <StatTile label="Review Queue" value={totals.review} icon={<CheckCircle2 className="h-4 w-4" />} />
          <StatTile label="Open Tasks" value={totals.tasks} icon={<ArrowRight className="h-4 w-4" />} />
          <StatTile label="Active Agents" value={totals.agents} icon={<Users className="h-4 w-4" />} />
        </div>
      </section>

      <section className="mt-5 rounded-2xl border border-white/10 bg-[linear-gradient(165deg,rgba(15,23,42,0.88),rgba(2,6,23,0.95))] p-4 backdrop-blur-xl md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[230px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by project, owner, slug, or company"
              className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-amber-300/55"
            />
          </label>
          <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
            Company
            <select
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
              className="rounded-md border border-white/10 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-amber-300/55"
            >
              <option value="all">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <section className="mt-5 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</section>
      ) : null}

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        {loading
          ? Array.from({ length: 6 }).map((_, index) => <ProjectSkeleton key={`project-skeleton-${index}`} />)
          : visibleProjects.map((project) => {
              const company = project.companyId ? companyMap.get(project.companyId) : undefined;
              const laneTotal = project.backlog + project.inProgress + project.review + project.completed;
              const completion = laneTotal > 0 ? Math.round((project.completed / laneTotal) * 100) : 0;
              const projectSlug = project.slug || project.id;
              const boardHref = `/projects/${encodeURIComponent(projectSlug)}/board`;
              const companyHref = company ? `/companies/${encodeURIComponent(company.slug)}` : null;
              const teamHref = company ? `/companies/${encodeURIComponent(company.slug)}/team` : boardHref;

              return (
                <article
                  key={project.id}
                  className="group rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_0_0,rgba(217,119,6,0.12),transparent_28%),linear-gradient(168deg,rgba(15,23,42,0.95),rgba(2,6,23,0.96))] p-5 shadow-[0_16px_40px_rgba(2,6,23,0.45)] transition duration-200 hover:-translate-y-0.5 hover:border-amber-300/45"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-amber-100/70">{project.slug}</p>
                      <h2 className="mt-1 text-xl font-semibold text-white">
                        <span className="mr-2">{project.emoji}</span>
                        {project.name}
                      </h2>
                      <p className="mt-2 text-sm text-slate-400">{project.description}</p>
                    </div>
                    <div
                      className="h-10 w-10 shrink-0 rounded-2xl border"
                      style={{
                        borderColor: `${project.color}70`,
                        background: `linear-gradient(160deg, ${project.color}44, rgba(15,23,42,0.88))`,
                      }}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
                    <LaneMetric label="Backlog" value={project.backlog} />
                    <LaneMetric label="In Progress" value={project.inProgress} />
                    <LaneMetric label="Review" value={project.review} />
                    <LaneMetric label="Done" value={project.completed} />
                  </div>

                  <div className="mt-4">
                    <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-slate-400">
                      <span>Completion</span>
                      <span>{completion}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${completion}%`,
                          background: `linear-gradient(90deg, ${project.color}, color-mix(in srgb, ${project.color} 65%, white))`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                    <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1">
                      {company?.name ?? "Unscoped Company"}
                    </span>
                    {project.owner ? (
                      <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1">Owner: {project.owner}</span>
                    ) : null}
                    <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1">
                      {(project.activeAgents ?? 0).toLocaleString()} active agents
                    </span>
                    <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1">
                      {project.taskCount.toLocaleString()} open tasks
                    </span>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <Link href={boardHref} className="orchestra-cta inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-amber-100">
                      Open Board
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    <Link href={teamHref} className="orchestra-ghost-btn inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-slate-200">
                      Team Roster
                    </Link>
                    {companyHref ? (
                      <Link href={companyHref} className="orchestra-ghost-btn inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-slate-200">
                        Company Hub
                      </Link>
                    ) : null}
                  </div>
                </article>
              );
            })}
      </section>

      {!loading && visibleProjects.length === 0 ? (
        <section className="mt-5 rounded-2xl border border-dashed border-white/15 bg-slate-950/65 p-8 text-center">
          <p className="text-sm text-slate-300">No projects matched this filter set.</p>
          <p className="mt-1 text-xs text-slate-500">Try another company scope or clear the search query.</p>
        </section>
      ) : null}
    </main>
  );
}

function StatTile({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <article className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-2 text-slate-300">
        {icon}
        <span className="text-xs uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </article>
  );
}

function LaneMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <p className="truncate text-[11px] uppercase tracking-[0.09em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function ProjectSkeleton() {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <div className="h-4 w-24 animate-pulse rounded bg-slate-700/70" />
      <div className="mt-3 h-7 w-56 animate-pulse rounded bg-slate-700/70" />
      <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-800/80" />
      <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-slate-800/80" />
      <div className="mt-5 grid grid-cols-4 gap-2">
        <div className="h-14 animate-pulse rounded bg-slate-800/80" />
        <div className="h-14 animate-pulse rounded bg-slate-800/80" />
        <div className="h-14 animate-pulse rounded bg-slate-800/80" />
        <div className="h-14 animate-pulse rounded bg-slate-800/80" />
      </div>
    </article>
  );
}
