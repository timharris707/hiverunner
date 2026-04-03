"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  Loader2,
  Palette,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import { CompanyErrorState, DeleteCompanyModal } from "@/components/company/company-ui";
import { getCompanyTheme, listCompanies } from "@/lib/orchestration/client";
import type { CompanyTheme, OrchestrationCompany } from "@/lib/orchestration/types";

const PROTECTED_COMPANY_SLUGS = new Set(["neveridle-core"]);

const amber = {
  accent: "#d97706",
  accentLight: "#fbbf24",
  border: "rgba(217,119,6,0.24)",
  borderHover: "rgba(251,191,36,0.44)",
  bgSubtle: "rgba(217,119,6,0.08)",
  bgPanel: "linear-gradient(180deg, rgba(41,37,36,0.9), rgba(12,10,9,0.96))",
  text: "#fde68a",
  textMuted: "#a8a29e",
  textDim: "#78716c",
};

type ExecutionSettings = {
  defaults: { reviewRequired: boolean; staleHours: number; reviewTimeoutHours: number };
  agents: { agentId: string; agentName: string; modelId: string; timeoutSeconds: number; graceSeconds: number }[];
};

type HeartbeatSettings = {
  defaults: { heartbeatEnabled: boolean; intervalSeconds: number };
  agents: { agentId: string; agentName: string; heartbeatEnabled: boolean; intervalSeconds: number }[];
};

type CompanyProfileDraft = {
  name: string;
  description: string;
};

