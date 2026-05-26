import assert from "node:assert";

import { deriveRunLiveness, probeRunnerPidAlive } from "@/lib/orchestration/live-run-liveness";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  [FAIL] ${name}`);
    console.error(`    ${message}`);
  }
}

console.log("\nOrchestration Live Run Liveness Tests\n");

const T0 = new Date("2026-05-01T00:00:00.000Z").getTime();
function iso(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

test("running run with a fresh event is live", () => {
  const snap = deriveRunLiveness({
    status: "running",
    startedAt: iso(0),
    lastEventAt: iso(2_000),
    now: T0 + 5_000,
  });
  assert.strictEqual(snap.liveness, "live");
  assert.strictEqual(snap.ageMs, 5_000);
  assert.strictEqual(snap.lastEventAgeMs, 3_000);
  assert.match(snap.label, /^Live/);
});

test("running run silent past quiet threshold is quiet", () => {
  const snap = deriveRunLiveness({
    status: "running",
    startedAt: iso(0),
    lastEventAt: iso(10_000),
    runnerPid: 12345,
    now: T0 + 60_000,
  });
  assert.strictEqual(snap.liveness, "quiet");
  assert.strictEqual(snap.lastEventAgeMs, 50_000);
  assert.match(snap.label, /Quiet/);
  assert.match(snap.label, /pid 12345/);
});

test("running run silent past stalled threshold is stalled", () => {
  const snap = deriveRunLiveness({
    status: "running",
    startedAt: iso(0),
    lastEventAt: iso(10_000),
    now: T0 + 4 * 60_000,
  });
  assert.strictEqual(snap.liveness, "stalled");
  assert.strictEqual(snap.lastEventAgeMs, 4 * 60_000 - 10_000);
  assert.match(snap.label, /^Stalled/);
});

test("queued run with no events yet shows as live (no false-positive stall)", () => {
  const snap = deriveRunLiveness({
    status: "queued",
    startedAt: null,
    lastEventAt: null,
    now: T0 + 1_000,
  });
  assert.strictEqual(snap.liveness, "live");
  assert.strictEqual(snap.ageMs, null);
  assert.strictEqual(snap.lastEventAgeMs, null);
  assert.strictEqual(snap.label, "Live");
});

test("terminal status reports completed with settle age", () => {
  const snap = deriveRunLiveness({
    status: "succeeded",
    startedAt: iso(0),
    finishedAt: iso(60_000),
    lastEventAt: iso(55_000),
    now: T0 + 90_000,
  });
  assert.strictEqual(snap.liveness, "completed");
  assert.strictEqual(snap.ageMs, 60_000);
  assert.strictEqual(snap.lastEventAgeMs, 30_000);
  assert.match(snap.label, /Completed/);
});

test("custom thresholds override defaults", () => {
  const baseInput = {
    status: "running",
    startedAt: iso(0),
    lastEventAt: iso(0),
  };

  const liveAtTightQuiet = deriveRunLiveness({
    ...baseInput,
    quietThresholdMs: 5_000,
    stalledThresholdMs: 20_000,
    now: T0 + 4_000,
  });
  assert.strictEqual(liveAtTightQuiet.liveness, "live");

  const quietAtTightStall = deriveRunLiveness({
    ...baseInput,
    quietThresholdMs: 5_000,
    stalledThresholdMs: 20_000,
    now: T0 + 10_000,
  });
  assert.strictEqual(quietAtTightStall.liveness, "quiet");

  const stalledAtTightStall = deriveRunLiveness({
    ...baseInput,
    quietThresholdMs: 5_000,
    stalledThresholdMs: 20_000,
    now: T0 + 30_000,
  });
  assert.strictEqual(stalledAtTightStall.liveness, "stalled");
});

test("uses started_at as the floor signal when no other event is recorded", () => {
  const snap = deriveRunLiveness({
    status: "running",
    startedAt: iso(0),
    lastEventAt: null,
    now: T0 + 5_000,
  });
  assert.strictEqual(snap.liveness, "live");
  assert.strictEqual(snap.lastEventAgeMs, 5_000);
});

test("verified-alive runner past stall threshold is held at quiet, not stalled", () => {
  const snap = deriveRunLiveness({
    status: "running",
    startedAt: iso(0),
    lastEventAt: iso(0),
    runnerPid: 99999,
    runnerPidAlive: true,
    now: T0 + 10 * 60_000,
  });
  assert.strictEqual(snap.liveness, "quiet");
  assert.match(snap.label, /runner alive/);
  assert.match(snap.label, /pid 99999/);
});

test("verified-dead runner past stall threshold still classifies as stalled", () => {
  const snap = deriveRunLiveness({
    status: "running",
    startedAt: iso(0),
    lastEventAt: iso(0),
    runnerPid: 12345,
    runnerPidAlive: false,
    now: T0 + 10 * 60_000,
  });
  assert.strictEqual(snap.liveness, "stalled");
});

test("probeRunnerPidAlive returns null for non-positive PIDs", () => {
  assert.strictEqual(probeRunnerPidAlive(null), null);
  assert.strictEqual(probeRunnerPidAlive(undefined), null);
  assert.strictEqual(probeRunnerPidAlive(0), null);
  assert.strictEqual(probeRunnerPidAlive(-1), null);
  assert.strictEqual(probeRunnerPidAlive(Number.NaN), null);
});

test("probeRunnerPidAlive detects the current process as alive", () => {
  assert.strictEqual(probeRunnerPidAlive(process.pid), true);
});

test("probeRunnerPidAlive returns false for a PID that does not exist", () => {
  // Pick a PID that is overwhelmingly unlikely to be live on the host. The
  // OS maxes out far below 2^30, so this is reliably ESRCH-shaped.
  const ghostPid = 2_000_000_000;
  assert.strictEqual(probeRunnerPidAlive(ghostPid), false);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
