/**
 * Regression test for the legacy mc_auth cookie bypass in middleware.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-middleware-cookie-bypass.test.ts
 */

import {
  assertUnauthorizedMiddlewareResponse,
  createMiddlewareRequest,
  createMiddlewareTestRunner,
  rejectSupabaseSessionLookup,
} from "@/lib/__tests__/helpers/orchestration-middleware-test-harness";
import { restoreEnvSnapshot, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { proxy as middleware } from "@/proxy";

const { finish, test } = createMiddlewareTestRunner({ passLabel: "✓", failLabel: "✗" });

async function run() {
  console.log("\nMiddleware Legacy Cookie Bypass Regression Test\n");

  const envSnapshot = snapshotEnv(["AUTH_SECRET"]);
  const legacySecret = "legacy-auth-secret-for-regression";
  process.env.AUTH_SECRET = legacySecret;

  try {
    await test("rejects mc_auth=AUTH_SECRET without a real Supabase session", async () => {
      const request = createMiddlewareRequest("http://example.com/api/orchestration/companies/acme/tasks", {
        cookie: `mc_auth=${legacySecret}`,
      });

      const response = await middleware(request, rejectSupabaseSessionLookup);

      await assertUnauthorizedMiddlewareResponse(response);
    });
  } finally {
    restoreEnvSnapshot(envSnapshot);
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled middleware cookie bypass test runner error:", error);
  process.exit(1);
});
