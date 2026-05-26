/**
 * Regression test for the legacy mc_auth cookie bypass in middleware.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-middleware-cookie-bypass.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { middleware } from "@/middleware";

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

async function run() {
  console.log("\nMiddleware Legacy Cookie Bypass Regression Test\n");

  const originalAuthSecret = process.env.AUTH_SECRET;
  const legacySecret = "legacy-auth-secret-for-regression";
  process.env.AUTH_SECRET = legacySecret;

  try {
    await test("rejects mc_auth=AUTH_SECRET without a real Supabase session", async () => {
      const request = new NextRequest("http://example.com/api/orchestration/companies/acme/tasks", {
        headers: {
          cookie: `mc_auth=${legacySecret}`,
        },
      });

      const response = await middleware(request, async () => {
        throw new Error("Supabase session lookup failed");
      });

      assert.equal(response.status, 401);

      const body = await response.json() as { error?: { code?: string; message?: string } };
      assert.equal(body.error?.code, "unauthorized");
    });
  } finally {
    if (originalAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = originalAuthSecret;
    }
  }

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
