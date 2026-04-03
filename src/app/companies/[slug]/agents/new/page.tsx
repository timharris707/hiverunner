"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AlertCircle, Loader2, UserPlus, X } from "lucide-react";

const MODEL_OPTIONS = [
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "openai-codex/gpt-5.4", label: "GPT-5.4" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
];

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

export default function CreateCompanyAgentPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("anthropic/claude-sonnet-4-6");
  const [reportsTo, setReportsTo] = useState("Henry");
  const [personality, setPersonality] = useState("");
  const [mission, setMission] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterOptions, setRosterOptions] = useState<Array<{ id: string; name: string; openclawAgentId?: string }>>([]);

  const canSubmit = useMemo(() => name.trim().length > 0 && role.trim().length > 0, [name, role]);
  const closeHref = `/companies/${encodeURIComponent(slug)}/team`;

  useEffect(() => {
    let cancelled = false;
    const loadRoster = async () => {
      try {
        const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents?syncOpenClaw=false`, { cache: "no-store" });
        const json = (await response.json().catch(() => ({}))) as { agents?: Array<{ id?: string; name?: string; openclawAgentId?: string }> };
        if (!response.ok || cancelled) return;
        const options = (json.agents ?? [])
          .map((a) => ({ id: String(a.id ?? ""), name: String(a.name ?? ""), openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined }))
          .filter((a) => a.id && a.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setRosterOptions(options);
      } catch { if (!cancelled) setRosterOptions([]); }
    };
    if (slug) void loadRoster();
    return () => { cancelled = true; };
  }, [slug]);

  const onSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents/hire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), role: role.trim(), model,
          reportsTo: reportsTo.trim() || "Henry",
          personality: personality.trim(), mission: mission.trim(),
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error || "Failed to create agent");
      router.push(closeHref);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "rgba(12,10,9,0.72)", backdropFilter: "blur(8px)" }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(12,10,9,0.22), rgba(12,10,9,0.7))", pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "640px" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "24px" }}>
          <div>
            <p style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.22em", color: "#78716c" }}>
              {slug.toUpperCase().slice(0, 3)} · New Agent
            </p>
            <h1 style={{ marginTop: "8px", fontSize: "28px", fontWeight: 600, letterSpacing: "-0.01em", color: "#f5f5f4" }}>
              Add a New Agent
            </h1>
            <p style={{ marginTop: "8px", maxWidth: "480px", fontSize: "14px", color: "#78716c" }}>
              Create a runtime-backed company agent with its own workspace, identity files, and orchestration record.
            </p>
          </div>
          <Link
            href={closeHref}
            style={{ width: "40px", height: "40px", borderRadius: "12px", border: "1px solid rgba(120,113,108,0.35)", background: "rgba(28,25,23,0.82)", color: "#a8a29e", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <X size={18} />
          </Link>
        </div>

        {/* card */}
        <div style={{ borderRadius: "24px", border: "1px solid rgba(120,113,108,0.25)", background: "linear-gradient(165deg, rgba(41,37,36,0.96), rgba(12,10,9,0.99))", padding: "24px", boxShadow: "0 30px 80px rgba(12,10,9,0.65)" }}>
          <Field label="Agent Name" required>
            <input style={inputStyle} placeholder="e.g. Pixel" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>

          <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr 1fr", marginTop: "0" }}>
            <Field label="Role" required>
              <input style={inputStyle} placeholder="e.g. Full-Stack Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
            </Field>
            <Field label="Reports To" hint="Select from the company roster.">
              <select style={inputStyle} value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
                <option value="">Unassigned</option>
                <option value="Henry">Henry</option>
                {rosterOptions.map((a) => <option key={a.id} value={a.openclawAgentId || a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: "grid", gap: "16px", gridTemplateColumns: "1fr 1fr", marginTop: "0" }}>
            <Field label="Model">
              <select style={inputStyle} value={model} onChange={(e) => setModel(e.target.value)}>
                {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Agent Focus">
              <input style={inputStyle} placeholder="UI, frontend, polishing, product feel" value={personality} onChange={(e) => setPersonality(e.target.value)} />
            </Field>
          </div>

          <Field label="Mission / Operating Notes">
            <textarea style={{ ...inputStyle, minHeight: "120px", resize: "vertical" }} placeholder="What should this agent own? What kind of work should they do?" value={mission} onChange={(e) => setMission(e.target.value)} />
          </Field>

          {error ? (
            <div style={{ marginTop: "16px", borderRadius: "12px", border: "1px solid rgba(120,113,108,0.3)", background: "rgba(28,25,23,0.8)", padding: "12px 14px", fontSize: "13px", color: "#d6d3d1", display: "flex", alignItems: "flex-start", gap: "8px" }}>
              <AlertCircle size={16} style={{ marginTop: "2px", flexShrink: 0 }} />
              {error}
            </div>
          ) : null}

          {/* footer */}
          <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(120,113,108,0.2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Link href={closeHref} style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#78716c", textDecoration: "none" }}>
              <UserPlus size={14} /> Back to Team
            </Link>
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={!canSubmit || saving}
              style={{
                display: "inline-flex", alignItems: "center", gap: "8px",
                padding: "10px 20px", borderRadius: "12px", border: "none",
                background: canSubmit ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.5)",
                fontSize: "13px", fontWeight: 600,
                color: canSubmit ? "#f5f5f4" : "#57534e",
                cursor: canSubmit ? "pointer" : "default",
                opacity: saving ? 0.6 : 1,
                transition: "all 120ms ease",
              }}
            >
              {saving ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <UserPlus size={14} />}
              {saving ? "Creating..." : "Create Agent"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
