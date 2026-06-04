/**
 * Regression test for localhost middleware auth behavior.
 * Run: node --import ./scripts/register-ts-paths.mjs src/lib/__tests__/orchestration-middleware-localhost-bypass.test.ts
 */

import assert from "node:assert/strict";
import { NextResponse } from "next/server";

import {
  assertUnauthorizedMiddlewareResponse,
  createMiddlewareRequest,
  createMiddlewareTestRunner,
  rejectSupabaseSessionLookup,
} from "@/lib/__tests__/helpers/orchestration-middleware-test-harness";
import {
  restoreEnvSnapshot,
  restoreEnvVar,
  setTestNodeEnv,
  snapshotEnv,
} from "@/lib/__tests__/helpers/env-test-harness";
import { LOCAL_DEV_SESSION_COOKIE } from "@/lib/auth/local-dev-session";
import type { EdgeRouteMaps } from "@/lib/orchestration/edge-route-maps";
import { canBypassLocalDevAuth, isLoopbackHost, proxy as middleware } from "@/proxy";

const { finish, test } = createMiddlewareTestRunner({ passLabel: "[pass]", failLabel: "[fail]" });

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

function clearEdgeRouteMapsForTest() {
  const scoped = globalThis as typeof globalThis & {
    __mcEdgeRouteMapCache?: unknown;
    __mcEdgeRouteMapVersion?: number;
  };
  scoped.__mcEdgeRouteMapVersion = (scoped.__mcEdgeRouteMapVersion ?? 0) + 1;
  delete scoped.__mcEdgeRouteMapCache;
}

