"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Rocket, SkipForward, X } from "lucide-react";

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

function slugify(s: string) {
  return s.replace(/'/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: "10px",
  border: "1px solid rgba(120,113,108,0.3)",
  background: "rgba(41,37,36,0.5)",
  padding: "10px 14px",
  fontSize: "13px",
  color: "#f5f5f4",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#78716c",
  marginBottom: "6px",
  display: "flex",
  alignItems: "center",
  gap: "4px",
};

const STEP_LABELS = ["Company", "Project", "CEO", "First Task", "Review"];

export default function CompanyOnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<WizardData>({
    company: { name: "", description: "", slug: "" },
    project: null,
    ceo: { name: "", model: "anthropic/claude-sonnet-4-6", guidance: "" },
    task: {
      title: "Review company mission and create initial plan",
      description: "Read the company mission and all available context. Create an execution plan with clear priorities, milestones, and next steps.",
      priority: "P1",
    },
  });

  const effectiveSlug = data.company.slug.trim() || slugify(data.company.name);

  const canAdvance = useMemo(() => {
    if (step === 0) return !!data.company.name.trim() && !!effectiveSlug;
    if (step === 1) return true; // project is optional
    if (step === 2) return !!data.ceo.name.trim();
    if (step === 3) return !!data.task.title.trim();
    return true;
  }, [step, data, effectiveSlug]);

  const next = useCallback(() => { if (step < 4) setStep((s) => s + 1); }, [step]);
  const back = useCallback(() => { if (step > 0) setStep((s) => s - 1); }, [step]);
  const skipProject = useCallback(() => { setData((d) => ({ ...d, project: null })); setStep(2); }, []);

  const setCompanyField = (k: keyof WizardData["company"], v: string) => {
    setData((d) => {
      const next = { ...d.company, [k]: v };
      if (k === "name" && d.company.slug === slugify(d.company.name)) next.slug = slugify(v);
      return { ...d, company: next };
    });
  };

  const setProjectField = (k: string, v: string) => {
    setData((d) => ({ ...d, project: { ...(d.project ?? { name: "", description: "", repoUrl: "" }), [k]: v } }));
  };

  const setCeoField = (k: keyof WizardData["ceo"], v: string) => {
    setData((d) => ({ ...d, ceo: { ...d.ceo, [k]: v } }));
  };

  const setTaskField = (k: keyof WizardData["task"], v: string) => {
    setData((d) => ({ ...d, task: { ...d.task, [k]: v } }));
  };

  const launch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const payload = { ...data, company: { ...data.company, slug: effectiveSlug } };
      const res = await fetch("/api/orchestration/companies/create-full", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Launch failed");
      router.push(`/companies/${json.company.slug}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLaunching(false);
    }
  }, [data, effectiveSlug, router]);

  const project = data.project ?? { name: "", description: "", repoUrl: "" };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(12,10,9,0.7)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !launching) router.push("/"); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Create new company" style={{ width: "100%", maxWidth: "560px", borderRadius: "16px", border: "1px solid rgba(120,113,108,0.3)", background: "linear-gradient(180deg, rgba(41,37,36,0.95), rgba(20,17,15,0.98))", boxShadow: "0 24px 60px rgba(0,0,0,0.5)", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(120,113,108,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 8px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.35)", background: "rgba(41,37,36,0.6)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "#a8a29e" }}>
              {effectiveSlug ? effectiveSlug.slice(0, 3).toUpperCase() : "NEW"}
            </span>
            <span style={{ fontSize: "13px", color: "#78716c" }}>›</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#f5f5f4" }}>{STEP_LABELS[step]}</span>
            <span style={{ fontSize: "12px", color: "#57534e" }}>{step + 1}/5</span>
          </div>
          <button type="button" onClick={() => { if (!launching) router.push("/"); }} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1px solid rgba(120,113,108,0.25)", background: "transparent", color: "#78716c", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={14} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "20px" }}>
          {/* Step 0: Company */}
          {step === 0 && (
            <>
              <input value={data.company.name} onChange={(e) => setCompanyField("name", e.target.value)} placeholder="Company name" autoFocus style={{ ...inputStyle, fontSize: "20px", fontWeight: 500, border: "none", background: "transparent", padding: "0 0 8px", borderBottom: "1px solid rgba(120,113,108,0.2)", borderRadius: 0 }} />
              <textarea value={data.company.description} onChange={(e) => setCompanyField("description", e.target.value)} placeholder="What does this company do?" rows={3} style={{ ...inputStyle, marginTop: "12px", border: "none", background: "transparent", padding: "0", resize: "vertical", minHeight: "60px", fontSize: "14px", color: data.company.description ? "#d6d3d1" : undefined }} />
              <div style={{ marginTop: "20px", borderTop: "1px solid rgba(120,113,108,0.15)", paddingTop: "16px" }}>
                <label style={labelStyle}>Slug</label>
                <input value={data.company.slug} onChange={(e) => setCompanyField("slug", slugify(e.target.value))} placeholder={slugify(data.company.name) || "auto-generated"} style={inputStyle} />
                <p style={{ marginTop: "4px", fontSize: "11px", color: "#57534e" }}>Workspace: ~/.openclaw/workspaces/{effectiveSlug || "..."}</p>
              </div>
            </>
          )}

          {/* Step 1: Project (optional) */}
          {step === 1 && (
            <>
              <input value={project.name} onChange={(e) => setProjectField("name", e.target.value)} placeholder="Project name (optional)" autoFocus style={{ ...inputStyle, fontSize: "20px", fontWeight: 500, border: "none", background: "transparent", padding: "0 0 8px", borderBottom: "1px solid rgba(120,113,108,0.2)", borderRadius: 0 }} />
              <textarea value={project.description} onChange={(e) => setProjectField("description", e.target.value)} placeholder="What is this project about?" rows={3} style={{ ...inputStyle, marginTop: "12px", border: "none", background: "transparent", padding: "0", resize: "vertical", minHeight: "60px", fontSize: "14px", color: project.description ? "#d6d3d1" : undefined }} />
              <div style={{ marginTop: "20px", borderTop: "1px solid rgba(120,113,108,0.15)", paddingTop: "16px" }}>
                <label style={labelStyle}>Repo URL <span style={{ color: "#57534e" }}>optional</span></label>
                <input value={project.repoUrl} onChange={(e) => setProjectField("repoUrl", e.target.value)} placeholder="https://github.com/org/repo" style={inputStyle} />
              </div>
            </>
          )}

          {/* Step 2: CEO */}
          {step === 2 && (
            <>
              <input value={data.ceo.name} onChange={(e) => setCeoField("name", e.target.value)} placeholder="CEO name" autoFocus style={{ ...inputStyle, fontSize: "20px", fontWeight: 500, border: "none", background: "transparent", padding: "0 0 8px", borderBottom: "1px solid rgba(120,113,108,0.2)", borderRadius: 0 }} />
              <textarea value={data.ceo.guidance} onChange={(e) => setCeoField("guidance", e.target.value)} placeholder="Leadership style, personality, special instructions..." rows={3} style={{ ...inputStyle, marginTop: "12px", border: "none", background: "transparent", padding: "0", resize: "vertical", minHeight: "60px", fontSize: "14px", color: data.ceo.guidance ? "#d6d3d1" : undefined }} />
              <div style={{ marginTop: "20px", borderTop: "1px solid rgba(120,113,108,0.15)", paddingTop: "16px" }}>
                <label style={labelStyle}>Model</label>
                <select value={data.ceo.model} onChange={(e) => setCeoField("model", e.target.value)} style={inputStyle}>
                  {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Step 3: First Task */}
          {step === 3 && (
            <>
              <input value={data.task.title} onChange={(e) => setTaskField("title", e.target.value)} placeholder="First task title" autoFocus style={{ ...inputStyle, fontSize: "20px", fontWeight: 500, border: "none", background: "transparent", padding: "0 0 8px", borderBottom: "1px solid rgba(120,113,108,0.2)", borderRadius: 0 }} />
              <textarea value={data.task.description} onChange={(e) => setTaskField("description", e.target.value)} placeholder="Task description..." rows={4} style={{ ...inputStyle, marginTop: "12px", border: "none", background: "transparent", padding: "0", resize: "vertical", minHeight: "80px", fontSize: "14px", color: data.task.description ? "#d6d3d1" : undefined }} />
            </>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div style={{ display: "grid", gap: "12px" }}>
              {[
                { label: "Company", value: data.company.name, sub: effectiveSlug },
                { label: "Project", value: data.project?.name || "Skipped", sub: data.project?.repoUrl || undefined },
                { label: "CEO", value: data.ceo.name, sub: MODEL_OPTIONS.find((m) => m.value === data.ceo.model)?.label },
                { label: "First Task", value: data.task.title },
              ].map((item) => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid rgba(120,113,108,0.1)" }}>
                  <span style={{ fontSize: "12px", color: "#78716c", textTransform: "uppercase", letterSpacing: "0.1em" }}>{item.label}</span>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: "13px", color: "#f5f5f4" }}>{item.value}</span>
                    {item.sub ? <span style={{ display: "block", fontSize: "11px", color: "#57534e" }}>{item.sub}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error ? <p style={{ marginTop: "12px", fontSize: "13px", color: "#d6d3d1" }}>{error}</p> : null}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderTop: "1px solid rgba(120,113,108,0.2)" }}>
          <div>
            {step > 0 && (
              <button type="button" onClick={back} disabled={launching} style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", fontSize: "13px", color: "#78716c", cursor: "pointer" }}>
                <ChevronLeft size={14} /> Back
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {step === 1 && (
              <button type="button" onClick={skipProject} style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "none", border: "none", fontSize: "13px", color: "#57534e", cursor: "pointer" }}>
                <SkipForward size={12} /> Skip
              </button>
            )}
            {step < 4 && (
              <button type="button" onClick={next} disabled={!canAdvance} style={{ padding: "8px 20px", borderRadius: "10px", border: "1px solid rgba(120,113,108,0.4)", background: canAdvance ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.4)", fontSize: "13px", fontWeight: 600, color: canAdvance ? "#f5f5f4" : "#57534e", cursor: canAdvance ? "pointer" : "default", transition: "all 120ms ease" }}>
                Next <ChevronRight size={14} style={{ display: "inline", verticalAlign: "middle" }} />
              </button>
            )}
            {step === 4 && (
              <button type="button" onClick={() => void launch()} disabled={launching} style={{ padding: "8px 20px", borderRadius: "10px", border: "1px solid rgba(120,113,108,0.4)", background: "rgba(168,162,158,0.2)", fontSize: "13px", fontWeight: 600, color: "#f5f5f4", cursor: "pointer", transition: "all 120ms ease", opacity: launching ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: "6px" }}>
                {launching ? <><Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Creating...</> : <><Rocket size={14} /> Launch company</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
