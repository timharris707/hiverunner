/**
 * Regression test for localhost middleware auth behavior.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-middleware-localhost-bypass.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";
import { canBypassLocalDevAuth, isLoopbackHost, middleware } from "@/middleware";

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

function seedEdgeRouteMapsForTest(routeMaps: EdgeRouteMaps) {
  const scoped = globalThis as typeof globalThis & {
    __mcEdgeRouteMapCache?: {
      maps: EdgeRouteMaps;
      expiresAt: number;
      version: number;
    };
    __mcEdgeRouteMapVersion?: number;
  };
  scoped.__mcEdgeRouteMapVersion = (scoped.__mcEdgeRouteMapVersion ?? 0) + 1;
  scoped.__mcEdgeRouteMapCache = {
    maps: routeMaps,
    expiresAt: Date.now() + 30_000,
    version: scoped.__mcEdgeRouteMapVersion,
  };
}

async function run() {
  console.log("\nMiddleware Localhost Auth Contract Test\n");

  const originalNodeEnv = process.env.NODE_ENV;
  const originalStrictLocalAuth = process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
  const originalBypassFlag = process.env.MC_LOCAL_DEV_AUTH_BYPASS;
  const originalAuthMode = process.env.MC_AUTH_MODE;
  const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Pin hosted (Supabase) auth mode for tests that exercise the
  // session-fallback path. Otherwise a CI environment without Supabase env
  // vars would resolve to local-single-user mode, where the orchestration
  // guard intentionally ignores synthetic owner sessions.
  process.env.MC_AUTH_MODE = "supabase";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

  seedEdgeRouteMapsForTest({
    companyCodeToSlug: {
      HIVE: "hiverunner-workspace",
      INS: "insight",
    },
    companySlugToCode: {
      "hiverunner-workspace": "HIVE",
      insight: "INS",
    },
    actualCompanyCodes: ["INS"],
    projectIdToSlugByCompany: {},
    projectSlugAliasToCanonical: {},
    generatedAt: new Date().toISOString(),
  });

  await test("recognizes exact loopback hosts and defaults to no local-dev auth bypass", () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    assert.equal(isLoopbackHost("localhost:3010"), true);
    assert.equal(isLoopbackHost("127.0.0.1:3010"), true);
    assert.equal(isLoopbackHost("[::1]:3010"), true);
    assert.equal(isLoopbackHost("localhost.example.com:3010"), false);
    assert.equal(isLoopbackHost("127.0.0.10:3010"), false);
    assert.equal(canBypassLocalDevAuth("localhost:3010"), false);
    assert.equal(canBypassLocalDevAuth("127.0.0.1:3010"), false);
    assert.equal(canBypassLocalDevAuth("[::1]:3010"), false);
  });

  await test("ignores removed MC_LOCAL_DEV_AUTH_BYPASS and only honors strict local auth opt-out", () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    process.env.MC_LOCAL_DEV_AUTH_BYPASS = "1";

    assert.equal(canBypassLocalDevAuth("localhost:3010"), false);
    assert.equal(canBypassLocalDevAuth("127.0.0.1:3010"), false);

    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;
    process.env.MC_REQUIRE_LOCAL_DEV_AUTH = "0";

    assert.equal(canBypassLocalDevAuth("localhost:3010"), true);
    assert.equal(canBypassLocalDevAuth("localhost.example.com:3010"), false);
  });

  await test("rejects localhost orchestration requests without real auth by default", async () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost:3010/api/orchestration/companies/acme/tasks", {
      headers: { host: "localhost:3010" },
    });

    const response = await middleware(request, async () => {
      throw new Error("Supabase session lookup failed");
    });

    assert.equal(response.status, 401);

    const body = await response.json() as { error?: { code?: string; message?: string } };
    assert.equal(body.error?.code, "unauthorized");
  });

  await test("still requires auth for localhost-looking non-loopback hosts", async () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost.example.com:3010/api/orchestration/companies/acme/tasks", {
      headers: { host: "localhost.example.com:3010" },
    });

    const response = await middleware(request, async () => {
      throw new Error("Supabase session lookup failed");
    });

    assert.equal(response.status, 401);

    const body = await response.json() as { error?: { code?: string; message?: string } };
    assert.equal(body.error?.code, "unauthorized");
  });

  await test("allows localhost orchestration requests with a real Supabase session", async () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost:3010/api/orchestration/companies/acme/tasks", {
      headers: { host: "localhost:3010" },
    });

    const response = await middleware(request, async () => ({
      user: { id: "local-dev-test-user", email: "tim@localhost.test" },
      supabaseResponse: NextResponse.next({ request }),
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  await test("allows localhost orchestration requests with a valid API key", async () => {
    const originalApiKey = process.env.MC_API_KEY;
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;
    process.env.MC_API_KEY = "local-dev-api-key";

    try {
      const request = new NextRequest("http://localhost:3010/api/orchestration/companies/acme/tasks", {
        headers: {
          host: "localhost:3010",
          "x-mc-api-key": "local-dev-api-key",
        },
      });

      const response = await middleware(request, async () => {
        throw new Error("API-key auth should not need Supabase");
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.MC_API_KEY;
      } else {
        process.env.MC_API_KEY = originalApiKey;
      }
    }
  });

  await test("allows local-single-user loopback orchestration API without broad bypass", async () => {
    setNodeEnv("development");
    process.env.MC_AUTH_MODE = "local-single-user";
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost:3010/api/orchestration/companies", {
      headers: { host: "localhost:3010" },
    });

    const response = await middleware(request, async () => {
      throw new Error("Local-single-user loopback API should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");

    process.env.MC_AUTH_MODE = "supabase";
  });

  await test("keeps local-single-user non-loopback orchestration API behind auth", async () => {
    setNodeEnv("development");
    process.env.MC_AUTH_MODE = "local-single-user";
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost.example.com:3010/api/orchestration/companies", {
      headers: { host: "localhost.example.com:3010" },
    });

    const response = await middleware(request, async () => {
      throw new Error("Non-loopback local-single-user API should not need Supabase");
    });

    assert.equal(response.status, 401);

    process.env.MC_AUTH_MODE = "supabase";
  });

  await test("allows exact loopback healthchecks without broad local-dev bypass", async () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost:3010/api/hiverunner/health", {
      headers: { host: "localhost:3010" },
    });

    const response = await middleware(request, async () => {
      throw new Error("Healthcheck should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  await test("accepts local-dev session cookie only on exact loopback hosts", async () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost:3010/INS/dashboard", {
      headers: {
        host: "localhost:3010",
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
      },
    });

    const response = await middleware(request, async () => {
      throw new Error("Local-dev session cookie should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost:3010/companies/insight/dashboard");

    const nonLoopbackRequest = new NextRequest("http://localhost.example.com:3010/INS/dashboard", {
      headers: {
        host: "localhost.example.com:3010",
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
      },
    });

    const nonLoopbackResponse = await middleware(nonLoopbackRequest, async () => {
      throw new Error("Supabase session lookup failed");
    });

    assert.equal(nonLoopbackResponse.status, 307);
    assert.equal(nonLoopbackResponse.headers.get("location"), "http://localhost.example.com:3010/login?from=%2FINS%2Fdashboard");
  });

  await test("keeps non-loopback healthcheck hosts behind auth", async () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost.example.com:3010/api/hiverunner/health", {
      headers: { host: "localhost.example.com:3010" },
    });

    const response = await middleware(request, async () => {
      throw new Error("Supabase session lookup failed");
    });

    assert.equal(response.status, 401);
  });

  await test("rewrites canonical company pages after authenticating a session", async () => {
    setNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = new NextRequest("http://localhost:3010/INS/dashboard", {
      headers: { host: "localhost:3010" },
    });

    const response = await middleware(request, async () => ({
      user: { id: "local-dev-test-user", email: "tim@localhost.test" },
      supabaseResponse: NextResponse.next({ request }),
    }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost:3010/companies/insight/dashboard");
    assert.equal(response.headers.get("x-middleware-next"), null);
  });

  await test("skips session auth entirely in explicit bypass mode", async () => {
    setNodeEnv("development");
    process.env.MC_REQUIRE_LOCAL_DEV_AUTH = "0";

    const request = new NextRequest("http://localhost:3010/INS/dashboard", {
      headers: { host: "localhost:3010" },
    });

    const response = await middleware(request, async () => {
      throw new Error("Supabase session lookup failed");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost:3010/companies/insight/dashboard");
  });

  if (originalNodeEnv === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    setNodeEnv(originalNodeEnv);
  }

  if (originalStrictLocalAuth === undefined) {
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
  } else {
    process.env.MC_REQUIRE_LOCAL_DEV_AUTH = originalStrictLocalAuth;
  }

  if (originalBypassFlag === undefined) {
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;
  } else {
    process.env.MC_LOCAL_DEV_AUTH_BYPASS = originalBypassFlag;
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

  const total = passed + failed;
  console.log(`\nResult: ${passed}/${total} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
