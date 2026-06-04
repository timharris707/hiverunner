/**
 * Unit tests for the Smart LLM Router.
 * Run: npx tsx src/lib/__tests__/llm-router.test.ts
 */

import { routeTask, getAvailableTiers, getTierModelName, type TaskInput } from "../llm-router";
import assert from "node:assert";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

void (async () => {
console.log("\nSmart LLM Router Tests\n");

// ── Tier selection tests ──

await test("P0 critical task routes to Opus", () => {
  const result = routeTask({ title: "Fix critical auth vulnerability", priority: "P0", type: "bug", tags: ["security"] });
  assert.strictEqual(result.tier, "opus");
  assert.ok(result.complexityScore >= 80, `score ${result.complexityScore} should be >= 80`);
});

await test("Simple maintenance task routes to Haiku", () => {
  const result = routeTask({ title: "Fix typo in readme", priority: "P3", type: "maintenance" });
  assert.strictEqual(result.tier, "haiku");
  assert.ok(result.complexityScore < 35, `score ${result.complexityScore} should be < 35`);
});

await test("Standard coding task routes to GPT Codex", () => {
  const result = routeTask({ title: "Build the settings page component", type: "feature", priority: "P2" });
  assert.strictEqual(result.tier, "gpt-5.4");
});

await test("Research-heavy task routes to Gemini", () => {
  const result = routeTask({
    title: "Research and investigate competitive landscape, compare alternatives, survey market trends",
    priority: "P2",
    tags: ["research"],
  });
  assert.ok(
    result.tier === "gemini-flash" || result.tier === "gemini-pro",
    `Expected gemini tier, got ${result.tier}`
  );
});

await test("Large-context task routes to Gemini Pro", () => {
  const result = routeTask({
    title: "Full audit of entire repo codebase, comprehensive review of cross-cutting concerns",
    priority: "P1",
  });
  assert.strictEqual(result.tier, "gemini-pro");
});

await test("Bug fix routes to GPT Codex by default", () => {
  const result = routeTask({ title: "Fix pagination bug in dashboard", type: "bug", priority: "P2" });
  assert.strictEqual(result.tier, "gpt-5.4");
});

await test("Product thinking task routes to GPT Codex", () => {
  const result = routeTask({
    title: "Brainstorm planning session workflow and positioning strategy",
    priority: "P2",
    tags: ["strategy"],
  });
  assert.strictEqual(result.tier, "gpt-5.4");
});

// ── Complexity scoring tests ──

await test("High-stakes tags boost complexity", () => {
  const withTag = routeTask({ title: "Update payment flow", tags: ["payment"] });
  const without = routeTask({ title: "Update payment flow" });
  assert.ok(withTag.complexityScore > without.complexityScore);
});

await test("Low-stakes tags reduce complexity", () => {
  const withTag = routeTask({ title: "Update docs", tags: ["docs"] });
  const without = routeTask({ title: "Update docs" });
  assert.ok(withTag.complexityScore < without.complexityScore);
});

await test("Project complexity adjustments apply", () => {
  const project = routeTask({ title: "Add feature", project: "ops-automation" });
  const org = routeTask({ title: "Add feature", project: "org" });
  assert.ok(project.complexityScore > org.complexityScore);
});

// ── Cost savings tests ──

await test("Non-Opus tiers show positive savings", () => {
  const result = routeTask({ title: "Fix typo in readme", priority: "P3", type: "maintenance" });
  assert.ok(result.savingsPercent > 0, `savings ${result.savingsPercent} should be > 0`);
});

await test("Opus tier shows 0% savings", () => {
  const result = routeTask({ title: "Critical security architecture overhaul", priority: "P0", tags: ["security"] });
  if (result.tier === "opus") {
    assert.strictEqual(result.savingsPercent, 0);
  }
});

// ── Routing decision shape tests ──

await test("Routing decision has all required fields", () => {
  const result = routeTask({ title: "Test task" });
  assert.ok(result.modelId);
  assert.ok(result.modelName);
  assert.ok(result.tier);
  assert.ok(result.reason);
  assert.ok(typeof result.complexityScore === "number");
  assert.ok(typeof result.estimatedCostPer1k === "number");
  assert.ok(typeof result.opusCostPer1k === "number");
  assert.ok(typeof result.savingsPercent === "number");
  assert.ok(Array.isArray(result.signals));
});

// ── Utility function tests ──

await test("getAvailableTiers returns all configured tiers", () => {
  const tiers = getAvailableTiers();
  assert.strictEqual(tiers.length, 7);
  const tierNames = tiers.map((t) => t.tier);
  assert.ok(tierNames.includes("opus"));
  assert.ok(tierNames.includes("sonnet"));
  assert.ok(tierNames.includes("haiku"));
  assert.ok(tierNames.includes("gpt-5.4"));
  assert.ok(tierNames.includes("gpt"));
  assert.ok(tierNames.includes("gemini-flash"));
  assert.ok(tierNames.includes("gemini-pro"));
});

await test("getTierModelName returns human-readable names", () => {
  assert.ok(getTierModelName("opus").includes("Opus"));
  assert.ok(getTierModelName("sonnet").includes("Sonnet"));
});

// ── Summary ──

finish();
})().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
