"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  FolderGit2,
  Crown,
  ClipboardList,
  Rocket,
  Check,
  ChevronRight,
  ChevronLeft,
  SkipForward,
  Loader2,
  Sparkles,
  AlertCircle,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface WizardData {
  company: { name: string; description: string; slug: string };
  project: { name: string; description: string; repoUrl: string } | null;
  ceo: { name: string; model: string; guidance: string };
  task: { title: string; description: string; priority: string };
}

const MODEL_OPTIONS = [
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "openai-codex/gpt-5.4", label: "GPT-5.4" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
];

const PRIORITY_OPTIONS = [
  { value: "P0", label: "P0 — Critical" },
  { value: "P1", label: "P1 — High" },
  { value: "P2", label: "P2 — Medium" },
  { value: "P3", label: "P3 — Low" },
];

const STEPS = [
  { num: 1, label: "Company", icon: Building2 },
  { num: 2, label: "Project", icon: FolderGit2 },
  { num: 3, label: "CEO", icon: Crown },
  { num: 4, label: "First Task", icon: ClipboardList },
  { num: 5, label: "Launch", icon: Rocket },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/* ------------------------------------------------------------------ */
/*  Shared input components                                           */
/* ------------------------------------------------------------------ */

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-stone-300">
        {label}
        {required && <span className="text-amber-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-stone-700 bg-[#1c1917] px-3 py-2 text-sm text-white placeholder:text-stone-500 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600/40 transition-colors";
const selectClass =
  "w-full rounded-lg border border-stone-700 bg-[#1c1917] px-3 py-2 text-sm text-white focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600/40 transition-colors appearance-none";

/* ------------------------------------------------------------------ */
/*  Step indicator                                                     */
/* ------------------------------------------------------------------ */

function StepIndicator({ current, completed }: { current: number; completed: Set<number> }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8 select-none">
      {STEPS.map((step, i) => {
        const done = completed.has(step.num);
        const active = step.num === current;
        const future = !done && !active;
        const Icon = step.icon;
        return (
          <div key={step.num} className="flex items-center">
            {/* connector line */}
            {i > 0 && (
              <div
                className={`w-10 h-0.5 ${done ? "bg-emerald-600" : active ? "bg-amber-700" : "bg-stone-700"} transition-colors`}
              />
            )}
            {/* circle */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done
                    ? "bg-emerald-600/20 text-emerald-400 ring-2 ring-emerald-600/40"
                    : active
                      ? "bg-amber-600/20 text-amber-400 ring-2 ring-amber-600/60"
                      : "bg-stone-800 text-stone-500 ring-1 ring-stone-700"
                }`}
              >
                {done ? <Check size={16} /> : <Icon size={16} />}
              </div>
              <span
                className={`text-[10px] ${
                  done
                    ? "text-emerald-400"
                    : active
                      ? "text-amber-400"
                      : "text-stone-500"
                } ${future ? "opacity-50" : ""}`}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Company                                                   */
/* ------------------------------------------------------------------ */

function StepCompany({
  data,
  onChange,
}: {
  data: WizardData["company"];
  onChange: (d: WizardData["company"]) => void;
}) {
  const setField = (k: keyof WizardData["company"], v: string) => {
    const next = { ...data, [k]: v };
    if (k === "name" && data.slug === slugify(data.name)) {
      next.slug = slugify(v);
    }
    onChange(next);
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Building2 size={20} className="text-amber-500" /> Company Details
        </h2>
        <p className="text-sm text-stone-400 mt-1">
          Name your company and describe its mission.
        </p>
      </div>
      <Field label="Company Name" required>
        <input
          className={inputClass}
          placeholder="e.g. NeverIdle Labs"
          value={data.name}
          onChange={(e) => setField("name", e.target.value)}
        />
      </Field>
      <Field label="Description / Mission">
        <textarea
          className={inputClass}
          rows={4}
          placeholder="What does this company do? What are its goals?"
          value={data.description}
          onChange={(e) => setField("description", e.target.value)}
        />
      </Field>
      <Field label="Slug (optional)">
        <input
          className={inputClass}
          placeholder="auto-generated from company name"
          value={data.slug}
          onChange={(e) => setField("slug", slugify(e.target.value))}
        />
        <p className="text-xs text-stone-500 mt-1">
          Leave blank to auto-generate from the company name. Workspace: ~/.openclaw/workspace-{data.slug || slugify(data.name) || "..."}
        </p>
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Project (optional)                                        */
/* ------------------------------------------------------------------ */

function StepProject({
  data,
  onChange,
}: {
  data: WizardData["project"];
  onChange: (d: WizardData["project"]) => void;
}) {
  const project = data ?? { name: "", description: "", repoUrl: "" };
  const setField = (k: string, v: string) => onChange({ ...project, [k]: v });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <FolderGit2 size={20} className="text-amber-500" /> Create a Project
        </h2>
        <p className="text-sm text-stone-400 mt-1">
          Optional. You can always add projects later.
        </p>
      </div>
      <Field label="Project Name">
        <input
          className={inputClass}
          placeholder="e.g. Weather Edge"
          value={project.name}
          onChange={(e) => setField("name", e.target.value)}
        />
      </Field>
      <Field label="Description">
        <textarea
          className={inputClass}
          rows={3}
          placeholder="What is this project about?"
          value={project.description}
          onChange={(e) => setField("description", e.target.value)}
        />
      </Field>
      <Field label="Repo URL">
        <input
          className={inputClass}
          placeholder="https://github.com/org/repo (optional)"
          value={project.repoUrl}
          onChange={(e) => setField("repoUrl", e.target.value)}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 3 — Appoint CEO                                              */
/* ------------------------------------------------------------------ */

function StepCEO({
  data,
  onChange,
}: {
  data: WizardData["ceo"];
  onChange: (d: WizardData["ceo"]) => void;
}) {
  const setField = (k: keyof WizardData["ceo"], v: string) => onChange({ ...data, [k]: v });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Crown size={20} className="text-amber-500" /> Appoint your CEO
        </h2>
        <p className="text-sm text-stone-400 mt-1">
          Your CEO will lead this company, manage the team, and execute on the mission.
        </p>
      </div>
      <Field label="CEO Name" required>
        <input
          className={inputClass}
          placeholder='e.g. "Ridge", "Atlas", "Nova"'
          value={data.name}
          onChange={(e) => setField("name", e.target.value)}
        />
      </Field>
      <Field label="Model">
        <select
          className={selectClass}
          value={data.model}
          onChange={(e) => setField("model", e.target.value)}
        >
          {MODEL_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Additional Guidance">
        <textarea
          className={inputClass}
          rows={3}
          placeholder="Any specific instructions, personality traits, or leadership style notes for the CEO..."
          value={data.guidance}
          onChange={(e) => setField("guidance", e.target.value)}
        />
      </Field>
      <div className="rounded-lg border border-stone-700/60 bg-stone-800/40 p-3 flex items-start gap-2.5">
        <Sparkles size={16} className="text-amber-500 mt-0.5 shrink-0" />
        <p className="text-xs text-stone-400 leading-relaxed">
          Role, capabilities, SOUL.md, AGENTS.md, and HEARTBEAT.md will be <strong className="text-stone-300">AI-generated</strong> from
          your company mission. You don&apos;t need to write them.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4 — First Task                                                */
/* ------------------------------------------------------------------ */

function StepTask({
  data,
  onChange,
}: {
  data: WizardData["task"];
  onChange: (d: WizardData["task"]) => void;
}) {
  const setField = (k: keyof WizardData["task"], v: string) => onChange({ ...data, [k]: v });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <ClipboardList size={20} className="text-amber-500" /> First Task
        </h2>
        <p className="text-sm text-stone-400 mt-1">
          Give your CEO their first assignment.
        </p>
      </div>
      <Field label="Task Title" required>
        <input
          className={inputClass}
          value={data.title}
          onChange={(e) => setField("title", e.target.value)}
        />
      </Field>
      <Field label="Description">
        <textarea
          className={inputClass}
          rows={4}
          value={data.description}
          onChange={(e) => setField("description", e.target.value)}
        />
      </Field>
      <Field label="Priority">
        <select
          className={selectClass}
          value={data.priority}
          onChange={(e) => setField("priority", e.target.value)}
        >
          {PRIORITY_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step 5 — Review & Launch                                          */
/* ------------------------------------------------------------------ */

function SummaryCard({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-stone-700/60 bg-stone-800/30 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-stone-200 flex items-center gap-2">
        <Icon size={15} className="text-amber-500" /> {title}
      </h3>
      <div className="text-xs text-stone-400 space-y-0.5">{children}</div>
    </div>
  );
}

function StepReview({ data }: { data: WizardData }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Rocket size={20} className="text-amber-500" /> Review &amp; Launch
        </h2>
        <p className="text-sm text-stone-400 mt-1">
          Everything looks good? Hit Launch to create your company.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SummaryCard icon={Building2} title="Company">
          <p>
            <strong className="text-stone-300">{data.company.name}</strong>
          </p>
          {data.company.description && (
            <p className="line-clamp-2">{data.company.description}</p>
          )}
          <p className="text-stone-500">slug: {data.company.slug}</p>
        </SummaryCard>

        {data.project ? (
          <SummaryCard icon={FolderGit2} title="Project">
            <p>
              <strong className="text-stone-300">{data.project.name}</strong>
            </p>
            {data.project.description && (
              <p className="line-clamp-2">{data.project.description}</p>
            )}
            {data.project.repoUrl && <p className="truncate">{data.project.repoUrl}</p>}
          </SummaryCard>
        ) : (
          <SummaryCard icon={FolderGit2} title="Project">
            <p className="italic text-stone-500">Skipped — no project</p>
          </SummaryCard>
        )}

        <SummaryCard icon={Crown} title="CEO">
          <p>
            <strong className="text-stone-300">{data.ceo.name}</strong>{" "}
            <span className="text-stone-500">
              ({MODEL_OPTIONS.find((m) => m.value === data.ceo.model)?.label})
            </span>
          </p>
          <p className="text-amber-500/70 flex items-center gap-1">
            <Sparkles size={11} /> AI-generated identity files
          </p>
        </SummaryCard>

        <SummaryCard icon={ClipboardList} title="First Task">
          <p>
            <strong className="text-stone-300">{data.task.title}</strong>
          </p>
          <p>Priority: {data.task.priority}</p>
        </SummaryCard>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Wizard                                                        */
/* ------------------------------------------------------------------ */

export default function CompanyOnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highestStepVisited, setHighestStepVisited] = useState(1);

  const [data, setData] = useState<WizardData>({
    company: { name: "", description: "", slug: "" },
    project: null,
    ceo: { name: "", model: "anthropic/claude-sonnet-4-6", guidance: "" },
    task: {
      title: "Review company mission and create initial plan",
      description:
        "Read the company mission and all available context. Understand the project (if any). Create an execution plan with clear priorities, milestones, and next steps. Write your plan to memory.",
      priority: "P1",
    },
  });

  // Track which steps have been filled enough to mark complete
  const completed = useMemo(() => {
    const s = new Set<number>();
    const effectiveSlug = data.company.slug.trim() || slugify(data.company.name);
    if (highestStepVisited > 1 && data.company.name.trim() && effectiveSlug) s.add(1);
    if (highestStepVisited > 2 && (data.project === null || data.project.name.trim())) s.add(2);
    if (highestStepVisited > 3 && data.ceo.name.trim()) s.add(3);
    if (highestStepVisited > 4 && data.task.title.trim()) s.add(4);
    return s;
  }, [data, highestStepVisited]);

  const canAdvance = useMemo(() => {
    if (step === 1) return !!data.company.name.trim() && !!(data.company.slug.trim() || slugify(data.company.name));
    if (step === 2) return true; // optional
    if (step === 3) return !!data.ceo.name.trim();
    if (step === 4) return !!data.task.title.trim();
    return true;
  }, [step, data]);

  const next = useCallback(() => {
    if (step < 5) {
      const nextStep = step + 1;
      setStep(nextStep);
      setHighestStepVisited((prev) => Math.max(prev, nextStep));
    }
  }, [step]);
  const back = useCallback(() => {
    if (step > 1) setStep((s) => s - 1);
  }, [step]);
  const skipProject = useCallback(() => {
    setData((d) => ({ ...d, project: null }));
    setStep(3);
    setHighestStepVisited((prev) => Math.max(prev, 3));
  }, []);

  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const payload = {
        ...data,
        company: {
          ...data.company,
          slug: data.company.slug.trim() || slugify(data.company.name),
        },
      };
      const res = await fetch("/api/orchestration/companies/create-full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Launch failed");
      router.push(`/companies/${json.company.slug}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, [data, router]);

  return (
    <div className="min-h-[calc(100vh-120px)] flex items-start justify-center pt-8 px-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Launch a New Company
          </h1>
          <p className="text-sm text-stone-400 mt-1">
            Create a fully operational AI company in five steps.
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} completed={completed} />

        {/* Card */}
        <div className="orchestra-glass rounded-xl border border-stone-700/50 p-6">
          {step === 1 && (
            <StepCompany
              data={data.company}
              onChange={(c) => setData((d) => ({ ...d, company: c }))}
            />
          )}
          {step === 2 && (
            <StepProject
              data={data.project}
              onChange={(p) => setData((d) => ({ ...d, project: p }))}
            />
          )}
          {step === 3 && (
            <StepCEO
              data={data.ceo}
              onChange={(c) => setData((d) => ({ ...d, ceo: c }))}
            />
          )}
          {step === 4 && (
            <StepTask
              data={data.task}
              onChange={(t) => setData((d) => ({ ...d, task: t }))}
            />
          )}
          {step === 5 && <StepReview data={data} />}

          {/* Error */}
          {error && (
            <div className="mt-4 rounded-lg border border-red-800/60 bg-red-900/20 p-3 flex items-start gap-2 text-sm text-red-400">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-4 border-t border-stone-800">
            <div>
              {step > 1 && (
                <button
                  onClick={back}
                  disabled={launching}
                  className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-white transition-colors disabled:opacity-40"
                >
                  <ChevronLeft size={16} /> Back
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              {step === 2 && (
                <button
                  onClick={skipProject}
                  className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-300 transition-colors"
                >
                  <SkipForward size={14} /> Skip
                </button>
              )}
              {step < 5 && (
                <button
                  onClick={next}
                  disabled={!canAdvance}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-stone-700 disabled:text-stone-500 px-5 py-2 text-sm font-medium text-white transition-colors"
                >
                  Next <ChevronRight size={16} />
                </button>
              )}
              {step === 5 && (
                <button
                  onClick={launch}
                  disabled={launching || !completed.has(1) || !completed.has(3) || !completed.has(4)}
                  className="flex items-center gap-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:bg-stone-700 disabled:text-stone-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors"
                >
                  {launching ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Creating company...
                    </>
                  ) : (
                    <>
                      <Rocket size={16} /> Launch Company
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
