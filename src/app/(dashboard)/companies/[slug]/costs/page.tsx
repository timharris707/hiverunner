"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, DollarSign } from "lucide-react";

import { CompanyErrorState, CompanyShell, StatCard } from "@/components/company/company-ui";
import { listCompanies, listTasks } from "@/lib/orchestration/client";
import type { OrchestrationCompany, OrchestrationTask } from "@/lib/orchestration/types";

type Timeframe = "7d" | "30d" | "90d";

type CostData = {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  projected: number;
  budget: number;
  byAgent: Array<{ agent: string; cost: number; tokens: number }>;
};

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

function taskCompletedInMonth(task: OrchestrationTask, currentMonth: string): boolean {
  if (task.status !== "done") return false;
  const completed = task.completedAt ?? task.updated;
  return monthKey(completed) === currentMonth;
}

export default function CompanyCostsPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "";

  const [company, setCompany] = useState<OrchestrationCompany | null>(null);
  const [costData, setCostData] = useState<CostData | null>(null);
  const [tasks, setTasks] = useState<OrchestrationTask[]>([]);
  const [timeframe, setTimeframe] = useState<Timeframe>("30d");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [companies, taskRows, costResponse] = await Promise.all([
          listCompanies(),
          listTasks({ company: slug }),
          fetch(`/api/costs?timeframe=${timeframe}`, { cache: "no-store" }).then(async (response) => {
            if (!response.ok) return null;
            return (await response.json()) as CostData;
          }),
        ]);

        if (cancelled) return;

        const current = companies.find((entry) => entry.slug === slug) ?? null;
        setCompany(current);
        setTasks(taskRows);
        setCostData(costResponse);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [slug, timeframe]);

  const budgetUtilization = useMemo(() => {
    if (!costData || costData.budget <= 0) return 0;
    return Math.min((costData.thisMonth / costData.budget) * 100, 999);
  }, [costData]);

  const costPerTask = useMemo(() => {
    if (!costData) return 0;
    const currentMonth = monthKey(new Date().toISOString());
    const completedCount = tasks.filter((task) => taskCompletedInMonth(task, currentMonth)).length;
    if (completedCount === 0) return 0;
    return costData.thisMonth / completedCount;
  }, [costData, tasks]);

  const completedThisMonth = useMemo(() => {
    const currentMonth = monthKey(new Date().toISOString());
    return tasks.filter((task) => taskCompletedInMonth(task, currentMonth)).length;
  }, [tasks]);

  if (!loading && !company) {
    return (
      <CompanyErrorState
        title="Company not found"
        detail="This company could not be resolved from orchestration records."
        href="/companies"
      />
    );
  }

  if (!loading && !costData) {
    return (
      <CompanyErrorState
        title="Costs unavailable"
        detail="Cost telemetry is currently unavailable for this company route."
        href={`/companies/${encodeURIComponent(slug)}`}
      />
    );
  }

  return (
    <CompanyShell
      eyebrow="Costs"
      title={company ? `${company.name} Costs` : "Company Costs"}
      description="Company-scoped cost and budget view for orchestration work."
      accentColor="#f59e0b"
    >
      <section className="rounded-2xl border border-white/10 bg-slate-950/65 p-4 backdrop-blur-xl md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm text-slate-300">
            <DollarSign className="h-4 w-4 text-amber-200" />
            Existing spend feed + budget envelope from current runtime cost telemetry.
          </div>
          <div className="inline-flex items-center gap-2">
            {(["7d", "30d", "90d"] as const).map((window) => {
              const active = timeframe === window;
              return (
                <button
                  key={window}
                  type="button"
                  onClick={() => setTimeframe(window)}
                  className="rounded-lg border px-2.5 py-1.5 text-xs uppercase tracking-wide transition"
                  style={{
                    borderColor: active ? "rgba(251,191,36,0.55)" : "rgba(148,163,184,0.25)",
                    background: active ? "rgba(146,64,14,0.25)" : "rgba(15,23,42,0.45)",
                    color: active ? "#fef3c7" : "#cbd5e1",
                  }}
                >
                  {window}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Today" value={loading ? "..." : formatUsd(costData?.today ?? 0)} accentColor="#22d3ee" />
        <StatCard label="This Month" value={loading ? "..." : formatUsd(costData?.thisMonth ?? 0)} accentColor="#f59e0b" />
        <StatCard label="Budget" value={loading ? "..." : formatUsd(costData?.budget ?? 0)} accentColor="#6366f1" />
        <StatCard label="Budget Used" value={loading ? "..." : `${budgetUtilization.toFixed(1)}%`} accentColor="#ef4444" />
        <StatCard
          label="Cost / Completed Task"
          value={loading ? "..." : completedThisMonth > 0 ? formatUsd(costPerTask) : "$0.00"}
          detail={loading ? undefined : `${completedThisMonth} completed this month`}
          accentColor="#34d399"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr,1fr]">
        <article className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Budget Utilization</h2>
            <span className="text-xs text-slate-400">
              {loading ? "..." : `${formatUsd(costData?.thisMonth ?? 0)} / ${formatUsd(costData?.budget ?? 0)}`}
            </span>
          </div>
          <div className="h-3 overflow-hidden rounded-full border border-white/10 bg-slate-900">
            <div
              className="h-full transition-all"
              style={{
                width: `${Math.min(budgetUtilization, 100)}%`,
                background:
                  budgetUtilization >= 90
                    ? "linear-gradient(90deg, #dc2626, #f97316)"
                    : budgetUtilization >= 70
                    ? "linear-gradient(90deg, #f59e0b, #f97316)"
                    : "linear-gradient(90deg, #14b8a6, #22d3ee)",
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {budgetUtilization >= 85 ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-300/35 bg-amber-500/12 px-2 py-1 text-amber-100">
                <AlertTriangle className="h-3.5 w-3.5" />
                Budget utilization above 85%
              </span>
            ) : (
              <span className="rounded-md border border-emerald-300/20 bg-emerald-500/10 px-2 py-1 text-emerald-100">
                Budget utilization in healthy range
              </span>
            )}
            <span>
              Projected month-end: <strong className="text-slate-200">{loading ? "..." : formatUsd(costData?.projected ?? 0)}</strong>
            </span>
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 md:p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Task Throughput Context</h2>
          <div className="space-y-2 text-sm text-slate-300">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>Total Tasks</span>
              <strong>{tasks.length}</strong>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>Completed This Month</span>
              <strong>{completedThisMonth}</strong>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
              <span>Cost Per Completed Task</span>
              <strong>{completedThisMonth > 0 ? formatUsd(costPerTask) : "n/a"}</strong>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Cost-per-task is derived from this month spend divided by company tasks completed this month.
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-300">Agent Spending</h2>
          <Link href={`/companies/${encodeURIComponent(slug)}/team`} className="text-xs text-cyan-200 hover:text-cyan-100">
            Open Team Roster
          </Link>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400">Loading spending rows...</p>
        ) : costData?.byAgent?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] table-fixed text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Agent</th>
                  <th className="px-2 py-2">Spend</th>
                  <th className="px-2 py-2">Tokens</th>
                  <th className="px-2 py-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {costData.byAgent.map((row) => {
                  const share = costData.thisMonth > 0 ? (row.cost / costData.thisMonth) * 100 : 0;
                  return (
                    <tr key={row.agent} className="border-t border-white/10 text-slate-200">
                      <td className="px-2 py-2">{row.agent}</td>
                      <td className="px-2 py-2">{formatUsd(row.cost)}</td>
                      <td className="px-2 py-2">{row.tokens.toLocaleString()}</td>
                      <td className="px-2 py-2">{share.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No agent spend rows available for the selected timeframe.</p>
        )}
      </section>
    </CompanyShell>
  );
}
