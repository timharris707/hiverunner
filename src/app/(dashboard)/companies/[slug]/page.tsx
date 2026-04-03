"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Home,
  Palette,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wifi,
  WifiOff,
} from "lucide-react";

import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { classifyProjectState, formatAge } from "@/components/orchestration/ui";
import {
  createProject,
  listCompanies,
  listCompanyAgents,
  listProjectSprints,
  listProjects,
} from "@/lib/orchestration/client";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  OrchestrationSprint,
} from "@/lib/orchestration/types";

type CompanyTab = "projects" | "agents" | "settings";
type ProjectStateTab = "active" | "paused" | "archived";

type CompanyRosterAgent = OrchestrationAgent & {
  projectId?: string;
  projectName: string;
  companyName: string;
};

type ProjectSprintSummary = {
  name: string;
  ratioLabel: string;
  percent: number;
};

const shellTabs: Array<{ id: CompanyTab; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "agents", label: "Agents" },
  { id: "settings", label: "Settings" },
];

export default function CompanyDetailPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<CompanyTab>("projects");
  const [projectStateTab, setProjectStateTab] = useState<ProjectStateTab>("active");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const [roster, setRoster] = useState<CompanyRosterAgent[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterStatus, setRosterStatus] = useState<"all" | OrchestrationAgent["status"]>("all");
  const [sprintSummaries, setSprintSummaries] = useState<Record<string, ProjectSprintSummary>>({});

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam === "projects" || tabParam === "agents" || tabParam === "settings") {
      setActiveTab(tabParam);
    }

    if (searchParams.get("createProject") === "1") {
      setActiveTab("projects");
      setCreateOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;

    Promise.all([listCompanies(), listProjects({ company: slug, includeNonProduction: true })])
      .then(([companies, rows]) => {
        if (!mounted) return;
        const current = companies.find((item) => item.slug === slug) ?? null;
        setCompany(current);

        if (!current) {
          setProjects([]);
          return;
        }

        setProjects(rows);
      })
      .catch(() => {
        if (!mounted) return;
        setError("Unable to load this company right now.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [slug]);

  useEffect(() => {
    if (activeTab !== "agents" || !company) return;

    let cancelled = false;
    const loadRoster = async () => {
      setRosterLoading(true);
      setRosterError(null);

      try {
        const companyAgents = await listCompanyAgents(company.slug);

        if (cancelled) return;
        const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
        const rosterRows = companyAgents.map((agent) => ({
          ...agent,
          projectName: agent.projectId
            ? (projectNameById.get(agent.projectId) ?? "Cross-project")
            : "Company-wide",
          companyName: company.name,
        }));
        setRoster(rosterRows.sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        if (!cancelled) {
          setRosterError("Failed to load company agent roster.");
        }
      } finally {
        if (!cancelled) {
          setRosterLoading(false);
        }
      }
    };

    void loadRoster();

    return () => {
      cancelled = true;
    };
  }, [activeTab, company, projects]);

  useEffect(() => {
    if (!company || projects.length === 0) {
      setSprintSummaries({});
      return;
    }

    let cancelled = false;

    const loadSprintSummaries = async () => {
      const entries = await Promise.all(
        projects.map(async (project) => {
          const sprints = await listProjectSprints(project.id);
          return [project.id, buildProjectSprintSummary(project, sprints)] as const;
        })
      );

      if (cancelled) return;
      setSprintSummaries(Object.fromEntries(entries));
    };

    void loadSprintSummaries();

    return () => {
      cancelled = true;
    };
  }, [company, projects]);

  const filteredProjects = useMemo(() => {
    const q = query.toLowerCase();
    return projects.filter((project) => {
      if (classifyProjectState(project.status) !== projectStateTab) return false;
      return `${project.name} ${project.description}`.toLowerCase().includes(q);
    });
  }, [projects, projectStateTab, query]);

  const projectTotals = useMemo(() => {
    return projects.reduce(
      (acc, project) => {
        const lane = classifyProjectState(project.status);
        acc[lane] += 1;
        acc.inProgress += project.inProgress;
        acc.review += project.review;
        return acc;
      },
      { active: 0, paused: 0, archived: 0, inProgress: 0, review: 0 }
    );
  }, [projects]);

  const rosterTotals = useMemo(
    () => ({
      working: roster.filter((agent) => agent.status === "working").length,
      idle: roster.filter((agent) => agent.status === "idle").length,
      paused: roster.filter((agent) => agent.status === "paused").length,
      offline: roster.filter((agent) => agent.status === "offline").length,
    }),
    [roster]
  );

  const filteredRoster = useMemo(() => {
    const lower = rosterQuery.trim().toLowerCase();
    return roster.filter((agent) => {
      if (rosterStatus !== "all" && agent.status !== rosterStatus) return false;
      if (!lower) return true;
      const haystack = `${agent.name} ${agent.role} ${agent.projectName} ${agent.currentTask ?? ""}`.toLowerCase();
      return haystack.includes(lower);
    });
  }, [roster, rosterQuery, rosterStatus]);

  const handleCreateProject = async (payload: {
    name: string;
    description: string;
    emoji: string;
    color: string;
    owner: string;
    status: "active" | "paused" | "archived";
  }): Promise<boolean> => {
    if (!company) return false;
    setError(null);

    const created = await createProject({
      companyId: company.id,
      name: payload.name,
      description: payload.description,
      emoji: payload.emoji,
      color: payload.color,
      owner: payload.owner || undefined,
      status: payload.status,
      avatarThemeName: company.theme.name,
    });

    if (!created) {
      setError("Could not create project. Please verify the details and retry.");
      return false;
    }

    setProjects((prev) => [created, ...prev]);
    setProjectStateTab("active");
    setCreateOpen(false);
    return true;
  };

  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="This company could not be resolved from orchestration data."
        href="/companies"
      />
    );
  }

  return (
    <CompanyShell
      eyebrow="Company Workspace"
      title={loading ? "Loading Company..." : company?.name ?? "Company"}
      description={
        company?.description ||
        "Build projects, route tasks, and keep this team's execution quality consistently high."
      }
      accentColor={company?.theme?.sampleUrl ? "#d97706" : "#14b8a6"}
    >
      <section className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_10%_5%,rgba(45,212,191,0.2),transparent_38%),radial-gradient(circle_at_90%_0%,rgba(180,83,9,0.22),transparent_35%),linear-gradient(150deg,rgba(2,6,23,0.95),rgba(15,23,42,0.9))] p-5 shadow-[0_16px_46px_rgba(2,6,23,0.5)] backdrop-blur-2xl md:p-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Link href="/companies" className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 hover:bg-white/10">
              <Home className="h-3.5 w-3.5" />
              Companies
            </Link>
            <span className="text-slate-500">/</span>
            <span className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-amber-100">{slug}</span>
            {company ? (
              <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-300">
                Theme: {company.theme.name}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href={`/companies/${encodeURIComponent(slug)}/dashboard`} className="orchestra-ghost-btn rounded-lg px-2.5 py-1.5 text-slate-200">
              Live Dashboard
            </Link>
            <Link href={`/companies/${encodeURIComponent(slug)}/costs`} className="orchestra-ghost-btn rounded-lg px-2.5 py-1.5 text-slate-200">
              Costs
            </Link>
            <Link href={`/companies/${encodeURIComponent(slug)}/org`} className="orchestra-ghost-btn rounded-lg px-2.5 py-1.5 text-slate-200">
              Org Chart
            </Link>
            <Link href={`/companies/${encodeURIComponent(slug)}/inbox`} className="orchestra-ghost-btn rounded-lg px-2.5 py-1.5 text-slate-200">
              Company Inbox
            </Link>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-amber-100/70">Company Detail</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">
              {loading ? "Loading Company..." : company?.name ?? "Company Not Found"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-300">
              {company?.description || "Build projects, route tasks, and keep this team's execution quality consistently high."}
            </p>
          </div>
          {activeTab === "projects" && company ? (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300/45 bg-amber-400/15 px-3 py-2 text-sm font-medium text-amber-100 shadow-[0_10px_25px_rgba(180,83,9,0.24)]"
            >
              <Plus className="h-4 w-4" />
              New Project
            </button>
          ) : null}
        </div>

        {company ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Projects" value={projects.length} detail="Company-scoped initiatives" accentColor="#d97706" />
            <StatCard label="In Progress" value={projectTotals.inProgress} detail="Tasks actively moving" accentColor="#14b8a6" />
            <StatCard label="In Review" value={projectTotals.review} detail="Awaiting signoff" accentColor="#d97706" />
            <StatCard label="Agents" value={company.stats.agents} detail="Rostered under company" accentColor="#f59e0b" />
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 backdrop-blur-xl">
        <div className="flex flex-wrap gap-2">
          {shellTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="rounded-xl border px-3 py-2 text-sm transition-all"
                style={{
                  borderColor: active ? "rgba(217,119,6,0.55)" : "rgba(148,163,184,0.2)",
                  background: active ? "linear-gradient(135deg, rgba(180,83,9,0.35), rgba(30,41,59,0.75))" : "rgba(15,23,42,0.46)",
                  color: active ? "#fef3c7" : "#cbd5e1",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      {error ? (
        <section className="rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</section>
      ) : null}

      {activeTab === "projects" ? (
        <section className="orchestra-panel rounded-2xl p-4 md:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
                placeholder="Search projects in this company"
              />
            </div>
            {(["active", "paused", "archived"] as ProjectStateTab[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setProjectStateTab(item)}
                className="rounded-xl border px-3 py-2 text-sm capitalize"
                style={{
                  borderColor: projectStateTab === item ? "rgba(217,119,6,0.55)" : "rgba(148,163,184,0.2)",
                  backgroundColor: projectStateTab === item ? "rgba(14,116,144,0.24)" : "rgba(15,23,42,0.5)",
                  color: projectStateTab === item ? "#fef3c7" : "#cbd5e1",
                }}
              >
                {item}
                <span className="ml-2 text-xs text-slate-400">{projectTotals[item]}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-slate-900/65" />
              ))}
            </div>
          ) : !company ? (
            <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/55 p-10 text-center">
              <p className="text-sm text-slate-300">This company could not be found.</p>
              <Link href="/companies" className="mt-3 inline-flex text-sm text-amber-200 underline-offset-4 hover:underline">
                Return to Companies
              </Link>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-amber-300/15 bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.08),transparent_45%),rgba(2,6,23,0.7)] p-12 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-400/10 text-amber-100">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-slate-200">No projects match this view yet.</p>
              <p className="mt-2 text-sm text-slate-400">Switch tabs, clear the search, or start a fresh project shell for this company.</p>
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="orchestra-cta mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-amber-100"
              >
                <Plus className="h-4 w-4" />
                New Project
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredProjects.map((project) => {
                const sprint = sprintSummaries[project.id] ?? buildProjectSprintSummary(project, []);
                const projectState = classifyProjectState(project.status);
                return (
                  <Link
                    key={project.id}
                    href={`/companies/${encodeURIComponent(slug)}/projects/${encodeURIComponent(project.slug)}`}
                    className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.12),transparent_28%),linear-gradient(165deg,rgba(30,41,59,0.95),rgba(2,6,23,0.92))] p-4 shadow-[0_16px_35px_rgba(2,6,23,0.45)] transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300/50"
                  >
                    <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent opacity-0 transition group-hover:opacity-100" />
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-lg" style={{ backgroundColor: `${project.color}20` }}>
                          {project.emoji}
                        </span>
                        <div>
                          <h2 className="text-sm font-semibold text-white">{project.name}</h2>
                          <p className="line-clamp-1 text-xs text-slate-400">{project.description || "No description yet."}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 text-slate-500 transition group-hover:text-amber-300" />
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-300">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{project.slug}</span>
                      <span
                        className="rounded-full border px-2.5 py-1"
                        style={{
                          borderColor:
                            projectState === "paused"
                              ? "rgba(245,158,11,0.35)"
                              : projectState === "archived"
                              ? "rgba(148,163,184,0.3)"
                              : "rgba(217,119,6,0.35)",
                          background:
                            projectState === "paused"
                              ? "rgba(245,158,11,0.12)"
                              : projectState === "archived"
                              ? "rgba(148,163,184,0.12)"
                              : "rgba(217,119,6,0.12)",
                        }}
                      >
                        {projectState}
                      </span>
                    </div>

                    <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                      <MiniMetric label="Tasks" value={project.taskCount} />
                      <MiniMetric label="Active" value={project.inProgress} accent="#d97706" />
                      <MiniMetric label="Review" value={project.review} accent="#d97706" />
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span className="max-w-[72%] truncate">{sprint.name}</span>
                        <span>{sprint.ratioLabel}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full border border-white/10 bg-slate-900/80">
                        <div
                          className="h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                          style={{
                            width: `${sprint.percent}%`,
                            background: `linear-gradient(90deg, ${project.color}, color-mix(in srgb, ${project.color} 56%, white))`,
                          }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-slate-500">
                        <span>Current Sprint</span>
                        <span>{sprint.percent}% complete</span>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                      <span>{project.owner ? `Owner: ${project.owner}` : "No owner assigned"}</span>
                      <span className="text-amber-200 transition group-hover:translate-x-0.5">Open workspace</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "agents" ? (
        <section className="orchestra-panel rounded-2xl p-4 md:p-5">
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <MiniMetric label="Total" value={roster.length} accent="#e2e8f0" />
            <MiniMetric label="Working" value={rosterTotals.working} accent="#6ee7b7" />
            <MiniMetric label="Idle" value={rosterTotals.idle} accent="#fbbf24" />
            <MiniMetric label="Paused/Offline" value={rosterTotals.paused + rosterTotals.offline} accent="#fbbf24" />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={rosterQuery}
                onChange={(event) => setRosterQuery(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-10 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
                placeholder="Search by name, role, task, or project"
              />
            </div>
            <select
              value={rosterStatus}
              onChange={(event) => setRosterStatus(event.target.value as typeof rosterStatus)}
              className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="all">All statuses</option>
              <option value="working">Working</option>
              <option value="idle">Idle</option>
              <option value="paused">Paused</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          {rosterError ? (
            <div className="mb-4 rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">{rosterError}</div>
          ) : null}

          {rosterLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-slate-900/65" />
              ))}
            </div>
          ) : filteredRoster.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-amber-300/15 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.08),transparent_40%),rgba(2,6,23,0.72)] p-10 text-center text-sm text-slate-400">
              {roster.length === 0
                ? "No agents have been created for this company yet."
                : "No agents match the current roster filter."}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredRoster.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agent.id)}`}
                  className="group rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_30%),linear-gradient(160deg,rgba(30,41,59,0.85),rgba(2,6,23,0.9))] p-4 transition hover:border-amber-300/35"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-slate-800 text-lg">
                      {agent.emoji}
                      {(agent.status === "working" || agent.status === "idle") && <span className="orchestra-live-dot" />}
                    </div>
                    <AgentStatusBadge status={agent.status} />
                  </div>

                  <h3 className="text-sm font-semibold text-white">{agent.name}</h3>
                  <p className="mt-1 text-xs text-slate-400">{agent.role}</p>

                  <div className="mt-3 space-y-2 text-xs">
                    <InfoRow icon={<Activity className="h-3.5 w-3.5" />} label="Current Task" value={agent.currentTask || "Idle — ready for assignment"} />
                    <InfoRow icon={<BriefcaseBusiness className="h-3.5 w-3.5" />} label="Project" value={agent.projectName} />
                    <InfoRow icon={<Bot className="h-3.5 w-3.5" />} label="Model" value={agent.model || "Pending Forge contract"} />
                    <InfoRow
                      icon={agent.lastHeartbeat ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                      label="Heartbeat"
                      value={agent.lastHeartbeat ? `${formatAge(agent.lastHeartbeat)} ago` : "No heartbeat yet"}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span>{agent.companyName}</span>
                    <span className="text-amber-200 transition group-hover:translate-x-0.5">Open profile</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <section className="orchestra-panel rounded-2xl p-4">
            <div className="mb-3 inline-flex items-center gap-2 text-amber-200">
              <Palette className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-white">Avatar Theme</h2>
            </div>
            {company ? (
              <div className="space-y-2">
                <Setting label="Theme" value={company.theme.name} helper="Applied to all agents across projects in this company." />
                <Setting
                  label="Keywords"
                  value={company.theme.keywords.length > 0 ? company.theme.keywords.join(", ") : "No keywords configured"}
                  helper="Used by avatar generation and visual identity prompts."
                />
                <Setting
                  label="Prompt Template"
                  value={company.theme.promptTemplate || "No prompt template set"}
                  helper="Forge image endpoint will consume this prompt during generation."
                />
              </div>
            ) : (
              <p className="text-sm text-slate-400">No company theme settings found.</p>
            )}
          </section>

          <section className="orchestra-panel rounded-2xl p-4">
            <div className="mb-3 inline-flex items-center gap-2 text-amber-200">
              <Settings2 className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-white">Execution Defaults</h2>
            </div>
            <div className="space-y-2">
              <Setting label="Review Required" value="Enabled" helper="Tasks should pass through Review before Done." />
              <Setting label="Stale Escalation" value="In Progress > 4h" helper="Shown in dashboard alerts and board stale indicators." />
              <Setting label="Review Timeout" value="> 1h" helper="Escalate unresolved review cards to operator." />
              <Setting label="Heartbeat Interval" value="60 minutes" helper="Agent liveness checks for roster monitoring." />
            </div>
          </section>

          <section className="orchestra-panel rounded-2xl p-4">
            <div className="mb-3 inline-flex items-center gap-2 text-amber-200">
              <ShieldCheck className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-white">Access & Governance</h2>
            </div>
            <div className="space-y-2">
              <Setting label="Status" value={company?.status ?? "unknown"} helper="Use status to pause or archive orchestration activity." />
              <Setting label="Company Slug" value={company?.slug ?? "n/a"} helper="Stable URL identity for project and roster routes." />
              <Setting label="Total Projects" value={String(projects.length)} helper="Scoped projects currently associated with this company." />
              <Setting label="Total Agents" value={String(company?.stats.agents ?? 0)} helper="Aggregated roster count from orchestration data layer." />
            </div>
          </section>

          <section className="rounded-2xl border border-rose-300/30 bg-rose-500/10 p-4 backdrop-blur-xl">
            <div className="mb-3 inline-flex items-center gap-2 text-rose-200">
              <AlertTriangle className="h-4 w-4" />
              <h2 className="text-sm font-semibold text-rose-100">Danger Zone</h2>
            </div>
            <p className="text-sm text-rose-100/90">Archive and delete actions remain disabled in scaffolding mode to prevent accidental company loss.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200">
                Archive Company (Disabled)
              </button>
              <button type="button" className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200">
                Delete Company (Disabled)
              </button>
            </div>
          </section>
        </section>
      ) : null}

      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateProject}
      />
    </CompanyShell>
  );
}

function buildProjectSprintSummary(project: OrchestrationProject, sprints: OrchestrationSprint[]): ProjectSprintSummary {
  const ordered = [...sprints].sort(
    (a, b) => new Date(b.updated || b.startDate).getTime() - new Date(a.updated || a.startDate).getTime()
  );
  const active = ordered.find((sprint) => sprint.status === "active");
  const planned = ordered.find((sprint) => sprint.status === "planned");
  const done = ordered.find((sprint) => sprint.status === "done");
  const current = active ?? planned ?? done ?? null;

  if (!current) {
    const total = project.taskCount;
    const doneCount = project.completed;
    const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    return {
      name: "No active sprint",
      ratioLabel: `${doneCount}/${total}`,
      percent: Math.max(0, Math.min(100, percent)),
    };
  }

  const total = current.taskCount > 0 ? current.taskCount : project.taskCount;
  const doneCount = current.taskCount > 0 ? current.doneCount : project.completed;
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return {
    name: current.name,
    ratioLabel: `${doneCount}/${total}`,
    percent: Math.max(0, Math.min(100, percent)),
  };
}

function MiniMetric({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/55 p-2">
      <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold" style={{ color: accent ?? "#e2e8f0" }}>{value}</p>
    </div>
  );
}

function AgentStatusBadge({ status }: { status: OrchestrationAgent["status"] }) {
  const palette: Record<OrchestrationAgent["status"], { text: string; bg: string; border: string }> = {
    working: { text: "#6ee7b7", bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.45)" },
    idle: { text: "#fbbf24", bg: "rgba(217,119,6,0.16)", border: "rgba(217,119,6,0.4)" },
    paused: { text: "#fcd34d", bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.4)" },
    offline: { text: "#fda4af", bg: "rgba(244,63,94,0.16)", border: "rgba(244,63,94,0.4)" },
    error: { text: "#f87171", bg: "rgba(239,68,68,0.18)", border: "rgba(239,68,68,0.5)" },
  };

  return (
    <span
      className="rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.12em]"
      style={{
        color: palette[status].text,
        borderColor: palette[status].border,
        backgroundColor: palette[status].bg,
      }}
    >
      {status}
    </span>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
      <p className="inline-flex items-center gap-1 text-slate-500">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-slate-200">{value}</p>
    </div>
  );
}

function Setting({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/70 p-2">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-200">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function CreateProjectModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    description: string;
    emoji: string;
    color: string;
    owner: string;
    status: "active" | "paused" | "archived";
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [emoji, setEmoji] = useState("🛰️");
  const [color, setColor] = useState("#b45309");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<"active" | "paused" | "archived">("active");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, busy]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-md md:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
        className="w-full max-w-xl rounded-3xl border border-white/15 bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.12),transparent_38%),linear-gradient(165deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-5 shadow-[0_24px_60px_rgba(2,6,23,0.65)] md:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/70">Create Project</p>
            <h2 className="mt-1 text-xl font-semibold text-white">New Project</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <form
          className="space-y-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim() || busy) return;
            setBusy(true);
            const created = await onSubmit({
              name: name.trim(),
              description: description.trim(),
              emoji: emoji.trim() || "🛰️",
              color,
              owner: owner.trim(),
              status,
            });
            setBusy(false);
            if (created) {
              setName("");
              setDescription("");
              setEmoji("🛰️");
              setColor("#b45309");
              setOwner("");
              setStatus("active");
            }
          }}
        >
          <div className="grid gap-3 md:grid-cols-[1fr,104px,124px]">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Name</span>
              <input
                required
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Orchestration Dashboard"
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/60"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Emoji</span>
              <input
                value={emoji}
                onChange={(event) => setEmoji(event.target.value)}
                maxLength={4}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/60"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Accent</span>
              <input
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/80 p-1"
              />
            </label>
          </div>

          <label className="space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="Describe what this project is shipping."
              className="w-full resize-none rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/60"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Owner</span>
              <input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="tim"
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/60"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-[0.12em] text-slate-400">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as "active" | "paused" | "archived")}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none focus:border-amber-400/60"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="rounded-xl border border-amber-300/40 bg-amber-400/15 px-3 py-2 text-sm font-medium text-amber-100 shadow-[0_12px_26px_rgba(180,83,9,0.25)] disabled:opacity-50"
            >
              {busy ? "Creating..." : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
