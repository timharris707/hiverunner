"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { CreditCard, DollarSign, Layers, Server } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { listCompanies } from "@/lib/orchestration/client";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

type Timeframe = "mtd" | "7d" | "30d" | "ytd" | "all";
type CostsTab = "overview" | "budgets" | "providers" | "billers" | "finance";
type BillingType = "metered_api" | "subscription_included" | "subscription_overage" | "credits" | "fixed" | "local_free" | "estimated" | "unknown";

type AggregateRow = {
  cost: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  eventCount: number;
  meteredEvents: number;
  subscriptionEvents: number;
};

type ProviderProfile = {
  id: string;
  provider: string;
  displayName: string;
  connectionType: string;
  billingModel: string;
  biller: string;
  authSurface: string;
  confidence: string;
  source: string;
  isActive: boolean;
};

type CostEvent = {
  id: string;
  agent: string;
  taskTitle: string | null;
  provider: string;
  biller: string;
  billingType: BillingType;
  model: string;
  tokens: number;
  cost: number;
  costSource: string;
  occurredAt: string;
};

type FinanceEvent = {
  id: string;
  provider: string;
  biller: string;
  eventType: string;
  amount: number;
  currency: string;
  source: string;
  confidence: string;
  periodStart: string | null;
  periodEnd: string | null;
  externalId: string | null;
  description: string;
  occurredAt: string;
};

type CostData = {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  projected: number;
  budget: number;
  avgDaily: number;
  daysElapsed: number;
  daysInMonth: number;
  selectedRangeSpend: number;
  selectedRangeTokens: number;
  meteredSpend: number;
  subscriptionTokens: number;
  meteredEvents: number;
  subscriptionEvents: number;
  byAgent: Array<AggregateRow & { agent: string }>;
  byModel: Array<AggregateRow & { model: string }>;
  byProvider: Array<AggregateRow & { provider: string; biller: string; billingType: BillingType }>;
  byBiller: Array<AggregateRow & { biller: string; billingType: BillingType }>;
  billingMix: Array<AggregateRow & { billingType: BillingType }>;
  providerProfiles: ProviderProfile[];
  recentEvents: CostEvent[];
  financeEvents: FinanceEvent[];
  financeDebits: number;
  financeCredits: number;
  subscriptionFees: number;
  financeAdjustments: number;
  financeNet: number;
};

const BILLING_MODEL_OPTIONS = [
  "metered_tokens",
  "subscription_included",
  "subscription_overage",
  "credits",
  "fixed",
  "local_free",
  "hybrid",
  "unknown",
];

const CONNECTION_TYPE_OPTIONS = [
  "local_cli",
  "api_key",
  "env_api_key",
  "oauth",
  "subscription",
  "router",
  "local_model",
  "daemon",
  "manual",
  "unknown",
];

const AUTH_SURFACE_OPTIONS = [
  "api_key",
  "env",
  "oauth",
  "device_login",
  "setup_token",
  "local_config",
  "none",
  "unknown",
];

const FINANCE_EVENT_OPTIONS = [
  "usage",
  "subscription",
  "credit",
  "adjustment",
  "manual",
];

const P = {
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  cardBorderHover: tokens.cardBorderHover,
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
  accent: tokens.accent,
  accentSoft: tokens.accentSoft,
  success: tokens.success,
  successDim: tokens.successDim,
  warn: tokens.warn,
  warnDim: tokens.warnDim,
  error: tokens.error,
  errorDim: tokens.errorDim,
  info: "var(--info)",
  infoDim: "var(--info-soft)",
};