async function run() {
  console.log("\nMiddleware Localhost Auth Contract Test\n");

  const envSnapshot = snapshotEnv([
    "NODE_ENV",
    "MC_REQUIRE_LOCAL_DEV_AUTH",
    "MC_LOCAL_DEV_AUTH_BYPASS",
    "MC_AUTH_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "MC_EDGE_ROUTE_MAP_FETCH_TIMEOUT_MS",
  ]);

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
    setTestNodeEnv("development");
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
    setTestNodeEnv("development");
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
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost:3010/api/orchestration/companies/acme/tasks", {
      host: "localhost:3010",
    });

    const response = await middleware(request, rejectSupabaseSessionLookup);

    await assertUnauthorizedMiddlewareResponse(response);
  });

  await test("still requires auth for localhost-looking non-loopback hosts", async () => {
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost.example.com:3010/api/orchestration/companies/acme/tasks", {
      host: "localhost.example.com:3010",
    });

    const response = await middleware(request, rejectSupabaseSessionLookup);

    await assertUnauthorizedMiddlewareResponse(response);
  });

  await test("allows localhost orchestration requests with a real Supabase session", async () => {
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost:3010/api/orchestration/companies/acme/tasks", {
      host: "localhost:3010",
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
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;
    process.env.MC_API_KEY = "local-dev-api-key";

    try {
      const request = createMiddlewareRequest("http://localhost:3010/api/orchestration/companies/acme/tasks", {
        host: "localhost:3010",
        "x-mc-api-key": "local-dev-api-key",
      });

      const response = await middleware(request, async () => {
        throw new Error("API-key auth should not need Supabase");
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    } finally {
      restoreEnvVar("MC_API_KEY", originalApiKey);
    }
  });

  await test("allows local-single-user loopback orchestration API without broad bypass", async () => {
    setTestNodeEnv("development");
    process.env.MC_AUTH_MODE = "local-single-user";
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost:3010/api/orchestration/companies", {
      host: "localhost:3010",
    });

    const response = await middleware(request, async () => {
      throw new Error("Local-single-user loopback API should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");

    process.env.MC_AUTH_MODE = "supabase";
  });

  await test("keeps local-single-user non-loopback orchestration API behind auth", async () => {
    setTestNodeEnv("development");
    process.env.MC_AUTH_MODE = "local-single-user";
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost.example.com:3010/api/orchestration/companies", {
      host: "localhost.example.com:3010",
    });

    const response = await middleware(request, async () => {
      throw new Error("Non-loopback local-single-user API should not need Supabase");
    });

    assert.equal(response.status, 401);

    process.env.MC_AUTH_MODE = "supabase";
  });

  await test("allows exact loopback healthchecks without broad local-dev bypass", async () => {
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost:3010/api/hiverunner/health", {
      host: "localhost:3010",
    });

    const response = await middleware(request, async () => {
      throw new Error("Healthcheck should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  await test("serves the public homepage at root instead of redirecting to a workspace", async () => {
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost:3010/", {
      host: "localhost:3010",
    });

    const response = await middleware(request, async () => {
      throw new Error("Public homepage should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
  });

  await test("accepts local-dev session cookie only on exact loopback hosts", async () => {
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost:3010/INS/dashboard", {
      host: "localhost:3010",
      cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
    });

    const response = await middleware(request, async () => {
      throw new Error("Local-dev session cookie should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost:3010/companies/insight/dashboard");

    const nonLoopbackRequest = createMiddlewareRequest("http://localhost.example.com:3010/INS/dashboard", {
      host: "localhost.example.com:3010",
      cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
    });

    const nonLoopbackResponse = await middleware(nonLoopbackRequest, async () => {
      throw new Error("Supabase session lookup failed");
    });

    assert.equal(nonLoopbackResponse.status, 307);
    assert.equal(nonLoopbackResponse.headers.get("location"), "http://localhost.example.com:3010/login?from=%2FINS%2Fdashboard");
  });

  await test("falls back quickly for INS navigation when edge route-map self-fetch stalls", async () => {
    setTestNodeEnv("development");
    clearEdgeRouteMapsForTest();
    process.env.MC_EDGE_ROUTE_MAP_FETCH_TIMEOUT_MS = "1";
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalled = true;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as typeof fetch;

    try {
      const request = createMiddlewareRequest("http://localhost:3010/INS/tasks", {
        host: "localhost:3010",
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
      });

      const response = await middleware(request, async () => {
        throw new Error("Local-dev session cookie should not need Supabase");
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost:3010/companies/insight/tasks");
      assert.equal(fetchCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvVar(
        "MC_EDGE_ROUTE_MAP_FETCH_TIMEOUT_MS",
        envSnapshot["MC_EDGE_ROUTE_MAP_FETCH_TIMEOUT_MS"],
      );
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
    }
  });

  await test("bounds unknown company route-map refresh stalls", async () => {
    setTestNodeEnv("development");
    clearEdgeRouteMapsForTest();
    process.env.MC_EDGE_ROUTE_MAP_FETCH_TIMEOUT_MS = "20";
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as typeof fetch;

    try {
      const startedAt = Date.now();
      const request = createMiddlewareRequest("http://localhost:3010/ZZZ/dashboard", {
        host: "localhost:3010",
        cookie: `${LOCAL_DEV_SESSION_COOKIE}=1`,
      });

      const response = await middleware(request, async () => {
        throw new Error("Local-dev session cookie should not need Supabase");
      });
      const durationMs = Date.now() - startedAt;

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(fetchCalls, 1);
      assert.ok(durationMs < 500, `expected bounded route-map fallback under 500ms, got ${durationMs}ms`);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnvVar(
        "MC_EDGE_ROUTE_MAP_FETCH_TIMEOUT_MS",
        envSnapshot["MC_EDGE_ROUTE_MAP_FETCH_TIMEOUT_MS"],
      );
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
    }
  });

  await test("keeps non-loopback healthcheck hosts behind auth", async () => {
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost.example.com:3010/api/hiverunner/health", {
      host: "localhost.example.com:3010",
    });

    const response = await middleware(request, rejectSupabaseSessionLookup);

    assert.equal(response.status, 401);
  });

  await test("rewrites canonical company pages after authenticating a session", async () => {
    setTestNodeEnv("development");
    delete process.env.MC_REQUIRE_LOCAL_DEV_AUTH;
    delete process.env.MC_LOCAL_DEV_AUTH_BYPASS;

    const request = createMiddlewareRequest("http://localhost:3010/INS/dashboard", {
      host: "localhost:3010",
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
    setTestNodeEnv("development");
    process.env.MC_REQUIRE_LOCAL_DEV_AUTH = "0";

    const request = createMiddlewareRequest("http://localhost:3010/INS/dashboard", {
      host: "localhost:3010",
    });

    const response = await middleware(request, async () => {
      throw new Error("Supabase session lookup failed");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-middleware-rewrite"), "http://localhost:3010/companies/insight/dashboard");
  });

  await test("allows internal company-code rewrites to render without legacy redirect loop", async () => {
    setTestNodeEnv("development");
    process.env.MC_REQUIRE_LOCAL_DEV_AUTH = "0";

    const request = createMiddlewareRequest("http://localhost:3010/companies/insight/dashboard", {
      host: "localhost:3010",
      "x-mc-canonical-rewrite": "1",
    });

    const response = await middleware(request, async () => {
      throw new Error("Explicit local-dev bypass should not need Supabase");
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-next"), "1");
  });

  restoreEnvSnapshot(envSnapshot);

  finish();
}

run().catch((error) => {
  console.error("Unhandled test runner error:", error);
  process.exit(1);
});
