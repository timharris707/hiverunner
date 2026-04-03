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
  AlertCircle,
  X,
} from "lucide-react";

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

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: "12px",
  border: "1px solid rgba(120,113,108,0.35)",
  background: "rgba(28,25,23,0.92)",
  padding: "10px 14px",
  fontSize: "14px",
  color: "#f5f5f4",
  outline: "none",
  transition: "border-color 120ms ease",
};

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginTop: "16px" }}>
      <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.16em", color: "#a8a29e" }}>
        {label}
        {required ? <span style={{ marginLeft: "4px", color: "#d6d3d1" }}>*</span> : null}
      </span>
      <div style={{ marginTop: "6px" }}>{children}</div>
      {hint ? <p style={{ marginTop: "4px", fontSize: "12px", color: "#57534e" }}>{hint}</p> : null}
    </label>
  );
}

function StepIndicator({ current, completed }: { current: number; completed: Set<number> }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: "28px", userSelect: "none" }}>
      {STEPS.map((step, i) => {
        const done = completed.has(step.num);
        const active = step.num === current;
        const Icon = step.icon;
        return (
          <div key={step.num} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && (
              <div style={{
                width: "40px", height: "2px",
                background: done ? "rgba(168,162,158,0.5)" : active ? "rgba(168,162,158,0.25)" : "rgba(68,64,60,0.5)",
                transition: "background 120ms ease",
              }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "999px",
                display: "flex", alignItems: "center", justifyContent: "center",
                border: done ? "2px solid rgba(168,162,158,0.4)" : active ? "2px solid rgba(168,162,158,0.5)" : "1px solid rgba(120,113,108,0.3)",
                background: done ? "rgba(168,162,158,0.12)" : active ? "rgba(168,162,158,0.08)" : "rgba(41,37,36,0.5)",
                color: done ? "#d6d3d1" : active ? "#f5f5f4" : "#57534e",
                fontSize: "12px", fontWeight: 700, transition: "all 120ms ease",
              }}>
                {done ? <Check size={16} /> : <Icon size={16} />}
              </div>
              <span style={{ fontSize: "10px", color: done ? "#a8a29e" : active ? "#d6d3d1" : "#57534e" }}>
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
    if (k === "name" && data.slug === slugify(data.name)) next.slug = slugify(v);
    onChange(next);
  };
  return (
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f5f5f4" }}>Company Details</h2>
      <p style={{ marginTop: "4px", fontSize: "14px", color: "#78716c" }}>Name your company and describe its mission.</p>
      <Field label="Company Name" required>
        <input style={inputStyle} placeholder="e.g. NeverIdle Labs" value={data.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>
      <Field label="Description / Mission">
        <textarea style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }} placeholder="What does this company do? What are its goals?" value={data.description} onChange={(e) => setField("description", e.target.value)} />
      </Field>
      <Field label="Slug" hint={`Workspace: ~/.openclaw/workspaces/${data.slug || slugify(data.name) || "..."}`}>
        <input style={inputStyle} placeholder="auto-generated from company name" value={data.slug} onChange={(e) => setField("slug", slugify(e.target.value))} />
      </Field>
    </div>
  );
}

function StepProject({ data, onChange }: { data: WizardData["project"]; onChange: (d: WizardData["project"]) => void }) {
  const project = data ?? { name: "", description: "", repoUrl: "" };
  const setField = (k: string, v: string) => onChange({ ...project, [k]: v });
  return (
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f5f5f4" }}>Create a Project</h2>
      <p style={{ marginTop: "4px", fontSize: "14px", color: "#78716c" }}>Optional. You can always add projects later.</p>
      <Field label="Project Name">
        <input style={inputStyle} placeholder="e.g. Weather Edge" value={project.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }} placeholder="What is this project about?" value={project.description} onChange={(e) => setField("description", e.target.value)} />
      </Field>
      <Field label="Repo URL">
        <input style={inputStyle} placeholder="https://github.com/org/repo (optional)" value={project.repoUrl} onChange={(e) => setField("repoUrl", e.target.value)} />
      </Field>
    </div>
  );
}

