import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_LEADLAG_ARTIFACTS_DIR = path.join(
  os.homedir(),
  ".hermes",
  "hermes-agent",
  "analysis",
  "outputs",
  "prediction_markets",
);

export interface LeadLagDashboardThreshold {
  key: "runs" | "events" | "confirmations" | "same_leader" | "leader_share";
  label: string;
  current: number;
  target: number;
  met: boolean;
  currentLabel?: string;
  targetLabel?: string;
}

export interface LeadLagDashboardCoverage {
  uniqueSupportedMarketCount: number;
  uniqueCapturedMarketCount: number;
  totalSupportedMatchObservations: number;
  totalCapturedQuoteObservations: number;
  missedSupportedMatchObservations: number;
  coverageRate: number | null;
}

export interface LeadLagDashboardRun {
  runDir: string;
  generatedAtUtc: string | null;
  pinnedCanonicalMarketId: string | null;
  primaryCanonicalMarketId: string | null;
  pinnedAsset: string | null;
  eventCount: number;
  confirmedFollowCount: number;
  leaderCounts: Record<string, number>;
  assets: Record<string, number>;
  assetLabel: string;
  coverage: LeadLagDashboardCoverage;
  sampleCount: number;
  avgMedianNetSpreadAfterFees: number | null;
  avgMedianRawMidpointSpread: number | null;
  note: string;
}

export interface LeadLagDashboardData {
  available: boolean;
  artifactDir: string;
  scorecardPath: string;
  statusPath: string;
  error: string | null;
  generatedAtUtc: string | null;
  verdictCron: string | null;
  verdictReason: string | null;
  runCount: number;
  eventCountTotal: number;
  confirmedFollowCountTotal: number;
  leaderCountsTotal: Record<string, number>;
  confirmedByLeader: Record<string, number>;
  assetsTotal: Record<string, number>;
  leaderShare: number | null;
  evidenceBreadthLabel: string;
  coverage: LeadLagDashboardCoverage;
  thresholds: LeadLagDashboardThreshold[];
  latestRun: LeadLagDashboardRun | null;
  recentRuns: LeadLagDashboardRun[];
}

type RawCoverage = {
  unique_supported_canonical_market_ids?: string[];
  unique_supported_market_count?: number;
  unique_captured_canonical_market_ids?: string[];
  unique_captured_market_count?: number;
  total_supported_match_observations?: number;
  total_captured_quote_observations?: number;
  missed_supported_match_observations?: number;
  coverage_rate?: number | null;
};

type RawRun = {
  run_dir?: string;
  generated_at_utc?: string | null;
  pinned_canonical_market_id?: string | null;
  primary_canonical_market_id?: string | null;
  coverage?: RawCoverage;
  event_count?: number;
  confirmed_follow_count?: number;
  leader_counts?: Record<string, number>;
  assets?: Record<string, number>;
  sample_count?: number;
  avg_median_net_spread_after_fees?: number | null;
  avg_median_raw_midpoint_spread?: number | null;
};

type RawScorecard = {
  generated_at_utc?: string;
  run_count?: number;
  event_count_total?: number;
  confirmed_follow_count_total?: number;
  leader_counts_total?: Record<string, number>;
  assets_total?: Record<string, number>;
  confirmed_by_leader?: Record<string, number>;
  leader_share?: number;
  evidence_spans_assets?: boolean;
  evidence_spans_windows?: boolean;
  coverage?: RawCoverage;
  recommendation?: {
    verdict_cron?: string;
    reason?: string;
    suggested_unpause_threshold?: {
      minimum_post_restore_runs?: number;
      minimum_attribution_events?: number;
      minimum_confirmed_follow_throughs?: number;
      minimum_confirmed_for_same_leader?: number;
      require_multi_asset_or_multi_window_evidence?: boolean;
      target_leader_share_for_any_claim?: number;
    };
  };
  runs?: RawRun[];
};

type RawStatus = {
  generated_at_utc?: string;
  verdict_cron?: string;
  reason?: string;
  run_count?: number;
  event_count_total?: number;
  confirmed_follow_count_total?: number;
  leader_counts_total?: Record<string, number>;
  confirmed_by_leader?: Record<string, number>;
};

function readJsonIfExists<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function numericRecord(input: unknown): Record<string, number> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([, value]) => typeof value === "number"),
  ) as Record<string, number>;
}

function maxRecordValue(input: Record<string, number>): number {
  return Math.max(0, ...Object.values(input));
}

