import test from "node:test";
import assert from "node:assert/strict";
import {
  executionRunProviderForAdapter,
  numberFromUsage,
  usageTokenDeltas,
  applyUsageDeltasToTelemetry,
} from "@/lib/orchestration/engine/cost-recorder";

test("Cost Recorder Unit Tests", async (t) => {
  await t.test("executionRunProviderForAdapter maps valid providers", () => {
    assert.equal(executionRunProviderForAdapter("openclaw"), "openclaw");
    assert.equal(executionRunProviderForAdapter("OpenClaw "), "openclaw");
    assert.equal(executionRunProviderForAdapter("codex"), "codex");
    assert.equal(executionRunProviderForAdapter("unknown"), null);
    assert.equal(executionRunProviderForAdapter(null), null);
    assert.equal(executionRunProviderForAdapter(undefined), null);
  });

  await t.test("numberFromUsage extracts finite numbers", () => {
    assert.equal(numberFromUsage(10), 10);
    assert.equal(numberFromUsage(0), 0);
    assert.equal(numberFromUsage(-5), -5);
    assert.equal(numberFromUsage("10"), 0);
    assert.equal(numberFromUsage(Infinity), 0);
    assert.equal(numberFromUsage(NaN), 0);
    assert.equal(numberFromUsage(null), 0);
  });

  await t.test("usageTokenDeltas calculates correct deltas", () => {
    // Total fields take precedence
    assert.deepEqual(
      usageTokenDeltas({ totalInputTokens: 10, totalOutputTokens: 20, totalCostCents: 5 }),
      { inputTokensDelta: 10, outputTokensDelta: 20, costCentsDelta: 5 }
    );
    // Non-total fields fallback
    assert.deepEqual(
      usageTokenDeltas({ inputTokens: 5, outputTokens: 15, costCents: 2 }),
      { inputTokensDelta: 5, outputTokensDelta: 15, costCentsDelta: 2 }
    );
    // USD calculates to cents
    assert.deepEqual(
      usageTokenDeltas({ inputTokens: 5, outputTokens: 15, totalCostUsd: 0.12 }),
      { inputTokensDelta: 5, outputTokensDelta: 15, costCentsDelta: 12 }
    );
    // Missing usage
    assert.deepEqual(usageTokenDeltas(undefined), { inputTokensDelta: 0, outputTokensDelta: 0, costCentsDelta: 0 });
  });

  await t.test("applyUsageDeltasToTelemetry applies only positive deltas", () => {
    const telemetry: Record<string, unknown> = {};
    applyUsageDeltasToTelemetry(telemetry, { inputTokensDelta: 10, outputTokensDelta: 20, costCentsDelta: 5 });
    assert.deepEqual(telemetry, { inputTokens: 10, outputTokens: 20, costCents: 5 });

    const telemetryEmpty: Record<string, unknown> = {};
    applyUsageDeltasToTelemetry(telemetryEmpty, { inputTokensDelta: 0, outputTokensDelta: 0, costCentsDelta: 0 });
    assert.deepEqual(telemetryEmpty, {});
  });
});
