import assert from "node:assert/strict";
import { TRADING_STATIONS } from "@/lib/trading-weather";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\nTrading station config regression tests\n");

test("every trading station has exact settlement station coordinates", () => {
  for (const [city, station] of Object.entries(TRADING_STATIONS)) {
    assert.equal(typeof station.stationId, "string", `${city} missing stationId`);
    assert.equal(typeof station.timeZone, "string", `${city} missing timeZone`);
    assert.equal(typeof station.lat, "number", `${city} missing lat`);
    assert.equal(typeof station.lon, "number", `${city} missing lon`);
  }
});

test("los_angeles remains pinned to KLAX settlement station", () => {
  const lax = TRADING_STATIONS.los_angeles;
  assert.equal(lax.stationId, "KLAX");
  assert.equal(lax.lat, 33.93806);
  assert.equal(lax.lon, -118.38889);
});

test("new_york remains pinned to KNYC settlement station", () => {
  const ny = TRADING_STATIONS.new_york;
  assert.equal(ny.stationId, "KNYC");
  assert.equal(ny.lat, 40.78333);
  assert.equal(ny.lon, -73.96667);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
