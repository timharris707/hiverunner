import assert from "node:assert/strict";

import { isGatewayAbsentError, shouldLogGatewayAbsent } from "@/lib/orchestration/gateway-stream-bridge";

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

console.log("\nGateway Stream Bridge Tests\n");

test("classifies ECONNREFUSED as absent gateway", () => {
  const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:18789"), { code: "ECONNREFUSED" });
  assert.equal(isGatewayAbsentError(error), true);
});

test("does not classify unrelated websocket errors as absent gateway", () => {
  const error = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  assert.equal(isGatewayAbsentError(error), false);
});

test("throttles absent-gateway logs to coarse intervals", () => {
  assert.equal(shouldLogGatewayAbsent(1_000, 0, 60_000), true);
  assert.equal(shouldLogGatewayAbsent(30_000, 1_000, 60_000), false);
  assert.equal(shouldLogGatewayAbsent(61_000, 1_000, 60_000), true);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) process.exit(1);