function StepCEO({ data, onChange }: { data: WizardData["ceo"]; onChange: (d: WizardData["ceo"]) => void }) {
  const setField = (k: keyof WizardData["ceo"], v: string) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f5f5f4" }}>Appoint your CEO</h2>
      <p style={{ marginTop: "4px", fontSize: "14px", color: "#78716c" }}>Your CEO will lead this company, manage the team, and execute on the mission.</p>
      <Field label="CEO Name" required>
        <input style={inputStyle} placeholder='e.g. "Ridge", "Atlas", "Nova"' value={data.name} onChange={(e) => setField("name", e.target.value)} />
      </Field>
      <Field label="Model">
        <select style={inputStyle} value={data.model} onChange={(e) => setField("model", e.target.value)}>
          {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="Additional Guidance">
        <textarea style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }} placeholder="Any specific instructions, personality traits, or leadership style notes..." value={data.guidance} onChange={(e) => setField("guidance", e.target.value)} />
      </Field>
      <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(28,25,23,0.6)", padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: "10px" }}>
        <span style={{ color: "#a8a29e", marginTop: "2px", flexShrink: 0 }}>✦</span>
        <p style={{ fontSize: "12px", color: "#78716c", lineHeight: 1.5 }}>
          Role, capabilities, SOUL.md, AGENTS.md, and HEARTBEAT.md will be <strong style={{ color: "#a8a29e" }}>AI-generated</strong> from your company mission.
        </p>
      </div>
    </div>
  );
}

function StepTask({ data, onChange }: { data: WizardData["task"]; onChange: (d: WizardData["task"]) => void }) {
  const setField = (k: keyof WizardData["task"], v: string) => onChange({ ...data, [k]: v });
  return (
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f5f5f4" }}>First Task</h2>
      <p style={{ marginTop: "4px", fontSize: "14px", color: "#78716c" }}>Give your CEO their first assignment.</p>
      <Field label="Task Title" required>
        <input style={inputStyle} value={data.title} onChange={(e) => setField("title", e.target.value)} />
      </Field>
      <Field label="Description">
        <textarea style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }} value={data.description} onChange={(e) => setField("description", e.target.value)} />
      </Field>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: "12px", border: "1px solid rgba(120,113,108,0.25)", background: "rgba(28,25,23,0.7)", padding: "16px" }}>
      <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#d6d3d1", marginBottom: "8px" }}>{title}</h3>
      <div style={{ fontSize: "12px", color: "#78716c", display: "grid", gap: "2px" }}>{children}</div>
    </div>
  );
}

