"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Search } from "lucide-react";

import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { createCompanyGoal, listCompanies, listCompanyGoals, listProjects } from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type {
  OrchestrationCompany,
  OrchestrationCompanyGoal,
  OrchestrationProject,
  OrchestrationSprint,
} from "@/lib/orchestration/types";

export default function CompanyGoalsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const { activeProject, clearActiveProject } = useActiveProjectState();
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [goals, setGoals] = useState<OrchestrationCompanyGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | OrchestrationSprint["status"]>("all");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalStatement, setGoalStatement] = useState("");
  const [goalProjectId, setGoalProjectId] = useState("");
  const [goalStatus, setGoalStatus] = useState<OrchestrationSprint["status"]>("planned");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows, goalPayload] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          listCompanyGoals({ companySlug: slug }),
        ]);

        const current = companyRows.find((row) => row.slug === slug) ?? null;
        if (cancelled) return;

        setCompany(current);
        setProjects(projectRows);
        setGoals(goalPayload?.goals ?? []);
        setGoalProjectId((currentProjectId) => currentProjectId || projectRows[0]?.id || "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const activeProjectRecord = useMemo(
    () => resolveActiveProject(projects, activeProject, slug),
    [activeProject, projects, slug]
  );

  const filteredGoals = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return goals.filter((goal) => {
      const effectiveProjectFilter = activeProjectRecord?.id ?? projectFilter;
      if (effectiveProjectFilter !== "all" && goal.projectId !== effectiveProjectFilter) return false;
      if (statusFilter !== "all" && goal.sprint.status !== statusFilter) return false;
      if (!needle) return true;

      return `${goal.projectName} ${goal.sprint.name} ${goal.sprint.goal}`.toLowerCase().includes(needle);
    });
  }, [goals, projectFilter, query, statusFilter]);

  const summary = useMemo(() => {
    const totalTasks = filteredGoals.reduce((sum, goal) => sum + goal.sprint.taskCount, 0);
    const doneTasks = filteredGoals.reduce((sum, goal) => sum + goal.sprint.doneCount, 0);
    const active = filteredGoals.filter((goal) => goal.sprint.status === "active").length;
    const planned = filteredGoals.filter((goal) => goal.sprint.status === "planned").length;
    const done = filteredGoals.filter((goal) => goal.sprint.status === "done").length;

    return {
      total: filteredGoals.length,
      active,
      planned,
      done,
      completionPercent: totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0,
    };
  }, [filteredGoals]);

  const hasGoals = goals.length > 0;
  const canCreateGoal = projects.length > 0;

  const handleCreateGoal = async () => {
    const trimmedName = goalName.trim();
    if (trimmedName.length < 2) {
      setCreateError("Goal name must be at least 2 characters.");
      return;
    }
    if (!goalProjectId) {
      setCreateError("Select a project before creating a goal.");
      return;
    }

    setSubmitting(true);
    setCreateError(null);

    const created = await createCompanyGoal({
      companySlug: slug,
      projectId: goalProjectId,
      name: trimmedName,
      goal: goalStatement.trim(),
      status: goalStatus,
    });

    if (!created) {
      setCreateError("Unable to create goal right now. Please retry.");
      setSubmitting(false);
      return;
    }

    setGoals((current) => [created, ...current]);
    setGoalName("");
    setGoalStatement("");
    setGoalStatus("planned");
    setCreating(false);
    setSubmitting(false);
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <CompanyShell
      eyebrow="Goals"
      title={company ? `${company.name} Goals` : "Goals"}
      description="Company-scoped sprint and goal tracker. Use this lane to review active objectives and completion health before routing execution work."
      accentColor="#f59e0b"
    >
      {activeProjectRecord ? (
        <ActiveProjectBanner companySlug={slug} project={activeProjectRecord} onClear={clearActiveProject} compact />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Goals" value={summary.total} accentColor="#f59e0b" />
        <StatCard label="Active" value={summary.active} accentColor="#d97706" />
        <StatCard label="Planned" value={summary.planned} accentColor="#d97706" />
        <StatCard label="Done" value={summary.done} accentColor="#34d399" />
        <StatCard label="Completion" value={`${summary.completionPercent}%`} accentColor="#d97706" />
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-4 backdrop-blur-xl md:p-5">
        <div className="mb-4 grid gap-3 lg:grid-cols-12">
          <div className="relative lg:col-span-5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
              placeholder="Search goals"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <select
            className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none lg:col-span-4"
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

          <select
            className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none lg:col-span-3"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | OrchestrationSprint["status"])}
          >
            <option value="all">All statuses</option>
            <option value="planned">Planned</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
        </div>

        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-100 transition hover:border-amber-300/60 hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              setCreating((current) => !current);
              setCreateError(null);
            }}
            disabled={!canCreateGoal || submitting}
          >
            {creating ? "Close create form" : "Create goal"}
          </button>
        </div>

        {creating ? (
          <div className="mb-4 grid gap-3 rounded-2xl border border-amber-400/25 bg-amber-900/10 p-4 lg:grid-cols-6">
            <input
              value={goalName}
              onChange={(event) => setGoalName(event.target.value)}
              placeholder="Goal name"
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60 lg:col-span-2"
            />
            <select
              value={goalProjectId}
              onChange={(event) => setGoalProjectId(event.target.value)}
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none lg:col-span-2"
            >
              <option value="" disabled>
                Select project
              </option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              value={goalStatus}
              onChange={(event) => setGoalStatus(event.target.value as OrchestrationSprint["status"])}
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none lg:col-span-1"
            >
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="done">Done</option>
            </select>
            <button
              type="button"
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2.5 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/50 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60 lg:col-span-1"
              onClick={() => {
                void handleCreateGoal();
              }}
              disabled={submitting || !canCreateGoal}
            >
              {submitting ? "Creating..." : "Save goal"}
            </button>
            <textarea
              value={goalStatement}
              onChange={(event) => setGoalStatement(event.target.value)}
              placeholder="Goal statement (optional)"
              rows={2}
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60 lg:col-span-6"
            />
            {createError ? <p className="text-sm text-rose-300 lg:col-span-6">{createError}</p> : null}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          {filteredGoals.map((goal) => (
            <article key={goal.sprint.id} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{goal.projectName}</p>
                  <h2 className="mt-1 text-lg font-semibold text-white">{goal.sprint.name}</h2>
                </div>
                <span
                  className="rounded-full px-2 py-1 text-[11px] font-medium"
                  style={{
                    backgroundColor:
                      goal.sprint.status === "active"
                        ? "rgba(217,119,6,0.2)"
                        : goal.sprint.status === "done"
                        ? "rgba(52,211,153,0.2)"
                        : "rgba(148,163,184,0.2)",
                    color:
                      goal.sprint.status === "active"
                        ? "#fbbf24"
                        : goal.sprint.status === "done"
                        ? "#86efac"
                        : "#cbd5e1",
                  }}
                >
                  {goal.sprint.status}
                </span>
              </div>

              <p className="text-sm text-slate-300">{goal.sprint.goal || "No goal statement yet."}</p>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                  <span>{goal.sprint.doneCount}/{goal.sprint.taskCount} tasks complete</span>
                  <span>{goal.completionPercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, goal.completionPercent))}%`,
                      background: "linear-gradient(90deg, #d97706, #d97706)",
                    }}
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>Remaining: {goal.remainingTasks}</span>
                <Link
                  href={`/companies/${slug}/projects/${goal.projectSlug || goal.projectId}/sprints`}
                  className="text-amber-200 hover:text-amber-100"
                >
                  Open project sprints
                </Link>
              </div>
            </article>
          ))}
        </div>

        {!loading && !hasGoals ? (
          <div className="rounded-2xl border border-dashed border-amber-400/30 bg-amber-900/10 p-8 text-center">
            <p className="text-sm font-medium text-amber-100">No goals yet for this company.</p>
            <p className="mt-2 text-sm text-amber-100/75">
              Create the first milestone here and route sprint execution from this page.
            </p>
            {!creating ? (
              <button
                type="button"
                className="mt-4 rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-100 transition hover:bg-amber-500/25"
                onClick={() => {
                  setCreating(true);
                  setCreateError(null);
                }}
                disabled={!canCreateGoal}
              >
                Create first goal
              </button>
            ) : null}
            {!canCreateGoal ? (
              <p className="mt-3 text-xs text-amber-100/70">Create a project first, then add a goal.</p>
            ) : null}
          </div>
        ) : null}

        {!loading && hasGoals && filteredGoals.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-slate-950/60 p-8 text-center text-sm text-slate-400">
            No goals matched this filter.
          </div>
        ) : null}
      </section>
    </CompanyShell>
  );
}
