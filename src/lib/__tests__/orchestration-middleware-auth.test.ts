/**
 * Contract test for orchestration middleware auth decision logic.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-middleware-auth.test.ts
 */

import assert from "node:assert";
import { canAccessOrchestrationApi, isValidOrchestrationApiKey } from "@/proxy";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";

const { finish, test } = createTestRunner({ passLabel: "\u2713", failLabel: "\u2717" });

async function run() {
  console.log("\nOrchestration Middleware Auth Contract Test\n");

  await test("accepts valid API key when no session exists", () => {
    assert.strictEqual(
      canAccessOrchestrationApi({
        expectedApiKey: "top-secret",
        providedApiKey: "top-secret",
        hasSupabaseUser: false,
      }),
      true
    );
  });

  await test("accepts valid Supabase session without API key", () => {
    assert.strictEqual(
      canAccessOrchestrationApi({
        expectedApiKey: "top-secret",
        providedApiKey: null,
        hasSupabaseUser: true,
      }),
      true
    );
  });

  await test("rejects request when neither API key nor session is valid", () => {
    assert.strictEqual(
      canAccessOrchestrationApi({
        expectedApiKey: "top-secret",
        providedApiKey: "wrong-key",
        hasSupabaseUser: false,
      }),
      false
    );
  });

  await test("key validation trims whitespace and requires configured expected key", () => {
    assert.strictEqual(isValidOrchestrationApiKey("  abc123 ", "abc123"), true);
    assert.strictEqual(isValidOrchestrationApiKey(undefined, "abc123"), false);
  });

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
