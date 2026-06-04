/**
 * Regression coverage for hosted Supabase auth fail-closed behavior and
 * lightweight structured security logging.
 *
 * Run: npx tsx src/lib/__tests__/auth-hosted-fail-closed-logging.test.ts
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { restoreEnvSnapshot, snapshotEnv } from "@/lib/__tests__/helpers/env-test-harness";
import { createTestRunner } from "@/lib/__tests__/helpers/simple-test-runner";
import { GET as authCallback } from "@/app/auth/callback/route";
import { structuredLog } from "@/lib/observability/logging";
import { proxy as middleware } from "@/proxy";

const { finish, test } = createTestRunner({ passLabel: "[pass]", failLabel: "[fail]" });

function captureConsoleWarn(fn: () => Promise<void> | void): Promise<string[]> {
  const originalWarn = console.warn;
  const messages: string[] = [];
  console.warn = (message?: unknown) => {
    messages.push(String(message));
  };

  return Promise.resolve()
    .then(fn)
    .then(() => messages)
    .finally(() => {
      console.warn = originalWarn;
    });
}

async function run() {
  console.log("\nHosted Auth Fail-Closed + Logging Test\n");

  const envSnapshot = snapshotEnv([
    "MC_AUTH_MODE",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "AUTH_SECRET",
  ]);

  try {
    process.env.MC_AUTH_MODE = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.AUTH_SECRET = "legacy-secret-must-not-work";

    await test("hosted page session failure redirects to login and logs security marker", async () => {
      const request = new NextRequest("https://app.example.com/companies/insight/dashboard", {
        headers: {
          host: "app.example.com",
          cookie: "mc_auth=legacy-secret-must-not-work",
        },
      });

      const logs = await captureConsoleWarn(async () => {
        const response = await middleware(request, async () => {
          throw new Error("Supabase outage");
        });

        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "https://app.example.com/login?from=%2Fcompanies%2Finsight%2Fdashboard");
      });

      assert.equal(logs.length, 1);
      assert.match(logs[0], /^\[security\] /);
      assert.match(logs[0], /"event":"auth.hosted_session_error"/);
      assert.match(logs[0], /"reason":"Supabase outage"/);
      assert.doesNotMatch(logs[0], /legacy-secret-must-not-work|mc_auth/);
    });

    await test("hosted orchestration session failure returns 401 and logs security marker", async () => {
      const request = new NextRequest("https://app.example.com/api/orchestration/companies/insight/tasks", {
        headers: {
          host: "app.example.com",
          cookie: "mc_auth=legacy-secret-must-not-work",
        },
      });

      const logs = await captureConsoleWarn(async () => {
        const response = await middleware(request, async () => {
          throw new Error("Supabase outage");
        });

        assert.equal(response.status, 401);
        const body = await response.json() as { error?: { code?: string } };
        assert.equal(body.error?.code, "unauthorized");
      });

      assert.equal(logs.length, 1);
      assert.match(logs[0], /"event":"auth.hosted_orchestration_session_error"/);
      assert.match(logs[0], /"reason":"Supabase outage"/);
      assert.doesNotMatch(logs[0], /legacy-secret-must-not-work|mc_auth/);
    });

    await test("hosted callback misconfiguration fails closed instead of redirecting to app", async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      const logs = await captureConsoleWarn(async () => {
        const response = await authCallback(new Request("https://app.example.com/auth/callback?code=abc&next=/INS/dashboard"));

        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "https://app.example.com/login?error=auth_unavailable");
      });

      assert.equal(logs.length, 1);
      assert.match(logs[0], /"event":"auth.callback_hosted_config_missing"/);

      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    });

    await test("structured logging redacts sensitive fields", async () => {
      const messages = await captureConsoleWarn(() => {
        structuredLog("security", "warn", "test.redaction", {
          requestId: "request-1",
          password: "must-redact",
          serviceRoleKey: "must-redact-too",
          reason: "unit test",
        });
      });

      assert.equal(messages.length, 1);
      assert.match(messages[0], /"password":"\[redacted\]"/);
      assert.match(messages[0], /"serviceRoleKey":"\[redacted\]"/);
      assert.doesNotMatch(messages[0], /must-redact/);
      assert.match(messages[0], /"reason":"unit test"/);
    });
  } finally {
    restoreEnvSnapshot(envSnapshot);
  }

  finish();
}

run().catch((error) => {
  console.error("Unhandled hosted fail-closed logging test runner error:", error);
  process.exit(1);
});
