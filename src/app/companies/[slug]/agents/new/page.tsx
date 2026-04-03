"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { X } from "lucide-react";

const MODEL_OPTIONS = [
  { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "openai-codex/gpt-5.4", label: "GPT-5.4" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
];

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

export default function CreateCompanyAgentPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";
  const code = slug.slice(0, 3).toUpperCase();

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

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) router.back(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, router]);

  useEffect(() => {
    let cancelled = false;
    const loadRoster = async () => {
      try {
        const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents?syncOpenClaw=false`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { agents?: Array<{ id?: string; name?: string; openclawAgentId?: string }> };
        if (!res.ok || cancelled) return;
        setRosterOptions(
          (json.agents ?? [])
            .map((a) => ({ id: String(a.id ?? ""), name: String(a.name ?? ""), openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined }))
            .filter((a) => a.id && a.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        );
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
      const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents/hire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role: role.trim(), model, reportsTo: reportsTo.trim() || "Henry", personality: personality.trim(), mission: mission.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to create agent");
      router.push(`/companies/${encodeURIComponent(slug)}/team`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(12,10,9,0.7)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) router.back(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Create new agent" style={{ width: "100%", maxWidth: "560px", borderRadius: "16px", border: "1px solid rgba(120,113,108,0.3)", background: "linear-gradient(180deg, rgba(41,37,36,0.95), rgba(20,17,15,0.98))", boxShadow: "0 24px 60px rgba(0,0,0,0.5)", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(120,113,108,0.2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 8px", borderRadius: "6px", border: "1px solid rgba(120,113,108,0.35)", background: "rgba(41,37,36,0.6)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "#a8a29e" }}>
              {code}
            </span>
            <span style={{ fontSize: "13px", color: "#78716c" }}>›</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "#f5f5f4" }}>New agent</span>
          </div>
          <button type="button" onClick={() => { if (!saving) router.back(); }} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1px solid rgba(120,113,108,0.25)", background: "transparent", color: "#78716c", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={14} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "20px" }}>
          {/* name — large, like project name */}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" autoFocus style={{ ...inputStyle, fontSize: "20px", fontWeight: 500, border: "none", background: "transparent", padding: "0 0 8px", borderBottom: "1px solid rgba(120,113,108,0.2)", borderRadius: 0, color: name ? "#f5f5f4" : undefined }} />

          {/* role */}
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (e.g. Full-Stack Engineer)" style={{ ...inputStyle, marginTop: "12px", border: "none", background: "transparent", padding: "0 0 8px", borderBottom: "1px solid rgba(120,113,108,0.15)", borderRadius: 0, fontSize: "14px", color: role ? "#d6d3d1" : undefined }} />

          {/* mission */}
          <textarea value={mission} onChange={(e) => setMission(e.target.value)} placeholder="Mission / operating notes..." rows={3} style={{ ...inputStyle, marginTop: "12px", border: "none", background: "transparent", padding: "0", resize: "vertical", minHeight: "60px", fontSize: "14px", color: mission ? "#d6d3d1" : undefined }} />

          <div style={{ marginTop: "20px", borderTop: "1px solid rgba(120,113,108,0.15)", paddingTop: "16px", display: "grid", gap: "14px" }}>
            {/* model + reports to side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label style={labelStyle}>Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle}>
                  {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Reports to</label>
                <select value={reportsTo} onChange={(e) => setReportsTo(e.target.value)} style={inputStyle}>
                  <option value="">Unassigned</option>
                  <option value="Henry">Henry</option>
                  {rosterOptions.map((a) => <option key={a.id} value={a.openclawAgentId || a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            {/* focus */}
            <div>
              <label style={labelStyle}>Focus <span style={{ color: "#57534e" }}>optional</span></label>
              <input value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="UI, frontend, polishing, product feel" style={inputStyle} />
            </div>
          </div>

          {error ? <p style={{ marginTop: "12px", fontSize: "13px", color: "#d6d3d1" }}>{error}</p> : null}
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "14px 20px", borderTop: "1px solid rgba(120,113,108,0.2)" }}>
          <button type="button" onClick={() => void onSubmit()} disabled={saving || !canSubmit} style={{ padding: "8px 20px", borderRadius: "10px", border: "1px solid rgba(120,113,108,0.4)", background: canSubmit ? "rgba(168,162,158,0.2)" : "rgba(41,37,36,0.4)", fontSize: "13px", fontWeight: 600, color: canSubmit ? "#f5f5f4" : "#57534e", cursor: canSubmit ? "pointer" : "default", transition: "all 120ms ease", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Creating..." : "Create agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
