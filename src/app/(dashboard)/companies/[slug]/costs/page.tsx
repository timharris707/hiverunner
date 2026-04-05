"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, DollarSign, TrendingUp, Activity, Layers } from "lucide-react";

import { CompanyErrorState } from "@/components/company/company-ui";
import { listCompanies, listTasks } from "@/lib/orchestration/client";
import type { OrchestrationCompany, OrchestrationTask } from "@/lib/orchestration/types";

/* ── Types ── */

type Timeframe = "mtd" | "7d" | "30d" | "ytd" | "all";

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
  topSessions: Array<{ key: string; label: string; cost: number; tokens: number; model: string; date: string }>;
};

/* ── Helpers ── */

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

function taskCompletedInMonth(task: OrchestrationTask, currentMonth: string): boolean {
  if (task.status !== "done") return false;
  const completed = task.completedAt ?? task.updated;
  return monthKey(completed) === currentMonth;
}

/* ── Palette (MC standard stone) ── */

const P = {
  bg: "#0f0f0f",
  surface: "#1a1a1a",
  card: "#1e1e1e",
  cardBorder: "rgba(255,255,255,0.08)",
  text: "#e5e5e5",
  textSec: "#a3a3a3",
  muted: "#737373",
  accent: "#d97706",
};

/* ── Page ── */

