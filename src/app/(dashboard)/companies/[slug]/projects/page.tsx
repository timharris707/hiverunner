"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Archive, Eye, EyeOff, Pause, Play, Plus, Search } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { listCompanies, listProjects, updateProjectSettings } from "@/lib/orchestration/client";
import { buildCompanyPath } from "@/lib/orchestration/route-paths";
import { useHiddenProjects } from "@/lib/hidden-project-state";
import type { OrchestrationCompany, OrchestrationProject } from "@/lib/orchestration/types";
type FilterMode = "active" | "paused" | "archived" | "all";

export default function CompanyProjectsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterMode>("active");
  const { hiddenProjects, setHidden } = useHiddenProjects(slug);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, activeRows, archivedRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug, includeArchived: false }),
          listProjects({ company: slug, includeArchived: true }),
        ]);

        if (cancelled) return;
        const current = companyRows.find((row) => row.slug === slug) ?? null;
        setCompany(current);
        if (!current) {
          setProjects([]);
          return;
        }

        const merged = new Map<string, OrchestrationProject>();
        for (const project of archivedRows) merged.set(project.id, project);
        for (const project of activeRows) merged.set(project.id, project);

        setProjects(
          Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
        );
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
      if (filter !== "all" && project.status !== filter) return false;
      if (!needle) return true;
      return `${project.name} ${project.description} ${project.slug}`.toLowerCase().includes(needle);
    });
  }, [filter, projects, query]);

  const counts = useMemo(() => {
    return projects.reduce(
      (acc, project) => {
        acc.all += 1;
        if (project.status === "active") acc.active += 1;
        if (project.status === "paused") acc.paused += 1;
        if (project.status === "archived") acc.archived += 1;
        if (hiddenProjects[project.id]) acc.hidden += 1;
        return acc;
      },
      { all: 0, active: 0, paused: 0, archived: 0, hidden: 0 }
    );
  }, [hiddenProjects, projects]);

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  const updateStatus = async (project: OrchestrationProject, status: "active" | "paused" | "archived") => {
    setBusyProjectId(project.id);
    const updated = await updateProjectSettings({
      projectIdOrSlug: project.id,
      status,
    });
    if (updated) {
      setProjects((previous) => previous.map((candidate) => (candidate.id === project.id ? updated : candidate)));
    }
    setBusyProjectId(null);
  };

  return (
    <div className="flex h-full flex-col" style={{ background: "linear-gradient(180deg, #0c0a09 0%, #1c1917 100%)" }}>
      <div className="border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(12,10,9,0.9)" }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">Company</p>
            <h1 className="mt-1 text-lg font-semibold text-stone-100">{company?.name ?? "Company"} / Projects</h1>
            <p className="mt-1 text-sm text-stone-400">Manage visibility, status, and access to the projects that appear in the dock.</p>
          </div>
          <Link
            href={`/companies/${encodeURIComponent(slug)}?tab=projects&createProject=1`}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-stone-100 transition hover:bg-white/6"
            style={{ borderColor: "rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.04)" }}
          >
            <Plus className="h-4 w-4" /> New project
          </Link>
        </div>
      </div>

      <div className="border-b px-4 py-2" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(28,25,23,0.7)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects"
              className="w-full rounded-lg border bg-stone-950/80 pl-9 pr-3 py-2 text-sm text-stone-200 outline-none placeholder:text-stone-600"
              style={{ borderColor: "rgba(255,255,255,0.12)" }}
            />
          </div>
          {([
            ["active", `${counts.active} active`],
            ["paused", `${counts.paused} paused`],
            ["archived", `${counts.archived} archived`],
            ["all", `${counts.all} total`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className="rounded-lg border px-3 py-2 text-sm transition"
              style={{
                borderColor: filter === value ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)",
                background: filter === value ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                color: filter === value ? "#fafaf9" : "#a8a29e",
              }}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-xs text-stone-500">{counts.hidden} hidden from dock</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(12,10,9,0.5)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "rgba(255,255,255,0.03)" }}>
              <tr className="border-b text-left text-[11px] uppercase tracking-[0.18em] text-stone-500" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Visibility</th>
                <th className="px-3 py-3 font-medium">Tasks</th>
                <th className="px-3 py-3 font-medium">Updated flow</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-stone-500">Loading projects…</td>
                </tr>
              ) : filteredProjects.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-stone-500">No projects match this filter.</td>
                </tr>
              ) : (
                filteredProjects.map((project, index) => {
                  const hidden = Boolean(hiddenProjects[project.id]);
                  const busy = busyProjectId === project.id;
                  return (
                    <tr
                      key={project.id}
                      className="border-b last:border-b-0"
                      style={{
                        borderColor: "rgba(255,255,255,0.06)",
                        background: index % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent",
                      }}
                    >
                      <td className="px-4 py-3 align-top">
                        <div>
                          <div className="font-medium text-stone-100">{project.name}</div>
                          <div className="mt-1 text-xs text-stone-500">{project.slug}</div>
                          {project.description ? <div className="mt-1 text-sm text-stone-400">{project.description}</div> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className="rounded-full border px-2 py-1 text-xs text-stone-200" style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
                          {project.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top text-sm text-stone-300">
                        {hidden ? "Hidden in dock" : "Visible in dock"}
                      </td>
                      <td className="px-3 py-3 align-top text-sm text-stone-300">{project.taskCount}</td>
                      <td className="px-3 py-3 align-top text-sm text-stone-400">
                        Opens into company tasks for this project.
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Link
                            href={buildCompanyPath(slug, `/projects/${encodeURIComponent(project.slug || project.id)}`)}
                            className="rounded-lg border px-3 py-1.5 text-xs text-stone-100 transition hover:bg-white/6"
                            style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setHidden(project.id, !hidden)}
                            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-stone-100 transition hover:bg-white/6 disabled:opacity-50"
                            style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}
                          >
                            {hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            {hidden ? "Show" : "Hide"}
                          </button>
                          {project.status === "archived" ? null : project.status === "paused" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void updateStatus(project, "active")}
                              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-stone-100 transition hover:bg-white/6 disabled:opacity-50"
                              style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}
                            >
                              <Play className="h-3.5 w-3.5" /> Resume
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void updateStatus(project, "paused")}
                              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-stone-100 transition hover:bg-white/6 disabled:opacity-50"
                              style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}
                            >
                              <Pause className="h-3.5 w-3.5" /> Pause
                            </button>
                          )}
                          {project.status === "archived" ? null : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void updateStatus(project, "archived")}
                              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs text-stone-100 transition hover:bg-white/6 disabled:opacity-50"
                              style={{ borderColor: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}
                            >
                              <Archive className="h-3.5 w-3.5" /> Archive
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
