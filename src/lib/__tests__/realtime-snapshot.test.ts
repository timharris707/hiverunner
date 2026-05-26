/**
 * Contract test for the unified HiveRunner live snapshot.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/realtime-snapshot.test.ts
 */

import assert from "node:assert/strict";

import { getHiveRunnerRealtimeSnapshot } from "@/lib/realtime-snapshot";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${error instanceof Error ? error.message : String(error)}`);
    });
}

async function run() {
  console.log("\nRealtime Snapshot Contract Test\n");

  await test("returns the unified payload required by the dashboard shell", async () => {
    const snapshot = await getHiveRunnerRealtimeSnapshot();

    assert.match(snapshot.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(snapshot.dashStats);
    assert.ok(Array.isArray(snapshot.tasks));
    assert.ok(Array.isArray(snapshot.projects));
    assert.ok(snapshot.highlights);
    assert.ok(snapshot.systemStats);
    assert.ok(snapshot.ideas);
    assert.equal(typeof snapshot.ideas.unprocessedCount, "number");
    assert.equal(typeof snapshot.agentStatuses, "object");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