export default function CompanyCostsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [tasks, setTasks] = useState<OrchestrationTask[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("mtd");
  const [loading, setLoading] = useState(true);

  const apiTimeframe = timeframe === "mtd" || timeframe === "ytd" || timeframe === "all" ? "90d" : timeframe;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [companies, taskRows, costResponse] = await Promise.all([
          listCompanies(),
          listTasks({ company: slug }),
          fetch(`/api/costs?timeframe=${apiTimeframe}`, { cache: "no-store" }).then(async (r) => {
            if (!r.ok) return null;
            return (await r.json()) as CostData;
          }),
        ]);
        if (cancelled) return;
        setCompany(companies.find((e) => e.slug === slug) ?? null);
        setTasks(taskRows);
        setCostData(costResponse);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [slug, apiTimeframe]);

  /* ── derived data ── */

  const totalTokens = useMemo(() => {
    if (!costData?.byAgent) return 0;
    return costData.byAgent.reduce((s, a) => s + a.tokens, 0);
  }, [costData]);

  const budgetUtilization = useMemo(() => {
    if (!costData || costData.budget <= 0) return 0;
    return Math.min((costData.thisMonth / costData.budget) * 100, 999);
  }, [costData]);

  const completedThisMonth = useMemo(() => {
    const cm = monthKey(new Date().toISOString());
    return tasks.filter((t) => taskCompletedInMonth(t, cm)).length;
  }, [tasks]);

  const costPerTask = useMemo(() => {
    if (!costData || completedThisMonth === 0) return 0;
    return costData.thisMonth / completedThisMonth;
  }, [costData, completedThisMonth]);

  /* ── guards ── */

  if (!loading && !company) {
    return <CompanyErrorState title="Company not found" detail="This company could not be resolved." href="/companies" />;
  }
  if (!loading && !costData) {
    return <CompanyErrorState title="Costs unavailable" detail="Cost telemetry is currently unavailable." href={`/companies/${encodeURIComponent(slug)}`} />;
  }

  /* ── time range buttons ── */

  const RANGES: { key: Timeframe; label: string }[] = [
    { key: "mtd", label: "Month to Date" },
    { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" },
    { key: "ytd", label: "Year to Date" },
    { key: "all", label: "All Time" },
  ];

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1000 }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", fontWeight: 600, color: P.muted, marginBottom: 8 }}>
          Costs
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: P.text, marginBottom: 6 }}>Costs</h1>
        <p style={{ fontSize: 13, color: P.textSec }}>
          Inference spend, budget envelope, and agent cost breakdown.
        </p>
      </div>

      {/* ── Time range selector ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setTimeframe(r.key)}
            style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
              border: `1px solid ${timeframe === r.key ? "rgba(217,119,6,0.5)" : P.cardBorder}`,
              background: timeframe === r.key ? "rgba(217,119,6,0.12)" : "transparent",
              color: timeframe === r.key ? "#fbbf24" : P.textSec,
              cursor: "pointer",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <SummaryCard
          label="Inference Spend"
          value={loading ? "..." : formatUsd(costData?.thisMonth ?? 0)}
          detail={loading ? undefined : `${formatTokens(totalTokens)} tokens across sessions`}
          icon={<DollarSign size={16} color={P.muted} />}
        />
        <SummaryCard
          label="Budget"
          value={loading ? "..." : costData && costData.budget > 0 ? formatUsd(costData.budget) : "Open"}
          detail={loading ? undefined : costData && costData.budget > 0 ? `${budgetUtilization.toFixed(0)}% used` : "No monthly cap configured"}
          icon={<Activity size={16} color={P.muted} />}
        />
        <SummaryCard
          label="Avg Daily"
          value={loading ? "..." : formatUsd(costData?.avgDaily ?? 0)}
          detail={loading ? undefined : `${costData?.daysElapsed ?? 0} days elapsed this month`}
          icon={<TrendingUp size={16} color={P.muted} />}
        />
        <SummaryCard
          label="Projected Month"
          value={loading ? "..." : formatUsd(costData?.projected ?? 0)}
          detail={loading ? undefined : `${costData?.daysInMonth ?? 0} days in month`}
          icon={<Layers size={16} color={P.muted} />}
        />
      </div>

      {/* ── Inference ledger ── */}
      <Section title="Inference ledger" subtitle="Request-scoped inference spend for the selected period.">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <p style={{ fontSize: 28, fontWeight: 700, color: P.text, margin: 0 }}>
              {loading ? "..." : formatUsd(costData?.thisMonth ?? 0)}
            </p>
            <p style={{ fontSize: 13, color: P.muted, marginTop: 4 }}>
              {costData && costData.budget > 0 ? `Budget: ${formatUsd(costData.budget)}` : "Unlimited budget"}
            </p>
          </div>
          <div style={{
            padding: "8px 16px", borderRadius: 8,
            border: `1px solid ${P.cardBorder}`, background: P.card,
            textAlign: "right",
          }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>Usage</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: P.text, margin: "2px 0 0" }}>
              {loading ? "..." : formatTokens(totalTokens)}
            </p>
          </div>
        </div>

        {/* Budget utilization bar */}
        {costData && costData.budget > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: P.muted, marginBottom: 6 }}>
              <span>Remaining</span>
              <span>{formatUsd(Math.max(0, costData.budget - costData.thisMonth))}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "rgba(120,113,108,0.15)", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 999,
                width: `${Math.min(budgetUtilization, 100)}%`,
                background: budgetUtilization >= 90 ? "#ef4444" : budgetUtilization >= 70 ? "#f59e0b" : "#22c55e",
              }} />
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              {budgetUtilization >= 85 ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.08)", color: "#fbbf24" }}>
                  <AlertTriangle size={12} /> Budget utilization above 85%
                </span>
              ) : (
                <span style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.06)", color: "#4ade80" }}>
                  Budget utilization in healthy range
                </span>
              )}
              <span style={{ color: P.muted }}>
                Projected month-end: <strong style={{ color: P.textSec }}>{formatUsd(costData.projected)}</strong>
              </span>
            </div>
          </div>
        )}
      </Section>

      {/* ── By agent ── */}
      <Section title="By agent" subtitle="What each agent consumed in the selected period.">
        {loading ? (
          <p style={{ fontSize: 13, color: P.muted }}>Loading...</p>
        ) : costData?.byAgent?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {costData.byAgent.map((row) => {
              const share = costData.thisMonth > 0 ? (row.cost / costData.thisMonth) * 100 : 0;
              return (
                <div key={row.agent} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "10px 0", borderBottom: `1px solid ${P.cardBorder}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 6, background: "rgba(120,113,108,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 600, color: P.muted, textTransform: "uppercase",
                    }}>
                      {row.agent.slice(0, 2)}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: P.text }}>{row.agent}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: P.text }}>{formatUsd(row.cost)}</span>
                    <div style={{ fontSize: 11, color: P.muted }}>
                      in {formatTokens(row.inputTokens)} · out {formatTokens(row.outputTokens)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: P.muted }}>No agent spend data available.</p>
        )}
      </Section>

      {/* ── By model ── */}
      <Section title="By model" subtitle="Spend breakdown by model provider.">
        {loading ? (
          <p style={{ fontSize: 13, color: P.muted }}>Loading...</p>
        ) : costData?.byModel?.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {costData.byModel.map((row) => (
              <div key={row.model} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 0", borderBottom: `1px solid ${P.cardBorder}`,
              }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: P.text, fontFamily: "var(--font-mono, monospace)" }}>{row.model}</span>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: P.text }}>{formatUsd(row.cost)}</span>
                  <div style={{ fontSize: 11, color: P.muted }}>{formatTokens(row.tokens)} tokens</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: P.muted }}>No model data available.</p>
        )}
      </Section>

      {/* ── Task throughput ── */}
      <Section title="Task throughput" subtitle="Cost-per-task derived from this month's spend divided by completed tasks.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <MetricCard label="Total Tasks" value={String(tasks.length)} />
          <MetricCard label="Completed This Month" value={String(completedThisMonth)} />
          <MetricCard label="Cost Per Task" value={completedThisMonth > 0 ? formatUsd(costPerTask) : "n/a"} />
        </div>
      </Section>
    </div>
  );
}

/* ── Shared sub-components ── */

function SummaryCard({ label, value, detail, icon }: { label: string; value: string; detail?: string; icon: React.ReactNode }) {
  return (
    <div style={{
      padding: "16px 18px", borderRadius: 10,
      border: `1px solid ${P.cardBorder}`, background: P.card,
    }}>
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
    <div style={{
      marginBottom: 20, padding: "20px", borderRadius: 10,
      border: `1px solid ${P.cardBorder}`, background: P.card,
    }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: P.text }}>{title}</h2>
      {subtitle && <p style={{ margin: "4px 0 16px", fontSize: 12, color: P.muted }}>{subtitle}</p>}
      {!subtitle && <div style={{ height: 12 }} />}
      {children}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: "12px 16px", borderRadius: 8,
      border: `1px solid ${P.cardBorder}`, background: "rgba(28,25,23,0.5)",
    }}>
      <p style={{ margin: 0, fontSize: 11, color: P.muted }}>{label}</p>
      <p style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 600, color: P.text }}>{value}</p>
    </div>
  );
}
