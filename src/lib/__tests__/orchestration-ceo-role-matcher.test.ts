/**
 * Contract test: CEO onboarding assets must load for any role token containing "ceo".
 * Regression guard for Barometer ("Weather CEO") loading the default bucket
 * instead of ceo/HEARTBEAT.md, which caused narrative-only heartbeat output.
 * Run:
 * ORCHESTRATION_DB_PATH=/tmp/orchestration-ceo-role-matcher.db \
 *   node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-ceo-role-matcher.test.ts
 */

import assert from "node:assert/strict";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ ${name}`);
      console.error(`    ${message}`);
    });
}

console.log("\nOrchestration CEO Role Matcher Contract Test\n");

async function run() {
  const { isCeoRole, isCompanyOrchestrationLeadRole, loadOnboardingAssets } = await import("@/lib/orchestration/engine/engine");

  await test("isCeoRole matches bare and compound CEO roles, rejects non-CEO roles", () => {
    const matches: string[] = ["ceo", "CEO", "Weather CEO", "weather ceo", "CEO of Weather", "Trading CEO"];
    const nonMatches: string[] = [
      "Infrastructure Engineer",
      "Meteorologist",
      "Head of Trading",
      "Frontend Engineer / Dashboards",
      "ceo-lite",
      "preceoh",
    ];
    for (const role of matches) {
      assert.equal(isCeoRole(role), true, `expected isCeoRole(${JSON.stringify(role)}) === true`);
    }
    for (const role of nonMatches) {
      assert.equal(isCeoRole(role), false, `expected isCeoRole(${JSON.stringify(role)}) === false`);
    }
  });

  await test("Weather CEO loads ceo/HEARTBEAT.md (the real bug fix)", () => {
    const assets = loadOnboardingAssets("weather ceo");
    assert.ok(assets["HEARTBEAT.md"], "HEARTBEAT.md must be present for Weather CEO");
    assert.match(assets["HEARTBEAT.md"], /mc-action/);
  });

  await test("company orchestration lead roles can route unassigned/review sweeps", () => {
    const matches = ["Product Orchestrator", "Lead / Product Orchestrator", "Orchestration Lead"];
    const nonMatches = ["QA / Verification Lead", "Backend Engineer", "Product Designer"];
    for (const role of matches) {
      assert.equal(isCompanyOrchestrationLeadRole(role), true, `expected orchestration lead match for ${role}`);
    }
    for (const role of nonMatches) {
      assert.equal(isCompanyOrchestrationLeadRole(role), false, `expected no orchestration lead match for ${role}`);
    }
  });

  await test("non-CEO roles still get default bucket and no CEO HEARTBEAT.md", () => {
    const assets = loadOnboardingAssets("infrastructure engineer");
    assert.ok(!assets["HEARTBEAT.md"]?.includes("# CEO Heartbeat Ritual"), "default bucket must not provide CEO HEARTBEAT.md");
    assert.ok(assets["AGENTS.md"], "default bucket must still provide AGENTS.md");
  });

  await test("bare 'ceo' role still loads ceo bucket (no regression)", () => {
    const assets = loadOnboardingAssets("ceo");
    assert.ok(assets["HEARTBEAT.md"], "bare 'ceo' must still map to ceo bucket");
  });

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
