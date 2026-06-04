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
import { proxy as middleware } from "@/proxy";

const { finish, test } = createMiddlewareTestRunner({ passLabel: "✓", failLabel: "✗" });

async function run() {
  console.log("\nMiddleware Legacy Cookie Bypass Regression Test\n");

  const originalAuthSecret = process.env.AUTH_SECRET;
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
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
