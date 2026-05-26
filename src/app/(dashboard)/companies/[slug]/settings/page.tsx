"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, Archive, Settings, Trash2 } from "lucide-react";

import { CompanyErrorState, DeleteCompanyModal } from "@/components/company/company-ui";
import { getCompanyExecutionHives, listCompanies, type CompanyExecutionHivesPayload } from "@/lib/orchestration/client";
import { formatOrchestrationModeLabel } from "@/lib/orchestration/execution-hives";
import type { OrchestrationCompany, TaskExecutionEngine } from "@/lib/orchestration/types";
import { buildCanonicalCompanyPath } from "@/lib/orchestration/route-paths";
import { P, color, type as T, space, radius } from "@/lib/ui/tokens";
import { PageHeader, Section, PropRow, ActionButton, InfoNote, Badge } from "@/lib/ui/primitives";

// Use stable company ID for protection checks, not mutable slug.
const PROTECTED_COMPANY_IDS = new Set(["6f0c7f7d-8ea8-4f7d-a2e6-7f5375dfef6f"]);
const EXECUTION_ENGINE_OPTIONS: Array<{ value: TaskExecutionEngine; label: string }> = [
  { value: "hiverunner", label: "HiveRunner Native" },
  { value: "symphony", label: "Symphony" },
  { value: "manual", label: "Manual / Operator Controlled" },
];

/* ── Types for execution / heartbeat APIs ── */

type ExecAgent = { agentId: string; agentName?: string; name?: string; modelId: string; timeoutSeconds: number | null; graceSeconds: number | null };
type ExecSettings = { agents?: ExecAgent[] };
type HbAgent = { agentId: string; agentName?: string; name?: string; heartbeatEnabled: boolean; intervalSeconds: number };
type HbSettings = { agents?: HbAgent[] };
type HiringSettings = { hiring?: { autoApproveNewHires?: boolean } };
type RuntimeGovernanceSettings = { runtime?: { requireProtectedRuntimeApprovals?: boolean } };
type SymphonySettingsView = {
  lane: "dev" | "stable";
  available: boolean;
  reason?: string;
  tracker: {
    enabled: boolean;
    authRequired: boolean;
    schema?: string;
  };
  runner: {
    dryRun: boolean;
    defaultProvider?: "codex";
    providerLabel?: string;
    execCommandConfigured: boolean;
    codexCommandConfigured: boolean;
    providers?: Array<{ provider: string; label: string; status: "available" | "planned" }>;
  };
  nextRestart: {
    trackerEnabled: boolean;
    trackerTokenConfigured: boolean;
    dryRun: boolean;
    execCommandConfigured: boolean;
    codexCommandConfigured: boolean;
  };
  restartQueued: boolean;
};
type DevExecutionCompanyIdentity = { id: string; slug: string; code: string; name: string };
type DevExecutionLease = {
  company: DevExecutionCompanyIdentity;
  enabledAt: string;
  enabledUntil: string;
  remainingSeconds: number;
  indefinite: boolean;
  enabledBy?: string;
  note?: string;
};
type DevExecutionTestModeView = {
  lane: "dev" | "stable";
  gateEnabled: boolean;
  available: boolean;
  reason?: string;
  company: DevExecutionCompanyIdentity;
  activeLease: DevExecutionLease | null;
  activeForCurrentCompany: boolean;
  activeCompany: DevExecutionCompanyIdentity | null;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
};

function textSetting(value: unknown, fallback = "Not configured"): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function modelRoutingLabel(value: unknown): string {
  const raw = textSetting(value, "Runtime managed");
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/^Hive Managed$/, "Hive managed")
    .replace(/^Runtime Managed$/, "Runtime managed");
}

function formatLeaseExpiry(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRemainingSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return "expired";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  }
  return `${Math.max(1, minutes)}m remaining`;
}

/* ── Page ── */

