"use client";

import { use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarClock, CheckCircle2, Clock3, Flag, Sparkles, Target, Timer } from "lucide-react";
import { ProjectShellNav } from "@/components/orchestration/ProjectShellNav";
import { createProjectSprint, listProjectSprints, getProjectBoard } from "@/lib/orchestration/client";
import type { OrchestrationSprint } from "@/lib/orchestration/types";

export default function ProjectSprintsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [projectName, setProjectName] = useState("Project");
  const [sprints, setSprints] = useState<OrchestrationSprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newSprintName, setNewSprintName] = useState("");
  const [newSprintGoal, setNewSprintGoal] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creatingSprint, setCreatingSprint] = useState(false);
  const sprintNameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;

    Promise.all([getProjectBoard(id), listProjectSprints(id)])
      .then(([board, sprintData]) => {
        if (!mounted) return;
        if (board) {
          setProjectName(board.project.name);
        }
        setSprints(sprintData);
        setError(null);
      })
      .catch(() => {
        if (mounted) setError("Failed to load sprint data.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const totals = useMemo(
    () => ({
      active: sprints.filter((sprint) => sprint.status === "active").length,
      planned: sprints.filter((sprint) => sprint.status === "planned").length,
      done: sprints.filter((sprint) => sprint.status === "done").length,
      tasks: sprints.reduce((sum, sprint) => sum + sprint.taskCount, 0),
      review: sprints.reduce((sum, sprint) => sum + sprint.reviewCount, 0),
      inProgress: sprints.reduce((sum, sprint) => sum + sprint.inProgressCount, 0),
    }),
    [sprints]
  );

  const sprintGroups = useMemo(
    () => ({
      active: sprints.filter((sprint) => sprint.status === "active"),
      planned: sprints.filter((sprint) => sprint.status === "planned"),
      done: sprints.filter((sprint) => sprint.status === "done"),
    }),
    [sprints]
  );

  const leadSprint = useMemo(
    () => sprintGroups.active[0] ?? sprintGroups.planned[0] ?? sprintGroups.done[0] ?? null,
    [sprintGroups]
  );

  const laneSprints = useMemo(
    () => ({
      active: sprintGroups.active.filter((sprint) => sprint.id !== leadSprint?.id),
      planned: sprintGroups.planned.filter((sprint) => sprint.id !== leadSprint?.id),
      done: sprintGroups.done.filter((sprint) => sprint.id !== leadSprint?.id),
    }),
    [leadSprint?.id, sprintGroups.active, sprintGroups.done, sprintGroups.planned]
  );

  const handleCreateSprint = async () => {
    const name = newSprintName.trim();
    if (!name) {
      setCreateError("Sprint name is required.");
      return;
    }

    setCreateError(null);
    setCreatingSprint(true);
    const created = await createProjectSprint({
      projectId: id,
      name,
      goal: newSprintGoal.trim(),
      status: "planned",
    });
    setCreatingSprint(false);

    if (!created) {
      setCreateError("Failed to create sprint.");
      return;
    }

    const nextSprints = await listProjectSprints(id);
    setSprints(nextSprints);
    setCreateOpen(false);
    setNewSprintName("");
    setNewSprintGoal("");
  };

  useEffect(() => {
    if (!createOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sprintNameInputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!creatingSprint) setCreateOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [createOpen, creatingSprint]);

  return (
    <div className="orchestra-shell p-4 md:p-8">
      <ProjectShellNav projectId={id} projectName={projectName} />

      <section className="orchestra-glass relative overflow-hidden rounded-3xl p-5 md:p-6">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/55 to-transparent" />
        <div className="pointer-events-none absolute -left-16 top-10 h-40 w-40 rounded-full bg-amber-300/10 blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-emerald-300/10 blur-3xl" />

        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-amber-100/80">
              <Flag className="h-4 w-4" />
              <p className="text-[11px] uppercase tracking-[0.18em]">Sprint Control</p>
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Sprints</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Plan release windows, watch execution pressure, and keep review flow visible before the board jams.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
              <Sparkles className="h-3.5 w-3.5 text-amber-200" />
              Premium planning lane
            </div>
            <button
              className="inline-flex items-center gap-2 rounded-xl border border-amber-300/45 bg-amber-400/15 px-3 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-400/22"
              type="button"
              onClick={() => {
                setCreateError(null);
                setCreateOpen(true);
              }}
            >
              <Timer className="h-3.5 w-3.5" />
              New Sprint
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Stat label="Active" value={totals.active} icon={<Target className="h-4 w-4 text-amber-200" />} />
          <Stat label="Planned" value={totals.planned} icon={<Clock3 className="h-4 w-4 text-amber-200" />} />
          <Stat label="Completed" value={totals.done} icon={<CheckCircle2 className="h-4 w-4 text-emerald-200" />} />
          <Stat label="Tasks in Sprints" value={totals.tasks} icon={<CalendarClock className="h-4 w-4 text-slate-200" />} />
          <Stat label="Review Pressure" value={totals.review + totals.inProgress} icon={<Sparkles className="h-4 w-4 text-fuchsia-200" />} />
        </div>

        {error ? <div className="mt-4 rounded-xl border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}

        {loading ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr,1fr]">
            <div className="h-72 animate-pulse rounded-3xl border border-white/10 bg-slate-900/60" />
            <div className="grid gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-2xl border border-white/10 bg-slate-900/65" />
              ))}
            </div>
          </div>
        ) : sprints.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-700/80 bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.09),transparent_35%),rgba(15,23,42,0.72)] p-10 text-center">
            <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/70 text-amber-200">
              <Flag className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-white">No sprint data yet</h3>
            <p className="mx-auto mt-2 max-w-lg text-sm text-slate-400">
              Create the first execution window to give this project a release rhythm. The contract stays on
              <code className="ml-1 rounded bg-slate-950/80 px-1.5 py-0.5 text-[11px] text-amber-100">
                /api/orchestration/projects/:id/sprints
              </code>
              .
            </p>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr,1.4fr]">
            {leadSprint ? <LeadSprintCard sprint={leadSprint} /> : null}

            <div className="space-y-4">
              <SprintLane title="Active Window" subtitle="Execution lanes currently burning down." empty="No active sprint yet. Promote one from planned when the team is ready.">
                {laneSprints.active.map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} tone="active" />
                ))}
              </SprintLane>

              <SprintLane title="Queued Next" subtitle="Planned work that can absorb the next wave." empty="No planned sprint queued up.">
                {laneSprints.planned.map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} tone="planned" />
                ))}
              </SprintLane>

              <SprintLane title="Completed" subtitle="Shipped windows with preserved completion evidence." empty="No completed sprint yet.">
                {laneSprints.done.map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} tone="done" />
                ))}
              </SprintLane>
            </div>
          </div>
        )}
      </section>

      {createOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 p-3 md:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget && !creatingSprint) {
              setCreateOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[linear-gradient(170deg,rgba(15,23,42,0.97),rgba(2,6,23,0.95))] p-4 shadow-[0_20px_60px_rgba(2,6,23,0.65)] md:p-5"
            role="dialog"
            aria-modal="true"
            aria-label="Create sprint"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-amber-100/70">Sprint</p>
                <h3 className="text-lg font-semibold text-white">Create New Sprint</h3>
              </div>
              <button
                type="button"
                disabled={creatingSprint}
                onClick={() => setCreateOpen(false)}
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 disabled:opacity-60"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs text-slate-400">Sprint name</span>
                <input
                  ref={sprintNameInputRef}
                  value={newSprintName}
                  onChange={(event) => setNewSprintName(event.target.value)}
                  placeholder="Sprint 7: Launch Readiness"
                  className="w-full rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
                  aria-label="Sprint name"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-slate-400">Goal</span>
                <textarea
                  value={newSprintGoal}
                  onChange={(event) => setNewSprintGoal(event.target.value)}
                  placeholder="What this sprint needs to ship."
                  className="h-24 w-full resize-none rounded-xl border border-white/10 bg-slate-900/85 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-400/60"
                  aria-label="Sprint goal"
                />
              </label>
              {createError ? <p className="text-xs text-rose-300">{createError}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={creatingSprint}
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={creatingSprint}
                  onClick={() => void handleCreateSprint()}
                  className="rounded-lg border border-amber-300/40 bg-amber-400/12 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-60"
                >
                  {creatingSprint ? "Creating..." : "Create Sprint"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-slate-900/80">
          {icon}
        </span>
        <p className="text-xl font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

function TinyMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950/70 p-1.5">
      <p className="text-[10px] uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-200">{value}</p>
    </div>
  );
}

function LeadSprintCard({ sprint }: { sprint: OrchestrationSprint }) {
  const progress = getSprintProgress(sprint);
  const completionLabel = `${progress}%`;

  return (
    <article className="relative overflow-hidden rounded-3xl border border-amber-300/20 bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.14),transparent_32%),linear-gradient(165deg,rgba(15,23,42,0.95),rgba(2,6,23,0.95))] p-5 shadow-[0_24px_70px_rgba(2,6,23,0.5)]">
      <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-amber-300/10 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-amber-100/80">
            <CalendarClock className="h-4 w-4" />
            <p className="text-[11px] uppercase tracking-[0.16em]">Sprint Spotlight</p>
          </div>
          <StatusPill status={sprint.status} />
        </div>

        <h3 className="mt-3 text-xl font-semibold text-white">{sprint.name}</h3>
        <p className="mt-2 text-sm text-slate-300">{sprint.goal || "No sprint goal entered yet."}</p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <TinyMetric label="Tasks" value={sprint.taskCount} />
          <TinyMetric label="In Prog" value={sprint.inProgressCount} />
          <TinyMetric label="Review" value={sprint.reviewCount} />
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
            <span>Completion</span>
            <span className="font-semibold text-white">{completionLabel}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-900">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(217,119,6,0.92),rgba(16,185,129,0.9))] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <MetaChip icon={<Clock3 className="h-3.5 w-3.5" />} label="Started" value={formatSprintDate(sprint.startDate)} />
            <MetaChip icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="End" value={sprint.endDate ? formatSprintDate(sprint.endDate) : "Open ended"} />
          </div>
        </div>
      </div>
    </article>
  );
}

function SprintLane({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle: string;
  empty: string;
  children: ReactNode;
}) {
  const childCount = Array.isArray(children) ? children.length : children ? 1 : 0;

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/35 p-4">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-slate-900/70 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-slate-300">
          {childCount}
        </span>
      </div>

      {childCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700/80 bg-slate-900/55 px-4 py-6 text-sm text-slate-400">
          {empty}
        </div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}
    </section>
  );
}

