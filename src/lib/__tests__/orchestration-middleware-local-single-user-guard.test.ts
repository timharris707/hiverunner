/**
 * Regression test for orchestration auth in local-single-user mode.
 *
 * The session loader returns a synthetic local owner for every request in
 * local-single-user mode (the intended behavior for page routes on a fresh
 * GitHub clone). Without an explicit gate, that synthetic user would also
 * satisfy the orchestration auth check and let unauthenticated callers reach
 * agent traffic. This test pins down the contract: orchestration routes must
 * require a valid `x-mc-api-key` in local-single-user mode and must not trust
 * the synthetic owner.
 *
 * Run: npx tsx src/lib/__tests__/orchestration-middleware-local-single-user-guard.test.ts
 */

import assert from "node:assert/strict";
import { NextResponse } from "next/server";

import { restoreEnvSnapshot, setTestNodeEnv, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import {
  assertUnauthorizedMiddlewareResponse,
  createMiddlewareRequest,
  createMiddlewareTestRunner,
} from "@/lib/__tests__/helpers/orchestration-middleware-test-harness";
import { LOCAL_OWNER_ID } from "@/lib/auth/auth-mode";
import { proxy as middleware } from "@/proxy";

const { finish, test } = createMiddlewareTestRunner({ passLabel: "[pass]", failLabel: "[fail]" });

async function run() {
  console.log("\nOrchestration Local-Single-User Guard Test\n");

  const envSnapshot = snapshotEnv([
    "NODE_ENV",
    "MC_AUTH_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "MC_API_KEY",
    "MC_REQUIRE_LOCAL_DEV_AUTH",
    "MC_LOCAL_DEV_AUTH_BYPASS",
  ]);

  // Always run the orchestration path under production-style strictness so the
  // loopback bypass does not pre-empt the orchestration auth check.
  setTestNodeEnv("production");
  delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
  delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

  // Force local-single-user mode by clearing Supabase env.
  process.env.MC_AUTH_MODE = "local-single-user";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.MC_API_KEY = "local-mode-api-key";

  try {
    await test("rejects orchestration request without API key in local-single-user mode", async () => {
      let sessionLoaderCalled = false;
      const request = createMiddlewareRequest("http://app.example.com/api/orchestration/companies/insight/tasks", {
        host: "app.example.com",
      });

      const response = await middleware(request, async () => {
        sessionLoaderCalled = true;
        return {
          user: { id: LOCAL_OWNER_ID, email: "owner@localhost.local" },
          supabaseResponse: NextResponse.next({ request }),
        };
      });

      await assertUnauthorizedMiddlewareResponse(response);
      assert.equal(
        sessionLoaderCalled,
        false,
        "session loader should be skipped entirely in local-single-user orchestration path"
      );
    });

    await test("accepts orchestration request with valid API key in local-single-user mode", async () => {
      const request = createMiddlewareRequest("http://app.example.com/api/orchestration/companies/insight/tasks", {
        host: "app.example.com",
        "x-mc-api-key": "local-mode-api-key",
      });

      const response = await middleware(request, async () => {
        throw new Error("API key path must not invoke the session loader");
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("rejects orchestration request with wrong API key in local-single-user mode", async () => {
      const request = createMiddlewareRequest("http://app.example.com/api/orchestration/companies/insight/tasks", {
        host: "app.example.com",
        "x-mc-api-key": "not-the-real-key",
      });

      const response = await middleware(request, async () => ({
        user: { id: LOCAL_OWNER_ID, email: "owner@localhost.local" },
        supabaseResponse: NextResponse.next({ request }),
      }));

      await assertUnauthorizedMiddlewareResponse(response);
    });

    // Now flip into hosted (supabase) mode and verify the session fallback is
    // still honored — the local guard must not regress hosted behavior.
    process.env.MC_AUTH_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    await test("hosted mode still accepts a real Supabase session as fallback", async () => {
      const request = createMiddlewareRequest("http://app.example.com/api/orchestration/companies/insight/tasks", {
        host: "app.example.com",
      });

      const response = await middleware(request, async () => ({
        user: { id: "real-supabase-user", email: "user@example.com" },
        supabaseResponse: NextResponse.next({ request }),
      }));

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("hosted mode still rejects unauthenticated orchestration callers", async () => {
      const request = createMiddlewareRequest("http://app.example.com/api/orchestration/companies/insight/tasks", {
        host: "app.example.com",
      });

      const response = await middleware(request, async () => ({
        user: null,
        supabaseResponse: NextResponse.next({ request }),
      }));

      await assertUnauthorizedMiddlewareResponse(response);
    });
  } finally {
    restoreEnvSnapshot(envSnapshot);
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled local-single-user guard test runner error:", error);
  process.exit(1);
});