function fmtUsd(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function titleize(value: string): string {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function billingTone(type: BillingType): { color: string; bg: string } {
  if (type === "metered_api" || type === "subscription_overage") return { color: P.warn, bg: P.warnDim };
  if (type === "subscription_included" || type === "local_free") return { color: P.success, bg: P.successDim };
  if (type === "credits" || type === "fixed") return { color: P.info, bg: P.infoDim };
  return { color: P.muted, bg: "rgba(120,113,108,0.14)" };
}

function billingModelToType(model: string): BillingType {
  if (model === "metered_tokens") return "metered_api";
  if (model === "subscription_included") return "subscription_included";
  if (model === "subscription_overage") return "subscription_overage";
  if (model === "credits" || model === "fixed" || model === "local_free") return model;
  return "unknown";
}

function addFinanceEventToCostData(costData: CostData, event: FinanceEvent): CostData {
  const financeDebits = event.amount > 0 && event.eventType !== "subscription" ? costData.financeDebits + event.amount : costData.financeDebits;
  const financeCredits = event.amount < 0 || event.eventType === "credit" ? costData.financeCredits + Math.abs(event.amount) : costData.financeCredits;
  const subscriptionFees = event.eventType === "subscription" && event.amount > 0 ? costData.subscriptionFees + event.amount : costData.subscriptionFees;
  const financeAdjustments = event.eventType === "adjustment" ? costData.financeAdjustments + event.amount : costData.financeAdjustments;
  return {
    ...costData,
    financeEvents: [event, ...(costData.financeEvents ?? [])].slice(0, 50),
    financeDebits,
    financeCredits,
    subscriptionFees,
    financeAdjustments,
    financeNet: costData.financeNet + event.amount,
  };
}

function parseCostsTab(value: string | null): CostsTab | null {
  return value === "overview" || value === "budgets" || value === "providers" || value === "billers" || value === "finance"
    ? value
    : null;
}

export default function CompanyCostsPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("mtd");
  const [tab, setTab] = useState<CostsTab>(() => parseCostsTab(searchParams.get("tab")) ?? "overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [companies, costResp] = await Promise.all([
          listCompanies(),
          fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/costs?timeframe=${timeframe}`, { cache: "no-store" })
            .then(async (r) => (r.ok ? (await r.json()) as CostData : null)),
        ]);
        if (cancelled) return;
        setCompany(companies.find((e) => e.slug === slug) ?? null);
        setCostData(costResp);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, timeframe]);

  useEffect(() => {
    const nextTab = parseCostsTab(searchParams.get("tab"));
    if (nextTab) setTab(nextTab);
  }, [searchParams]);

  const totalTokens = useMemo(() => costData?.selectedRangeTokens ?? 0, [costData]);
  const budgetUtil = useMemo(() => costData && costData.budget > 0 ? Math.min((costData.thisMonth / costData.budget) * 100, 999) : 0, [costData]);
  const billerCount = useMemo(() => costData?.byBiller?.length ?? 0, [costData]);

  if (!loading && !company) return <CompanyErrorState title="Company not found" detail="This company could not be resolved." href="/companies" />;
  if (!loading && !costData) return <CompanyErrorState title="Costs unavailable" detail="Cost telemetry is currently unavailable." href={`/companies/${encodeURIComponent(slug)}`} />;

  const ranges: { key: Timeframe; label: string }[] = [
    { key: "mtd", label: "Month to Date" },
    { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" },
    { key: "ytd", label: "Year to Date" },
    { key: "all", label: "All Time" },
  ];
  const tabs: { key: CostsTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "budgets", label: "Budgets" },
    { key: "providers", label: "Providers" },
    { key: "billers", label: "Billers" },
    { key: "finance", label: "Finance" },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 6 }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 600, color: P.text, margin: "0 0 6px", letterSpacing: "-0.01em" }}>Costs</h1>
          <p style={{ fontSize: 13, color: P.textSec, margin: 0 }}>Provider connections, billing type, request ledger, and budget posture.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
          {ranges.map((range) => (
            <button
              key={range.key}
              type="button"
              onClick={() => setTimeframe(range.key)}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                border: `0.5px solid ${timeframe === range.key ? P.cardBorderHover : P.cardBorder}`,
                background: timeframe === range.key ? P.accentSoft : "transparent",
                color: timeframe === range.key ? P.text : P.textSec,
              }}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12, margin: "20px 0" }}>
        <SummaryCard label="Range Spend" value={loading ? "..." : fmtUsd(costData?.selectedRangeSpend ?? 0)} detail={`${fmtTok(totalTokens)} tracked tokens`} icon={<DollarSign size={16} color={P.muted} />} />
        <SummaryCard label="Metered API" value={loading ? "..." : fmtUsd(costData?.meteredSpend ?? 0)} detail={`${costData?.meteredEvents ?? 0} billable events`} icon={<CreditCard size={16} color={P.muted} />} />
        <SummaryCard label="Subscription Use" value={loading ? "..." : fmtTok(costData?.subscriptionTokens ?? 0)} detail={`${costData?.subscriptionEvents ?? 0} included events`} icon={<Server size={16} color={P.muted} />} />
        <SummaryCard label="Billers" value={loading ? "..." : String(billerCount)} detail={`${costData?.providerProfiles?.length ?? 0} provider profiles`} icon={<Layers size={16} color={P.muted} />} />
      </div>

      <div style={{ borderBottom: `0.5px solid ${P.cardBorder}`, marginBottom: 20 }}>
        <nav style={{ display: "flex", gap: 0 }}>
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              style={{
                position: "relative",
                padding: "8px 14px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                background: "none",
                border: "none",
                color: tab === item.key ? P.text : P.muted,
              }}
            >
              {item.label}
              {tab === item.key && <span style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: 2, background: P.text }} />}
            </button>
          ))}
        </nav>
      </div>

      {tab === "overview" && <OverviewTab costData={costData} totalTokens={totalTokens} budgetUtil={budgetUtil} loading={loading} />}
      {tab === "budgets" && <BudgetsTab costData={costData} budgetUtil={budgetUtil} />}
      {tab === "providers" && (
        <ProvidersTab
          slug={slug}
          costData={costData}
          loading={loading}
          onProfileUpdated={(profile) => {
            setCostData((prev) => prev
              ? {
                  ...prev,
                  providerProfiles: prev.providerProfiles.map((row) => row.id === profile.id ? profile : row),
                }
              : prev);
          }}
        />
      )}
      {tab === "billers" && <BillersTab costData={costData} loading={loading} />}
      {tab === "finance" && (
        <FinanceTab
          slug={slug}
          costData={costData}
          onFinanceEvent={(event) => setCostData((prev) => prev ? addFinanceEventToCostData(prev, event) : prev)}
        />
      )}
    </div>
  );
}

function OverviewTab({ costData, totalTokens, budgetUtil, loading }: { costData: CostData | null; totalTokens: number; budgetUtil: number; loading: boolean }) {
  return (
    <>
      <Section title="Inference ledger" subtitle="Request-scoped spend for the selected period, with subscription-included usage separated from metered API charges.">
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
          <div>
            <p style={{ fontSize: 28, fontWeight: 700, color: P.text, margin: 0 }}>{loading ? "..." : fmtUsd(costData?.thisMonth ?? 0)}</p>
            <p style={{ fontSize: 13, color: P.muted, marginTop: 4 }}>Month spend · projected {fmtUsd(costData?.projected ?? 0)}</p>
            {costData && costData.budget > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: P.muted, marginBottom: 6 }}>
                  <span>{fmtUsd(Math.max(0, costData.budget - costData.thisMonth))} remaining</span>
                  <span>{budgetUtil.toFixed(0)}% of {fmtUsd(costData.budget)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(120,113,108,0.15)", overflow: "hidden" }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(budgetUtil, 100)}%`, background: budgetUtil >= 90 ? P.error : budgetUtil >= 70 ? P.warn : P.success }} />
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InlineMetric label="Tokens" value={fmtTok(totalTokens)} />
            <InlineMetric label="Today" value={fmtUsd(costData?.today ?? 0)} />
            <InlineMetric label="Avg Daily" value={fmtUsd(costData?.avgDaily ?? 0)} />
            <InlineMetric label="Last Month" value={fmtUsd(costData?.lastMonth ?? 0)} />
          </div>
        </div>
      </Section>

      <Section title="Billing mix" subtitle="How this period's usage maps to billing behavior.">
        <DataRows
          rows={costData?.billingMix ?? []}
          empty="No billing events in this period."
          render={(row) => (
            <Row key={row.billingType} label={<Badge value={titleize(row.billingType)} type={row.billingType} />} meta={`${row.eventCount} events · ${fmtTok(row.tokens)} tokens`} value={fmtUsd(row.cost)} />
          )}
        />
      </Section>

      <Section title="Recent events" subtitle="Most recent request-level ledger entries.">
        <DataRows
          rows={costData?.recentEvents ?? []}
          empty="No cost events in this period."
          render={(event) => (
            <Row
              key={event.id}
              label={event.taskTitle || event.model}
              meta={`${event.agent} · ${event.provider} · ${event.biller} · ${fmtTok(event.tokens)} tokens`}
              value={fmtUsd(event.cost)}
              badge={<Badge value={titleize(event.billingType)} type={event.billingType} />}
            />
          )}
        />
      </Section>
    </>
  );
}

