import type { ComponentType, CSSProperties } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Clock3,
  Gauge,
  Radar,
  TrendingUp,
} from "lucide-react";

import AutoRefresh from "./AutoRefresh";
import { loadLeadLagDashboardData, type LeadLagDashboardRun } from "@/lib/leadlag-dashboard";

export const dynamic = "force-dynamic";

function formatStamp(value: string | null): string {
  if (!value) return "Unknown";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function formatSpread(value: number | null): string {
  if (typeof value !== "number") return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function formatPercent(value: number | null): string {
  if (typeof value !== "number") return "—";
  return `${Math.round(value * 100)}%`;
}

function formatLeaderSummary(value: Record<string, number>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "None yet";
  return entries.map(([key, count]) => `${key} ${count}`).join(" · ");
}

function formatAssetSummary(value: Record<string, number>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return "No attributed assets yet";
  return entries.map(([key, count]) => `${key} ${count}`).join(" · ");
}

function formatRunAssetSummary(run: LeadLagDashboardRun): string {
  return run.assetLabel;
}

function formatRunCoverage(run: LeadLagDashboardRun): string {
  return `${run.coverage.totalCapturedQuoteObservations}/${run.coverage.totalSupportedMatchObservations} obs`;
}

function seriousnessRead(params: {
  thresholdCountMet: number;
  thresholdCountTotal: number;
  verdictCron: string | null;
  evidenceBreadthLabel: string;
}): { label: string; color: string; tone: string } {
  const breadthGood = params.evidenceBreadthLabel === "Cross-asset/window evidence present";
  if (params.verdictCron === "eligible_to_unpause" && params.thresholdCountMet === params.thresholdCountTotal && breadthGood) {
    return {
      label: "Looks serious enough for proof-mode review",
      color: "var(--positive)",
      tone: "The system has crossed the current confidence gate.",
    };
  }
  if (params.thresholdCountMet >= 1) {
    return {
      label: "Alive, but not yet serious enough",
      color: "var(--accent)",
      tone: "There is signal collection, but not enough proof quality yet.",
    };
  }
  return {
    label: "Too early to take seriously",
    color: "var(--negative)",
    tone: "We need materially better evidence before this deserves conviction.",
  };
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  color,
}: {
  icon: ComponentType<{ size?: number; style?: CSSProperties }>;
  label: string;
  value: string;
  subtext: string;
  color: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
            {label}
          </div>
          <div
            className="text-[26px] font-bold mt-1"
            style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
          >
            {value}
          </div>
          <div className="text-[12px] mt-1" style={{ color: "var(--text-muted)" }}>
            {subtext}
          </div>
        </div>
        <div
          className="w-10 h-10 rounded-[10px] flex items-center justify-center"
          style={{ backgroundColor: "var(--surface-hover)", border: `1px solid ${color}` }}
        >
          <Icon size={18} style={{ color }} />
        </div>
      </div>
    </div>
  );
}

function ThresholdCard({
  label,
  current,
  target,
  met,
  currentLabel,
  targetLabel,
}: {
  label: string;
  current: number;
  target: number;
  met: boolean;
  currentLabel?: string;
  targetLabel?: string;
}) {
  const progress = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const color = met ? "var(--positive)" : current > 0 ? "var(--accent)" : "var(--negative)";

  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: "var(--card)", border: `1px solid ${met ? "var(--positive)" : "var(--border)"}` }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </div>
        <span
          className="text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded-full"
          style={{
            color,
            backgroundColor: "var(--surface-hover)",
            border: `1px solid ${color}`,
          }}
        >
          {met ? "Met" : "Pending"}
        </span>
      </div>
      <div className="flex items-end gap-2 mt-3">
        <div
          className="text-[26px] font-bold leading-none"
          style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
        >
          {currentLabel ?? current}
        </div>
        <div className="text-[12px] mb-0.5" style={{ color: "var(--text-muted)" }}>
          / {targetLabel ?? target}
        </div>
      </div>
      <div
        className="mt-3 h-2 rounded-full overflow-hidden"
        style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${progress}%`, backgroundColor: color, transition: "width 180ms ease" }}
        />
      </div>
      <div className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
        {progress}% of current confidence gate
      </div>
    </div>
  );
}

export default async function LeadLagPage() {
  const dashboard = loadLeadLagDashboardData();
  const seriousness = seriousnessRead({
    thresholdCountMet: dashboard.thresholds.filter((item) => item.met).length,
    thresholdCountTotal: dashboard.thresholds.length,
    verdictCron: dashboard.verdictCron,
    evidenceBreadthLabel: dashboard.evidenceBreadthLabel,
  });

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      <AutoRefresh intervalMs={30_000} />

      <div className="mb-6">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-[42px] h-[42px] rounded-[10px] flex items-center justify-center"
            style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
          >
            <ArrowRightLeft size={22} color="#d97706" />
          </div>
          <div>
            <h1
              className="text-[22px] font-bold m-0"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
            >
              Lead/Lag Monitor
            </h1>
            <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
              Polymarket vs Kalshi crypto lead/lag evidence dashboard · auto-refreshes every 30 seconds
            </p>
          </div>
        </div>

        <div
          className="rounded-xl p-4"
          style={{
            background: `linear-gradient(135deg, ${seriousness.color}16, rgba(255,255,255,0.02))`,
            border: `1px solid ${seriousness.color}33`,
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${seriousness.color}18`, border: `1px solid ${seriousness.color}33` }}
            >
              <Gauge size={18} style={{ color: seriousness.color }} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
                Seriousness read
              </div>
              <div className="text-[16px] font-semibold mt-1" style={{ color: seriousness.color }}>
                {seriousness.label}
              </div>
              <div className="text-[12px] mt-1" style={{ color: "var(--text-muted)" }}>
                {seriousness.tone}
              </div>
            </div>
          </div>
        </div>
      </div>

      {!dashboard.available ? (
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "var(--card)", border: "1px solid rgba(239,68,68,0.28)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={18} style={{ color: "var(--negative)" }} />
            <div className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Dashboard unavailable
            </div>
          </div>
          <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {dashboard.error}
          </div>
          <div className="text-[11px] mt-3" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            Expected artifacts under: {dashboard.artifactDir}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
            <StatCard
              icon={dashboard.verdictCron === "eligible_to_unpause" ? CheckCircle2 : AlertCircle}
              label="Verdict gate"
              value={dashboard.verdictCron === "eligible_to_unpause" ? "Ready" : "Paused"}
              subtext={dashboard.verdictReason ?? "No verdict recommendation yet"}
              color={dashboard.verdictCron === "eligible_to_unpause" ? "var(--positive)" : "var(--accent)"}
            />
            <StatCard
              icon={Activity}
              label="Pinned runs"
              value={String(dashboard.runCount)}
              subtext={`Updated ${formatStamp(dashboard.generatedAtUtc)}`}
              color="#d97706"
            />
            <StatCard
              icon={Radar}
              label="Attribution events"
              value={String(dashboard.eventCountTotal)}
              subtext={formatLeaderSummary(dashboard.leaderCountsTotal)}
              color="#60a5fa"
            />
            <StatCard
              icon={TrendingUp}
              label="Confirmed follow-throughs"
              value={String(dashboard.confirmedFollowCountTotal)}
              subtext={formatAssetSummary(dashboard.assetsTotal)}
              color="var(--positive)"
            />
            <StatCard
              icon={Activity}
              label="Coverage rate"
              value={formatPercent(dashboard.coverage.coverageRate)}
              subtext={`${dashboard.coverage.totalCapturedQuoteObservations}/${dashboard.coverage.totalSupportedMatchObservations} supported observations · missed ${dashboard.coverage.missedSupportedMatchObservations}`}
              color={dashboard.coverage.coverageRate !== null && dashboard.coverage.coverageRate >= 0.95 ? "var(--positive)" : dashboard.coverage.coverageRate !== null && dashboard.coverage.coverageRate >= 0.7 ? "var(--accent)" : "var(--negative)"}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4 mb-6">
            <div
              className="rounded-xl p-5"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 size={18} style={{ color: "#d97706" }} />
                <h2
                  className="text-[16px] font-semibold m-0"
                  style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
                >
                  Confidence thresholds
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {dashboard.thresholds.map((threshold) => (
                  <ThresholdCard
                    key={threshold.key}
                    label={threshold.label}
                    current={threshold.current}
                    target={threshold.target}
                    met={threshold.met}
                    currentLabel={threshold.currentLabel}
                    targetLabel={threshold.targetLabel}
                  />
                ))}
              </div>
              <div
                className="mt-4 rounded-xl p-4"
                style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
              >
                <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
                  Breadth check
                </div>
                <div className="text-[14px] font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
                  {dashboard.evidenceBreadthLabel}
                </div>
                <div className="text-[12px] mt-1" style={{ color: "var(--text-muted)" }}>
                  This is the &quot;not one lucky asset/window cluster&quot; rule we talked about.
                </div>
              </div>
            </div>

            <div
              className="rounded-xl p-5"
              style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Clock3 size={18} style={{ color: "#d97706" }} />
                <h2
                  className="text-[16px] font-semibold m-0"
                  style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
                >
                  Latest run quality
                </h2>
              </div>
              {dashboard.latestRun ? (
                <>
                  <div
                    className="rounded-xl p-4"
                    style={{
                      backgroundColor: "var(--card-elevated)",
                      border: `1px solid ${dashboard.latestRun.eventCount > 0 ? "rgba(96,165,250,0.28)" : "var(--border)"}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--text-muted)" }}>
                          Latest run
                        </div>
                        <div className="text-[15px] font-semibold mt-1" style={{ color: "var(--text-primary)" }}>
                          {dashboard.latestRun.runDir}
                        </div>
                      </div>
                      <span
                        className="text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded-full"
                        style={{
                          color: dashboard.latestRun.confirmedFollowCount > 0 ? "var(--positive)" : dashboard.latestRun.eventCount > 0 ? "var(--info)" : "var(--accent)",
                          backgroundColor: "var(--surface-hover)",
                        }}
                      >
                        {dashboard.latestRun.note}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-4 text-[12px]">
                      <div>
                        <div style={{ color: "var(--text-muted)" }}>Updated</div>
                        <div style={{ color: "var(--text-primary)" }}>{formatStamp(dashboard.latestRun.generatedAtUtc)}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)" }}>Primary market</div>
                        <div style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                          {dashboard.latestRun.primaryCanonicalMarketId ?? dashboard.latestRun.pinnedCanonicalMarketId ?? "None"}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)" }}>Events / confirmations</div>
                        <div style={{ color: "var(--text-primary)" }}>
                          {dashboard.latestRun.eventCount} / {dashboard.latestRun.confirmedFollowCount}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)" }}>Avg net spread</div>
                        <div style={{ color: "var(--text-primary)" }}>
                          {formatSpread(dashboard.latestRun.avgMedianNetSpreadAfterFees)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)" }}>Coverage</div>
                        <div style={{ color: "var(--text-primary)" }}>{formatRunCoverage(dashboard.latestRun)}</div>
                      </div>
                      <div>
                        <div style={{ color: "var(--text-muted)" }}>Missed observations</div>
                        <div style={{ color: "var(--text-primary)" }}>
                          {dashboard.latestRun.coverage.missedSupportedMatchObservations}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
                    Leader split: {formatLeaderSummary(dashboard.leaderCountsTotal)}
                  </div>
                </>
              ) : (
                <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                  No lead/lag runs are available yet.
                </div>
              )}
            </div>
          </div>

          <div
            className="rounded-xl p-5 mb-6"
            style={{ backgroundColor: "var(--card)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Radar size={18} style={{ color: "#d97706" }} />
              <h2
                className="text-[16px] font-semibold m-0"
                style={{ color: "var(--text-primary)", fontFamily: "var(--font-heading)" }}
              >
                Recent windows
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    <th className="text-left py-2 pr-4 font-medium">Run</th>
                    <th className="text-left py-2 px-4 font-medium">Read</th>
                    <th className="text-right py-2 px-4 font-medium">Events</th>
                    <th className="text-right py-2 px-4 font-medium">Confirmed</th>
                    <th className="text-left py-2 px-4 font-medium">Leaders</th>
                    <th className="text-left py-2 px-4 font-medium">Assets</th>
                    <th className="text-right py-2 px-4 font-medium">Coverage</th>
                    <th className="text-right py-2 px-4 font-medium">Missed</th>
                    <th className="text-right py-2 pl-4 font-medium">Net spread</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recentRuns.map((run) => (
                    <tr key={run.runDir} className="border-b" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                      <td className="py-3 pr-4 align-top">
                        <div style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
                          {run.runDir}
                        </div>
                        <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                          {formatStamp(run.generatedAtUtc)}
                        </div>
                      </td>
                      <td className="py-3 px-4 align-top" style={{ color: "var(--text-secondary)" }}>
                        {run.note}
                      </td>
                      <td className="py-3 px-4 text-right align-top" style={{ color: "var(--text-primary)" }}>
                        {run.eventCount}
                      </td>
                      <td className="py-3 px-4 text-right align-top" style={{ color: run.confirmedFollowCount > 0 ? "var(--positive)" : "var(--text-primary)" }}>
                        {run.confirmedFollowCount}
                      </td>
                      <td className="py-3 px-4 align-top" style={{ color: "var(--text-secondary)" }}>
                        {formatLeaderSummary(run.leaderCounts)}
                      </td>
                      <td className="py-3 px-4 align-top" style={{ color: "var(--text-secondary)" }}>
                        {formatRunAssetSummary(run)}
                      </td>
                      <td className="py-3 px-4 text-right align-top" style={{ color: "var(--text-primary)" }}>
                        {formatRunCoverage(run)}
                      </td>
                      <td className="py-3 px-4 text-right align-top" style={{ color: run.coverage.missedSupportedMatchObservations > 0 ? "var(--accent)" : "var(--text-primary)" }}>
                        {run.coverage.missedSupportedMatchObservations}
                      </td>
                      <td className="py-3 pl-4 text-right align-top" style={{ color: "var(--text-primary)" }}>
                        {formatSpread(run.avgMedianNetSpreadAfterFees)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: "var(--card-elevated)", border: "1px solid var(--border)" }}
          >
            <div className="text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: "var(--text-muted)" }}>
              Artifact sources
            </div>
            <div className="text-[12px] space-y-1" style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              <div>Status: {dashboard.statusPath}</div>
              <div>Scorecard: {dashboard.scorecardPath}</div>
              <div>Artifacts dir: {dashboard.artifactDir}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
