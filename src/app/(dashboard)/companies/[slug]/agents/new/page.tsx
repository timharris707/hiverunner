"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { X } from "lucide-react";

import {
  AgentRuntimeModelFields,
  type AgentRuntimeSelection,
} from "@/components/orchestration/AgentRuntimeModelFields";
import {
  ReportsToPicker,
  type ReportsToAgentOption,
} from "@/components/orchestration/ReportsToPicker";
import {
  AgentIdentityFields,
  type AgentIdentityDraft,
} from "@/components/orchestration/AgentIdentityFields";
import CompanyTeamPage from "@/app/(dashboard)/companies/[slug]/team/page";
import { buildCanonicalTeamPath } from "@/lib/orchestration/route-paths";

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: "10px",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  padding: "10px 14px",
  fontSize: "13px",
  color: "var(--text-primary)",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--text-secondary)",
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
  const agentsPath = buildCanonicalTeamPath(code);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntimeSelection | null>(null);
  const [reportsTo, setReportsTo] = useState("");
  const [identity, setIdentity] = useState<AgentIdentityDraft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rosterOptions, setRosterOptions] = useState<ReportsToAgentOption[]>([]);

  const canSubmit = useMemo(
    () => name.trim().length > 0 && Boolean(runtime),
    [name, runtime],
  );

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !saving) router.replace(agentsPath); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentsPath, saving, router]);

  useEffect(() => {
    let cancelled = false;
    const loadRoster = async () => {
      try {
        const res = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/agents?syncOpenClaw=false`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { agents?: Array<{ id?: string; name?: string; avatar?: string; emoji?: string; openclawAgentId?: string }> };
        if (!res.ok || cancelled) return;
        setRosterOptions(
          (json.agents ?? [])
            .map((a) => ({
              id: String(a.id ?? ""),
              name: String(a.name ?? ""),
              avatar: a.avatar ? String(a.avatar) : undefined,
              emoji: a.emoji ? String(a.emoji) : undefined,
              openclawAgentId: a.openclawAgentId ? String(a.openclawAgentId) : undefined,
            }))
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
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim() || "General",
          model,
          runtimeProvider: runtime?.provider,
          runtimeSlug: runtime?.runtimeSlug,
          runtimeDisplayName: runtime?.displayName,
          runtimeCommand: runtime?.command,
          runtimeCommandPath: runtime?.commandPath,
          runtimeSource: runtime?.source,
          reportsTo: reportsTo.trim() || undefined,
          ...identity,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to create agent");
      router.replace(agentsPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <CompanyTeamPage />
      <div
        style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--modal-backdrop)", backdropFilter: "blur(4px)" }}
        onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) router.replace(agentsPath); }}
      >
        <div role="dialog" aria-modal="true" aria-label="Create new agent" style={{ width: "100%", maxWidth: "560px", borderRadius: "16px", border: "1px solid var(--border)", background: "var(--modal-glass)", boxShadow: "var(--shadow-glass)", overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderTop: "none", borderBottom: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 8px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-secondary)" }}>
              {code}
            </span>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>›</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>New agent</span>
          </div>
          <button type="button" onClick={() => { if (!saving) router.replace(agentsPath); }} style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <X size={14} />
          </button>
        </div>

        {/* body */}
        <div style={{ padding: "20px" }}>
          {/* name — large, like project name */}
          <input aria-label="Agent name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" autoFocus style={{ ...inputStyle, fontSize: "20px", fontWeight: 500, border: "none", borderTop: "none", borderBottom: "none", boxShadow: "none", background: "transparent", padding: 0, borderRadius: 0 }} />

          {/* role */}
          <input aria-label="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role (optional)" style={{ ...inputStyle, marginTop: "12px", border: "none", borderTop: "none", borderBottom: "none", boxShadow: "none", background: "transparent", padding: 0, borderRadius: 0, fontSize: "14px" }} />

          <div style={{ marginTop: "22px", borderTop: "none", borderBottom: "none", display: "grid", gap: "14px" }}>
            <AgentRuntimeModelFields
              companySlug={slug}
              model={model}
              onModelChange={setModel}
              runtime={runtime}
              onRuntimeChange={setRuntime}
            />

            <div>
              <label style={labelStyle}>Reports to</label>
              <ReportsToPicker value={reportsTo} onChange={setReportsTo} agents={rosterOptions} />
            </div>

            <AgentIdentityFields
              companySlug={slug}
              agentName={name}
              agentRole={role}
              value={identity}
              onChange={setIdentity}
            />
          </div>

          {error ? <p style={{ marginTop: "12px", fontSize: "13px", color: "var(--negative)" }}>{error}</p> : null}
        </div>

        {/* footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", padding: "8px 20px 18px", borderTop: "none", borderBottom: "none" }}>
          <button type="button" onClick={() => { if (!saving) router.replace(agentsPath); }} disabled={saving} style={{ padding: "8px 18px", borderRadius: "10px", border: "1px solid var(--border)", background: "transparent", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>
            Cancel
          </button>
          <button type="button" onClick={() => void onSubmit()} disabled={saving || !canSubmit} style={{ padding: "8px 20px", borderRadius: "10px", border: "1px solid var(--border)", background: canSubmit ? "color-mix(in srgb, var(--text-primary) 72%, var(--surface))" : "var(--surface-hover)", fontSize: "13px", fontWeight: 600, color: canSubmit ? "var(--surface)" : "var(--text-muted)", cursor: canSubmit ? "pointer" : "default", transition: "all 120ms ease", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Creating..." : "Create agent"}
          </button>
        </div>
        </div>
      </div>
    </>
  );
}