function BudgetsTab({ costData, budgetUtil }: { costData: CostData | null; budgetUtil: number }) {
  const financeUtil = costData && costData.budget > 0 ? Math.min((Math.max(0, costData.financeNet) / costData.budget) * 100, 999) : 0;
  return (
    <>
      <Section title="Budget posture" subtitle="Monthly guardrail for metered spend. Subscription-included usage is tracked, but does not draw down the spend budget.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <InlineMetric label="Budget" value={costData && costData.budget > 0 ? fmtUsd(costData.budget) : "Open"} />
          <InlineMetric label="Request ledger" value={fmtUsd(costData?.thisMonth ?? 0)} />
          <InlineMetric label="Request projected" value={fmtUsd(costData?.projected ?? 0)} />
          <InlineMetric label="Request used" value={`${budgetUtil.toFixed(0)}%`} />
        </div>
      </Section>
      <Section title="Account billing posture" subtitle="Manual account events for subscription charges, credits, adjustments, and account usage entries. This is separate from request estimates.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <InlineMetric label="Net account spend" value={fmtUsd(costData?.financeNet ?? 0)} />
          <InlineMetric label="Debits" value={fmtUsd(costData?.financeDebits ?? 0)} />
          <InlineMetric label="Credits" value={fmtUsd(costData?.financeCredits ?? 0)} />
          <InlineMetric label="Account used" value={`${financeUtil.toFixed(0)}%`} />
        </div>
      </Section>
      <Section title="Agent budgets" subtitle="Per-agent hard stops and approval policies will build on the same cost event ledger.">
        <p style={{ fontSize: 13, color: P.muted, margin: 0 }}>No agent budget policies configured yet.</p>
      </Section>
    </>
  );
}

