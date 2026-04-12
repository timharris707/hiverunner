"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
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
  X,
} from "lucide-react";

import {
  COMPANY_WIZARD_STATIC_MODEL_OPTIONS,
  createInitialCompanyWizardData,
} from "@/lib/orchestration/company-wizard";

interface WizardData {
  company: { name: string; description: string; slug: string };
  project: { name: string; description: string } | null;
  ceo: { name: string; model: string; guidance: string };
  task: { title: string; description: string; priority: string };
}

const STEPS = [
  { num: 1, label: "Company", icon: Building2 },
  { num: 2, label: "Project", icon: FolderGit2 },
  { num: 3, label: "CEO", icon: Crown },
  { num: 4, label: "First Task", icon: ClipboardList },
  { num: 5, label: "Launch", icon: Rocket },
];

function slugify(s: string) {
  return s
    .replace(/'/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

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
      <span className="text-[11px] uppercase tracking-[0.16em] text-stone-400">
        {label}
        {required && <span className="ml-1 text-amber-400">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-stone-700/80 bg-[rgba(28,25,23,0.92)] px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors";
const selectClass =
  "w-full rounded-xl border border-stone-700/80 bg-[rgba(28,25,23,0.92)] px-3 py-2.5 text-sm text-stone-100 focus:border-amber-500/70 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors appearance-none";

function StepIndicator({ current, completed }: { current: number; completed: Set<number> }) {
  return (
    <div className="mb-8 flex select-none items-center justify-center gap-0">
      {STEPS.map((step, i) => {
        const done = completed.has(step.num);
        const active = step.num === current;
        const future = !done && !active;
        const Icon = step.icon;
        return (
          <div key={step.num} className="flex items-center">
            {i > 0 && (
              <div
                className={`h-0.5 w-10 ${done ? "bg-emerald-600" : active ? "bg-amber-700" : "bg-stone-700"} transition-colors`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all ${
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
                  done ? "text-emerald-400" : active ? "text-amber-400" : "text-stone-500"
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

function StepCompany({ data, onChange }: { data: WizardData["company"]; onChange: (d: WizardData["company"]) => void }) {
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
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Building2 size={20} className="text-amber-400" /> Company Details
        </h2>
        <p className="mt-1 text-sm text-stone-400">Name your company and describe its mission.</p>
      </div>
      <Field label="Company Name" required>
        <input className={inputClass} placeholder="e.g. NeverIdle Labs" value={data.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>
      <Field label="Description / Mission">
        <textarea className={inputClass} rows={4} placeholder="What does this company do? What are its goals?" value={data.description} onChange={(e) => setField("description", e.target.value)} />
      </Field>
      <Field label="Slug (optional)">
        <input className={inputClass} placeholder="auto-generated from company name" value={data.slug} onChange={(e) => setField("slug", slugify(e.target.value))} />
        <p className="mt-1 text-xs text-stone-500">Leave blank to auto-generate from the company name. Mission Control will assign an isolated workspace under the active lane root.</p>
      </Field>
    </div>
  );
}

function StepProject({ data, onChange }: { data: WizardData["project"]; onChange: (d: WizardData["project"]) => void }) {
  const project = data ?? { name: "", description: "" };
  const isCustom = Boolean(data);
  const setField = (k: keyof NonNullable<WizardData["project"]>, v: string) => onChange({ ...project, [k]: v });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <FolderGit2 size={20} className="text-amber-400" /> Project Setup
        </h2>
        <p className="mt-1 text-sm text-stone-400">Optional. Launch with the default Operations project, or define a custom first project now.</p>
      </div>
      <div className={`rounded-2xl border p-4 ${!isCustom ? "border-emerald-700/50 bg-emerald-950/20" : "border-stone-800/80 bg-[rgba(28,25,23,0.84)]"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-stone-200">Use default Operations project</p>
            <p className="text-sm text-stone-400">Recommended for first launch. Mission Control will create an Operations project automatically so the CEO can start working immediately.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              !isCustom
                ? "bg-emerald-600/20 text-emerald-300 ring-1 ring-emerald-600/40"
                : "bg-stone-800 text-stone-300 hover:bg-stone-700"
            }`}
          >
            {!isCustom ? "Selected" : "Use Default"}
          </button>
        </div>
      </div>
      <div className={`rounded-2xl border p-4 ${isCustom ? "border-amber-700/50 bg-amber-950/20" : "border-stone-800/80 bg-[rgba(28,25,23,0.84)]"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-stone-200">Customize the first project</p>
            <p className="text-sm text-stone-400">Use this only if you already know the first project structure you want created before launch.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(data ?? { name: "", description: "" })}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              isCustom
                ? "bg-amber-600/20 text-amber-300 ring-1 ring-amber-600/40"
                : "bg-stone-800 text-stone-300 hover:bg-stone-700"
            }`}
          >
            {isCustom ? "Customizing" : "Customize"}
          </button>
        </div>
        {isCustom && (
          <div className="mt-4 space-y-4 border-t border-stone-800/80 pt-4">
            <Field label="Project Name" required>
              <input className={inputClass} placeholder="e.g. Weather Edge" value={project.name} onChange={(e) => setField("name", e.target.value)} />
            </Field>
            <Field label="Description">
              <textarea className={inputClass} rows={3} placeholder="What is this project about?" value={project.description} onChange={(e) => setField("description", e.target.value)} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function StepCEO({
  data,
  onChange,
  modelOptions,
  loadingModels,
}: {
  data: WizardData["ceo"];
  onChange: (d: WizardData["ceo"]) => void;
  modelOptions: Array<{ value: string; label: string }>;
  loadingModels: boolean;
}) {
  const setField = (k: keyof WizardData["ceo"], v: string) => onChange({ ...data, [k]: v });
  const resolvedModelOptions = loadingModels && modelOptions.length === 0
    ? [{ value: data.model, label: "Loading available models..." }]
    : modelOptions;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Crown size={20} className="text-amber-400" /> Appoint your CEO
        </h2>
        <p className="mt-1 text-sm text-stone-400">Your CEO will lead this company, manage the team, and execute on the mission.</p>
      </div>
      <Field label="CEO Name" required>
        <input className={inputClass} placeholder='e.g. "Ridge", "Atlas", "Nova"' value={data.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>
      <Field label="Model">
        <select
          className={selectClass}
          value={data.model}
          onChange={(e) => setField("model", e.target.value)}
          disabled={loadingModels && modelOptions.length === 0}
        >
          {resolvedModelOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        {loadingModels && modelOptions.length === 0 ? (
          <p className="mt-1 text-xs text-stone-500">Loading the full model catalog for this lane.</p>
        ) : null}
      </Field>
      <Field label="Additional Guidance">
        <textarea className={inputClass} rows={3} placeholder="Any specific instructions, personality traits, or leadership style notes for the CEO..." value={data.guidance} onChange={(e) => setField("guidance", e.target.value)} />
      </Field>
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-800/40 bg-amber-950/20 p-3">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-stone-400">
          Role, capabilities, SOUL.md, AGENTS.md, and HEARTBEAT.md will be <strong className="text-stone-300">AI-generated</strong> from your company mission. You don&apos;t need to write them.
        </p>
      </div>
    </div>
  );
}

function StepTask({ data, onChange }: { data: WizardData["task"]; onChange: (d: WizardData["task"]) => void }) {
  const setField = (k: keyof WizardData["task"], v: string) => onChange({ ...data, [k]: v });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <ClipboardList size={20} className="text-amber-400" /> First Task
        </h2>
        <p className="mt-1 text-sm text-stone-400">Give your CEO their first assignment.</p>
      </div>
      <Field label="Task Title" required>
        <input className={inputClass} value={data.title} onChange={(e) => setField("title", e.target.value)} />
      </Field>
      <Field label="Description (Optional)">
        <textarea className={inputClass} rows={4} value={data.description} onChange={(e) => setField("description", e.target.value)} />
      </Field>
    </div>
  );
}

function SummaryCard({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-stone-800/80 bg-[rgba(28,25,23,0.84)] p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-200"><Icon size={15} className="text-amber-400" /> {title}</h3>
      <div className="space-y-0.5 text-xs text-stone-400">{children}</div>
    </div>
  );
}

function StepReview({ data, modelOptions }: { data: WizardData; modelOptions: Array<{ value: string; label: string }> }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Rocket size={20} className="text-amber-400" /> Review &amp; Launch
        </h2>
        <p className="mt-1 text-sm text-stone-400">Everything looks good? Hit Launch to create your company.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryCard icon={Building2} title="Company">
          <p><strong className="text-stone-300">{data.company.name}</strong></p>
          {data.company.description && <p className="line-clamp-2">{data.company.description}</p>}
          <p className="text-stone-500">slug: {data.company.slug}</p>
        </SummaryCard>
        {data.project ? (
          <SummaryCard icon={FolderGit2} title="Project">
            <p><strong className="text-stone-300">{data.project.name}</strong></p>
            {data.project.description && <p className="line-clamp-2">{data.project.description}</p>}
          </SummaryCard>
        ) : (
          <SummaryCard icon={FolderGit2} title="Project">
            <p><strong className="text-stone-300">Operations</strong></p>
            <p>Mission Control will create the default Operations project at launch.</p>
          </SummaryCard>
        )}
        <SummaryCard icon={Crown} title="CEO">
          <p><strong className="text-stone-300">{data.ceo.name}</strong> <span className="text-stone-500">({modelOptions.find((m) => m.value === data.ceo.model)?.label})</span></p>
          <p className="flex items-center gap-1 text-amber-500/70"><Sparkles size={11} /> AI-generated identity files</p>
        </SummaryCard>
        <SummaryCard icon={ClipboardList} title="First Task">
          <p><strong className="text-stone-300">{data.task.title}</strong></p>
          <p className="line-clamp-3">{data.task.description || "No additional task description provided."}</p>
        </SummaryCard>
      </div>
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 text-sm text-stone-300">
        Launch will create the company, start the CEO on the first task, and open the dashboard with live company activity.
      </div>
    </div>
  );
}

export default function CompanyOnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highestStepVisited, setHighestStepVisited] = useState(1);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setModelsLoading(true);
    fetch("/api/orchestration/models")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (Array.isArray(d.models) && d.models.length > 0) {
          setModelOptions(d.models.map((m: { value: string; label: string }) => ({
            value: m.value,
            label: m.label,
          })));
        } else {
          setModelOptions(COMPANY_WIZARD_STATIC_MODEL_OPTIONS);
        }
      })
      .catch(() => {
        if (!active) return;
        setModelOptions(COMPANY_WIZARD_STATIC_MODEL_OPTIONS);
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const [data, setData] = useState<WizardData>(() => createInitialCompanyWizardData());

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
    if (step === 2) return data.project === null || !!data.project.name.trim();
    if (step === 3) return !!data.ceo.name.trim() && (!modelsLoading || modelOptions.length > 0);
    if (step === 4) return !!data.task.title.trim();
    return true;
  }, [step, data, modelOptions.length, modelsLoading]);

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
      const launchHref = typeof json.dashboardHref === "string"
        ? json.dashboardHref
        : typeof json.taskHref === "string"
          ? json.taskHref
          : typeof json.company?.slug === "string"
            ? `/companies/${encodeURIComponent(json.company.slug)}/dashboard`
            : "/";
      router.replace(launchHref);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, [data, router]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,10,9,0.7)] backdrop-blur-[6px]">
      <div className="flex w-full items-center justify-center px-4 py-8 md:px-6" style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <div className="w-full max-w-4xl">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex-1 text-center">
              <p className="text-[11px] uppercase tracking-[0.22em] text-amber-300/70">Create Company</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Launch a New Company</h1>
              <p className="mt-2 text-sm text-stone-400">Build a fully operational AI company in five steps.</p>
            </div>
          </div>
          <StepIndicator current={step} completed={completed} />
          <div className="relative rounded-[32px] border border-stone-600/45 bg-[radial-gradient(circle_at_top,rgba(217,119,6,0.14),transparent_34%),linear-gradient(165deg,rgba(41,37,36,0.96),rgba(12,10,9,0.99))] p-6 shadow-[0_30px_80px_rgba(12,10,9,0.65)] backdrop-blur-2xl md:p-8">
            <button type="button" onClick={() => router.push("/")} className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-700/60 bg-transparent text-stone-500 transition hover:border-stone-500 hover:text-white" aria-label="Close company wizard">
              <X size={14} />
            </button>
            {step === 1 && <StepCompany data={data.company} onChange={(c) => setData((d) => ({ ...d, company: c }))} />}
            {step === 2 && <StepProject data={data.project} onChange={(p) => setData((d) => ({ ...d, project: p }))} />}
            {step === 3 && (
              <StepCEO
                data={data.ceo}
                onChange={(c) => setData((d) => ({ ...d, ceo: c }))}
                modelOptions={modelOptions}
                loadingModels={modelsLoading}
              />
            )}
            {step === 4 && <StepTask data={data.task} onChange={(t) => setData((d) => ({ ...d, task: t }))} />}
            {step === 5 && <StepReview data={data} modelOptions={modelOptions} />}
            {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-800/60 bg-red-900/20 p-3 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}
            <div className="mt-8 flex items-center justify-between border-t border-stone-800/80 pt-5">
              <div>{step > 1 && <button onClick={back} disabled={launching} className="flex items-center gap-1.5 text-sm text-stone-400 transition-colors hover:text-white disabled:opacity-40"><ChevronLeft size={16} /> Back</button>}</div>
              <div className="flex items-center gap-3">
                {step === 2 && <button onClick={skipProject} className="flex items-center gap-1.5 text-sm text-stone-500 transition-colors hover:text-stone-300"><SkipForward size={14} /> Use Default</button>}
                {step < 5 && <button onClick={next} disabled={!canAdvance} className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:bg-stone-700 disabled:text-stone-500">Next <ChevronRight size={16} /></button>}
                {step === 5 && <button onClick={launch} disabled={launching || !completed.has(1) || !completed.has(3) || !completed.has(4)} className="flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-500 disabled:bg-stone-700 disabled:text-stone-500">{launching ? <><Loader2 size={16} className="animate-spin" /> Creating company...</> : <><Rocket size={16} /> Launch Company</>}</button>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
