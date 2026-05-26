/**
 * Contract test for /api/costs legacy OpenClaw isolation.
 *
 * Run:
 * npx tsx src/lib/__tests__/costs-api-legacy-opt-in.test.ts
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  [pass] ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  [fail] ${name}`);
      console.error(`    ${message}`);
    });
}

async function run() {
  console.log("\nCosts API Legacy Opt-In Contract Test\n");

  const tempHome = mkdtempSync(path.join(tmpdir(), "hiverunner-costs-api-home-"));
  const originalHome = process.env.HOME;
  const originalOpenClawDir = process.env.OPENCLAW_DIR;
  const originalLegacyFlag = process.env.MC_ENABLE_LEGACY_OPENCLAW_COSTS;

  process.env.HOME = tempHome;
  delete process.env.OPENCLAW_DIR;
  delete process.env.MC_ENABLE_LEGACY_OPENCLAW_COSTS;

  const sessionsDir = path.join(tempHome, ".openclaw", "agents", "main", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    path.join(sessionsDir, "sessions.json"),
    JSON.stringify({
      "agent:session:main": {
        updatedAt: Date.now(),
        model: "claude-sonnet-4",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        estimatedCostUsd: 12.34,
      },
    }),
  );

  const { GET } = await import("@/app/api/costs/route");

  try {
    await test("ignores legacy OpenClaw sessions by default", async () => {
      const response = await GET(new NextRequest("http://localhost:3010/api/costs?timeframe=30d"));
      const body = await response.json();

      assert.equal(body.thisMonth, 0);
      assert.equal(body.today, 0);
      assert.deepEqual(body.byAgent, []);
      assert.deepEqual(body.byModel, []);
      assert.deepEqual(body.topSessions, []);
    });

    await test("reads legacy OpenClaw sessions only with explicit opt-in", async () => {
      process.env.MC_ENABLE_LEGACY_OPENCLAW_COSTS = "1";
      try {
        const response = await GET(new NextRequest("http://localhost:3010/api/costs?timeframe=30d"));
        const body = await response.json();

        assert.equal(body.thisMonth, 12.34);
        assert.equal(body.byAgent[0]?.agent, "Local Assistant (Main)");
        assert.equal(body.byModel[0]?.model, "claude-sonnet-4");
      } finally {
        delete process.env.MC_ENABLE_LEGACY_OPENCLAW_COSTS;
      }
    });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalOpenClawDir === undefined) {
      delete process.env.OPENCLAW_DIR;
    } else {
      process.env.OPENCLAW_DIR = originalOpenClawDir;
    }
    if (originalLegacyFlag === undefined) {
      delete process.env.MC_ENABLE_LEGACY_OPENCLAW_COSTS;
    } else {
      process.env.MC_ENABLE_LEGACY_OPENCLAW_COSTS = originalLegacyFlag;
    }
    rmSync(tempHome, { recursive: true, force: true });
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
