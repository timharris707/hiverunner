"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, DollarSign } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { listCompanies } from "@/lib/orchestration/client";
import type { OrchestrationCompany } from "@/lib/orchestration/types";
import { P as tokens } from "@/lib/ui/tokens";

/* ── Types ── */

type Timeframe = "mtd" | "7d" | "30d" | "ytd" | "all";
type CostsTab = "overview" | "budgets" | "providers" | "billers" | "finance";

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
  byAgent: Array<{ agent: string; cost: number; tokens: number; inputTokens: number; outputTokens: number }>;
  byModel: Array<{ model: string; cost: number; tokens: number; inputTokens: number; outputTokens: number }>;
};

/* ── Helpers ── */

function fmtUsd(v: number): string { return `$${v.toFixed(2)}`; }
function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/* ── Palette (from shared tokens) ── */

const P = {
  card: tokens.surface,
  cardBorder: tokens.cardBorder,
  text: tokens.text,
  textSec: tokens.textSec,
  muted: tokens.muted,
};

/* ── Page ── */

export default function CompanyCostsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("mtd");
  const [tab, setTab] = useState<CostsTab>("overview");
  const [loading, setLoading] = useState(true);

  const apiTf = timeframe === "mtd" || timeframe === "ytd" || timeframe === "all" ? "90d" : timeframe;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [companies, costResp] = await Promise.all([
          listCompanies(),
          fetch(`/api/costs?timeframe=${apiTf}`, { cache: "no-store" }).then(async (r) => r.ok ? (await r.json()) as CostData : null),
        ]);
        if (cancelled) return;
        setCompany(companies.find((e) => e.slug === slug) ?? null);
        setCostData(costResp);
      } finally { if (!cancelled) setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, apiTf]);

  const totalTokens = useMemo(() => costData?.byAgent?.reduce((s, a) => s + a.tokens, 0) ?? 0, [costData]);
  const budgetUtil = useMemo(() => costData && costData.budget > 0 ? Math.min((costData.thisMonth / costData.budget) * 100, 999) : 0, [costData]);

  if (!loading && !company) return <CompanyErrorState title="Company not found" detail="This company could not be resolved." href="/companies" />;
  if (!loading && !costData) return <CompanyErrorState title="Costs unavailable" detail="Cost telemetry is currently unavailable." href={`/companies/${encodeURIComponent(slug)}`} />;

  const RANGES: { key: Timeframe; label: string }[] = [
    { key: "mtd", label: "Month to Date" }, { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" }, { key: "ytd", label: "Year to Date" }, { key: "all", label: "All Time" },
  ];
  const TABS: { key: CostsTab; label: string }[] = [
    { key: "overview", label: "Overview" }, { key: "budgets", label: "Budgets" },
    { key: "providers", label: "Providers" }, { key: "billers", label: "Billers" }, { key: "finance", label: "Finance" },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1000 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 6 }}>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 600, color: P.text, margin: "0 0 6px", letterSpacing: "-0.01em" }}>Costs</h1>
          <p style={{ fontSize: 13, color: P.textSec, margin: 0 }}>Inference spend, platform fees, credits, and live quota windows.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setTimeframe(r.key)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
              border: `0.5px solid ${timeframe === r.key ? tokens.cardBorderHover : P.cardBorder}`,
              background: timeframe === r.key ? "rgba(255,255,255,0.08)" : "transparent",
              color: timeframe === r.key ? P.text : P.textSec,
            }}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* ── 4 summary cards (Paperclip parity) ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, margin: "20px 0" }}>
        <SummaryCard label="Inference Spend" value={loading ? "..." : fmtUsd(costData?.thisMonth ?? 0)} detail={`${fmtTok(totalTokens)} tokens across request-scoped events`} icon={<DollarSign size={16} color={P.muted} />} />
        <SummaryCard label="Budget" value={loading ? "..." : costData && costData.budget > 0 ? fmtUsd(costData.budget) : "Open"} detail={costData && costData.budget > 0 ? `${budgetUtil.toFixed(0)}% used` : "No monthly cap configured"} />
        <SummaryCard label="Finance Net" value="—" detail="Finance ledger not connected" />
        <SummaryCard label="Finance Events" value="0" detail="No finance events in range" />
      </div>

      {/* ── Tab bar ── */}
      <div style={{ borderBottom: `0.5px solid ${P.cardBorder}`, marginBottom: 20 }}>
        <nav style={{ display: "flex", gap: 0 }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{
              position: "relative", padding: "8px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer",
              background: "none", border: "none", color: tab === t.key ? P.text : P.muted,
            }}>
              {t.label}
              {tab === t.key && <span style={{ position: "absolute", bottom: -1, left: 0, right: 0, height: 2, background: P.text }} />}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab content ── */}
      {tab === "overview" && <OverviewTab costData={costData} totalTokens={totalTokens} budgetUtil={budgetUtil} loading={loading} />}
      {tab === "budgets" && <BudgetsTab />}
      {tab === "providers" && <ProvidersTab costData={costData} loading={loading} />}
      {tab === "billers" && <BillersTab />}
      {tab === "finance" && <FinanceTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab: Overview
   ═══════════════════════════════════════════════════════════ */

function OverviewTab({ costData, totalTokens, budgetUtil, loading }: { costData: CostData | null; totalTokens: number; budgetUtil: number; loading: boolean }) {
  return (
    <>
      {/* Inference ledger */}
      <Section title="Inference ledger" subtitle="Request-scoped inference spend for the selected period.">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p style={{ fontSize: 28, fontWeight: 700, color: P.text, margin: 0 }}>{loading ? "..." : fmtUsd(costData?.thisMonth ?? 0)}</p>
            <p style={{ fontSize: 13, color: P.muted, marginTop: 4 }}>
              {costData && costData.budget > 0 ? `Budget: ${fmtUsd(costData.budget)}` : "Unlimited budget"}
            </p>
          </div>
          <div style={{ padding: "8px 16px", borderRadius: 8, border: `0.5px solid ${P.cardBorder}`, background: "transparent", textAlign: "right" }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>Usage</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: P.text, margin: "2px 0 0" }}>{loading ? "..." : fmtTok(totalTokens)}</p>
          </div>
        </div>
        {costData && costData.budget > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: P.muted, marginBottom: 6 }}>
              <span>Remaining</span><span>{fmtUsd(Math.max(0, costData.budget - costData.thisMonth))}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(120,113,108,0.15)", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(budgetUtil, 100)}%`, background: budgetUtil >= 90 ? "#ef4444" : budgetUtil >= 70 ? "#f59e0b" : "#22c55e" }} />
            </div>
          </div>
        )}
      </Section>

      {/* Finance ledger — gap state */}
      <Section title="Finance ledger" subtitle="Account-level charges that do not map to a single inference request.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <GapCard label="Debits" detail="Finance ledger not connected" />
          <GapCard label="Credits" detail="Finance ledger not connected" />
          <GapCard label="Net" detail="Finance ledger not connected" />
          <GapCard label="Estimated" detail="Finance ledger not connected" />
        </div>
      </Section>

      {/* By agent */}
      <Section title="By agent" subtitle="What each agent consumed in the selected period.">
        {loading ? <p style={{ fontSize: 13, color: P.muted }}>Loading...</p> : costData?.byAgent?.length ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {costData.byAgent.map((row) => (
              <div key={row.agent} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `0.5px solid ${P.cardBorder}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 6, background: "rgba(120,113,108,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase" }}>{row.agent.slice(0, 2)}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: P.text }}>{row.agent}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: P.text }}>{fmtUsd(row.cost)}</span>
                  <div style={{ fontSize: 11, color: P.muted }}>in {fmtTok(row.inputTokens)} · out {fmtTok(row.outputTokens)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : <p style={{ fontSize: 13, color: P.muted }}>No agent spend data available.</p>}
      </Section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab: Budgets
   ═══════════════════════════════════════════════════════════ */

function BudgetsTab() {
  return (
    <>
      <Section title="Budget control plane" subtitle="Hard-stop spend limits for agents and projects. Provider subscription quota stays separate and appears under Providers.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <GapCard label="Active Incidents" detail="Budget control plane not connected" />
          <GapCard label="Pending Approvals" detail="Budget control plane not connected" />
          <GapCard label="Paused Agents" detail="Budget control plane not connected" />
          <GapCard label="Paused Projects" detail="Budget control plane not connected" />
        </div>
      </Section>
      <Section title="Agent budgets" subtitle="Recurring monthly spend policies for individual agents.">
        <p style={{ fontSize: 13, color: P.muted }}>No agent budget policies configured. Budget management requires the Paperclip budget control plane.</p>
      </Section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab: Providers  (MC has truthful by-model data here)
   ═══════════════════════════════════════════════════════════ */

function ProvidersTab({ costData, loading }: { costData: CostData | null; loading: boolean }) {
  return (
    <Section title="By model" subtitle="Spend breakdown by model provider. Mission Control tracks per-model cost from session telemetry.">
      {loading ? <p style={{ fontSize: 13, color: P.muted }}>Loading...</p> : costData?.byModel?.length ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {costData.byModel.map((row) => (
            <div key={row.model} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `0.5px solid ${P.cardBorder}` }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: P.text, fontFamily: "var(--font-mono, monospace)" }}>{row.model}</span>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: P.text }}>{fmtUsd(row.cost)}</span>
                <div style={{ fontSize: 11, color: P.muted }}>{fmtTok(row.tokens)} tokens</div>
              </div>
            </div>
          ))}
        </div>
      ) : <p style={{ fontSize: 13, color: P.muted }}>No provider data available.</p>}
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab: Billers
   ═══════════════════════════════════════════════════════════ */

function BillersTab() {
  return (
    <Section title="Billers" subtitle="Account-level financial events grouped by who charged or credited them.">
      <p style={{ fontSize: 13, color: P.muted }}>Biller tracking requires the Paperclip finance ledger. No biller data available in Mission Control.</p>
    </Section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab: Finance
   ═══════════════════════════════════════════════════════════ */

function FinanceTab() {
  return (
    <>
      <Section title="Finance ledger" subtitle="Account-level charges that do not map to a single inference request.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <GapCard label="Debits" detail="Finance ledger not connected" />
          <GapCard label="Credits" detail="Finance ledger not connected" />
          <GapCard label="Net" detail="Finance ledger not connected" />
          <GapCard label="Estimated" detail="Finance ledger not connected" />
        </div>
      </Section>
      <Section title="By biller" subtitle="Account-level financial events grouped by who charged or credited them.">
        <p style={{ fontSize: 13, color: P.muted }}>No finance events yet.</p>
      </Section>
      <Section title="Recent financial events" subtitle="Top-ups, fees, credits, commitments, and other non-request charges.">
        <p style={{ fontSize: 13, color: P.muted }}>No financial events in this period.</p>
      </Section>
    </>
  );
}

/* ── Shared sub-components ── */

function SummaryCard({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon?: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 10, border: `0.5px solid ${P.cardBorder}`, background: "transparent" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
        {icon}
      </div>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: P.text }}>{value}</p>
      {detail && <p style={{ margin: "4px 0 0", fontSize: 11, color: P.muted }}>{detail}</p>}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20, padding: 20, borderRadius: 10, border: `0.5px solid ${P.cardBorder}`, background: "transparent" }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: P.text }}>{title}</h2>
      {subtitle && <p style={{ margin: "4px 0 16px", fontSize: 12, color: P.muted }}>{subtitle}</p>}
      {!subtitle && <div style={{ height: 12 }} />}
      {children}
    </div>
  );
}

function GapCard({ label, detail }: { label: string; detail: string }) {
  return (
    <div style={{ padding: "14px 18px", borderRadius: 8, border: `0.5px solid ${P.cardBorder}`, background: "transparent" }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</p>
      <p style={{ margin: "6px 0 0", fontSize: 20, fontWeight: 700, color: P.muted }}>—</p>
      <p style={{ margin: "4px 0 0", fontSize: 11, color: P.muted }}>{detail}</p>
    </div>
  );
}