function StepReview({ data }: { data: WizardData }) {
  return (
    <div>
      <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#f5f5f4" }}>Review &amp; Launch</h2>
      <p style={{ marginTop: "4px", fontSize: "14px", color: "#78716c" }}>Everything looks good? Hit Launch to create your company.</p>
      <div style={{ marginTop: "16px", display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr" }}>
        <SummaryCard title="Company">
          <p style={{ color: "#d6d3d1", fontWeight: 500 }}>{data.company.name}</p>
          {data.company.description && <p style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.company.description}</p>}
          <p style={{ color: "#57534e" }}>slug: {data.company.slug}</p>
        </SummaryCard>
        {data.project ? (
          <SummaryCard title="Project">
            <p style={{ color: "#d6d3d1", fontWeight: 500 }}>{data.project.name}</p>
            {data.project.description && <p style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.project.description}</p>}
          </SummaryCard>
        ) : (
          <SummaryCard title="Project"><p style={{ fontStyle: "italic", color: "#57534e" }}>Skipped</p></SummaryCard>
        )}
        <SummaryCard title="CEO">
          <p style={{ color: "#d6d3d1", fontWeight: 500 }}>{data.ceo.name}</p>
          <p>{MODEL_OPTIONS.find((m) => m.value === data.ceo.model)?.label}</p>
        </SummaryCard>
        <SummaryCard title="First Task">
          <p style={{ color: "#d6d3d1", fontWeight: 500 }}>{data.task.title}</p>
          <p>Priority: {data.task.priority}</p>
        </SummaryCard>
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

  const [data, setData] = useState<WizardData>({
    company: { name: "", description: "", slug: "" },
    project: null,
    ceo: { name: "", model: "anthropic/claude-sonnet-4-6", guidance: "" },
    task: {
      title: "Review company mission and create initial plan",
      description: "Read the company mission and all available context. Understand the project (if any). Create an execution plan with clear priorities, milestones, and next steps. Write your plan to memory.",
      priority: "P1",
    },
  });

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
    if (step === 2) return true;
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
  const back = useCallback(() => { if (step > 1) setStep((s) => s - 1); }, [step]);
  const skipProject = useCallback(() => {
    setData((d) => ({ ...d, project: null }));
    setStep(3);
    setHighestStepVisited((prev) => Math.max(prev, 3));
  }, []);

  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const payload = { ...data, company: { ...data.company, slug: data.company.slug.trim() || slugify(data.company.name) } };
      const res = await fetch("/api/orchestration/companies/create-full", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Launch failed");
      router.push(`/companies/${json.company.slug}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, [data, router]);

  const btnBase: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: "6px",
    padding: "10px 20px", borderRadius: "12px", fontSize: "13px", fontWeight: 600,
    cursor: "pointer", transition: "all 120ms ease", border: "none",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(12,10,9,0.7)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !launching) router.push("/"); }}
    >
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "720px", borderRadius: "16px", border: "1px solid rgba(120,113,108,0.3)", background: "linear-gradient(180deg, rgba(41,37,36,0.95), rgba(20,17,15,0.98))", boxShadow: "0 24px 60px rgba(0,0,0,0.5)", overflow: "hidden" }}>
        {/* header inside card */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(120,113,108,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 8px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.35)", background: "rgba(41,37,36,0.6)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "#a8a29e" }}>
              NEW
            </span>
            <span style={{ fontSize: "13px", color: "#78716c" }}>›</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#f5f5f4" }}>Launch a New Company</span>
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1px solid rgba(120,113,108,0.25)", background: "transparent", color: "#78716c", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          <StepIndicator current={step} completed={completed} />

          {/* step content */}
          <div>
          {step === 1 && <StepCompany data={data.company} onChange={(c) => setData((d) => ({ ...d, company: c }))} />}
          {step === 2 && <StepProject data={data.project} onChange={(p) => setData((d) => ({ ...d, project: p }))} />}
          {step === 3 && <StepCEO data={data.ceo} onChange={(c) => setData((d) => ({ ...d, ceo: c }))} />}
          {step === 4 && <StepTask data={data.task} onChange={(t) => setData((d) => ({ ...d, task: t }))} />}
          {step === 5 && <StepReview data={data} />}

          {error ? (
            <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid rgba(120,113,108,0.3)", background: "rgba(28,25,23,0.8)", padding: "12px 14px", fontSize: "13px", color: "#d6d3d1", display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <AlertCircle size={16} style={{ marginTop: "2px", flexShrink: 0 }} />
              {error}
            </div>
          ) : null}

          {/* footer */}
          <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(120,113,108,0.2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              {step > 1 && (
                <button onClick={back} disabled={launching} style={{ ...btnBase, background: "none", color: "#78716c", padding: "8px 0" }}>
                  <ChevronLeft size={16} /> Back
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {step === 2 && (
                <button onClick={skipProject} style={{ ...btnBase, background: "none", color: "#57534e", padding: "8px 0" }}>
                  <SkipForward size={14} /> Skip
                </button>
              )}
              {step < 5 && (
                <button onClick={next} disabled={!canAdvance} style={{ ...btnBase, background: canAdvance ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.5)", color: canAdvance ? "#f5f5f4" : "#57534e" }}>
                  Next <ChevronRight size={16} />
                </button>
              )}
              {step === 5 && (
                <button onClick={() => void launch()} disabled={launching || !completed.has(1) || !completed.has(3) || !completed.has(4)} style={{ ...btnBase, background: (!launching && completed.has(1)) ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.5)", color: (!launching && completed.has(1)) ? "#f5f5f4" : "#57534e" }}>
                  {launching ? <><Loader2 size={16} /> Creating...</> : <><Rocket size={16} /> Launch Company</>}
                </button>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