function ProvidersTab({
  slug,
  costData,
  loading,
  onProfileUpdated,
}: {
  slug: string;
  costData: CostData | null;
  loading: boolean;
  onProfileUpdated: (profile: ProviderProfile) => void;
}) {
  return (
    <>
      <Section title="Connection profiles" subtitle="Detected provider access method and billing model. Confirm a row when HiveRunner's classification matches how the account is actually billed.">
        {loading ? <p style={{ fontSize: 13, color: P.muted }}>Loading...</p> : (
          <DataRows
            rows={costData?.providerProfiles ?? []}
            empty="No provider connections detected."
            render={(profile) => (
              <ProviderProfileRow
                key={profile.id}
                slug={slug}
                profile={profile}
                onProfileUpdated={onProfileUpdated}
              />
            )}
          />
        )}
      </Section>

      <Section title="By provider" subtitle="Usage grouped by runtime provider, with the inferred biller shown separately.">
        <DataRows
          rows={costData?.byProvider ?? []}
          empty="No provider usage in this period."
          render={(row) => (
            <Row
              key={row.provider}
              label={row.provider}
              meta={`${row.biller} · ${row.eventCount} events · ${fmtTok(row.tokens)} tokens`}
              value={fmtUsd(row.cost)}
              badge={<Badge value={titleize(row.billingType)} type={row.billingType} />}
            />
          )}
        />
      </Section>

      <Section title="By model" subtitle="Model-level usage from adapter telemetry.">
        <DataRows
          rows={costData?.byModel ?? []}
          empty="No model usage in this period."
          render={(row) => (
            <Row key={row.model} label={<span style={{ fontFamily: "var(--font-mono, monospace)" }}>{row.model}</span>} meta={`${row.eventCount} events · ${fmtTok(row.tokens)} tokens`} value={fmtUsd(row.cost)} />
          )}
        />
      </Section>
    </>
  );
}

