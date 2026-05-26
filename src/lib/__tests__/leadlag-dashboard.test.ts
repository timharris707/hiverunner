import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  classifyLeadLagRun,
  describeRunAssetSummary,
  loadLeadLagDashboardData,
} from "@/lib/leadlag-dashboard";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error: unknown) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ✗ ${name}`);
    console.error(`    ${message}`);
  }
}

function writeJson(target: string, value: unknown) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

function run() {
  console.log("\nLead/Lag Dashboard Tests\n");

  test("classifies null-pinned zero-event runs as availability-limited", () => {
    const label = classifyLeadLagRun({
      run_dir: "leadlag_run_20260415T060406Z",
      pinned_canonical_market_id: null,
      event_count: 0,
      confirmed_follow_count: 0,
      sample_count: 5,
    });

    assert.strictEqual(label, "Availability-limited: no supported exact match sampled");
  });

  test("describes pinned zero-event runs with pinned asset context", () => {
    const summary = describeRunAssetSummary({
      pinned_canonical_market_id: "crypto-direction-btc-15m-1776265200",
      assets: {},
    });

    assert.strictEqual(summary, "Pinned BTC window; no qualifying attribution yet");
  });

  test("describes unsupported runs honestly when no exact-match asset was pinned", () => {
    const summary = describeRunAssetSummary({
      pinned_canonical_market_id: null,
      assets: {},
    });

    assert.strictEqual(summary, "No supported exact-match asset in this run");
  });

  test("classifies multi-window zero-event runs honestly", () => {
    const label = classifyLeadLagRun({
      primary_canonical_market_id: "crypto-direction-btc-15m-1776266100",
      coverage: {
        unique_supported_market_count: 3,
      },
      event_count: 0,
      confirmed_follow_count: 0,
      sample_count: 5,
    });

    assert.strictEqual(label, "Captured 3 supported windows; no qualifying attribution event");
  });

  test("loads dashboard summary and threshold progress from Hermes artifacts", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-leadlag-dashboard-"));

    writeJson(path.join(tmpRoot, "latest_leadlag_post_restore_status.json"), {
      generated_at_utc: "2026-04-15T06:06:36Z",
      verdict_cron: "keep_paused",
      reason: "sample still too thin",
      run_count: 8,
      event_count_total: 4,
      confirmed_follow_count_total: 1,
      leader_counts_total: { polymarket: 3, kalshi: 1 },
      confirmed_by_leader: { polymarket: 1 },
      cutoff_run_dir: "leadlag_run_20260415T040141Z",
    });

    writeJson(path.join(tmpRoot, "latest_leadlag_post_restore.json"), {
      generated_at_utc: "2026-04-15T06:06:36Z",
      run_count: 8,
      event_count_total: 4,
      confirmed_follow_count_total: 1,
      leader_counts_total: { polymarket: 3, kalshi: 1 },
      assets_total: { ETH: 3, BTC: 1 },
      confirmed_by_leader: { polymarket: 1 },
      leader_share: 0.75,
      evidence_spans_assets: true,
      evidence_spans_windows: true,
      coverage: {
        unique_supported_canonical_market_ids: ["m1", "m2", "m3"],
        unique_supported_market_count: 3,
        unique_captured_canonical_market_ids: ["m1", "m2"],
        unique_captured_market_count: 2,
        total_supported_match_observations: 18,
        total_captured_quote_observations: 14,
        missed_supported_match_observations: 4,
        coverage_rate: 14 / 18,
      },
      recommendation: {
        verdict_cron: "keep_paused",
        reason: "sample still too thin",
        suggested_unpause_threshold: {
          minimum_post_restore_runs: 8,
          minimum_attribution_events: 6,
          minimum_confirmed_follow_throughs: 3,
          minimum_confirmed_for_same_leader: 2,
          require_multi_asset_or_multi_window_evidence: true,
          target_leader_share_for_any_claim: 0.65,
        },
      },
      runs: [
        {
          run_dir: "leadlag_run_20260415T060406Z",
          generated_at_utc: "2026-04-15T06:06:27Z",
          pinned_canonical_market_id: null,
          primary_canonical_market_id: null,
          coverage: {
            unique_supported_canonical_market_ids: [],
            unique_supported_market_count: 0,
            unique_captured_canonical_market_ids: [],
            unique_captured_market_count: 0,
            total_supported_match_observations: 0,
            total_captured_quote_observations: 0,
            missed_supported_match_observations: 0,
            coverage_rate: null,
          },
          event_count: 0,
          confirmed_follow_count: 0,
          leader_counts: {},
          assets: {},
          sample_count: 5,
          avg_median_net_spread_after_fees: null,
          avg_median_raw_midpoint_spread: null,
        },
        {
          run_dir: "leadlag_run_20260415T044644Z",
          generated_at_utc: "2026-04-15T04:48:52Z",
          pinned_canonical_market_id: "crypto-direction-btc-15m-1776229200",
          primary_canonical_market_id: "crypto-direction-btc-15m-1776229200",
          coverage: {
            unique_supported_canonical_market_ids: ["crypto-direction-btc-15m-1776229200", "crypto-direction-eth-15m-1776229200"],
            unique_supported_market_count: 2,
            unique_captured_canonical_market_ids: ["crypto-direction-btc-15m-1776229200"],
            unique_captured_market_count: 1,
            total_supported_match_observations: 10,
            total_captured_quote_observations: 5,
            missed_supported_match_observations: 5,
            coverage_rate: 0.5,
          },
          event_count: 1,
          confirmed_follow_count: 0,
          leader_counts: { kalshi: 1 },
          assets: { BTC: 1 },
          sample_count: 5,
          avg_median_net_spread_after_fees: 0.064,
          avg_median_raw_midpoint_spread: 0.084,
        },
      ],
    });

    const dashboard = loadLeadLagDashboardData(tmpRoot);

    assert.strictEqual(dashboard.available, true);
    assert.strictEqual(dashboard.verdictCron, "keep_paused");
    assert.strictEqual(dashboard.runCount, 8);
    assert.strictEqual(dashboard.eventCountTotal, 4);
    assert.strictEqual(dashboard.confirmedFollowCountTotal, 1);
    assert.strictEqual(dashboard.recentRuns.length, 2);
    assert.strictEqual(dashboard.latestRun?.runDir, "leadlag_run_20260415T060406Z");
    assert.strictEqual(
      dashboard.latestRun?.note,
      "Availability-limited: no supported exact match sampled",
    );
    assert.strictEqual(dashboard.latestRun?.assetLabel, "No supported exact-match asset in this run");
    assert.strictEqual(dashboard.coverage.totalSupportedMatchObservations, 18);
    assert.strictEqual(dashboard.coverage.totalCapturedQuoteObservations, 14);
    assert.strictEqual(dashboard.coverage.missedSupportedMatchObservations, 4);
    assert.strictEqual(dashboard.coverage.uniqueSupportedMarketCount, 3);

    const runsThreshold = dashboard.thresholds.find((item) => item.key === "runs");
    const eventsThreshold = dashboard.thresholds.find((item) => item.key === "events");
    const confirmationsThreshold = dashboard.thresholds.find((item) => item.key === "confirmations");
    const sameLeaderThreshold = dashboard.thresholds.find((item) => item.key === "same_leader");
    const leaderShareThreshold = dashboard.thresholds.find((item) => item.key === "leader_share");

    assert.ok(runsThreshold);
    assert.ok(eventsThreshold);
    assert.ok(confirmationsThreshold);
    assert.ok(sameLeaderThreshold);
    assert.ok(leaderShareThreshold);
    assert.strictEqual(runsThreshold?.met, true);
    assert.strictEqual(eventsThreshold?.met, false);
    assert.strictEqual(confirmationsThreshold?.met, false);
    assert.strictEqual(sameLeaderThreshold?.current, 1);
    assert.strictEqual(leaderShareThreshold?.label, "Dominant leader share");
    assert.strictEqual(leaderShareThreshold?.current, 75);
    assert.strictEqual(leaderShareThreshold?.target, 65);
    assert.strictEqual(leaderShareThreshold?.met, true);
    assert.strictEqual(dashboard.evidenceBreadthLabel, "Cross-asset/window evidence present");
  });

  test("returns unavailable state when artifacts are missing", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mc-leadlag-dashboard-empty-"));
    const dashboard = loadLeadLagDashboardData(tmpRoot);

    assert.strictEqual(dashboard.available, false);
    assert.ok(dashboard.error);
    assert.strictEqual(dashboard.recentRuns.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
