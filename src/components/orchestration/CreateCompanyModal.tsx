"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, ClipboardList, Crown, Building2, FolderGit2, Loader2, Rocket, SkipForward, Sparkles, X } from "lucide-react";

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
  return s.replace(/'/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {label}
        {required && <span className="ml-1 text-[var(--accent)]">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]";
const selectClass =
  "w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] transition-colors focus:border-[var(--border-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)]";

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
              <div className={`h-0.5 w-10 ${done ? "bg-[var(--positive)]" : active ? "bg-[var(--accent)]" : "bg-[var(--border)]"} transition-colors`} />
            )}
            <div className="flex flex-col items-center gap-1">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all ${done ? "bg-[var(--positive-soft)] text-[var(--positive)] ring-2 ring-[var(--positive-soft)]" : active ? "bg-[var(--accent-soft)] text-[var(--accent)] ring-2 ring-[var(--accent-soft)]" : "bg-[var(--surface)] text-[var(--text-muted)] ring-1 ring-[var(--border)]"}`}>
                {done ? <Check size={16} /> : <Icon size={16} />}
              </div>
              <span className={`text-[10px] ${done ? "text-[var(--positive)]" : active ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} ${future ? "opacity-50" : ""}`}>{step.label}</span>
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
    if (k === "name" && data.slug === slugify(data.name)) next.slug = slugify(v);
    onChange(next);
  };
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><Building2 size={20} className="text-[var(--accent)]" /> Company Details</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Name your company and describe its mission.</p>
      </div>
      <Field label="Company Name" required><input className={inputClass} placeholder="e.g. Northstar Labs" value={data.name} onChange={(e) => setField("name", e.target.value)} /></Field>
      <Field label="Description / Mission"><textarea className={inputClass} rows={4} placeholder="What does this company do? What are its goals?" value={data.description} onChange={(e) => setField("description", e.target.value)} /></Field>
      <Field label="Slug (optional)"><input className={inputClass} placeholder="auto-generated from company name" value={data.slug} onChange={(e) => setField("slug", slugify(e.target.value))} /><p className="mt-1 text-xs text-[var(--text-muted)]">Leave blank to auto-generate from the company name. HiveRunner will assign an isolated workspace under the active lane root.</p></Field>
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
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><FolderGit2 size={20} className="text-[var(--accent)]" /> Project Setup</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Optional. Launch with the default Operations project, or define a custom first project now.</p>
      </div>
      <div className={`rounded-lg border p-4 ${!isCustom ? "border-[var(--positive)] bg-[var(--positive-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Use default Operations project</p>
            <p className="text-sm text-[var(--text-secondary)]">Recommended for first launch. HiveRunner will create an Operations project automatically so the CEO can start working immediately.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              !isCustom
                ? "bg-[var(--positive-soft)] text-[var(--positive)] ring-1 ring-[var(--positive)]"
                : "bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {!isCustom ? "Selected" : "Use Default"}
          </button>
        </div>
      </div>
      <div className={`rounded-lg border p-4 ${isCustom ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Customize the first project</p>
            <p className="text-sm text-[var(--text-secondary)]">Use this only if you already know the first project structure you want created before launch.</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(data ?? { name: "", description: "" })}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              isCustom
                ? "bg-[var(--accent-soft)] text-[var(--accent)] ring-1 ring-[var(--accent)]"
                : "bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {isCustom ? "Customizing" : "Customize"}
          </button>
        </div>
        {isCustom && (
          <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
            <Field label="Project Name" required><input className={inputClass} placeholder="e.g. Weather Edge" value={project.name} onChange={(e) => setField("name", e.target.value)} /></Field>
            <Field label="Description"><textarea className={inputClass} rows={3} placeholder="What is this project about?" value={project.description} onChange={(e) => setField("description", e.target.value)} /></Field>
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
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><Crown size={20} className="text-[var(--accent)]" /> Appoint your CEO</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Your CEO will lead this company, manage the team, and execute on the mission.</p>
      </div>
      <Field label="CEO Name" required><input className={inputClass} placeholder='e.g. "Ridge", "Atlas", "Nova"' value={data.name} onChange={(e) => setField("name", e.target.value)} /></Field>
      <Field label="Model">
        <select
          className={selectClass}
          value={data.model}
          onChange={(e) => setField("model", e.target.value)}
          disabled={loadingModels && modelOptions.length === 0}
        >
          {resolvedModelOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        {loadingModels && modelOptions.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">Loading the full model catalog for this lane.</p>
        ) : null}
      </Field>
      <Field label="Additional Guidance"><textarea className={inputClass} rows={3} placeholder="Any specific instructions, personality traits, or leadership style notes for the CEO..." value={data.guidance} onChange={(e) => setField("guidance", e.target.value)} /></Field>
      <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-3"><Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" /><p className="text-xs leading-relaxed text-[var(--text-secondary)]">Role, capabilities, SOUL.md, AGENTS.md, and HEARTBEAT.md will be <strong className="text-[var(--text-primary)]">AI-generated</strong> from your company mission. You don&apos;t need to write them.</p></div>
    </div>
  );
}

function StepTask({ data, onChange }: { data: WizardData["task"]; onChange: (d: WizardData["task"]) => void }) {
  const setField = (k: keyof WizardData["task"], v: string) => onChange({ ...data, [k]: v });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><ClipboardList size={20} className="text-[var(--accent)]" /> First Task</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Give your CEO their first assignment.</p>
      </div>
      <Field label="Task Title" required><input className={inputClass} value={data.title} onChange={(e) => setField("title", e.target.value)} /></Field>
      <Field label="Description (Optional)"><textarea className={inputClass} rows={4} value={data.description} onChange={(e) => setField("description", e.target.value)} /></Field>
    </div>
  );
}

function SummaryCard({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: React.ReactNode }) {
  return <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><Icon size={15} className="text-[var(--accent)]" /> {title}</h3><div className="space-y-0.5 text-xs text-[var(--text-secondary)]">{children}</div></div>;
}

function StepReview({ data, modelOptions }: { data: WizardData; modelOptions: Array<{ value: string; label: string }> }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]"><Rocket size={20} className="text-[var(--accent)]" /> Review &amp; Launch</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Everything looks good? Hit Launch to create your company.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SummaryCard icon={Building2} title="Company"><p><strong className="text-[var(--text-primary)]">{data.company.name}</strong></p>{data.company.description && <p className="line-clamp-2">{data.company.description}</p>}<p className="text-[var(--text-muted)]">slug: {data.company.slug}</p></SummaryCard>
        {data.project ? <SummaryCard icon={FolderGit2} title="Project"><p><strong className="text-[var(--text-primary)]">{data.project.name}</strong></p>{data.project.description && <p className="line-clamp-2">{data.project.description}</p>}</SummaryCard> : <SummaryCard icon={FolderGit2} title="Project"><p><strong className="text-[var(--text-primary)]">Operations</strong></p><p>HiveRunner will create the default Operations project at launch.</p></SummaryCard>}
        <SummaryCard icon={Crown} title="CEO"><p><strong className="text-[var(--text-primary)]">{data.ceo.name}</strong> <span className="text-[var(--text-muted)]">({modelOptions.find((m) => m.value === data.ceo.model)?.label})</span></p><p className="flex items-center gap-1 text-[var(--accent)]"><Sparkles size={11} /> AI-generated identity files</p></SummaryCard>
        <SummaryCard icon={ClipboardList} title="First Task"><p><strong className="text-[var(--text-primary)]">{data.task.title}</strong></p><p className="line-clamp-3">{data.task.description || "No additional task description provided."}</p></SummaryCard>
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--text-secondary)]">
        Launch will create the company, start the CEO on the first task, and open the dashboard with live company activity.
      </div>
    </div>
  );
}

type CompanyLaunchResult = {
  companyCode?: string;
  dashboardHref?: string;
  taskHref?: string;
  taskKey?: string;
};

export function CreateCompanyModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (result?: CompanyLaunchResult) => void }) {
  const [step, setStep] = useState(1);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highestStepVisited, setHighestStepVisited] = useState(1);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setModelsLoading(true);
    fetch("/api/orchestration/models")
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        if (Array.isArray(d.models) && d.models.length > 0) {
          setModelOptions(d.models.map((m: { value: string; label: string }) => ({ value: m.value, label: m.label })));
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
  }, [open]);

  const [data, setData] = useState<WizardData>(() => createInitialCompanyWizardData());

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !launching) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, launching, onClose]);

  const reset = () => {
    setStep(1);
    setLaunching(false);
    setError(null);
    setHighestStepVisited(1);
    setData(createInitialCompanyWizardData());
  };

  const handleClose = () => {
    if (launching) return;
    reset();
    onClose();
  };

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
  const back = useCallback(() => { if (step > 1) setStep((s) => s - 1); }, [step]);
  const skipProject = useCallback(() => { setData((d) => ({ ...d, project: null })); setStep(3); setHighestStepVisited((prev) => Math.max(prev, 3)); }, []);

  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const payload = { ...data, company: { ...data.company, slug: data.company.slug.trim() || slugify(data.company.name) } };
      const res = await fetch("/api/orchestration/companies/create-full", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Launch failed");
      const launchResult: CompanyLaunchResult = {
        companyCode: typeof json.company?.code === "string" ? json.company.code : undefined,
        dashboardHref: typeof json.dashboardHref === "string" ? json.dashboardHref : undefined,
        taskHref: typeof json.taskHref === "string" ? json.taskHref : undefined,
        taskKey: typeof json.taskKey === "string" ? json.taskKey : undefined,
      };
      reset();
      onCreated?.(launchResult);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, [data, onClose, onCreated]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create company"
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--modal-backdrop)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="w-full max-w-xl" style={{ maxHeight: "90vh", overflowY: "auto", padding: "16px" }}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex-1 text-center">
            <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">Create Company</p>
            <h1 className="mt-2 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Launch a New Company</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Build a fully operational AI company in five steps.</p>
          </div>
        </div>
        <StepIndicator current={step} completed={completed} />
        <div className="relative rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-6 shadow-[var(--shadow-glass)] md:p-8">
          <button type="button" onClick={handleClose} className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-transparent text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]" aria-label="Close company wizard"><X size={14} /></button>
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
          {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--negative)] bg-[var(--negative-soft)] p-3 text-sm text-[var(--negative)]"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div>}
          <div className="mt-8 flex items-center justify-between border-t border-[var(--border)] pt-5">
            <div>{step > 1 && <button onClick={back} disabled={launching} className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:opacity-40"><ChevronLeft size={16} /> Back</button>}</div>
            <div className="flex items-center gap-3">
              {step === 2 && <button onClick={skipProject} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"><SkipForward size={14} /> Use Default</button>}
              {step < 5 && <button onClick={next} disabled={!canAdvance} className="hr-primary-cta flex items-center gap-1.5 rounded-md px-5 py-2.5 text-sm font-medium transition-colors">Next <ChevronRight size={16} /></button>}
              {step === 5 && <button onClick={launch} disabled={launching || !completed.has(1) || !completed.has(3) || !completed.has(4)} className="hr-primary-cta flex items-center gap-2 rounded-md px-6 py-2.5 text-sm font-semibold transition-colors">{launching ? <><Loader2 size={16} className="animate-spin" /> Creating company...</> : <><Rocket size={16} /> Launch Company</>}</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