function ProviderProfileRow({
  slug,
  profile,
  onProfileUpdated,
}: {
  slug: string;
  profile: ProviderProfile;
  onProfileUpdated: (profile: ProviderProfile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingModel, setBillingModel] = useState(profile.billingModel);
  const [connectionType, setConnectionType] = useState(profile.connectionType);
  const [authSurface, setAuthSurface] = useState(profile.authSurface);
  const [biller, setBiller] = useState(profile.biller);

  useEffect(() => {
    setBillingModel(profile.billingModel);
    setConnectionType(profile.connectionType);
    setAuthSurface(profile.authSurface);
    setBiller(profile.biller);
  }, [profile]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/orchestration/companies/${encodeURIComponent(slug)}/provider-profiles/${encodeURIComponent(profile.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ billingModel, connectionType, authSurface, biller }),
        },
      );
      if (!response.ok) throw new Error(`${response.status}`);
      const data = await response.json() as { profile?: ProviderProfile };
      if (data.profile) onProfileUpdated(data.profile);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown_error");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div style={{ padding: "10px 0", borderBottom: `0.5px solid ${P.cardBorder}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: P.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.displayName}</div>
              <Badge value={titleize(profile.billingModel)} type={billingModelToType(profile.billingModel)} />
              {profile.confidence === "confirmed" ? <Badge value="Confirmed" type="local_free" /> : null}
            </div>
            <div style={{ fontSize: 11, color: P.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {titleize(profile.connectionType)} · {titleize(profile.authSurface)} · {profile.confidence} · {profile.source}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: P.text }}>{profile.biller}</span>
            <button type="button" onClick={() => setEditing(true)} style={smallButtonStyle()}>
              Review
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 0", borderBottom: `0.5px solid ${P.cardBorder}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: P.text }}>{profile.displayName}</div>
          <div style={{ fontSize: 11, color: P.muted, marginTop: 2 }}>Confirm how this provider bills the account.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} style={smallButtonStyle()}>
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} style={smallButtonStyle(true)}>
            {saving ? "Saving" : "Confirm"}
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: 10 }}>
        <ProfileSelect label="Billing" value={billingModel} options={BILLING_MODEL_OPTIONS} onChange={setBillingModel} />
        <ProfileInput label="Biller" value={biller} onChange={setBiller} />
        <ProfileSelect label="Connection" value={connectionType} options={CONNECTION_TYPE_OPTIONS} onChange={setConnectionType} />
        <ProfileSelect label="Auth" value={authSurface} options={AUTH_SURFACE_OPTIONS} onChange={setAuthSurface} />
      </div>
      {error ? <div style={{ marginTop: 8, fontSize: 11, color: P.error }}>Could not save profile ({error}).</div> : null}
    </div>
  );
}

function ProfileSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 10, color: P.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={profileControlStyle()}>
        {options.map((option) => <option key={option} value={option}>{titleize(option)}</option>)}
      </select>
    </label>
  );
}

function ProfileInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 10, color: P.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} style={profileControlStyle()} />
    </label>
  );
}

function BillersTab({ costData, loading }: { costData: CostData | null; loading: boolean }) {
  return (
    <Section title="Billers" subtitle="Who ultimately charges the account. This is separate from the local runtime or provider that executed the work.">
      {loading ? <p style={{ fontSize: 13, color: P.muted }}>Loading...</p> : (
        <DataRows
          rows={costData?.byBiller ?? []}
          empty="No biller data in this period."
          render={(row) => (
            <Row
              key={row.biller}
              label={row.biller}
              meta={`${row.eventCount} events · metered ${row.meteredEvents} · included ${row.subscriptionEvents}`}
              value={fmtUsd(row.cost)}
              badge={<Badge value={titleize(row.billingType)} type={row.billingType} />}
            />
          )}
        />
      )}
    </Section>
  );
}

