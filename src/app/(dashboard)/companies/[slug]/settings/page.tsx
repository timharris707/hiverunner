"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Settings } from "lucide-react";

import { CompanyErrorState, DeleteCompanyModal } from "@/components/company/company-ui";
import { getCompanyTheme, listCompanies } from "@/lib/orchestration/client";
import type { CompanyTheme, OrchestrationCompany } from "@/lib/orchestration/types";
import { P, color, type as T, space, radius, font } from "@/lib/ui/tokens";
import { PageHeader, Section, PropRow, ActionButton, InfoNote } from "@/lib/ui/primitives";

// Use stable company ID for protection checks, not mutable slug.
const PROTECTED_COMPANY_IDS = new Set(["6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f"]);

/* ── Types for execution / heartbeat APIs ── */

type ExecAgent = { agentId: string; agentName?: string; name?: string; modelId: string; timeoutSeconds: number | null; graceSeconds: number | null };
type ExecSettings = { agents?: ExecAgent[] };
type HbAgent = { agentId: string; agentName?: string; name?: string; heartbeatEnabled: boolean; intervalSeconds: number };
type HbSettings = { agents?: HbAgent[] };

/* ── Page ── */

export default function CompanySettingsPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [theme, setTheme] = useState<CompanyTheme | null>(null);
  const [execSettings, setExecSettings] = useState<ExecSettings | null>(null);
  const [hbSettings, setHbSettings] = useState<HbSettings | null>(null);
  const [loading, setLoading] = useState(true);

  /* profile draft */
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  /* hiring toggle */
  const [hiringApprovalRequired, setHiringApprovalRequired] = useState(true);

  /* danger zone */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isProtected = company ? PROTECTED_COMPANY_IDS.has(company.id) : false;
  const profileDirty = useMemo(() => {
    if (!company) return false;
    return name.trim() !== company.name || description.trim() !== (company.description ?? "");
  }, [company, name, description]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [companies, themeData, execResp, hbResp] = await Promise.all([
          listCompanies(),
          getCompanyTheme(slug),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/execution`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/heartbeats`).then((r) => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        const c = companies.find((e) => e.slug === slug) ?? null;
        setCompany(c);
        setTheme(themeData);
        setExecSettings(execResp);
        setHbSettings(hbResp);
        if (c) { setName(c.name); setDescription(c.description ?? ""); }
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug]);

  /* ── handlers ── */

  const handleSaveProfile = async () => {
    if (!company) return;
    const nextName = name.trim();
    if (nextName.length < 2) { setError("Company name must be at least 2 characters."); return; }
    setProfileSaving(true); setError(null); setNotice(null);
    try {
      const r = await fetch(`/api/orchestration/companies/${encodeURIComponent(company.slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName, description: description.trim() }),
      });
      if (!r.ok) throw new Error("save_failed");
      const body = (await r.json()) as { company?: OrchestrationCompany };
      const next = body.company ?? { ...company, name: nextName, description: description.trim() };
      setCompany(next); setName(next.name); setDescription(next.description ?? "");
      setNotice("Company profile saved.");
    } catch { setError("Could not save company profile."); }
    finally { setProfileSaving(false); }
  };

  const handleTogglePause = async () => {
    if (!company) return;
    setPauseBusy(true); setError(null); setNotice(null);
    const next = company.status === "paused" ? "active" : "paused";
    try {
      const r = await fetch(`/api/orchestration/companies/${company.slug}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) throw new Error("failed");
      setCompany((p) => p ? { ...p, status: next } : null);
      setNotice(next === "paused" ? "Company paused." : "Company resumed.");
    } catch { setError("Could not update company status."); }
    finally { setPauseBusy(false); }
  };

  const handleDelete = async () => {
    if (!company || isProtected) return;
    setDeleteBusy(true);
    try {
      const r = await fetch(`/api/orchestration/companies/${company.slug}?hard=true`, { method: "DELETE" });
      if (!r.ok) throw new Error("failed");
      setDeleteOpen(false); router.push("/companies");
    } catch { setError("Could not delete company."); setDeleteOpen(false); }
    finally { setDeleteBusy(false); }
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="Could not resolve this company." href="/companies" />;
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: radius.md, border: `0.5px solid rgba(120,113,108,0.3)`,
    background: "rgba(41,37,36,0.4)", padding: `${space.md}px ${space.lg}px`,
    fontSize: T.body.size, color: color.text, outline: "none",
  };

  const execAgents = execSettings?.agents ?? [];
  const hbAgents = hbSettings?.agents ?? [];

  return (
    <div style={{ padding: `${space.lg}px ${space.xl}px`, maxWidth: 960, color: color.text, fontSize: T.body.size }}>
      <PageHeader icon={<Settings size={16} />} title="Company Settings" />

      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}

      {loading ? (
        <p style={{ fontSize: 13, color: P.muted }}>Loading settings...</p>
      ) : (
        <>
          {/* ── GENERAL ── */}
          <Section title="General">
            <FieldLabel label="Company name" />
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Company name" />
            <div style={{ height: 12 }} />
            <FieldLabel label="Description" />
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional company description"
              rows={3} style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            />
            <div style={{ marginTop: 12 }}>
              <button type="button" disabled={!profileDirty || profileSaving} onClick={() => void handleSaveProfile()} style={{
                padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: profileDirty ? "pointer" : "default",
                border: `0.5px solid ${P.cardBorder}`, background: profileDirty ? "rgba(120,113,108,0.15)" : "transparent",
                color: profileDirty ? P.text : P.muted, opacity: profileDirty ? 1 : 0.5,
              }}>{profileSaving ? "Saving..." : "Save changes"}</button>
            </div>
          </Section>

          {/* ── APPEARANCE ── */}
          <Section title="Appearance">
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 10, background: "rgba(99,102,241,0.2)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, fontWeight: 700, color: "#a5b4fc", border: "0.5px solid rgba(99,102,241,0.3)",
              }}>
                {company?.name?.charAt(0)?.toUpperCase() ?? "C"}
              </div>
              <div>
                <FieldLabel label="Logo" />
                <p style={{ fontSize: 12, color: P.muted, margin: 0 }}>Company logo upload not yet available.</p>
              </div>
            </div>
            <PropRow label="Brand color">
              <span style={{ display: "inline-block", width: 20, height: 20, borderRadius: 4, background: "#6366f1", marginRight: 8, verticalAlign: "middle" }} />
              <span style={{ fontSize: 13, color: P.textSec }}>Auto</span>
            </PropRow>
          </Section>

          {/* ── HIRING ── */}
          <Section title="Hiring">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: P.text }}>Require board approval for new hires</span>
              <Toggle enabled={hiringApprovalRequired} onToggle={() => setHiringApprovalRequired(!hiringApprovalRequired)} />
            </div>
          </Section>

          {/* ── INVITES ── */}
          <Section title="Invites">
            <p style={{ fontSize: 13, color: P.textSec, marginBottom: 10 }}>Generate an OpenClaw agent invite snippet.</p>
            <button type="button" style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500,
              border: `0.5px solid ${P.cardBorder}`, background: "rgba(120,113,108,0.1)",
              color: P.text, cursor: "pointer",
            }}>Generate OpenClaw Invite Prompt</button>
          </Section>

          {/* ── COMPANY PACKAGES ── */}
          <Section title="Company Packages">
            <p style={{ fontSize: T.body.size, color: color.textSecondary, lineHeight: T.body.lineHeight }}>
              Export and import company data as structured JSON packages from the{" "}
              <a
                href={`/companies/${encodeURIComponent(slug)}/org`}
                style={{ color: color.text, textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Org Chart
              </a>{" "}
              page, or use the direct links below.
            </p>
            <div style={{ display: "flex", gap: space.sm, marginTop: space.md }}>
              <ActionButton label="Export" href={`/companies/${encodeURIComponent(slug)}/export`} />
              <ActionButton label="Import" href={`/companies/${encodeURIComponent(slug)}/import`} />
            </div>
          </Section>

          {/* ── EXECUTION DEFAULTS ── */}
          <Section title="Execution Defaults">
            {execAgents.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {execAgents.map((a) => (
                  <div key={a.agentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `0.5px solid ${P.cardBorder}` }}>
                    <span style={{ fontSize: 13, color: P.text }}>{a.agentName ?? a.name ?? a.agentId}</span>
                    <span style={{ fontSize: 11, color: P.muted, fontFamily: "var(--font-mono, monospace)" }}>
                      {a.modelId}{a.timeoutSeconds != null ? ` · ${a.timeoutSeconds}s` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: P.muted }}>No per-agent execution overrides configured.</p>
            )}
          </Section>

          {/* ── HEARTBEAT & GOVERNANCE ── */}
          <Section title="Heartbeat & Governance">
            {hbAgents.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {hbAgents.map((a) => (
                  <div key={a.agentId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: `0.5px solid ${P.cardBorder}` }}>
                    <span style={{ fontSize: 13, color: P.text }}>{a.agentName ?? a.name ?? a.agentId}</span>
                    <span style={{ fontSize: 11, color: P.muted }}>
                      {a.heartbeatEnabled ? "on" : "off"} · {Math.round(a.intervalSeconds / 60)}m interval
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: 13, color: P.muted }}>No heartbeat policies configured.</p>
            )}
          </Section>

          {/* ── WORKSPACE ── */}
          <Section title="Workspace">
            <PropRow label="Workspace root"><span style={{ fontSize: 12, fontFamily: "var(--font-mono, monospace)", color: P.textSec }}>{company?.workspace?.root ?? "—"}</span></PropRow>
            <PropRow label="Source"><span style={{ fontSize: 13, color: P.textSec }}>{company?.workspace?.source ?? "—"}</span></PropRow>
            <PropRow label="Projects"><span style={{ fontSize: 13, color: P.text, fontWeight: 600 }}>{company?.stats?.projects ?? 0}</span></PropRow>
            <PropRow label="Agents"><span style={{ fontSize: 13, color: P.text, fontWeight: 600 }}>{company?.stats?.agents ?? 0}</span></PropRow>
          </Section>

          {/* ── DANGER ZONE ── */}
          <div style={{
            marginTop: 24, padding: 20, borderRadius: 10,
            border: "0.5px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.04)",
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "#ef4444", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} /> Danger Zone
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: P.textSec }}>
              Archive this company to hide it from the sidebar. This persists in the database.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" onClick={() => void handleTogglePause()} disabled={pauseBusy} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `0.5px solid ${P.cardBorderHover}`, background: "rgba(255,255,255,0.08)", color: P.text,
              }}>{pauseBusy ? "Updating..." : company?.status === "paused" ? "Resume Company" : "Pause Company"}</button>
              <button type="button" onClick={() => setDeleteOpen(true)} disabled={isProtected} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: "0.5px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.08)", color: "#ef4444",
                cursor: isProtected ? "not-allowed" : "pointer", opacity: isProtected ? 0.5 : 1,
              }}>{isProtected ? "Delete disabled for core company" : "Archive company"}</button>
            </div>
          </div>
        </>
      )}

      <DeleteCompanyModal open={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} companyName={company?.name ?? slug} busy={deleteBusy} />
    </div>
  );
}

/* ── Sub-components ── */

function FieldLabel({ label }: { label: string }) {
  return <p style={{ fontSize: T.bodySmall.size, color: color.textMuted, marginBottom: space.xs }}>{label}</p>;
}

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} style={{
      width: 40, height: 22, borderRadius: 11, padding: 2, cursor: "pointer",
      background: enabled ? "rgba(34,197,94,0.5)" : "rgba(120,113,108,0.3)",
      border: "none", display: "flex", alignItems: "center",
      justifyContent: enabled ? "flex-end" : "flex-start",
      transition: "background 150ms ease",
    }}>
      <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", transition: "transform 150ms ease" }} />
    </button>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: "error" | "success" }) {
  const s = tone === "error"
    ? { border: `0.5px solid rgba(239,68,68,0.3)`, background: color.negativeSoft, color: "#fca5a5" }
    : { border: `0.5px solid rgba(34,197,94,0.3)`, background: color.positiveSoft, color: "#86efac" };
  return <div style={{ ...s, borderRadius: radius.md, padding: `${space.sm}px ${space.lg}px`, fontSize: T.body.size, marginBottom: space.lg }}>{children}</div>;
}