function SprintCard({
  sprint,
  tone,
}: {
  sprint: OrchestrationSprint;
  tone: "active" | "planned" | "done";
}) {
  const progress = getSprintProgress(sprint);
  const toneClasses =
    tone === "active"
      ? "border-amber-300/20 bg-amber-400/[0.07]"
      : tone === "planned"
      ? "border-amber-300/20 bg-amber-400/[0.06]"
      : "border-emerald-300/20 bg-emerald-400/[0.06]";

  return (
    <article className={`rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 ${toneClasses}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">{sprint.name}</h4>
          <p className="mt-1 text-xs text-slate-400">{sprint.goal || "No sprint goal entered yet."}</p>
        </div>
        <StatusPill status={sprint.status} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <TinyMetric label="Tasks" value={sprint.taskCount} />
        <TinyMetric label="In Prog" value={sprint.inProgressCount} />
        <TinyMetric label="Review" value={sprint.reviewCount} />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>Completion</span>
          <span className="text-white">{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-900/90">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(217,119,6,0.9),rgba(180,83,9,0.75))]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-slate-300">
        <MetaChip icon={<CalendarClock className="h-3.5 w-3.5" />} label="Start" value={formatSprintDate(sprint.startDate)} compact />
        <MetaChip icon={<Clock3 className="h-3.5 w-3.5" />} label="End" value={sprint.endDate ? formatSprintDate(sprint.endDate) : "Open ended"} compact />
      </div>
    </article>
  );
}

function StatusPill({ status }: { status: OrchestrationSprint["status"] }) {
  const classes =
    status === "active"
      ? "border-amber-300/35 bg-amber-400/12 text-amber-100"
      : status === "planned"
      ? "border-amber-300/35 bg-amber-400/12 text-amber-100"
      : "border-emerald-300/35 bg-emerald-400/12 text-emerald-100";

  return <span className={`inline-flex rounded-md border px-2 py-1 text-[10px] uppercase tracking-[0.1em] ${classes}`}>{status}</span>;
}

function MetaChip({
  icon,
  label,
  value,
  compact = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"}`}>
      <span className="text-slate-400">{icon}</span>
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-100">{value}</span>
    </div>
  );
}

function getSprintProgress(sprint: OrchestrationSprint) {
  return sprint.taskCount > 0 ? Math.round((sprint.doneCount / sprint.taskCount) * 100) : 0;
}

function formatSprintDate(timestamp: string) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "TBD";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