export default function CompanySettingsPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [theme, setTheme] = useState<CompanyTheme | null>(null);
  const [execSettings, setExecSettings] = useState<ExecutionSettings | null>(null);
  const [hbSettings, setHbSettings] = useState<HeartbeatSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  const [profileDraft, setProfileDraft] = useState<CompanyProfileDraft>({ name: "", description: "" });
  const [profileSaving, setProfileSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isProtectedCompany = company ? PROTECTED_COMPANY_SLUGS.has(company.slug) : PROTECTED_COMPANY_SLUGS.has(slug);
  const profileDirty = useMemo(() => {
    if (!company) return false;
    return profileDraft.name.trim() !== company.name || profileDraft.description.trim() !== company.description;
  }, [company, profileDraft.description, profileDraft.name]);

  const load = async (showRefresh = false) => {
    if (showRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [companies, themeData, execResp, hbResp] = await Promise.all([
        listCompanies(),
        getCompanyTheme(slug),
        fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/execution`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/heartbeats`).then((r) => (r.ok ? r.json() : null)),
      ]);

      const nextCompany = companies.find((c) => c.slug === slug) ?? null;
      setCompany(nextCompany);
      setTheme(themeData);
      setExecSettings(execResp);
      setHbSettings(hbResp);
      setProfileDraft({
        name: nextCompany?.name ?? "",
        description: nextCompany?.description ?? "",
      });
      setError(null);
    } catch {
      setError("Could not load company settings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slug, nonce]);

  const handleSaveProfile = async () => {
    if (!company) return;

    const nextName = profileDraft.name.trim();
    const nextDescription = profileDraft.description.trim();
    if (nextName.length < 2) {
      setError("Company display name must be at least 2 characters.");
      return;
    }

    setProfileSaving(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(company.slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          description: nextDescription,
        }),
      });

      if (!response.ok) {
        throw new Error("save_failed");
      }

      const body = (await response.json()) as { company?: OrchestrationCompany };
      const nextCompany = body.company ?? { ...company, name: nextName, description: nextDescription };
      setCompany(nextCompany);
      setProfileDraft({ name: nextCompany.name, description: nextCompany.description });
      setNotice("Company profile updated. Slug stayed unchanged.");
    } catch {
      setError("Could not save company profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDeleteCompany = async () => {
    if (!company || isProtectedCompany) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/orchestration/companies/${company.slug}?hard=true`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("delete_failed");
      }
      setDeleteOpen(false);
      router.push("/companies");
    } catch {
      setError("Could not delete company.");
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleTogglePause = async () => {
    if (!company) return;
    setPauseBusy(true);
    setError(null);
    setNotice(null);
    const newStatus = company.status === "paused" ? "active" : "paused";
    try {
      const response = await fetch(`/api/orchestration/companies/${company.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) {
        throw new Error("status_failed");
      }
      setCompany((prev) => (prev ? { ...prev, status: newStatus } : null));
      setNotice(newStatus === "paused" ? "Company paused." : "Company resumed.");
    } catch {
      setError("Could not update company status.");
    } finally {
      setPauseBusy(false);
    }
  };

  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="Could not resolve this company from orchestration data."
        href="/companies"
      />
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: amber.textDim }}>
            Settings
          </p>
          <h1 className="text-lg font-semibold text-stone-100">{loading ? "Loading…" : company?.name ?? "Company"}</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            setRefreshing(true);
            setNonce((n) => n + 1);
          }}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition"
          style={{ borderColor: amber.border, color: amber.text, background: amber.bgSubtle }}
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border" style={{ background: amber.bgPanel, borderColor: amber.border }} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Panel icon={Building2} title="Company Profile">
            <Field label="Display Name" helper="Editable label used throughout Mission Control.">
              <input
                value={profileDraft.name}
                onChange={(event) => setProfileDraft((prev) => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-lg border bg-stone-950/70 px-3 py-2 text-sm text-stone-100 outline-none"
                style={{ borderColor: amber.border }}
                placeholder="NeverIdle Core"
              />
            </Field>
            <Field label="Description" helper="Company mission/description copy for dashboard and management views.">
              <textarea
                value={profileDraft.description}
                onChange={(event) => setProfileDraft((prev) => ({ ...prev, description: event.target.value }))}
                className="min-h-[96px] w-full rounded-lg border bg-stone-950/70 px-3 py-2 text-sm text-stone-100 outline-none"
                style={{ borderColor: amber.border }}
                placeholder="Autonomous AI organization"
              />
            </Field>
            <Setting label="Slug" value={company?.slug ?? "—"} helper="Stable URL identity. Editing slug is intentionally kept out of the normal profile form." />
            <Setting label="Status" value={company?.status ?? "—"} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={!profileDirty || profileSaving}
                onClick={() => void handleSaveProfile()}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium text-amber-100 disabled:opacity-60"
                style={{ borderColor: amber.borderHover, background: "rgba(217,119,6,0.14)" }}
              >
                {profileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save profile
              </button>
              <span className="text-[11px] text-stone-500">Display name and description save without mutating slug.</span>
            </div>
          </Panel>

          <Panel icon={ShieldCheck} title="Workspace & Protections">
            <Setting label="Workspace Root" value={company?.workspace.root ?? "—"} mono />
            <Setting label="Workspace Source" value={company?.workspace.source ?? "—"} />
            <Setting label="Projects" value={String(company?.stats.projects ?? 0)} />
            <Setting label="Agents" value={String(company?.stats.agents ?? 0)} />
            <div className="rounded-xl border px-3 py-3 text-xs" style={{ borderColor: amber.border, background: "rgba(120,53,15,0.14)" }}>
              <p className="font-medium text-amber-100">{isProtectedCompany ? "Core company protection enabled" : "Standard company safeguards enabled"}</p>
              <p className="mt-1 text-stone-300">
                {isProtectedCompany
                  ? "neveridle-core is blocked from destructive deletion in Mission Control to protect the main workspace and Henry context."
                  : "Destructive actions stay isolated to non-core companies."}
              </p>
            </div>
          </Panel>

          <Panel icon={Palette} title="Avatar Theme">
            <Setting label="Theme" value={theme?.name ?? "Default"} />
            <Setting label="Keywords" value={theme?.keywords?.join(", ") || "No keywords configured"} />
            <Setting label="Prompt Template" value={theme?.promptTemplate || "No prompt template set"} mono />
          </Panel>

          <Panel icon={Settings2} title="Execution Defaults">
            {execSettings?.defaults ? (
              <>
                <Setting label="Review Required" value={execSettings.defaults.reviewRequired ? "Enabled" : "Disabled"} />
                <Setting label="Stale Escalation" value={`In Progress > ${execSettings.defaults.staleHours}h`} />
                <Setting label="Review Timeout" value={`> ${execSettings.defaults.reviewTimeoutHours}h`} />
                {(execSettings.agents ?? []).length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: amber.textDim }}>
                      Per-Agent Overrides
                    </p>
                    {(execSettings.agents ?? []).map((agent) => (
                      <div key={agent.agentId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: amber.border, background: "rgba(28,25,23,0.62)" }}>
                        <span className="text-stone-200">{agent.agentName}</span>
                        <span className="text-stone-500">model: {agent.modelId} · timeout: {agent.timeoutSeconds}s</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-stone-500">Execution defaults unavailable for this company yet.</p>
            )}
          </Panel>

          <Panel icon={ShieldCheck} title="Heartbeat & Governance">
            {hbSettings?.defaults ? (
              <>
                <Setting label="Heartbeat Enabled" value={hbSettings.defaults.heartbeatEnabled ? "Yes" : "No"} />
                <Setting label="Default Interval" value={`${Math.round((hbSettings.defaults.intervalSeconds ?? 3600) / 60)} minutes`} />
                {(hbSettings.agents ?? []).length > 0 ? (
                  <div className="space-y-2 pt-1">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: amber.textDim }}>
                      Per-Agent Heartbeats
                    </p>
                    {(hbSettings.agents ?? []).map((agent) => (
                      <div key={agent.agentId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: amber.border, background: "rgba(28,25,23,0.62)" }}>
                        <span className="text-stone-200">{agent.agentName}</span>
                        <span className="text-stone-500">{agent.heartbeatEnabled ? "on" : "off"} · {Math.round(agent.intervalSeconds / 60)}m</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-stone-500">Heartbeat defaults unavailable for this company yet.</p>
            )}
          </Panel>

          <div className="rounded-xl border p-4 lg:col-span-2" style={{ borderColor: "rgba(244,63,94,0.25)", background: "rgba(127,29,29,0.16)" }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-300" />
                <h3 className="text-sm font-medium text-stone-100">Company Controls</h3>
              </div>

              <button
                type="button"
                onClick={() => void handleTogglePause()}
                disabled={pauseBusy}
                className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 transition hover:bg-amber-500/20 disabled:opacity-50"
              >
                {pauseBusy ? "Updating..." : company?.status === "paused" ? "Resume Company" : "Pause Company"}
              </button>
            </div>

            <p className="mb-4 text-sm text-stone-300">
              Pausing the company cascades to contained projects and agents. Deletion remains hard-destructive and is intentionally blocked for the protected core company.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                disabled={isProtectedCompany}
                className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isProtectedCompany ? "Delete Disabled For Core Company" : "Delete Company"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteCompanyModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteCompany}
        companyName={company?.name ?? slug}
        busy={deleteBusy}
      />
    </div>
  );
}

function Banner({ children, tone }: { children: React.ReactNode; tone: "error" | "success" }) {
  const styles =
    tone === "error"
      ? { borderColor: "rgba(248,113,113,0.32)", background: "rgba(127,29,29,0.18)", color: "#fecaca" }
      : { borderColor: "rgba(251,191,36,0.24)", background: "rgba(120,53,15,0.16)", color: "#fde68a" };

  return (
    <div className="rounded-xl border px-3 py-2 text-sm" style={styles}>
      {children}
    </div>
  );
}

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: amber.border, background: amber.bgPanel }}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: amber.accentLight }} />
        <h3 className="text-sm font-medium text-stone-200">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-stone-400">{label}</p>
      {children}
      <p className="mt-1 text-[10px]" style={{ color: amber.textDim }}>
        {helper}
      </p>
    </div>
  );
}

function Setting({
  label,
  value,
  helper,
  mono,
}: {
  label: string;
  value: string;
  helper?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] text-stone-400">{label}</p>
        <p
          className={`text-right text-xs text-stone-200 ${mono ? "font-mono text-[11px] leading-relaxed" : ""}`}
          style={{ maxWidth: "65%", wordBreak: "break-word" }}
        >
          {value}
        </p>
      </div>
      {helper ? <p className="text-[10px]" style={{ color: amber.textDim }}>{helper}</p> : null}
    </div>
  );
}