function formatThresholdPercentLabel(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const percent = Math.round(value * 1000) / 10;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function normalizeCoverage(input: RawCoverage | null | undefined): LeadLagDashboardCoverage {
  return {
    uniqueSupportedMarketCount: Number(input?.unique_supported_market_count ?? 0),
    uniqueCapturedMarketCount: Number(input?.unique_captured_market_count ?? 0),
    totalSupportedMatchObservations: Number(input?.total_supported_match_observations ?? 0),
    totalCapturedQuoteObservations: Number(input?.total_captured_quote_observations ?? 0),
    missedSupportedMatchObservations: Number(input?.missed_supported_match_observations ?? 0),
    coverageRate: typeof input?.coverage_rate === "number" ? input.coverage_rate : null,
  };
}

export function extractPinnedAssetFromCanonicalMarketId(value: string | null | undefined): string | null {
  const match = String(value ?? "").match(/^crypto-direction-([a-z0-9]+)-/i);
  if (!match) return null;
  return match[1]?.toUpperCase() ?? null;
}

export function describeRunAssetSummary(run: {
  assets?: Record<string, number>;
  pinned_canonical_market_id?: string | null;
  primary_canonical_market_id?: string | null;
  coverage?: RawCoverage | { unique_supported_market_count?: number; unique_captured_market_count?: number };
}): string {
  const assets = numericRecord(run.assets);
  const entries = Object.entries(assets);
  if (entries.length > 0) return entries.map(([key, count]) => `${key} ${count}`).join(" · ");

  const uniqueSupportedMarketCount = Number(run.coverage?.unique_supported_market_count ?? 0);
  const uniqueCapturedMarketCount = Number(run.coverage?.unique_captured_market_count ?? 0);
  if (uniqueSupportedMarketCount > 1) {
    return `Captured ${uniqueCapturedMarketCount}/${uniqueSupportedMarketCount} supported windows`;
  }

  const pinnedAsset = extractPinnedAssetFromCanonicalMarketId(
    run.primary_canonical_market_id ?? run.pinned_canonical_market_id,
  );
  if (pinnedAsset) return `Pinned ${pinnedAsset} window; no qualifying attribution yet`;

  return "No supported exact-match asset in this run";
}

export function classifyLeadLagRun(run: {
  pinned_canonical_market_id?: string | null;
  primary_canonical_market_id?: string | null;
  coverage?: RawCoverage | { unique_supported_market_count?: number };
  event_count?: number;
  confirmed_follow_count?: number;
  sample_count?: number;
}): string {
  const eventCount = Number(run.event_count ?? 0);
  const confirmed = Number(run.confirmed_follow_count ?? 0);
  const sampleCount = Number(run.sample_count ?? 0);
  const pinned = run.primary_canonical_market_id ?? run.pinned_canonical_market_id ?? null;
  const pinnedAsset = extractPinnedAssetFromCanonicalMarketId(pinned);
  const uniqueSupportedMarketCount = Number(run.coverage?.unique_supported_market_count ?? 0);

  if (confirmed > 0) return "Confirmed follow-through observed";
  if (eventCount > 0) return "Leader move detected; follower not confirmed";
  if (uniqueSupportedMarketCount > 1) {
    return `Captured ${uniqueSupportedMarketCount} supported windows; no qualifying attribution event`;
  }
  if (!pinned && sampleCount > 0) return "Availability-limited: no supported exact match sampled";
  if (pinned) return `Pinned ${pinnedAsset ?? "exact-match"} window captured; no qualifying attribution event`;
  return "No usable signal captured";
}

function mapRun(run: RawRun): LeadLagDashboardRun {
  const pinnedCanonicalMarketId = run.pinned_canonical_market_id ?? null;
  const primaryCanonicalMarketId = run.primary_canonical_market_id ?? pinnedCanonicalMarketId;
  const coverage = normalizeCoverage(run.coverage);
  return {
    runDir: String(run.run_dir ?? "unknown-run"),
    generatedAtUtc: run.generated_at_utc ?? null,
    pinnedCanonicalMarketId,
    primaryCanonicalMarketId,
    pinnedAsset: extractPinnedAssetFromCanonicalMarketId(primaryCanonicalMarketId),
    eventCount: Number(run.event_count ?? 0),
    confirmedFollowCount: Number(run.confirmed_follow_count ?? 0),
    leaderCounts: numericRecord(run.leader_counts),
    assets: numericRecord(run.assets),
    assetLabel: describeRunAssetSummary(run),
    coverage,
    sampleCount: Number(run.sample_count ?? 0),
    avgMedianNetSpreadAfterFees:
      typeof run.avg_median_net_spread_after_fees === "number"
        ? run.avg_median_net_spread_after_fees
        : null,
    avgMedianRawMidpointSpread:
      typeof run.avg_median_raw_midpoint_spread === "number"
        ? run.avg_median_raw_midpoint_spread
        : null,
    note: classifyLeadLagRun(run),
  };
}

export function loadLeadLagDashboardData(
  artifactDir: string = DEFAULT_LEADLAG_ARTIFACTS_DIR,
): LeadLagDashboardData {
  const statusPath = path.join(artifactDir, "latest_leadlag_post_restore_status.json");
  const scorecardPath = path.join(artifactDir, "latest_leadlag_post_restore.json");

  const status = readJsonIfExists<RawStatus>(statusPath);
  const scorecard = readJsonIfExists<RawScorecard>(scorecardPath);

  if (!status || !scorecard) {
    return {
      available: false,
      artifactDir,
      scorecardPath,
      statusPath,
      error: "Lead/lag artifacts are missing or not ready yet.",
      generatedAtUtc: null,
      verdictCron: null,
      verdictReason: null,
      runCount: 0,
      eventCountTotal: 0,
      confirmedFollowCountTotal: 0,
      leaderCountsTotal: {},
      confirmedByLeader: {},
      assetsTotal: {},
      leaderShare: null,
      evidenceBreadthLabel: "Not enough evidence yet",
      coverage: normalizeCoverage(null),
      thresholds: [],
      latestRun: null,
      recentRuns: [],
    };
  }

  const confirmedByLeader = numericRecord(status.confirmed_by_leader ?? scorecard.confirmed_by_leader);
  const thresholdConfig = scorecard.recommendation?.suggested_unpause_threshold ?? {};
  const leaderShare = typeof scorecard.leader_share === "number" ? scorecard.leader_share : null;
  const leaderShareTarget =
    typeof thresholdConfig.target_leader_share_for_any_claim === "number"
      ? thresholdConfig.target_leader_share_for_any_claim
      : null;
  const runCount = Number(status.run_count ?? scorecard.run_count ?? 0);
  const eventCountTotal = Number(status.event_count_total ?? scorecard.event_count_total ?? 0);
  const confirmedFollowCountTotal = Number(
    status.confirmed_follow_count_total ?? scorecard.confirmed_follow_count_total ?? 0,
  );
  const evidenceSpansAssets = Boolean(scorecard.evidence_spans_assets);
  const evidenceSpansWindows = Boolean(scorecard.evidence_spans_windows);
  const evidenceBreadthLabel =
    evidenceSpansAssets || evidenceSpansWindows
      ? "Cross-asset/window evidence present"
      : "Still too concentrated in one asset/window cluster";

  const recentRuns = Array.isArray(scorecard.runs)
    ? [...scorecard.runs]
        .sort((a, b) => String(b.run_dir ?? "").localeCompare(String(a.run_dir ?? "")))
        .map(mapRun)
    : [];

  return {
    available: true,
    artifactDir,
    scorecardPath,
    statusPath,
    error: null,
    generatedAtUtc: status.generated_at_utc ?? scorecard.generated_at_utc ?? null,
    verdictCron: status.verdict_cron ?? scorecard.recommendation?.verdict_cron ?? null,
    verdictReason: status.reason ?? scorecard.recommendation?.reason ?? null,
    runCount,
    eventCountTotal,
    confirmedFollowCountTotal,
    leaderCountsTotal: numericRecord(status.leader_counts_total ?? scorecard.leader_counts_total),
    confirmedByLeader,
    assetsTotal: numericRecord(scorecard.assets_total),
    leaderShare,
    evidenceBreadthLabel,
    coverage: normalizeCoverage(scorecard.coverage),
    thresholds: [
      {
        key: "runs",
        label: "Pinned runs",
        current: runCount,
        target: Number(thresholdConfig.minimum_post_restore_runs ?? 0),
        met: runCount >= Number(thresholdConfig.minimum_post_restore_runs ?? Number.POSITIVE_INFINITY),
      },
      {
        key: "events",
        label: "Attribution events",
        current: eventCountTotal,
        target: Number(thresholdConfig.minimum_attribution_events ?? 0),
        met:
          eventCountTotal >=
          Number(thresholdConfig.minimum_attribution_events ?? Number.POSITIVE_INFINITY),
      },
      {
        key: "confirmations",
        label: "Confirmed follow-throughs",
        current: confirmedFollowCountTotal,
        target: Number(thresholdConfig.minimum_confirmed_follow_throughs ?? 0),
        met:
          confirmedFollowCountTotal >=
          Number(thresholdConfig.minimum_confirmed_follow_throughs ?? Number.POSITIVE_INFINITY),
      },
      {
        key: "same_leader",
        label: "Confirmed from same leader",
        current: maxRecordValue(confirmedByLeader),
        target: Number(thresholdConfig.minimum_confirmed_for_same_leader ?? 0),
        met:
          maxRecordValue(confirmedByLeader) >=
          Number(thresholdConfig.minimum_confirmed_for_same_leader ?? Number.POSITIVE_INFINITY),
      },
      {
        key: "leader_share",
        label: "Dominant leader share",
        current: Math.round((leaderShare ?? 0) * 1000) / 10,
        target: Math.round((leaderShareTarget ?? 0) * 1000) / 10,
        met: leaderShareTarget !== null && leaderShare !== null ? leaderShare >= leaderShareTarget : false,
        currentLabel: formatThresholdPercentLabel(leaderShare),
        targetLabel: formatThresholdPercentLabel(leaderShareTarget),
      },
    ],
    latestRun: recentRuns[0] ?? null,
    recentRuns,
  };
}
