"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Clock,
  MoreHorizontal,
  Plus,
  Search,
  Workflow,
} from "lucide-react";

import { CompanyErrorState, CompanyShell } from "@/components/company/company-ui";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { listCompanies, listCompanyAgents, listProjects } from "@/lib/orchestration/client";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
} from "@/lib/orchestration/types";

/* ── placeholder routine type (will be replaced when wired to real API) ── */
interface Routine {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
  enabled: boolean;
  schedule: string;          // cron expression or human-readable
  lastRun: string | null;    // ISO timestamp
  lastRunStatus: "success" | "failed" | "running" | null;
}

/* ── sample data so the page isn't blank ── */
const SAMPLE_ROUTINES: Routine[] = [];

export default function CompanyRoutinesPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const { activeProject, clearActiveProject } = useActiveProjectState();
  const [routines, setRoutines] = useState<Routine[]>(SAMPLE_ROUTINES);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  /* ── form state ── */
  const [formName, setFormName] = useState("");
  const [formProjectId, setFormProjectId] = useState("");
  const [formAgentId, setFormAgentId] = useState("");
  const [formSchedule, setFormSchedule] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows, agentRows] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          listCompanyAgents(slug),
        ]);
        if (cancelled) return;

        setCompany(companyRows.find((r) => r.slug === slug) ?? null);
        setProjects(projectRows);
        setAgents(agentRows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [slug]);

  const activeProjectRecord = useMemo(
    () => resolveActiveProject(projects, activeProject, slug),
    [activeProject, projects, slug]
  );

  const filteredRoutines = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return routines.filter((r) => {
      if (activeProjectRecord && r.projectId !== activeProjectRecord.id) return false;
      if (!needle) return true;
      return `${r.name} ${r.projectName} ${r.agentName}`.toLowerCase().includes(needle);
    });
  }, [routines, query, activeProjectRecord]);

  const handleCreate = () => {
    const trimmed = formName.trim();
    if (!trimmed || !formProjectId || !formAgentId || !formSchedule.trim()) return;

    const project = projects.find((p) => p.id === formProjectId);
    const agent = agents.find((a) => a.id === formAgentId);

    const newRoutine: Routine = {
      id: crypto.randomUUID(),
      name: trimmed,
      projectId: formProjectId,
      projectName: project?.name ?? "Unknown",
      agentId: formAgentId,
      agentName: agent?.name ?? "Unknown",
      enabled: true,
      schedule: formSchedule.trim(),
      lastRun: null,
      lastRunStatus: null,
    };

    setRoutines((prev) => [newRoutine, ...prev]);
    setFormName("");
    setFormProjectId("");
    setFormAgentId("");
    setFormSchedule("");
    setCreating(false);
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <CompanyShell
      eyebrow="Routines"
      title="Routines"
      description="Recurring work definitions that materialize into auditable execution issues."
      accentColor="#f59e0b"
    >
      {activeProjectRecord ? (
        <ActiveProjectBanner companySlug={slug} project={activeProjectRecord} onClear={clearActiveProject} compact />
      ) : null}

      {/* header row with create button */}
      <div className="flex items-center justify-between">
        <div />
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-stone-900/70 px-4 py-2.5 text-sm font-medium text-white transition hover:border-amber-400/40 hover:bg-amber-900/20"
        >
          <Plus size={14} strokeWidth={2.2} />
          Create routine
        </button>
      </div>

      {/* create form */}
      {creating ? (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-900/10 p-5">
          <h3 className="mb-4 text-sm font-semibold text-white">New Routine</h3>
          <div className="grid gap-3 lg:grid-cols-12">
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Routine name"
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60 lg:col-span-4"
            />
            <select
              value={formProjectId}
              onChange={(e) => setFormProjectId(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none lg:col-span-3"
            >
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={formAgentId}
              onChange={(e) => setFormAgentId(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none lg:col-span-3"
            >
              <option value="">Select agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <input
              value={formSchedule}
              onChange={(e) => setFormSchedule(e.target.value)}
              placeholder="Schedule (e.g. every day at 7am)"
              className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60 lg:col-span-8"
            />
            <div className="flex gap-2 lg:col-span-4">
              <button
                type="button"
                onClick={handleCreate}
                className="flex-1 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2.5 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/50 hover:bg-emerald-500/25"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-300 transition hover:bg-slate-800/60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* routines table */}
      <section className="rounded-2xl border border-white/10 bg-slate-950/65 backdrop-blur-xl overflow-hidden">
        {/* search bar */}
        <div className="border-b border-white/8 p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
              placeholder="Search routines"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* column headers */}
        <div
          className="grid items-center border-b border-white/8 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 80px 40px" }}
        >
          <span>Name</span>
          <span>Project</span>
          <span>Agent</span>
          <span>Last run</span>
          <span>Enabled</span>
          <span />
        </div>

        {/* rows */}
        {filteredRoutines.length === 0 ? (
          <div className="p-8 text-center">
            {loading ? (
              <p className="text-sm text-slate-500">Loading...</p>
            ) : routines.length === 0 ? (
              <div className="flex flex-col items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-amber-400/30 bg-amber-900/10">
                  <Workflow size={20} className="text-amber-400/60" />
                </div>
                <p className="text-sm font-medium text-white">No routines yet</p>
                <p className="text-xs text-slate-400">
                  Create your first routine to schedule recurring work for your agents.
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No routines matched this filter.</p>
            )}
          </div>
        ) : (
          filteredRoutines.map((routine) => (
            <div
              key={routine.id}
              className="grid items-center border-b border-white/5 px-5 py-4 transition hover:bg-white/[0.02]"
              style={{ gridTemplateColumns: "2fr 1fr 1fr 1fr 80px 40px" }}
            >
              {/* name */}
              <div>
                <p className="text-sm font-medium text-white">{routine.name}</p>
              </div>

              {/* project */}
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400/60" />
                <span className="text-sm text-slate-300 truncate">{routine.projectName}</span>
              </div>

              {/* agent */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-300 truncate">{routine.agentName}</span>
              </div>

              {/* last run */}
              <div>
                {routine.lastRun ? (
                  <div>
                    <p className="text-sm text-slate-300">
                      {new Date(routine.lastRun).toLocaleString()}
                    </p>
                    <p
                      className="text-xs"
                      style={{
                        color:
                          routine.lastRunStatus === "success"
                            ? "#86efac"
                            : routine.lastRunStatus === "failed"
                            ? "#fca5a5"
                            : "#fbbf24",
                      }}
                    >
                      {routine.lastRunStatus}
                    </p>
                  </div>
                ) : (
                  <span className="text-xs text-slate-600">Never run</span>
                )}
              </div>

              {/* enabled toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setRoutines((prev) =>
                      prev.map((r) =>
                        r.id === routine.id ? { ...r, enabled: !r.enabled } : r
                      )
                    );
                  }}
                  className="relative h-6 w-11 rounded-full transition-colors"
                  style={{
                    backgroundColor: routine.enabled
                      ? "rgba(245,158,11,0.5)"
                      : "rgba(120,113,108,0.3)",
                  }}
                  aria-label={routine.enabled ? "Disable routine" : "Enable routine"}
                >
                  <span
                    className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
                    style={{
                      transform: routine.enabled ? "translateX(22px)" : "translateX(2px)",
                    }}
                  />
                </button>
                <span className="ml-2 text-xs text-slate-400">
                  {routine.enabled ? "On" : "Off"}
                </span>
              </div>

              {/* more menu */}
              <div className="flex justify-end">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 bg-transparent text-slate-400 transition hover:border-white/16 hover:text-white"
                  aria-label="More options"
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </CompanyShell>
  );
}
