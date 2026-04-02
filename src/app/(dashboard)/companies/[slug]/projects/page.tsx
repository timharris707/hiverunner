"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, CheckCircle2, Layers3, PauseCircle, Search } from "lucide-react";
import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { classifyProjectState } from "@/components/orchestration/ui";
import { listCompanies, listProjects } from "@/lib/orchestration/client";
import type { OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";

type ProjectTab = "active" | "paused" | "archived";

export default function CompanyProjectsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ProjectTab>("active");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
        ]);
        if (cancelled) return;
        const current = companyRows.find((row) => row.slug === slug) ?? null;
        setCompany(current);
        setProjects(current ? projectRows : []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (classifyProjectState(project.status) !== tab) return false;
      if (!needle) return true;
      return `${project.name} ${project.description} ${project.owner ?? ""}`.toLowerCase().includes(needle);
    });
  }, [projects, query, tab]);

  const totals = useMemo(
    () =>
      projects.reduce(
        (acc, project) => {
          acc[classifyProjectState(project.status)] += 1;
          acc.tasks += project.taskCount;
          acc.inProgress += project.inProgress;
          acc.review += project.review;
          return acc;
        },
        { active: 0, paused: 0, archived: 0, tasks: 0, inProgress: 0, review: 0 }
      ),
    [projects]
  );

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <CompanyShell
      eyebrow="Company Workspace"
      title={company ? `${company.name} Projects` : "Projects"}
      description="Projects are now explicitly scoped to the active company. Each card links into the existing project shell for that project."
      accentColor="#22c55e"
    >
      <section className="grid gap-3 md:grid-cols-4">
        <StatCard label="Active Projects" value={totals.active} accentColor="#22c55e" />
        <StatCard label="Paused Projects" value={totals.paused} accentColor="#f59e0b" />
        <StatCard label="Open Tasks" value={totals.tasks} accentColor="#d97706" />
        <StatCard label="In Review" value={totals.review} accentColor="#d97706" />
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-white outline-none focus:border-emerald-400/60"
              placeholder="Search company projects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {(["active", "paused", "archived"] as ProjectTab[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className="rounded-xl border px-3 py-2 text-sm capitalize transition-all"
              style={{
                borderColor: tab === item ? "rgba(52,211,153,0.55)" : "rgba(148,163,184,0.2)",
                backgroundColor: tab === item ? "rgba(6,95,70,0.34)" : "rgba(15,23,42,0.5)",
                color: tab === item ? "#ecfdf5" : "#cbd5e1",
              }}
            >
              {item}
              <span className="ml-2 text-xs text-slate-400">{totals[item]}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {filteredProjects.map((project) => (
            <Link
              key={project.id}
              href={`/companies/${encodeURIComponent(slug)}/projects/${encodeURIComponent(project.slug || project.id)}`}
              className="group rounded-2xl border border-white/10 bg-slate-900/70 p-5 text-left transition hover:border-emerald-300/30 hover:bg-slate-900/90"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{project.slug}</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">
                    <span className="mr-2">{project.emoji}</span>
                    {project.name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-400">{project.description}</p>
                </div>
                <div
                  className="h-11 w-11 rounded-2xl border"
                  style={{
                    borderColor: `${project.color}55`,
                    background: `linear-gradient(180deg, ${project.color}28, rgba(15,23,42,0.8))`,
                  }}
                />
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <Metric icon={<Layers3 className="h-4 w-4" />} label="Tasks" value={project.taskCount} />
                <Metric icon={<BriefcaseBusiness className="h-4 w-4" />} label="In Progress" value={project.inProgress} />
                <Metric icon={<CheckCircle2 className="h-4 w-4" />} label="Review" value={project.review} />
              </div>

              <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
                <span className="inline-flex items-center gap-2">
                  {classifyProjectState(project.status) === "paused" ? <PauseCircle className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                  {project.owner ? `Owner: ${project.owner}` : "No owner assigned"}
                </span>
                <span className="text-emerald-200 transition group-hover:translate-x-0.5">Open project</span>
              </div>
            </Link>
          ))}
        </div>

        {!loading && filteredProjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-8 text-center text-sm text-slate-400">
            No company projects matched this filter.
          </div>
        ) : null}
      </section>
    </CompanyShell>
  );
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
