/**
 * Contract test for orchestration middleware auth decision logic.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-middleware-auth.test.ts
 */

import assert from "node:assert";
import { canAccessOrchestrationApi, isValidOrchestrationApiKey } from "@/middleware";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (error: any) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${error?.message || String(error)}`);
  }
}

console.log("\nOrchestration Middleware Auth Contract Test\n");

test("accepts valid API key when no session exists", () => {
  assert.strictEqual(
    canAccessOrchestrationApi({
      expectedApiKey: "top-secret",
      providedApiKey: "top-secret",
      hasSupabaseUser: false,
    }),
    true
  );
});

test("accepts valid Supabase session without API key", () => {
  assert.strictEqual(
    canAccessOrchestrationApi({
      expectedApiKey: "top-secret",
      providedApiKey: null,
      hasSupabaseUser: true,
    }),
    true
  );
});

test("rejects request when neither API key nor session is valid", () => {
  assert.strictEqual(
    canAccessOrchestrationApi({
      expectedApiKey: "top-secret",
      providedApiKey: "wrong-key",
      hasSupabaseUser: false,
    }),
    false
  );
});

test("key validation trims whitespace and requires configured expected key", () => {
  assert.strictEqual(isValidOrchestrationApiKey("  abc123 ", "abc123"), true);
  assert.strictEqual(isValidOrchestrationApiKey(undefined, "abc123"), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
