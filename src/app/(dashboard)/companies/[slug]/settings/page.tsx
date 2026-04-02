"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Loader2,
  Palette,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { getCompanyTheme, listCompanies } from "@/lib/orchestration/client";
import type { CompanyTheme, OrchestrationCompany } from "@/lib/orchestration/types";

/* ── amber/brown palette tokens ── */
const amber = {
  accent: "#d97706",
  accentLight: "#fbbf24",
  border: "rgba(217,119,6,0.25)",
  borderHover: "rgba(251,191,36,0.45)",
  bgSubtle: "rgba(217,119,6,0.06)",
  bgPanel: "rgba(28,25,23,0.82)",
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

export default function CompanySettingsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [theme, setTheme] = useState<CompanyTheme | null>(null);
  const [execSettings, setExecSettings] = useState<ExecutionSettings | null>(null);
  const [hbSettings, setHbSettings] = useState<HeartbeatSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [companies, themeData, execResp, hbResp] = await Promise.all([
          listCompanies(),
          getCompanyTheme(slug),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/execution`).then((r) =>
            r.ok ? r.json() : null
          ),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/settings/heartbeats`).then((r) =>
            r.ok ? r.json() : null
          ),
        ]);

        if (cancelled) return;
        setCompany(companies.find((c) => c.slug === slug) ?? null);
        setTheme(themeData);
        setExecSettings(execResp);
        setHbSettings(hbResp);
      } catch {
        /* swallow – page degrades gracefully */
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [slug, nonce]);

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
      {/* ── dense header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em]" style={{ color: amber.textDim }}>
            Settings
          </p>
          <h1 className="text-lg font-semibold text-stone-100">
            {loading ? "Loading…" : company?.name ?? "Company"}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => { setRefreshing(true); setNonce((n) => n + 1); }}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition"
          style={{
            borderColor: amber.border,
            color: amber.text,
            background: amber.bgSubtle,
          }}
        >
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl" style={{ background: amber.bgPanel, border: `1px solid ${amber.border}` }} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* ── Company Info ── */}
          <Panel icon={Building2} title="Company Info">
            <Setting label="Name" value={company?.name ?? "—"} />
            <Setting label="Slug" value={company?.slug ?? "—"} helper="Stable URL identity" />
            <Setting label="Description" value={company?.description || "No description set"} />
            <Setting label="Status" value={company?.status ?? "—"} />
            <Setting label="Workspace Root" value={company?.workspace?.root ?? "—"} />
            <Setting label="Workspace Source" value={company?.workspace?.source ?? "—"} />
          </Panel>

          {/* ── Avatar Theme ── */}
          <Panel icon={Palette} title="Avatar Theme">
            <Setting label="Theme" value={theme?.name ?? "Default"} />
            <Setting label="Keywords" value={theme?.keywords?.join(", ") || "No keywords configured"} />
            <Setting
              label="Prompt Template"
              value={theme?.promptTemplate || "No prompt template set"}
              mono
            />
          </Panel>

          {/* ── Execution Defaults ── */}
          <Panel icon={Settings2} title="Execution Defaults">
            {execSettings ? (
              <>
                <Setting
                  label="Review Required"
                  value={execSettings.defaults?.reviewRequired ? "Enabled" : "Disabled"}
                />
                <Setting
                  label="Stale Escalation"
                  value={`In Progress > ${execSettings.defaults?.staleHours ?? 4}h`}
                />
                <Setting
                  label="Review Timeout"
                  value={`> ${execSettings.defaults?.reviewTimeoutHours ?? 1}h`}
                />
                {execSettings.agents?.length ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: amber.textDim }}>
                      Per-Agent Overrides
                    </p>
                    {execSettings.agents.map((a) => (
                      <div key={a.agentId} className="flex items-center justify-between text-xs text-stone-300">
                        <span>{a.agentName}</span>
                        <span className="text-stone-500">
                          model: {a.modelId} · timeout: {a.timeoutSeconds}s
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-stone-500">Unable to load execution settings.</p>
            )}
          </Panel>

          {/* ── Heartbeat Settings ── */}
          <Panel icon={ShieldCheck} title="Heartbeat & Governance">
            {hbSettings ? (
              <>
                <Setting
                  label="Heartbeat Enabled"
                  value={hbSettings.defaults?.heartbeatEnabled ? "Yes" : "No"}
                />
                <Setting
                  label="Default Interval"
                  value={`${Math.round((hbSettings.defaults?.intervalSeconds ?? 3600) / 60)} minutes`}
                />
                <Setting label="Projects" value={String(company?.stats?.projects ?? 0)} />
                <Setting label="Agents" value={String(company?.stats?.agents ?? 0)} />
                {hbSettings.agents?.length ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: amber.textDim }}>
                      Per-Agent Heartbeats
                    </p>
                    {hbSettings.agents.map((a) => (
                      <div key={a.agentId} className="flex items-center justify-between text-xs text-stone-300">
                        <span>{a.agentName}</span>
                        <span className="text-stone-500">
                          {a.heartbeatEnabled ? "on" : "off"} · {Math.round(a.intervalSeconds / 60)}m
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-stone-500">Unable to load heartbeat settings.</p>
            )}
          </Panel>

          {/* ── Danger Zone ── */}
          <div
            className="rounded-xl border p-4 lg:col-span-2"
            style={{
              borderColor: "rgba(244,63,94,0.25)",
              background: "rgba(244,63,94,0.06)",
            }}
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-400" />
              <h3 className="text-sm font-medium text-rose-300">Danger Zone</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled
                className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 opacity-50"
              >
                Archive Company
              </button>
              <button
                type="button"
                disabled
                className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 opacity-50"
              >
                Delete Company
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Panel wrapper ── */
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
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: amber.border, background: amber.bgPanel }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: amber.accentLight }} />
        <h3 className="text-sm font-medium text-stone-200">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/* ── Setting row ── */
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
