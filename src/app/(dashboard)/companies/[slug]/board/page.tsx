"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Search } from "lucide-react";
import { CompanyErrorState, StatCard } from "@/components/company/company-ui";
import { getCompanyInbox, listCompanies, listProjects } from "@/lib/orchestration/client";
import { ORCHESTRATION_COLUMNS, type OrchestrationCompany, type OrchestrationCompanyInboxTask, type OrchestrationProject, type TaskStatus } from "@/lib/orchestration/types";

type CompanyTask = OrchestrationCompanyInboxTask;

export default function CompanyBoardPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";
  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [tasks, setTasks] = useState<CompanyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows, inbox] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          getCompanyInbox({ companySlug: slug }),
        ]);
        const current = companyRows.find((row) => row.slug === slug) ?? null;
        if (cancelled) return;
        setCompany(current);

        if (!current) {
          setProjects([]);
          setTasks([]);
          return;
        }

        const companyProjects = current
          ? projectRows.filter((project) => project.companyId === current.id)
          : [];
        setProjects(companyProjects);
        setTasks(inbox?.tasks ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (projectFilter !== "all" && task.projectId !== projectFilter) return false;
      if (!needle) return true;
      return `${task.title} ${task.description ?? ""} ${task.assignee ?? ""} ${task.projectName}`.toLowerCase().includes(needle);
    });
  }, [projectFilter, query, tasks]);

  const totals = useMemo(() => {
    const counts = Object.fromEntries(ORCHESTRATION_COLUMNS.map((column) => [column.id, 0])) as Record<TaskStatus, number>;
    for (const task of tasks) {
      counts[task.status] = (counts[task.status] ?? 0) + 1;
    }
    return counts;
  }, [tasks]);

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {ORCHESTRATION_COLUMNS.map((column) => (
          <StatCard key={column.id} label={column.label} value={totals[column.id] ?? 0} accentColor="#d97706" />
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
              placeholder="Search company board"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 xl:grid-cols-3 2xl:grid-cols-6">
          {ORCHESTRATION_COLUMNS.map((column) => {
            const columnTasks = filteredTasks.filter((task) => task.status === column.id);
            return (
              <div key={column.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">{column.label}</h2>
                  <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-400">{columnTasks.length}</span>
                </div>
                <div className="space-y-3">
                  {columnTasks.map((task) => (
                    <Link
                      key={task.id}
                      href={`/companies/${slug}/projects/${task.projectId}/board?task=${encodeURIComponent(task.id)}`}
                      className="block rounded-xl border border-white/10 bg-slate-950/80 p-3 transition hover:border-amber-300/30 hover:bg-slate-950"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span
                          className="rounded-full px-2 py-1 text-[11px] font-medium"
                          style={{
                            backgroundColor: `${task.projectColor}22`,
                            color: task.projectColor,
                          }}
                        >
                          {task.projectName}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{task.priority}</span>
                      </div>
                      <h3 className="text-sm font-medium text-white">{task.title}</h3>
                      {task.description ? <p className="mt-2 line-clamp-3 text-xs text-slate-400">{task.description}</p> : null}
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>{task.assignee ?? "Unassigned"}</span>
                        <span>{task.type}</span>
                      </div>
                    </Link>
                  ))}
                  {columnTasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
                      No tasks
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
