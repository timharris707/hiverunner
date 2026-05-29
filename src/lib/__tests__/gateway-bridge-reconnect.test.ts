import assert from "node:assert/strict";

import { computeReconnectDelayMs, shouldLogReconnectFailure } from "@/lib/orchestration/gateway-reconnect";

// ── Backoff with jitter ──
// attempt 0 ≈ 2000ms ± 15%
assert.ok(computeReconnectDelayMs(0, () => 0.5) >= 1900 && computeReconnectDelayMs(0, () => 0.5) <= 2100, "attempt0 ~2000 at mid jitter");
assert.ok(computeReconnectDelayMs(0, () => 0) < computeReconnectDelayMs(0, () => 1), "jitter widens the delay");
// capped at 30000ms (+15% jitter ceiling), never runaway
for (let a = 0; a < 60; a++) {
  const d = computeReconnectDelayMs(a, () => 1);
  assert.ok(d <= 30000 * 1.15 + 1, `attempt ${a} delay <= cap*1.15 (got ${d})`);
}
assert.ok(computeReconnectDelayMs(60, () => 0) >= 30000 * 0.85 - 1, "deep attempts stay near the capped floor");
// monotonic up to the cap
assert.ok(computeReconnectDelayMs(1, () => 0.5) > computeReconnectDelayMs(0, () => 0.5), "backoff grows before the cap");

// ── Log throttle: first failure + periodic heartbeat, quiet otherwise ──
assert.equal(shouldLogReconnectFailure(0), true, "log the first failure");
assert.equal(shouldLogReconnectFailure(1), false);
assert.equal(shouldLogReconnectFailure(5), false);
assert.equal(shouldLogReconnectFailure(19), false);
assert.equal(shouldLogReconnectFailure(20), true, "periodic heartbeat every 20th attempt");
assert.equal(shouldLogReconnectFailure(40), true);
// Over 100 failed attempts, at most a handful of log lines (was: 1 per attempt → thousands over a long outage).
const logged = Array.from({ length: 100 }, (_, i) => shouldLogReconnectFailure(i)).filter(Boolean).length;
assert.ok(logged <= 6, `<=6 log lines per 100 failed attempts (got ${logged})`);

console.log("PASS gateway-bridge-reconnect");