function FinanceTab({
  slug,
  costData,
  onFinanceEvent,
}: {
  slug: string;
  costData: CostData | null;
  onFinanceEvent: (event: FinanceEvent) => void;
}) {
  const [eventType, setEventType] = useState("usage");
  const [biller, setBiller] = useState("openai");
  const [provider, setProvider] = useState("openai");
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/orchestration/companies/${encodeURIComponent(slug)}/costs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType,
          biller,
          provider,
          amount: Number(amount),
          occurredAt: occurredAt ? new Date(`${occurredAt}T12:00:00`).toISOString() : undefined,
          description,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { code?: string };
        throw new Error(payload.code ?? String(response.status));
      }
      const payload = await response.json() as { event?: FinanceEvent };
      if (payload.event) onFinanceEvent(payload.event);
      setAmount("");
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Section title="Finance ledger" subtitle="Account-level charges that do not map cleanly to a single inference request.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <InlineMetric label="Debits" value={fmtUsd(costData?.financeDebits ?? 0)} />
          <InlineMetric label="Credits" value={fmtUsd(costData?.financeCredits ?? 0)} />
          <InlineMetric label="Subscriptions" value={fmtUsd(costData?.subscriptionFees ?? 0)} />
          <InlineMetric label="Net account spend" value={fmtUsd(costData?.financeNet ?? 0)} />
        </div>
      </Section>
      <Section title="Add account event" subtitle="Use this for subscription fees, credits, manual adjustments, or account usage entries. Request-level token telemetry remains separate.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(120px, 1fr))", gap: 10, alignItems: "end" }}>
          <ProfileSelect label="Type" value={eventType} options={FINANCE_EVENT_OPTIONS} onChange={setEventType} />
          <ProfileInput label="Biller" value={biller} onChange={setBiller} />
          <ProfileInput label="Provider" value={provider} onChange={setProvider} />
          <ProfileInput label="Amount" value={amount} onChange={setAmount} />
          <ProfileInput label="Date" value={occurredAt} onChange={setOccurredAt} type="date" />
          <button type="button" onClick={() => void save()} disabled={saving} style={{ ...smallButtonStyle(true), height: 32 }}>
            {saving ? "Saving" : "Add event"}
          </button>
        </div>
        <label style={{ display: "grid", gap: 4, marginTop: 10 }}>
          <span style={{ fontSize: 10, color: P.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Description</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} style={profileControlStyle()} placeholder="Subscription renewal, usage adjustment, credit grant..." />
        </label>
        {error ? <div style={{ marginTop: 8, fontSize: 11, color: P.error }}>Could not add finance event ({error}).</div> : null}
      </Section>
      <Section title="Account events" subtitle="Actual billing/account movements, separate from request-scoped token events.">
        <DataRows
          rows={costData?.financeEvents ?? []}
          empty="No account finance events yet."
          render={(event) => (
            <Row
              key={event.id}
              label={event.description || titleize(event.eventType)}
              meta={`${event.biller} · ${event.provider} · ${titleize(event.eventType)} · ${event.source} · ${formatDate(event.occurredAt)}`}
              value={fmtUsd(event.amount)}
              badge={<Badge value={event.currency} type={event.amount < 0 ? "credits" : event.eventType === "subscription" ? "fixed" : "metered_api"} />}
            />
          )}
        />
      </Section>
    </>
  );
}

function SummaryCard({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: ReactNode }) {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 8, border: `0.5px solid ${P.cardBorder}`, background: P.card }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
        {icon}
      </div>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: P.text }}>{value}</p>
      {detail && <p style={{ margin: "4px 0 0", fontSize: 11, color: P.muted }}>{detail}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: P.text }}>{title}</h2>
      {subtitle && <p style={{ margin: "4px 0 14px", fontSize: 12, color: P.muted }}>{subtitle}</p>}
      {!subtitle && <div style={{ height: 12 }} />}
      <div style={{ border: `0.5px solid ${P.cardBorder}`, borderRadius: 8, background: P.card, padding: 18 }}>
        {children}
      </div>
    </section>
  );
}

function InlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minHeight: 70, padding: "10px 0", borderTop: `0.5px solid ${P.cardBorder}` }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
      <p style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 700, color: P.text }}>{value}</p>
    </div>
  );
}

function DataRows<T>({ rows, empty, render }: { rows: T[]; empty: string; render: (row: T) => ReactNode }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: P.muted, margin: 0 }}>{empty}</p>;
  return <div style={{ display: "flex", flexDirection: "column" }}>{rows.map(render)}</div>;
}

function Row({ label, meta, value, badge }: { label: ReactNode; meta: string; value: string; badge?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "10px 0", borderBottom: `0.5px solid ${P.cardBorder}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: P.text, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
          {badge}
        </div>
        <div style={{ fontSize: 11, color: P.muted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</div>
      </div>
      <span style={{ flex: "0 0 auto", fontSize: 13, fontWeight: 700, color: P.text }}>{value}</span>
    </div>
  );
}

function smallButtonStyle(primary = false): CSSProperties {
  return {
    border: `0.5px solid ${primary ? P.cardBorderHover : P.cardBorder}`,
    borderRadius: 5,
    background: primary ? P.accentSoft : "transparent",
    color: primary ? P.text : P.textSec,
    padding: "5px 9px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  };
}

function profileControlStyle(): CSSProperties {
  return {
    height: 32,
    minWidth: 0,
    border: `0.5px solid ${P.cardBorder}`,
    borderRadius: 5,
    background: P.card,
    color: P.text,
    padding: "0 8px",
    fontSize: 12,
    outline: "none",
  };
}

function Badge({ value, type }: { value: string; type: BillingType }) {
  const tone = billingTone(type);
  return (
    <span style={{ flex: "0 0 auto", borderRadius: 4, padding: "2px 6px", fontSize: 10, fontWeight: 700, color: tone.color, background: tone.bg }}>
      {value}
    </span>
  );
}
