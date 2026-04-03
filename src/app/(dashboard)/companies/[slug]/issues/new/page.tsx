"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { CompanyErrorState, CompanyShell } from "@/components/company/company-ui";
import { createTask, listCompanies, listCompanyAgents, listProjects } from "@/lib/orchestration/client";
import { ActiveProjectBanner } from "@/components/orchestration/ActiveProjectBanner";
import { useActiveProjectState } from "@/lib/active-project-state";
import { resolveActiveProject } from "@/lib/active-project-utils";
import type {
  OrchestrationAgent,
  OrchestrationCompany,
  OrchestrationProject,
  TaskPriority,
  TaskStatus,
  TaskType,
} from "@/lib/orchestration/types";

const STATUS_OPTIONS: TaskStatus[] = ["backlog", "on-deck", "in-progress"];
const PRIORITY_OPTIONS: TaskPriority[] = ["P0", "P1", "P2", "P3"];
const TYPE_OPTIONS: TaskType[] = ["feature", "bug", "maintenance", "research", "infrastructure", "directive"];

export default function CompanyNewIssuePage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";
  const { activeProject, clearActiveProject } = useActiveProjectState();

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [projects, setProjects] = useState<OrchestrationProject[]>([]);
  const [agents, setAgents] = useState<OrchestrationAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("P2");
  const [type, setType] = useState<TaskType>("feature");
  const [status, setStatus] = useState<TaskStatus>("backlog");
  const [assignee, setAssignee] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [companyRows, projectRows, companyAgents] = await Promise.all([
          listCompanies(),
          listProjects({ company: slug }),
          listCompanyAgents(slug),
        ]);

        if (cancelled) return;

        const current = companyRows.find((row) => row.slug === slug) ?? null;
        setCompany(current);
        setProjects(projectRows);
        setAgents(companyAgents);

        const requestedProjectId = searchParams.get("projectId");
        const requestedProject = requestedProjectId
          ? projectRows.find((project) => project.id === requestedProjectId || project.slug === requestedProjectId)
          : null;
        const activeProjectForCompany = activeProject && activeProject.companySlug === slug
          ? projectRows.find(
              (project) => project.id === activeProject.projectId || project.slug === activeProject.projectSlug
            )
          : null;
        const nextProject = requestedProject ?? activeProjectForCompany ?? projectRows[0] ?? null;

        if (nextProject) {
          setProjectId(nextProject.id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeProject, searchParams, slug]);

  const assigneeOptions = useMemo(
    () => agents.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [agents]
  );

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? resolveActiveProject(projects, activeProject, slug),
    [activeProject, projectId, projects, slug]
  );

  const canSubmit = title.trim().length >= 2 && projectId.trim().length > 0 && !submitting;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);

    const task = await createTask({
      projectId,
      title: title.trim(),
      description: description.trim(),
      priority,
      type,
      status,
      ...(assignee ? { assignee } : {}),
    });

    if (!task) {
      setError("Unable to create task right now. Verify inputs and retry.");
      setSubmitting(false);
      return;
    }

    router.push(`/companies/${slug}/issues?created=${encodeURIComponent(task.id)}`);
    router.refresh();
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved from orchestration data." href="/" />;
  }

  return (
    <CompanyShell
      eyebrow="New Task"
      title={company ? `Create Task • ${company.name}` : "Create Task"}
      description="Company-scoped task intake. This route creates real orchestration tasks with validated fields and immediately routes back to the task registry."
      accentColor="#d97706"
    >
      {selectedProject ? (
        <ActiveProjectBanner
          companySlug={slug}
          project={selectedProject}
          compact
          onClear={
            activeProject && activeProject.companySlug === slug
              ? () => {
                  clearActiveProject();
                  setProjectId(projects[0]?.id ?? "");
                }
              : undefined
          }
        />
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-4 backdrop-blur-xl md:p-6">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-400">Title</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Implement company inbox endpoint"
              className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-400">Description</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={6}
              placeholder="Acceptance criteria, context, and expected outcomes."
              className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SelectField label="Project" value={projectId} onChange={setProjectId}>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </SelectField>

            <SelectField label="Status" value={status} onChange={(value) => setStatus(value as TaskStatus)}>
              {STATUS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>

            <SelectField label="Priority" value={priority} onChange={(value) => setPriority(value as TaskPriority)}>
              {PRIORITY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>

            <SelectField label="Type" value={type} onChange={(value) => setType(value as TaskType)}>
              {TYPE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </SelectField>
          </div>

          <SelectField label="Assignee (optional)" value={assignee} onChange={setAssignee}>
            <option value="">Unassigned</option>
            {assigneeOptions.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </SelectField>

          {error ? (
            <div className="rounded-xl border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-100">{error}</div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-xl border border-amber-300/50 bg-amber-400/15 px-4 py-2 text-sm font-medium text-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Creating..." : "Create Task"}
            </button>
            <Link
              href={`/companies/${slug}/issues`}
              className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-sm text-slate-200"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </CompanyShell>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
      >
        {children}
      </select>
    </label>
  );
}