export default function CompanySettingsPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [execSettings, setExecSettings] = useState<ExecSettings | null>(null);
  const [hbSettings, setHbSettings] = useState<HbSettings | null>(null);
  const [symphonySettings, setSymphonySettings] = useState<SymphonySettingsView | null>(null);
  const [devExecutionTestMode, setDevExecutionTestMode] = useState<DevExecutionTestModeView | null>(null);
  const [executionHives, setExecutionHives] = useState<CompanyExecutionHivesPayload | null>(null);
  const [loading, setLoading] = useState(true);

  /* profile draft */
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [defaultExecutionEngine, setDefaultExecutionEngine] = useState<TaskExecutionEngine>("hiverunner");
  const [profileSaving, setProfileSaving] = useState(false);

  /* hiring governance */
  const [autoApproveNewHires, setAutoApproveNewHires] = useState(false);
  const [hiringSaving, setHiringSaving] = useState(false);
  const [requireProtectedRuntimeApprovals, setRequireProtectedRuntimeApprovals] = useState(true);
  const [runtimeGovernanceSaving, setRuntimeGovernanceSaving] = useState(false);

  /* danger zone */
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [symphonyBusy, setSymphonyBusy] = useState(false);
  const [devExecutionBusy, setDevExecutionBusy] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isProtected = company ? PROTECTED_COMPANY_IDS.has(company.id) : false;
  const companyCode = company?.code ?? slug;
  const activeHive = executionHives?.activeHive ?? executionHives?.hives.find((hive) => hive.isActive) ?? null;
  const executionDefaults = executionHives?.executionDefaults ?? {};
  const profileDirty = useMemo(() => {
    if (!company) return false;
    return (
      name.trim() !== company.name ||
      description.trim() !== (company.description ?? "") ||
      ownerName.trim() !== (company.owner?.displayName ?? "") ||
      ownerEmail.trim().toLowerCase() !== (company.owner?.email ?? "").toLowerCase() ||
      defaultExecutionEngine !== (company.defaultExecutionEngine ?? "hiverunner")
    );
  }, [company, name, description, ownerName, ownerEmail, defaultExecutionEngine]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [companies, execResp, hbResp, hiringResp, runtimeGovernanceResp, symphonySettingsResp, devExecutionResp, hivesResp] = await Promise.all([
          listCompanies(),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/execution`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/heartbeats`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/hiring`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/runtime-governance`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/symphony`).then((r) => r.ok ? r.json() : null),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/dev-execution-test-mode`).then((r) => r.ok ? r.json() : null),
          getCompanyExecutionHives(slug),
        ]);
        if (cancelled) return;
        const normalizedSlug = slug.toLowerCase();
        const c = companies.find((e) => e.slug.toLowerCase() === normalizedSlug || e.code.toLowerCase() === normalizedSlug) ?? null;
        setCompany(c);
        setExecSettings(execResp);
        setHbSettings(hbResp);
        setAutoApproveNewHires(Boolean((hiringResp as HiringSettings | null)?.hiring?.autoApproveNewHires));
        setRequireProtectedRuntimeApprovals(
          (runtimeGovernanceResp as RuntimeGovernanceSettings | null)?.runtime?.requireProtectedRuntimeApprovals !== false,
        );
        setSymphonySettings(symphonySettingsResp as SymphonySettingsView | null);
        setDevExecutionTestMode(devExecutionResp as DevExecutionTestModeView | null);
        setExecutionHives(hivesResp);
        if (c) {
          setName(c.name);
          setDescription(c.description ?? "");
          setOwnerName(c.owner?.displayName ?? "");
          setOwnerEmail(c.owner?.email ?? "");
          setDefaultExecutionEngine(c.defaultExecutionEngine ?? "hiverunner");
        }
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
    const nextOwnerName = ownerName.trim();
    const nextOwnerEmail = ownerEmail.trim().toLowerCase();
    if (nextOwnerName.length < 1) { setError("Owner name is required."); return; }
    if (!nextOwnerEmail.includes("@")) { setError("Owner email is required."); return; }
    setProfileSaving(true); setError(null); setNotice(null);
    try {
      const r = await fetch(`/api/orchestration/companies/${encodeURIComponent(company.slug)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          description: description.trim(),
          defaultExecutionEngine,
          owner: { displayName: nextOwnerName, email: nextOwnerEmail },
        }),
      });
      if (!r.ok) throw new Error("save_failed");
      const body = (await r.json()) as { company?: OrchestrationCompany };
      const next = body.company ?? { ...company, name: nextName, description: description.trim() };
      setCompany(next);
      setName(next.name);
      setDescription(next.description ?? "");
      setOwnerName(next.owner?.displayName ?? nextOwnerName);
      setOwnerEmail(next.owner?.email ?? nextOwnerEmail);
      setDefaultExecutionEngine(next.defaultExecutionEngine ?? defaultExecutionEngine);
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
      const body = await r.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!r.ok) {
        throw new Error(body?.error?.message ?? "Could not delete company.");
      }
      setDeleteOpen(false);
      router.push("/companies");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete company.");
      setDeleteOpen(false);
    } finally { setDeleteBusy(false); }
  };

  const handleArchive = async () => {
    if (!company) return;
    setArchiveBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(`/api/orchestration/companies/${company.slug}`, { method: "DELETE" });
      const body = await r.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!r.ok) {
        throw new Error(body?.error?.message ?? "Could not archive company.");
      }
      router.push("/companies");
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Could not archive company.");
    } finally {
      setArchiveBusy(false);
    }
  };

  const handleDevExecutionToggle = async (enabled: boolean) => {
    if (!company) return;
    setDevExecutionBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(company.slug)}/settings/dev-execution-test-mode`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enabled,
            actor: "operator",
          }),
        }
      );
      const body = await response.json().catch(() => null) as
        | DevExecutionTestModeView
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(body && "error" in body ? body.error?.message ?? "Could not update dev execution test mode." : "Could not update dev execution test mode.");
      }
      const next = body as DevExecutionTestModeView;
      setDevExecutionTestMode(next);
      setNotice(
        enabled
          ? `Dev autonomous test mode enabled for ${next.company.name} until disabled.`
          : "Dev autonomous test mode disabled for this company."
      );
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not update dev execution test mode.");
    } finally {
      setDevExecutionBusy(false);
    }
  };

  const handleHiringToggle = async () => {
    if (!company) return;
    const next = !autoApproveNewHires;
    setAutoApproveNewHires(next);
    setHiringSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(company.slug)}/settings/hiring`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApproveNewHires: next }),
      });
      const body = await response.json().catch(() => null) as HiringSettings | { error?: { message?: string } } | null;
      if (!response.ok) {
        throw new Error(body && "error" in body ? body.error?.message ?? "Could not update hiring settings." : "Could not update hiring settings.");
      }
      setAutoApproveNewHires(Boolean((body as HiringSettings | null)?.hiring?.autoApproveNewHires));
      setNotice(next ? "Agent-requested hires will be auto-approved." : "Agent-requested hires will require approval.");
    } catch (toggleError) {
      setAutoApproveNewHires(!next);
      setError(toggleError instanceof Error ? toggleError.message : "Could not update hiring settings.");
    } finally {
      setHiringSaving(false);
    }
  };

  const handleRuntimeGovernanceToggle = async () => {
    if (!company) return;
    const next = !requireProtectedRuntimeApprovals;
    setRequireProtectedRuntimeApprovals(next);
    setRuntimeGovernanceSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(company.slug)}/settings/runtime-governance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireProtectedRuntimeApprovals: next }),
      });
      const body = await response.json().catch(() => null) as RuntimeGovernanceSettings | { error?: { message?: string } } | null;
      if (!response.ok) {
        throw new Error(body && "error" in body ? body.error?.message ?? "Could not update runtime governance settings." : "Could not update runtime governance settings.");
      }
      setRequireProtectedRuntimeApprovals(
        (body as RuntimeGovernanceSettings | null)?.runtime?.requireProtectedRuntimeApprovals !== false,
      );
      setNotice(next ? "Protected runtime commands will require approval." : "Protected runtime command approvals are disabled for this company.");
    } catch (toggleError) {
      setRequireProtectedRuntimeApprovals(!next);
      setError(toggleError instanceof Error ? toggleError.message : "Could not update runtime governance settings.");
    } finally {
      setRuntimeGovernanceSaving(false);
    }
  };

  const handleSymphonySettingsUpdate = async (
    input: {
      trackerEnabled?: boolean;
      trackerTokenRequired?: boolean;
      dryRun?: boolean;
      restartDevLane?: boolean;
      successMessage: string;
    },
  ) => {
    if (!company) return;
    setSymphonyBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(company.slug)}/settings/symphony`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackerEnabled: input.trackerEnabled,
          trackerTokenRequired: input.trackerTokenRequired,
          dryRun: input.dryRun,
          restartDevLane: input.restartDevLane ?? true,
        }),
      });
      const body = await response.json().catch(() => null) as
        | SymphonySettingsView
        | { error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(body && "error" in body ? body.error?.message ?? "Could not update external runner settings." : "Could not update external runner settings.");
      }
      const next = body as SymphonySettingsView;
      setSymphonySettings(next);
      setNotice(input.successMessage);
      if (next.restartQueued) {
        window.setTimeout(() => {
          window.location.reload();
        }, 6500);
      }
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Could not update external runner settings.");
    } finally {
      setSymphonyBusy(false);
    }
  };

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="Could not resolve this company." href="/companies" />;
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", borderRadius: radius.md, border: `0.5px solid ${P.cardBorder}`,
    background: "var(--surface)", padding: `${space.md}px ${space.lg}px`,
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
            <div style={{ height: 16 }} />
            <div style={{ borderTop: `0.5px solid ${P.cardBorder}`, paddingTop: 16 }}>
              <FieldLabel label="Owner" />
              <p style={{ margin: "0 0 12px", fontSize: 12, color: P.muted }}>
                The human account responsible for this company. New UI-created work can use this member identity instead of an agent fallback.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div>
                  <FieldLabel label="Owner name" />
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} style={inputStyle} placeholder="Owner name" />
                </div>
                <div>
                  <FieldLabel label="Owner email" />
                  <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} style={inputStyle} type="email" placeholder="owner@company.com" />
                </div>
              </div>
            </div>
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
                width: 48, height: 48, borderRadius: 10, background: "var(--info-soft)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, fontWeight: 700, color: "var(--info)", border: "0.5px solid var(--info-soft)",
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
          <Section title="Hiring Governance">
            <InfoNote>
              Human-created agents are created immediately. This setting controls whether agent-requested hires also skip the inbox approval.
            </InfoNote>
            <div style={{ height: 12 }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div>
                <span style={{ fontSize: 13, color: P.text }}>Auto-approve new hires</span>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: P.muted }}>
                  {autoApproveNewHires ? "Agent hire requests materialize immediately." : "Agent hire requests create a pending inbox approval."}
                </p>
              </div>
              <Toggle enabled={autoApproveNewHires} disabled={hiringSaving} onToggle={() => void handleHiringToggle()} />
            </div>
          </Section>

          {/* ── RUNTIME GOVERNANCE ── */}
          <Section title="Runtime Governance">
            <InfoNote>
              Controls the extra approval layer for runtime commands that look production-facing, destructive, or credential-sensitive.
            </InfoNote>
            <div style={{ height: 12 }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <div>
                <span style={{ fontSize: 13, color: P.text }}>Require approval for protected runtime commands</span>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: P.muted }}>
                  {requireProtectedRuntimeApprovals
                    ? "Risky runtime commands pause for human approval before execution."
                    : "Risky runtime commands can execute without this approval gate for the current company."}
                </p>
              </div>
              <Toggle
                enabled={requireProtectedRuntimeApprovals}
                disabled={runtimeGovernanceSaving}
                onToggle={() => void handleRuntimeGovernanceToggle()}
              />
            </div>
          </Section>

          {/* ── COMPANY PACKAGES ── */}
          <Section title="Company Packages">
            <p style={{ fontSize: T.body.size, color: color.textSecondary, lineHeight: T.body.lineHeight }}>
              Export and import company data as structured JSON packages from the{" "}
              <a
                href={buildCanonicalCompanyPath(companyCode, "/org")}
                style={{ color: color.text, textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Org Chart
              </a>{" "}
              page, or use the direct links below.
            </p>
            <div style={{ display: "flex", gap: space.sm, marginTop: space.md }}>
              <ActionButton label="Export" href={buildCanonicalCompanyPath(companyCode, "/export")} />
              <ActionButton label="Import" href={buildCanonicalCompanyPath(companyCode, "/import")} />
            </div>
          </Section>

          {/* ── EXECUTION DEFAULTS ── */}
          <Section title="Execution Defaults">
            <InfoNote>
              HiveRunner is the control plane. Each task chooses an orchestration mode, then that mode invokes a runtime and model route.
            </InfoNote>
            <div style={{ height: 12 }} />
            <div style={{
              border: `0.5px solid ${P.cardBorder}`,
              borderRadius: radius.md,
              background: P.card,
              padding: 14,
              marginBottom: 16,
              display: "grid",
              gap: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: P.text }}>
                    {activeHive?.name ?? "No active Execution Hive"}
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: P.muted, lineHeight: 1.45 }}>
                    Company-level defaults applied before project or task overrides.
                  </p>
                </div>
                <ActionButton label="Configure matrix" href={buildCanonicalCompanyPath(companyCode, "/runtimes")} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <ExecutionDefaultChip
                  label="Orchestration mode"
                  value={formatOrchestrationModeLabel((activeHive?.orchestrationMode ?? executionDefaults.defaultEngine ?? defaultExecutionEngine) as TaskExecutionEngine)}
                />
                <ExecutionDefaultChip
                  label="Runtime"
                  value={textSetting(executionDefaults.defaultRuntimeLabel, activeHive?.runtimePriority[0] ?? "Runtime managed")}
                />
                <ExecutionDefaultChip
                  label="Model routing"
                  value={modelRoutingLabel(executionDefaults.defaultModelRoutingLabel ?? executionDefaults.defaultModelRouting)}
                />
              </div>
            </div>
            <FieldLabel label="Fallback orchestration mode" />
            <select
              value={defaultExecutionEngine}
              onChange={(e) => setDefaultExecutionEngine(e.target.value as TaskExecutionEngine)}
              style={inputStyle}
            >
              {EXECUTION_ENGINE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <p style={{ margin: "8px 0 16px", fontSize: 12, color: P.muted }}>
              Used when no Execution Hive, project override, or task override supplies a more specific orchestration mode.
            </p>
            <button type="button" disabled={!profileDirty || profileSaving} onClick={() => void handleSaveProfile()} style={{
              padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: profileDirty ? "pointer" : "default",
              border: `0.5px solid ${P.cardBorder}`, background: profileDirty ? "rgba(120,113,108,0.15)" : "transparent",
              color: profileDirty ? P.text : P.muted, opacity: profileDirty ? 1 : 0.5, marginBottom: 16,
            }}>{profileSaving ? "Saving..." : "Save default"}</button>
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

          {/* ── EXTERNAL RUNNER INTEGRATION ── */}
          {symphonySettings ? (
            <Section
              title="External Runner Integration"
              trailing={
                <Badge
                  label={
                    symphonySettings.tracker.enabled
                      ? symphonySettings.runner.dryRun
                        ? "Dry Run"
                        : "Live"
                      : "Off"
                  }
                  tone={symphonySettings.tracker.enabled ? "positive" : "default"}
                />
              }
            >
              {symphonySettings.available ? (
                <>
                  <InfoNote>
                    Local 3010 controls for the Symphony-compatible external runner bridge. The bundled default implementation is the Codex wrapper, while Claude Code, Gemini, HERMES, and OpenClaw each use the same payload contract through their own wrappers.
                  </InfoNote>
                  <div style={{ height: 12 }} />
                  <PropRow label="Running now">
                    <span style={{ fontSize: 13, color: P.textSec }}>
                      Tracker {symphonySettings.tracker.enabled ? "on" : "off"} · token {symphonySettings.tracker.authRequired ? "required" : "not set"} · runner {symphonySettings.runner.dryRun ? "dry run" : "real"}
                    </span>
                  </PropRow>
                  <PropRow label="After restart">
                    <span style={{ fontSize: 13, color: P.textSec }}>
                      Tracker {symphonySettings.nextRestart.trackerEnabled ? "on" : "off"} · token {symphonySettings.nextRestart.trackerTokenConfigured ? "configured" : "not set"} · runner {symphonySettings.nextRestart.dryRun ? "dry run" : "real"}
                    </span>
                  </PropRow>
                  <PropRow label="Runner command">
                    <span style={{ fontSize: 13, color: P.textSec }}>
                      {symphonySettings.nextRestart.execCommandConfigured
                        ? "Custom external runner command"
                        : symphonySettings.nextRestart.codexCommandConfigured
                        ? "Custom Codex command"
                        : "Bundled Codex runner"}
                    </span>
                  </PropRow>
                  <PropRow label="Runner provider">
                    <span style={{ fontSize: 13, color: P.textSec }}>
                      {symphonySettings.runner.providerLabel ?? "Codex"} default
                      {symphonySettings.runner.providers?.length
                        ? ` · wrappers: ${symphonySettings.runner.providers.map((provider) => `${provider.label} ${provider.status}`).join(", ")}`
                        : ""}
                    </span>
                  </PropRow>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                    <ActionButton
                      label={symphonyBusy ? "Applying..." : "Enable Safe Mode"}
                      onClick={() => void handleSymphonySettingsUpdate({
                        trackerEnabled: true,
                        trackerTokenRequired: true,
                        dryRun: true,
                        restartDevLane: true,
                        successMessage: "Safe external runner mode is being applied. 3010 will restart and this page will reload.",
                      })}
                      disabled={symphonyBusy}
                    />
                    <ActionButton
                      label="Use Real Runner"
                      onClick={() => void handleSymphonySettingsUpdate({
                        trackerEnabled: true,
                        trackerTokenRequired: true,
                        dryRun: false,
                        restartDevLane: true,
                        successMessage: "Real external runner mode is being applied. 3010 will restart and this page will reload.",
                      })}
                      disabled={symphonyBusy}
                    />
                    <ActionButton
                      label="Disable Tracker"
                      variant="ghost"
                      onClick={() => void handleSymphonySettingsUpdate({
                        trackerEnabled: false,
                        trackerTokenRequired: false,
                        restartDevLane: true,
                        successMessage: "External runner tracker is being disabled. 3010 will restart and this page will reload.",
                      })}
                      disabled={symphonyBusy}
                    />
                  </div>
                </>
              ) : (
                <InfoNote tone="warning">
                  {symphonySettings.reason ?? "External runner controls are unavailable on this lane."}
                </InfoNote>
              )}
            </Section>
          ) : null}

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

          {/* ── DEV AUTONOMOUS TEST MODE ── */}
          {devExecutionTestMode ? (
            <Section
              title="Dev Autonomous Test Mode"
              trailing={
                <Badge
                  label={
                    devExecutionTestMode.activeForCurrentCompany
                      ? "Active"
                      : devExecutionTestMode.available
                      ? "Off"
                      : "Unavailable"
                  }
                  tone={
                    devExecutionTestMode.activeForCurrentCompany
                      ? "positive"
                      : devExecutionTestMode.available
                      ? "default"
                      : "warning"
                  }
                />
              }
            >
              <InfoNote tone="warning">
                Dev-only execution sandbox. This never activates on stable. Only one company can run at a time on port 3010, and enablement stays on until you turn it off.
              </InfoNote>
              <div style={{ height: 12 }} />
              {devExecutionTestMode.available ? (
                <>
                  {devExecutionTestMode.activeForCurrentCompany && devExecutionTestMode.activeLease ? (
                    <>
                      <PropRow label="Current state">
                        <span style={{ fontSize: 13, color: P.textSec }}>
                          {devExecutionTestMode.activeLease.indefinite
                            ? "On until disabled"
                            : `Active until ${formatLeaseExpiry(devExecutionTestMode.activeLease.enabledUntil)} · ${formatRemainingSeconds(devExecutionTestMode.activeLease.remainingSeconds)}`}
                        </span>
                      </PropRow>
                      <PropRow label="Scope">
                        <span style={{ fontSize: 13, color: P.textSec }}>
                          {devExecutionTestMode.company.code} only on dev lane
                        </span>
                      </PropRow>
                    </>
                  ) : devExecutionTestMode.activeLease ? (
                    <InfoNote tone="warning">
                      Dev autonomous test mode is currently reserved by {devExecutionTestMode.activeLease.company.name}
                      {devExecutionTestMode.activeLease.indefinite
                        ? " until it is disabled."
                        : ` until ${formatLeaseExpiry(devExecutionTestMode.activeLease.enabledUntil)}.`}
                    </InfoNote>
                  ) : (
                    <p style={{ fontSize: 13, color: P.textSec, margin: 0 }}>
                      Observer-only right now. Assigned tasks will queue work on dev, but nothing executes until you enable this company-scoped control.
                    </p>
                  )}

                  <div style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 14,
                  }}>
                    <ActionButton
                      label={devExecutionTestMode.activeForCurrentCompany ? "Enabled" : "Enable"}
                      onClick={() => void handleDevExecutionToggle(true)}
                      disabled={
                        devExecutionBusy ||
                        devExecutionTestMode.activeForCurrentCompany ||
                        Boolean(devExecutionTestMode.activeLease && !devExecutionTestMode.activeForCurrentCompany)
                      }
                    />
                    <ActionButton
                      label={devExecutionBusy ? "Updating..." : "Disable"}
                      variant="ghost"
                      onClick={() => void handleDevExecutionToggle(false)}
                      disabled={devExecutionBusy || !devExecutionTestMode.activeForCurrentCompany}
                    />
                  </div>
                </>
              ) : (
                <InfoNote tone="warning">
                  {devExecutionTestMode.reason ?? "Dev execution test mode is unavailable on this lane."}
                </InfoNote>
              )}
            </Section>
          ) : null}

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
            border: "0.5px solid var(--negative)", background: "var(--surface)",
          }}>
            <h3 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--negative)", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} /> Danger Zone
            </h3>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: P.textSec }}>
              Archive hides the company from normal navigation. Delete permanently removes it from HiveRunner, deletes its workspace, removes associated runtime registrations, and erases related company data.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" onClick={() => void handleTogglePause()} disabled={pauseBusy} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `0.5px solid ${P.cardBorderHover}`, background: "rgba(255,255,255,0.08)", color: P.text,
              }}>{pauseBusy ? "Updating..." : company?.status === "paused" ? "Resume Company" : "Pause Company"}</button>
              <button type="button" onClick={() => void handleArchive()} disabled={archiveBusy} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `0.5px solid ${P.cardBorderHover}`, background: "rgba(255,255,255,0.08)", color: P.text,
                cursor: archiveBusy ? "not-allowed" : "pointer", opacity: archiveBusy ? 0.6 : 1,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}><Archive size={12} />{archiveBusy ? "Archiving..." : "Archive Company"}</button>
              <button type="button" onClick={() => setDeleteOpen(true)} disabled={deleteBusy || isProtected} style={{
                padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: "0.5px solid var(--negative)", background: "var(--surface-hover)", color: "var(--negative)",
                cursor: isProtected || deleteBusy ? "not-allowed" : "pointer", opacity: isProtected || deleteBusy ? 0.5 : 1,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}><Trash2 size={12} />{isProtected ? "Delete disabled for core company" : "Delete Company"}</button>
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

function ExecutionDefaultChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      minWidth: 0,
      border: `0.5px solid ${P.cardBorder}`,
      borderRadius: radius.sm,
      padding: "10px 12px",
      background: "var(--surface)",
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: P.muted,
        marginBottom: 5,
      }}>
        {label}
      </div>
      <div style={{
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: 13,
        fontWeight: 650,
        color: P.text,
      }}>
        {value}
      </div>
    </div>
  );
}

function Toggle({ enabled, disabled, onToggle }: { enabled: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onToggle} style={{
      width: 40, height: 22, borderRadius: 11, padding: 2, cursor: disabled ? "not-allowed" : "pointer",
      background: enabled ? "rgba(34,197,94,0.5)" : "rgba(120,113,108,0.3)",
      border: "none", display: "flex", alignItems: "center",
      justifyContent: enabled ? "flex-end" : "flex-start",
      transition: "background 150ms ease",
      opacity: disabled ? 0.6 : 1,
    }}>
      <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", transition: "transform 150ms ease" }} />
    </button>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: "error" | "success" }) {
  const s = tone === "error"
    ? { border: `0.5px solid ${color.negative}`, background: color.negativeSoft, color: color.negative }
    : { border: `0.5px solid ${color.positive}`, background: color.positiveSoft, color: color.positive };
  return <div style={{ ...s, borderRadius: radius.md, padding: `${space.sm}px ${space.lg}px`, fontSize: T.body.size, marginBottom: space.lg }}>{children}</div>;
}
