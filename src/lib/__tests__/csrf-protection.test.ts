/**
 * Regression coverage for HiveRunner's same-origin CSRF policy.
 *
 * Run: npx tsx src/lib/__tests__/csrf-protection.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

import { LOCAL_OWNER_ID } from "@/lib/auth/auth-mode";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import { validateCsrfRequest } from "@/lib/auth/csrf";
import { middleware } from "@/middleware";

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

function setNodeEnv(value: string) {
  Object.defineProperty(process.env, "NODE_ENV", {
    value,
    configurable: true,
    enumerable: true,
    writable: true,
  });
}

function localPost(headers: HeadersInit = {}): NextRequest {
  return new NextRequest("http://localhost:3010/api/orchestration/companies", {
    method: "POST",
    headers: {
      host: "localhost:3010",
      ...headers,
    },
  });
}

async function run() {
  console.log("\nCSRF Protection Test\n");

  const originalNodeEnv = process.env.NODE_ENV;
  const originalAuthMode = process.env.MC_AUTH_MODE;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalApiKey = process.env.MC_API_KEY;
  const originalStrictLocalAuth = process.env.MC_REQUIRE_LOCAL_DEV_AUTH;

  setNodeEnv("development");
  process.env.MC_AUTH_MODE = "local-single-user";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
  process.env.MC_API_KEY = "csrf-test-api-key";

  try {
    await test("allows safe requests without CSRF headers", () => {
      const request = new NextRequest("http://localhost:3010/api/orchestration/companies", {
        headers: { host: "localhost:3010" },
      });

      assert.deepEqual(validateCsrfRequest({ request }), { allowed: true, reason: "safe-method" });
    });

    await test("rejects browser-cookie mutation without same-origin signal", async () => {
      const request = localPost({
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
      });

      const response = await middleware(request, async () => {
        throw new Error("CSRF rejection must happen before auth/session handling");
      });

      assert.equal(response.status, 403);
      const body = await response.json() as { error?: { code?: string; reason?: string } };
      assert.equal(body.error?.code, "csrf_rejected");
      assert.equal(body.error?.reason, "missing-same-origin-signal");
    });

    await test("rejects cross-origin browser-cookie mutation", async () => {
      const request = localPost({
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
        origin: "http://attacker.example",
      });

      const response = await middleware(request, async () => {
        throw new Error("CSRF rejection must happen before auth/session handling");
      });

      assert.equal(response.status, 403);
      const body = await response.json() as { error?: { reason?: string } };
      assert.equal(body.error?.reason, "cross-origin");
    });

    await test("accepts same-origin browser-cookie mutation", async () => {
      const request = localPost({
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
        origin: "http://localhost:3010",
      });

      const response = await middleware(request, async () => ({
        user: { id: LOCAL_OWNER_ID, email: "owner@localhost.local" },
        supabaseResponse: NextResponse.next({ request }),
      }));

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("accepts Sec-Fetch-Site same-origin when Origin is absent", async () => {
      const request = localPost({
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
        "sec-fetch-site": "same-origin",
      });

      const response = await middleware(request, async () => ({
        user: { id: LOCAL_OWNER_ID, email: "owner@localhost.local" },
        supabaseResponse: NextResponse.next({ request }),
      }));

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("accepts same-origin Referer when Origin and Sec-Fetch-Site are absent", async () => {
      const request = localPost({
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
        referer: "http://localhost:3010/login?from=%2FHIVE%2Fdashboard",
      });

      const response = await middleware(request, async () => ({
        user: { id: LOCAL_OWNER_ID, email: "owner@localhost.local" },
        supabaseResponse: NextResponse.next({ request }),
      }));

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("accepts Host origin when request.nextUrl origin differs from browser origin", async () => {
      const request = new NextRequest("http://0.0.0.0:3010/api/orchestration/companies", {
        method: "POST",
        headers: {
          host: "localhost:3010",
          cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
          referer: "http://localhost:3010/login",
        },
      });

      const response = await middleware(request, async () => ({
        user: { id: LOCAL_OWNER_ID, email: "owner@localhost.local" },
        supabaseResponse: NextResponse.next({ request }),
      }));

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("rejects cross-origin Referer fallback", async () => {
      const request = localPost({
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
        referer: "http://attacker.example/form",
      });

      const response = await middleware(request, async () => {
        throw new Error("Cross-origin Referer must not pass CSRF");
      });

      assert.equal(response.status, 403);
      const body = await response.json() as { error?: { reason?: string } };
      assert.equal(body.error?.reason, "cross-origin");
    });

    await test("preserves valid API-key automation without browser origin headers", async () => {
      const request = localPost({
        "x-mc-api-key": "csrf-test-api-key",
      });

      const response = await middleware(request, async () => {
        throw new Error("API-key path must not invoke the session loader");
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("does not let an invalid API key bypass CSRF", async () => {
      const request = localPost({
        "x-mc-api-key": "wrong-key",
      });

      const response = await middleware(request, async () => {
        throw new Error("Invalid API-key request must fail CSRF before auth fallback");
      });

      assert.equal(response.status, 403);
    });

    await test("preserves self-authenticating bearer-token route without browser origin headers", async () => {
      const request = new NextRequest("http://runner.example.com/api/orchestration/symphony/tracker", {
        method: "POST",
        headers: {
          host: "runner.example.com",
          authorization: "Bearer tracker-token",
        },
      });

      const response = await middleware(request, async () => {
        throw new Error("Self-authenticating token route should not need Supabase");
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("preserves internal engine tick without browser origin headers", async () => {
      const request = new NextRequest("http://localhost:3010/api/orchestration/engine/tick", {
        method: "POST",
        headers: {
          host: "localhost:3010",
          "x-engine-tick": "internal",
        },
      });

      const response = await middleware(request, async () => {
        throw new Error("Internal engine tick should not need Supabase");
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });

    await test("rejects engine tick without the internal tick header", async () => {
      const request = new NextRequest("http://localhost:3010/api/orchestration/engine/tick", {
        method: "POST",
        headers: {
          host: "localhost:3010",
        },
      });

      const response = await middleware(request, async () => {
        throw new Error("Unauthenticated engine tick must fail CSRF");
      });

      assert.equal(response.status, 403);
    });

    await test("uses the default session loader when Next passes a middleware event", async () => {
      const request = new NextRequest("http://localhost:3010/settings", {
        method: "GET",
        headers: {
          host: "localhost:3010",
        },
      });

      const response = await middleware(request, {
        waitUntil() {},
        passThroughOnException() {},
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    });
  } finally {
    if (originalNodeEnv !== undefined) {
      setNodeEnv(originalNodeEnv);
    }
    if (originalAuthMode === undefined) {
      delete process.env.MC_AUTH_MODE;
    } else {
      process.env.MC_AUTH_MODE = originalAuthMode;
    }
    if (originalSupabaseUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
    }
    if (originalSupabaseKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalSupabaseKey;
    }
    if (originalApiKey === undefined) {
      delete process.env.MC_API_KEY;
    } else {
      process.env.MC_API_KEY = originalApiKey;
    }
    if (originalStrictLocalAuth === undefined) {
      delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    } else {
      process.env.MC_REQUIRE_LOCAL_DEV_AUTH = originalStrictLocalAuth;
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
