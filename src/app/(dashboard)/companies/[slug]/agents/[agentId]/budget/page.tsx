"use client";

import { DollarSign, TrendingUp, BarChart3 } from "lucide-react";
import { useAgentProfile, A } from "../agent-context";

export default function AgentBudgetPage() {
  const { profile } = useAgentProfile();
  const { agent } = profile;
  const usage = profile.usageSummary;
  const totalRuns = usage?.totalRuns ?? profile.executionHistory.length;
  const completedRuns = usage?.completedRuns ?? profile.executionHistory.filter((r) => r.status === "completed" || r.status === "succeeded").length;
  const failedRuns = usage?.failedRuns ?? profile.executionHistory.filter((r) => r.status === "failed" || r.status === "timed_out").length;
  const totalDurationMs = usage?.totalDurationMs ?? profile.executionHistory.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const runtimeMinutes = Math.round(totalDurationMs / 60_000);
  const totalCost = usage?.totalCostUsd ?? profile.executionHistory.reduce((sum, r) => sum + (r.totalCostUsd ?? 0), 0);
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cacheReadTokens = usage?.cacheReadTokens ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ── Usage Stats ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, color: A.textSec, fontSize: 12, fontWeight: 600 }}>
          <BarChart3 size={13} />
          Usage Summary
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <StatCard label="Total Runtime" value={`${runtimeMinutes}m`} sub="minutes" />
          <StatCard label="Total Runs" value={String(totalRuns)} sub="executions" />
          <StatCard label="Completed" value={String(completedRuns)} sub="successful" />
          <StatCard label="Failed" value={String(failedRuns)} sub="errors" alert={failedRuns > 0} />
          <StatCard label="Total Duration" value={`${Math.round(totalDurationMs / 1000)}s`} sub="across all runs" />
          <StatCard label="Tasks Completed" value={String(agent.tasksCompleted ?? 0)} sub="lifetime" />
          <StatCard label="Input Tokens" value={formatTokens(inputTokens)} sub="recorded usage" />
          <StatCard label="Output Tokens" value={formatTokens(outputTokens)} sub="recorded usage" />
          <StatCard label="Cached Tokens" value={formatTokens(cacheReadTokens)} sub="cache read" />
        </div>
      </div>

      {/* ── Cost Tracking ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, color: A.textSec, fontSize: 12, fontWeight: 600 }}>
          <DollarSign size={13} />
          Cost Tracking
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 14 }}>
          <StatCard label="Recorded Cost" value={`$${totalCost.toFixed(2)}`} sub="from run telemetry" />
          <StatCard label="Avg Cost / Run" value={totalRuns > 0 ? `$${(totalCost / totalRuns).toFixed(3)}` : "\u2014"} sub="per execution" />
        </div>
        <p style={{ fontSize: 11, color: A.muted, margin: 0 }}>
          Costs are shown only when a runtime reports spend telemetry. Subscription-included and local runs may report tokens without dollars.
        </p>
      </div>

      {/* ── Budget Limits ── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, color: A.textSec, fontSize: 12, fontWeight: 600 }}>
          <TrendingUp size={13} />
          Budget Limits
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <BudgetRow label="Monthly budget" value="No limit set" />
          <BudgetRow label="Max runtime per task" value="No limit set" />
          <BudgetRow label="Daily run cap" value="No limit set" />
        </div>
        <p style={{ fontSize: 11, color: A.muted, margin: "10px 0 0" }}>
          Budget limits are not yet enforced. Configure limits to prevent runaway costs.
        </p>
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function StatCard({ label, value, sub, alert }: { label: string; value: string; sub: string; alert?: boolean }) {
  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8,
      background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.05)",
    }}>
      <div style={{ fontSize: 10, color: A.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: alert ? "#f87171" : A.text, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 10, color: A.muted, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function BudgetRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.02)", border: "0.5px solid rgba(255,255,255,0.05)" }}>
      <span style={{ fontSize: 12, color: A.textSec }}>{label}</span>
      <span style={{ fontSize: 12, color: A.muted, fontStyle: "italic" }}>{value}</span>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 10,
  background: A.card,
  border: `0.5px solid ${A.cardBorder}`,
};
